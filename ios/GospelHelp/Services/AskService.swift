import Foundation

// Ask mode: POST /ask streams one cited answer as server-sent events (see
// api/ask.py and client/src/lib/ask.ts).

/// A run of answer text and the citation numbers it ends with.
struct AskSegment: Codable, Hashable, Sendable {
    var text: String
    var cites: [Int]
}

struct AskQuota: Sendable, Equatable {
    var hourLeft: Int
    var dayLeft: Int
}

/// Why Ask won't take a question right now, and until when.
struct AskClosed: Sendable, Equatable {
    enum Code: String, Sendable { case budget, hourlyLimit = "hourly_limit", dailyLimit = "daily_limit", unavailable }
    var code: Code
    var resetAt: Date?

    init?(body: [String: Any]?) {
        guard let raw = body?["code"] as? String, let code = Code(rawValue: raw) else { return nil }
        self.code = code
        if let reset = body?["reset_at"] as? String {
            resetAt = AskClosed.parseDate(reset)
        }
    }

    init(code: Code, resetAt: Date?) {
        self.code = code
        self.resetAt = resetAt
    }

    static func parseDate(_ raw: String) -> Date? {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let d = f.date(from: raw) { return d }
        f.formatOptions = [.withInternetDateTime]
        return f.date(from: raw)
    }

    /// "at 6:00 PM", "tomorrow at 9:00 AM", "on Friday at 6:00 PM".
    static func resetPhrase(_ date: Date, now: Date = .now, calendar: Calendar = .current) -> String {
        let time = date.formatted(date: .omitted, time: .shortened)
        let days = calendar.dateComponents(
            [.day], from: calendar.startOfDay(for: now), to: calendar.startOfDay(for: date)).day ?? 0
        if days <= 0 { return "at \(time)" }
        if days == 1 { return "tomorrow at \(time)" }
        return "on \(date.formatted(.dateTime.weekday(.wide))) at \(time)"
    }

    var message: (title: String, body: String) {
        let when = resetAt.map { AskClosed.resetPhrase($0) }
        switch code {
        case .budget:
            return ("Ask is resting for today.",
                    "It has answered as many questions as it can for now\(when.map { " and will be back \($0)" } ?? ""). Search still works in the meantime.")
        case .dailyLimit:
            return ("You’ve used today’s questions.",
                    "You can ask again \(when ?? "tomorrow"). Search still works in the meantime.")
        case .hourlyLimit:
            return ("That’s a lot of questions for one hour.",
                    "You can ask again \(when ?? "soon"). Search still works in the meantime.")
        case .unavailable:
            return ("Ask isn’t available right now.", "Search still works in the meantime.")
        }
    }
}

enum AskEvent: Sendable {
    case quota(AskQuota)
    case search(String)
    /// The whole answer so far.
    case answer([AskSegment])
    case citation(Int, Passage)
    /// The answer so far was a draft; drop its citations too.
    case reset
}

enum AskError: LocalizedError, Sendable {
    case closed(AskClosed)
    case failed(String)

    var errorDescription: String? {
        switch self {
        case .closed(let c): c.message.title
        case .failed(let m): m
        }
    }
}

/// Folds SSE events into the answer's segments. Separate from the network so
/// it can be tested.
struct AskEventParser {
    private(set) var segments: [AskSegment] = []
    private(set) var finished = false
    private var event = "message"
    private let decoder = JSONDecoder()

    /// Feed one line of the stream; returns what changed.
    mutating func consume(line: String) throws -> [AskEvent] {
        if line.hasPrefix("event: ") {
            event = String(line.dropFirst(7))
            return []
        }
        guard line.hasPrefix("data: ") else {
            if line.isEmpty { event = "message" }
            return []
        }
        let payload = Data(line.dropFirst(6).utf8)
        let data = (try? JSONSerialization.jsonObject(with: payload)) as? [String: Any] ?? [:]
        defer { event = "message" }
        return try handle(event, data, raw: payload)
    }

    private mutating func current() -> AskSegment {
        if segments.isEmpty { segments = [AskSegment(text: "", cites: [])] }
        return segments[segments.count - 1]
    }

    private mutating func handle(_ event: String, _ data: [String: Any], raw: Data) throws -> [AskEvent] {
        switch event {
        case "meta":
            return [.quota(AskQuota(
                hourLeft: (data["hour_left"] as? Int) ?? 0,
                dayLeft: (data["day_left"] as? Int) ?? 0))]
        case "search":
            return [.search((data["query"] as? String) ?? "")]
        case "block":
            segments.append(AskSegment(text: "", cites: []))
            return []
        case "cite":
            guard let n = data["n"] as? Int else { return [] }
            var out: [AskEvent] = []
            struct CiteBody: Decodable { var passage: Passage? }
            if let passage = (try? decoder.decode(CiteBody.self, from: raw))?.passage {
                out.append(.citation(n, passage))
            }
            var seg = current()
            if !seg.cites.contains(n) {
                seg.cites.append(n)
                segments[segments.count - 1] = seg
                out.append(.answer(segments))
            }
            return out
        case "text":
            var seg = current()
            seg.text += (data["text"] as? String) ?? ""
            segments[segments.count - 1] = seg
            return [.answer(segments)]
        case "reset":
            segments = []
            return [.answer([]), .reset]
        case "done":
            finished = true
            return []
        case "error":
            throw AskError.failed((data["message"] as? String) ?? "Ask hit a problem.")
        default:
            return []
        }
    }
}

