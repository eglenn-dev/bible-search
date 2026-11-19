import SwiftUI

/// The library, by the numbers: precomputed corpus analytics from GET /stats,
/// mirroring the web's /stats page (client/src/pages/stats.tsx). All numbers
/// are computed offline (api/ingest/stats.py); this screen formats and charts them.
struct StatsView: View {
    private enum LoadState {
        case loading
        case loaded(StatsPayload)
        case failed(String)
    }

    @State private var state = LoadState.loading

    var body: some View {
        Group {
            switch state {
            case .loading:
                ProgressView("Counting the library…")
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            case .failed(let message):
                ContentUnavailableView {
                    Label("Stats unavailable", systemImage: "chart.bar.xaxis")
                } description: {
                    Text("The stats are unavailable right now. \(message)")
                } actions: {
                    Button("Try Again") {
                        state = .loading
                        Task { await load() }
                    }
                    .buttonStyle(.borderedProminent)
                }
            case .loaded(let payload):
                StatsPage(payload: payload) { await load() }
            }
        }
        .background { AppWash() }
        .navigationTitle("By the numbers")
        .navigationBarTitleDisplayMode(.inline)
        .task {
            if case .loaded = state { return }
            await load()
        }
    }

    private func load() async {
        do {
            let raw = try await APIClient.shared.stats()
            state = .loaded(try await StatsPayload.decode(raw))
        } catch is CancellationError {
            return
        } catch {
            // Keep showing stale stats on a failed refresh.
            if case .loaded = state { return }
            state = .failed(error.localizedDescription)
        }
    }
}

private enum StatsSection: Int, CaseIterable, Identifiable {
    case speakers, language, trivia, semantic

    var id: Int { rawValue }

    var label: String {
        switch self {
        case .speakers: "Speakers"
        case .language: "Language"
        case .trivia: "Trivia"
        case .semantic: "Embeddings"
        }
    }

    var kicker: String { "§ \(rawValue + 1) · \(label)" }
}

private struct StatsPage: View {
    var payload: StatsPayload
    var refresh: () async -> Void

