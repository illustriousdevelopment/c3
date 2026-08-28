import Foundation

@MainActor
final class RemoteStore: ObservableObject {
    @Published private(set) var configuration: PairingConfiguration?
    @Published private(set) var sessions: [RemoteSession] = []
    @Published private(set) var sessionMeta: [String: RemoteSessionMeta] = [:]
    @Published private(set) var groups: [RemoteSessionGroup] = []
    @Published private(set) var isConnected = false
    @Published private(set) var isRefreshing = false
    @Published var errorMessage: String?

    init() {
#if DEBUG
        if let pairingLink = ProcessInfo.processInfo.environment["C3_REMOTE_PAIRING_URL"],
           let debugConfiguration = try? PairingConfiguration.parse(pairingLink) {
            configuration = debugConfiguration
            try? PairingStore.save(debugConfiguration)
            return
        }
#endif
        configuration = PairingStore.load()
    }

    var endpointLabel: String {
        configuration?.endpoint.host ?? "Not connected"
    }

    var orderedSessions: [RemoteSession] {
        sessions.sorted { left, right in
            if left.state.priority != right.state.priority {
                return left.state.priority < right.state.priority
            }
            return left.activityDate > right.activityDate
        }
    }

    func connect(pairingLink: String, persist: Bool = true) async -> Bool {
        do {
            let configuration = try PairingConfiguration.parse(pairingLink)
            let api = RemoteAPI(configuration: configuration)
            _ = try await api.health()
            if persist {
                try PairingStore.save(configuration)
            }
            self.configuration = configuration
            isConnected = true
            errorMessage = nil
            await refresh()
            return true
        } catch {
            errorMessage = error.localizedDescription
            isConnected = false
            return false
        }
    }

    func refresh() async {
        guard let configuration else { return }
        isRefreshing = true
        defer { isRefreshing = false }
        do {
            let dashboard = try await RemoteAPI(configuration: configuration).dashboard()
            sessions = dashboard.sessions
            sessionMeta = dashboard.sessionMeta.sessions
            groups = dashboard.sessionMeta.groups
            isConnected = true
            errorMessage = nil
        } catch {
            isConnected = false
            errorMessage = error.localizedDescription
        }
    }

    func capture(sessionID: String) async throws -> PaneCapture {
        guard let configuration else {
            throw RemoteAPIError.message("C3 Remote is not paired.")
        }
        return try await RemoteAPI(configuration: configuration).capture(sessionID: sessionID)
    }

    func captureStream(sessionID: String) throws -> AsyncThrowingStream<PaneCapture, Error> {
        guard let configuration else {
            throw RemoteAPIError.message("C3 Remote is not paired.")
        }
        return RemoteAPI(configuration: configuration).captureStream(sessionID: sessionID)
    }

    func send(sessionID: String, text: String) async throws {
        guard let configuration else {
            throw RemoteAPIError.message("C3 Remote is not paired.")
        }
        try await RemoteAPI(configuration: configuration).send(sessionID: sessionID, text: text)
    }

    func sendKey(sessionID: String, key: String) async throws {
        guard let configuration else {
            throw RemoteAPIError.message("C3 Remote is not paired.")
        }
        try await RemoteAPI(configuration: configuration).sendKey(sessionID: sessionID, key: key)
    }

    func projects() async throws -> [RemoteProject] {
        guard let configuration else {
            throw RemoteAPIError.message("C3 Remote is not paired.")
        }
        return try await RemoteAPI(configuration: configuration).projects()
    }

    func launch(
        agentKind: String,
        projectPath: String,
        prompt: String?
    ) async throws -> RemoteLaunchResult {
        guard let configuration else {
            throw RemoteAPIError.message("C3 Remote is not paired.")
        }
        return try await RemoteAPI(configuration: configuration).launch(
            agentKind: agentKind,
            projectPath: projectPath,
            prompt: prompt
        )
    }

    func disconnect() {
        do {
            try PairingStore.remove()
        } catch {
            errorMessage = error.localizedDescription
            return
        }
        configuration = nil
        sessions = []
        sessionMeta = [:]
        groups = []
        isConnected = false
        errorMessage = nil
    }
}
