import SwiftUI

/// An Ask answer: each run of text followed by its citation numbers. Each
/// number is a link that opens its passage.
struct AnswerText: View {
    var segments: [AskSegment]
    var citations: [Int: Passage]
    var running = false
    var size: CGFloat = 18
    var onCite: (Int, Passage) -> Void

    var body: some View {
        Text(attributed)
            .font(.reading(size))
            .lineSpacing(5)
            .textSelection(.enabled)
            .fixedSize(horizontal: false, vertical: true)
            .environment(\.openURL, OpenURLAction { url in
                guard url.scheme == "ghcite", let n = Int(url.host() ?? ""), let passage = citations[n] else {
                    return .discarded
                }
                onCite(n, passage)
                return .handled
            })
            .accessibilityHint(citations.isEmpty ? "" : "Citation numbers open their sources.")
    }

    private var attributed: AttributedString {
        var out = AttributedString()
        for (i, segment) in segments.enumerated() {
            out += AttributedString(i == 0 ? String(segment.text.drop(while: \.isWhitespace)) : segment.text)
            for n in segment.cites {
                var spacer = AttributedString("\u{2009}")
                spacer.font = .system(size: size * 0.6)
                out += spacer
                var mark = AttributedString(AnswerText.circled(n))
                mark.font = .system(size: size * 1.02, weight: .regular)
                mark.foregroundColor = citations[n] == nil ? .secondary : .brand
                if citations[n] != nil { mark.link = URL(string: "ghcite://\(n)") }
                out += mark
            }
        }
        if running {
            var caret = AttributedString(" ▍")
            caret.foregroundColor = .brand
            out += caret
        }
        return out
    }

    /// ❶ … ⓴ (filled circled numbers), then ㉑ … ㊿ (outlined), then [n].
    nonisolated static func circled(_ n: Int) -> String {
        let scalar: UInt32? = switch n {
        case 1...10: 0x2776 + UInt32(n - 1)
        case 11...20: 0x24EB + UInt32(n - 11)
        case 21...35: 0x3251 + UInt32(n - 21)
        case 36...50: 0x32B1 + UInt32(n - 36)
        default: nil
        }
        return scalar.flatMap(Unicode.Scalar.init).map { String(Character($0)) } ?? "[\(n)]"
    }
}
