import SwiftUI

// Text-row figures for the stats page: talk lists, twin pairs, verse quotes,
// vocabulary fingerprints and cluster cards.

/// A talk title that opens the talk when it has a URL.
private struct TalkTitle: View {
    var talk: TalkRef
    var font: Font

    var body: some View {
        if let url = talk.url {
            Link(destination: url) {
                Text("\(talk.title) \(Image(systemName: "arrow.up.right"))")
                    .font(font)
                    .foregroundStyle(.primary)
                    .multilineTextAlignment(.leading)
            }
            .accessibilityHint("Opens the talk")
        } else {
            Text(talk.title).font(font)
        }
    }
}

/// Ranked list of talks: rank, linked title, then speaker / year / extra.
struct TalkList: View {
    var talks: [TalkRef]
    var accent: Color = .brand

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(Array(talks.enumerated()), id: \.offset) { i, t in
                HStack(alignment: .firstTextBaseline, spacing: 10) {
                    Text("\(i + 1)")
                        .font(.display(.title3, weight: .regular))
                        .monospacedDigit()
                        .foregroundStyle(accent)
                        .frame(width: 24, alignment: .leading)
                        .accessibilityHidden(true)
                    VStack(alignment: .leading, spacing: 3) {
                        TalkTitle(talk: t, font: .display(.body, weight: .regular))
                        Text(detail(t))
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                .padding(.vertical, 10)
                .overlay(alignment: .bottom) {
                    if i < talks.count - 1 { Divider().opacity(0.6) }
                }
                .accessibilityElement(children: .combine)
            }
        }
    }

    private func detail(_ t: TalkRef) -> String {
        var parts = [t.byline]
        if let w = t.words { parts.append("\(w.grouped) words") }
        if let s = t.sim { parts.append("similarity \(s.formatted(.number.precision(.fractionLength(0...3))))") }
        return parts.filter { !$0.isEmpty }.joined(separator: " · ")
    }
}

/// Two talks and how alike they are.
struct TwinPairList: View {
    var pairs: [TwinPair]

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(Array(pairs.enumerated()), id: \.offset) { i, pair in
                HStack(alignment: .center, spacing: 14) {
                    VStack(alignment: .leading, spacing: 10) {
                        side(pair.a)
                        side(pair.b)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    Text((pair.sim).formatted(.percent.precision(.fractionLength(1))))
                        .font(.subheadline.weight(.semibold))
                        .monospacedDigit()
                        .foregroundStyle(Color.brand)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 5)
                        .background(Color.brand.opacity(0.12), in: .capsule)
                        .accessibilityLabel("\((pair.sim * 100).formatted(.number.precision(.fractionLength(1)))) percent similar")
                }
                .padding(.vertical, 12)
                .overlay(alignment: .bottom) {
                    if i < pairs.count - 1 { Divider().opacity(0.6) }
                }
                .accessibilityElement(children: .combine)
            }
        }
    }

    private func side(_ t: TalkRef) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            TalkTitle(talk: t, font: .display(.body, weight: .regular))
            Text(t.byline).font(.footnote).foregroundStyle(.secondary)
        }
    }
}

/// Reference + word count beside the verse text (stacked when narrow).
struct VerseQuoteList: View {
    var verses: [VerseExtreme]
    var accent: Color

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(Array(verses.enumerated()), id: \.offset) { i, v in
                ViewThatFits(in: .horizontal) {
                    HStack(alignment: .firstTextBaseline, spacing: 24) {
                        heading(v).frame(width: 190, alignment: .leading)
                        quote(v).frame(minWidth: 320, idealWidth: 420, maxWidth: .infinity, alignment: .leading)
                    }
                    VStack(alignment: .leading, spacing: 6) {
                        heading(v)
                        quote(v)
                    }
                }
                .padding(.vertical, 12)
                .overlay(alignment: .bottom) {
                    if i < verses.count - 1 { Divider().opacity(0.6) }
                }
                .accessibilityElement(children: .combine)
            }
        }
    }

    private func heading(_ v: VerseExtreme) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(v.ref).font(.display(.title3, weight: .medium))
            Text("\(v.words) words").font(.subheadline).monospacedDigit().foregroundStyle(accent)
        }
    }

    private func quote(_ v: VerseExtreme) -> some View {
        Text("“\(v.text)”")
            .font(.reading(17))
            .foregroundStyle(.primary.opacity(0.9))
            .fixedSize(horizontal: false, vertical: true)
    }
}

