import AuthenticationServices
import CryptoKit
import SwiftUI

struct AuthenticationView: View {
  @Environment(AppState.self) private var app
  @State private var method = AuthenticationMethod.email
  @State private var destination = ""
  @State private var code = ""
  @State private var challenge: Challenge?
  @State private var busy = false
  @State private var error: String?
  @State private var nonce = ""
  @State private var showingError = false
  @FocusState private var inputFocused: Bool
  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 24) {
        BrandHeader(
          title: "A connection worth finding.",
          subtitle: "Where meaningful connections begin. An intentional space for adults 18+.")
        Image(systemName: "heart.circle").font(.system(size: 96, weight: .ultraLight))
          .foregroundStyle(Color.roseMauve).frame(maxWidth: .infinity).padding(.vertical, 25)
          .accessibilityHidden(true)
        if let challenge {
          Text("A small step toward something meaningful.").font(.title2).fontDesign(.serif)
          Text("Enter the verification code sent to \(destination).").foregroundStyle(.secondary)
          TextField("6-digit code", text: $code).keyboardType(.numberPad).textContentType(
            .oneTimeCode
          ).textFieldStyle(.roundedBorder).focused($inputFocused).accessibilityIdentifier(
            "auth.code")
          if let local = challenge.localCode {
            Text("LOCAL DEVELOPMENT · Mock code: \(local)").font(.caption).foregroundStyle(
              .secondary
            ).accessibilityIdentifier("auth.localCode")
          }
          Button(busy ? "Verifying…" : "Verify & continue") { Task { await verify(challenge) } }
            .buttonStyle(AnvayaButtonStyle()).disabled(busy || code.count != 6)
            .accessibilityIdentifier("auth.verify")
          Button("Use another address or resend") {
            self.challenge = nil
            code = ""
            error = nil
          }.font(.footnote).disabled(busy)
        } else {
          Picker("Sign-up method", selection: $method) {
            Text("Email").tag(AuthenticationMethod.email)
            Text("Phone").tag(AuthenticationMethod.phone)
          }.pickerStyle(.segmented).disabled(busy).onChange(of: method) {
            destination = ""
            code = ""
            challenge = nil
            error = nil
            showingError = false
            inputFocused = false
          }
          TextField(
            method == .email ? "Your email address" : "+1 555 123 4567", text: $destination
          ).keyboardType(method == .email ? .emailAddress : .phonePad).textContentType(
            method == .email ? .emailAddress : .telephoneNumber
          ).textInputAutocapitalization(.never).autocorrectionDisabled().textFieldStyle(
            .roundedBorder
          ).focused($inputFocused).disabled(busy).accessibilityIdentifier("auth.destination")
          if let error { ErrorNotice(message: error) }
          Button(busy ? "Sending…" : "Begin your story") { Task { await start() } }.buttonStyle(
            AnvayaButtonStyle()
          ).disabled(busy || destination.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            .accessibilityIdentifier("auth.start")
          SignInWithAppleButton(.continue) { request in
            nonce = UUID().uuidString + UUID().uuidString
            request.requestedScopes = []
            request.nonce = SHA256.hash(data: Data(nonce.utf8)).map { String(format: "%02x", $0) }
              .joined()
            inputFocused = false
            busy = true
            error = nil
          } onCompletion: { result in
            Task { await apple(result) }
          }.frame(height: 50).clipShape(RoundedRectangle(cornerRadius: 12)).accessibilityIdentifier(
            "auth.apple"
          ).disabled(busy)
        }
        if challenge != nil, let error { ErrorNotice(message: error) }
        Text(
          "By continuing, you agree to our Terms, Privacy Policy and Community Guidelines. Independent adult eligibility checks are required before using the live service."
        ).font(.footnote).foregroundStyle(.secondary)
        NavigationLink("Read our community & safety commitments") { SafetyCenter() }.font(.footnote)
      }.padding(26)
    }.background(Color(.systemBackground)).tint(.deepOrchid)
      .alert("Unable to continue", isPresented: $showingError) {
        Button("OK", role: .cancel) {}
      } message: {
        Text(error ?? "Please try again.")
      }
  }
  private func start() async {
    guard !busy else { return }
    inputFocused = false
    busy = true
    error = nil
    defer { busy = false }
    do {
      let normalized = try method.normalizedDestination(destination)
      let result: Envelope<Challenge> = try await app.api.request(
        "/v1/auth/\(method.rawValue)/start", method: "POST",
        body: JSONEncoder().encode(["destination": normalized]))
      destination = normalized
      challenge = result.data
    } catch { show(error) }
  }
  private func verify(_ challenge: Challenge) async {
    guard !busy else { return }
    inputFocused = false
    busy = true
    error = nil
    defer { busy = false }
    do {
      let result: Envelope<SessionTokens> = try await app.api.request(
        "/v1/auth/\(method.rawValue)/verify", method: "POST",
        body: JSONEncoder().encode(["challenge_id": challenge.challengeId, "code": code]))
      try await app.authenticate(result.data)
    } catch { show(error) }
  }
  private func apple(_ result: Result<ASAuthorization, Error>) async {
    defer { busy = false }
    do {
      let auth = try result.get()
      guard let credential = auth.credential as? ASAuthorizationAppleIDCredential,
        let data = credential.identityToken, let token = String(data: data, encoding: .utf8)
      else {
        throw APIProblem(code: "APPLE", message: "Apple did not return a verifiable identity.")
      }
      let response: Envelope<SessionTokens> = try await app.api.request(
        "/v1/auth/apple", method: "POST",
        body: JSONEncoder().encode(["identity_token": token, "nonce": nonce]))
      try await app.authenticate(response.data)
    } catch { show(error) }
  }
  private func show(_ failure: Error) {
    error = failure.localizedDescription
    showingError = true
  }
}
