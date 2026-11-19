import SwiftUI

/// A shared collection or answer opened from a link. Read-only: nothing
/// changes in Saved unless you save.
struct IncomingLinkView: View {
    var incoming: ShareCodec.Incoming
    @State private var reading: Passage?

    var body: some View {
        NavigationStack {
            switch incoming {
            case .collection(let token): SharedCollectionView(token: token)
            case .answer(let token): SharedAnswerView(token: token)
            case .search: EmptyView()
            }
        }
        .environment(\.splitView, false)
        .environment(\.passageOpener) { reading = $0 }
        .environment(\.inSharedLink, true)
        .sheet(item: $reading) { passage in
            PassageDetail(passage: passage, presentation: .sheet)
                .presentationDetents([.medium, .large])
                .environment(\.passageOpener, nil)
                .environment(\.inSharedLink, true)
        }
    }
}

private struct CloseButton: ToolbarContent {
    @Environment(\.dismiss) private var dismiss
    var body: some ToolbarContent {
        ToolbarItem(placement: .cancellationAction) {
            Button("Close", systemImage: "xmark") { dismiss() }
        }
    }
}

struct SharedCollectionView: View {
    var token: String
    @Environment(BookmarkStore.self) private var store
    @Environment(AppRouter.self) private var router
    @Environment(\.dismiss) private var dismiss
    @State private var decoded: Result<ShareCodec.DecodedCollection, ShareError>?
    @State private var imported: Int?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                switch decoded {
                case nil:
                    ProgressView("Opening…").frame(maxWidth: .infinity).padding(.top, 60)
                case .failure(let error):
                    LinkErrorView(message: error.message)
                case .success(let collection):
                    let passages = collection.passages
                    let unsaved = passages.filter { !store.isSaved($0) }.count
                    Text(summary(passages.count, skipped: collection.skipped))
                        .foregroundStyle(.secondary)
                    HStack(spacing: 12) {
                        if unsaved > 0 {
                            Button {
                                imported = store.importPassages(passages)
                            } label: {
                                Label(unsaved == passages.count ? "Save all" : "Save \(unsaved) new", systemImage: "bookmark.fill")
                                    .fontWeight(.semibold)
                            }
                            .buttonStyle(.glassProminent)
                            .foregroundStyle(Color.onBrand)
                        } else {
                            Button {
                                router.tab = .saved
                                dismiss()
                            } label: {
                                Label("View my Saved", systemImage: "bookmark")
                                    .fontWeight(.semibold)
                            }
                            .buttonStyle(.glassProminent)
                            .foregroundStyle(Color.onBrand)
                        }
                        Text(imported.map { $0 == 0 ? "You already had all of these." : "Added \($0) to your Saved." }
                             ?? (unsaved == 0 ? "All of these are in your Saved." : ""))
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                    .controlSize(.large)
                    ForEach(passages) { passage in
                        ResultCard(passage: passage)
                    }
                }
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 32)
            .frame(maxWidth: readingWidth)
            .frame(maxWidth: .infinity)
        }
        .background { AppWash() }
        .navigationTitle("Shared collection")
        .toolbar {
            CloseButton()
            if case .success(let collection) = decoded {
                ToolbarItem(placement: .primaryAction) {
                    ExportMenu(passages: collection.passages, title: "Shared collection",
                               filePrefix: "gospel-help-shared")
                }
            }
        }
        .task(id: token) {
            do { decoded = .success(try ShareCodec.decodeCollection(token)) }
            catch let error as ShareError { decoded = .failure(error) }
            catch { decoded = .failure(ShareError(code: .invalid, message: "This link couldn’t be opened.")) }
        }
    }

    private func summary(_ count: Int, skipped: Int) -> String {
        var text = "\(count) \(count == 1 ? "passage" : "passages") someone shared with you. Read-only: nothing changes in your Saved unless you save."
        if skipped > 0 {
            text += " \(skipped) \(skipped == 1 ? "entry couldn’t be read and was" : "entries couldn’t be read and were") left out."
        }
        return text
    }
}

struct SharedAnswerView: View {
    var token: String
    @Environment(AppRouter.self) private var router
    @Environment(\.dismiss) private var dismiss
    @Environment(\.passageOpener) private var opener
    @State private var decoded: Result<ShareCodec.Answer, ShareError>?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                switch decoded {
                case nil:
                    ProgressView("Opening…").frame(maxWidth: .infinity).padding(.top, 60)
                case .failure(let error):
                    LinkErrorView(message: error.message)
                case .success(let answer):
                    Label("An answer someone shared with you, written by AI on Gospel Help.", systemImage: "person.2")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                    Text(answer.question)
                        .font(.display(.title2))
                    AnswerText(segments: answer.segments, citations: answer.citations) { _, passage in
                        opener?(passage)
                    }
                    .padding(18)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .card()
                    Text("Written by AI from the passages below. It can get things wrong, so read the sources.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                    if !answer.sources.isEmpty {
                        SectionHeader(title: "Sources").padding(.top, 6)
                        ForEach(answer.sources, id: \.n) { source in
                            VStack(alignment: .leading, spacing: 4) {
                                ResultCard(passage: source.passage, marker: source.n,
                                           allowsSaving: !answer.excerpts.contains(source.n))
                                if answer.excerpts.contains(source.n) {
                                    Text("Shortened to fit the link. Open it to read the whole passage.")
                                        .font(.footnote)
                                        .foregroundStyle(.secondary)
                                        .padding(.horizontal, 4)
                                }
                            }
                        }
                    }
                    Button {
                        router.tab = .ask
                        dismiss()
                    } label: {
                        Label("Ask your own question", systemImage: "questionmark.bubble")
                            .fontWeight(.semibold)
                    }
                    .buttonStyle(.glassProminent)
                    .foregroundStyle(Color.onBrand)
                    .controlSize(.large)
                    .frame(maxWidth: .infinity)
                    .padding(.top, 8)
                }
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 32)
            .frame(maxWidth: readingWidth)
            .frame(maxWidth: .infinity)
        }
        .background { AppWash() }
        .navigationTitle("Shared answer")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar { CloseButton() }
        .task(id: token) {
            do { decoded = .success(try ShareCodec.decodeAnswer(token)) }
            catch let error as ShareError { decoded = .failure(error) }
            catch { decoded = .failure(ShareError(code: .invalid, message: "This link couldn’t be opened.")) }
        }
    }
}

private struct LinkErrorView: View {
    var message: String
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(message)
            Text("Ask whoever sent it to copy the link again, making sure all of it comes through.")
                .font(.footnote)
                .foregroundStyle(.secondary)
        }
        .padding(.top, 20)
    }
}
