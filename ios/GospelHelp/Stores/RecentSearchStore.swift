import Foundation
import Observation

struct RecentSearch: Codable, Hashable, Identifiable, Sendable {
    var queryType: QueryType
    var query: String
    var sources: [Source]
    var filters: SearchFilters
    var resultCount: Int
    var at: Date

    /// Same search whatever the count: "Load more" updates it in place.
    var id: String {
        [queryType.rawValue, query.trimmingCharacters(in: .whitespaces).lowercased(),
         sources.map(\.rawValue).sorted().joined(separator: ","),
         filters.speaker ?? "", filters.yearFrom.map(String.init) ?? "", filters.yearTo.map(String.init) ?? ""]
            .joined(separator: "|")
    }

    var params: APIClient.SearchParams {
        .init(queryType: queryType, query: query, count: resultCount, sources: sources, filters: filters)
    }

    /// What narrowed the search, for the row's second line.
    var detail: String? {
        var parts: [String] = []
        if sources.count == 1 { parts.append(sources[0].label) }
        else if sources.count > 1 { parts.append("\(sources.count) sources") }
        if let speaker = filters.speaker { parts.append(speaker) }
        if filters.yearFrom != nil || filters.yearTo != nil {
            parts.append("\(filters.yearFrom.map(String.init) ?? "…")–\(filters.yearTo.map(String.init) ?? "…")")
        }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }
}

/// Searches run on this device, newest first (parameters only; the results
/// sit in the API response cache).
@MainActor
@Observable
final class RecentSearchStore {
    private(set) var items: [RecentSearch] = []
    private let key = "gs-recent-searches"
    private let limit = 20
    private let defaults: UserDefaults

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        if AppConfig.resetState { defaults.removeObject(forKey: key) }
        if let data = defaults.data(forKey: key),
           let decoded = try? JSONDecoder().decode([RecentSearch].self, from: data) {
            items = decoded
        }
    }

    func add(_ params: APIClient.SearchParams) {
        let query = params.query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !query.isEmpty else { return }
        let entry = RecentSearch(
            queryType: params.queryType, query: query, sources: params.sources,
            filters: params.filters, resultCount: params.count, at: .now)
        save(Array(([entry] + items.filter { $0.id != entry.id }).prefix(limit)))
    }

    func clear() { save([]) }

    private func save(_ next: [RecentSearch]) {
        items = next
        defaults.set(try? JSONEncoder().encode(next), forKey: key)
    }
}
