import SwiftUI

struct MatchesView: View {
  @Environment(AppState.self) private var app
  @State private var conversations: [Conversation] = []
  @State private var loading = true
  @State private var error: String?
  var body: some View {
    List {
      Section {
        BrandHeader(title: "The start of something.", subtitle: "A hello can go a long way.")
          .listRowBackground(Color.clear)
      }
      if loading { ProgressView("Loading connections…") }
      if let error {
        ErrorNotice(message: error)
        Button("Retry") { Task { await load() } }
      }
      if conversations.isEmpty && !loading {
        ContentUnavailableView(
          "Room for a new hello.", systemImage: "bubble.left.and.bubble.right",
          description: Text("When you both choose to connect, your conversation begins here."))
      }
      ForEach(conversations) { conversation in
        NavigationLink(value: AppCoordinator.Route.conversation(conversation.id)) {
          HStack(spacing: 15) {
            Image(systemName: "person.crop.circle.fill").font(.largeTitle).foregroundStyle(
              Color.hotPink)
            VStack(alignment: .leading, spacing: 7) {
              Text(conversation.displayName).font(.headline)
              Text(conversation.lastMessage ?? "Start with a thoughtful hello.").font(.subheadline)
                .foregroundStyle(.secondary).lineLimit(1)
            }
            Spacer()
            if conversation.unreadCount > 0 {
              Text("\(conversation.unreadCount)").font(.caption).padding(7).background(
                Color.softPink, in: Circle()
              ).foregroundStyle(Color.midnightPlum)
            }
          }
        }
      }
    }.listStyle(.plain).task { await load() }.refreshable { await load() }.accessibilityIdentifier(
      "matches.screen")
  }
  private func load() async {
    loading = true
    defer { loading = false }
    do {
      let result: Envelope<[Conversation]> = try await app.api.request("/v1/conversations")
      conversations = result.data
      error = nil
    } catch { self.error = error.localizedDescription }
  }
}
