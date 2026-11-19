import Compression
import Foundation

// Share links, compatible with the web app (client/src/lib/share.ts and
// ask-share.ts): a compact JSON payload, raw-deflated, base64url-encoded,
// behind a `v1.` tag in the URL hash: `https://gospel.help/#saved=v1.…` for a
// collection, `#ask=v1.…` for an answer. Links come from anyone, so decoding
// caps every size and rebuilds each passage field by field.

struct ShareError: LocalizedError, Sendable, Equatable {
    enum Code: Sendable { case tooLong, tooLarge, invalid, empty }
    var code: Code
    var message: String
    var errorDescription: String? { message }
}

enum ShareCodec {
    static let versionPrefix = "v1."
    static let collectionKey = "saved"
    static let answerKey = "ask"
    /// Longest link handed out (chat apps start mangling longer ones).
    static let maxURLLength = 24_000

    private static let maxEncodedLength = 64_000
    private static let maxDecodedBytes = 512 * 1024
    private static let maxEntries = 200
    private static let maxTextLength = 20_000
    private static let maxFieldLength = 500
    private static let metadataKeys = [
        "speaker", "year", "month", "date", "volume", "translation",
        "chapter", "section_number", "section_title",
    ]
    private static let allowedHosts = ["churchofjesuschrist.org", "speeches.byu.edu"]

    private static let damaged = ShareError(code: .invalid, message: "The link is incomplete or damaged.")

    // MARK: Hosts

    /// http(s) links to the Church's site or BYU Speeches only.
    static func isAllowedSourceURL(_ raw: String) -> Bool {
        guard let c = URLComponents(string: raw),
              let scheme = c.scheme?.lowercased(), scheme == "https" || scheme == "http",
              c.user == nil, c.password == nil,
              let host = c.host?.lowercased() else { return false }
        return allowedHosts.contains { host == $0 || host.hasSuffix(".\($0)") }
    }

    // MARK: Bytes

    static func base64URL(_ data: Data) -> String {
        data.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }

