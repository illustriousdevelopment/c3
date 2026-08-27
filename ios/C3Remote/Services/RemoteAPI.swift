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
    case unauthorized
    case message(String)

    var errorDescription: String? {
        switch self {
        case .invalidResponse: "C3 returned an invalid response."
        case .unauthorized: "Pairing expired. Paste a fresh C3 pairing link."
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

    func dashboard() async throws -> RemoteDashboard {
        try await request(path: "/api/dashboard")
    }

    func projects() async throws -> [RemoteProject] {
        try await request(path: "/api/projects")
    }

    func launch(
        agentKind: String,
        projectPath: String,
        prompt: String?
    ) async throws -> RemoteLaunchResult {
        struct Payload: Encodable {
            let agentKind: String
            let projectPath: String
            let prompt: String?
        }
        let body = try JSONEncoder().encode(
            Payload(agentKind: agentKind, projectPath: projectPath, prompt: prompt)
        )
        return try await request(path: "/api/launch", method: "POST", body: body)
    }

    func capture(sessionID: String) async throws -> PaneCapture {
        var components = URLComponents()
        components.path = "/api/capture"
        components.queryItems = [URLQueryItem(name: "sessionId", value: sessionID)]
        guard let path = components.string else { throw RemoteAPIError.invalidResponse }
        return try await request(path: path)
    }

    func captureStream(sessionID: String) -> AsyncThrowingStream<PaneCapture, Error> {
        AsyncThrowingStream(bufferingPolicy: .bufferingNewest(1)) { continuation in
            do {
                var components = URLComponents()
                components.path = "/api/stream"
                components.queryItems = [URLQueryItem(name: "sessionId", value: sessionID)]
                guard let path = components.string else { throw RemoteAPIError.invalidResponse }
                let request = try makeRequest(path: path, timeout: 20)
                let delegate = PaneStreamDelegate(continuation: continuation)
                let session = URLSession(
                    configuration: .ephemeral,
                    delegate: delegate,
                    delegateQueue: nil
                )
                let task = session.dataTask(with: request)
                continuation.onTermination = { _ in
                    task.cancel()
                    session.invalidateAndCancel()
                }
                task.resume()
            } catch {
                continuation.finish(throwing: error)
            }
        }
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
        let request = try makeRequest(path: path, method: method, body: body)
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw RemoteAPIError.invalidResponse
        }
        if http.statusCode == 401 {
            throw RemoteAPIError.unauthorized
        }
        guard (200..<300).contains(http.statusCode) else {
            if let payload = try? decoder.decode(RemoteErrorPayload.self, from: data) {
                throw RemoteAPIError.message(payload.error)
            }
            throw RemoteAPIError.message("C3 returned HTTP \(http.statusCode).")
        }
        return try decoder.decode(Response.self, from: data)
    }

    private func makeRequest(
        path: String,
        method: String = "GET",
        body: Data? = nil,
        timeout: TimeInterval = 12
    ) throws -> URLRequest {
        guard let url = URL(string: path, relativeTo: configuration.endpoint) else {
            throw RemoteAPIError.invalidResponse
        }
        var request = URLRequest(
            url: url,
            cachePolicy: .reloadIgnoringLocalCacheData,
            timeoutInterval: timeout
        )
        request.httpMethod = method
        request.setValue("Bearer \(configuration.token)", forHTTPHeaderField: "Authorization")
        if let body {
            request.httpBody = body
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        return request
    }
}

private final class PaneStreamDelegate: NSObject, URLSessionDataDelegate, @unchecked Sendable {
    private let continuation: AsyncThrowingStream<PaneCapture, Error>.Continuation
    private static let maximumFrameBytes = 8 * 1024 * 1024
    private var buffer = Data()
    private var rejectedError: Error?
    private var finished = false

    init(continuation: AsyncThrowingStream<PaneCapture, Error>.Continuation) {
        self.continuation = continuation
    }

    func urlSession(
        _ session: URLSession,
        dataTask: URLSessionDataTask,
        didReceive response: URLResponse,
        completionHandler: @escaping (URLSession.ResponseDisposition) -> Void
    ) {
        guard let http = response as? HTTPURLResponse else {
            rejectedError = RemoteAPIError.invalidResponse
            completionHandler(.cancel)
            return
        }
        guard (200..<300).contains(http.statusCode) else {
            rejectedError = http.statusCode == 401
                ? RemoteAPIError.unauthorized
                : RemoteAPIError.message("C3 stream returned HTTP \(http.statusCode).")
            completionHandler(.cancel)
            return
        }
        completionHandler(.allow)
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        guard !finished else { return }
        buffer.append(data)
        let boundary = Data([0x0a, 0x0a])
        while let range = buffer.range(of: boundary) {
            guard range.lowerBound <= Self.maximumFrameBytes else {
                fail(RemoteAPIError.message("C3 live frame exceeded 8 MiB."))
                dataTask.cancel()
                return
            }
            let block = buffer.subdata(in: buffer.startIndex..<range.lowerBound)
            buffer.removeSubrange(buffer.startIndex..<range.upperBound)
            guard process(block) else {
                dataTask.cancel()
                return
            }
        }
        if buffer.count > Self.maximumFrameBytes {
            fail(RemoteAPIError.message("C3 live frame exceeded 8 MiB."))
            dataTask.cancel()
        }
    }

    func urlSession(
        _ session: URLSession,
        task: URLSessionTask,
        didCompleteWithError error: Error?
    ) {
        guard !finished else { return }
        finished = true
        if let rejectedError {
            continuation.finish(throwing: rejectedError)
        } else if let urlError = error as? URLError, urlError.code == .cancelled {
            continuation.finish()
        } else if let error {
            continuation.finish(throwing: error)
        } else {
            continuation.finish(throwing: RemoteAPIError.message("C3 live stream closed."))
        }
    }

    private func process(_ block: Data) -> Bool {
        guard let text = String(data: block, encoding: .utf8),
              !text.isEmpty,
              !text.hasPrefix(":") else { return true }
        var eventName = "message"
        var payload = ""
        for line in text.split(separator: "\n", omittingEmptySubsequences: false) {
            if line.hasPrefix("event:") {
                eventName = line.dropFirst(6).trimmingCharacters(in: .whitespaces)
            } else if line.hasPrefix("data:") {
                payload += line.dropFirst(5).trimmingCharacters(in: .whitespaces)
            }
        }
        do {
            guard let data = payload.data(using: .utf8) else {
                throw RemoteAPIError.invalidResponse
            }
            if eventName == "pane" {
                let capture = try JSONDecoder().decode(PaneCapture.self, from: data)
                switch continuation.yield(capture) {
                case .terminated:
                    finished = true
                    return false
                case .dropped(_), .enqueued(_):
                    return true
                @unknown default:
                    return true
                }
            } else if eventName == "error" {
                let message = try? JSONDecoder().decode(RemoteErrorPayload.self, from: data)
                throw RemoteAPIError.message(message?.error ?? "C3 live stream failed.")
            }
            return true
        } catch {
            fail(error)
            return false
        }
    }

    private func fail(_ error: Error) {
        guard !finished else { return }
        finished = true
        continuation.finish(throwing: error)
    }
}

private struct SuccessResponse: Codable {
    let ok: Bool
}
