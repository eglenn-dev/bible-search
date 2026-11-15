import SwiftUI

struct SavedTab: View {
    @Environment(BookmarkStore.self) private var store

    private static let savedDate: Date.FormatStyle = .dateTime.day().month(.abbreviated).year()

    var body: some View {
        NavigationStack {
            ScrollView {
                if store.bookmarks.isEmpty {
                    emptyState
                } else {
                    LazyVStack(spacing: 12) {
                        ForEach(store.bookmarks) { bookmark in
                            ResultCard(
                                passage: bookmark.passage,
                                footnote: "Saved \(bookmark.savedAt.formatted(Self.savedDate))")
                        }
                    }
                    .padding(.horizontal, 16)
                    .padding(.top, 8)
                    .padding(.bottom, 32)
                    .frame(maxWidth: readingWidth)
                    .frame(maxWidth: .infinity)
                }
            }
            .background { AppWash() }
            .navigationTitle("Saved")
            .navigationSubtitle(
                store.count == 0 ? "Kept on this device"
                    : "\(store.count) \(store.count == 1 ? "passage" : "passages") · kept on this device")
            .toolbar {
                if !store.bookmarks.isEmpty {
                    ToolbarItem(placement: .primaryAction) {
                        ExportMenu(passages: store.bookmarks.map(\.passage), title: "Saved passages")
                    }
                }
            }
            .animation(.smooth, value: store.count)
        }
    }

    private var emptyState: some View {
        VStack(spacing: 14) {
            Image(systemName: "bookmark")
                .font(.system(size: 28, weight: .medium))
                .foregroundStyle(Color.brand)
                .frame(width: 66, height: 66)
                .glassEffect(.regular, in: .circle)
            Text("Nothing saved yet").font(.headline)
            Text("Tap the bookmark on any search result to keep it here.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .frame(maxWidth: 280)
        }
        .frame(maxWidth: .infinity)
        .padding(.top, 90)
    }
}

/// Copy as Markdown, share a .md file, or share the passages as a link.
struct ExportMenu: View {
    var passages: [Passage]
    var title: String
    @Environment(AppRouter.self) private var router

    var body: some View {
        Menu {
            Section("\(passages.count) \(passages.count == 1 ? "passage" : "passages")") {
                Button("Copy as Markdown", systemImage: "doc.on.doc") {
                    UIPasteboard.general.string = MarkdownExport.collection(passages, title: title)
                    router.notify("Markdown copied")
                }
                if let file = try? MarkdownExport.file(passages, title: title) {
                    ShareLink(item: file) {
                        Label("Export .md File", systemImage: "square.and.arrow.down")
                    }
                }
                switch Result(catching: { try ShareCodec.collectionURL(passages) }) {
                case .success(let url):
                    ShareLink(item: url, subject: Text(title)) {
                        Label("Share as a Link", systemImage: "link")
                    }
                case .failure:
                    Button("Too many to fit in a link", systemImage: "link") {}.disabled(true)
                }
            }
        } label: {
            Label("Export & share", systemImage: "square.and.arrow.up")
        }
    }
}
