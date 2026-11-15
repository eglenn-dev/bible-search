import Charts
import SwiftUI

// Chart and layout primitives for the stats page, after
// client/src/components/stats/charts.tsx, built on Swift Charts.

// MARK: - Palette

/// The web's --series-1…6 categorical palette, light and dark.
enum StatsPalette {
    static let blue = Color(light: hex(0x2A78D6), dark: hex(0x3987E5))
    static let orange = Color(light: hex(0xEB6834), dark: hex(0xD95926))
    static let green = Color(light: hex(0x1BAF7A), dark: hex(0x199E70))
    static let amber = Color(light: hex(0xEDA100), dark: hex(0xC98500))
    static let pink = Color(light: hex(0xE87BA4), dark: hex(0xD55181))

    /// Fixed volume → color mapping (identity, not rank), in legend order.
    static let volumes: [(name: String, color: Color)] = [
        ("Doctrine and Covenants", blue),
        ("New Testament", orange),
        ("Book of Mormon", green),
        ("Old Testament", amber),
        ("Pearl of Great Price", pink),
    ]

    static func volume(_ name: String) -> Color {
        volumes.first { $0.name == name }?.color ?? .brand
    }

    private static func hex(_ v: UInt32) -> UIColor {
        UIColor(red: CGFloat((v >> 16) & 0xFF) / 255, green: CGFloat((v >> 8) & 0xFF) / 255, blue: CGFloat(v & 0xFF) / 255, alpha: 1)
    }
}

extension Double {
    /// "2,087"
    var grouped: String { Int(rounded()).formatted(.number) }
}

extension Int {
    var grouped: String { formatted(.number) }
}

// MARK: - Layout

/// Lays children out in as many equal columns as fit (up to `maxColumns`),
/// rows sharing the height of their tallest child. Children marked
/// `.fullSpan()` take a row to themselves.
struct ColumnsLayout: Layout {
    var minColumnWidth: CGFloat
    var maxColumns = 2
    var spacing: CGFloat = 16
    var rowSpacing: CGFloat = 16

    private struct Row {
        var indices: [Int]
        var full: Bool
        var height: CGFloat = 0
    }

    private func columns(for width: CGFloat) -> Int {
        max(1, min(maxColumns, Int((width + spacing) / (minColumnWidth + spacing))))
    }

    private func arrange(width: CGFloat, subviews: Subviews) -> (rows: [Row], columnWidth: CGFloat) {
        let cols = columns(for: width)
        let colWidth = (width - spacing * CGFloat(cols - 1)) / CGFloat(cols)
        var rows: [Row] = []
        var current: [Int] = []
        func flush() {
            if !current.isEmpty { rows.append(Row(indices: current, full: false)) }
            current = []
        }
        for i in subviews.indices {
            if subviews[i][FullSpanKey.self] || cols == 1 {
                flush()
                rows.append(Row(indices: [i], full: true))
            } else {
                current.append(i)
                if current.count == cols { flush() }
            }
        }
        flush()
        for r in rows.indices {
            let w = rows[r].full ? width : colWidth
            rows[r].height = rows[r].indices
                .map { subviews[$0].sizeThatFits(.init(width: w, height: nil)).height }
                .max() ?? 0
        }
        return (rows, colWidth)
    }

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = proposal.width ?? minColumnWidth
        let rows = arrange(width: width, subviews: subviews).rows
        let height = rows.map(\.height).reduce(0, +) + rowSpacing * CGFloat(max(0, rows.count - 1))
        return CGSize(width: width, height: height)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let (rows, colWidth) = arrange(width: bounds.width, subviews: subviews)
        var y = bounds.minY
        for row in rows {
            for (k, index) in row.indices.enumerated() {
                let w = row.full ? bounds.width : colWidth
                let x = bounds.minX + CGFloat(k) * (colWidth + spacing)
                subviews[index].place(at: CGPoint(x: x, y: y), anchor: .topLeading, proposal: .init(width: w, height: row.height))
            }
            y += row.height + rowSpacing
        }
    }
}

