import Foundation
import Testing

@testable import Anvaya

struct AnvayaTests {
  @Test func publicContractDoesNotNeedPrivateFields() throws {
    let json = Data(
      #"{"id":"a","display_name":"Morgan","age":30,"bio":"Reading & hiking","gender":"nonbinary","relationship_intent":"serious","interests":["Reading"],"languages":["English"],"photos":[]}"#
        .utf8)
    let profile = try JSONDecoder().decode(Person.self, from: json)
    #expect(profile.age == 30)
    #expect(profile.photos.isEmpty)
  }
  @Test @MainActor func deepLinksRejectInvalidConversationIDs() {
    let coordinator = AppCoordinator()
    guard let invalid = URL(string: "anvaya://conversation/not-a-uuid"),
      let valid = URL(string: "anvaya://conversation/00000000-0000-4000-8000-000000000001")
    else {
      Issue.record("Invalid test URLs")
      return
    }
    coordinator.handle(invalid)
    #expect(coordinator.path.isEmpty)
    coordinator.handle(valid)
    #expect(coordinator.path == [.conversation("00000000-0000-4000-8000-000000000001")])
  }
  @Test func tokensRoundTripForSecureStorage() throws {
    let tokens = SessionTokens(
      accessToken: "access", refreshToken: "refresh", expiresIn: 900, userId: "id")
    let restored = try JSONDecoder().decode(SessionTokens.self, from: JSONEncoder().encode(tokens))
    #expect(restored.refreshToken == tokens.refreshToken)
  }
  @Test func signupSurfacesProviderFailure() async throws {
    let client = APIClient(
      baseURL: URL(string: "https://example.invalid")!, transport: FailingSignupTransport())
    do {
      let _: Envelope<Challenge> = try await client.request(
        "/v1/auth/email/start", method: "POST", body: Data("{}".utf8))
      Issue.record("Expected the provider error to reach the signup screen")
    } catch let problem as APIProblem {
      #expect(problem.code == "PROVIDER_NOT_CONFIGURED")
      #expect(problem.localizedDescription == "Email is not configured.")
    }
  }
  @Test func signupSurfacesOfflineFailure() async throws {
    let client = APIClient(
      baseURL: URL(string: "https://example.invalid")!, transport: OfflineSignupTransport())
    do {
      let _: Envelope<Challenge> = try await client.request("/v1/auth/email/start", method: "POST")
      Issue.record("Expected the connection error to reach the signup screen")
    } catch let problem as APIProblem {
      #expect(problem.code == "OFFLINE")
      #expect(problem.localizedDescription.contains("Check your connection"))
    }
  }
}

private struct FailingSignupTransport: HTTPTransport {
  func response(for request: URLRequest) async throws -> (Data, URLResponse) {
    let response = HTTPURLResponse(
      url: request.url!, statusCode: 503, httpVersion: nil, headerFields: nil)!
    return (
      Data(
        #"{"error":{"code":"PROVIDER_NOT_CONFIGURED","message":"Email is not configured."}}"#.utf8),
      response
    )
  }
}

private struct OfflineSignupTransport: HTTPTransport {
  func response(for request: URLRequest) async throws -> (Data, URLResponse) {
    throw URLError(.notConnectedToInternet)
  }
}
