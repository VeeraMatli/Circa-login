import SwiftUI

struct SafetyCenter: View {
  var body: some View {
    List {
      Section {
        BrandHeader(
          title: "Your peace of mind matters.", subtitle: "Essential safety is always free.")
      }
      Section("Before you meet") {
        Label(
          "Take your time. You never owe someone a conversation or a date.", systemImage: "heart")
        Label("Choose a public place and arrange your own transport.", systemImage: "location")
        Label(
          "Tell someone you trust about your plans, only if you choose.", systemImage: "person.2")
        Label(
          "Never send money or share financial or identity documents.", systemImage: "lock.shield")
      }
      Section("If something feels wrong") {
        Text(
          "Use Report or Block from a profile or conversation. Reports create a case for human review. If there is immediate danger, contact your local emergency services."
        )
        Text(
          "HeartTrail does not offer end-to-end encrypted messaging. Access to reported evidence is restricted and audited."
        )
      }
      Section("Privacy") {
        Text(
          "Precise location, full birth dates, phone numbers and email addresses are private. Distance and read receipts are off by default. Account export and deletion are available in Profile."
        )
      }
    }.navigationTitle("Safe Dating Center").accessibilityIdentifier("safety.screen")
  }
}
struct SafetyActions: View {
  let targetID: String
  let conversationID: String?
  @Environment(AppState.self) private var app
  @State private var category = "harassment"
  @State private var details = ""
  @State private var message: String?
  @State private var error: String?
  @State private var confirmBlock = false
  var body: some View {
    VStack(alignment: .leading, spacing: 16) {
      Text("Safety & respect").font(.headline)
      Picker("Report reason", selection: $category) {
        ForEach(
          [
            "fake_profile", "spam", "scam", "harassment", "threats", "underage",
            "nonconsensual_imagery", "impersonation", "other",
          ], id: \.self
        ) { Text($0.replacingOccurrences(of: "_", with: " ").capitalized).tag($0) }
      }
      TextField("Tell our safety team what happened", text: $details, axis: .vertical)
        .textFieldStyle(.roundedBorder)
      Button("Submit report") { Task { await report() } }.disabled(
        details.trimmingCharacters(in: .whitespaces).isEmpty
      ).accessibilityIdentifier("safety.report")
      Button("Block this member", role: .destructive) { confirmBlock = true }
        .accessibilityIdentifier("safety.block")
      if let message { Text(message).font(.footnote).accessibilityAddTraits(.updatesFrequently) }
      if let error { ErrorNotice(message: error) }
    }.confirmationDialog(
      "Block this member? They will no longer be able to discover or message you.",
      isPresented: $confirmBlock
    ) {
      Button("Block", role: .destructive) {
        Task {
          do {
            let _: Envelope<Acknowledgement> = try await app.api.request(
              "/v1/users/\(targetID)/block", method: "POST", body: Data("{}".utf8))
            message = "Member blocked."
          } catch { self.error = error.localizedDescription }
        }
      }
    }
  }
  private func report() async {
    do {
      var value = ["target_id": targetID, "category": category, "details": details]
      if let conversationID { value["conversation_id"] = conversationID }
      let _: Envelope<Acknowledgement> = try await app.api.request(
        "/v1/reports", method: "POST", body: JSONEncoder().encode(value))
      message = "Report received. Our safety team can now review your concern."
      details = ""
    } catch { self.error = error.localizedDescription }
  }
}
struct ConversationSafety: View {
  let conversationID: String
  @Environment(AppState.self) private var app
  @Environment(\.dismiss) private var dismiss
  @State private var target: String?
  @State private var error: String?
  @State private var confirm = false
  var body: some View {
    NavigationStack {
      Form {
        if let target { SafetyActions(targetID: target, conversationID: conversationID) }
        NavigationLink("Safe Dating Center") { SafetyCenter() }
        Button("Unmatch", role: .destructive) { confirm = true }
        if let error { ErrorNotice(message: error) }
      }.navigationTitle("Conversation safety").toolbar { Button("Done") { dismiss() } }
    }.task {
      do {
        let result: Envelope<Match> = try await app.api.request("/v1/matches/\(conversationID)")
        let me = await app.api.currentUserID()
        target = result.data.userA == me ? result.data.userB : result.data.userA
      } catch { self.error = error.localizedDescription }
    }.confirmationDialog(
      "Unmatch? This closes the conversation for both people.", isPresented: $confirm
    ) {
      Button("Unmatch", role: .destructive) {
        Task {
          do {
            let _: Envelope<Acknowledgement> = try await app.api.request(
              "/v1/matches/\(conversationID)", method: "DELETE")
            dismiss()
          } catch { self.error = error.localizedDescription }
        }
      }
    }
  }
}
