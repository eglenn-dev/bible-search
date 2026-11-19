import SwiftUI

struct SearchTab: View {
    @Environment(SearchModel.self) private var model
    @Environment(AppRouter.self) private var router
    @Environment(BookmarkStore.self) private var bookmarks
    @Environment(NetworkMonitor.self) private var network
    @State private var filtersOpen = false

    var body: some View {
        NavigationStack {
            ScrollViewReader { proxy in
                ScrollView {
                    VStack(alignment: .leading, spacing: 12) {
                        Color.clear.frame(height: 0).id("top")
                        if !network.isOnline {
                            NoticeCard(
                                symbol: "wifi.slash", title: "You’re offline.",
                                message: "Saved passages and recent searches still open; new searches will work again once you’re connected.")
                        }
                        ActiveFilterChips()
                        if let error = model.error {
                            Text(error)
                                .font(.subheadline)
                                .foregroundStyle(Color.destructiveText)
                                .padding(.horizontal, 4)
                        }
                        if !model.hasSearched {
                            StartScreen()
                        } else {
                            ResultsList()
                        }
                    }
                    .padding(.horizontal, 16)
                    .padding(.bottom, 32)
                    .frame(maxWidth: readingWidth)
                    .frame(maxWidth: .infinity)
                }
                .scrollDismissesKeyboard(.immediately)
                // A new set of results starts at the top; "Load more" keeps
                // the reader's place.
                .onChange(of: model.scrollGeneration) { _, _ in
                    withAnimation(.smooth) { proxy.scrollTo("top", anchor: .top) }
                }
            }
            .background { AppWash() }
            .safeAreaBar(edge: .top) {
                SearchHeader(filtersOpen: $filtersOpen)
                    .frame(maxWidth: readingWidth)
                    .frame(maxWidth: .infinity)
            }
            .navigationTitle("Gospel Help")
            .navigationSubtitle(model.hasSearched ? "" : "135,000+ passages from the Gospel Library")
            .navigationBarTitleDisplayMode(model.hasSearched ? .inline : .large)
            .sheet(isPresented: $filtersOpen) {
                FilterSheet()
                    .presentationDetents([.medium, .large])
            }
        }
    }
}

/// The pinned header: the search field, the mode toggle and Filters.
private struct SearchHeader: View {
    @Binding var filtersOpen: Bool
    @Environment(SearchModel.self) private var model
    @Environment(BackendMonitor.self) private var backend
    @Environment(NetworkMonitor.self) private var network
    @FocusState private var focused: Bool

