import Foundation
import Testing
@testable import GospelHelp

// Regression tests for the code review of PR #31. The search model runs
// against a stubbed network (`StubServer`), one host per test so the
// suites can run in parallel.

// MARK: Stub network

struct StubReply: Sendable {
    var status = 200
    var body = Data()
    var delay: TimeInterval = 0
    /// Fail like a dropped connection instead of answering.
    var failure: URLError.Code?

    static func json(_ object: Any, delay: TimeInterval = 0) -> StubReply {
        StubReply(body: try! JSONSerialization.data(withJSONObject: object), delay: delay)
    }

    static let offline = StubReply(failure: .notConnectedToInternet)
}

/// Answers requests for its own host with `handler`, and records them.
final class StubServer: @unchecked Sendable {
    let host = "t\(UUID().uuidString.prefix(8).lowercased()).test"
    private let lock = NSLock()
    private var _handler: @Sendable (URLRequest) -> StubReply = { _ in StubReply(status: 404) }
    private var _requests: [URL] = []

    var base: URL { URL(string: "https://\(host)")! }

    init() { StubProtocol.register(self) }

    func handle(_ handler: @escaping @Sendable (URLRequest) -> StubReply) {
        lock.withLock { _handler = handler }
    }

    var requests: [URL] { lock.withLock { _requests } }

    fileprivate func reply(to request: URLRequest) -> StubReply {
        lock.withLock {
            _requests.append(request.url!)
            return _handler(request)
        }
    }

    /// A client for this server with its own empty cache (or `cacheDir`).
    func client(cacheDir: URL? = nil, online: Bool = true) -> APIClient {
        let dir = cacheDir ?? FileManager.default.temporaryDirectory.appending(path: "cache-" + UUID().uuidString)
        return APIClient(
            protocolClasses: [StubProtocol.self], cache: ResponseCache(directory: dir), base: base,
            isOnline: { online })
    }
}

final class StubProtocol: URLProtocol, @unchecked Sendable {
    nonisolated(unsafe) private static var servers: [String: StubServer] = [:]
    private static let lock = NSLock()
    private var cancelled = false

    static func register(_ server: StubServer) {
        lock.withLock { servers[server.host] = server }
    }

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        let server = Self.lock.withLock { Self.servers[request.url?.host() ?? ""] }
        let reply = server?.reply(to: request) ?? StubReply(status: 404)
        DispatchQueue.global().asyncAfter(deadline: .now() + reply.delay) { [self] in
            guard !cancelled else { return }
            if let failure = reply.failure {
                client?.urlProtocol(self, didFailWithError: URLError(failure))
                return
            }
            let response = HTTPURLResponse(
                url: request.url!, statusCode: reply.status, httpVersion: nil,
                headerFields: ["Content-Type": "application/json"])!
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: reply.body)
            client?.urlProtocolDidFinishLoading(self)
        }
    }

    override func stopLoading() { cancelled = true }
}

extension URLRequest {
    func query(_ name: String) -> String? {
        URLComponents(url: url!, resolvingAgainstBaseURL: false)?.queryItems?.first { $0.name == name }?.value
    }
    var path: String { url!.path() }
}

/// `k` passages whose references name the query, so a test can tell which
/// search's results are showing.
func results(for query: String, k: Int) -> [String: Any] {
    ["results": (0..<k).map { i in
        [
            "id": "bible:\(query) \(i)", "source": "bible", "reference": "\(query) \(i)",
            "text": "Text \(i) for \(query).", "url": "https://www.churchofjesuschrist.org/x/\(i)", "score": 0.9,
        ]
    }]
}

/// Waits (up to two seconds) for something the model does on its own.
@MainActor
func eventually(_ condition: @MainActor () -> Bool) async -> Bool {
    for _ in 0..<200 {
        if condition() { return true }
        try? await Task.sleep(for: .milliseconds(10))
    }
    return condition()
}

// MARK: Search

@Suite @MainActor struct SearchModelTests {
    /// Searches answer with `k` results; `failing` drops every request.
    final class Flags: @unchecked Sendable {
        var failing = false
    }

    private func searchServer(_ flags: Flags = Flags(), slow: Set<String> = []) -> StubServer {
        let server = StubServer()
        server.handle { request in
            if flags.failing { return .offline }
            let q = request.query("query") ?? request.query("reference") ?? ""
            let k = Int(request.query("k") ?? "") ?? 20
            return .json(results(for: q, k: k), delay: slow.contains(q) ? 0.8 : 0)
        }
        return server
    }

