import Foundation
import Testing

@testable import HeartTrailContracts

struct ContractsTests {
  @Test func decodesRealPublicProfileContract() throws {
    let data = Data(
      #"{"id":"a","display_name":"Morgan","age":30,"bio":"Reading","gender":"nonbinary","relationship_intent":"serious","interests":["Reading"],"languages":["English"],"photos":[]}"#
        .utf8)
    let value = try JSONDecoder().decode(Person.self, from: data)
    #expect(value.displayName == "Morgan")
    #expect(value.relationshipIntent == "serious")
    #expect(value.compatibility == nil)
  }
  @Test func decodesNumericMessageCursor() throws {
    let value = try JSONDecoder().decode(
      Envelope<[ChatMessage]>.self, from: Data(#"{"data":[],"next_cursor":42}"#.utf8))
    #expect(value.nextCursor == "42")
  }
  @Test func decodesOpaqueDiscoveryCursor() throws {
    let value = try JSONDecoder().decode(
      Envelope<[Person]>.self, from: Data(#"{"data":[],"next_cursor":"opaque"}"#.utf8))
    #expect(value.nextCursor == "opaque")
  }
  @Test func tokensKeepWireKeysWhenStored() throws {
    let tokens = SessionTokens(accessToken: "a", refreshToken: "r", expiresIn: 900, userId: "u")
    let encoded = try JSONEncoder().encode(tokens)
    let object = try #require(JSONSerialization.jsonObject(with: encoded) as? [String: Any])
    #expect(object["refresh_token"] as? String == "r")
    #expect(try JSONDecoder().decode(SessionTokens.self, from: encoded).userId == "u")
  }
  @Test func rejectsMissingIdentityInMessages() {
    #expect(throws: (any Error).self) {
      try JSONDecoder().decode(ChatMessage.self, from: Data(#"{"body":"hello","sequence":1}"#.utf8))
    }
  }
  @Test func emptyAcknowledgementAcceptsExtraResponseFields() throws {
    _ = try JSONDecoder().decode(
      Envelope<Acknowledgement>.self, from: Data(#"{"data":{"saved":true}}"#.utf8))
  }
  @Test func signupNormalizesEmailAndPhone() throws {
    #expect(
      try AuthenticationMethod.email.normalizedDestination("  Tester@Example.com\n")
        == "tester@example.com")
    #expect(
      try AuthenticationMethod.phone.normalizedDestination(" +1 (415) 555-2671 ") == "+14155552671")
  }
  @Test(arguments: ["", "   ", "missing-at", "a@@example.com", "a@example", "a b@example.com"])
  func signupRejectsInvalidEmails(input: String) {
    #expect(throws: APIProblem.self) { try AuthenticationMethod.email.normalizedDestination(input) }
  }
  @Test(arguments: [
    "", "tester@example.com", "4155552671", "+012345678", "+123", "+1234567890123456",
  ])
  func signupRejectsInvalidPhones(input: String) {
    #expect(throws: APIProblem.self) { try AuthenticationMethod.phone.normalizedDestination(input) }
  }
}
