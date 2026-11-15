import Foundation
import Observation

/// The Search tab's state and requests (the web's App.tsx search logic):
/// natural-language and reference searches, filters that re-run what's on
/// screen, "Load more", and "More like this".
@MainActor
@Observable
final class SearchModel {
    var queryType: QueryType = .natural {
        didSet {
            guard queryType != oldValue else { return }
            // A different kind of search starts from the start screen.
            goHome()
            fieldError = nil
        }
    }
    var query = ""
    var reference = "" {
        didSet { if reference != oldValue { scheduleVersePreview() } }
    }
    var sources: [Source] = []
    var filters = SearchFilters.none
    var sortBy: SortKey = .relevance
    var resultCount = defaultResultCount

    private(set) var results: [Passage] = []
    private(set) var hasSearched = false
    /// Requests in flight that show the spinner. A count, not a flag, so a
    /// request overtaken by another can't leave it spinning (or stopped).
    private var loads = 0
    var loading: Bool { loads > 0 }
    private(set) var loadingMore = false
    /// Why the last search failed, shown above the results.
    private(set) var error: String?
    /// Inline validation under the field ("Please enter …").
    private(set) var fieldError: String?
    /// The passage the results are "more like", while that view is up.
    private(set) var similarSeed: Passage?
    /// What the current results were searched for (for "No results for …").
    private(set) var activeQuery = ""

    /// The reference's verse, previewed under the field.
    private(set) var versePreview: Verse?

    @ObservationIgnored private var recents: RecentSearchStore?
    @ObservationIgnored private var request = 0
    @ObservationIgnored private var previewTask: Task<Void, Never>?

    func attach(recents: RecentSearchStore) { self.recents = recents }

    var sortedResults: [Passage] { sortPassages(results, by: sortBy) }

    var sourceCounts: [Source: Int] {
        results.reduce(into: [:]) { $0[$1.source, default: 0] += 1 }
    }

    /// Sources, speaker and the year range each count as one.
    var filterCount: Int {
        sources.count + (filters.speaker != nil ? 1 : 0) + (filters.yearFrom != nil || filters.yearTo != nil ? 1 : 0)
    }

    var canLoadMore: Bool {
        guard let i = resultCounts.firstIndex(of: resultCount), i + 1 < resultCounts.count else { return false }
        return results.count >= resultCount
    }

    var countLabel: String {
        (results.count == 1 ? "1 result" : "\(results.count) results")
            + (similarSeed != nil ? " — more like this" : queryType == .scripture ? " — reference lookup" : "")
    }

    var canSubmit: Bool {
        queryType == .natural
            ? !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            : versePreview != nil
    }

    private var currentQuery: String { queryType == .scripture ? reference : query }

    // MARK: Actions

    func submit() async {
        fieldError = nil
        if queryType == .natural, query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            fieldError = "Please enter a search query."
            return
        }
        if queryType == .scripture, versePreview == nil {
            fieldError = "Please enter a valid reference."
            return
        }
        guard !loading else { return }
        loads += 1
        defer { loads -= 1 }
        await run(count: resultCount, endingSimilar: true, showErrorInField: true)
    }

    /// Back to the start screen (tapping the Search tab again).
    func goHome() {
        leaveSimilar()
        request += 1
        results = []
        hasSearched = false
        error = nil
    }

    func runRecent(_ recent: RecentSearch) async {
        queryType = recent.queryType
        if recent.queryType == .scripture { reference = recent.query } else { query = recent.query }
        sources = recent.sources
        filters = recent.filters
        resultCount = resultCounts.contains(recent.resultCount) ? recent.resultCount : defaultResultCount
        loads += 1
        defer { loads -= 1 }
        await run(count: resultCount, endingSimilar: true, showErrorInField: false)
    }

    /// A `?q=` link: search for it.
    func open(query text: String) async {
        queryType = .natural
        query = text
        loads += 1
        defer { loads -= 1 }
        await run(count: resultCount, endingSimilar: true, showErrorInField: false)
    }

    /// Sources or filters changed: re-run what's on screen.
    func filtersChanged() async {
        guard hasSearched, !currentQuery.isEmpty || similarSeed != nil else { return }
        await rerun(count: resultCount)
    }

    func loadMore() async {
        guard let i = resultCounts.firstIndex(of: resultCount), i + 1 < resultCounts.count, !loadingMore else { return }
        let next = resultCounts[i + 1]
        loadingMore = true
        defer { loadingMore = false }
        resultCount = next
        await rerun(count: next)
    }

    func showSimilar(_ passage: Passage) async {
        guard let id = passage.apiID else { return }
        request += 1
        let mine = request
        similarSeed = passage
        loads += 1
        defer { loads -= 1 }
        do {
            let response = try await APIClient.shared.similar(
                id: id, count: resultCount, sources: sources, filters: filters)
            guard mine == request else { return }
            similarSeed = response.seed
            land(response.results)
        } catch is CancellationError {
        } catch {
            guard mine == request else { return }
            self.error = error.localizedDescription
            hasSearched = true
        }
    }

    /// The banner's close button: back to the query's own results, or home.
    func leaveSimilarAndReturn() async {
        guard similarSeed != nil else { return }
        leaveSimilar()
        if currentQuery.trimmingCharacters(in: .whitespaces).isEmpty {
            goHome()
        } else {
            await rerun(count: resultCount)
        }
    }

    // MARK: Internals

    private func leaveSimilar() {
        similarSeed = nil
    }

    private func land(_ next: [Passage]) {
        results = next
        hasSearched = true
        error = nil
    }

    private func rerun(count: Int) async {
        if let seed = similarSeed, let id = seed.apiID {
            request += 1
            let mine = request
            do {
                let response = try await APIClient.shared.similar(
                    id: id, count: count, sources: sources, filters: filters)
                guard mine == request else { return }
                land(response.results)
            } catch {
                guard mine == request else { return }
                self.error = error.localizedDescription
            }
            return
        }
        await run(count: count, endingSimilar: false, showErrorInField: false)
    }

    private func run(count: Int, endingSimilar: Bool, showErrorInField: Bool) async {
        let params = APIClient.SearchParams(
            queryType: queryType, query: currentQuery, count: count, sources: sources, filters: filters)
        request += 1
        let mine = request
        do {
            let next = try await APIClient.shared.search(params)
            guard mine == request else { return }
            if endingSimilar { leaveSimilar() }
            activeQuery = params.query
            recents?.add(params)
            land(next)
        } catch is CancellationError {
        } catch {
            guard mine == request else { return }
            if showErrorInField {
                fieldError = error.localizedDescription
            } else {
                self.error = error.localizedDescription
                hasSearched = true
            }
        }
    }

    /// Validates and previews the typed reference, debounced.
    private func scheduleVersePreview() {
        previewTask?.cancel()
        let ref = reference.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !ref.isEmpty else {
            versePreview = nil
            return
        }
        previewTask = Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(350))
            guard !Task.isCancelled else { return }
            let verse = await APIClient.shared.verse(reference: ref)
            guard !Task.isCancelled, let self else { return }
            self.versePreview = verse
            if verse != nil { self.fieldError = nil }
        }
    }
}
