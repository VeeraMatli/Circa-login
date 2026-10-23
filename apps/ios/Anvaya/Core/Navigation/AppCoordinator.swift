import Observation
import SwiftUI

@MainActor @Observable final class AppCoordinator {
  enum Tab: String, CaseIterable { case discover, likes, explore, matches, profile }
  enum Route: Hashable {
    case conversation(String)
    case safety, premium
  }
  var selectedTab: Tab = .discover
  var discoveryMode = "nearby"
  var path: [Route] = []
  func handle(_ url: URL) {
    guard url.scheme == "anvaya" else { return }
    if url.host == "conversation", let id = url.pathComponents.last, UUID(uuidString: id) != nil {
      selectedTab = .matches
      path = [.conversation(id)]
    } else if url.host == "safety" {
      path = [.safety]
    }
  }
}
@MainActor @Observable final class AppState {
  let api: APIClient
  var signedIn = false
  var me: Me?
  var error: String?
  var loading = true
  init(api: APIClient) { self.api = api }
  func restore() async {
    defer { loading = false }
    do {
      if try await api.restore() {
        try await refresh()
        signedIn = true
      }
    } catch { self.error = error.localizedDescription }
  }
  func refresh() async throws {
    let result: Envelope<Me> = try await api.request("/v1/me")
    me = result.data
  }
  func authenticate(_ tokens: SessionTokens) async throws {
    try await api.accept(tokens)
    try await refresh()
    signedIn = true
  }
  func logout() async {
    do {
      let _: Envelope<Acknowledgement> = try await api.request(
        "/v1/auth/logout", method: "POST", body: Data("{}".utf8))
      try await api.clear()
      try await ConversationCache().clear()
      signedIn = false
      me = nil
    } catch { self.error = error.localizedDescription }
  }
}
