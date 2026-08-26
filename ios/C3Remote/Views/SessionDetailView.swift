import SwiftUI
import UIKit

struct SessionDetailView: View {
    @EnvironmentObject private var store: RemoteStore
    let session: RemoteSession

    @State private var paneOutput = AttributedString("Loading pane…")
    @State private var paneRevision = ""
    @State private var paneRequestGeneration = 0
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
            .onChange(of: paneRevision) {
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
        paneRequestGeneration += 1
        let generation = paneRequestGeneration
        do {
            let capture = try await store.capture(sessionID: session.id)
            guard generation == paneRequestGeneration else { return }
            if let revision = capture.revision, revision == paneRevision {
                errorMessage = nil
                return
            }
            paneOutput = styledOutput(from: capture)
            paneRevision = capture.revision ?? capture.capturedAt
            errorMessage = nil
        } catch {
            guard generation == paneRequestGeneration else { return }
            errorMessage = error.localizedDescription
        }
    }

    private func styledOutput(from capture: PaneCapture) -> AttributedString {
        guard let lines = capture.styledLines else {
            return AttributedString(capture.output)
        }
        var result = AttributedString()
        for (lineIndex, line) in lines.enumerated() {
            for span in line {
                var attributes = AttributeContainer()
                var font = Font.system(.caption, design: .monospaced)
                if span.bold == true { font = font.bold() }
                if span.italic == true { font = font.italic() }
                attributes.font = font
                if let foreground = span.foreground.flatMap(Color.init(ansiHex:)) {
                    attributes.foregroundColor = span.dim == true ? foreground.opacity(0.62) : foreground
                } else if span.dim == true {
                    attributes.foregroundColor = Color(uiColor: .lightText).opacity(0.62)
                }
                if let background = span.background.flatMap(Color.init(ansiHex:)) {
                    attributes.backgroundColor = background
                }
                if span.underline == true {
                    attributes.underlineStyle = .single
                }
                result.append(AttributedString(span.text, attributes: attributes))
            }
            if lineIndex < lines.count - 1 {
                result.append(AttributedString("\n"))
            }
        }
        return result
    }

    private func submitResponse() {
        let response = draft
        guard !response.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
        Task {
            isSending = true
            errorMessage = nil
            statusMessage = "Sending…"
            UIAccessibility.post(notification: .announcement, argument: "Sending response")
            do {
                try await store.send(sessionID: session.id, text: response)
                draft = ""
                statusMessage = "Sent"
                UIAccessibility.post(notification: .announcement, argument: "Response sent")
                composerFocused = false
                try? await Task.sleep(for: .milliseconds(350))
                await refreshPane()
                try? await Task.sleep(for: .seconds(3))
                if statusMessage == "Sent" { statusMessage = nil }
            } catch {
                errorMessage = error.localizedDescription
                statusMessage = nil
                UIAccessibility.post(
                    notification: .announcement,
                    argument: "Could not send response. \(error.localizedDescription)"
                )
            }
            isSending = false
        }
    }
}

private extension Color {
    init?(ansiHex: String) {
        let value = ansiHex.trimmingCharacters(in: CharacterSet(charactersIn: "#"))
        guard value.count == 6, let rgb = UInt64(value, radix: 16) else { return nil }
        self.init(
            red: Double((rgb >> 16) & 0xff) / 255,
            green: Double((rgb >> 8) & 0xff) / 255,
            blue: Double(rgb & 0xff) / 255
        )
    }
}
