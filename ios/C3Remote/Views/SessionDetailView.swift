import SwiftUI

struct SessionDetailView: View {
    @EnvironmentObject private var store: RemoteStore
    let session: RemoteSession

    @State private var paneOutput = "Loading pane…"
    @State private var draft = ""
    @State private var isSending = false
    @State private var statusMessage: String?
    @State private var errorMessage: String?
    @FocusState private var composerFocused: Bool

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                Text(paneOutput)
                    .font(.system(.caption, design: .monospaced))
                    .foregroundStyle(Color(uiColor: .lightText))
                    .textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(14)
                    .id("pane-bottom")
            }
            .background(Color.black)
            .onChange(of: paneOutput) {
                withAnimation(.none) {
                    proxy.scrollTo("pane-bottom", anchor: .bottom)
                }
            }
        }
        .navigationTitle(session.displayName)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button("Refresh", systemImage: "arrow.clockwise") {
                    Task { await refreshPane() }
                }
            }
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            composer
        }
        .task {
            await refreshPane()
            while !Task.isCancelled {
                try? await Task.sleep(for: .milliseconds(1500))
                await refreshPane()
            }
        }
    }

    private var composer: some View {
        VStack(alignment: .leading, spacing: 7) {
            if let errorMessage {
                Label(errorMessage, systemImage: "exclamationmark.triangle.fill")
                    .font(.caption)
                    .foregroundStyle(.red)
            } else if let statusMessage {
                Text(statusMessage)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            HStack(alignment: .bottom, spacing: 8) {
                TextField("Type or dictate a response", text: $draft, axis: .vertical)
                    .lineLimit(1...5)
                    .focused($composerFocused)
                    .textFieldStyle(.roundedBorder)
                    .submitLabel(.send)
                    .onSubmit { submitResponse() }

                Button(action: submitResponse) {
                    if isSending {
                        ProgressView()
                            .frame(width: 44, height: 44)
                    } else {
                        Image(systemName: "arrow.up")
                            .font(.headline.bold())
                            .frame(width: 44, height: 44)
                            .background(Color.accentColor)
                            .foregroundStyle(Color.white)
                            .clipShape(Circle())
                    }
                }
                .disabled(draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || isSending)
                .accessibilityLabel("Send response")
            }
        }
        .padding(.horizontal, 12)
        .padding(.top, 10)
        .padding(.bottom, 8)
        .background(.bar)
    }

    private func refreshPane() async {
        do {
            paneOutput = try await store.capture(sessionID: session.id).output
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func submitResponse() {
        let response = draft
        guard !response.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
        Task {
            isSending = true
            errorMessage = nil
            statusMessage = "Sending…"
            do {
                try await store.send(sessionID: session.id, text: response)
                draft = ""
                statusMessage = "Sent"
                composerFocused = false
                try? await Task.sleep(for: .milliseconds(350))
                await refreshPane()
                try? await Task.sleep(for: .seconds(1))
                if statusMessage == "Sent" { statusMessage = nil }
            } catch {
                errorMessage = error.localizedDescription
                statusMessage = nil
            }
            isSending = false
        }
    }
}
