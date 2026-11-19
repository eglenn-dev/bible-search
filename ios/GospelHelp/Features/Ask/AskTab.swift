import SwiftUI

struct AskTab: View {
    @Environment(AskModel.self) private var model
    @Environment(AppRouter.self) private var router
    @Environment(NetworkMonitor.self) private var network
    @FocusState private var focused: Bool

    var body: some View {
        NavigationStack {
            ScrollViewReader { proxy in
                ScrollView {
                    VStack(alignment: .leading, spacing: 14) {
                        Color.clear.frame(height: 0).id("top")
                        QuestionBox(focused: $focused)
                        notices
                        if model.asked == nil {
                            examples
                        } else {
                            AnswerSection()
                        }
                    }
                    .padding(.horizontal, 16)
                    .padding(.bottom, 32)
                    .frame(maxWidth: readingWidth)
                    .frame(maxWidth: .infinity)
                }
                .scrollDismissesKeyboard(.interactively)
                .onChange(of: model.asked) { _, _ in
                    withAnimation(.smooth) { proxy.scrollTo("top", anchor: .top) }
                }
            }
            .background { AppWash() }
            .navigationTitle("Ask")
            .navigationSubtitle("Answers from the library, with every source cited")
            .toolbar {
                if let answer = model.shareable {
                    ToolbarItem(placement: .primaryAction) {
                        AnswerShareMenu(answer: answer)
                    }
                }
            }
        }
        .task(id: router.tab == .ask && network.isOnline) {
            if router.tab == .ask && network.isOnline { await model.refreshStatus() }
        }
    }

    @ViewBuilder private var notices: some View {
        if !network.isOnline {
            NoticeCard(symbol: "wifi.slash", title: "You’re offline.", message: "Ask needs a connection to read and answer.")
        } else if let closed = model.closed {
            let message = closed.message
            NoticeCard(symbol: "clock", title: message.title, message: message.body) {
                Button {
                    router.tab = .search
                } label: {
                    Label("Search instead", systemImage: "magnifyingglass")
                        .font(.subheadline.weight(.semibold))
                }
                .buttonStyle(.glass)
                .padding(.leading, 34)
            }
        }
    }

    private var examples: some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionHeader(title: "Try asking")
            VStack(spacing: 0) {
                ForEach(Array(AskModel.examples.enumerated()), id: \.offset) { index, example in
                    if index > 0 { Divider().padding(.leading, 50) }
                    Button {
                        focused = false
                        model.ask(example)
                    } label: {
                        HStack(spacing: 14) {
                            Image(systemName: "questionmark.bubble")
                                .foregroundStyle(Color.brand)
                                .frame(width: 22)
                            Text(example)
                                .multilineTextAlignment(.leading)
                                .foregroundStyle(.primary)
                            Spacer(minLength: 0)
                        }
                        .padding(.horizontal, 16)
                        .padding(.vertical, 12)
                        .frame(minHeight: 52)
                        .contentShape(.rect)
                    }
                    .buttonStyle(.plain)
                    .disabled(!network.isOnline || model.closed != nil)
                    .opacity(!network.isOnline || model.closed != nil ? 0.5 : 1)
                }
            }
            .card()
            Text("Ask searches the library a few times, then answers only from what it found. Tap a number in the answer to read the passage it came from.")
                .font(.footnote)
                .foregroundStyle(.secondary)
                .padding(.horizontal, 4)
        }
        .padding(.top, 4)
    }
}

private struct QuestionBox: View {
    var focused: FocusState<Bool>.Binding
    @Environment(AskModel.self) private var model
    @Environment(NetworkMonitor.self) private var network