/// The shortest verses as small tiles.
struct ShortVerseTile: View {
    var verse: VerseExtreme

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("“\(verse.text)”")
                .font(.display(.title3, weight: .regular))
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
            VStack(alignment: .leading, spacing: 1) {
                Text(verse.ref).font(.subheadline.weight(.medium))
                Text("\(verse.words) words").font(.subheadline).foregroundStyle(.secondary)
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(Color.brand.opacity(0.09), in: .rect(cornerRadius: 14, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

/// A speaker and the words they over-use, as chips.
struct FingerprintRow: View {
    var speaker: String
    var words: [FingerprintWord]
    var showDivider: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(speaker).font(.display(.headline, weight: .medium))
            FlowLayout(spacing: 6) {
                ForEach(Array(words.enumerated()), id: \.offset) { _, w in
                    Text("\(w.word) \(Text("×\(Int(w.lift.rounded()))").font(.caption).foregroundStyle(.secondary).monospacedDigit())")
                        .font(.subheadline)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 4)
                        .background(Color.pageBackground, in: .capsule)
                        .overlay { Capsule().strokeBorder(Color.cardStroke) }
                        .accessibilityLabel("\(w.word), \(Int(w.lift.rounded())) times the corpus rate")
                }
            }
        }
        .padding(.vertical, 10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .overlay(alignment: .bottom) {
            if showDivider { Divider().opacity(0.6) }
        }
    }
}

/// One K-means cluster: label words, decade-share bars, an example talk.
struct ClusterCell: View {
    var cluster: TalkCluster
    var decadeTotals: OrderedMap<Double>
    var maxShare: Double

    private var bars: [ClusterDecadeBars.Bar] {
        decadeTotals.entries.map { e in
            let talks = cluster.byDecade[e.key] ?? 0
            let share = e.value > 0 ? talks / e.value * 100 : 0
            return .init(decade: "\(e.key.suffix(2))s", talks: Int(talks), share: share)
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            VStack(alignment: .leading, spacing: 3) {
                Text(cluster.topWords.prefix(3).joined(separator: " · "))
                    .font(.display(.title3, weight: .medium))
                    .fixedSize(horizontal: false, vertical: true)
                let also = cluster.topWords.dropFirst(3).prefix(4).joined(separator: ", ")
                Text(also.isEmpty ? "\(cluster.size.grouped) talks" : "\(cluster.size.grouped) talks — also: \(also)")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .accessibilityElement(children: .combine)
            Spacer(minLength: 0)
            ClusterDecadeBars(bars: bars, maxShare: maxShare)
            if let ex = cluster.examples.first {
                Text("e.g. \(Text(exampleTitle(ex))) \(ex.year.map { "(\(String($0)))" } ?? "")")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(.bottom, 12)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    private func exampleTitle(_ talk: TalkRef) -> AttributedString {
        var s = AttributedString(talk.title)
        s.link = talk.url
        s.foregroundColor = .brand
        return s
    }
}

/// Swatches for the scripture volumes.
struct VolumeLegend: View {
    var body: some View {
        FlowLayout(spacing: 14) {
            ForEach(StatsPalette.volumes, id: \.name) { v in
                HStack(spacing: 6) {
                    RoundedRectangle(cornerRadius: 3).fill(v.color).frame(width: 11, height: 11)
                    Text(v.name).font(.subheadline).foregroundStyle(.secondary)
                }
            }
        }
        .accessibilityHidden(true)
    }
}
