import Foundation
import Observation

struct Bookmark: Codable, Hashable, Identifiable, Sendable {
    var id: String
    var savedAt: Date
    var passage: Passage

    enum CodingKeys: String, CodingKey { case id, savedAt, passage = "result" }
}

/// Saved passages, on this device only (no accounts), newest first. Each
/// entry keeps the whole passage so Saved opens with no connection.
@MainActor
@Observable
final class BookmarkStore {
    private(set) var bookmarks: [Bookmark] = []
    /// Every key `isSaved` matches against (ids and the pre-id keys).
    private(set) var savedKeys: Set<String> = []

    private let fileURL: URL

    init(fileURL: URL? = nil) {
        self.fileURL = fileURL ?? FileManager.default
            .urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appending(path: "bookmarks.json")
        if AppConfig.resetState { try? FileManager.default.removeItem(at: self.fileURL) }
        load()
    }

    var count: Int { bookmarks.count }

    func isSaved(_ passage: Passage) -> Bool {
        passage.keys.contains { savedKeys.contains($0) }
    }

    func find(_ passage: Passage) -> Bookmark? {
        let keys = passage.keys
        return bookmarks.first { b in keys.contains(b.id) || b.passage.keys.contains { keys.contains($0) } }
    }

    /// Saves the passage, or removes it when it's already saved.
    @discardableResult
    func toggle(_ passage: Passage) -> Bool {
        if let existing = find(passage) {
            if passage.isExcerpt { return true }
            write(bookmarks.filter { $0 != existing })
            return false
        }
        guard !passage.isExcerpt else { return false }
        write([Bookmark(id: passage.id, savedAt: .now, passage: passage)] + bookmarks)
        keepForOffline(passage)
        return true
    }

    /// Puts back bookmarks that were just removed (the toast's Undo).
    func restore(_ removed: [Bookmark]) {
        let have = Set(bookmarks.map(\.id))
        let merged = bookmarks + removed.filter { !have.contains($0.id) }
        write(merged.sorted { $0.savedAt > $1.savedAt })
    }

    /// Adds passages that aren't saved yet, keeping their order at the top.
    /// Returns how many were new.
    @discardableResult
    func importPassages(_ passages: [Passage]) -> Int {
        var have = savedKeys
        let now = Date.now
        var added: [Bookmark] = []
        for p in passages where !p.isExcerpt && !p.keys.contains(where: have.contains) {
            have.insert(p.id)
            added.append(Bookmark(id: p.id, savedAt: now.addingTimeInterval(-Double(added.count) / 1000), passage: p))
        }
        if !added.isEmpty {
            write(added + bookmarks)
            added.prefix(20).forEach { keepForOffline($0.passage) }
        }
        return added.count
    }

    func remove(_ bookmark: Bookmark) {
        write(bookmarks.filter { $0.id != bookmark.id })
    }

    func clear() { write([]) }

    // A saved passage should still open, surroundings and all, offline.
    private func keepForOffline(_ passage: Passage) {
        guard let id = passage.apiID else { return }
        Task.detached { _ = try? await APIClient.shared.context(id: id) }
    }

    private func load() {
        guard let data = try? Data(contentsOf: fileURL) else { return }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .millisecondsSince1970
        // Skip entries that don't decode instead of losing the whole list.
        struct Lossy: Decodable {
            var items: [Bookmark]
            init(from decoder: Decoder) throws {
                var c = try decoder.unkeyedContainer()
                var out: [Bookmark] = []
                while !c.isAtEnd {
                    if let b = try? c.decode(Bookmark.self) { out.append(b) } else { _ = try? c.decode(JSONValue.self) }
                }
                items = out
            }
        }
        if let list = try? decoder.decode(Lossy.self, from: data) {
            set(list.items)
        }
    }

    private func write(_ next: [Bookmark]) {
        set(next)
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .millisecondsSince1970
        do {
            try FileManager.default.createDirectory(
                at: fileURL.deletingLastPathComponent(), withIntermediateDirectories: true)
            try encoder.encode(next).write(to: fileURL, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        } catch {
            // Disk full: the list still works for this session.
        }
    }

    private func set(_ next: [Bookmark]) {
        bookmarks = next
        var keys = Set<String>()
        for b in next {
            keys.insert(b.id)
            b.passage.keys.forEach { keys.insert($0) }
        }
        savedKeys = keys
    }
}
