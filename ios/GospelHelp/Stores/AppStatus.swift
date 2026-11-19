import Foundation
import Network
import Observation
import SwiftUI

/// Whether the device has a network path.
@Observable
final class NetworkMonitor: @unchecked Sendable {
    static let shared = NetworkMonitor()

    private(set) var isOnline = true
    private let monitor = NWPathMonitor()
    /// Called on the main actor when the connection comes back.
    @ObservationIgnored var onReconnect: (@MainActor () -> Void)?

    #if DEBUG
    /// `-GHSimulateOffline` (debug builds): report no connection, to try the
    /// offline paths in the simulator, which shares the Mac's network.
    private static let simulateOffline = ProcessInfo.processInfo.arguments.contains("-GHSimulateOffline")
    #else
    private static let simulateOffline = false
    #endif

    private init() {
        monitor.pathUpdateHandler = { [weak self] path in
            let online = path.status == .satisfied && !Self.simulateOffline
            Task { @MainActor in
                guard let self else { return }
                let wasOffline = !self.isOnline
                self.isOnline = online
                if online && wasOffline { self.onReconnect?() }
            }
        }
        monitor.start(queue: DispatchQueue(label: "network-monitor"))
    }
}

/// Pings the API's health check in the background so the app opens at once.
/// Speaks up only when the first check is slow (a cold start) or fails, and
/// re-checks every few seconds while the service is down.
@MainActor
@Observable
final class BackendMonitor {
    enum Status { case unknown, up, down }

    private(set) var status: Status = .unknown
    private(set) var error: String = ""
    private(set) var unreachable = false
    private(set) var checking = false
    private(set) var slow = false

    private var task: Task<Void, Never>?

    func start() {
        guard task == nil else { return }
        retry()
        NetworkMonitor.shared.onReconnect = { [weak self] in self?.retry() }
    }

    func retry() {
        task?.cancel()
        checking = true
        task = Task { [weak self] in
            let slowTimer = Task { [weak self] in
                try? await Task.sleep(for: .seconds(4))
                if !Task.isCancelled { self?.slow = true }
            }
            let result = await APIClient.shared.health()
            slowTimer.cancel()
            guard let self, !Task.isCancelled else { return }
            self.slow = false
            self.checking = false
            switch result {
            case .success:
                self.status = .up
                self.error = ""
                self.unreachable = false
            case .failure(let failure):
                self.status = .down
                self.error = NetworkMonitor.shared.isOnline ? failure.message : "You’re offline."
                self.unreachable = failure.unreachable
                try? await Task.sleep(for: .seconds(10))
                if !Task.isCancelled { self.retry() }
            }
        }
    }
}

/// GET /speakers, fetched once and shared by every picker.
@MainActor
@Observable
final class SpeakerStore {
    private(set) var speakers: [SpeakerOption]?
    private(set) var failed = false
    private var loading = false

    func load() async {
        guard speakers == nil, !loading else { return }
        loading = true
        defer { loading = false }
        do {
            speakers = try await APIClient.shared.speakers()
            failed = false
        } catch {
            failed = true
        }
    }

    /// Speakers whose name contains every typed word (accent-insensitive),
    /// most talks first.
    func matches(_ text: String, limit: Int = 50) -> [SpeakerOption] {
        guard let speakers else { return [] }
        let words = Self.fold(text).split(separator: " ").map(String.init)
        guard !words.isEmpty else { return Array(speakers.prefix(limit)) }
        var out: [SpeakerOption] = []
        for s in speakers {
            let name = Self.fold(s.name)
            if words.allSatisfy(name.contains) {
                out.append(s)
                if out.count >= limit { break }
            }
        }
        return out
    }

    nonisolated static func fold(_ s: String) -> String {
        s.folding(options: [.diacriticInsensitive, .caseInsensitive], locale: nil)
            .replacingOccurrences(of: ".", with: "")
            .trimmingCharacters(in: .whitespaces)
    }
}

enum Appearance: String, CaseIterable, Identifiable {
    case light, dark, system
    var id: String { rawValue }
    var label: String {
        switch self {
        case .light: "Light"
        case .dark: "Dark"
        case .system: "Auto"
        }
    }
    var symbol: String {
        switch self {
        case .light: "sun.max"
        case .dark: "moon"
        case .system: "circle.lefthalf.filled"
        }
    }
    var colorScheme: ColorScheme? {
        switch self {
        case .light: .light
        case .dark: .dark
        case .system: nil
        }
    }
}