    var body: some View {
        @Bindable var model = model
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .bottom, spacing: 8) {
                TextField("Ask a gospel question…", text: $model.draft, axis: .vertical)
                    .lineLimit(2...6)
                    .font(.body)
                    .focused(focused)
                    .submitLabel(.send)
                    .disabled(model.closed != nil)
                    .onChange(of: model.draft) { old, value in
                        // Return sends (the field is multi-line for wrapping);
                        // a pasted paragraph is joined and capped, not sent.
                        let input = QuestionInput.apply(old: old, new: value, limit: AskService.maxQuestionChars)
                        if input.text != value { model.draft = input.text }
                        if input.submit { send() }
                    }
                    .padding(.vertical, 12)
                    .padding(.leading, 18)
                    .accessibilityLabel("Your question")
                    .accessibilityIdentifier("askField")

                if model.running {
                    Button {
                        model.stop()
                    } label: {
                        Image(systemName: "stop.fill").font(.footnote).frame(width: 22, height: 22)
                    }
                    .buttonStyle(.glass)
                    .buttonBorderShape(.circle)
                    .padding(.trailing, 6)
                    .padding(.bottom, 6)
                    .accessibilityLabel("Stop")
                } else {
                    Button(action: send) {
                        Image(systemName: "arrow.up").font(.body.weight(.bold)).foregroundStyle(Color.onBrand).frame(width: 22, height: 22)
                    }
                    .buttonStyle(.glassProminent)
                    .buttonBorderShape(.circle)
                    .tint(.brand)
                    .disabled(!model.canAsk(online: network.isOnline))
                    .padding(.trailing, 6)
                    .padding(.bottom, 6)
                    .accessibilityLabel("Ask")
                    .accessibilityIdentifier("askSubmit")
                }
            }
            .glassEffect(.regular.interactive(), in: .rect(cornerRadius: 26, style: .continuous))

            HStack {
                if let quota = model.quota, model.closed == nil {
                    Text(quota.dayLeft == 1 ? "1 question left today" : "\(quota.dayLeft) questions left today")
                }
                Spacer()
                if model.draft.count > AskService.maxQuestionChars - 80 {
                    Text("\(model.draft.count)/\(AskService.maxQuestionChars)").monospacedDigit()
                }
            }
            .font(.footnote)
            .foregroundStyle(.secondary)
            .padding(.horizontal, 10)
        }
    }

    private func send() {
        guard model.canAsk(online: network.isOnline) else { return }
        focused.wrappedValue = false
        model.ask(model.question)
    }
}

private struct AnswerSection: View {
    @Environment(AskModel.self) private var model
    @Environment(AppRouter.self) private var router
    @Environment(NetworkMonitor.self) private var network

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text(model.asked ?? "")
                .font(.display(.title2))
                .fixedSize(horizontal: false, vertical: true)
                .padding(.horizontal, 4)
                .padding(.top, 6)

            if !model.searches.isEmpty {
                FlowLayout(spacing: 6) {
                    ForEach(Array(model.searches.enumerated()), id: \.offset) { _, q in
                        Label(q, systemImage: "magnifyingglass")
                            .font(.footnote)
                            .lineLimit(1)
                            .foregroundStyle(.secondary)
                            .padding(.horizontal, 10)
                            .padding(.vertical, 5)
                            .background(Color.primary.opacity(0.07), in: .capsule)
                            .transition(.scale.combined(with: .opacity))
                    }
                }
                .padding(.horizontal, 4)
            }

            if model.running && !model.hasAnswer {
                HStack(spacing: 10) {
                    ProgressView()
                    Text(model.searches.isEmpty ? "Searching…" : "Reading the passages…")
                        .foregroundStyle(.secondary)
                }
                .padding(.horizontal, 4)
            }

            if model.hasAnswer {
                AnswerText(segments: model.segments, citations: model.citations, running: model.running) { _, passage in
                    router.open(passage)
                }
                .padding(18)
                .frame(maxWidth: .infinity, alignment: .leading)
                .card()
                .transition(.opacity)
            }

            if let error = model.error {
                VStack(alignment: .leading, spacing: 8) {
                    Text(error).foregroundStyle(Color.destructiveText)
                    if network.isOnline {
                        Button("Try again", systemImage: "arrow.counterclockwise") { model.retry() }
                            .fontWeight(.semibold)
                    }
                }
                .font(.subheadline)
                .padding(16)
                .frame(maxWidth: .infinity, alignment: .leading)
                .card()
            }

