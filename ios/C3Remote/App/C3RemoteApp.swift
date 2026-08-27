import SwiftUI

@main
struct C3RemoteApp: App {
    @StateObject private var store = RemoteStore()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(store)
                .tint(.blue)
                .preferredColorScheme(.dark)
        }
    }
}

private struct RootView: View {
    @EnvironmentObject private var store: RemoteStore

    var body: some View {
        Group {
            if store.configuration == nil {
                PairingView()
            } else {
                SessionBoardView()
            }
        }
        .task {
#if DEBUG
            if store.configuration == nil,
               let pairingLink = ProcessInfo.processInfo.environment["C3_REMOTE_PAIRING_LINK"] {
                _ = await store.connect(pairingLink: pairingLink, persist: false)
            }
#endif
        }
    }
}
