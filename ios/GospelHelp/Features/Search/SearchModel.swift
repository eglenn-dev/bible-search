import Foundation
import Observation

/// The Search tab's state and requests (the web's App.tsx search logic):
/// natural-language and reference searches, filters that re-run what's on
/// screen, "Load more", and "More like this".
@MainActor
@Observable
final class SearchModel {
    /// Where a typed reference stands, checked against `GET /verse`.
    enum ReferenceCheck: Equatable {
        case idle
        /// Typed since the last answer; checked after a short pause.
        case checking
        case found(Verse)
        /// The API says it isn't a reference.
        case notFound
        /// Couldn't check (offline, or the API down) and it isn't saved.
        /// The search itself may still be saved, so it's allowed.
        case unavailable
    }

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
        didSet { if reference != oldValue { referenceChanged() } }
    }
    var sources: [Source] = []
    var filters = SearchFilters.none
    var sortBy: SortKey = .relevance
    var resultCount = defaultResultCount

    private(set) var results: [Passage] = []
    private(set) var hasSearched = false
    /// The current request shows the spinner. Requests that were overtaken
    /// (a newer search, or back to the start screen) don't count.
    private(set) var loading = false
    private(set) var loadingMore = false
    /// Why the last search failed, shown above the results.
    private(set) var error: String?
    /// Why "Load more" failed, shown by its button (the results stay).
    private(set) var loadMoreError: String?
    /// Inline validation under the field ("Please enter …").
    private(set) var fieldError: String?
    /// The passage the results are "more like", while that view is up.
    private(set) var similarSeed: Passage?
    /// What the current results were searched for (for "No results for …").
    private(set) var activeQuery = ""
    /// Bumped when a new set of results lands (not "Load more"): the list
    /// scrolls back to the top.
    private(set) var scrollGeneration = 0

    private(set) var referenceCheck: ReferenceCheck = .idle
    /// The last verse found, still shown (dimmed) while an edit is checked.
    private(set) var shownVerse: Verse?

    /// The reference's verse, once the current text has checked out.
    var versePreview: Verse? {
        if case .found(let verse) = referenceCheck { verse } else { nil }
    }

    @ObservationIgnored private let api: APIClient
    @ObservationIgnored private var recents: RecentSearchStore?
    @ObservationIgnored private var request = 0
    /// What the spinning request is searching for, so pressing Return again
    /// on the same search doesn't start it twice.
    @ObservationIgnored private var pendingParams: APIClient.SearchParams?
    @ObservationIgnored private var previewTask: Task<Void, Never>?

    init(api: APIClient = .shared) {
        self.api = api
    }

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
        guard queryType == .scripture else {
            return !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        }
        switch referenceCheck {
        case .found, .unavailable: return true
        case .idle, .checking, .notFound: return false
        }
    }

    private var currentQuery: String { queryType == .scripture ? reference : query }
    private var trimmedReference: String { reference.trimmingCharacters(in: .whitespacesAndNewlines) }

    private func params(count: Int) -> APIClient.SearchParams {
        APIClient.SearchParams(
            queryType: queryType, query: currentQuery, count: count, sources: sources, filters: filters)
    }

    // MARK: Actions

    func submit() async {
        fieldError = nil
        if queryType == .natural, query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            fieldError = "Please enter a search query."
            return
        }
        if queryType == .scripture {
            // Return during the pause after typing: check it now.
            if referenceCheck == .checking {
                previewTask?.cancel()
                await checkReference(trimmedReference)
            }
            switch referenceCheck {
            case .found, .unavailable: break
            case .idle, .checking, .notFound:
                fieldError = "Please enter a valid reference."
                return
            }
        }
        let next = params(count: resultCount)
        // The same search is already on its way.
        if loading, pendingParams == next { return }
        await run(next, spinner: true, endingSimilar: true, showErrorInField: true, scroll: true)
    }

    /// Back to the start screen (tapping the Search tab again).
    func goHome() {
        leaveSimilar()
        request += 1
        loading = false
        results = []
        hasSearched = false
        error = nil
        loadMoreError = nil
        scrollGeneration += 1
    }

    func runRecent(_ recent: RecentSearch) async {
        queryType = recent.queryType
        if recent.queryType == .scripture { reference = recent.query } else { query = recent.query }
        sources = recent.sources
        filters = recent.filters
        resultCount = resultCounts.contains(recent.resultCount) ? recent.resultCount : defaultResultCount
        await run(params(count: resultCount), spinner: true, endingSimilar: true, showErrorInField: false, scroll: true)
    }

    /// A `?q=` link: search for it.
    func open(query text: String) async {
        queryType = .natural
        query = text
        await run(params(count: resultCount), spinner: true, endingSimilar: true, showErrorInField: false, scroll: true)
    }

    /// Sources or filters changed: re-run what's on screen.
    func filtersChanged() async {
        guard hasSearched, !currentQuery.isEmpty || similarSeed != nil else { return }
        await rerun(count: resultCount, scroll: true)
    }

    /// The next size up, keeping the reader's place. The new size only
    /// sticks once it has loaded, so a failure leaves the button there to
    /// try again.
    func loadMore() async {
        guard let i = resultCounts.firstIndex(of: resultCount), i + 1 < resultCounts.count, !loadingMore else { return }
        let next = resultCounts[i + 1]
        loadingMore = true
        defer { loadingMore = false }
        if await rerun(count: next, scroll: false) {
            resultCount = next
        } else if let error {
            loadMoreError = error
            self.error = nil
        }
    }

    func showSimilar(_ passage: Passage) async {
        guard let id = passage.apiID else { return }
        let mine = begin(spinner: true)
        defer { end(mine) }
        similarSeed = passage
        do {
            let response = try await api.similar(id: id, count: resultCount, sources: sources, filters: filters)
            guard mine == request else { return }
            similarSeed = response.seed
            land(response.results, scroll: true)
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
            await rerun(count: resultCount, scroll: true)
        }
    }

    // MARK: Internals

    private func leaveSimilar() {
        similarSeed = nil
    }

    /// Starts a request, overtaking any before it.
    private func begin(spinner: Bool) -> Int {
        request += 1
        loading = spinner
        if !spinner { pendingParams = nil }
        return request
    }

    private func end(_ mine: Int) {
        guard mine == request else { return }
        loading = false
        pendingParams = nil
    }

    private func land(_ next: [Passage], scroll: Bool) {
        results = next
        hasSearched = true
        error = nil
        loadMoreError = nil
        if scroll { scrollGeneration += 1 }
    }

    /// True when its results landed.
    @discardableResult
    private func rerun(count: Int, scroll: Bool) async -> Bool {
        if let seed = similarSeed, let id = seed.apiID {
            let mine = begin(spinner: false)
            defer { end(mine) }
            do {
                let response = try await api.similar(id: id, count: count, sources: sources, filters: filters)
                guard mine == request else { return false }
                land(response.results, scroll: scroll)
                return true
            } catch {
                guard mine == request, !(error is CancellationError) else { return false }
                self.error = error.localizedDescription
                return false
            }
        }
        return await run(params(count: count), spinner: false, endingSimilar: false, showErrorInField: false, scroll: scroll)
    }

    /// True when its results landed.
    @discardableResult
    private func run(
        _ params: APIClient.SearchParams, spinner: Bool, endingSimilar: Bool, showErrorInField: Bool, scroll: Bool
    ) async -> Bool {
        let mine = begin(spinner: spinner)
        if spinner { pendingParams = params }
        defer { end(mine) }
        do {
            let next = try await api.search(params)
            guard mine == request else { return false }
            if endingSimilar { leaveSimilar() }
            activeQuery = params.query
            recents?.add(params)
            land(next, scroll: scroll)
            return true
        } catch is CancellationError {
            return false
        } catch {
            guard mine == request else { return false }
            if showErrorInField {
                fieldError = error.localizedDescription
            } else {
                self.error = error.localizedDescription
                hasSearched = true
            }
            return false
        }
    }

    /// The reference changed: it's unchecked until the API says otherwise,
    /// so an edit can't be searched on the strength of the old text.
    private func referenceChanged() {
        previewTask?.cancel()
        let ref = trimmedReference
        guard !ref.isEmpty else {
            referenceCheck = .idle
            shownVerse = nil
            return
        }
        referenceCheck = .checking
        previewTask = Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(350))
            guard !Task.isCancelled else { return }
            await self?.checkReference(ref)
        }
    }

    private func checkReference(_ ref: String) async {
        let result = await api.verse(reference: ref)
        // Typed on since: that text gets its own check.
        guard ref == trimmedReference, referenceCheck == .checking else { return }
        switch result {
        case .found(let verse):
            referenceCheck = .found(verse)
            shownVerse = verse
            fieldError = nil
        case .notFound:
            referenceCheck = .notFound
            shownVerse = nil
        case .unavailable:
            referenceCheck = .unavailable
            shownVerse = nil
        }
    }
}
