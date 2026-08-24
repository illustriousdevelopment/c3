import Foundation
import SwiftUI

enum RemoteSessionState: String, Codable, Hashable {
    case spawning
    case processing
    case awaitingInput = "awaiting_input"
    case awaitingPermission = "awaiting_permission"
    case complete
    case error

    var label: String {
        switch self {
        case .spawning: "STARTING"
        case .processing: "WORKING"
        case .awaitingInput: "NEEDS INPUT"
        case .awaitingPermission: "PERMISSION"
        case .complete: "IDLE"
        case .error: "ERROR"
        }
    }

    var tint: Color {
        switch self {
        case .spawning, .processing: .blue
        case .awaitingInput, .complete: .yellow
        case .awaitingPermission, .error: .red
        }
    }

    var priority: Int {
        switch self {
        case .awaitingPermission: 0
        case .awaitingInput: 1
        case .processing, .spawning: 2
        case .error: 3
        case .complete: 4
        }
    }
}

struct RemotePendingAction: Codable, Hashable {
    let type: String
    let description: String
    let tool: String?
    let command: String?
}

struct RemoteSession: Identifiable, Codable, Hashable {
    let id: String
    let projectName: String
    let projectPath: String?
    let agentKind: String?
    let state: RemoteSessionState
    let tmuxTarget: String?
    let terminalTty: String?
    let lastActivity: String
    let pendingAction: RemotePendingAction?

    var displayName: String {
        guard let first = projectName.unicodeScalars.first else { return projectName }
        let isBraille = (0x2800...0x28FF).contains(Int(first.value))
        if isBraille || first == ">" || first == "!" {
            return String(projectName.dropFirst()).trimmingCharacters(in: .whitespaces)
        }
        return projectName
    }

    var projectLeaf: String {
        guard let projectPath, !projectPath.isEmpty else {
            return "\(agentKind ?? "agent") session"
        }
        return URL(fileURLWithPath: projectPath).lastPathComponent
    }

    var attentionText: String {
        if let description = pendingAction?.description, !description.isEmpty {
            return description
        }
        return switch state {
        case .processing, .spawning: "Agent is working"
        default: "Review the latest pane output"
        }
    }

    var activityDate: Date {
        ISO8601DateFormatter().date(from: lastActivity) ?? .distantPast
    }
}

struct PaneCapture: Codable {
    let sessionId: String
    let projectName: String
    let output: String
    let capturedAt: String
}

struct RemoteHealth: Codable {
    let ok: Bool
    let name: String
    let version: String
}

struct RemoteErrorPayload: Codable {
    let error: String
}
