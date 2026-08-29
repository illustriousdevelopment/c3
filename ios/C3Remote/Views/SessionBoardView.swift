import SwiftUI

private enum SessionBoardMode: String, CaseIterable, Identifiable {
    case attention = "Attention"
    case groups = "Groups"
    case recent = "Recent"

    var id: String { rawValue }
}

struct SessionBoardView: View {
    @EnvironmentObject private var store: RemoteStore
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @State private var searchText = ""
    @State private var navigationPath: [RemoteSession] = []
    @State private var boardMode: SessionBoardMode = .attention
    @State private var showingNewAgent = false

    private var filteredSessions: [RemoteSession] {
        let query = searchText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !query.isEmpty else { return store.orderedSessions }
        return store.orderedSessions.filter { session in
            [
                session.displayName,
                session.projectPath ?? "",
                session.agentKind ?? "",
                session.pendingAction?.description ?? "",
            ].contains { $0.localizedCaseInsensitiveContains(query) }
        }
    }

    private var recentSessions: [RemoteSession] {
        filteredSessions.sorted { left, right in
            let leftDate = store.recentInteractions[left.id]
            let rightDate = store.recentInteractions[right.id]
            if leftDate != rightDate {
                return (leftDate ?? .distantPast) > (rightDate ?? .distantPast)
            }
            if left.state.priority != right.state.priority {
                return left.state.priority < right.state.priority
            }
            let nameOrder = left.displayName.localizedCaseInsensitiveCompare(right.displayName)
            if nameOrder != .orderedSame {
                return nameOrder == .orderedAscending
            }
            return left.id < right.id
        }
    }

    private var columns: [GridItem] {
        if dynamicTypeSize.isAccessibilitySize {
            return [GridItem(.flexible(), spacing: 10, alignment: .top)]
        }
        return [
            GridItem(.flexible(), spacing: 10, alignment: .top),
            GridItem(.flexible(), spacing: 10, alignment: .top),
        ]
    }