            if model.hasAnswer && !model.running {
                Text("Written by AI from the passages below. It can get things wrong, so read the sources.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, 4)
            }

            if !model.sources.isEmpty {
                VStack(alignment: .leading, spacing: 10) {
                    SectionHeader(title: "Sources")
                    ForEach(model.sources, id: \.n) { source in
                        ResultCard(passage: source.passage, marker: source.n)
                    }
                }
                .padding(.top, 6)
            }

            if !model.running {
                HStack(spacing: 12) {
                    if let answer = model.shareable {
                        AnswerShareMenu(answer: answer, prominent: true)
                    }
                    Button {
                        withAnimation(.smooth) { model.reset() }
                    } label: {
                        Text("Ask another question").font(.subheadline.weight(.semibold)).padding(.horizontal, 6)
                    }
                    .buttonStyle(.glass)
                    .controlSize(.large)
                }
                .frame(maxWidth: .infinity)
                .padding(.top, 8)
            }
        }
        .animation(.smooth, value: model.searches.count)
        .animation(.smooth, value: model.hasAnswer)
    }
}

/// Share an answer as a link (it opens on gospel.help) or copy it as text.
struct AnswerShareMenu: View {
    var answer: ShareCodec.Answer
    var prominent = false
    @Environment(AppRouter.self) private var router

    var body: some View {
        let link = Result { try ShareCodec.answerURL(answer) }
        Menu {
            switch link {
            case .success(let url):
                ShareLink(item: url, subject: Text(answer.question)) {
                    Label("Share as a Link", systemImage: "link")
                }
            case .failure(let error):
                Button(error.localizedDescription, systemImage: "link") {}.disabled(true)
            }
            Button("Copy as Text", systemImage: "doc.on.doc") {
                UIPasteboard.general.string = ShareCodec.answerText(answer)
                router.notify("Answer copied")
            }
        } label: {
            if prominent {
                Label("Share", systemImage: "square.and.arrow.up")
                    .font(.subheadline.weight(.semibold))
                    .padding(.horizontal, 6)
            } else {
                Label("Share this answer", systemImage: "square.and.arrow.up")
            }
        }
        .modifier(ShareMenuStyle(prominent: prominent))
    }
}

private struct ShareMenuStyle: ViewModifier {
    var prominent: Bool
    func body(content: Content) -> some View {
        if prominent {
            content.buttonStyle(.glass).controlSize(.large)
        } else {
            content
        }
    }
}

/// Wraps its children onto as many lines as they need.
struct FlowLayout: Layout {
    var spacing: CGFloat = 8

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let rows = arrange(width: proposal.width ?? .infinity, subviews: subviews)
        let height = rows.last.map { $0.y + $0.height } ?? 0
        let width = rows.map(\.width).max() ?? 0
        return CGSize(width: proposal.width ?? width, height: height)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let rows = arrange(width: bounds.width, subviews: subviews)
        for row in rows {
            var x = bounds.minX
            for index in row.indices {
                let size = subviews[index].sizeThatFits(.init(width: bounds.width, height: nil))
                let clamped = CGSize(width: min(size.width, bounds.width), height: size.height)
                subviews[index].place(at: CGPoint(x: x, y: bounds.minY + row.y), proposal: .init(clamped))
                x += clamped.width + spacing
            }
        }
    }

    private struct Row { var indices: [Int] = []; var y: CGFloat = 0; var width: CGFloat = 0; var height: CGFloat = 0 }

    private func arrange(width: CGFloat, subviews: Subviews) -> [Row] {
        var rows: [Row] = [Row()]
        for (i, view) in subviews.enumerated() {
            let size = view.sizeThatFits(.init(width: width, height: nil))
            let w = min(size.width, width)
            if !rows[rows.count - 1].indices.isEmpty, rows[rows.count - 1].width + spacing + w > width {
                let last = rows[rows.count - 1]
                rows.append(Row(y: last.y + last.height + spacing))
            }
            var row = rows[rows.count - 1]
            row.width += (row.indices.isEmpty ? 0 : spacing) + w
            row.height = max(row.height, size.height)
            row.indices.append(i)
            rows[rows.count - 1] = row
        }
        return rows
    }
}