    @Test func loadMoreKeepsThePlaceAndOnlyCommitsOnSuccess() async {
        let flags = Flags()
        let model = SearchModel(api: searchServer(flags).client())
        model.query = "faith"
        await model.submit()
        #expect(model.results.count == 20)
        let landed = model.scrollGeneration

        // Load more: more results, same scroll position.
        await model.loadMore()
        #expect(model.results.count == 30)
        #expect(model.resultCount == 30)
        #expect(model.scrollGeneration == landed)

        // A failed load more keeps the count and the button.
        flags.failing = true
        await model.loadMore()
        #expect(model.resultCount == 30)
        #expect(model.results.count == 30)
        #expect(model.canLoadMore)
        // Said by the button, not above the results the reader scrolled past.
        #expect(model.loadMoreError != nil)
        #expect(model.error == nil)

        // And works again once the connection is back.
        flags.failing = false
        await model.loadMore()
        #expect(model.resultCount == 40)
        #expect(model.results.count == 40)
        #expect(model.loadMoreError == nil)

        // A new search does go back to the top.
        model.query = "hope"
        await model.submit()
        #expect(model.scrollGeneration > landed)
    }

    @Test func aNewSearchOvertakesASlowOne() async {
        let server = searchServer(slow: ["grace"])
        let model = SearchModel(api: server.client())
        model.query = "grace"
        let first = Task { await model.submit() }
        #expect(await eventually { model.loading })

        // Return on the same search again doesn't send it twice.
        await model.submit()
        #expect(server.requests.count == 1)

        // A different search goes out now rather than being dropped.
        model.query = "mercy"
        await model.submit()
        #expect(model.results.first?.reference == "mercy 0")
        #expect(!model.loading)

        // The slow one finishing later doesn't replace it.
        await first.value
        #expect(model.results.first?.reference == "mercy 0")
        #expect(!model.loading)
        #expect(server.requests.count == 2)
    }

    @Test func backToStartStopsTheSpinner() async {
        let model = SearchModel(api: searchServer(slow: ["grace"]).client())
        model.query = "grace"
        let first = Task { await model.submit() }
        #expect(await eventually { model.loading })
        model.goHome()
        #expect(!model.loading)
        await first.value
        #expect(!model.hasSearched)
        #expect(!model.loading)
    }
}

@Suite @MainActor struct ReferenceCheckTests {
    private let alma = ["source": "book-of-mormon", "reference": "Alma 32:21", "text": "Faith is not to have a perfect knowledge."]