private struct FullSpanKey: LayoutValueKey {
    static let defaultValue = false
}

extension View {
    /// Take a whole row in a `ColumnsLayout`.
    func fullSpan(_ on: Bool = true) -> some View {
        layoutValue(key: FullSpanKey.self, value: on)
    }
}

// MARK: - Figure chrome

/// One chart or list: a serif title, a caption, then the content, on a card.
struct StatsFigure<Content: View>: View {
    var title: String
    var sub: String?
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(title)
                .font(.display(.title2, weight: .medium))
                .accessibilityAddTraits(.isHeader)
                .fixedSize(horizontal: false, vertical: true)
            if let sub {
                Text(sub)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.top, 4)
            }
            content
                .padding(.top, 18)
        }
        .padding(18)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .card()
    }
}

/// Small uppercase label for a sub-list inside a figure.
struct StatsKicker: View {
    var text: String
    var color: Color = .secondary

    var body: some View {
        Text(text.uppercased())
            .font(.caption.weight(.semibold))
            .tracking(1.4)
            .foregroundStyle(color)
            .accessibilityAddTraits(.isHeader)
    }
}

// MARK: - Horizontal bar list

struct StatsBar: Identifiable {
    var id: Int
    var label: String
    var value: Double
    var valueText: String
    var color: Color = .brand
    /// Extra spoken detail (the web's hover tooltip).
    var detail: String?
}

struct StatsBarList: View {
    var rows: [StatsBar]

    private var maxValue: Double { max(rows.map(\.value).max() ?? 1, 1) }

    /// Room past the longest bar for its value label.
    private var valueWidth: CGFloat {
        CGFloat(rows.map(\.valueText.count).max() ?? 4) * 8 + 8
    }

    // Each label sits above its bar, like the career-span chart, so long
    // names never collide with the bars.
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            ForEach(rows) { row in
                VStack(alignment: .leading, spacing: 3) {
                    Text(row.label)
                        .font(.subheadline)
                        .lineLimit(1)
                    GeometryReader { proxy in
                        let track = max(proxy.size.width - valueWidth, 1)
                        HStack(spacing: 6) {
                            UnevenRoundedRectangle(bottomTrailingRadius: 3, topTrailingRadius: 3)
                                .fill(row.color)
                                .frame(width: max(2, track * CGFloat(row.value / maxValue)))
                            Text(row.valueText)
                                .font(.footnote)
                                .monospacedDigit()
                                .foregroundStyle(.secondary)
                                .fixedSize()
                        }
                    }
                    .frame(height: 14)
                }
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(row.label)
                .accessibilityValue([row.valueText, row.detail].compactMap(\.self).joined(separator: ", "))
            }
        }
    }
}

// MARK: - Line chart with scrubbing

struct StatsPoint: Identifiable {
    var x: Int
    var y: Double
    var id: Int { x }
}

struct StatsLineChart: View {
    var points: [StatsPoint]
    var color: Color = .brand
    var yMin: Double?
    var height: CGFloat = 200
    /// Axis label for a y value.
    var yLabel: (Double) -> String = { $0.grouped }
    /// Spoken / scrubbed value text.
    var valueText: (Double) -> String = { $0.grouped }
    var seriesName = "Value"

    @State private var selectedX: Int?

    private var domain: ClosedRange<Double> {
        let ys = points.map(\.y)
        let hi = (ys.max() ?? 1) * 1.03
        let lo = yMin ?? (ys.min() ?? 0) * 0.97
        return lo < hi ? lo...hi : lo...(lo + 1)
    }

    private var selected: StatsPoint? {
        guard let selectedX else { return nil }
        return points.min { abs($0.x - selectedX) < abs($1.x - selectedX) }
    }

