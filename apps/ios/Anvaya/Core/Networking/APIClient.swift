import Foundation

protocol HTTPTransport: Sendable {
  func response(for request: URLRequest) async throws -> (Data, URLResponse)
}
extension URLSession: HTTPTransport {
  func response(for request: URLRequest) async throws -> (Data, URLResponse) {
    try await data(for: request)
  }
}
actor APIClient {
  let baseURL: URL
  private let transport: any HTTPTransport
  private let keychain: KeychainStore
  private var tokens: SessionTokens?
  private var refreshTask: Task<SessionTokens, Error>?
  init(
    baseURL: URL, transport: any HTTPTransport = URLSession.shared,
    keychain: KeychainStore = KeychainStore()
  ) {
    self.baseURL = baseURL
    self.transport = transport
    self.keychain = keychain
  }
  func restore() throws -> Bool {
    tokens = try keychain.load()
    return tokens != nil
  }
  func accept(_ value: SessionTokens) throws {
    try keychain.save(value)
    tokens = value
  }
  func clear() throws {
    try keychain.clear()
    tokens = nil
  }
  func currentUserID() -> String? { tokens?.userId }
  func request<T: Decodable & Sendable>(
    _ path: String, method: String = "GET", body: Data? = nil, idempotencyKey: String? = nil,
    retry: Bool = true
  ) async throws -> T {
    guard let url = URL(string: path, relativeTo: baseURL) else {
      throw APIProblem(code: "URL", message: "Invalid service URL.")
    }
    var request = URLRequest(url: url)
    request.httpMethod = method
    request.httpBody = body
    request.timeoutInterval = 15
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    if let token = tokens?.accessToken {
      request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
    }
    if let key = idempotencyKey { request.setValue(key, forHTTPHeaderField: "Idempotency-Key") }
    let data: Data
    let response: URLResponse
    do {
      (data, response) = try await transport.response(for: request)
    } catch let failure as URLError {
      switch failure.code {
      case .notConnectedToInternet:
        throw APIProblem(
          code: "OFFLINE", message: "You’re offline. Check your connection and try again.")
      case .timedOut:
        throw APIProblem(
          code: "TIMEOUT", message: "The service took too long to respond. Please try again.")
      default:
        #if DEBUG
          if ["127.0.0.1", "localhost", "::1"].contains(baseURL.host ?? "") {
            throw APIProblem(
              code: "LOCAL_SERVER",
              message:
                "Cannot reach the local test server. Start the API on the Mac running the simulator, then try again."
            )
          }
        #endif
        throw APIProblem(
          code: "CONNECTION", message: "We couldn’t reach the service. Please try again shortly.")
      }
    }
    guard let http = response as? HTTPURLResponse else {
      throw APIProblem(code: "RESPONSE", message: "The service returned an invalid response.")
    }
    if http.statusCode == 401 && retry && tokens != nil && !path.hasPrefix("/v1/auth/") {
      try await rotate()
      return try await self.request(
        path, method: method, body: body, idempotencyKey: idempotencyKey, retry: false)
    }
    guard (200...299).contains(http.statusCode) else {
      if let problem = try? JSONDecoder().decode(ProblemEnvelope.self, from: data) {
        throw APIProblem(code: problem.error.code, message: problem.error.message)
      }
      throw APIProblem(
        code: "HTTP_\(http.statusCode)",
        message: "The service couldn’t complete your request. Please try again shortly.")
    }
    do {
      return try JSONDecoder().decode(T.self, from: data)
    } catch {
      throw APIProblem(
        code: "RESPONSE", message: "The service returned an unexpected response. Please try again.")
    }
  }
  private func rotate() async throws {
    if let refreshTask {
      let value = try await refreshTask.value
      try accept(value)
      return
    }
    guard let current = tokens else { throw APIProblem(code: "SESSION", message: "Sign in again.") }
    let task = Task { () throws -> SessionTokens in
      let data = try JSONEncoder().encode(["refresh_token": current.refreshToken])
      let result: Envelope<SessionTokens> = try await request(
        "/v1/auth/refresh", method: "POST", body: data, retry: false)
      return result.data
    }
    refreshTask = task
    defer { refreshTask = nil }
    do { try accept(try await task.value) } catch {
      try clear()
      throw error
    }
  }
  func image(photoID: String) async throws -> Data {
    guard let url = URL(string: "/v1/photos/\(photoID)", relativeTo: baseURL) else {
      throw APIProblem(code: "URL", message: "Invalid photo URL.")
    }
    var request = URLRequest(url: url)
    request.timeoutInterval = 20
    if let token = tokens?.accessToken {
      request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
    }
    let (data, response) = try await transport.response(for: request)
    guard (response as? HTTPURLResponse)?.statusCode == 200 else {
      throw APIProblem(code: "PHOTO", message: "Photo is unavailable.")
    }
    return data
  }
  func upload(_ data: Data, intent: UploadIntent) async throws {
    guard let url = URL(string: intent.uploadPath, relativeTo: baseURL) else {
      throw APIProblem(code: "URL", message: "Invalid upload URL.")
    }
    var request = URLRequest(url: url)
    request.httpMethod = "PUT"
    request.httpBody = data
    request.timeoutInterval = 60
    request.setValue("image/jpeg", forHTTPHeaderField: "Content-Type")
    request.setValue(intent.uploadToken, forHTTPHeaderField: "X-Upload-Token")
    if let token = tokens?.accessToken {
      request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
    }
    let (_, response) = try await transport.response(for: request)
    guard let status = (response as? HTTPURLResponse)?.statusCode, (200...299).contains(status)
    else { throw APIProblem(code: "UPLOAD", message: "Upload failed. Please try again.") }
    let _: Envelope<Acknowledgement> = try await self.request(
      "/v1/me/photos/complete", method: "POST",
      body: JSONEncoder().encode(["photo_id": intent.photoId]))
  }
  func socket(conversationID: String) -> URLSessionWebSocketTask? {
    guard var components = URLComponents(url: baseURL, resolvingAgainstBaseURL: true) else {
      return nil
    }
    components.scheme = components.scheme == "https" ? "wss" : "ws"
    components.path = "/v1/realtime/connect"
    components.queryItems = [URLQueryItem(name: "conversation_id", value: conversationID)]
    guard let url = components.url else { return nil }
    var request = URLRequest(url: url)
    if let token = tokens?.accessToken {
      request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
    }
    return URLSession.shared.webSocketTask(with: request)
  }
}
