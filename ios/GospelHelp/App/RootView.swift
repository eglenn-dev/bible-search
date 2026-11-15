import SwiftUI

/// Four tabs (Search, Ask, Saved, Settings). On a phone, or a folded or
/// narrow window, they sit under the floating Liquid Glass tab bar and a
/// passage opens in a sheet. With room (iPad, or a regular-width window),
/// the tab bar becomes a sidebar and, from 1100pt (iPad landscape), the open
/// passage gets its own reading pane beside the list.
struct RootView: View {
    @Environment(AppRouter.self) private var router
    @Environment(BookmarkStore.self) private var bookmarks
    @Environment(SearchModel.self) private var search
    @Environment(\.horizontalSizeClass) private var sizeClass

    @State private var size = CGSize(width: 400, height: 800)
    private var width: CGFloat { size.width }
    @State private var scene: UIWindowScene?
    @State private var toasts = ToastWindowPresenter()
    /// The shared link on screen. Separate from `router.incoming` so a
    /// passage sheet can close first (one view shows one sheet at a time).
    @State private var shownIncoming: ShareCodec.Incoming?

    /// Wide enough to read beside the list: iPad landscape (with the
    /// sidebar showing), or a wide but short window (an unfolded iPhone Duo,
    /// a large iPhone in landscape) where a sheet would cover the list.
    private var wide: Bool { width >= 1100 || (width >= 880 && size.height < 760) }
    /// Settings has nothing to show beside it.
    private var split: Bool { wide && router.tab != .settings }

    var body: some View {
        @Bindable var router = router

        HStack(spacing: 0) {
            tabs
            if split {
                ReadingPane()
                    .frame(width: width >= 1100 ? min(width * 0.36, 520) : width * 0.42)
                    .padding(.trailing, 12)
                    .padding(.vertical, 12)
                    .transition(.move(edge: .trailing).combined(with: .opacity))
            }
        }
        .background { AppWash() }
        // The window's whole size: landscape safe areas count as room too.
        .onGeometryChange(for: CGSize.self) { proxy in
            CGSize(width: proxy.size.width + proxy.safeAreaInsets.leading + proxy.safeAreaInsets.trailing,
                   height: proxy.size.height + proxy.safeAreaInsets.top + proxy.safeAreaInsets.bottom)
        } action: { size = $0 }
        .animation(.smooth(duration: 0.35), value: split)
        .environment(\.splitView, split)
        .background { WindowSceneReader { scene = $0 } }
        .onChange(of: router.toast) { _, toast in
            toasts.show(toast, in: scene) { router.dismissToast() }
        }
        .overlay(alignment: .bottom) {
            BackendBanner()
                .padding(.bottom, sizeClass == .compact ? 96 : 24)
                .animation(.smooth, value: router.tab)
        }
        .sheet(item: sheetPassage) { passage in
            PassageDetail(passage: passage, presentation: .sheet)
                .presentationDetents([.medium, .large])
                .presentationDragIndicator(.visible)
                .presentationBackgroundInteraction(.enabled(upThrough: .medium))
        }
        .background {
            // On its own view: the passage sheet already uses the root's.
            Color.clear
                .sheet(item: $shownIncoming) { incoming in
                    IncomingLinkView(incoming: incoming)
                }
        }
        .onChange(of: router.incoming) { _, incoming in
            guard let incoming else { return }
            router.incoming = nil
            switch incoming {
            case .search(let q):
                // A `?q=` link just runs its search.
                router.tab = .search
                Task { await search.open(query: q) }
            case .collection, .answer:
                let sheetUp = router.openPassage != nil && !wide
                router.openPassage = nil
                Task {
                    // Let a passage sheet finish closing first.
                    if sheetUp || shownIncoming != nil {
                        shownIncoming = nil
                        try? await Task.sleep(for: .milliseconds(500))
                    }
                    shownIncoming = incoming
                }
            }
        }
    }

    private var tabs: some View {
        TabView(selection: tabSelection) {
            Tab(AppTab.search.label, systemImage: AppTab.search.symbol, value: AppTab.search) {
                SearchTab()
            }
            Tab(AppTab.ask.label, systemImage: AppTab.ask.symbol, value: AppTab.ask) {
                AskTab()
            }
            Tab(AppTab.saved.label, systemImage: AppTab.saved.symbol, value: AppTab.saved) {
                SavedTab()
            }
            .badge(router.tab == .saved ? 0 : bookmarks.count)
            Tab(AppTab.settings.label, systemImage: AppTab.settings.symbol, value: AppTab.settings) {
                SettingsTab()
            }
        }
        .tabViewStyle(.sidebarAdaptable)
        .tabViewSidebarHeader {
            HStack(spacing: 10) {
                Image("Logo")
                    .resizable()
                    .frame(width: 32, height: 32)
                    .clipShape(.rect(cornerRadius: 8, style: .continuous))
                Text("Gospel Help")
                    .font(.display(.title3))
            }
            .padding(.vertical, 6)
        }
        .tabBarMinimizeBehavior(.onScrollDown)
    }

    /// Tapping the tab you're on goes back to the start (iOS's "pop to
    /// root"): on Search, that's the start screen.
    private var tabSelection: Binding<AppTab> {
        Binding {
            router.tab
        } set: { next in
            if next == router.tab, next == .search, search.hasSearched {
                withAnimation(.smooth) { search.goHome() }
            }
            router.tab = next
        }
    }

    /// Phones read in a sheet; wide windows in the pane, never a modal.
    private var sheetPassage: Binding<Passage?> {
        Binding {
            wide ? nil : router.openPassage
        } set: { value in
            if !wide { router.openPassage = value }
        }
    }

}

extension ShareCodec.Incoming: Identifiable {
    var id: String {
        switch self {
        case .collection(let t): "c" + t
        case .answer(let t): "a" + t
        case .search(let q): "q" + q
        }
    }
}

private struct SplitViewKey: EnvironmentKey {
    static let defaultValue = false
}

extension EnvironmentValues {
    /// The reading pane is showing (wide window, not on Settings).
    var splitView: Bool {
        get { self[SplitViewKey.self] }
        set { self[SplitViewKey.self] = newValue }
    }
}

/// The split view's right-hand column.
struct ReadingPane: View {
    @Environment(AppRouter.self) private var router

    var body: some View {
        Group {
            if let passage = router.openPassage {
                PassageDetail(passage: passage, presentation: .pane)
                    .id(passage.id)
                    .clipShape(.rect(cornerRadius: 30, style: .continuous))
                    .glassEffect(.regular, in: .rect(cornerRadius: 30, style: .continuous))
            } else {
                VStack(spacing: 12) {
                    Image(systemName: "book.pages")
                        .font(.system(size: 34, weight: .light))
                        .foregroundStyle(.tertiary)
                    Text("Choose a passage to read it here.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background {
                    RoundedRectangle(cornerRadius: 30, style: .continuous)
                        .strokeBorder(style: StrokeStyle(lineWidth: 1, dash: [6, 5]))
                        .foregroundStyle(Color.cardStroke)
                }
            }
        }
    }
}
