import Foundation

// The precomputed /stats payload (api/ingest/stats.py → GET /stats), mirroring
// client/src/lib/stats.ts. Decoding is deliberately lenient: every field is
// optional or defaulted and arrays drop elements they can't read, so one
// renamed or retyped field hides a figure instead of breaking the page.

struct StatsPayload: Decodable, Sendable {
    var generatedAt: String?
    var data: StatsData

    private enum CodingKeys: String, CodingKey {
        case generatedAt = "generated_at"
        case data
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        generatedAt = c.lenient(String.self, .generatedAt)
        data = try c.decode(StatsData.self, forKey: .data)
    }

    /// Decodes off the main actor. Object key order is significant for a few
    /// maps (word trends are curated, fingerprints run in apostolic seniority),
    /// and JSONDecoder drops it, so a quick scan recovers it first.
    @concurrent
    static func decode(_ raw: Data) async throws -> StatsPayload {
        let decoder = JSONDecoder()
        decoder.userInfo[.statsKeyOrder] = JSONKeyOrder(raw)
        return try decoder.decode(StatsPayload.self, from: raw)
    }

    /// "October 14, 2026" from the ISO timestamp (which carries microseconds).
    var updatedText: String? {
        guard let generatedAt else { return nil }
        let plain = ISO8601DateFormatter()
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let trimmed = generatedAt.replacingOccurrences(of: #"\.\d+"#, with: "", options: .regularExpression)
        let date = fractional.date(from: generatedAt) ?? plain.date(from: generatedAt) ?? plain.date(from: trimmed)
        return date?.formatted(date: .long, time: .omitted)
    }
}

struct StatsData: Decodable, Sendable {
    var proceduralTalks: Int?
    var meta: StatsMeta?
    var prolific: [SpeakerAgg]
    var longestSpan: [SpeakerAgg]
    var wordiest: [SpeakerAgg]
    var mostConcise: [SpeakerAgg]
    var talkLengthByYear: OrderedMap<Double>
    var longestTalks: [TalkRef]
    var shortestTalks: [TalkRef]
    var wordTrends: OrderedMap<OrderedMap<Double>>
    var fingerprints: OrderedMap<[FingerprintWord]>
    var readabilityByYear: OrderedMap<Readability>
    var shortestVerses: [VerseExtreme]
    var longestVerses: [VerseExtreme]
    var cameToPass: CameToPass?
    var biggestChapters: [BigChapter]
    var mostTypical: [TalkRef]
    var mostUnusual: [TalkRef]
    var twins: [TwinPair]
    var twinsCrossEra: [TwinPair]
    var clusters: [TalkCluster]
    var clusterDecadeTotals: OrderedMap<Double>
    var verseEchoStrong: [EchoedVerse]
    var verseEchoThreshold: Double?

    private enum CodingKeys: String, CodingKey {
        case proceduralTalks = "procedural_talks"
        case meta, prolific
        case longestSpan = "longest_span"
        case wordiest
        case mostConcise = "most_concise"
        case talkLengthByYear = "talk_length_by_year"
        case longestTalks = "longest_talks"
        case shortestTalks = "shortest_talks"
        case wordTrends = "word_trends"
        case fingerprints
        case readabilityByYear = "readability_by_year"
        case shortestVerses = "shortest_verses"
        case longestVerses = "longest_verses"
        case cameToPass = "came_to_pass"
        case biggestChapters = "biggest_chapters"
        case mostTypical = "most_typical"
        case mostUnusual = "most_unusual"
        case twins
        case twinsCrossEra = "twins_cross_era"
        case clusters
        case clusterDecadeTotals = "cluster_decade_totals"
        case verseEchoStrong = "verse_echo_strong"
        case verseEchoThreshold = "verse_echo_threshold"
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        proceduralTalks = c.int(.proceduralTalks)
        meta = c.lenient(StatsMeta.self, .meta)
        prolific = c.list(.prolific)
        longestSpan = c.list(.longestSpan)
        wordiest = c.list(.wordiest)
        mostConcise = c.list(.mostConcise)
        talkLengthByYear = c.map(.talkLengthByYear)
        longestTalks = c.list(.longestTalks)
        shortestTalks = c.list(.shortestTalks)
        wordTrends = c.map(.wordTrends)
        fingerprints = c.map(.fingerprints)
        readabilityByYear = c.map(.readabilityByYear)
        shortestVerses = c.list(.shortestVerses)
        longestVerses = c.list(.longestVerses)
        cameToPass = c.lenient(CameToPass.self, .cameToPass)
        biggestChapters = c.list(.biggestChapters)
        mostTypical = c.list(.mostTypical)
        mostUnusual = c.list(.mostUnusual)
        twins = c.list(.twins)
        twinsCrossEra = c.list(.twinsCrossEra)
        clusters = c.list(.clusters)
        clusterDecadeTotals = c.map(.clusterDecadeTotals)
        verseEchoStrong = c.list(.verseEchoStrong)
        verseEchoThreshold = c.number(.verseEchoThreshold)
    }
}

struct StatsMeta: Decodable, Sendable {
    var totalDocs: Int?
    var sources: [String: Int]
    var talks: Int?
    var speeches: Int?
    var conferenceSpeakers: Int?
    var byuSpeakers: Int?
    var conferenceYears: [Int]
    var totalWords: Int?

