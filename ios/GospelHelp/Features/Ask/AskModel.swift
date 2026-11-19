import Foundation
import Observation

/// One question, one cited answer. Not a chat: a new question replaces the
/// last answer. Lives above the tab so an answer keeps streaming (and stays
/// readable) while you look at another tab.
@MainActor
@Observable
final class AskModel {
    enum Status { case idle, running, done, error }

    var draft = ""
    private(set) var asked: String?
    private(set) var status: Status = .idle
    private(set) var searches: [String] = []
    private(set) var segments: [AskSegment] = []
    private(set) var citations: [Int: Passage] = [:]
    private(set) var error: String?
    private(set) var quota: AskQuota?
    /// A limit (the day's budget, or this user's quota) closing the box.
    private(set) var closed: AskClosed?

    @ObservationIgnored private var task: Task<Void, Never>?
    @ObservationIgnored private var reopenTask: Task<Void, Never>?
    /// Bumped by every question, so a status check that started before one
    /// can't overwrite the quota the answer's stream reported.
    @ObservationIgnored private var generation = 0

    static let examples = [
        "How can I keep my faith when I have doubts?",
        "What do the scriptures teach about grace?",
        "What has President Nelson taught about the gathering of Israel?",
        "Why do we partake of the sacrament each week?",
    ]

    var running: Bool { status == .running }
    var question: String { draft.trimmingCharacters(in: .whitespacesAndNewlines) }
    var hasAnswer: Bool { segments.contains { !$0.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty } }

    func canAsk(online: Bool) -> Bool {
        online && closed == nil && !running && question.count >= 3
    }

    var sources: [(n: Int, passage: Passage)] {
        citations.keys.sorted().map { ($0, citations[$0]!) }
    }

    /// A finished answer (or one stopped partway) can be shared.
    var shareable: ShareCodec.Answer? {
        guard let asked, status == .done, hasAnswer else { return nil }
        return ShareCodec.Answer(question: asked, segments: segments, citations: citations)
    }

    /// Checks the limits before anyone types (each time the tab opens).
    func refreshStatus() async {
        let started = generation
        guard let result = await AskService.status(), started == generation, !running else { return }
        setClosed(result.closed)
        quota = result.quota
    }

    func ask(_ text: String) {
        task?.cancel()
        generation += 1
        draft = ""
        asked = text
        status = .running
        searches = []
        segments = []
        citations = [:]
        error = nil
        task = Task { [weak self] in
            do {
                for try await event in AskService.ask(text) {
                    guard let self, !Task.isCancelled else { return }
                    switch event {
                    case .quota(let q): self.quota = q
                    case .search(let q): self.searches.append(q)
                    case .answer(let s): self.segments = s
                    case .citation(let n, let p): self.citations[n] = p
                    case .reset: self.citations = [:]
                    }
                }
                guard let self, !Task.isCancelled else { return }
                self.status = .done
            } catch {
                guard let self, !Task.isCancelled else { return }
                if case AskError.closed(let closed) = error {
                    // Not a failure: close the box and keep the question.
                    self.setClosed(closed)
                    self.asked = nil
                    self.status = .idle
                    self.draft = text
                    return
                }
                self.error = (error as? LocalizedError)?.errorDescription ?? "Ask hit a problem."
                self.status = .error
            }
        }
    }

    func retry() {
        if let asked { ask(asked) }
    }

    func stop() {
        task?.cancel()
        if hasAnswer {
            status = .done
        } else {
            // Nothing to keep: put the question back to edit or re-ask.
            status = .idle
            draft = asked ?? ""
            asked = nil
        }
    }

    func reset() {
        task?.cancel()
        asked = nil
        status = .idle
        searches = []
        segments = []
        citations = [:]
        error = nil
        draft = ""
    }

    private func setClosed(_ next: AskClosed?) {
        closed = next
        reopenTask?.cancel()
        guard let reset = next?.resetAt else { return }
        // Reopen when the limit lifts, then confirm with a fresh check.
        reopenTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(max(0, reset.timeIntervalSinceNow) + 2))
            guard !Task.isCancelled, let self else { return }
            self.closed = nil
            await self.refreshStatus()
        }
    }
}
