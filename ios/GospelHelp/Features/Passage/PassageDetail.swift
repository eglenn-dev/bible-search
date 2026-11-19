import SwiftUI

/// One passage in full, with Save, Share and Read, its surrounding verses or
/// paragraphs, and "More like this". In a sheet on phones; in the reading
/// pane on wide screens.
struct PassageDetail: View {
    enum Presentation { case sheet, pane }

    var passage: Passage
    var presentation: Presentation

    @Environment(AppRouter.self) private var router
    @Environment(BookmarkStore.self) private var bookmarks
    @Environment(SearchModel.self) private var search
    @Environment(\.openURL) private var openURL
    @Environment(\.dismiss) private var dismiss
    @Environment(\.inSharedLink) private var inSharedLink
    @State private var expanded = false

    var body: some View {
        NavigationStack {
            ScrollViewReader { proxy in
                ScrollView {
                    VStack(alignment: .leading, spacing: 14) {
                        VStack(alignment: .leading, spacing: 4) {
                            Text("\(Text(passage.source.label).foregroundStyle(.primary))\(passage.metaLine.isEmpty ? "" : " / \(passage.metaLine)")")
                                .font(.footnote)
                                .foregroundStyle(.secondary)
                            Text(passage.heading)
                                .font(.display(.title2))
                                .foregroundStyle(Color.brand)
                                .fixedSize(horizontal: false, vertical: true)
                        }

                        if expanded, let id = passage.apiID {
                            PassageContextView(id: id, passage: passage) { target in
                                withAnimation(.smooth) { proxy.scrollTo(target, anchor: .center) }
                            }
                        } else {
                            Text(passage.text)
                                .font(.reading(19))
                                .lineSpacing(5)
                                .textSelection(.enabled)
                                .fixedSize(horizontal: false, vertical: true)
                        }

                        if passage.isExcerpt {
                            Label("Shortened to fit the link it came in. Read it at the source for the whole passage.",
                                  systemImage: "scissors")
                                .font(.footnote)
                                .foregroundStyle(.secondary)
                        }

                        // Both need the API id, which very old bookmarks lack.
                        if passage.apiID != nil && !passage.isExcerpt {
                            ViewThatFits(in: .horizontal) {
                                HStack(spacing: 8) { pills }
                                VStack(alignment: .leading, spacing: 8) { pills }
                            }
                            .buttonStyle(.bordered)
                            .buttonBorderShape(.capsule)
                            .font(.subheadline.weight(.semibold))
                            .lineLimit(1)
                            .padding(.top, 4)
                        }
                    }
                    .padding(.horizontal, 20)
                    .padding(.top, 4)
                    .padding(.bottom, 24)
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                .scrollBounceBehavior(.basedOnSize)
            }
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: presentation == .sheet ? .cancellationAction : .topBarTrailing) {
                    Button("Close", systemImage: "xmark") {
                        if presentation == .sheet { dismiss() } else { router.openPassage = nil }
                    }
                }
            }
            .safeAreaBar(edge: .bottom) { actions }
        }
    }

    @ViewBuilder private var pills: some View {
        Button {
            withAnimation(.smooth) { expanded.toggle() }
        } label: {
            Label(expanded ? "Hide context" : passage.contextLabel,
                  systemImage: expanded ? "chevron.up" : "chevron.down")
                .fixedSize()
        }
        Button(action: moreLike) {
            Label("More like this", systemImage: "sparkles").fixedSize()
        }
    }

    private var actions: some View {
        let saved = bookmarks.isSaved(passage)
        return GlassEffectContainer(spacing: 10) {
            HStack(spacing: 10) {
                if !passage.isExcerpt {
                    Button {
                        router.toggleSaved(passage, in: bookmarks)
                    } label: {
                        Label(saved ? "Saved" : "Save", systemImage: saved ? "bookmark.fill" : "bookmark")
                            .contentTransition(.symbolEffect(.replace))
                            .frame(maxWidth: .infinity)
                    }
                    .tint(saved ? .brand : .primary)
                }

                ShareLink(item: passage.sourceURL ?? URL(string: AppConfig.webBase)!,
                          subject: Text(passage.heading),
                          message: Text(passage.shareText)) {
                    Label("Share", systemImage: "square.and.arrow.up")
                        .frame(maxWidth: .infinity)
                }
                .tint(.primary)

                if let url = passage.sourceURL {
                    Button {
                        openURL(url)
                    } label: {
                        Label("Read", systemImage: "arrow.up.right")
                            .labelStyle(TrailingIconLabelStyle())
                            .foregroundStyle(Color.onBrand)
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.glassProminent)
                    .tint(.brand)
                }
            }
            .buttonStyle(.glass)
            .controlSize(.large)
            .font(.subheadline.weight(.semibold))
        }
        .padding(.horizontal, 16)
        .padding(.bottom, 8)
    }

    private func moreLike() {
        // Inside a shared link, closing the link's sheet closes this one too.
        if presentation == .sheet, !inSharedLink { dismiss() }
        router.showSimilar(passage, in: search)
    }
}

struct TrailingIconLabelStyle: LabelStyle {
    func makeBody(configuration: Configuration) -> some View {
        HStack(spacing: 6) {
            configuration.title
            configuration.icon
        }
    }
}

/// The passage read in place: its neighbouring verses (or paragraphs), with
/// the matched one marked by a rule in the margin.
struct PassageContextView: View {
    var id: String
    var passage: Passage
    var scrollTo: (String) -> Void

    @State private var context: PassageContext?
    @State private var failed = false

    var body: some View {
        let passages = context?.passages ?? [
            ContextPassage(id: id, text: passage.text, isTarget: true, metadata: passage.metadata),
        ]
        VStack(alignment: .leading, spacing: 14) {
            if context?.moreBefore == true { ellipsis }
            ForEach(passages) { p in
                HStack(alignment: .top, spacing: 12) {
                    Capsule()
                        .fill(p.isTarget ? Color.brand : .clear)
                        .frame(width: 3)
                    Text("\(verseNumber(p))\(p.text)")
                        .font(.reading(19))
                        .lineSpacing(5)
                        .foregroundStyle(p.isTarget ? .primary : .secondary)
                        .textSelection(.enabled)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .id(p.id)
            }
            if context?.moreAfter == true { ellipsis }
            if context == nil && !failed {
                Label("Loading the surrounding \(passage.source.isScripture ? "verses" : "text")…",
                      systemImage: "ellipsis")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .padding(.leading, 15)
            }
            if failed {
                Text("Couldn’t load the surrounding text.")
                    .font(.footnote)
                    .foregroundStyle(Color.destructiveText)
                    .padding(.leading, 15)
            }
            if let note = context?.note {
                Text(note).font(.footnote).foregroundStyle(.secondary).padding(.leading, 15)
            }
        }
        .task(id: id) {
            do {
                let loaded = try await APIClient.shared.context(id: id)
                withAnimation(.smooth) { context = loaded }
                if let target = loaded.passages.first(where: \.isTarget) {
                    try? await Task.sleep(for: .milliseconds(150))
                    scrollTo(target.id)
                }
            } catch {
                failed = true
            }
        }
    }

    private var ellipsis: some View {
        Text("⋯").foregroundStyle(.tertiary).padding(.leading, 15)
    }

    private func verseNumber(_ p: ContextPassage) -> Text {
        guard passage.source.isScripture, let verse = p.metadata["verse"]?.int else { return Text("") }
        return Text("\(verse) ")
            .font(.system(size: 12, weight: .semibold).monospacedDigit())
            .baselineOffset(7)
            .foregroundStyle(.secondary)
    }
}
