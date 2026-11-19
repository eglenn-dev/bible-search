import CryptoKit
import Foundation

/// A failure worth showing as-is.
struct APIError: LocalizedError, Sendable {
    var message: String
    /// No response at all (offline, or the API unreachable).
    var unreachable = false
    var errorDescription: String? { message }
}

enum AppConfig {
    /// The search API. `-GHAPIBaseURL <url>` on launch overrides Info.plist.
    static var apiBase: URL {
        if let override = UserDefaults.standard.string(forKey: "GHAPIBaseURL"),
           let url = URL(string: override) {
            return url
        }
        let raw = Bundle.main.object(forInfoDictionaryKey: "GHAPIBaseURL") as? String
        return URL(string: raw ?? "https://api.gospel.help")!
    }

    /// The web app, where shared links open.
    static var webBase: String {
        (Bundle.main.object(forInfoDictionaryKey: "GHWebBaseURL") as? String) ?? "https://gospel.help"
    }

    static var mcpURL: String { apiBase.appending(path: "mcp").absoluteString }

    /// UI tests launch with `-GHResetState` to start from a fresh install.
    static let resetState = ProcessInfo.processInfo.arguments.contains("-GHResetState")
}

/// Talks to the FastAPI backend. GET responses are also kept on disk so a
/// recent search, or a saved passage's context, still opens offline (the web
/// app's service worker does the same).
actor APIClient {
    static let shared = APIClient()

    private let session: URLSession
    private let cache: ResponseCache
    private let decoder = JSONDecoder()
    private let base: URL?
    private let isOnline: @Sendable () -> Bool

    /// Tests pass a stub `URLProtocol`, a scratch cache and a fixed base URL.
    init(
        protocolClasses: [AnyClass]? = nil,
        cache: ResponseCache = ResponseCache(),
        base: URL? = nil,
        isOnline: @escaping @Sendable () -> Bool = { NetworkMonitor.shared.isOnline }
    ) {
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 75 // the free-tier API cold-starts
        config.waitsForConnectivity = false
        config.requestCachePolicy = .reloadIgnoringLocalCacheData
        if let protocolClasses { config.protocolClasses = protocolClasses }
        session = URLSession(configuration: config)
        self.cache = cache
        self.base = base
        self.isOnline = isOnline
    }

    /// What a failed GET says when there's no connection and nothing saved.
    enum Offline {
        static let search = "You’re offline. This search isn’t saved on this device yet."
        static let generic = "You’re offline, and this isn’t saved on this device yet."
    }

    // MARK: Requests

    func search(_ params: SearchParams) async throws -> [Passage] {
        let response: SearchResponse = try await get(
            Self.searchURL(params, base: base), fallback: "Failed to fetch results.", offline: Offline.search)
        return response.results
    }

    func similar(id: String, count: Int, sources: [Source], filters: SearchFilters) async throws -> SimilarResponse {
        var items = [URLQueryItem(name: "id", value: id), URLQueryItem(name: "k", value: String(count))]
        items += Self.commonItems(sources: sources, filters: filters)
        var response: SimilarResponse = try await get(
            Self.url("search/similar", items, base: base), fallback: "Failed to fetch similar passages.",
            offline: Offline.search)
        // The seed is a passage, not a hit; it has no score of its own.
        response.seed.score = 1
        return response
    }

    func context(id: String) async throws -> PassageContext {
        try await get(
            Self.url("passage/context", [
                URLQueryItem(name: "id", value: id),
                URLQueryItem(name: "before", value: "2"),
                URLQueryItem(name: "after", value: "2"),
            ], base: base),
            fallback: "Couldn’t load the surrounding text.")
    }

    enum VerseLookup: Sendable, Equatable {
        case found(Verse)
        /// The API answered: this isn't a reference it knows.
        case notFound
        /// No answer (offline, or the API down) and nothing saved: can't tell.
        case unavailable
    }

    /// A reference's verse, telling "not a reference" apart from "couldn't
    /// check". Kept on disk like other GETs so a known reference still
    /// checks out offline.
    func verse(reference: String) async -> VerseLookup {
        let url = Self.url("verse", [URLQueryItem(name: "reference", value: reference)], base: base)
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(from: url)
        } catch {
            return await cachedVerse(url)
        }
        switch (response as? HTTPURLResponse)?.statusCode ?? 0 {
        case 200:
            guard let verse = try? decoder.decode(Verse.self, from: data) else { return .notFound }
            await cache.put(url, data)
            return .found(verse)
        case 400..<500:
            return .notFound
        default:
            // A 5xx (the API waking up, say) says nothing about the reference.
            return await cachedVerse(url)
        }
    }

    private func cachedVerse(_ url: URL) async -> VerseLookup {
        guard let data = await cache.get(url), let verse = try? decoder.decode(Verse.self, from: data) else {
            return .unavailable
        }
        return .found(verse)
    }

    func speakers() async throws -> [SpeakerOption] {
        let response: SpeakersResponse = try await get(
            Self.url("speakers", [URLQueryItem(name: "variants", value: "false")], base: base),
            fallback: "Failed to load speakers.")
        return response.speakers
    }

    func stats() async throws -> Data {
        // Shown as "The stats are unavailable right now. <this>".
        try await getData(
            Self.url("stats", [], base: base), fallback: "Failed to fetch stats.",
            offline: "You’re offline, and they haven’t been saved on this device yet.")
    }

    /// True when the health check answers.
    func health() async -> Result<Void, APIError> {
        do {
            let (_, response) = try await session.data(from: Self.url("", [], base: base))
            guard (response as? HTTPURLResponse)?.statusCode == 200 else {
                return .failure(APIError(message: "The search service is unavailable."))
            }
            return .success(())
        } catch {
            return .failure(APIError(message: "Can’t reach the search service.", unreachable: true))
        }
    }

    /// Whether a GET for this URL is stored for offline use.
    func isCached(_ url: URL) async -> Bool { await cache.has(url) }

    // MARK: URLs

    struct SearchParams: Sendable, Hashable {
        var queryType: QueryType
        var query: String
        var count: Int
        var sources: [Source]
        var filters: SearchFilters
    }

    static func searchURL(_ p: SearchParams, base: URL? = nil) -> URL {
        if p.queryType == .scripture {
            return url("search/by-reference", [
                URLQueryItem(name: "reference", value: p.query.trimmingCharacters(in: .whitespacesAndNewlines)),
                URLQueryItem(name: "k", value: String(p.count)),
            ] + commonItems(sources: p.sources, filters: p.filters), base: base)
        }
        return url("search", [
            URLQueryItem(name: "query", value: p.query),
            URLQueryItem(name: "k", value: String(p.count)),
        ] + commonItems(sources: p.sources, filters: p.filters), base: base)
    }

    private static func commonItems(sources: [Source], filters: SearchFilters) -> [URLQueryItem] {
        var items: [URLQueryItem] = []
        if !sources.isEmpty {
            items.append(URLQueryItem(name: "sources", value: sources.map(\.rawValue).joined(separator: ",")))
        }
        if let speaker = filters.speaker { items.append(URLQueryItem(name: "speaker", value: speaker)) }
        if let from = filters.yearFrom { items.append(URLQueryItem(name: "year_from", value: String(from))) }
        if let to = filters.yearTo { items.append(URLQueryItem(name: "year_to", value: String(to))) }
        return items
    }

    static func url(_ path: String, _ items: [URLQueryItem], base: URL? = nil) -> URL {
        var url = base ?? AppConfig.apiBase
        if !path.isEmpty { url.append(path: path) } else { url.append(path: "/") }
        if !items.isEmpty {
            var components = URLComponents(url: url, resolvingAgainstBaseURL: false)!
            components.queryItems = items
            // "+" would read as a space on the server.
            components.percentEncodedQuery = components.percentEncodedQuery?
                .replacingOccurrences(of: "+", with: "%2B")
            url = components.url!
        }
        return url
    }

    // MARK: Plumbing

    private func get<T: Decodable>(
        _ url: URL, fallback: String, offline: String = Offline.generic
    ) async throws -> T {
        let data = try await getData(url, fallback: fallback, offline: offline)
        do {
            return try decoder.decode(T.self, from: data)
        } catch {
            throw APIError(message: fallback)
        }
    }

    private func getData(_ url: URL, fallback: String, offline: String = Offline.generic) async throws -> Data {
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(from: url)
        } catch {
            if let cached = await cache.get(url) { return cached }
            if (error as? URLError)?.code == .cancelled { throw CancellationError() }
            throw APIError(
                message: isOnline()
                    ? "Couldn’t reach the search service. Check your connection and try again."
                    : offline,
                unreachable: true)
        }
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard status == 200 else {
            // The API explains filter problems in `detail`.
            if let body = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
               let detail = body["detail"] as? String, !detail.isEmpty {
                throw APIError(message: detail)
            }
            throw APIError(message: fallback)
        }
        await cache.put(url, data)
        return data
    }
}

