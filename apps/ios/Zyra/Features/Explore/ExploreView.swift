import SwiftUI

struct ExploreView: View {
  @Environment(AppState.self) private var app
  @Environment(AppCoordinator.self) private var coordinator
  @State private var modes: [ExploreMode] = []
  @State private var error: String?
  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 22) {
        BrandHeader(
          title: "Find your kind of connection.", subtitle: "Let your intentions lead the way.")
        ForEach(modes) { mode in
          Button {
            coordinator.discoveryMode = mode.id
            coordinator.selectedTab = .discover
          } label: {
            VStack(alignment: .leading, spacing: 13) {
              Image(
                systemName: mode.id == "nearby"
                  ? "location.circle" : mode.id == "serious" ? "heart.circle" : "sparkles"
              ).font(.title)
              Text(mode.title).font(.system(.title2, design: .serif))
              Text(mode.description).font(.footnote).opacity(0.8)
              Text("Open discovery →").font(.caption.bold())
            }.frame(maxWidth: .infinity, alignment: .leading).padding(25).foregroundStyle(.white)
              .background(
                LinearGradient(
                  colors: [.electricPurple, .midnightPlum], startPoint: .topLeading,
                  endPoint: .bottomTrailing), in: RoundedRectangle(cornerRadius: 22))
          }.accessibilityIdentifier("explore.\(mode.id)")
        }
        if let error {
          ErrorNotice(message: error)
          Button("Retry") { Task { await load() } }
        }
      }.padding(24)
    }.task { await load() }.accessibilityIdentifier("explore.screen")
  }
  private func load() async {
    do {
      let result: Envelope<[ExploreMode]> = try await app.api.request("/v1/explore")
      modes = result.data
      error = nil
    } catch { self.error = error.localizedDescription }
  }
}
