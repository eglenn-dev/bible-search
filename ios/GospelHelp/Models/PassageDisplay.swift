import Foundation

// How a passage is titled and captioned. Mirrors client/src/lib/result-display.ts
// and result-date.ts so the app and the web never disagree.

private let conferenceMonths = ["04": "April", "10": "October"]

extension Passage {
    /// The card heading: the reference for scripture, the talk title for
    /// talks, the section title for the handbook.
    var heading: String {
        if source.isScripture { return reference }
        if source.isAttributed { return nonEmpty(title) ?? reference }
        return nonEmpty(meta("section_title")) ?? nonEmpty(title) ?? reference
    }

    private var subtitle: String {
        switch source {
        case .conference, .byuSpeeches:
            return meta("speaker") ?? ""
        case .handbook:
            return [meta("chapter"), meta("section_number")]
                .compactMap { nonEmpty($0) }
                .joined(separator: " · ")
        default:
            // "Book of Mormon / Book of Mormon" says nothing new.
            let volume = nonEmpty(meta("volume")).flatMap {
                [source.label, source.longLabel].contains($0.replacingOccurrences(of: " and ", with: " & ")) || $0 == source.label ? nil : $0
            }
            return volume ?? meta("translation") ?? ""
        }
    }

    /// "April 2024", "January 31, 2017", or "" for undated sources.
    var dateLabel: String {
        switch source {
        case .conference:
            if let year = metaInt("year") {
                if let month = meta("month") {
                    return "\(conferenceMonths[month] ?? month) \(year)"
                }
                return String(year)
            }
            return ""
        case .byuSpeeches:
            return nonEmpty(meta("date")) ?? metaInt("year").map(String.init) ?? ""
        default:
            return ""
        }
    }

    /// "Speaker · April 2024", "KJV", … — empty when there's nothing to add.
    var metaLine: String {
        [subtitle, dateLabel].filter { !$0.isEmpty }.joined(separator: " · ")
    }

    /// "Bible / KJV" style eyebrow.
    var eyebrow: String {
        metaLine.isEmpty ? source.label : "\(source.label) / \(metaLine)"
    }

    /// Relevance as a whole percentage, clamped to 0–100.
    var scorePercent: Int { Int((max(0, min(1, score)) * 100).rounded()) }

    var contextLabel: String {
        source.isScripture ? "Read surrounding verses" : "Show context"
    }

    /// Sortable date for "newest first"; nil for undated sources.
    var dateKey: Date? {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC")!
        if source == .conference, let year = metaInt("year") {
            let month = meta("month").flatMap(Int.init) ?? 1
            return calendar.date(from: DateComponents(year: year, month: month, day: 1))
        }
        if source == .byuSpeeches {
            if let raw = meta("date"), let parsed = Passage.byuDateFormatter.date(from: raw) {
                return parsed
            }
            if let year = metaInt("year") {
                return calendar.date(from: DateComponents(year: year, month: 1, day: 1))
            }
        }
        return nil
    }

    private static let byuDateFormatter: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = TimeZone(identifier: "UTC")
        f.dateFormat = "MMMM d, yyyy"
        return f
    }()

    /// What gets shared for one passage.
    var shareText: String { "“\(text)”\n— \(heading)" }
}

private func nonEmpty(_ s: String?) -> String? {
    guard let s, !s.isEmpty else { return nil }
    return s
}

/// "relevance" keeps the server's order; "date" puts dated passages newest
/// first and leaves undated ones, in relevance order, at the end.
func sortPassages(_ passages: [Passage], by key: SortKey) -> [Passage] {
    guard key == .date else { return passages }
    let keyed = passages.enumerated().map { ($0.offset, $0.element, $0.element.dateKey) }
    return keyed.sorted { a, b in
        switch (a.2, b.2) {
        case let (da?, db?): da != db ? da > db : a.0 < b.0
        case (nil, nil): a.0 < b.0
        case (nil, _): false
        case (_, nil): true
        }
    }.map(\.1)
}
