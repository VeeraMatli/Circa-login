import Foundation

actor ConversationCache {
  private func file(_ conversation: String) throws -> URL {
    guard UUID(uuidString: conversation) != nil else {
      throw APIProblem(code: "CACHE", message: "Invalid conversation.")
    }
    let directory = try FileManager.default.url(
      for: .cachesDirectory, in: .userDomainMask, appropriateFor: nil, create: true
    ).appendingPathComponent("AnvayaMessages", isDirectory: true)
    try FileManager.default.createDirectory(
      at: directory, withIntermediateDirectories: true,
      attributes: [.protectionKey: FileProtectionType.complete])
    return directory.appendingPathComponent(conversation + ".json")
  }
  func save(_ messages: [ChatMessage], conversation: String) throws {
    try JSONEncoder().encode(messages).write(
      to: file(conversation), options: [.atomic, .completeFileProtection])
  }
  func load(conversation: String) throws -> [ChatMessage] {
    let url = try file(conversation)
    guard FileManager.default.fileExists(atPath: url.path) else { return [] }
    return try JSONDecoder().decode([ChatMessage].self, from: Data(contentsOf: url))
  }
  func clear() throws {
    let root = try FileManager.default.url(
      for: .cachesDirectory, in: .userDomainMask, appropriateFor: nil, create: false
    ).appendingPathComponent("AnvayaMessages")
    if FileManager.default.fileExists(atPath: root.path) {
      try FileManager.default.removeItem(at: root)
    }
  }
}