    /// A server that knows Alma 32:21 and nothing else, until it goes away.
    private func server(_ down: SearchModelTests.Flags) -> StubServer {
        let server = StubServer()
        let alma = alma
        server.handle { request in
            if down.failing { return .offline }
            let ref = request.query("reference") ?? ""
            switch request.path {
            case "/verse":
                return ref == "Alma 32:21" ? .json(alma) : StubReply(status: 404, body: Data(#"{"detail":"Not found"}"#.utf8))
            case "/search/by-reference":
                return .json(results(for: ref, k: 5))
            default:
                return StubReply(status: 404)
            }
        }
        return server
    }

    @Test func aKnownReferenceStillSearchesOffline() async {
        let down = SearchModelTests.Flags()
        let stub = server(down)
        let cache = FileManager.default.temporaryDirectory.appending(path: "cache-" + UUID().uuidString)

        // Online: checked, searched, both kept on disk.
        let online = SearchModel(api: stub.client(cacheDir: cache))
        online.queryType = .scripture
        online.reference = "Alma 32:21"
        #expect(await eventually { online.versePreview != nil })
        await online.submit()
        #expect(online.results.count == 5)

        // Offline: the saved check and the saved results still work.
        down.failing = true
        let offline = SearchModel(api: stub.client(cacheDir: cache, online: false))
        offline.queryType = .scripture
        offline.reference = "Alma 32:21"
        #expect(await eventually { offline.versePreview != nil })
        #expect(offline.canSubmit)
        await offline.submit()
        #expect(offline.fieldError == nil)
        #expect(offline.results.count == 5)
    }

    @Test func anUncheckedReferenceCanBeSearchedAndExplainsItself() async {
        let down = SearchModelTests.Flags()
        down.failing = true
        let model = SearchModel(api: server(down).client(online: false))
        model.queryType = .scripture
        model.reference = "Moroni 10:4"
        #expect(await eventually { model.referenceCheck == .unavailable })
        #expect(model.canSubmit)
        await model.submit()
        // Not "Please enter a valid reference.": it says what's wrong.
        #expect(model.fieldError == APIClient.Offline.search)
    }

    @Test func notAReferenceIsRefused() async {
        let model = SearchModel(api: server(SearchModelTests.Flags()).client())
        model.queryType = .scripture
        model.reference = "nonsense"
        #expect(await eventually { model.referenceCheck == .notFound })
        #expect(!model.canSubmit)
        await model.submit()
        #expect(model.fieldError == "Please enter a valid reference.")
        #expect(!model.hasSearched)
    }

    @Test func anEditIsntSearchedOnTheOldCheck() async {
        let stub = server(SearchModelTests.Flags())
        let model = SearchModel(api: stub.client())
        model.queryType = .scripture
        model.reference = "Alma 32:21"
        #expect(await eventually { model.versePreview != nil })

        // Edited into something invalid: unchecked straight away.
        model.reference = "Alma 32:21x"
        #expect(model.versePreview == nil)
        #expect(!model.canSubmit)
        #expect(model.shownVerse?.reference == "Alma 32:21") // still shown, faded
        // Return before the pause ends checks it there and then.
        await model.submit()
        #expect(model.fieldError == "Please enter a valid reference.")
        #expect(!stub.requests.contains { $0.path() == "/search/by-reference" })
        #expect(model.shownVerse == nil)
    }

    @Test func returnDuringThePauseSearchesAValidReference() async {
        let model = SearchModel(api: server(SearchModelTests.Flags()).client())
        model.queryType = .scripture
        model.reference = "Alma 32:21"
        await model.submit()
        #expect(model.fieldError == nil)
        #expect(model.results.count == 5)
    }

    @Test func aServerErrorIsntANotFound() async {
        let stub = StubServer()
        stub.handle { _ in StubReply(status: 502) }
        let model = SearchModel(api: stub.client())
        model.queryType = .scripture
        model.reference = "Alma 32:21"
        #expect(await eventually { model.referenceCheck == .unavailable })
        #expect(model.canSubmit)
    }
}

// MARK: Offline messages

@Suite struct OfflineMessageTests {
    @Test func messagesFitWhatFailed() async {
        let stub = StubServer()
        stub.handle { _ in .offline }
        let api = stub.client(online: false)
        await #expect(throws: APIError(message: APIClient.Offline.search, unreachable: true)) {
            _ = try await api.search(.init(queryType: .natural, query: "x", count: 10, sources: [], filters: .none))
        }
        do {
            _ = try await api.stats()
            Issue.record("expected a failure")
        } catch {
            #expect(!error.localizedDescription.contains("search"))
            #expect(error.localizedDescription.hasPrefix("You’re offline"))
        }
        do {
            _ = try await api.context(id: "bible:Alma 32:21")
            Issue.record("expected a failure")
        } catch {
            #expect(error.localizedDescription == APIClient.Offline.generic)
        }
    }
}

extension APIError: Equatable {
    public static func == (a: APIError, b: APIError) -> Bool {
        a.message == b.message && a.unreachable == b.unreachable
    }
}

// MARK: Ask

@Suite struct QuestionInputTests {
    private func apply(_ old: String, _ new: String, limit: Int = 500) -> (String, Bool) {
        let r = QuestionInput.apply(old: old, new: new, limit: limit)
        return (r.text, r.submit)
    }

    @Test func returnAsks() {
        #expect(apply("Why", "Why\n") == ("Why", true))
        // Return with the cursor mid-question asks too, without the break.
        #expect(apply("Whyfaith", "Why\nfaith") == ("Whyfaith", true))
        #expect(apply("", "\n") == ("", true))
    }

    @Test func pastedLinesAreJoinedNotSent() {
        #expect(apply("", "grace.\nWhy") == ("grace. Why", false))
        #expect(apply("", "one  \r\n\r\n  two\u{2028}three") == ("one two three", false))
        #expect(apply("Q: ", "Q: \nfirst\nsecond") == ("Q: first second", false))
        #expect(apply("", "\nleading") == ("leading", false))
    }

