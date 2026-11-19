import SwiftUI
import UIKit

/// Shows toasts in a window of their own, above sheets, so "Saved" confirms
/// from inside a passage sheet too. The window is only as big as the toast
/// and hidden when there is none, so it never takes touches from the app.
@MainActor
final class ToastWindowPresenter {
    private var window: UIWindow?
    private var host: UIHostingController<AnyView>?
    /// Bumped by every show, so a fade-out that started earlier doesn't hide
    /// a toast that arrived while it ran.
    private var generation = 0

    func show(_ toast: Toast?, in scene: UIWindowScene?, dismiss: @escaping () -> Void) {
        guard let toast, let scene else {
            hide()
            return
        }
        generation += 1
        let view = AnyView(
            ToastView(toast: toast, dismiss: dismiss)
                .tint(.brand)
                .padding(4))
        let host = self.host ?? UIHostingController(rootView: view)
        host.rootView = view
        host.view.backgroundColor = .clear
        host.sizingOptions = []
        self.host = host

        let window = self.window ?? UIWindow(windowScene: scene)
        if window.windowScene !== scene { window.windowScene = scene }
        window.windowLevel = .alert + 1
        window.backgroundColor = .clear
        window.rootViewController = host
        // Follow the app's chosen appearance.
        window.overrideUserInterfaceStyle = scene.keyWindow?.overrideUserInterfaceStyle ?? .unspecified
        self.window = window

        let bounds = scene.effectiveGeometry.coordinateSpace.bounds
        let top = scene.keyWindow?.safeAreaInsets.top ?? 44
        let size = host.sizeThatFits(in: CGSize(width: bounds.width - 32, height: 120))
        let width = min(size.width, bounds.width - 32)
        let target = CGRect(x: (bounds.width - width) / 2, y: top + 4, width: width, height: size.height)

        if window.isHidden {
            window.frame = target.offsetBy(dx: 0, dy: -24)
            window.alpha = 0
            window.isHidden = false
            UIView.animate(withDuration: 0.35, delay: 0, usingSpringWithDamping: 0.8, initialSpringVelocity: 0) {
                window.frame = target
                window.alpha = 1
            }
        } else {
            window.layer.removeAllAnimations()
            window.frame = target
            window.alpha = 1
        }
        UIAccessibility.post(notification: .announcement, argument: toast.message)
    }

    private func hide() {
        guard let window, !window.isHidden else { return }
        let fading = generation
        UIView.animate(withDuration: 0.25) {
            window.alpha = 0
            window.frame = window.frame.offsetBy(dx: 0, dy: -16)
        } completion: { [weak self] _ in
            guard let self, self.generation == fading else { return }
            window.isHidden = true
        }
    }
}

/// Finds the window scene a view lives in.
struct WindowSceneReader: UIViewRepresentable {
    var onScene: (UIWindowScene?) -> Void

    func makeUIView(context: Context) -> SceneProbe {
        let view = SceneProbe()
        view.onScene = onScene
        return view
    }

    func updateUIView(_ uiView: SceneProbe, context: Context) {}

    final class SceneProbe: UIView {
        var onScene: ((UIWindowScene?) -> Void)?
        override func didMoveToWindow() {
            super.didMoveToWindow()
            isUserInteractionEnabled = false
            onScene?(window?.windowScene)
        }
    }
}