    var body: some View {
        let domain = domain
        Chart {
            ForEach(points) { p in
                AreaMark(x: .value("Year", p.x), yStart: .value(seriesName, domain.lowerBound), yEnd: .value(seriesName, p.y))
                    .foregroundStyle(color.opacity(0.09))
                    .accessibilityHidden(true)
                LineMark(x: .value("Year", p.x), y: .value(seriesName, p.y))
                    .foregroundStyle(color)
                    .lineStyle(StrokeStyle(lineWidth: 2, lineJoin: .round))
                    .accessibilityLabel(String(p.x))
                    .accessibilityValue(valueText(p.y))
            }
            if let last = points.last {
                PointMark(x: .value("Year", last.x), y: .value(seriesName, last.y))
                    .foregroundStyle(color)
                    .symbolSize(30)
                    .accessibilityHidden(true)
            }
            if let s = selected {
                RuleMark(x: .value("Year", s.x))
                    .foregroundStyle(.secondary)
                    .lineStyle(StrokeStyle(lineWidth: 1, dash: [3, 3]))
                    .annotation(position: .top, spacing: 4, overflowResolution: .init(x: .fit(to: .chart), y: .disabled)) {
                        ScrubLabel(title: String(s.x), value: valueText(s.y))
                    }
                    .accessibilityHidden(true)
                PointMark(x: .value("Year", s.x), y: .value(seriesName, s.y))
                    .foregroundStyle(color)
                    .symbolSize(40)
                    .accessibilityHidden(true)
            }
        }
        .chartYScale(domain: domain)
        .chartXScale(domain: (points.first?.x ?? 0)...(points.last?.x ?? 1))
        .chartXSelection(value: $selectedX)
        .chartYAxis {
            AxisMarks(position: .leading, values: .automatic(desiredCount: 5)) { value in
                AxisGridLine()
                AxisValueLabel {
                    if let v = value.as(Double.self) { Text(yLabel(v)) }
                }
            }
        }
        .chartXAxis {
            AxisMarks(values: .automatic(desiredCount: 6)) { value in
                AxisValueLabel {
                    if let v = value.as(Int.self) { Text(String(v)) }
                }
            }
        }
        .padding(.top, 30) // room for the scrub label
        .frame(height: height + 30)
    }
}

/// The floating value readout while scrubbing a chart.
struct ScrubLabel: View {
    var title: String
    var value: String

    var body: some View {
        VStack(spacing: 1) {
            Text(title).font(.caption2).foregroundStyle(.secondary)
            Text(value).font(.caption.weight(.semibold)).monospacedDigit()
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 4)
        .background(Color.cardFill, in: .rect(cornerRadius: 8))
        .overlay { RoundedRectangle(cornerRadius: 8).strokeBorder(Color.cardStroke) }
        .fixedSize()
    }
}

// MARK: - Sparkline row (word trends)

struct SparkRow: View {
    var term: String
    var points: [StatsPoint]

    @State private var selectedX: Int?

    private var peak: StatsPoint? { points.max { $0.y < $1.y } }

    private var selected: StatsPoint? {
        guard let selectedX else { return nil }
        return points.min { abs($0.x - selectedX) < abs($1.x - selectedX) }
    }

    var body: some View {
        let shown = selected ?? peak
        HStack(spacing: 12) {
            Text(term)
                .font(.display(.body, weight: .regular))
                .lineLimit(2)
                .minimumScaleFactor(0.85)
                .frame(width: 112, alignment: .leading)
            Chart {
                ForEach(points) { p in
                    AreaMark(x: .value("Year", p.x), y: .value("Per million", p.y))
                        .foregroundStyle(Color.brand.opacity(0.12))
                    LineMark(x: .value("Year", p.x), y: .value("Per million", p.y))
                        .foregroundStyle(Color.brand)
                        .lineStyle(StrokeStyle(lineWidth: 1.6, lineJoin: .round))
                }
                if let s = selected {
                    RuleMark(x: .value("Year", s.x))
                        .foregroundStyle(.secondary)
                        .lineStyle(StrokeStyle(lineWidth: 1, dash: [2, 2]))
                }
            }
            .chartXAxis(.hidden)
            .chartYAxis(.hidden)
            .chartLegend(.hidden)
            .chartXScale(domain: (points.first?.x ?? 0)...(points.last?.x ?? 1))
            .chartYScale(domain: 0...max(peak?.y ?? 1, 0.0001))
            .chartXSelection(value: $selectedX)
            .frame(height: 36)
            VStack(alignment: .trailing, spacing: 0) {
                Text(selected == nil ? "peak \(shown.map { String($0.x) } ?? "–")" : (shown.map { String($0.x) } ?? "–"))
                Text("\(shown.map { trim($0.y) } ?? "–")/M")
            }
            .font(.caption)
            .monospacedDigit()
            .foregroundStyle(selected == nil ? .secondary : Color.brand)
            .frame(width: 66, alignment: .trailing)
        }
        .padding(.vertical, 8)
        .overlay(alignment: .bottom) { Divider().opacity(0.6) }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(term)
        .accessibilityValue(summary)
    }