/// The question field is multi-line only so long questions wrap: Return
/// asks, and pasted lines are joined into one question.
enum QuestionInput {
    /// What the field should hold after an edit from `old` to `new`, and
    /// whether the edit was the Return key (one newline typed, nothing else).
    static func apply(old: String, new: String, limit: Int) -> (text: String, submit: Bool) {
        guard new.contains(where: \.isNewline) else {
            return (new.count > limit ? String(new.prefix(limit)) : new, false)
        }
        if new.count == old.count + 1, let i = new.firstIndex(where: \.isNewline) {
            var rest = new
            rest.remove(at: i)
            if rest == old { return (old.count > limit ? String(old.prefix(limit)) : old, true) }
        }
        // Pasted text: each line break (and the spaces around it) becomes one
        // space, then the cap applies to the joined question.
        var joined = ""
        var pendingBreak = false
        for ch in new {
            if ch.isNewline {
                pendingBreak = true
                continue
            }
            if pendingBreak {
                if ch == " " || ch == "\t" { continue }
                while joined.last == " " || joined.last == "\t" { joined.removeLast() }
                if !joined.isEmpty { joined.append(" ") }
                pendingBreak = false
            }
            joined.append(ch)
        }
        if pendingBreak, !joined.isEmpty, joined.last != " " { joined.append(" ") }
        return (joined.count > limit ? String(joined.prefix(limit)) : joined, false)
    }
}

enum AskService {
    static let maxQuestionChars = 500

    /// The API only answers requests from the Gospel Help web origins; the
    /// app presents the production one. Quotas and the daily budget still
    /// apply per IP, as for any caller.
    static let origin = "https://gospel.help"

    /// Whether this user can ask right now, without using a question. Nil
    /// when the check fails; a refused question then explains itself.
    static func status() async -> (closed: AskClosed?, quota: AskQuota)? {
        var request = URLRequest(url: AppConfig.apiBase.appending(path: "ask/status"))
        request.cachePolicy = .reloadIgnoringLocalCacheData
        guard let (data, response) = try? await URLSession.shared.data(for: request),
              (response as? HTTPURLResponse)?.statusCode == 200,
              let body = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return nil }
        let quota = AskQuota(
            hourLeft: (body["hour_left"] as? Int) ?? 0, dayLeft: (body["day_left"] as? Int) ?? 0)
        let available = (body["available"] as? Bool) ?? true
        return (available ? nil : AskClosed(body: body), quota)
    }

    /// Ask one question; the stream ends when the answer is complete and
    /// throws an `AskError` otherwise.
    static func ask(_ question: String) -> AsyncThrowingStream<AskEvent, Error> {
        AsyncThrowingStream { continuation in
            let task = Task {
                do {
                    var request = URLRequest(url: AppConfig.apiBase.appending(path: "ask"))
                    request.httpMethod = "POST"
                    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
                    request.setValue("text/event-stream", forHTTPHeaderField: "Accept")
                    request.setValue(origin, forHTTPHeaderField: "Origin")
                    request.httpBody = try JSONSerialization.data(withJSONObject: ["question": question])
                    request.timeoutInterval = 120

                    let bytes: URLSession.AsyncBytes
                    let response: URLResponse
                    do {
                        (bytes, response) = try await URLSession.shared.bytes(for: request)
                    } catch {
                        if Task.isCancelled { throw CancellationError() }
                        throw AskError.failed(
                            NetworkMonitor.shared.isOnline
                                ? "Couldn’t reach Ask. Check your connection and try again."
                                : "You’re offline. Ask needs a connection.")
                    }

                    let status = (response as? HTTPURLResponse)?.statusCode ?? 0
                    guard status == 200 else {
                        var raw = Data()
                        for try await byte in bytes { raw.append(byte) }
                        let body = try? JSONSerialization.jsonObject(with: raw) as? [String: Any]
                        if let closed = AskClosed(body: body) { throw AskError.closed(closed) }
                        let detail = body?["detail"] as? String
                        throw AskError.failed(
                            detail?.isEmpty == false ? detail! : "Ask couldn’t answer right now. Try again later.")
                    }

                    var parser = AskEventParser()
                    // Split on "\n" bytes only. `bytes.lines` also breaks on
                    // U+2028/U+2029/U+0085, which JSON may carry unescaped
                    // inside answer text and would cut a `data:` line in two.
                    var line = Data()
                    for try await byte in bytes {
                        guard byte == 0x0A else {
                            line.append(byte)
                            continue
                        }
                        if line.last == 0x0D { line.removeLast() }
                        let text = String(decoding: line, as: UTF8.self)
                        line.removeAll(keepingCapacity: true)
                        for event in try parser.consume(line: text) {
                            continuation.yield(event)
                        }
                    }
                    if !line.isEmpty {
                        for event in try parser.consume(line: String(decoding: line, as: UTF8.self)) {
                            continuation.yield(event)
                        }
                    }
                    if !parser.finished {
                        throw AskError.failed("The answer was cut off. Try asking again.")
                    }
                    continuation.finish()
                } catch {
                    continuation.finish(throwing: error)
                }
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }
}
