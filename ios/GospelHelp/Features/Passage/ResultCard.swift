import SwiftUI

/// A passage in a list: source and meta line, heading, the text (clamped),
/// and a bookmark. The whole card opens the passage.
struct ResultCard: View {
    var passage: Passage
    var showScore = false
    /// Replaces the score line (Saved's "Saved Oct 12, 2026").
    var footnote: String?
    /// Ask's citation number.
    var marker: Int?
    /// Showing a cut-down excerpt (a shared answer): no bookmark.
    var allowsSaving = true

    @Environment(AppRouter.self) private var router
    @Environment(BookmarkStore.self) private var bookmarks
    @Environment(SearchModel.self) private var search
    @Environment(\.splitView) private var splitView
    @Environment(\.openURL) private var openURL
    @Environment(\.passageOpener) private var opener

    var body: some View {
        let saved = bookmarks.isSaved(passage)
        let selected = splitView && router.isOpen(passage)

        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .top, spacing: 8) {
                VStack(alignment: .leading, spacing: 3) {
                    HStack(spacing: 6) {
                        if let marker { CitationBadge(number: marker) }
                        Text("\(Text(passage.source.label).foregroundStyle(.primary))\(passage.metaLine.isEmpty ? "" : " / \(passage.metaLine)")")
                            .lineLimit(1)
                    }
                    .font(.footnote)
                    .foregroundStyle(.secondary)

                    Text(passage.heading)
                        .accessibilityIdentifier("resultHeading")
                        .font(.headline)
                        .foregroundStyle(Color.brand)
                        .multilineTextAlignment(.leading)
                }
                .frame(maxWidth: .infinity, alignment: .leading)

                if allowsSaving && !passage.isExcerpt {
                    Button {
                        router.toggleSaved(passage, in: bookmarks)
                    } label: {
                        Image(systemName: saved ? "bookmark.fill" : "bookmark")
                            .font(.system(size: 19, weight: .medium))
                            .foregroundStyle(saved ? Color.brand : .secondary)
                            .contentTransition(.symbolEffect(.replace))
                            .frame(width: 44, height: 44)
                            .contentShape(.rect)
                    }
                    .buttonStyle(.plain)
                    .padding(.top, -10)
                    .padding(.trailing, -10)
                    .accessibilityLabel(saved ? "Remove bookmark" : "Bookmark")
                    .accessibilityIdentifier("bookmarkButton")
                    .sensoryFeedback(.selection, trigger: saved)
                }
            }

            Text(passage.text)
                .font(.reading(17))
                .lineLimit(4)
                .lineSpacing(2)
                .multilineTextAlignment(.leading)
                .foregroundStyle(.primary)

            if showScore || footnote != nil {
                Text(showScore ? "\(passage.scorePercent)% match" : footnote ?? "")
                    .font(.footnote)
                    .monospacedDigit()
                    .foregroundStyle(.secondary)
                    .padding(.top, 2)
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .card(selected: selected)
        .contentShape(.rect(cornerRadius: 22))
        .onTapGesture(perform: open)
        .accessibilityElement(children: .contain)
        .accessibilityAction(named: "Open", open)
        .accessibilityAddTraits(.isButton)
        .contextMenu {
            if allowsSaving && !passage.isExcerpt {
                Button(saved ? "Remove from Saved" : "Save", systemImage: saved ? "bookmark.slash" : "bookmark") {
                    router.toggleSaved(passage, in: bookmarks)
                }
            }
            ShareLink(item: passage.sourceURL ?? URL(string: AppConfig.webBase)!, message: Text(passage.shareText)) {
                Label("Share", systemImage: "square.and.arrow.up")
            }
            Button("Copy Text", systemImage: "doc.on.doc") {
                UIPasteboard.general.string = "\(passage.shareText)\n\(passage.url)"
                router.notify("Copied")
            }
            if passage.apiID != nil, opener == nil {
                Button("More Like This", systemImage: "sparkles") { moreLike() }
            }
            if let url = passage.sourceURL {
                Button("Read at the Source", systemImage: "safari") { openURL(url) }
            }
        } preview: {
            PassagePreview(passage: passage)
        }
    }

    private func open() {
        if let opener { opener(passage) } else { router.open(passage) }
    }

    private func moreLike() {
        router.openPassage = nil
        router.tab = .search
        Task { await search.showSimilar(passage) }
    }
}

/// The context menu's preview: the whole passage.
private struct PassagePreview: View {
    var passage: Passage

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(passage.eyebrow).font(.footnote).foregroundStyle(.secondary)
            Text(passage.heading).font(.display(.title3)).foregroundStyle(Color.brand)
            Text(passage.text).font(.reading(17))
        }
        .padding(20)
        .frame(width: 360, alignment: .leading)
    }
}

private struct PassageOpenerKey: EnvironmentKey {
    static let defaultValue: (@MainActor (Passage) -> Void)? = nil
}

extension EnvironmentValues {
    /// Overrides where a tapped card opens (a modal reading its own sheet).
    var passageOpener: (@MainActor (Passage) -> Void)? {
        get { self[PassageOpenerKey.self] }
        set { self[PassageOpenerKey.self] = newValue }
    }
}
