import Foundation

/// The seven corpora the API searches.
enum Source: String, Codable, CaseIterable, Identifiable, Sendable {
    case bible
    case bookOfMormon = "book-of-mormon"
    case doctrineAndCovenants = "doctrine-and-covenants"
    case pearlOfGreatPrice = "pearl-of-great-price"
    case conference
    case byuSpeeches = "byu-speeches"
    case handbook

    var id: String { rawValue }

    /// Short label used on cards and filter chips (matches the web app).
    var label: String {
        switch self {
        case .bible: "Bible"
        case .bookOfMormon: "Book of Mormon"
        case .doctrineAndCovenants: "D&C"
        case .pearlOfGreatPrice: "Pearl of Great Price"
        case .conference: "Conference"
        case .byuSpeeches: "BYU Speeches"
        case .handbook: "Handbook"
        }
    }

    /// Longer label for the reference preview.
    var longLabel: String {
        self == .doctrineAndCovenants ? "Doctrine & Covenants" : label
    }

    var isScripture: Bool {
        switch self {
        case .bible, .bookOfMormon, .doctrineAndCovenants, .pearlOfGreatPrice: true
        default: false
        }
    }

    /// Only these carry a speaker and a year.
    var isAttributed: Bool { self == .conference || self == .byuSpeeches }

    var symbol: String {
        switch self {
        case .bible, .bookOfMormon, .doctrineAndCovenants, .pearlOfGreatPrice: "book.closed"
        case .conference: "person.wave.2"
        case .byuSpeeches: "building.columns"
        case .handbook: "text.book.closed"
        }
    }
}

/// Any JSON value. Result metadata differs per source, and bookmarks keep it
/// whole, so it round-trips without a fixed schema.
enum JSONValue: Codable, Hashable, Sendable {
    case string(String)
    case number(Double)
    case bool(Bool)
    case object([String: JSONValue])
    case array([JSONValue])
    case null

    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() { self = .null }
        else if let b = try? c.decode(Bool.self) { self = .bool(b) }
        else if let n = try? c.decode(Double.self) { self = .number(n) }
        else if let s = try? c.decode(String.self) { self = .string(s) }
        else if let a = try? c.decode([JSONValue].self) { self = .array(a) }
        else { self = .object(try c.decode([String: JSONValue].self)) }
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case .string(let s): try c.encode(s)
        case .number(let n):
            if let i = Int64(exactly: n), abs(i) < 1_000_000_000_000_000 { try c.encode(i) } else { try c.encode(n) }
        case .bool(let b): try c.encode(b)
        case .object(let o): try c.encode(o)
        case .array(let a): try c.encode(a)
        case .null: try c.encodeNil()
        }
    }

    var string: String? {
        switch self {
        case .string(let s): s
        case .number(let n): Int(exactly: n).map(String.init) ?? String(n)
        default: nil
        }
    }

    var int: Int? {
        switch self {
        case .number(let n): n.isFinite ? Int(exactly: n.rounded()) : nil
        case .string(let s): Int(s)
        default: nil
        }
    }
}

/// One passage, as /search returns it.
struct Passage: Codable, Hashable, Sendable, Identifiable {
    /// Stable API document id. Absent on bookmarks saved (on the web) before
    /// the API returned one.
    var apiID: String?
    var source: Source
    var reference: String
    var text: String
    var title: String?
    var url: String
    var score: Double
    var metadata: [String: JSONValue]

    enum CodingKeys: String, CodingKey {
        case apiID = "id", source, reference, text, title, url, score, metadata
    }

    init(
        apiID: String?, source: Source, reference: String, text: String,
        title: String?, url: String, score: Double = 0, metadata: [String: JSONValue] = [:]
    ) {
        self.apiID = apiID
        self.source = source
        self.reference = reference
        self.text = text
        self.title = title
        self.url = url
        self.score = score
        self.metadata = metadata
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        apiID = try c.decodeIfPresent(String.self, forKey: .apiID)
        source = try c.decode(Source.self, forKey: .source)
        reference = try c.decode(String.self, forKey: .reference)
        text = try c.decode(String.self, forKey: .text)
        title = try c.decodeIfPresent(String.self, forKey: .title)
        url = try c.decode(String.self, forKey: .url)
        score = (try? c.decodeIfPresent(Double.self, forKey: .score)) ?? 0
        metadata = (try? c.decodeIfPresent([String: JSONValue].self, forKey: .metadata)) ?? [:]
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encodeIfPresent(apiID, forKey: .apiID)
        try c.encode(source, forKey: .source)
        try c.encode(reference, forKey: .reference)
        try c.encode(text, forKey: .text)
        try c.encode(title, forKey: .title)
        try c.encode(url, forKey: .url)
        try c.encode(score, forKey: .score)
        try c.encode(metadata, forKey: .metadata)
    }

