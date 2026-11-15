import SwiftUI

struct Toast: Identifiable, Equatable {
    let id = UUID()
    var message: String
    var undo: (@MainActor () -> Void)?

    static func == (a: Toast, b: Toast) -> Bool { a.id == b.id }
}

/// A glass capsule at the top of the window: "Saved", "Removed · Undo".
struct ToastView: View {
    var toast: Toast
    var dismiss: () -> Void

    var body: some View {
        HStack(spacing: 14) {
            Text(toast.message)
                .font(.subheadline.weight(.semibold))
            if let undo = toast.undo {
                Button("Undo") {
                    undo()
                    dismiss()
                }
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(Color.brand)
            }
        }
        .padding(.horizontal, 20)
        .frame(minHeight: 44)
        .glassEffect(.regular.interactive(), in: .capsule)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.updatesFrequently)
    }
}

/// The "waking up" / "can't reach" capsule above the tab bar.
struct BackendBanner: View {
    @Environment(BackendMonitor.self) private var backend
    @Environment(NetworkMonitor.self) private var network

    var body: some View {
        let waking = backend.status == .unknown && backend.slow
        // Offline is explained in place (saved and cached still work).
        let down = backend.status == .down && network.isOnline
        if waking || down {
            HStack(spacing: 12) {
                if waking {
                    ProgressView().controlSize(.small)
                    Text("Waking up the search service. This can take a minute.")
                } else {
                    Text(backend.error).foregroundStyle(Color.destructiveText)
                    Button(backend.checking ? "Retrying…" : "Try again") { backend.retry() }
                        .disabled(backend.checking)
                        .foregroundStyle(Color.brand)
                }
            }
            .font(.subheadline.weight(.semibold))
            .padding(.horizontal, 18)
            .padding(.vertical, 10)
            .glassEffect(.regular, in: .capsule)
            .padding(.horizontal, 16)
            .transition(.move(edge: .bottom).combined(with: .opacity))
        }
    }
}
