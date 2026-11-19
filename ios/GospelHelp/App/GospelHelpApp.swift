import SwiftUI

@main
struct GospelHelpApp: App {
    // Shared by every window: what's saved, recent searches, the service's
    // health and the speaker list.
    @State private var bookmarks = BookmarkStore()
    @State private var recents = RecentSearchStore()
    @State private var backend = BackendMonitor()
    @State private var speakers = SpeakerStore()

    var body: some Scene {
        WindowGroup {
            WindowRoot()
                .environment(bookmarks)
                .environment(recents)
                .environment(backend)
                .environment(speakers)
                .environment(NetworkMonitor.shared)
                .onAppear { backend.start() }
        }
    }
}

/// One window's state: its tab, search, answer and open passage. iPad can
/// show several windows side by side, each its own.
struct WindowRoot: View {
    @Environment(RecentSearchStore.self) private var recents
    @State private var router = AppRouter()
    @State private var search = SearchModel()
    @State private var ask = AskModel()
    @AppStorage("gs-theme") private var appearance: Appearance = .system

    var body: some View {
        RootView()
            .environment(router)
            .environment(search)
            .environment(ask)
            .tint(.brand)
            .preferredColorScheme(appearance.colorScheme)
            .onAppear { search.attach(recents: recents) }
            .onOpenURL { url in
                router.incoming = ShareCodec.parse(url)
            }
    }
}
