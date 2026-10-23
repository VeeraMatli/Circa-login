import PhotosUI
import SwiftUI
import UIKit
import UserNotifications

struct ProfileView: View {
  @Environment(AppState.self) private var app
  @State private var photos: [Photo] = []
  @State private var selected: PhotosPickerItem?
  @State private var uploading = false
  @State private var error: String?
  @State private var showEdit = false
  @State private var confirmDelete = false
  @State private var exportURL: URL?
  var body: some View {
    List {
      Section {
        BrandHeader(
          title: "A little more you.", subtitle: app.me?.profile?.displayName ?? "Your profile")
        Text(app.me?.profile?.bio ?? "")
        Button("Edit profile & preferences") { showEdit = true }
      }
      Section("Your photos · Up to 9") {
        ForEach(photos) { photo in
          HStack {
            PrivatePhoto(photoID: photo.id, api: app.api).frame(width: 60, height: 75).clipShape(
              RoundedRectangle(cornerRadius: 8))
            Text(photo.status?.capitalized ?? "Pending")
            Spacer()
            Button(role: .destructive) {
              Task { await delete(photo) }
            } label: {
              Image(systemName: "trash")
            }.accessibilityLabel("Delete photo")
          }
        }.onMove { source, destination in
          photos.move(fromOffsets: source, toOffset: destination)
          Task { await reorder() }
        }
        PhotosPicker(selection: $selected, matching: .images) {
          Label(
            uploading ? "Uploading & preparing moderation…" : "Add a photo",
            systemImage: "photo.badge.plus")
        }.disabled(uploading || photos.count >= 9).accessibilityIdentifier("profile.addPhoto")
        Text(
          "The first photo is primary. Use Edit to reorder. Images are re-encoded before upload; newly uploaded photos stay private during moderation."
        ).font(.caption).foregroundStyle(.secondary)
      }
      Section("Make it yours") {
        NavigationLink("Privacy & notifications") { PrivacySettings() }
        NavigationLink("HeartTrail membership", value: AppCoordinator.Route.premium)
        NavigationLink("Safe Dating Center", value: AppCoordinator.Route.safety)
        Button("Enable notifications") {
          Task {
            do {
              let allowed = try await UNUserNotificationCenter.current().requestAuthorization(
                options: [.alert, .badge, .sound])
              if allowed { UIApplication.shared.registerForRemoteNotifications() }
            } catch { self.error = error.localizedDescription }
          }
        }
      }
      Section("Your account") {
        Button("Export my data") { Task { await export() } }
        if let exportURL { ShareLink("Save your data export", item: exportURL) }
        Button("Log out") { Task { await app.logout() } }.accessibilityIdentifier("profile.logout")
        Button("Delete my account", role: .destructive) { confirmDelete = true }
          .accessibilityIdentifier("profile.delete")
      }
      if let error { Section { ErrorNotice(message: error) } }
      if let error = app.error { Section { ErrorNotice(message: error) } }
    }.toolbar { EditButton() }.task { await load() }.refreshable { await load() }.sheet(
      isPresented: $showEdit
    ) { NavigationStack { OnboardingView().toolbar { Button("Done") { showEdit = false } } } }
    .onChange(of: selected) { _, item in Task { await upload(item) } }.confirmationDialog(
      "Permanently delete your account? Your profile is removed immediately. Reported evidence and financial records follow the retention policy.",
      isPresented: $confirmDelete
    ) {
      Button("Delete account", role: .destructive) {
        Task {
          do {
            let _: Envelope<Acknowledgement> = try await app.api.request("/v1/me", method: "DELETE")
            try await app.api.clear()
            try await ConversationCache().clear()
            app.signedIn = false
            app.me = nil
          } catch { self.error = error.localizedDescription }
        }
      }
    }.accessibilityIdentifier("profile.screen")
  }
  private func load() async {
    do {
      try await app.refresh()
      let result: Envelope<[Photo]> = try await app.api.request("/v1/me/photos")
      photos = result.data
      error = nil
    } catch { self.error = error.localizedDescription }
  }
  private func upload(_ item: PhotosPickerItem?) async {
    guard let item else { return }
    uploading = true
    defer {
      uploading = false
      selected = nil
    }
    do {
      guard let data = try await item.loadTransferable(type: Data.self),
        let image = UIImage(data: data)
      else { throw APIProblem(code: "IMAGE", message: "This image could not be opened.") }
      let longest = max(image.size.width, image.size.height)
      let scale = min(1, 1600 / longest)
      let size = CGSize(width: image.size.width * scale, height: image.size.height * scale)
      let format = UIGraphicsImageRendererFormat()
      format.scale = 1
      format.opaque = true
      let normalized = UIGraphicsImageRenderer(size: size, format: format).image { context in
        UIColor.white.setFill()
        context.fill(CGRect(origin: .zero, size: size))
        image.draw(in: CGRect(origin: .zero, size: size))
      }
      guard let jpeg = normalized.jpegData(compressionQuality: 0.82) else {
        throw APIProblem(code: "IMAGE", message: "This image could not be encoded safely.")
      }
      let intent: Envelope<UploadIntent> = try await app.api.request(
        "/v1/me/photos/upload-intent", method: "POST", body: Data("{}".utf8))
      try await app.api.upload(jpeg, intent: intent.data)
      await load()
    } catch { self.error = error.localizedDescription }
  }
  private func delete(_ photo: Photo) async {
    do {
      let _: Envelope<Acknowledgement> = try await app.api.request(
        "/v1/me/photos/\(photo.id)", method: "DELETE")
      await load()
    } catch { self.error = error.localizedDescription }
  }
  private func reorder() async {
    do {
      let _: Envelope<Acknowledgement> = try await app.api.request(
        "/v1/me/photos/order", method: "PATCH",
        body: JSONEncoder().encode(["photo_ids": photos.map(\.id)]))
    } catch {
      self.error = error.localizedDescription
      await load()
    }
  }
  private func export() async {
    do {
      struct Export: Decodable, Sendable { let data: JSONValue }
      let result: Export = try await app.api.request(
        "/v1/me/data-export", method: "POST", body: Data("{}".utf8))
      let file = FileManager.default.temporaryDirectory.appendingPathComponent(
        "hearttrail-export.json")
      try JSONEncoder().encode(result.data).write(
        to: file, options: [.atomic, .completeFileProtection])
      exportURL = file
    } catch { self.error = error.localizedDescription }
  }
}
enum JSONValue: Codable, Sendable {
  case object([String: JSONValue])
  case array([JSONValue])
  case string(String)
  case number(Double)
  case bool(Bool)
  case null
  init(from decoder: Decoder) throws {
    let c = try decoder.singleValueContainer()
    if c.decodeNil() {
      self = .null
    } else if let v = try? c.decode(Bool.self) {
      self = .bool(v)
    } else if let v = try? c.decode(Double.self) {
      self = .number(v)
    } else if let v = try? c.decode(String.self) {
      self = .string(v)
    } else if let v = try? c.decode([JSONValue].self) {
      self = .array(v)
    } else {
      self = .object(try c.decode([String: JSONValue].self))
    }
  }
  func encode(to encoder: Encoder) throws {
    var c = encoder.singleValueContainer()
    switch self {
    case .object(let v): try c.encode(v)
    case .array(let v): try c.encode(v)
    case .string(let v): try c.encode(v)
    case .number(let v): try c.encode(v)
    case .bool(let v): try c.encode(v)
    case .null: try c.encodeNil()
    }
  }
}