    private func trim(_ v: Double) -> String {
        v >= 10 ? v.grouped : v.formatted(.number.precision(.fractionLength(0...1)))
    }

    private var summary: String {
        guard let peak, let first = points.first, let last = points.last else { return "No data" }
        return "Peaks in \(peak.x) at \(trim(peak.y)) per million words; \(trim(first.y)) in \(first.x), \(trim(last.y)) in \(last.x)."
    }
}

// MARK: - Career spans

struct SpanChart: View {
    var rows: [SpeakerAgg]
    var domain: ClosedRange<Int>

    private var gridYears: [Int] {
        stride(from: (domain.lowerBound / 20 + 1) * 20, through: domain.upperBound, by: 20).map(\.self)
    }

    var body: some View {
        Chart(rows) { r in
            RuleMark(
                xStart: .value("First talk", r.first),
                xEnd: .value("Most recent talk", r.last),
                y: .value("Speaker", r.speaker)
            )
            .foregroundStyle(Color.brand.opacity(0.85))
            .lineStyle(StrokeStyle(lineWidth: 5, lineCap: .round))
            .annotation(position: .trailing, alignment: .leading, spacing: 6) {
                Text("\(r.span) yrs")
                    .font(.footnote)
                    .monospacedDigit()
                    .foregroundStyle(.secondary)
                    .fixedSize()
            }
            .accessibilityLabel(r.speaker)
            .accessibilityValue(String(r.first) + " to " + String(r.last) + ", \(r.span) years, \(r.talks) talks")
        }
        .chartXScale(domain: domain, range: .plotDimension(startPadding: 4, endPadding: 52))
        .chartXAxis {
            AxisMarks(position: .top, values: gridYears) { value in
                AxisGridLine()
                AxisValueLabel {
                    if let v = value.as(Int.self) { Text(String(v)) }
                }
            }
        }
        .chartYAxis {
            AxisMarks(position: .leading, values: rows.map(\.speaker)) { value in
                AxisValueLabel {
                    if let s = value.as(String.self) {
                        Text(s).font(.subheadline).foregroundStyle(.primary).lineLimit(1)
                    }
                }
            }
        }
        .frame(height: CGFloat(rows.count) * 30 + 24)
    }
}

// MARK: - Cluster decade bars

struct ClusterDecadeBars: View {
    struct Bar: Identifiable {
        var decade: String
        var talks: Int
        var share: Double
        var id: String { decade }
    }

    var bars: [Bar]
    var maxShare: Double

    var body: some View {
        Chart(bars) { b in
            BarMark(x: .value("Decade", b.decade), y: .value("Share", max(b.share, maxShare * 0.03)))
                .foregroundStyle(Color.brand)
                .clipShape(UnevenRoundedRectangle(topLeadingRadius: 2, topTrailingRadius: 2))
                .accessibilityLabel(b.decade)
                .accessibilityValue("\(b.talks) talks, \(b.share.formatted(.number.precision(.fractionLength(1)))) percent of the decade")
        }
        .chartYScale(domain: 0...max(maxShare, 0.001))
        .chartYAxis(.hidden)
        .chartXAxis {
            AxisMarks { value in
                AxisValueLabel {
                    if let s = value.as(String.self) { Text(s).font(.caption2).monospacedDigit() }
                }
            }
        }
        .frame(height: 76)
    }
}
