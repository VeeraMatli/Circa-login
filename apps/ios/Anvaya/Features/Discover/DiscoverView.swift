import Observation
import SwiftUI

@MainActor @Observable final class DiscoverModel {
  var people: [Person] = []
  var loading = false
  var error: String?
  var match: Match?
  var sending = false
  var cursor: String?
  var hasMore = true
  private var pendingKey: String?
  private var pendingAction: String?
  func load(api: APIClient, mode: String = "nearby", reset: Bool = false) async {
    guard !loading else { return }
    loading = true
    error = nil
    defer { loading = false }
    if reset {
      cursor = nil
      hasMore = true
      people = []
    }
    guard hasMore else { return }
    do {
      let result: Envelope<[Person]> = try await api.request(
        "/v1/discover?mode=\(mode)" + (cursor.map { "&cursor=\($0)" } ?? ""))
      people.append(contentsOf: result.data)
      cursor = result.nextCursor
      hasMore = cursor != nil
    } catch { self.error = error.localizedDescription }
  }
  func swipe(_ action: String, api: APIClient) async {
    guard let person = people.first, !sending else { return }
    sending = true
    error = nil
    defer { sending = false }
    if pendingAction != action {
      pendingKey = UUID().uuidString
      pendingAction = action
    }
    let key = pendingKey ?? UUID().uuidString
    pendingKey = key
    do {
      let result: Envelope<SwipeResult> = try await api.request(
        "/v1/swipes", method: "POST",
        body: JSONEncoder().encode(["target_id": person.id, "action": action]), idempotencyKey: key)
      people.removeFirst()
      pendingKey = nil
      pendingAction = nil
      match = result.data.match
      if people.count < 3 { await load(api: api) }
    } catch { self.error = error.localizedDescription }
  }
}
struct DiscoverView: View {
  @Environment(AppCoordinator.self) private var coordinator
  var mode = "nearby"
  @Environment(AppState.self) private var app
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @State private var model = DiscoverModel()
  @State private var drag = CGSize.zero
  @State private var expanded = false
  @State private var photoIndex = 0
  var body: some View {
    VStack(spacing: 15) {
      HStack {
        Text("anvaya ✧").font(.system(.title, design: .serif)).foregroundStyle(Color.roseMauve)
        Spacer()
        NavigationLink(value: AppCoordinator.Route.safety) {
          Image(systemName: "shield.lefthalf.filled").accessibilityLabel("Safe Dating Center")
        }
      }.padding(.horizontal)
      if let person = model.people.first {
        GeometryReader { geometry in
          ZStack(alignment: .bottomLeading) {
            PrivatePhoto(
              photoID: person.photos.isEmpty
                ? nil : person.photos[min(photoIndex, person.photos.count - 1)].id, api: app.api)
            LinearGradient(
              colors: [.clear, .black.opacity(0.9)], startPoint: .center, endPoint: .bottom)
            VStack(alignment: .leading, spacing: 11) {
              HStack {
                Text("\(person.displayName), \(person.age)").font(
                  .system(.largeTitle, design: .serif))
                Image(systemName: "checkmark.shield").accessibilityLabel(
                  "Adult eligibility checked")
              }
              Text(person.relationshipIntent.replacingOccurrences(of: "_", with: " ").capitalized)
                .font(.subheadline)
              Text(person.interests.prefix(3).joined(separator: "  ·  ")).font(.caption)
              if let highlight = person.compatibility?.highlights.first {
                Label(highlight, systemImage: "sparkles").font(.caption).padding(9).background(
                  .white.opacity(0.15), in: Capsule())
              }
              Button("Get to know \(person.displayName)") { expanded = true }.font(.callout.bold())
                .foregroundStyle(Color.champagneGold)
            }.padding(24).foregroundStyle(.white)
            VStack {
              HStack {
                Button {
                  photoIndex = max(0, photoIndex - 1)
                } label: {
                  Image(systemName: "chevron.left").padding()
                }.accessibilityLabel("Previous photo")
                Spacer()
                Button {
                  if photoIndex + 1 < person.photos.count { photoIndex += 1 }
                } label: {
                  Image(systemName: "chevron.right").padding()
                }.accessibilityLabel("Next photo")
              }.foregroundStyle(.white)
              Spacer()
            }
          }.frame(width: geometry.size.width, height: geometry.size.height).clipShape(
            RoundedRectangle(cornerRadius: 27)
          ).offset(drag).rotationEffect(.degrees(reduceMotion ? 0 : Double(drag.width / 24)))
            .gesture(
              DragGesture().onChanged { if !model.sending { drag = $0.translation } }.onEnded {
                value in
                let action: String? =
                  value.predictedEndTranslation.height < -180
                  ? "super_like"
                  : value.predictedEndTranslation.width > 130
                    ? "like" : value.predictedEndTranslation.width < -130 ? "pass" : nil
                withAnimation(reduceMotion ? nil : .spring()) { drag = .zero }
                if let action {
                  Task {
                    await model.swipe(action, api: app.api)
                    photoIndex = 0
                  }
                }
              }
            ).accessibilityIdentifier("discover.card")
        }.padding(.horizontal)
        HStack(spacing: 30) {
          actionButton("Pass", icon: "xmark", action: "pass", color: .primary)
          actionButton("Super Like", icon: "star.fill", action: "super_like", color: .deepOrchid)
          actionButton("Like", icon: "heart.fill", action: "like", color: .roseMauve)
        }.padding(.vertical, 7).disabled(model.sending)
      } else if model.loading {
        ProgressView("Finding common ground…").frame(maxHeight: .infinity)
      } else {
        ContentUnavailableView {
          Label("Good things take a little space.", systemImage: "sparkles")
        } description: {
          Text(
            "You’ve met everyone in your current preferences. Come back later or refresh your discovery."
          )
        } actions: {
          Button("Refresh") { Task { await model.load(api: app.api, mode: mode, reset: true) } }
        }.accessibilityIdentifier("discover.empty")
      }
      if let error = model.error { ErrorNotice(message: error) }
    }.task(id: mode) { await model.load(api: app.api, mode: mode, reset: true) }.sheet(
      isPresented: $expanded
    ) { if let person = model.people.first { PersonDetail(person: person, allowActions: false) } }
    .sheet(
      item: $model.match
    ) { match in
      VStack(spacing: 25) {
        Image(systemName: "heart.circle.fill").font(.system(size: 85)).foregroundStyle(
          Color.roseMauve)
        Text("A little spark. A new beginning.").font(.system(.largeTitle, design: .serif))
          .multilineTextAlignment(.center)
        Text("You both chose to connect.").foregroundStyle(.secondary)
        Button("Start a conversation") {
          model.match = nil
          coordinator.path.append(.conversation(match.id))
        }
        Button("Continue exploring") { model.match = nil }
      }.padding(35).presentationDetents([.medium])
    }
  }
  private func actionButton(_ name: String, icon: String, action: String, color: Color) -> some View
  {
    Button {
      Task {
        await model.swipe(action, api: app.api)
        photoIndex = 0
      }
    } label: {
      Image(systemName: icon).font(.title2).foregroundStyle(color).frame(width: 62, height: 62)
        .background(Color(.secondarySystemBackground), in: Circle())
    }.accessibilityLabel(name).accessibilityIdentifier("discover.\(action)")
  }
}
struct PersonDetail: View {
  let person: Person
  var allowActions = true
  @State private var actionNotice: String?
  @State private var actionError: String?
  @State private var acting = false
  @Environment(AppState.self) private var app
  var body: some View {
    NavigationStack {
      ScrollView {
        VStack(alignment: .leading, spacing: 20) {
          ForEach(person.photos) { photo in
            PrivatePhoto(photoID: photo.id, api: app.api).frame(height: 340).clipShape(
              RoundedRectangle(cornerRadius: 20))
          }
          BrandHeader(
            title: "\(person.displayName), \(person.age)",
            subtitle: person.relationshipIntent.capitalized)
          Text(person.bio)
          Text(person.interests.joined(separator: " · "))
          ForEach(person.compatibility?.highlights ?? [], id: \.self) {
            Label($0, systemImage: "sparkles")
          }
          Text(
            "Compatibility indicators describe shared preferences, not a prediction of romantic success."
          ).font(.footnote).foregroundStyle(.secondary)
          if allowActions {
            HStack {
              Button("Pass") { Task { await act("pass") } }
              Spacer()
              Button("Like") { Task { await act("like") } }
            }.disabled(acting).padding()
            if let actionNotice { Text(actionNotice).font(.footnote) }
            if let actionError { ErrorNotice(message: actionError) }
          }
          SafetyActions(targetID: person.id, conversationID: nil)
        }.padding()
      }.navigationTitle("A closer look").navigationBarTitleDisplayMode(.inline)
    }
  }
  private func act(_ action: String) async {
    acting = true
    defer { acting = false }
    do {
      let result: Envelope<SwipeResult> = try await app.api.request(
        "/v1/swipes", method: "POST",
        body: JSONEncoder().encode(["target_id": person.id, "action": action]),
        idempotencyKey: UUID().uuidString)
      actionNotice =
        result.data.match != nil
        ? "You both chose to connect. Open Matches to say hello."
        : action == "pass"
          ? "Profile passed." : "Like sent. A match happens only if you both choose to connect."
      actionError = nil
    } catch { actionError = error.localizedDescription }
  }

}
