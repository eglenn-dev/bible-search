import SwiftUI

// Design tokens, from the web app's theme (client/src/index.css): the
// Church's teal for links and actions, ink on white, a serif for scripture
// and talk text. New York (the system serif) stands in for Source Serif.

extension Color {
    /// #157493 light, #49b8dc dark (the asset's AccentColor).
    static let brand = Color("AccentColor")

    static let cardFill = Color(light: .init(white: 1, alpha: 0.86), dark: .init(red: 38 / 255, green: 40 / 255, blue: 43 / 255, alpha: 0.86))
    static let cardStroke = Color(light: .init(red: 224 / 255, green: 226 / 255, blue: 226 / 255, alpha: 0.75), dark: .init(white: 1, alpha: 0.1))
    static let washA = Color(light: .init(red: 21 / 255, green: 116 / 255, blue: 147 / 255, alpha: 0.17), dark: .init(red: 73 / 255, green: 184 / 255, blue: 220 / 255, alpha: 0.16))
    static let washB = Color(light: .init(red: 125 / 255, green: 227 / 255, blue: 244 / 255, alpha: 0.26), dark: .init(red: 21 / 255, green: 116 / 255, blue: 147 / 255, alpha: 0.2))
    /// Text and icons on a brand-filled button: white on the dark teal,
    /// ink on the light teal of dark mode (as the web's --primary-foreground).
    static let onBrand = Color(light: .white, dark: .init(red: 23 / 255, green: 24 / 255, blue: 26 / 255, alpha: 1))
    static let pageBackground = Color(light: .white, dark: .init(red: 23 / 255, green: 24 / 255, blue: 26 / 255, alpha: 1))
    static let destructiveText = Color(light: .init(red: 176 / 255, green: 5 / 255, blue: 4 / 255, alpha: 1), dark: .init(red: 252 / 255, green: 116 / 255, blue: 115 / 255, alpha: 1))

    init(light: UIColor, dark: UIColor) {
        self.init(uiColor: UIColor { $0.userInterfaceStyle == .dark ? dark : light })
    }
}

extension Font {
    /// Passage and answer text.
    static func reading(_ size: CGFloat, relativeTo style: Font.TextStyle = .body) -> Font {
        .system(size: size, design: .serif).leading(.loose)
    }

    static func display(_ style: Font.TextStyle, weight: Font.Weight = .semibold) -> Font {
        .system(style, design: .serif, weight: weight)
    }
}

/// The soft teal wash behind every screen, so the glass has colour to pick up.
struct AppWash: View {
    var body: some View {
        ZStack {
            Color.pageBackground
            RadialGradient(colors: [.washB, .clear], center: .topLeading, startRadius: 0, endRadius: 520)
            RadialGradient(colors: [.washA, .clear], center: .topTrailing, startRadius: 0, endRadius: 600)
            RadialGradient(colors: [.washA.opacity(0.6), .clear], center: .bottomLeading, startRadius: 0, endRadius: 700)
        }
        .ignoresSafeArea()
    }
}

/// Content cards. Glass is for controls; reading surfaces stay solid.
struct CardBackground: ViewModifier {
    var selected = false
    var radius: CGFloat = 22

    func body(content: Content) -> some View {
        content
            .background(Color.cardFill, in: .rect(cornerRadius: radius, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: radius, style: .continuous)
                    .strokeBorder(selected ? Color.brand.opacity(0.7) : Color.cardStroke, lineWidth: selected ? 1.5 : 0.75)
            }
            .shadow(color: Color(red: 16 / 255, green: 60 / 255, blue: 78 / 255).opacity(0.06), radius: 3, y: 1)
    }
}

extension View {
    func card(selected: Bool = false, radius: CGFloat = 22) -> some View {
        modifier(CardBackground(selected: selected, radius: radius))
    }
}

/// "Recent searches" / "Sources" section heading with an optional action.
struct SectionHeader<Trailing: View>: View {
    var title: String
    @ViewBuilder var trailing: Trailing

    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            Text(title)
                .font(.title3.weight(.semibold))
                .accessibilityAddTraits(.isHeader)
            Spacer()
            trailing
        }
        .padding(.horizontal, 4)
        .padding(.bottom, 2)
    }
}

extension SectionHeader where Trailing == EmptyView {
    init(title: String) {
        self.title = title
        self.trailing = EmptyView()
    }
}

/// A notice card: icon, bold lead-in, explanation.
struct NoticeCard<Footer: View>: View {
    var symbol: String
    var title: String
    var message: String
    @ViewBuilder var footer: Footer

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline, spacing: 12) {
                Image(systemName: symbol)
                    .foregroundStyle(Color.brand)
                    .font(.body.weight(.semibold))
                    .frame(width: 22)
                Text("\(Text(title).fontWeight(.semibold).foregroundStyle(.primary)) \(Text(message).foregroundStyle(.secondary))")
                    .font(.subheadline)
                    .fixedSize(horizontal: false, vertical: true)
            }
            footer
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .card()
    }
}

extension NoticeCard where Footer == EmptyView {
    init(symbol: String, title: String, message: String) {
        self.init(symbol: symbol, title: title, message: message) { EmptyView() }
    }
}

/// A small numbered badge (Ask citations).
struct CitationBadge: View {
    var number: Int
    var filled = false

    var body: some View {
        Text("\(number)")
            .font(.caption2.weight(.bold))
            .monospacedDigit()
            .foregroundStyle(filled ? Color.onBrand : Color.brand)
            .padding(.horizontal, 5)
            .frame(minWidth: 18, minHeight: 18)
            .background(filled ? Color.brand : Color.brand.opacity(0.14), in: .capsule)
    }
}

/// Reading width for a column of cards on wide screens.
let readingWidth: CGFloat = 700
