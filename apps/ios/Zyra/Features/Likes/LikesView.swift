import SwiftUI

struct LikesView: View {
  @Environment(AppState.self) private var app
  @State private var result: LikeEnvelope?
  @State private var error: String?
  @State private var loading = false
  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 22) {
        BrandHeader(
          title: "A little interest. A possibility.",
          subtitle: "People who chose to learn more about you.")
        if loading { ProgressView("Loading your likes…") }
        if let error {
          ErrorNotice(message: error)
          Button("Retry") { Task { await load() } }
        }
        if let result {
          if result.count == 0 {
            ContentUnavailableView(
              "Your story is still unfolding.", systemImage: "heart",
              description: Text(
                "Real interest will appear here. In the meantime, explore your community."))
          } else if result.requiresUpgrade {
            Text("\(result.count) eligible people liked you").font(.title2).fontDesign(.serif)
            Text(
              "Gold lets you see who’s interested. You can also discover and match with people for free."
            ).foregroundStyle(.secondary)
            NavigationLink("Explore Zyra Gold", value: AppCoordinator.Route.premium).buttonStyle(
              ZyraButtonStyle())
          } else {
            ForEach(result.data) { person in
              NavigationLink {
                PersonDetail(person: person)
              } label: {
                HStack {
                  PrivatePhoto(photoID: person.photos.first?.id, api: app.api).frame(
                    width: 72, height: 88
                  ).clipShape(RoundedRectangle(cornerRadius: 12))
                  VStack(alignment: .leading) {
                    Text("\(person.displayName), \(person.age)").font(.headline)
                    Text(person.relationshipIntent.capitalized).font(.caption)
                  }
                  Spacer()
                  Image(systemName: "chevron.right")
                }
              }.foregroundStyle(.primary)
            }
          }
        }
      }.padding(24)
    }.task { await load() }.refreshable { await load() }.accessibilityIdentifier("likes.screen")
  }
  private func load() async {
    loading = true
    error = nil
    defer { loading = false }
    do { result = try await app.api.request("/v1/likes/received") } catch {
      self.error = error.localizedDescription
    }
  }
}
