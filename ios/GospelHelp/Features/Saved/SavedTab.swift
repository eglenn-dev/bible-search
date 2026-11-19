import SwiftUI
import UniformTypeIdentifiers

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
                        ExportMenu(passages: store.bookmarks.map(\.passage), title: "Saved passages",
                                   filePrefix: "gospel-help-saved")
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
/// Nothing is written or compressed while the list redraws: the file is
/// written when it's shared, and the link is built off the main thread
/// only when the passages change.
struct ExportMenu: View {
    var passages: [Passage]
    var title: String
    /// Names the .md file, so a shared collection doesn't overwrite your own.
    var filePrefix: String
    @Environment(AppRouter.self) private var router
    @State private var link: Result<URL, ShareError>?

    var body: some View {
        let file = MarkdownFile(passages: passages, title: title, prefix: filePrefix)
        Menu {
            Section("\(passages.count) \(passages.count == 1 ? "passage" : "passages")") {
                Button("Copy as Markdown", systemImage: "doc.on.doc") {
                    UIPasteboard.general.string = MarkdownExport.collection(passages, title: title)
                    router.notify("Markdown copied")
                }
                ShareLink(item: file, preview: SharePreview(file.filename)) {
                    Label("Export .md File", systemImage: "square.and.arrow.down")
                }
                switch link {
                case .success(let url):
                    ShareLink(item: url, subject: Text(title)) {
                        Label("Share as a Link", systemImage: "link")
                    }
                case .failure:
                    Button("Too many to fit in a link", systemImage: "link") {}.disabled(true)
                case nil:
                    Button("Preparing link…", systemImage: "link") {}.disabled(true)
                }
            }
        } label: {
            Label("Export & share", systemImage: "square.and.arrow.up")
        }
        .task(id: passages.map(\.id)) {
            let passages = passages
            link = await Task.detached(priority: .userInitiated) {
                Result { () throws(ShareError) -> URL in
                    do { return try ShareCodec.collectionURL(passages) }
                    catch let error as ShareError { throw error }
                    catch { throw ShareError(code: .tooLong, message: "These passages couldn’t be made into a link.") }
                }
            }.value
        }
    }
}

/// The Markdown export as a file, written only when the share sheet asks.
struct MarkdownFile: Transferable, Sendable {
    var passages: [Passage]
    var title: String
    var prefix: String

    var filename: String { MarkdownExport.filename(prefix: prefix) }

    static let markdown = UTType("net.daringfireball.markdown") ?? .plainText

    static var transferRepresentation: some TransferRepresentation {
        FileRepresentation(exportedContentType: markdown) { file in
            SentTransferredFile(try MarkdownExport.file(file.passages, title: file.title, prefix: file.prefix))
        }
    }
}
