import SwiftUI
import UIKit

struct SessionDetailView: View {
    @EnvironmentObject private var store: RemoteStore
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    let session: RemoteSession

    @State private var paneOutput = AttributedString("Loading pane…")
    @State private var paneRevision = ""
    @State private var paneRequestGeneration = 0
    @State private var liveMode = true
    @State private var streamActive = false
    @State private var draft = ""
    @State private var isSending = false
    @State private var pendingTerminalKeys: [RemoteTerminalKey] = []
    @State private var isSendingTerminalKey = false
    @State private var terminalKeyBurstCount = 0
    @State private var statusMessage: String?
    @State private var sendErrorMessage: String?
    @State private var paneErrorMessage: String?
    @State private var connectionMessage: String?
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
            ToolbarItemGroup(placement: .topBarTrailing) {
                Button {
                    liveMode.toggle()
                } label: {
                    HStack(spacing: 5) {
                        Image(systemName: liveMode
                              ? "dot.radiowaves.left.and.right"
                              : "leaf")
                        Text(updateModeLabel)
                    }
                    .font(.caption.bold())
                    .frame(minHeight: 44)
                }
                .accessibilityLabel("Live updates")
                .accessibilityValue(updateModeLabel)
                .accessibilityHint("Double-tap to switch between live streaming and battery saver polling")

                if !liveMode {
                    Button("Refresh", systemImage: "arrow.clockwise") {
                        Task { await refreshPane() }
                    }
                }
            }
        }
        .toolbarBackground(Color.black, for: .navigationBar)
        .toolbarBackground(.visible, for: .navigationBar)
        .safeAreaInset(edge: .bottom, spacing: 0) {
            composer
        }
        .onAppear {
            store.recordInteraction(sessionID: session.id)
        }
        .task(id: liveMode) {
            await runPaneUpdates()
        }
        .onChange(of: updateModeLabel) { _, mode in
            UIAccessibility.post(
                notification: .announcement,
                argument: "Live updates: \(mode)"
            )
        }
    }

    private var updateModeLabel: String {
        if !liveMode { return "Saver" }
        return streamActive ? "Live" : "Fallback"
    }

    private var composer: some View {
        VStack(alignment: .leading, spacing: 7) {
            terminalKeyBar
            Group {
                if let sendErrorMessage {
                    Label(sendErrorMessage, systemImage: "exclamationmark.triangle.fill")
                        .foregroundStyle(.red)
                } else if let paneErrorMessage {
                    Label(paneErrorMessage, systemImage: "wifi.exclamationmark")
                        .foregroundStyle(.orange)
                } else if let statusMessage {
                    Text(statusMessage)
                        .foregroundStyle(.secondary)
                } else if let connectionMessage {
                    Text(connectionMessage)
                        .foregroundStyle(.secondary)
                } else {
                    Text("Status")
                        .hidden()
                }
            }
            .font(.caption)
            .frame(minHeight: 18, alignment: .leading)
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
                .disabled(
                    draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                        || isSending
                        || isSendingTerminalKey
                )
                .accessibilityLabel("Send response")
            }
        }
        .padding(.horizontal, 12)
        .padding(.top, 10)
        .padding(.bottom, 8)
        .background(.bar)
    }

    @ViewBuilder
    private var terminalKeyBar: some View {
        if dynamicTypeSize.isAccessibilitySize {
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 4) {
                    ForEach([
                        RemoteTerminalKey.escape,
                        .tab,
                        .left,
                        .up,
                    ]) { key in
                        terminalKeyButton(key)
                    }
                }
                HStack(spacing: 4) {
                    ForEach([
                        RemoteTerminalKey.down,
                        .right,
                        .enter,
                    ]) { key in
                        terminalKeyButton(key)
                    }
                }
            }
            .accessibilityLabel("Terminal keys")
        } else {
            ScrollView(.horizontal) {
                HStack(spacing: 4) {
                    ForEach(RemoteTerminalKey.allCases) { key in
                        terminalKeyButton(key)
                    }
                }
            }
            .scrollIndicators(.hidden)
            .accessibilityLabel("Terminal keys")
        }
    }

    private func terminalKeyButton(_ key: RemoteTerminalKey) -> some View {
        Button {
            enqueueTerminalKey(key)
        } label: {
            Group {
                if let systemImage = key.systemImage {
                    Image(systemName: systemImage)
                } else {
                    Text(key.visibleLabel)
                        .font(.caption2.monospaced().weight(.semibold))
                        .textCase(.uppercase)
                }
            }
            .frame(minWidth: key.wide ? 48 : 44, minHeight: 44)
        }
        .buttonStyle(TerminalKeyButtonStyle())
        .disabled(isSending)
        .accessibilityLabel(key.accessibilityLabel)
    }

    private func runPaneUpdates() async {
        streamActive = false
        paneErrorMessage = nil
        if !liveMode {
            connectionMessage = "Battery saver · refreshes every 1.5 seconds"
            await refreshPane()
            while !Task.isCancelled {
                do {
                    try await Task.sleep(for: .milliseconds(1500))
                } catch {
                    return
                }
                await refreshPane()
            }
            return
        }

        connectionMessage = "Connecting live updates…"
        var failures = 0
        while !Task.isCancelled {
            do {
                let captures = try store.captureStream(sessionID: session.id)
                for try await capture in captures {
                    try Task.checkCancellation()
                    applyPaneCapture(capture)
                    streamActive = true
                    failures = 0
                    connectionMessage = nil
                    paneErrorMessage = nil
                }
                throw RemoteAPIError.message("C3 live stream closed.")
            } catch is CancellationError {
                return
            } catch RemoteAPIError.unauthorized {
                streamActive = false
                connectionMessage = "Pairing expired—paste a fresh C3 pairing link"
                return
            } catch {
                guard !Task.isCancelled else { return }
                streamActive = false
                failures = min(failures + 1, 4)
                connectionMessage = "Live updates interrupted—reconnecting"
                await refreshPane()
                let delayMilliseconds = 750 * (1 << (failures - 1))
                    + Int.random(in: 0...250)
                do {
                    try await Task.sleep(for: .milliseconds(delayMilliseconds))
                } catch {
                    return
                }
            }
        }
    }

    private func refreshPane() async {
        paneRequestGeneration += 1
        let generation = paneRequestGeneration
        do {
            let capture = try await store.capture(sessionID: session.id)
            guard generation == paneRequestGeneration else { return }
            applyPaneCapture(capture)
            paneErrorMessage = nil
        } catch RemoteAPIError.unauthorized {
            guard generation == paneRequestGeneration else { return }
            paneErrorMessage = "Pairing expired—paste a fresh C3 pairing link."
        } catch {
            guard generation == paneRequestGeneration else { return }
            if !liveMode {
                paneErrorMessage = "Couldn’t refresh the pane. Retrying."
            }
        }
    }

    private func applyPaneCapture(_ capture: PaneCapture) {
        if let revision = capture.revision, revision == paneRevision {
            return
        }
        paneOutput = styledOutput(from: capture)
        paneRevision = capture.revision ?? capture.capturedAt
    }

    private func styledOutput(from capture: PaneCapture) -> AttributedString {
        guard let lines = capture.styledLines else {
            return AttributedString(capture.output ?? "")
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
        guard !response.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              !isSendingTerminalKey else { return }
        Task {
            isSending = true
            sendErrorMessage = nil
            statusMessage = "Sending…"
            UIAccessibility.post(notification: .announcement, argument: "Sending response")
            do {
                try await store.send(sessionID: session.id, text: response)
                store.recordInteraction(sessionID: session.id)
                draft = ""
                statusMessage = "Sent"
                UIAccessibility.post(notification: .announcement, argument: "Response sent")
                composerFocused = false
                if !liveMode {
                    try? await Task.sleep(for: .milliseconds(350))
                    await refreshPane()
                }
                try? await Task.sleep(for: .seconds(3))
                if statusMessage == "Sent" { statusMessage = nil }
            } catch {
                sendErrorMessage = "Couldn’t send. Your response is still here; try again."
                statusMessage = nil
                UIAccessibility.post(
                    notification: .announcement,
                    argument: "Couldn’t send. Your response is still here; try again."
                )
            }
            isSending = false
        }
    }

    private func enqueueTerminalKey(_ key: RemoteTerminalKey) {
        pendingTerminalKeys.append(key)
        terminalKeyBurstCount += 1
        let count = terminalKeyBurstCount
        statusMessage = "\(count) \(count == 1 ? "key" : "keys") queued"
        sendErrorMessage = nil
        guard !isSendingTerminalKey else { return }
        isSendingTerminalKey = true
        Task { @MainActor in
            await drainTerminalKeyQueue()
        }
    }

    @MainActor
    private func drainTerminalKeyQueue() async {
        var sentCount = 0
        while let key = pendingTerminalKeys.first {
            pendingTerminalKeys.removeFirst()
            do {
                try await store.sendKey(sessionID: session.id, key: key.rawValue)
                sentCount += 1
            } catch {
                pendingTerminalKeys.removeAll()
                terminalKeyBurstCount = 0
                sendErrorMessage = "Couldn’t send the \(key.accessibilityLabel.lowercased()). Try again."
                statusMessage = nil
                UIAccessibility.post(
                    notification: .announcement,
                    argument: sendErrorMessage
                )
                break
            }
        }
        isSendingTerminalKey = false
        terminalKeyBurstCount = 0
        if sentCount > 0, sendErrorMessage == nil {
            store.recordInteraction(sessionID: session.id)
            let completion = "\(sentCount) \(sentCount == 1 ? "key" : "keys") sent"
            statusMessage = completion
            UIAccessibility.post(
                notification: .announcement,
                argument: completion
            )
            if !liveMode {
                try? await Task.sleep(for: .milliseconds(200))
                await refreshPane()
            }
            try? await Task.sleep(for: .seconds(1))
            if statusMessage == completion {
                statusMessage = nil
            }
        }
    }
}

private enum RemoteTerminalKey: String, CaseIterable, Identifiable {
    case escape
    case tab
    case left
    case up
    case down
    case right
    case enter

    var id: String { rawValue }

    var visibleLabel: String {
        switch self {
        case .escape: "esc"
        case .tab: "tab"
        case .left: "←"
        case .up: "↑"
        case .down: "↓"
        case .right: "→"
        case .enter: "enter"
        }
    }

    var systemImage: String? {
        switch self {
        case .left: "arrow.left"
        case .up: "arrow.up"
        case .down: "arrow.down"
        case .right: "arrow.right"
        case .escape, .tab, .enter: nil
        }
    }

    var wide: Bool {
        systemImage == nil
    }

    var accessibilityLabel: String {
        switch self {
        case .escape: "Escape key"
        case .tab: "Tab key"
        case .left: "Left arrow"
        case .up: "Up arrow"
        case .down: "Down arrow"
        case .right: "Right arrow"
        case .enter: "Enter key"
        }
    }
}

private struct TerminalKeyButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .background(
                Color(uiColor: configuration.isPressed
                      ? .tertiarySystemFill
                      : .quaternarySystemFill),
                in: RoundedRectangle(cornerRadius: 7)
            )
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
