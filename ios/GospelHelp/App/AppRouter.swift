import Observation
import SwiftUI

enum AppTab: String, CaseIterable, Hashable {
    case search, ask, saved, settings

    var label: String {
        switch self {
        case .search: "Search"
        case .ask: "Ask"
        case .saved: "Saved"
        case .settings: "Settings"
        }
    }

    var symbol: String {
        switch self {
        case .search: "magnifyingglass"
        case .ask: "questionmark.bubble"
        case .saved: "bookmark"
        case .settings: "gearshape"
        }
    }
}

/// App-wide navigation state: the tab, the passage being read, toasts, and
/// links opened from outside.
@MainActor
@Observable
final class AppRouter {
    var tab: AppTab = .search
    /// The passage open in the sheet (phones) or the reading pane (wide).
    var openPassage: Passage?
    var toast: Toast?
    var incoming: ShareCodec.Incoming?
    /// Bumped to close the shared link on screen (RootView owns its sheet).
    private(set) var closeSharedLinkRequest = 0

    private var toastTask: Task<Void, Never>?

    func notify(_ message: String, undo: (@MainActor () -> Void)? = nil) {
        toastTask?.cancel()
        let toast = Toast(message: message, undo: undo)
        withAnimation(.snappy) { self.toast = toast }
        toastTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(undo == nil ? 2.2 : 4.5))
            guard !Task.isCancelled, let self, self.toast == toast else { return }
            withAnimation(.snappy) { self.toast = nil }
        }
    }

    func dismissToast() {
        withAnimation(.snappy) { toast = nil }
    }

    func isOpen(_ passage: Passage) -> Bool { openPassage?.id == passage.id }

    func open(_ passage: Passage) { openPassage = passage }

    /// "More like this": closes whatever covers the Search tab (the passage
    /// sheet, a shared link) and shows the passage's neighbours there.
    func showSimilar(_ passage: Passage, in search: SearchModel) {
        openPassage = nil
        closeSharedLinkRequest += 1
        tab = .search
        Task { await search.showSimilar(passage) }
    }

    /// Saves or removes, with the matching toast (and Undo for a removal).
    func toggleSaved(_ passage: Passage, in store: BookmarkStore) {
        guard !passage.isExcerpt else { return }
        let existing = store.find(passage)
        if store.toggle(passage) {
            UIImpactFeedbackGenerator(style: .light).impactOccurred()
            notify("Saved")
        } else if let existing {
            notify("Removed from Saved") { store.restore([existing]) }
        }
    }
}