    @Test func theCapAppliesToPastesAndReturn() {
        let long = String(repeating: "word ", count: 70) + "\n\n" + String(repeating: "more ", count: 70)
        let (text, submit) = apply("", long)
        #expect(text.count == 500)
        #expect(!submit)
        let hasBreak = text.contains(where: \.isNewline)
        #expect(!hasBreak)

        #expect(apply("", String(repeating: "a", count: 600)).0.count == 500)
        let full = String(repeating: "a", count: 500)
        #expect(apply(full, full + "\n") == (full, true))
        // Typing within the limit is left alone.
        #expect(apply("Why", "Why ") == ("Why ", false))
    }
}

// MARK: Duplicates in shared collections

@Suite @MainActor struct DuplicateImportTests {
    private let withID = Passage(
        apiID: "bible:Hebrews 11:1", source: .bible, reference: "Hebrews 11:1", text: "Now faith is the substance.",
        title: nil, url: "https://www.churchofjesuschrist.org/study/scriptures/nt/heb/11?id=p1#p1", score: 0.9, metadata: [:])

    private var withoutID: Passage {
        var p = withID
        p.apiID = nil
        return p
    }

    @Test func importSkipsALaterLegacyCopy() {
        let store = BookmarkStore(fileURL: FileManager.default.temporaryDirectory.appending(path: UUID().uuidString + ".json"))
        #expect(store.importPassages([withID, withoutID]) == 1)
        #expect(store.count == 1)
        // Either order.
        let other = BookmarkStore(fileURL: FileManager.default.temporaryDirectory.appending(path: UUID().uuidString + ".json"))
        #expect(other.importPassages([withoutID, withID]) == 1)
    }

    @Test func linksDropTheRepeat() throws {
        let token = try ShareCodec.pack(["p": [ShareCodec.toWire(withID), ShareCodec.toWire(withoutID)]])
        let decoded = try ShareCodec.decodeCollection(token)
        #expect(decoded.passages.count == 1)
        #expect(decoded.skipped == 1)
    }
}

// MARK: Offline cache

@Suite struct ResponseCacheTests {
    // These two collide under the old 32-bit djb2 + length key.
    private let a = URL(string: "https://cache.test/passage/context?id=aaa2")!
    private let b = URL(string: "https://cache.test/passage/context?id=aacp")!

    @Test func urlsNeverShareAFile() async {
        #expect(Passage.djb2(a.absoluteString) == Passage.djb2(b.absoluteString))
        #expect(ResponseCache.key(for: a) != ResponseCache.key(for: b))
        #expect(ResponseCache.key(for: a).count == 64)

        let cache = ResponseCache(directory: FileManager.default.temporaryDirectory.appending(path: UUID().uuidString))
        await cache.put(a, Data("A".utf8))
        #expect(await cache.get(b) == nil)
        await cache.put(b, Data("B".utf8))
        #expect(await cache.get(a) == Data("A".utf8))
        #expect(await cache.get(b) == Data("B".utf8))
    }

    @Test func oldFilesAreClearedOut() async throws {
        let dir = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let old = dir.appending(path: Passage.djb2(a.absoluteString) + "-\(a.absoluteString.count).json")
        try Data("stale".utf8).write(to: old)
        let cache = ResponseCache(directory: dir)
        #expect(!FileManager.default.fileExists(atPath: old.path))
        #expect(await cache.get(a) == nil)
    }
}

// MARK: Export

@Suite struct ExportFileTests {
    @Test func sharedCollectionsGetTheirOwnFile() throws {
        let p = Passage(
            apiID: "bible:Hebrews 11:1", source: .bible, reference: "Hebrews 11:1", text: "Now faith.",
            title: nil, url: "https://www.churchofjesuschrist.org/x", score: 0.9, metadata: [:])
        let mine = try MarkdownExport.file([p], title: "Saved passages", prefix: "gospel-help-saved")
        let shared = try MarkdownExport.file([p], title: "Shared collection", prefix: "gospel-help-shared")
        #expect(mine != shared)
        #expect(mine.lastPathComponent.hasPrefix("gospel-help-saved-"))
        #expect(shared.lastPathComponent.hasPrefix("gospel-help-shared-"))
        #expect(try String(contentsOf: mine, encoding: .utf8).hasPrefix("# Saved passages"))
        #expect(try String(contentsOf: shared, encoding: .utf8).hasPrefix("# Shared collection"))
    }
}
