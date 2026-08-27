import SwiftUI

private enum LaunchAgentKind: String, CaseIterable, Identifiable {
    case omp
    case claude
    case codex

    var id: String { rawValue }
    var label: String { rawValue.uppercased() }
}

struct NewAgentView: View {
    @EnvironmentObject private var store: RemoteStore
    @Environment(\.dismiss) private var dismiss

    @State private var agentKind: LaunchAgentKind = .omp
    @State private var projects: [RemoteProject] = []
    @State private var selectedProjectPath = ""
    @State private var projectSearch = ""
    @State private var prompt = ""
    @State private var isLoadingProjects = true
    @State private var isLaunching = false
    @State private var projectLoadError: String?
    @State private var launchError: String?

    private var filteredProjects: [RemoteProject] {
        let query = projectSearch.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !query.isEmpty else { return projects }
        return projects.filter {
            $0.name.localizedCaseInsensitiveContains(query)
                || $0.path.localizedCaseInsensitiveContains(query)
        }
    }

    private var canLaunch: Bool {
        !isLaunching && filteredProjects.contains { $0.path == selectedProjectPath }
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Agent") {
                    Picker("Agent", selection: $agentKind) {
                        ForEach(LaunchAgentKind.allCases) { agent in
                            Text(agent.label).tag(agent)
                        }
                    }
                    .pickerStyle(.segmented)
                }

                Section {
                    TextField("Search configured projects", text: $projectSearch)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()

                    if isLoadingProjects {
                        HStack {
                            Spacer()
                            ProgressView("Loading projects…")
                            Spacer()
                        }
                    } else if let projectLoadError {
                        ContentUnavailableView {
                            Label("Could not load projects", systemImage: "wifi.exclamationmark")
                        } description: {
                            Text(projectLoadError)
                        } actions: {
                            Button("Try Again") {
                                Task { await loadProjects() }
                            }
                        }
                    } else if projects.isEmpty {
                        ContentUnavailableView(
                            "No configured projects",
                            systemImage: "folder.badge.questionmark",
                            description: Text("Add project folders in C3 Remote Access settings on your Mac.")
                        )
                    } else if filteredProjects.isEmpty {
                        ContentUnavailableView(
                            "No matching projects",
                            systemImage: "magnifyingglass",
                            description: Text("Try another project name or path.")
                        )
                    } else {
                        ForEach(filteredProjects) { project in
                            Button {
                                selectedProjectPath = project.path
                            } label: {
                                HStack(spacing: 12) {
                                    VStack(alignment: .leading, spacing: 3) {
                                        HStack(spacing: 6) {
                                            Text(project.name)
                                                .font(.body.weight(.medium))
                                                .foregroundStyle(.primary)
                                            if project.active {
                                                Text("ACTIVE")
                                                    .font(.caption2.weight(.semibold))
                                                    .foregroundStyle(.secondary)
                                            }
                                        }
                                        Text(project.path)
                                            .font(.caption.monospaced())
                                            .foregroundStyle(.secondary)
                                            .lineLimit(2)
                                    }
                                    Spacer(minLength: 8)
                                    if selectedProjectPath == project.path {
                                        Image(systemName: "checkmark.circle.fill")
                                            .foregroundStyle(.tint)
                                    }
                                }
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel("\(project.name), \(project.path)")
                            .accessibilityValue(selectedProjectPath == project.path ? "Selected" : "")
                        }
                    }
                } header: {
                    Text("Project")
                } footer: {
                    Text("Only folders allowed by your Mac's C3 settings appear here.")
                }

                Section("Initial prompt (optional)") {
                    TextEditor(text: $prompt)
                        .frame(minHeight: 100)
                        .accessibilityLabel("Initial prompt")
                }

            }
            .navigationTitle("New Agent")
            .navigationBarTitleDisplayMode(.inline)
            .interactiveDismissDisabled(isLaunching)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                        .disabled(isLaunching)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(isLaunching ? "Starting…" : "Start") {
                        Task { await launch() }
                    }
                    .disabled(!canLaunch)
                    .fontWeight(.semibold)
                }
            }
            .task { await loadProjects() }
            .onChange(of: projectSearch) {
                if !filteredProjects.contains(where: { $0.path == selectedProjectPath }) {
                    selectedProjectPath = ""
                }
            }
            .alert(
                "Could not start agent",
                isPresented: Binding(
                    get: { launchError != nil },
                    set: { if !$0 { launchError = nil } }
                )
            ) {
                Button("OK", role: .cancel) { launchError = nil }
            } message: {
                Text(launchError ?? "Unknown launch error.")
            }
        }
    }

    private func loadProjects() async {
        isLoadingProjects = true
        projectLoadError = nil
        do {
            projects = try await store.projects()
            selectedProjectPath = projects.first(where: \.active)?.path
                ?? projects.first?.path
                ?? ""
        } catch {
            projects = []
            selectedProjectPath = ""
            projectLoadError = error.localizedDescription
        }
        isLoadingProjects = false
#if DEBUG
        await runDebugLaunchIfRequested()
#endif
    }

#if DEBUG
    private func runDebugLaunchIfRequested() async {
        let environment = ProcessInfo.processInfo.environment
        guard environment["C3_REMOTE_AUTO_LAUNCH"] == "1",
              let projectPath = environment["C3_REMOTE_LAUNCH_PROJECT"],
              projects.contains(where: { $0.path == projectPath }) else { return }
        selectedProjectPath = projectPath
        if let requestedAgent = environment["C3_REMOTE_LAUNCH_AGENT"],
           let requestedKind = LaunchAgentKind(rawValue: requestedAgent) {
            agentKind = requestedKind
        }
        prompt = environment["C3_REMOTE_LAUNCH_PROMPT"] ?? ""
        await launch()
    }
#endif

    private func launch() async {
        guard canLaunch else { return }
        isLaunching = true
        launchError = nil
        do {
            let trimmedPrompt = prompt.trimmingCharacters(in: .whitespacesAndNewlines)
            _ = try await store.launch(
                agentKind: agentKind.rawValue,
                projectPath: selectedProjectPath,
                prompt: trimmedPrompt.isEmpty ? nil : trimmedPrompt
            )
            await store.refresh()
            dismiss()
        } catch {
            launchError = error.localizedDescription
            isLaunching = false
        }
    }
}
