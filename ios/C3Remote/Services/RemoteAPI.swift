import Foundation

struct PairingConfiguration: Codable, Equatable {
    let endpoint: URL
    let token: String

    static func parse(_ value: String) throws -> PairingConfiguration {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard var components = URLComponents(string: trimmed),
              let scheme = components.scheme?.lowercased(),
              ["http", "https"].contains(scheme),
              components.host != nil else {
            throw RemoteAPIError.message("Paste the full pairing link from C3 Settings.")
        }
        let fragment = components.fragment ?? ""
        let fragmentItems = URLComponents(string: "?\(fragment)")?.queryItems ?? []
        guard let token = fragmentItems.first(where: { $0.name == "token" })?.value,
              token.count >= 32 else {
            throw RemoteAPIError.message("That link does not contain a valid C3 access token.")
        }
        components.fragment = nil
        components.query = nil
        components.path = ""
        guard let endpoint = components.url else {
            throw RemoteAPIError.message("The C3 server address is invalid.")
        }
        return PairingConfiguration(endpoint: endpoint, token: token)
    }
}

enum RemoteAPIError: LocalizedError {
    case invalidResponse
    case message(String)

    var errorDescription: String? {
        switch self {
        case .invalidResponse: "C3 returned an invalid response."
        case .message(let message): message
        }
    }
}

struct RemoteAPI {
    let configuration: PairingConfiguration

    private var decoder: JSONDecoder { JSONDecoder() }

    func health() async throws -> RemoteHealth {
        try await request(path: "/api/health")
    }

    func sessions() async throws -> [RemoteSession] {
        try await request(path: "/api/sessions")
    }

    func capture(sessionID: String) async throws -> PaneCapture {
        var components = URLComponents()
        components.path = "/api/capture"
        components.queryItems = [URLQueryItem(name: "sessionId", value: sessionID)]
        guard let path = components.string else { throw RemoteAPIError.invalidResponse }
        return try await request(path: path)
    }

    func send(sessionID: String, text: String) async throws {
        struct Payload: Encodable {
            let sessionId: String
            let text: String
            let submit: Bool
        }
        let body = try JSONEncoder().encode(Payload(sessionId: sessionID, text: text, submit: true))
        let _: SuccessResponse = try await request(path: "/api/input", method: "POST", body: body)
    }

    private func request<Response: Decodable>(
        path: String,
        method: String = "GET",
        body: Data? = nil
    ) async throws -> Response {
        guard let url = URL(string: path, relativeTo: configuration.endpoint) else {
            throw RemoteAPIError.invalidResponse
        }
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 12)
        request.httpMethod = method
        request.setValue("Bearer \(configuration.token)", forHTTPHeaderField: "Authorization")
        if let body {
            request.httpBody = body
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw RemoteAPIError.invalidResponse
        }
        guard (200..<300).contains(http.statusCode) else {
            if let payload = try? decoder.decode(RemoteErrorPayload.self, from: data) {
                throw RemoteAPIError.message(payload.error)
            }
            throw RemoteAPIError.message("C3 returned HTTP \(http.statusCode).")
        }
        return try decoder.decode(Response.self, from: data)
    }
}

private struct SuccessResponse: Codable {
    let ok: Bool
}