    private var d: StatsData { payload.data }
    private var meta: StatsMeta? { d.meta }
    private var firstYear: Int? { meta?.firstYear }
    private var lastYear: Int? { meta?.lastYear }
    private var yearRange: String {
        guard let firstYear, let lastYear else { return "" }
        return "\(String(firstYear))–\(String(lastYear))"
    }

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    header
                    speakers
                    language
                    trivia
                    semantic
                }
                .frame(maxWidth: 1100, alignment: .leading)
                .padding(.horizontal, 16)
                .padding(.bottom, 40)
                .frame(maxWidth: .infinity)
            }
            .refreshable { await refresh() }
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        ForEach(StatsSection.allCases) { section in
                            Button(section.label) {
                                withAnimation { proxy.scrollTo(section, anchor: .top) }
                            }
                        }
                    } label: {
                        Label("Jump to Section", systemImage: "list.bullet")
                    }
                }
            }
        }
    }

    // MARK: Header

    private var header: some View {
        VStack(alignment: .leading, spacing: 0) {
            StatsKicker(text: "Gospel Library Search", color: .brand)
            Text("The Library, by the Numbers")
                .font(.display(.largeTitle, weight: .medium))
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, 8)
                .accessibilityAddTraits(.isHeader)
            Text(intro)
                .font(.body)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: readingWidth, alignment: .leading)
                .padding(.top, 12)
            if let updated = payload.updatedText {
                Text("Data last updated \(updated).")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .padding(.top, 8)
            }
            if let meta {
                bigNumbers(meta)
                    .padding(.top, 24)
            }
        }
        .padding(.top, 20)
    }

    private var intro: String {
        let years = firstYear.flatMap { f in lastYear.map { $0 - f } }
        let conference = years.map { "\($0) years of General Conference" } ?? "decades of General Conference"
        return "Every stat on this page is computed from the full corpus behind the search index — four volumes of scripture, \(conference), and five decades of BYU Speeches."
    }

    private func bigNumbers(_ m: StatsMeta) -> some View {
        VStack(alignment: .leading, spacing: 18) {
            ColumnsLayout(minColumnWidth: 140, maxColumns: 4, spacing: 16, rowSpacing: 20) {
                if let v = m.totalDocs { BigNumber(value: v.grouped, label: "passages indexed") }
                if let v = m.totalWords {
                    BigNumber(value: "\((Double(v) / 1e6).formatted(.number.precision(.fractionLength(1)))) M", label: "words of text")
                }
                if let v = m.talks { BigNumber(value: v.grouped, label: "conference talks") }
                if let v = m.speeches { BigNumber(value: v.grouped, label: "BYU speeches") }
            }
            Divider()
            ColumnsLayout(minColumnWidth: 140, maxColumns: 4, spacing: 16, rowSpacing: 16) {
                if let v = m.verses { BigNumber(value: v.grouped, label: "verses of scripture", small: true) }
                if let v = m.conferenceSpeakers { BigNumber(value: v.grouped, label: "conference speakers", small: true) }
                if !yearRange.isEmpty { BigNumber(value: yearRange, label: "years of conference", small: true) }
            }
        }
        .padding(20)
        .card()
    }

    // MARK: § 1 Speakers

    private var speakers: some View {
        SectionBlock(
            section: .speakers,
            title: "The Speakers",
            note: "Who has held the conference pulpit\(firstYear.map { " since \(String($0))" } ?? "") — procedural items (sustainings, audit & statistical reports) are excluded throughout."
        ) {
            if !d.prolific.isEmpty {
                StatsFigure(title: "Most talks given", sub: yearRange.isEmpty ? "Distinct conference talks." : "Distinct conference talks, \(yearRange).") {
                    StatsBarList(rows: d.prolific.prefix(14).enumerated().map { i, r in
                        StatsBar(id: i, label: r.speaker, value: Double(r.talks), valueText: r.talks.grouped,
                                 detail: "\(String(r.first))–\(String(r.last)), average \(r.avgWords.grouped) words")
                    })
                }
            }
            if !d.longestSpan.isEmpty {
                StatsFigure(title: "Longest pulpit careers", sub: "First talk to most recent talk in the corpus.") {
                    SpanChart(rows: Array(d.longestSpan.prefix(12)), domain: spanDomain)
                }
            }
            if !d.wordiest.isEmpty {
                StatsFigure(title: "Longest-winded", sub: "Average words per talk (speakers with ≥ 10 talks).") {
                    StatsBarList(rows: speakerLengthBars(d.wordiest, color: .brand))
                }
            }
            if !d.mostConcise.isEmpty {
                StatsFigure(title: "Most concise", sub: "Same measure, other end of the list.") {
                    StatsBarList(rows: speakerLengthBars(d.mostConcise, color: StatsPalette.green))
                }
            }
            if !d.talkLengthByYear.isEmpty {
                StatsFigure(title: "The shrinking conference talk", sub: "Average words per talk, by year.") {
                    StatsLineChart(
                        points: series(d.talkLengthByYear),
                        height: 240,
                        yLabel: { (($0 / 100).rounded() * 100).grouped },
                        valueText: { "\($0.grouped) words" },
                        seriesName: "Average words"
                    )
                }
                .fullSpan()
            }
            if !d.longestTalks.isEmpty || !d.shortestTalks.isEmpty {
                StatsFigure(title: "Extremes", sub: "The longest and shortest sermons in the corpus.") {
                    ColumnsLayout(minColumnWidth: 300, maxColumns: 2, spacing: 32, rowSpacing: 20) {
                        if !d.longestTalks.isEmpty {
                            VStack(alignment: .leading, spacing: 4) {
                                SectionHeader(title: "Longest")
                                TalkList(talks: Array(d.longestTalks.prefix(3)))
                            }
                        }
                        if !d.shortestTalks.isEmpty {
                            VStack(alignment: .leading, spacing: 4) {
                                SectionHeader(title: "Shortest")
                                TalkList(talks: Array(d.shortestTalks.prefix(3)), accent: StatsPalette.green)
                            }
                        }
                    }
                }
                .fullSpan()
            }
        }
    }

    private var spanDomain: ClosedRange<Int> {
        let lo = firstYear ?? d.longestSpan.map(\.first).min() ?? 1970
        let hi = lastYear ?? d.longestSpan.map(\.last).max() ?? 2030
        return lo < hi ? lo...hi : lo...(lo + 1)
    }

    private func speakerLengthBars(_ rows: [SpeakerAgg], color: Color) -> [StatsBar] {
        rows.prefix(8).enumerated().map { i, r in
            StatsBar(id: i, label: r.speaker, value: r.avgWords, valueText: "\(r.avgWords.grouped) w", color: color,
                     detail: "average words per talk, \(r.talks) talks, \(String(r.first))–\(String(r.last))")
        }
    }

    // MARK: § 2 Language

    private var language: some View {
        SectionBlock(
            section: .language,
            title: "The Language of Conference",
            note: "A Google-Ngrams view of the pulpit: every line is one term’s frequency per million words of conference talk\(yearRange.isEmpty ? "" : ", \(yearRange)"). Drag across any line for exact values."
        ) {
            if !d.wordTrends.isEmpty {
                StatsFigure(title: "Words over time", sub: "\(d.wordTrends.count) terms, each on its own scale — compare shapes, not heights.") {
                    ColumnsLayout(minColumnWidth: 320, maxColumns: 2, spacing: 32, rowSpacing: 0) {
                        ForEach(d.wordTrends.entries, id: \.key) { e in
                            SparkRow(term: e.key, points: series(e.value))
                        }
                    }
                }
                .fullSpan()
            }
            let flesch = readability(\.flesch)
            if !flesch.isEmpty {
                StatsFigure(title: "Reading ease", sub: "Flesch reading ease of all talks, by year (higher = plainer language).") {
                    StatsLineChart(
                        points: flesch,
                        color: StatsPalette.green,
                        yLabel: { $0.formatted(.number.precision(.fractionLength(0))) },
                        valueText: { "\($0.formatted(.number.precision(.fractionLength(1)))) Flesch" },
                        seriesName: "Flesch reading ease"
                    )
                }
            }
            let sentence = readability(\.avgSentenceLen)
            if !sentence.isEmpty {
                StatsFigure(title: "Sentence length", sub: "Average words per sentence, by year.") {
                    StatsLineChart(
                        points: sentence,
                        color: StatsPalette.orange,
                        yLabel: { $0.formatted(.number.precision(.fractionLength(0))) },
                        valueText: { "\($0.formatted(.number.precision(.fractionLength(1)))) words/sentence" },
                        seriesName: "Words per sentence"
                    )
                }
            }
            if !d.fingerprints.isEmpty {
                StatsFigure(
                    title: "Vocabulary fingerprints",
                    sub: "Words each current apostle uses far more than conference speakers as a whole (× lift over the corpus rate)."
                ) {
                    ColumnsLayout(minColumnWidth: 320, maxColumns: 2, spacing: 32, rowSpacing: 0) {
                        ForEach(d.fingerprints.entries, id: \.key) { e in
                            FingerprintRow(speaker: e.key, words: Array(e.value.prefix(6)), showDivider: true)
                        }
                    }
                }
                .fullSpan()
            }
        }
    }

    private func readability(_ value: KeyPath<Readability, Double?>) -> [StatsPoint] {
        d.readabilityByYear.entries.compactMap { e in
            guard let x = Int(e.key), let y = e.value[keyPath: value] else { return nil }
            return StatsPoint(x: x, y: y)
        }
    }

    // MARK: § 3 Trivia

    private var trivia: some View {
        SectionBlock(
            section: .trivia,
            title: "Scripture Trivia",
            note: "Classic concordance facts, computed across all \(meta?.verses?.grouped ?? "the") verses of the standard works."
        ) {
            if !d.shortestVerses.isEmpty {
                StatsFigure(title: "Shortest verses") {
                    ColumnsLayout(minColumnWidth: 140, maxColumns: 5, spacing: 12, rowSpacing: 12) {
                        ForEach(Array(d.shortestVerses.prefix(5).enumerated()), id: \.offset) { _, v in
                            ShortVerseTile(verse: v)
                        }
                    }
                }
                .fullSpan()
            }
            if !d.longestVerses.isEmpty {
                StatsFigure(title: "Longest verses") {
                    VerseQuoteList(verses: Array(d.longestVerses.prefix(5)), accent: StatsPalette.orange)
                }
                .fullSpan()
            }
            if let ctp = d.cameToPass, !ctp.byVolume.isEmpty || !ctp.bomByBook.isEmpty {
                StatsFigure(title: "“And it came to pass”", sub: "Occurrences by volume — and where the Book of Mormon keeps them.") {
                    VStack(alignment: .leading, spacing: 8) {
                        if !ctp.byVolume.isEmpty {
                            StatsBarList(rows: ctp.byVolume.entries.enumerated().map { i, e in
                                StatsBar(id: i, label: e.key, value: e.value, valueText: e.value.grouped, color: StatsPalette.volume(e.key))
                            })
                        }
                        if !ctp.bomByBook.isEmpty {
                            StatsKicker(text: "Within the Book of Mormon")
                                .padding(.top, 12)
                            StatsBarList(rows: ctp.bomByBook.entries.prefix(6).enumerated().map { i, e in
                                StatsBar(id: i, label: e.key, value: e.value, valueText: e.value.grouped, color: StatsPalette.green)
                            })
                        }
                    }
                }
            }
            if !d.biggestChapters.isEmpty {
                StatsFigure(title: "Biggest chapters", sub: "Most verses in a single chapter.") {
                    StatsBarList(rows: d.biggestChapters.prefix(8).enumerated().map { i, r in
                        StatsBar(id: i, label: r.chapter, value: Double(r.verses), valueText: "\(r.verses) verses")
                    })
                }
            }
        }
    }

    // MARK: § 4 Embeddings

    private var semantic: some View {
        SectionBlock(
            section: .semantic,
            title: "What the Embeddings See",
            note: "These stats come from the same 384-dimensional vectors that power search — no keyword matching involved. Each talk is averaged into a single point; distance means semantic difference."
        ) {
            if !d.mostTypical.isEmpty {
                StatsFigure(title: "The most typical talks", sub: "Closest to the semantic center of every sermon in the corpus.") {
                    TalkList(talks: Array(d.mostTypical.prefix(6)))
                }
            }
            if !d.mostUnusual.isEmpty {
                StatsFigure(title: "The most unusual talks", sub: "Farthest from the center — the outliers.") {
                    TalkList(talks: Array(d.mostUnusual.prefix(6)), accent: StatsPalette.orange)
                }
            }
            if !d.twins.isEmpty {
                StatsFigure(title: "Talk twins", sub: "The most semantically similar pairs of talks by different speakers.") {
                    pairColumns(Array(d.twins.prefix(6)))
                }
                .fullSpan()
            }
            if !d.twinsCrossEra.isEmpty {
                StatsFigure(title: "Twins across eras", sub: "Near-identical talks given at least 25 years apart.") {
                    pairColumns(Array(d.twinsCrossEra.prefix(6)))
                }
                .fullSpan()
            }
            if !d.clusters.isEmpty {
                StatsFigure(
                    title: "Twelve rooms of the conference library",
                    sub: "K-means clusters of all sermons, labeled by their most distinctive vocabulary. Bars show each cluster’s share of talks per decade."
                ) {
                    ColumnsLayout(minColumnWidth: 230, maxColumns: 3, spacing: 28, rowSpacing: 20) {
                        ForEach(Array(d.clusters.enumerated()), id: \.offset) { _, c in
                            ClusterCell(cluster: c, decadeTotals: d.clusterDecadeTotals, maxShare: maxClusterShare)
                        }
                    }
                }
                .fullSpan()
            }
            if !d.verseEchoStrong.isEmpty {
                // Stats generated before the threshold was recorded used 0.6.
                let threshold = d.verseEchoThreshold ?? 0.6
                StatsFigure(
                    title: "The most echoed verses",
                    sub: "For every conference passage, the semantically nearest verse of scripture (cosine > \(threshold.formatted(.number.precision(.fractionLength(0...3))))). These are the verses the pulpit orbits — cited or not."
                ) {
                    VStack(alignment: .leading, spacing: 14) {
                        VolumeLegend()
                        StatsBarList(rows: d.verseEchoStrong.prefix(15).enumerated().map { i, r in
                            StatsBar(
                                id: i, label: r.ref, value: Double(r.count), valueText: "\(r.count.grouped) passages",
                                color: StatsPalette.volume(r.volume),
                                detail: [r.volume, r.text.isEmpty ? "" : "“\(r.text)…”"].filter { !$0.isEmpty }.joined(separator: ". ")
                            )
                        })
                    }
                }
                .fullSpan()
            }
        }
    }

    /// Ranked pairs, split into two columns when there's room.
    private func pairColumns(_ pairs: [TwinPair]) -> some View {
        let half = (pairs.count + 1) / 2
        return ColumnsLayout(minColumnWidth: 340, maxColumns: 2, spacing: 32, rowSpacing: 0) {
            TwinPairList(pairs: Array(pairs.prefix(half)))
            if pairs.count > half {
                TwinPairList(pairs: Array(pairs.dropFirst(half)))
            }
        }
    }

    /// Cluster mini-bars share one scale: the largest decade-share of any cluster.
    private var maxClusterShare: Double {
        d.clusters.flatMap { c in
            d.clusterDecadeTotals.entries.map { e in e.value > 0 ? (c.byDecade[e.key] ?? 0) / e.value * 100 : 0 }
        }.max() ?? 1
    }

    private func series(_ map: OrderedMap<Double>) -> [StatsPoint] {
        map.entries.compactMap { e in Int(e.key).map { StatsPoint(x: $0, y: e.value) } }.sorted { $0.x < $1.x }
    }
}

// MARK: - Pieces

/// "§ 1 · Speakers" kicker, serif title, a note, then the figures in one or two columns.
private struct SectionBlock<Content: View>: View {
    var section: StatsSection
    var title: String
    var note: String
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            StatsKicker(text: section.kicker, color: .brand)
            Text(title)
                .font(.display(.largeTitle, weight: .medium))
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, 6)
                .accessibilityAddTraits(.isHeader)
            Text(note)
                .font(.body)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: readingWidth, alignment: .leading)
                .padding(.top, 8)
            ColumnsLayout(minColumnWidth: 360, maxColumns: 2, spacing: 16, rowSpacing: 16) {
                content
            }
            .padding(.top, 22)
        }
        .padding(.top, 44)
        .id(section)
    }
}

private struct BigNumber: View {
    var value: String
    var label: String
    var small = false

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(value)
                .font(.display(small ? .title : .largeTitle, weight: .medium))
                .monospacedDigit()
                .lineLimit(1)
                .minimumScaleFactor(0.6)
            Text(label)
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }
}