/// GET responses on disk, keyed by URL, for offline reading. Capped by count.
actor ResponseCache {
    private let directory: URL
    private let limit = 400

    init(directory: URL? = nil) {
        let fm = FileManager.default
        let dir = directory ?? fm.urls(for: .cachesDirectory, in: .userDomainMask)[0]
            .appending(path: "api-responses", directoryHint: .isDirectory)
        self.directory = dir
        try? fm.createDirectory(at: dir, withIntermediateDirectories: true)
        // Files named by the old 32-bit hash could answer for the wrong URL.
        for file in (try? fm.contentsOfDirectory(at: dir, includingPropertiesForKeys: nil)) ?? []
        where !Self.isCurrentName(file.deletingPathExtension().lastPathComponent) {
            try? fm.removeItem(at: file)
        }
    }

    /// The file name for a URL: its SHA-256, so two URLs never share one.
    static func key(for url: URL) -> String {
        SHA256.hash(data: Data(url.absoluteString.utf8)).map { String(format: "%02x", $0) }.joined()
    }

    private static func isCurrentName(_ name: String) -> Bool {
        name.count == 64 && name.allSatisfy(\.isHexDigit)
    }

    private func file(for url: URL) -> URL {
        directory.appending(path: Self.key(for: url) + ".json")
    }

    func get(_ url: URL) -> Data? { try? Data(contentsOf: file(for: url)) }

    func has(_ url: URL) -> Bool { FileManager.default.fileExists(atPath: file(for: url).path) }

    func put(_ url: URL, _ data: Data) {
        try? data.write(to: file(for: url), options: .atomic)
        prune()
    }

    private func prune() {
        let fm = FileManager.default
        guard let files = try? fm.contentsOfDirectory(
            at: directory, includingPropertiesForKeys: [.contentModificationDateKey]),
            files.count > limit else { return }
        let dated = files.map { url in
            (url, (try? url.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? .distantPast)
        }
        for (url, _) in dated.sorted(by: { $0.1 < $1.1 }).prefix(files.count - limit) {
            try? fm.removeItem(at: url)
        }
    }
}