    var body: some View {
        NavigationStack(path: $navigationPath) {
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 14) {
                    statusLine

                    if dynamicTypeSize.isAccessibilitySize {
                        HStack {
                            Text("Session view")
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                            Spacer()
                            Picker("Session view", selection: $boardMode) {
                                ForEach(SessionBoardMode.allCases) { mode in
                                    Text(mode.rawValue).tag(mode)
                                }
                            }
                            .labelsHidden()
                            .pickerStyle(.menu)
                            .accessibilityLabel("Session view")
                        }
                    } else {
                        Picker("Session view", selection: $boardMode) {
                            ForEach(SessionBoardMode.allCases) { mode in
                                Text(mode.rawValue).tag(mode)
                            }
                        }
                        .pickerStyle(.segmented)
                    }

                    boardContent
                }
                .padding(.horizontal, 12)
                .padding(.bottom, 24)
                .frame(maxWidth: 760)
                .frame(maxWidth: .infinity)
            }
            .background(Color(uiColor: .systemBackground))
            .navigationTitle("C3 Remote")
            .navigationBarTitleDisplayMode(.large)
            .toolbar {
                ToolbarItemGroup(placement: .topBarTrailing) {
                    Button("New agent", systemImage: "plus") {
                        showingNewAgent = true
                    }

                    Menu {
                        Text(store.endpointLabel)
                        Button(
                            "Disconnect",
                            systemImage: "rectangle.portrait.and.arrow.right",
                            role: .destructive
                        ) {
                            store.disconnect()
                        }
                    } label: {
                        Image(systemName: "ellipsis.circle")
                    }
                    .accessibilityLabel("Connection options")
                }
            }
            .searchable(
                text: $searchText,
                placement: .navigationBarDrawer(displayMode: .always),
                prompt: "Search agents"
            )
            .navigationDestination(for: RemoteSession.self) { session in
                SessionDetailView(session: session)
            }
            .sheet(isPresented: $showingNewAgent) {
                NewAgentView()
                    .environmentObject(store)
            }
            .refreshable { await store.refresh() }
            .task {
                await store.refresh()
                applyDebugPresentationIfNeeded()
                while !Task.isCancelled {
                    do {
                        try await Task.sleep(for: .seconds(3))
                    } catch {
                        return
                    }
                    await store.refresh()
                }
            }
        }
    }

    @ViewBuilder
    private var boardContent: some View {
        if store.sessions.isEmpty && store.isRefreshing {
            ProgressView("Loading agents…")
                .frame(maxWidth: .infinity)
                .padding(.top, 100)
        } else if store.sessions.isEmpty, let error = store.errorMessage {
            ContentUnavailableView {
                Label("Could not reach C3", systemImage: "wifi.exclamationmark")
            } description: {
                Text(error)
            } actions: {
                Button("Try Again") {
                    Task { await store.refresh() }
                }
            }
            .frame(maxWidth: .infinity)
            .padding(.top, 70)
        } else if store.sessions.isEmpty {
            ContentUnavailableView(
                "No agent panes",
                systemImage: "rectangle.stack",
                description: Text("Start an agent here or in tmux on your Mac.")
            )
            .frame(maxWidth: .infinity)
            .padding(.top, 80)
        } else if filteredSessions.isEmpty {
            ContentUnavailableView(
                "No matching agents",
                systemImage: "magnifyingglass",
                description: Text("Try another project, task, or agent name.")
            )
            .frame(maxWidth: .infinity)
            .padding(.top, 70)
        } else if boardMode == .attention {
            sessionGrid(filteredSessions)
        } else if boardMode == .recent {
            sessionGrid(recentSessions, showPhoneActivity: true)
        } else {
            groupedSessions
        }
    }

    private func sessionGrid(
        _ sessions: [RemoteSession],
        showPhoneActivity: Bool = false
    ) -> some View {
        LazyVGrid(columns: columns, spacing: 10) {
            ForEach(sessions) { session in
                let activity = showPhoneActivity
                    ? phoneActivity(sessionID: session.id)
                    : nil
                NavigationLink(value: session) {
                    SessionTile(
                        session: session,
                        localActivityLabel: activity?.visual,
                        localActivityAccessibilityLabel: activity?.accessibility
                    )
                }
                .buttonStyle(.plain)
                .simultaneousGesture(TapGesture().onEnded {
                    store.recordInteraction(sessionID: session.id)
                })
            }
        }
    }

    private var groupedSessions: some View {
        LazyVStack(alignment: .leading, spacing: 22) {
            ForEach(store.groups) { group in
                let sessions = filteredSessions.filter {
                    store.sessionMeta[$0.id]?.groupId == group.id
                }
                if searchText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                    || !sessions.isEmpty {
                    groupSection(name: group.name, color: group.color, sessions: sessions)
                }
            }

            let knownGroupIDs = Set(store.groups.map(\.id))
            let ungrouped = filteredSessions.filter { session in
                guard let groupID = store.sessionMeta[session.id]?.groupId else { return true }
                return !knownGroupIDs.contains(groupID)
            }
            if !ungrouped.isEmpty || store.groups.isEmpty {
                groupSection(name: "Ungrouped", color: "#737b88", sessions: ungrouped)
            }
        }
    }

    private func groupSection(
        name: String,
        color: String,
        sessions: [RemoteSession]
    ) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                Circle()
                    .fill(Color(c3Hex: color) ?? .secondary)
                    .frame(width: 9, height: 9)
                Text(name)
                    .font(.headline)
                Spacer()
                Text("\(sessions.count)")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("\(name), \(sessions.count) \(sessions.count == 1 ? "agent" : "agents")")
            .accessibilityAddTraits(.isHeader)

            if sessions.isEmpty {
                Text(searchText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                     ? "No agents"
                     : "No matching agents")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 18)
                    .overlay {
                        RoundedRectangle(cornerRadius: 5)
                            .stroke(.separator, style: StrokeStyle(lineWidth: 1, dash: [4]))
                    }
            } else {
                sessionGrid(sessions)
            }
        }
    }

    private func phoneActivity(sessionID: String) -> (
        visual: String,
        accessibility: String
    ) {
        guard let timestamp = store.recentInteractions[sessionID] else {
            return ("Not opened here", "No interaction on this phone")
        }
        let elapsedSeconds = max(0, Int(Date().timeIntervalSince(timestamp)))
        if elapsedSeconds < 60 {
            return ("Phone · now", "Last interaction on this phone, just now")
        }
        if elapsedSeconds < 3_600 {
            let minutes = elapsedSeconds / 60
            return (
                "Phone · \(minutes)m",
                "Last interaction on this phone, \(minutes) \(minutes == 1 ? "minute" : "minutes") ago"
            )
        }
        if elapsedSeconds < 86_400 {
            let hours = elapsedSeconds / 3_600
            return (
                "Phone · \(hours)h",
                "Last interaction on this phone, \(hours) \(hours == 1 ? "hour" : "hours") ago"
            )
        }
        let days = elapsedSeconds / 86_400
        return (
            "Phone · \(days)d",
            "Last interaction on this phone, \(days) \(days == 1 ? "day" : "days") ago"
        )
    }

    private var statusLine: some View {
        HStack {
            Text(searchText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                 ? "\(store.sessions.count) \(store.sessions.count == 1 ? "agent" : "agents")"
                 : "\(filteredSessions.count) of \(store.sessions.count) agents")
                .font(.headline)
            Spacer()
            HStack(spacing: 6) {
                Circle()
                    .fill(store.isConnected ? Color.green : Color.red)
                    .frame(width: 7, height: 7)
                Text(store.isConnected ? "Connected" : "Offline")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.top, 4)
        .accessibilityElement(children: .combine)
    }

    private func applyDebugPresentationIfNeeded() {
#if DEBUG
        let environment = ProcessInfo.processInfo.environment
        if environment["C3_REMOTE_BOARD_MODE"] == "groups" {
            boardMode = .groups
        } else if environment["C3_REMOTE_BOARD_MODE"] == "recent" {
            boardMode = .recent
        }
        if environment["C3_REMOTE_SHOW_NEW_AGENT"] == "1" {
            showingNewAgent = true
            return
        }
        guard navigationPath.isEmpty,
              let sessionID = environment["C3_REMOTE_SESSION_ID"],
              let session = store.sessions.first(where: { $0.id == sessionID }) else { return }
        navigationPath.append(session)
#endif
    }
}

private extension Color {
    init?(c3Hex: String) {
        let value = c3Hex.trimmingCharacters(in: CharacterSet(charactersIn: "#"))
        guard value.count == 6, let rgb = UInt64(value, radix: 16) else { return nil }
        self.init(
            red: Double((rgb >> 16) & 0xff) / 255,
            green: Double((rgb >> 8) & 0xff) / 255,
            blue: Double(rgb & 0xff) / 255
        )
    }
}
