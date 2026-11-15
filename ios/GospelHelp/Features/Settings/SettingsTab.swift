import SwiftUI

struct SettingsTab: View {
    @Environment(BookmarkStore.self) private var bookmarks
    @Environment(RecentSearchStore.self) private var recents
    @Environment(AppRouter.self) private var router
    @AppStorage("gs-theme") private var appearance: Appearance = .system
    @State private var confirmingClear = false

    var body: some View {
        NavigationStack {
            Form {
                Section("Appearance") {
                    Picker("Appearance", selection: $appearance) {
                        ForEach(Appearance.allCases) { option in
                            Label(option.label, systemImage: option.symbol).tag(option)
                        }
                    }
                    .pickerStyle(.segmented)
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets())
                }

                Section("Explore") {
                    NavigationLink {
                        StatsView()
                    } label: {
                        Label("The library, by the numbers", systemImage: "chart.bar.xaxis")
                    }
                    NavigationLink {
                        MCPView()
                    } label: {
                        Label("Use with AI agents", systemImage: "powerplug")
                    }
                    Link(destination: URL(string: AppConfig.webBase)!) {
                        Label {
                            HStack {
                                Text("Gospel Help on the web").foregroundStyle(.primary)
                                Spacer()
                                Image(systemName: "arrow.up.right").font(.footnote).foregroundStyle(.tertiary)
                            }
                        } icon: {
                            Image(systemName: "safari")
                        }
                    }
                }

                if bookmarks.count > 0 || !recents.items.isEmpty {
                    Section {
                        if bookmarks.count > 0 {
                            Button(role: .destructive) {
                                confirmingClear = true
                            } label: {
                                Label("Clear saved passages", systemImage: "trash")
                                    .foregroundStyle(Color.destructiveText)
                            }
                            .confirmationDialog(
                                "Remove all \(bookmarks.count) saved \(bookmarks.count == 1 ? "passage" : "passages")?",
                                isPresented: $confirmingClear, titleVisibility: .visible
                            ) {
                                Button("Remove All", role: .destructive, action: clearSaved)
                            } message: {
                                Text("You can undo this right after.")
                            }
                        }
                        if !recents.items.isEmpty {
                            Button {
                                recents.clear()
                                router.notify("Recent searches cleared")
                            } label: {
                                Label("Clear recent searches", systemImage: "clock.arrow.circlepath")
                            }
                        }
                    } header: {
                        Text("On this device")
                    } footer: {
                        Text("Saved passages and recent searches are kept on this device only; there are no accounts.")
                    }
                }

                Section {
                } footer: {
                    VStack(spacing: 4) {
                        Text("© \(String(Calendar.current.component(.year, from: .now))) Gospel Help")
                        Text("Not affiliated with any religious organization.")
                        Text("Version \(Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "1.0")")
                            .padding(.top, 4)
                    }
                    .frame(maxWidth: .infinity)
                    .multilineTextAlignment(.center)
                }
            }
            .scrollContentBackground(.hidden)
            .background { AppWash() }
            .navigationTitle("Settings")
            .frame(maxWidth: 760)
            .frame(maxWidth: .infinity)
        }
    }

    private func clearSaved() {
        let removed = bookmarks.bookmarks
        bookmarks.clear()
        router.notify("Removed \(removed.count) \(removed.count == 1 ? "passage" : "passages")") {
            bookmarks.restore(removed)
        }
    }
}

/// How to add the API's MCP server to an AI agent.
struct MCPView: View {
    @State private var copied = false
    private let tools = ["search", "search_by_reference", "search_similar", "get_passage_context", "get_verse", "list_speakers"]

    private var config: String {
        """
        {
          "mcpServers": {
            "gospel-library-search": {
              "url": "\(AppConfig.mcpURL)"
            }
          }
        }
        """
    }

    var body: some View {
        Form {
            Section {
                Text("Gospel Help is also a remote MCP server. Add its URL to any MCP-capable agent and it can search the scriptures and talks as tools, with no install.")
                    .foregroundStyle(.secondary)
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets(top: 0, leading: 4, bottom: 0, trailing: 4))
            }
            Section("Server URL") {
                HStack {
                    Text(AppConfig.mcpURL)
                        .font(.callout.monospaced())
                        .textSelection(.enabled)
                    Spacer()
                    Button {
                        UIPasteboard.general.string = AppConfig.mcpURL
                        copied = true
                        Task {
                            try? await Task.sleep(for: .seconds(1.5))
                            copied = false
                        }
                    } label: {
                        Image(systemName: copied ? "checkmark" : "doc.on.doc")
                            .contentTransition(.symbolEffect(.replace))
                    }
                    .buttonStyle(.borderless)
                    .accessibilityLabel("Copy server URL")
                }
            }
            Section("Add to Claude") {
                Label("Open Settings › Connectors", systemImage: "1.circle")
                Label("Choose Add custom connector", systemImage: "2.circle")
                Label("Paste the URL above and connect", systemImage: "3.circle")
            }
            Section {
                Text(config)
                    .font(.footnote.monospaced())
                    .textSelection(.enabled)
            } header: {
                Text("Other platforms")
            } footer: {
                Text("Any client that supports remote MCP (Streamable HTTP).")
            }
            Section("Available tools") {
                FlowLayout(spacing: 6) {
                    ForEach(tools, id: \.self) { tool in
                        Text(tool)
                            .font(.footnote.monospaced())
                            .padding(.horizontal, 10)
                            .padding(.vertical, 4)
                            .background(Color.brand.opacity(0.12), in: .capsule)
                    }
                }
                .padding(.vertical, 4)
            }
            Section {
                Link("About MCP", destination: URL(string: "https://modelcontextprotocol.io")!)
            }
        }
        .scrollContentBackground(.hidden)
        .background { AppWash() }
        .navigationTitle("Use with AI agents")
        .navigationBarTitleDisplayMode(.inline)
    }
}
