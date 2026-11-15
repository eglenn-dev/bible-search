import Foundation

// Saved passages as Markdown (client/src/lib/markdown-export.ts): a heading,
// the text as a quote block, and an attribution line inside the quote.
enum MarkdownExport {
    private static func escapeInline(_ text: String) -> String {
        var out = ""
        for ch in text {
            if "\\`*_[]<>|".contains(ch) { out.append("\\") }
            out.append(ch)
        }
        return out
    }

    private static func escapeLine(_ line: String) -> String {
        let escaped = escapeInline(line)
        // Line starts Markdown reads as a heading, list item or rule.
        if let match = escaped.firstMatch(of: /^(\s*)([#+-]|\d+[.)])(?=\s|$)/) {
            return String(match.1) + "\\" + String(match.2) + escaped[match.range.upperBound...]
        }
        return escaped
    }

    private static func quote(_ text: String) -> String {
        text.trimmingCharacters(in: .whitespacesAndNewlines)
            .components(separatedBy: "\n")
            .map { line in
                let t = line.trimmingCharacters(in: .whitespaces)
                return t.isEmpty ? ">" : "> " + escapeLine(t)
            }
            .joined(separator: "\n")
    }

    private static func sourceLink(_ url: String) -> String {
        guard ShareCodec.isAllowedSourceURL(url), let host = URL(string: url)?.host() else { return "" }
        let label = host.hasPrefix("www.") ? String(host.dropFirst(4)) : host
        let target = url.replacingOccurrences(of: "(", with: "%28")
            .replacingOccurrences(of: ")", with: "%29")
            .replacingOccurrences(of: " ", with: "%20")
        return "[\(label)](\(target))"
    }

    static func passage(_ p: Passage) -> String {
        let heading = p.heading
        let attribution = [p.source.label, p.reference != heading ? p.reference : "", p.metaLine]
            .filter { !$0.isEmpty }
            .map(escapeInline)
            .joined(separator: " · ")
        let link = sourceLink(p.url)
        return [
            "## \(escapeInline(heading))",
            "",
            quote(p.text),
            ">",
            "> — \(attribution)" + (link.isEmpty ? "" : "  \n> \(link)"),
        ].joined(separator: "\n")
    }

    static func collection(_ passages: [Passage], title: String = "Saved passages", date: Date = .now) -> String {
        let count = "\(passages.count) \(passages.count == 1 ? "passage" : "passages")"
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US")
        formatter.dateFormat = "MMMM d, yyyy"
        let lines = ["# \(escapeInline(title))", "", "_\(count) · exported from Gospel Help on \(formatter.string(from: date))_"]
            + passages.flatMap { ["", "---", "", passage($0)] }
            + [""]
        return lines.joined(separator: "\n")
    }

    /// "gospel-help-saved-2026-10-14.md"
    static func filename(prefix: String = "gospel-help-saved", date: Date = .now) -> String {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM-dd"
        return "\(prefix)-\(f.string(from: date)).md"
    }

    /// Writes the export to a temporary file for the share sheet.
    static func file(_ passages: [Passage], title: String = "Saved passages") throws -> URL {
        let dir = FileManager.default.temporaryDirectory.appending(path: "exports", directoryHint: .isDirectory)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let url = dir.appending(path: filename())
        try collection(passages, title: title).write(to: url, atomically: true, encoding: .utf8)
        return url
    }
}
