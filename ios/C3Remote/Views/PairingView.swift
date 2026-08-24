import SwiftUI
import UIKit

struct PairingView: View {
    @EnvironmentObject private var store: RemoteStore
    @State private var pairingLink = ""
    @State private var isConnecting = false
    @FocusState private var linkFocused: Bool

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    VStack(alignment: .leading, spacing: 12) {
                        Image(systemName: "shippingbox.fill")
                            .font(.largeTitle)
                            .foregroundStyle(Color.accentColor)
                            .accessibilityHidden(true)
                        Text("Your agents, away from the desk")
                            .font(.title2.bold())
                        Text("Paste the pairing link from C3 Settings on your Mac. Keep Tailscale connected on both devices.")
                            .font(.body)
                            .foregroundStyle(.secondary)
                    }
                    .padding(.vertical, 8)
                }

                Section("Pairing link") {
                    TextField("http://100.x.x.x:9399/#token=…", text: $pairingLink, axis: .vertical)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .keyboardType(.URL)
                        .focused($linkFocused)
                        .lineLimit(2...4)

                    Button("Paste from Clipboard", systemImage: "doc.on.clipboard") {
                        pairingLink = UIPasteboard.general.string ?? ""
                    }
                }

                if let error = store.errorMessage {
                    Section {
                        Label(error, systemImage: "exclamationmark.triangle.fill")
                            .foregroundStyle(.red)
                    }
                }

                Section {
                    Button {
                        Task {
                            isConnecting = true
                            if await store.connect(pairingLink: pairingLink) {
                                linkFocused = false
                            }
                            isConnecting = false
                        }
                    } label: {
                        HStack {
                            Spacer()
                            if isConnecting {
                                ProgressView()
                            } else {
                                Text("Connect to C3").bold()
                            }
                            Spacer()
                        }
                    }
                    .disabled(pairingLink.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || isConnecting)
                }

                Section {
                    Text("C3 Remote connects directly to your Mac over Tailscale. The access token is stored in this iPhone’s Keychain.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }
            .navigationTitle("C3 Remote")
        }
    }
}
