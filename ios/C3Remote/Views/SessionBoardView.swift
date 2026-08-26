import SwiftUI

struct SessionBoardView: View {
    @EnvironmentObject private var store: RemoteStore
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @State private var searchText = ""
    @State private var navigationPath: [RemoteSession] = []

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
                            description: Text("C3 will add sessions when an agent starts in tmux.")
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
                    } else {
                        LazyVGrid(columns: columns, spacing: 10) {
                            ForEach(filteredSessions) { session in
                                NavigationLink(value: session) {
                                    SessionTile(session: session)
                                }
                                .buttonStyle(.plain)
                            }
                        }
                    }
                }
                .padding(.horizontal, 12)
                .padding(.bottom, 24)
            }
            .background(Color(uiColor: .systemBackground))
            .navigationTitle("C3 Remote")
            .navigationBarTitleDisplayMode(.large)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        Text(store.endpointLabel)
                        Button("Disconnect", systemImage: "rectangle.portrait.and.arrow.right", role: .destructive) {
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
            .refreshable { await store.refresh() }
            .task {
                await store.refresh()
                openDebugSessionIfNeeded()
                while !Task.isCancelled {
                    try? await Task.sleep(for: .seconds(3))
                    await store.refresh()
                }
            }
        }
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

    private func openDebugSessionIfNeeded() {
#if DEBUG
        guard navigationPath.isEmpty,
              let sessionID = ProcessInfo.processInfo.environment["C3_REMOTE_SESSION_ID"],
              let session = store.sessions.first(where: { $0.id == sessionID }) else { return }
        navigationPath.append(session)
#endif
    }
}