    private enum CodingKeys: String, CodingKey {
        case totalDocs = "total_docs"
        case sources, talks, speeches
        case conferenceSpeakers = "conference_speakers"
        case byuSpeakers = "byu_speakers"
        case conferenceYears = "conference_years"
        case totalWords = "total_words"
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        totalDocs = c.int(.totalDocs)
        sources = c.lenient([String: Int].self, .sources) ?? [:]
        talks = c.int(.talks)
        speeches = c.int(.speeches)
        conferenceSpeakers = c.int(.conferenceSpeakers)
        byuSpeakers = c.int(.byuSpeakers)
        conferenceYears = c.lenient([Int].self, .conferenceYears) ?? []
        totalWords = c.int(.totalWords)
    }

    var firstYear: Int? { conferenceYears.first }
    var lastYear: Int? { conferenceYears.count > 1 ? conferenceYears[1] : nil }

    /// Verses of scripture across the four standard works.
    var verses: Int? {
        let keys = ["bible", "book_of_mormon", "doctrine_and_covenants", "pearl_of_great_price"]
        let parts = keys.compactMap { sources[$0] }
        return parts.isEmpty ? nil : parts.reduce(0, +)
    }
}

struct SpeakerAgg: Decodable, Sendable, Identifiable {
    var speaker: String
    var talks: Int
    var first: Int
    var last: Int
    var span: Int
    var avgWords: Double

    var id: String { speaker }

    private enum CodingKeys: String, CodingKey {
        case speaker, talks, first, last, span
        case avgWords = "avg_words"
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        speaker = try c.decode(String.self, forKey: .speaker)
        talks = c.int(.talks) ?? 0
        first = c.int(.first) ?? 0
        last = c.int(.last) ?? 0
        span = c.int(.span) ?? max(0, last - first)
        avgWords = c.number(.avgWords) ?? 0
    }
}

struct TalkRef: Decodable, Sendable, Hashable {
    var title: String
    var speaker: String
    var year: Int?
    var url: URL?
    var words: Int?
    var sim: Double?

    private enum CodingKeys: String, CodingKey { case title, speaker, year, url, words, sim }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        title = try c.decode(String.self, forKey: .title)
        speaker = c.lenient(String.self, .speaker) ?? ""
        year = c.int(.year)
        url = c.lenient(String.self, .url).flatMap(URL.init(string:))
        words = c.int(.words)
        sim = c.number(.sim)
    }

    /// "Gordon B. Hinckley, 1999"
    var byline: String {
        [speaker.isEmpty ? nil : speaker, year.map(String.init)].compactMap(\.self).joined(separator: ", ")
    }
}

struct TwinPair: Decodable, Sendable, Hashable {
    var sim: Double
    var a: TalkRef
    var b: TalkRef

    private enum CodingKeys: String, CodingKey { case sim, a, b }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        sim = c.number(.sim) ?? 0
        a = try c.decode(TalkRef.self, forKey: .a)
        b = try c.decode(TalkRef.self, forKey: .b)
    }
}

struct TalkCluster: Decodable, Sendable {
    var size: Int
    var topWords: [String]
    var byDecade: OrderedMap<Double>
    var examples: [TalkRef]

    private enum CodingKeys: String, CodingKey {
        case size
        case topWords = "top_words"
        case byDecade = "by_decade"
        case examples
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        size = c.int(.size) ?? 0
        topWords = c.lenient([String].self, .topWords) ?? []
        byDecade = c.map(.byDecade)
        examples = c.list(.examples)
    }
}

struct EchoedVerse: Decodable, Sendable {
    var ref: String
    var count: Int
    var text: String
    var volume: String