    var body: some View {
        @Bindable var model = model
        let disabled = backend.status == .down && network.isOnline

        VStack(alignment: .leading, spacing: 10) {
            GlassEffectContainer {
                HStack(spacing: 8) {
                    Image(systemName: model.queryType == .natural ? "magnifyingglass" : "book.closed")
                        .foregroundStyle(.secondary)
                        .padding(.leading, 16)
                    TextField(
                        model.queryType == .natural ? "seek, and ye shall find…" : "Alma 32:21 or D&C 4:2",
                        text: model.queryType == .natural ? $model.query : $model.reference
                    )
                    .font(.body)
                    .textInputAutocapitalization(model.queryType == .natural ? .never : .words)
                    .autocorrectionDisabled(model.queryType == .scripture)
                    .submitLabel(.search)
                    .focused($focused)
                    .onSubmit(submit)
                    .accessibilityLabel("Search")
                    .accessibilityIdentifier("searchField")

                    if !(model.queryType == .natural ? model.query : model.reference).isEmpty {
                        Button {
                            if model.queryType == .natural { model.query = "" } else { model.reference = "" }
                            focused = true
                        } label: {
                            Image(systemName: "xmark.circle.fill")
                                .foregroundStyle(.tertiary)
                                .frame(width: 30, height: 30)
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("Clear search")
                    }

                    Button(action: submit) {
                        Group {
                            if model.loading {
                                ProgressView().tint(Color.onBrand)
                            } else {
                                Image(systemName: "arrow.up").font(.body.weight(.bold)).foregroundStyle(Color.onBrand)
                            }
                        }
                        .frame(width: 22, height: 22)
                    }
                    .buttonStyle(.glassProminent)
                    .buttonBorderShape(.circle)
                    .tint(.brand)
                    .disabled(model.loading || disabled || !model.canSubmit)
                    .padding(.trailing, 6)
                    .accessibilityLabel(model.loading ? "Searching" : "Search")
                    .accessibilityIdentifier("searchSubmit")
                }
                .frame(height: 52)
                .glassEffect(.regular.interactive(), in: .capsule)
            }

            if let fieldError = model.fieldError {
                Text(fieldError)
                    .font(.footnote)
                    .foregroundStyle(Color.destructiveText)
                    .padding(.horizontal, 16)
            }

            if model.queryType == .scripture, model.referenceCheck == .unavailable {
                Text("Couldn’t check this reference right now. You can still search for it.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, 16)
                    .accessibilityIdentifier("referenceUnchecked")
            }

            if model.queryType == .scripture, let verse = model.shownVerse {
                VStack(alignment: .leading, spacing: 2) {
                    if let source = verse.source {
                        Text(source.longLabel).font(.footnote.weight(.semibold)).foregroundStyle(.secondary)
                    }
                    Text("“\(verse.text)”")
                        .font(.reading(16))
                        .lineLimit(3)
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 10)
                .frame(maxWidth: .infinity, alignment: .leading)
                .card(radius: 18)
                // The last verse found, faded while the edit is checked.
                .opacity(model.versePreview == nil ? 0.45 : 1)
                .transition(.opacity.combined(with: .move(edge: .top)))
                .accessibilityIdentifier("versePreview")
            }

            HStack(spacing: 10) {
                Picker("Search mode", selection: $model.queryType) {
                    Text("Natural").tag(QueryType.natural)
                    Text("Reference").tag(QueryType.scripture)
                }
                .pickerStyle(.segmented)

                Button {
                    filtersOpen = true
                } label: {
                    Image(systemName: "line.3.horizontal.decrease")
                        .font(.body.weight(.semibold))
                        .frame(width: 22, height: 22)
                }
                .buttonStyle(.glass)
                .buttonBorderShape(.circle)
                .overlay(alignment: .topTrailing) {
                    if model.filterCount > 0 {
                        Text("\(model.filterCount)")
                            .font(.caption2.weight(.bold))
                            .foregroundStyle(Color.onBrand)
                            .frame(minWidth: 18, minHeight: 18)
                            .background(Color.brand, in: .capsule)
                            .offset(x: 4, y: -4)
                    }
                }
                .accessibilityLabel(model.filterCount > 0 ? "Filters, \(model.filterCount) active" : "Filters")
            }
        }
        .padding(.horizontal, 16)
        .padding(.top, 6)
        .padding(.bottom, 10)
        .animation(.smooth, value: model.shownVerse?.text)
        .animation(.smooth(duration: 0.2), value: model.versePreview == nil)
    }

    private func submit() {
        focused = false
        Task { await model.submit() }
    }
}

/// Before the first search: recent searches and recently saved passages.
private struct StartScreen: View {
    @Environment(SearchModel.self) private var model
    @Environment(RecentSearchStore.self) private var recents
    @Environment(BookmarkStore.self) private var bookmarks
    @Environment(AppRouter.self) private var router

    var body: some View {
        VStack(alignment: .leading, spacing: 22) {
            RecentSearchesList()
            if bookmarks.bookmarks.isEmpty {
                NoticeCard(
                    symbol: "bookmark", title: "Keep what you find.",
                    message: "Tap the bookmark on any result and it will be waiting for you under Saved.")
            } else {
                VStack(alignment: .leading, spacing: 10) {
                    SectionHeader(title: "Recently saved") {
                        Button {
                            router.tab = .saved
                        } label: {
                            HStack(spacing: 2) {
                                Text("See all")
                                Image(systemName: "chevron.right").font(.footnote.weight(.semibold))
                            }
                        }
                        .font(.subheadline)
                    }
                    ForEach(bookmarks.bookmarks.prefix(3)) { b in
                        ResultCard(passage: b.passage)
                    }
                }
            }
        }
        .padding(.top, 4)
        .transition(.opacity)
    }
}

private struct RecentSearchesList: View {
    @Environment(SearchModel.self) private var model
    @Environment(RecentSearchStore.self) private var recents
    @Environment(NetworkMonitor.self) private var network
    @State private var cached: Set<String> = []

    var body: some View {
        let shown = Array(recents.items.prefix(5))
        if !shown.isEmpty {
            VStack(alignment: .leading, spacing: 10) {
                SectionHeader(title: "Recent searches") {
                    Button("Clear") { withAnimation { recents.clear() } }
                        .font(.subheadline)
                }
                VStack(spacing: 0) {
                    ForEach(Array(shown.enumerated()), id: \.element.id) { index, recent in
                        let available = network.isOnline || cached.contains(recent.id)
                        if index > 0 { Divider().padding(.leading, 50) }
                        Button {
                            Task { await model.runRecent(recent) }
                        } label: {
                            HStack(spacing: 14) {
                                Image(systemName: recent.queryType == .scripture ? "book.closed" : "clock.arrow.circlepath")
                                    .foregroundStyle(.secondary)
                                    .frame(width: 22)
                                VStack(alignment: .leading, spacing: 1) {
                                    Text(recent.query).lineLimit(1).foregroundStyle(.primary)
                                    if !available {
                                        Text("Not saved for offline").font(.footnote).foregroundStyle(.secondary)
                                    } else if let detail = recent.detail {
                                        Text(detail).font(.footnote).foregroundStyle(.secondary).lineLimit(1)
                                    }
                                }
                                Spacer(minLength: 0)
                                Image(systemName: "arrow.up.left")
                                    .font(.footnote)
                                    .foregroundStyle(.tertiary)
                            }
                            .padding(.horizontal, 16)
                            .frame(minHeight: 52)
                            .contentShape(.rect)
                        }
                        .buttonStyle(.plain)
                        .disabled(!available)
                        .opacity(available ? 1 : 0.45)
                    }
                }
                .card()
            }
            .task(id: network.isOnline ? "online" : shown.map(\.id).joined()) {
                guard !network.isOnline else { return }
                var hits = Set<String>()
                for recent in shown where await APIClient.shared.isCached(APIClient.searchURL(recent.params)) {
                    hits.insert(recent.id)
                }
                cached = hits
            }
        }
    }
}

private struct ResultsList: View {
    @Environment(SearchModel.self) private var model

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if let seed = model.similarSeed {
                HStack(spacing: 12) {
                    Image(systemName: "sparkles").foregroundStyle(Color.brand).font(.title3)
                    VStack(alignment: .leading, spacing: 1) {
                        Text("More like").font(.footnote).foregroundStyle(.secondary)
                        Text(seed.heading).font(.subheadline.weight(.semibold)).lineLimit(1)
                    }
                    Spacer(minLength: 0)
                    Button {
                        Task { await model.leaveSimilarAndReturn() }
                    } label: {
                        Image(systemName: "xmark").frame(width: 20, height: 20)
                    }
                    .buttonStyle(.glass)
                    .buttonBorderShape(.circle)
                    .accessibilityLabel(model.activeQuery.isEmpty ? "Clear" : "Back to search results")
                }
                .padding(.leading, 16)
                .padding(.trailing, 8)
                .padding(.vertical, 10)
                .card()
            }

            let results = model.sortedResults
            if results.isEmpty {
                if model.error == nil {
                    if model.loading {
                        ProgressView().frame(maxWidth: .infinity).padding(.top, 40)
                    } else {
                        Text("\(noResultsTitle) \(Text(noResultsHint).foregroundStyle(.secondary))")
                            .font(.body)
                            .padding(.horizontal, 4)
                            .padding(.top, 20)
                    }
                }
            } else {
                Text(model.countLabel)
                    .accessibilityIdentifier("resultCount")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, 4)
                LazyVStack(spacing: 12) {
                    ForEach(Array(results.enumerated()), id: \.offset) { _, passage in
                        ResultCard(passage: passage, showScore: true)
                    }
                }
                if model.canLoadMore {
                    Button {
                        Task { await model.loadMore() }
                    } label: {
                        Text(model.loadingMore ? "Loading…" : "Load more results")
                            .font(.subheadline.weight(.semibold))
                            .padding(.horizontal, 10)
                    }
                    .buttonStyle(.glass)
                    .controlSize(.large)
                    .disabled(model.loadingMore)
                    .frame(maxWidth: .infinity)
                    .padding(.top, 8)
                    if let error = model.loadMoreError, !model.loadingMore {
                        Text("Couldn’t load more. \(error)")
                            .font(.footnote)
                            .foregroundStyle(Color.destructiveText)
                            .multilineTextAlignment(.center)
                            .frame(maxWidth: .infinity)
                            .accessibilityIdentifier("loadMoreError")
                    }
                }
            }
        }
        .animation(.smooth, value: model.similarSeed?.id)
    }

    private var noResultsTitle: String {
        if let seed = model.similarSeed { return "No results like “\(seed.heading)”." }
        return model.activeQuery.isEmpty ? "No results." : "No results for “\(model.activeQuery)”."
    }

    private var noResultsHint: String {
        model.filters.isActive
            ? "Speaker and year filters only match Conference and BYU Speeches; try loosening them."
            : "Try fewer or different words, or switch search mode."
    }
}

/// Removable chips for the speaker and year filters.
struct ActiveFilterChips: View {
    @Environment(SearchModel.self) private var model

    var body: some View {
        if model.filters.isActive {
            HStack(spacing: 8) {
                if let speaker = model.filters.speaker {
                    chip(label: "Speaker", value: speaker) { model.filters.speaker = nil }
                }
                if let years = model.filters.yearLabel {
                    chip(label: "Years", value: years) {
                        model.filters.yearFrom = nil
                        model.filters.yearTo = nil
                    }
                }
                Spacer(minLength: 0)
            }
        }
    }

    private func chip(label: String, value: String, clear: @escaping () -> Void) -> some View {
        Button {
            clear()
            Task { await model.filtersChanged() }
        } label: {
            HStack(spacing: 4) {
                Text("\(label):").foregroundStyle(.secondary)
                Text(value).fontWeight(.semibold).lineLimit(1)
                Image(systemName: "xmark").font(.caption.weight(.bold)).foregroundStyle(.secondary)
            }
            .font(.subheadline)
            .padding(.horizontal, 12)
            .frame(height: 34)
            .background(Color.brand.opacity(0.12), in: .capsule)
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Remove \(label.lowercased()) filter \(value)")
    }
}
