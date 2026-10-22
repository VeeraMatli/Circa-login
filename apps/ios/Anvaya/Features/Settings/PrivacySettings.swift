import SwiftUI

struct PrivacySettings: View {
  struct Privacy: Decodable, Sendable {
    let showDistance: Int
    let showActivity: Int
    let readReceipts: Int
    let incognito: Int

    enum CodingKeys: String, CodingKey {
      case showDistance = "show_distance"
      case showActivity = "show_activity"
      case readReceipts = "read_receipts"
      case incognito
    }
  }
  @Environment(AppState.self) private var app
  @State private var distance = false
  @State private var activity = false
  @State private var receipts = false
  @State private var incognito = false
  @State private var paused = false
  @State private var error: String?
  @State private var notice: String?
  var body: some View {
    Form {
      Section("Your visibility") {
        Toggle("Allow approximate distance", isOn: $distance)
        Toggle("Allow recent activity visibility", isOn: $activity)
        Toggle("Read receipts", isOn: $receipts)
        Toggle("Incognito (Plus)", isOn: $incognito)
        Toggle("Pause discovery", isOn: $paused)
      }
      Section {
        Text(
          "Exact location and last-active timestamps are never public. Essential privacy and safety controls do not require a subscription."
        ).font(.footnote).foregroundStyle(.secondary)
        Button("Save preferences") { Task { await save() } }
      }
      if let error { ErrorNotice(message: error) }
      if let notice { Text(notice) }
    }.navigationTitle("Privacy").task {
      do {
        let result: Envelope<Privacy> = try await app.api.request("/v1/privacy")
        distance = result.data.showDistance == 1
        activity = result.data.showActivity == 1
        receipts = result.data.readReceipts == 1
        incognito = result.data.incognito == 1
        paused = app.me?.user.status == "paused"
      } catch { self.error = error.localizedDescription }
    }.accessibilityIdentifier("settings.privacy")
  }
  private func save() async {
    do {
      let _: Envelope<Acknowledgement> = try await app.api.request(
        "/v1/privacy", method: "PATCH",
        body: JSONEncoder().encode([
          "show_distance": distance, "show_activity": activity, "read_receipts": receipts,
          "incognito": incognito, "paused": paused,
        ]))
      try await app.refresh()
      notice = "Your privacy preferences have been saved."
      error = nil
    } catch { self.error = error.localizedDescription }
  }
}