    private enum CodingKeys: String, CodingKey { case ref, count, text, volume }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        ref = try c.decode(String.self, forKey: .ref)
        count = c.int(.count) ?? 0
        text = c.lenient(String.self, .text) ?? ""
        volume = c.lenient(String.self, .volume) ?? ""
    }
}

struct VerseExtreme: Decodable, Sendable {
    var ref: String
    var text: String
    var words: Int

    private enum CodingKeys: String, CodingKey { case ref, text, words }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        ref = try c.decode(String.self, forKey: .ref)
        text = c.lenient(String.self, .text) ?? ""
        words = c.int(.words) ?? 0
    }
}

struct FingerprintWord: Decodable, Sendable {
    var word: String
    var lift: Double

    private enum CodingKeys: String, CodingKey { case word, lift }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        word = try c.decode(String.self, forKey: .word)
        lift = c.number(.lift) ?? 0
    }
}

struct Readability: Decodable, Sendable {
    var avgSentenceLen: Double?
    var flesch: Double?

    private enum CodingKeys: String, CodingKey {
        case avgSentenceLen = "avg_sentence_len"
        case flesch
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        avgSentenceLen = c.number(.avgSentenceLen)
        flesch = c.number(.flesch)
    }
}

struct CameToPass: Decodable, Sendable {
    var byVolume: OrderedMap<Double>
    var bomByBook: OrderedMap<Double>

    private enum CodingKeys: String, CodingKey {
        case byVolume = "by_volume"
        case bomByBook = "bom_by_book"
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        byVolume = c.map(.byVolume)
        bomByBook = c.map(.bomByBook)
    }
}

struct BigChapter: Decodable, Sendable {
    var chapter: String
    var verses: Int

    private enum CodingKeys: String, CodingKey { case chapter, verses }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        chapter = try c.decode(String.self, forKey: .chapter)
        verses = c.int(.verses) ?? 0
    }
}

// MARK: - Lenient decoding helpers

extension KeyedDecodingContainer {
    func lenient<T: Decodable>(_ type: T.Type, _ key: Key) -> T? {
        (try? decodeIfPresent(T.self, forKey: key)) ?? nil
    }

    /// A number that may arrive as an integer or a float.
    func number(_ key: Key) -> Double? {
        lenient(Double.self, key)
    }

    func int(_ key: Key) -> Int? {
        lenient(Int.self, key) ?? number(key).map { Int($0.rounded()) }
    }

    /// An array, keeping every element that decodes.
    func list<T: Decodable>(_ key: Key) -> [T] {
        lenient(LossyList<T>.self, key)?.items ?? []
    }

    func map<V: Decodable & Sendable>(_ key: Key) -> OrderedMap<V> {
        lenient(OrderedMap<V>.self, key) ?? OrderedMap()
    }
}

struct LossyList<T: Decodable>: Decodable {
    var items: [T] = []

    private struct Skip: Decodable {
        init(from decoder: Decoder) throws {}
    }

    init(from decoder: Decoder) throws {
        var c = try decoder.unkeyedContainer()
        while !c.isAtEnd {
            if let item = try? c.decode(T.self) {
                items.append(item)
            } else if (try? c.decode(Skip.self)) == nil {
                break
            }
        }
    }
}

/// A JSON object whose entries keep the order they had on the wire.
struct OrderedMap<V: Decodable & Sendable>: Decodable, Sendable {
    struct Entry: Sendable {
        var key: String
        var value: V
    }

    var entries: [Entry] = []

    init() {}

    var isEmpty: Bool { entries.isEmpty }
    var count: Int { entries.count }
    subscript(key: String) -> V? { entries.first { $0.key == key }?.value }

    private struct AnyKey: CodingKey {
        var stringValue: String
        var intValue: Int? { nil }
        init(stringValue: String) { self.stringValue = stringValue }
        init?(intValue: Int) { nil }
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: AnyKey.self)
        var values: [String: V] = [:]
        for key in c.allKeys {
            if let v = try? c.decode(V.self, forKey: key) { values[key.stringValue] = v }
        }
        let path = JSONKeyOrder.path(decoder.codingPath)
        let wire = (decoder.userInfo[.statsKeyOrder] as? JSONKeyOrder)?.keys[path] ?? []
        var ordered = wire.filter { values[$0] != nil }
        let seen = Set(ordered)
        // Anything the scan missed goes last, numerically when the keys are years.
        ordered += values.keys.filter { !seen.contains($0) }.sorted {
            if let a = Double($0), let b = Double($1) { return a < b }
            return $0 < $1
        }
        entries = ordered.map { Entry(key: $0, value: values[$0]!) }
    }
}