    static func fromBase64URL(_ text: String) throws -> Data {
        guard text.allSatisfy({ $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "-" || $0 == "_") }) else {
            throw ShareError(code: .invalid, message: "The link has stray characters in it.")
        }
        var base64 = text.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        base64 += String(repeating: "=", count: (4 - base64.count % 4) % 4)
        guard let data = Data(base64Encoded: base64) else {
            throw ShareError(code: .invalid, message: "The link is incomplete.")
        }
        return data
    }

    /// Raw DEFLATE (RFC 1951), what the browser's "deflate-raw" makes.
    static func deflate(_ data: Data) throws -> Data {
        var out = Data()
        let filter = try OutputFilter(.compress, using: .zlib) { chunk in
            if let chunk { out.append(chunk) }
        }
        try filter.write(data)
        try filter.finalize()
        return out
    }

    /// Inflates, giving up once the output passes `limit` bytes.
    static func inflate(_ data: Data, limit: Int, what: String) throws -> Data {
        struct TooLarge: Error {}
        var out = Data()
        do {
            let filter = try OutputFilter(.decompress, using: .zlib) { chunk in
                guard let chunk else { return }
                if out.count + chunk.count > limit { throw TooLarge() }
                out.append(chunk)
            }
            try filter.write(data)
            try filter.finalize()
        } catch is TooLarge {
            throw ShareError(code: .tooLarge, message: "This \(what) is too large to open.")
        } catch {
            throw damaged
        }
        return out
    }

    static func pack(_ object: Any) throws -> String {
        let json = try JSONSerialization.data(withJSONObject: object, options: [.withoutEscapingSlashes])
        return versionPrefix + base64URL(try deflate(json))
    }

    static func unpack(_ token: String, what: String) throws -> Any {
        if token.count > maxEncodedLength {
            throw ShareError(code: .tooLarge, message: "This \(what) is too large to open.")
        }
        guard token.hasPrefix(versionPrefix) else {
            throw ShareError(code: .invalid, message: "This link was made by a newer or unknown version of Gospel Help.")
        }
        let json = try inflate(
            fromBase64URL(String(token.dropFirst(versionPrefix.count))), limit: maxDecodedBytes, what: what)
        guard let object = try? JSONSerialization.jsonObject(with: json) else { throw damaged }
        return object
    }

    // MARK: Passages on the wire

    static func toWire(_ p: Passage) -> [String: Any] {
        var entry: [String: Any] = ["s": p.source.rawValue, "r": p.reference, "x": p.text, "u": p.url]
        if let title = p.title, title != p.reference { entry["t"] = title }
        var meta: [String: Any] = [:]
        for key in metadataKeys {
            switch p.metadata[key] {
            case .string(let s): meta[key] = s
            case .number(let n): meta[key] = Int(exactly: n).map { $0 as Any } ?? n
            default: break
            }
        }
        if !meta.isEmpty { entry["m"] = meta }
        if let id = p.apiID, !id.isEmpty { entry["i"] = id }
        return entry
    }

    /// Lengths count UTF-16 units, as the web's caps do.
    private static func bounded(_ value: Any?, _ max: Int) -> String? {
        guard let s = value as? String, s.utf16.count <= max else { return nil }
        return s
    }

    /// A JSON number (not a boolean) that is a whole number.
    private static func wholeNumber(_ value: Any?) -> Int? {
        guard let n = value as? NSNumber, CFGetTypeID(n) != CFBooleanGetTypeID() else { return nil }
        return Int(exactly: n.doubleValue)
    }

    /// Rebuilds a passage from a link, or nil when it isn't safe to show.
    static func fromWire(_ value: Any) -> Passage? {
        guard let e = value as? [String: Any],
              let source = (e["s"] as? String).flatMap(Source.init(rawValue:)),
              let reference = bounded(e["r"], maxFieldLength), !reference.isEmpty,
              let text = bounded(e["x"], maxTextLength),
              !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              let url = bounded(e["u"], 2048), isAllowedSourceURL(url) else { return nil }
        var metadata: [String: JSONValue] = [:]
        if let m = e["m"] as? [String: Any] {
            for key in metadataKeys {
                guard let v = m[key] else { continue }
                if key == "year" {
                    // Years only: anything else isn't a date to show.
                    if let year = wholeNumber(v), (1...9999).contains(year) {
                        metadata[key] = .number(Double(year))
                    }
                } else if let s = v as? String, s.utf16.count <= maxFieldLength {
                    metadata[key] = .string(s)
                } else if let n = v as? NSNumber, CFGetTypeID(n) != CFBooleanGetTypeID(),
                          n.doubleValue.isFinite, abs(n.doubleValue) < 1e15 {
                    metadata[key] = .number(n.doubleValue)
                }
            }
        }
        return Passage(
            apiID: bounded(e["i"], 200).flatMap { $0.isEmpty ? nil : $0 },
            source: source, reference: reference, text: text,
            title: bounded(e["t"], maxFieldLength) ?? reference,
            url: url, score: 0, metadata: metadata)
    }

    // MARK: Collections

    static func collectionURL(_ passages: [Passage]) throws -> URL {
        let token = try pack(["p": passages.map(toWire)])
        let link = "\(AppConfig.webBase)/#\(collectionKey)=\(token)"
        guard link.count <= maxURLLength else {
            throw ShareError(code: .tooLong, message: "\(passages.count) passages are too many to fit in a link. Share fewer, or send the Markdown file instead.")
        }
        return URL(string: link)!
    }

    struct DecodedCollection: Sendable {
        var passages: [Passage]
        var skipped: Int
    }

    static func decodeCollection(_ token: String) throws -> DecodedCollection {
        guard let payload = try unpack(token, what: "collection") as? [String: Any],
              let entries = payload["p"] as? [Any] else { throw damaged }
        if entries.count > maxEntries {
            throw ShareError(code: .tooLarge, message: "This collection has too many passages to open.")
        }
        var seen = Set<String>()
        var passages: [Passage] = []
        var skipped = 0
        for entry in entries {
            // A repeat may match by its legacy key alone (one copy with an id,
            // one without), so every key counts.
            guard let p = fromWire(entry), !p.keys.contains(where: seen.contains) else { skipped += 1; continue }
            seen.formUnion(p.keys)
            passages.append(p)
        }
        if passages.isEmpty {
            throw ShareError(code: .empty, message: "None of the passages in this link could be read.")
        }
        return DecodedCollection(passages: passages, skipped: skipped)
    }

    // MARK: Answers

    struct Answer: Sendable, Equatable {
        var question: String
        var segments: [AskSegment]
        var citations: [Int: Passage]
        /// Citation numbers whose text was cut to fit a link; never saved.
        var excerpts: Set<Int> = []

        var sources: [(n: Int, passage: Passage)] {
            citations.keys.sorted().map { ($0, citations[$0]!) }
        }
    }

    private static let trimmedPassageChars = 400

    static func trim(_ text: String, _ max: Int) -> String {
        guard text.count > max else { return text }
        let cut = String(text.prefix(max))
        if let space = cut.lastIndex(of: " "), cut.distance(from: cut.startIndex, to: space) > Int(Double(max) * 0.8) {
            return String(cut[..<space]).trimmingCharacters(in: .whitespaces) + "…"
        }
        return cut.trimmingCharacters(in: .whitespaces) + "…"
    }

    private static func wireAnswer(_ a: Answer, passageChars: Int?) -> [String: Any] {
        [
            "q": a.question,
            "a": a.segments.map { [$0.text, $0.cites] as [Any] },
            "p": a.citations.keys.sorted().map { n -> [String: Any] in
                var entry = toWire(a.citations[n]!)
                entry["n"] = n
                if let max = passageChars, let x = entry["x"] as? String, x.count > max {
                    entry["x"] = trim(x, max)
                    entry["k"] = 1
                }
                return entry
            },
        ]
    }

    static func answerURL(_ answer: Answer) throws -> URL {
        let full = "\(AppConfig.webBase)/#\(answerKey)=\(try pack(wireAnswer(answer, passageChars: nil)))"
        if full.count <= maxURLLength { return URL(string: full)! }
        let trimmed = "\(AppConfig.webBase)/#\(answerKey)=\(try pack(wireAnswer(answer, passageChars: trimmedPassageChars)))"
        if trimmed.count <= maxURLLength { return URL(string: trimmed)! }
        throw ShareError(code: .tooLong, message: "This answer is too long to fit in a link. Copy it as text instead.")
    }

    static func decodeAnswer(_ token: String) throws -> Answer {
        guard let payload = try unpack(token, what: "answer") as? [String: Any],
              let q = payload["q"] as? String,
              !q.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              let a = payload["a"] as? [Any], let p = payload["p"] as? [Any] else { throw damaged }
        if q.utf16.count > 1_000 || a.count > 500 || p.count > 60 {
            throw ShareError(code: .tooLarge, message: "This answer is too large to open.")
        }
        var citations: [Int: Passage] = [:]
        var excerpts = Set<Int>()
        for entry in p {
            guard let dict = entry as? [String: Any], let n = wholeNumber(dict["n"]),
                  (1...200).contains(n), citations[n] == nil, var passage = fromWire(dict) else { continue }
            // Anything but a clean "not cut" counts as cut.
            if dict["k"] != nil {
                excerpts.insert(n)
                passage.metadata[Passage.excerptKey] = .bool(true)
            }
            citations[n] = passage
        }
        var length = 0
        var segments: [AskSegment] = []
        for item in a {
            guard let pair = item as? [Any], let text = pair.first as? String else { throw damaged }
            length += text.utf16.count
            if length > 40_000 { throw ShareError(code: .tooLarge, message: "This answer is too large to open.") }
            var cites: [Int] = []
            if pair.count > 1, let raw = pair[1] as? [Any] {
                for value in raw {
                    guard let n = wholeNumber(value), citations[n] != nil, !cites.contains(n) else { continue }
                    cites.append(n)
                    if cites.count >= 30 { break }
                }
            }
            segments.append(AskSegment(text: text, cites: cites))
        }
        guard segments.contains(where: { !$0.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }) else {
            throw ShareError(code: .empty, message: "There’s no answer in this link.")
        }
        return Answer(
            question: q.trimmingCharacters(in: .whitespacesAndNewlines),
            segments: segments, citations: citations, excerpts: excerpts)
    }

    /// The answer as text: question, answer with [n] markers, then sources.
    static func answerText(_ a: Answer) -> String {
        let body = a.segments.enumerated().map { i, s in
            (i == 0 ? String(s.text.drop(while: \.isWhitespace)) : s.text) + s.cites.map { "[\($0)]" }.joined()
        }.joined().trimmingCharacters(in: .whitespacesAndNewlines)
        let sources = a.sources.map { "[\($0.n)] \($0.passage.heading)\n\($0.passage.url)" }
        return ([a.question, body] + (sources.isEmpty ? [] : ["Sources\n" + sources.joined(separator: "\n")])
            + ["Written by AI on Gospel Help from the sources above. It can get things wrong, so read the sources."])
            .joined(separator: "\n\n")
    }

    // MARK: Incoming links

    enum Incoming: Equatable {
        case collection(String)
        case answer(String)
        case search(String)
    }

    /// `https://gospel.help/#saved=…`, `gospelhelp://open#ask=…`, `?q=…`.
    static func parse(_ url: URL) -> Incoming? {
        if let fragment = url.fragment(percentEncoded: true) {
            let items = URLComponents(string: "?" + fragment)?.queryItems ?? []
            if let t = items.first(where: { $0.name == collectionKey })?.value, !t.isEmpty { return .collection(t) }
            if let t = items.first(where: { $0.name == answerKey })?.value, !t.isEmpty { return .answer(t) }
        }
        if let q = URLComponents(url: url, resolvingAgainstBaseURL: false)?
            .queryItems?.first(where: { $0.name == "q" })?.value,
           !q.trimmingCharacters(in: .whitespaces).isEmpty {
            return .search(q)
        }
        return nil
    }
}
