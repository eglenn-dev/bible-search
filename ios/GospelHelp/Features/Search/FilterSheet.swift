import SwiftUI

/// Sources, speaker, years, sort and result count. A change re-runs what's
/// on screen when the sheet closes.
struct FilterSheet: View {
    @Environment(SearchModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var before: (sources: [Source], filters: SearchFilters, count: Int)?

    var body: some View {
        @Bindable var model = model
        let counts = model.sourceCounts

        NavigationStack {
            Form {
                Section("Sources") {
                    sourceRow(title: "All sources", symbol: "square.stack.3d.up", selected: model.sources.isEmpty) {
                        model.sources = []
                    }
                    ForEach(Source.allCases) { source in
                        sourceRow(
                            title: source.label, symbol: source.symbol,
                            selected: model.sources.contains(source), count: counts[source]
                        ) {
                            if let i = model.sources.firstIndex(of: source) {
                                model.sources.remove(at: i)
                            } else {
                                model.sources.append(source)
                            }
                        }
                    }
                }

                Section {
                    NavigationLink {
                        SpeakerPicker(selection: $model.filters.speaker)
                    } label: {
                        LabeledContent("Speaker", value: model.filters.speaker ?? "Any")
                    }
                    Picker("From", selection: $model.filters.yearFrom) {
                        Text("Any").tag(Int?.none)
                        ForEach(years, id: \.self) { y in
                            Text(String(y)).tag(Int?.some(y))
                                .selectionDisabled(model.filters.yearTo.map { y > $0 } ?? false)
                        }
                    }
                    Picker("To", selection: $model.filters.yearTo) {
                        Text("Any").tag(Int?.none)
                        ForEach(years, id: \.self) { y in
                            Text(String(y)).tag(Int?.some(y))
                                .selectionDisabled(model.filters.yearFrom.map { y < $0 } ?? false)
                        }
                    }
                } header: {
                    Text("Speaker and years")
                } footer: {
                    Text("Speaker and year filters only match Conference and BYU Speeches.")
                }

                Section("Sort by") {
                    Picker("Sort by", selection: $model.sortBy) {
                        ForEach(SortKey.allCases, id: \.self) { Text($0.label).tag($0) }
                    }
                    .pickerStyle(.segmented)
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets())
                }

                Section("Results per search") {
                    Picker("Results per search", selection: $model.resultCount) {
                        ForEach(resultCounts, id: \.self) { Text(String($0)).tag($0) }
                    }
                    .pickerStyle(.segmented)
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets())
                }

                if model.filterCount > 0 {
                    Section {
                        Button("Reset Filters", role: .destructive) {
                            model.sources = []
                            model.filters = .none
                        }
                    }
                }
            }
            .navigationTitle("Filters")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done", systemImage: "checkmark") { dismiss() }
                        .buttonStyle(.glassProminent)
                        .foregroundStyle(Color.onBrand)
                }
            }
        }
        .onAppear { before = (model.sources, model.filters, model.resultCount) }
        .onDisappear {
            guard let before else { return }
            if before.sources != model.sources || before.filters != model.filters || before.count != model.resultCount {
                Task { await model.filtersChanged() }
            }
        }
    }

    private var years: [Int] { Array((firstYear...Calendar.current.component(.year, from: .now)).reversed()) }

    private func sourceRow(
        title: String, symbol: String, selected: Bool, count: Int? = nil, action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            HStack(spacing: 12) {
                Image(systemName: symbol)
                    .foregroundStyle(Color.brand)
                    .frame(width: 24)
                Text(title).foregroundStyle(.primary)
                Spacer()
                if let count, count > 0 {
                    Text("\(count)").monospacedDigit().foregroundStyle(.secondary)
                }
                Image(systemName: "checkmark")
                    .font(.body.weight(.semibold))
                    .foregroundStyle(Color.brand)
                    .opacity(selected ? 1 : 0)
            }
            .contentShape(.rect)
        }
        .tint(.primary)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}

/// Every Conference / BYU speaker, searchable (accent-insensitive).
struct SpeakerPicker: View {
    @Binding var selection: String?
    @Environment(SpeakerStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var text = ""

    var body: some View {
        List {
            if text.isEmpty {
                Button {
                    selection = nil
                    dismiss()
                } label: {
                    row(name: "Any speaker", detail: nil, selected: selection == nil)
                }
            }
            if store.speakers == nil {
                HStack {
                    if store.failed {
                        Text("Speakers unavailable").foregroundStyle(.secondary)
                    } else {
                        ProgressView()
                        Text("Loading speakers…").foregroundStyle(.secondary)
                    }
                }
            } else {
                let matches = store.matches(text)
                if matches.isEmpty {
                    Text("No speakers match “\(text)”.").foregroundStyle(.secondary)
                }
                ForEach(matches) { s in
                    Button {
                        selection = s.name
                        dismiss()
                    } label: {
                        row(
                            name: s.name,
                            detail: [s.yearSpan, "\(s.talks) \(s.talks == 1 ? "talk" : "talks")"]
                                .filter { !$0.isEmpty }.joined(separator: " · "),
                            selected: selection == s.name)
                    }
                }
            }
        }
        .tint(.primary)
        .navigationTitle("Speaker")
        .searchable(text: $text, placement: .navigationBarDrawer(displayMode: .always), prompt: "Search speakers")
        .task { await store.load() }
    }

    private func row(name: String, detail: String?, selected: Bool) -> some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text(name).foregroundStyle(.primary)
                if let detail { Text(detail).font(.footnote).foregroundStyle(.secondary) }
            }
            Spacer()
            if selected {
                Image(systemName: "checkmark").foregroundStyle(Color.brand).fontWeight(.semibold)
            }
        }
        .contentShape(.rect)
    }
}