    /// Identity used everywhere: the API id, else the pre-id key.
    var id: String { apiID ?? legacyKey }

    /// The web app's pre-id bookmark key: source, url and a hash of the text
    /// (BYU passages all link to the talk, so the URL alone isn't enough).
    var legacyKey: String { "\(source.rawValue):\(url):\(Passage.djb2(text))" }

    /// Every key a saved copy of this passage could be stored under.
    var keys: [String] { apiID.map { [$0, legacyKey] } ?? [legacyKey] }

    func meta(_ key: String) -> String? { metadata[key]?.string }
    func metaInt(_ key: String) -> Int? { metadata[key]?.int }

    /// Same hash as the web's bookmarks.ts, over UTF-16 code units, base 36.
    static func djb2(_ text: String) -> String {
        var h: UInt32 = 5381
        for unit in text.utf16 {
            h = ((h &<< 5) &+ h) ^ UInt32(unit)
        }
        return String(h, radix: 36)
    }

    var sourceURL: URL? { URL(string: url) }

    /// Text cut short to fit a shared link: not the passage as it is, so it
    /// must never be saved as one. Only set in memory, never sent or stored.
    var isExcerpt: Bool { metadata[Passage.excerptKey] == .bool(true) }
    static let excerptKey = "_excerpt"
}

struct SearchResponse: Decodable, Sendable {
    var results: [Passage]
}

struct SimilarResponse: Decodable, Sendable {
    var seed: Passage
    var results: [Passage]
}

struct ContextPassage: Decodable, Hashable, Sendable, Identifiable {
    var id: String
    var text: String
    var isTarget: Bool
    var metadata: [String: JSONValue]

    enum CodingKeys: String, CodingKey { case id, text, isTarget = "is_target", metadata }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        text = try c.decode(String.self, forKey: .text)
        isTarget = (try? c.decode(Bool.self, forKey: .isTarget)) ?? false
        metadata = (try? c.decodeIfPresent([String: JSONValue].self, forKey: .metadata)) ?? [:]
    }

    init(id: String, text: String, isTarget: Bool, metadata: [String: JSONValue]) {
        self.id = id
        self.text = text
        self.isTarget = isTarget
        self.metadata = metadata
    }
}

struct PassageContext: Decodable, Sendable {
    var id: String
    var passages: [ContextPassage]
    var moreBefore: Bool
    var moreAfter: Bool
    var note: String?

    enum CodingKeys: String, CodingKey {
        case id, passages, moreBefore = "more_before", moreAfter = "more_after", note
    }
}

struct Verse: Decodable, Sendable {
    var source: Source?
    var reference: String
    var text: String
}

struct SpeakerOption: Decodable, Hashable, Sendable, Identifiable {
    var name: String
    var talks: Int
    var firstYear: Int?
    var lastYear: Int?

    var id: String { name }

    enum CodingKeys: String, CodingKey {
        case name, talks, firstYear = "first_year", lastYear = "last_year"
    }

    /// "1974–2025" (or one year).
    var yearSpan: String {
        guard let first = firstYear else { return "" }
        guard let last = lastYear, last != first else { return String(first) }
        return "\(first)–\(last)"
    }
}

struct SpeakersResponse: Decodable, Sendable {
    var speakers: [SpeakerOption]
}

enum QueryType: String, Codable, CaseIterable, Sendable {
    case natural, scripture
}

enum SortKey: String, Codable, CaseIterable, Sendable {
    case relevance, date

    var label: String { self == .relevance ? "Relevance" : "Newest first" }
}

/// How many results to request (the API caps k at 50).
let resultCounts = [10, 20, 30, 40, 50]
let defaultResultCount = 20

/// The earliest dated talk in the corpus; bounds the year pickers.
let firstYear = 1937

/// Speaker and year range. They only match Conference and BYU Speeches.
struct SearchFilters: Codable, Hashable, Sendable {
    var speaker: String?
    var yearFrom: Int?
    var yearTo: Int?

    static let none = SearchFilters()

    var isActive: Bool { speaker != nil || yearFrom != nil || yearTo != nil }

    /// "2010–2020", "2010 or later", "Up to 2020", or nil when unbounded.
    var yearLabel: String? {
        switch (yearFrom, yearTo) {
        case let (from?, to?): from == to ? String(from) : "\(from)–\(to)"
        case let (from?, nil): "\(from) or later"
        case let (nil, to?): "Up to \(to)"
        default: nil
        }
    }
}
