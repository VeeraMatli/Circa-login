import Observation
import SwiftUI

@MainActor @Observable final class ChatModel {
  var messages: [ChatMessage] = []
  var text = ""
  var error: String?
  var sending = false
  var connected = false
  var userID: String?
  private var clientID: String?
  private var pendingBody: String?
  private let cache = ConversationCache()
  func history(api: APIClient, conversation: String) async {
    do {
      userID = await api.currentUserID()
      var after = 0
      var all: [ChatMessage] = []
      while true {
        let result: Envelope<[ChatMessage]> = try await api.request(
          "/v1/conversations/\(conversation)/messages?limit=50&after=\(after)")
        all.append(contentsOf: result.data)
        guard let last = result.data.last, result.data.count == 50 else { break }
        after = last.sequence
      }
      messages = all
      try await cache.save(messages, conversation: conversation)
      error = nil
    } catch {
      let problem = error
      if let apiError = error as? APIProblem,
        ["CONVERSATION_NOT_FOUND", "SESSION_EXPIRED", "UNAUTHENTICATED"].contains(apiError.code)
      {
        messages = []
        do { try await cache.clear() } catch {
          self.error = "Your protected cache could not be cleared. Log out and retry."
        }
      } else if messages.isEmpty {
        do { messages = try await cache.load(conversation: conversation) } catch {
          self.error = "Offline history could not be read."
        }
      }
      self.error = problem.localizedDescription
    }
  }
  func send(api: APIClient, conversation: String) async {
    guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, !sending else { return }
    sending = true
    defer { sending = false }
    if pendingBody != text {
      clientID = UUID().uuidString
      pendingBody = text
    }
    let key = clientID ?? UUID().uuidString
    clientID = key
    do {
      let _: Envelope<ChatMessage> = try await api.request(
        "/v1/conversations/\(conversation)/messages", method: "POST",
        body: JSONEncoder().encode(["body": text, "client_id": key]))
      text = ""
      clientID = nil
      await history(api: api, conversation: conversation)
    } catch { self.error = error.localizedDescription }
  }
  func listen(api: APIClient, conversation: String) async {
    await history(api: api, conversation: conversation)
    var attempt = 0
    while !Task.isCancelled {
      guard let socket = await api.socket(conversationID: conversation) else {
        error = "Real-time connection could not be created."
        return
      }
      socket.resume()
      connected = true
      do {
        while !Task.isCancelled {
          _ = try await withTaskCancellationHandler {
            try await socket.receive()
          } onCancel: {
            socket.cancel(with: .goingAway, reason: nil)
          }
          attempt = 0
          await history(api: api, conversation: conversation)
        }
      } catch {
        connected = false
        if !Task.isCancelled {
          self.error = "Reconnecting. Your messages remain available through history."
        }
      }
      socket.cancel(with: .goingAway, reason: nil)
      if Task.isCancelled { return }
      attempt = min(attempt + 1, 5)
      do {
        try await Task.sleep(for: .seconds(pow(2, Double(attempt))))
        await history(api: api, conversation: conversation)
      } catch { return }
    }
  }
}
struct ChatView: View {
  let conversationID: String
  @Environment(AppState.self) private var app
  @State private var model = ChatModel()
  @State private var showSafety = false
  var body: some View {
    VStack(spacing: 0) {
      Text(
        model.connected
          ? "Connected · A thoughtful hello goes a long way"
          : "Connecting · History is available below"
      ).font(.caption2).foregroundStyle(.secondary).padding(10)
      ScrollViewReader { proxy in
        ScrollView {
          LazyVStack(alignment: .leading, spacing: 12) {
            if model.messages.isEmpty {
              VStack(alignment: .leading, spacing: 13) {
                Text("Conversation Spark ✧").font(.system(.title2, design: .serif))
                ForEach(
                  [
                    "What’s your ideal weekend?", "Coffee date or outdoor adventure?",
                    "Which hobby would you love to try?",
                  ], id: \.self
                ) { prompt in
                  Button(prompt) { model.text = prompt }.font(.subheadline).foregroundStyle(
                    Color.electricPurple)
                }
              }.padding(25)
            }
            ForEach(model.messages) { message in
              HStack {
                if message.senderId == model.userID { Spacer(minLength: 50) }
                VStack(alignment: .leading, spacing: 5) {
                  Text(message.body)
                  Text(Date(timeIntervalSince1970: Double(message.createdAt)), style: .time).font(
                    .caption2
                  ).foregroundStyle(.secondary)
                }.padding(14).background(
                  message.senderId == model.userID
                    ? Color.hotPink.opacity(0.18) : Color(.secondarySystemBackground),
                  in: RoundedRectangle(cornerRadius: 18))
                if message.senderId != model.userID { Spacer(minLength: 50) }
              }.id(message.id)
            }
          }.padding()
        }.onChange(of: model.messages.count) { _, _ in
          if let last = model.messages.last { proxy.scrollTo(last.id, anchor: .bottom) }
        }
      }
      if let error = model.error {
        ErrorNotice(message: error)
        Button("Refresh history") {
          Task { await model.history(api: app.api, conversation: conversationID) }
        }.font(.caption)
      }
      HStack {
        TextField("A thoughtful message…", text: $model.text, axis: .vertical).lineLimit(1...4)
          .accessibilityIdentifier("chat.composer")
        Button {
          Task { await model.send(api: app.api, conversation: conversationID) }
        } label: {
          Image(systemName: "arrow.up.circle.fill").font(.title).foregroundStyle(
            Color.electricPurple)
        }.disabled(model.sending || model.text.isEmpty).accessibilityLabel("Send message")
          .accessibilityIdentifier("chat.send")
      }.padding().background(.bar)
    }.navigationTitle("Your connection").navigationBarTitleDisplayMode(.inline).toolbar {
      Button {
        showSafety = true
      } label: {
        Image(systemName: "shield").accessibilityLabel("Conversation safety actions")
      }
    }.sheet(isPresented: $showSafety) { ConversationSafety(conversationID: conversationID) }.task {
      await model.listen(api: app.api, conversation: conversationID)
    }.accessibilityIdentifier("chat.screen")
  }
}