extension CodingUserInfoKey {
    static let statsKeyOrder = CodingUserInfoKey(rawValue: "statsKeyOrder")!
}

/// The key order of every JSON object in a document, by path ("/data/word_trends").
struct JSONKeyOrder: Sendable {
    private(set) var keys: [String: [String]] = [:]

    static func path(_ codingPath: [any CodingKey]) -> String {
        codingPath.map { "/" + ($0.intValue.map(String.init) ?? $0.stringValue) }.joined()
    }

    init(_ data: Data) {
        let bytes = [UInt8](data)
        var i = 0
        scanValue(bytes, &i, path: "", depth: 0)
    }

    private mutating func scanValue(_ b: [UInt8], _ i: inout Int, path: String, depth: Int) {
        skipSpace(b, &i)
        guard i < b.count, depth < 64 else { return }
        switch b[i] {
        case UInt8(ascii: "{"):
            i += 1
            var found: [String] = []
            while true {
                skipSpace(b, &i)
                guard i < b.count, b[i] == UInt8(ascii: "\"") else { break }
                guard let key = readString(b, &i) else { return }
                found.append(key)
                skipSpace(b, &i)
                guard i < b.count, b[i] == UInt8(ascii: ":") else { return }
                i += 1
                scanValue(b, &i, path: path + "/" + key, depth: depth + 1)
                skipSpace(b, &i)
                if i < b.count, b[i] == UInt8(ascii: ",") { i += 1 } else { break }
            }
            if i < b.count, b[i] == UInt8(ascii: "}") { i += 1 }
            keys[path] = found
        case UInt8(ascii: "["):
            i += 1
            var index = 0
            while true {
                skipSpace(b, &i)
                guard i < b.count, b[i] != UInt8(ascii: "]") else { break }
                let before = i
                scanValue(b, &i, path: path + "/" + String(index), depth: depth + 1)
                if i == before { return }
                index += 1
                skipSpace(b, &i)
                if i < b.count, b[i] == UInt8(ascii: ",") { i += 1 } else { break }
            }
            if i < b.count, b[i] == UInt8(ascii: "]") { i += 1 }
        case UInt8(ascii: "\""):
            _ = readString(b, &i)
        default:
            // Number, true, false, null.
            while i < b.count, !",}] \n\r\t".utf8.contains(b[i]) { i += 1 }
        }
    }

    private func skipSpace(_ b: [UInt8], _ i: inout Int) {
        while i < b.count, b[i] == 0x20 || b[i] == 0x0A || b[i] == 0x0D || b[i] == 0x09 { i += 1 }
    }

    /// Reads a JSON string starting at its opening quote.
    private func readString(_ b: [UInt8], _ i: inout Int) -> String? {
        i += 1
        var out: [UInt8] = []
        while i < b.count {
            let ch = b[i]
            if ch == UInt8(ascii: "\"") {
                i += 1
                return String(decoding: out, as: UTF8.self)
            }
            if ch == UInt8(ascii: "\\"), i + 1 < b.count {
                let esc = b[i + 1]
                i += 2
                switch esc {
                case UInt8(ascii: "n"): out.append(0x0A)
                case UInt8(ascii: "t"): out.append(0x09)
                case UInt8(ascii: "r"): out.append(0x0D)
                case UInt8(ascii: "b"): out.append(0x08)
                case UInt8(ascii: "f"): out.append(0x0C)
                case UInt8(ascii: "u"):
                    guard var unit = hex4(b, i) else { return nil }
                    i += 4
                    // Surrogate pair.
                    if (0xD800..<0xDC00).contains(unit), i + 5 < b.count, b[i] == UInt8(ascii: "\\"),
                       b[i + 1] == UInt8(ascii: "u"), let low = hex4(b, i + 2), (0xDC00..<0xE000).contains(low) {
                        unit = 0x10000 + ((unit - 0xD800) << 10) + (low - 0xDC00)
                        i += 6
                    }
                    out.append(contentsOf: String(Unicode.Scalar(unit).map(Character.init) ?? "\u{FFFD}").utf8)
                default: out.append(esc)
                }
                continue
            }
            out.append(ch)
            i += 1
        }
        return nil
    }

    private func hex4(_ b: [UInt8], _ i: Int) -> UInt32? {
        guard i + 4 <= b.count, let s = String(bytes: b[i..<i + 4], encoding: .ascii) else { return nil }
        return UInt32(s, radix: 16)
    }
}
