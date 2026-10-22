import Foundation

struct Envelope<T: Decodable & Sendable>: Decodable, Sendable {
  let data: T
  let nextCursor: String?
  enum CodingKeys: String, CodingKey {
    case data
    case nextCursor = "next_cursor"
  }
  init(from decoder: Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    data = try container.decode(T.self, forKey: .data)
    if let value = try? container.decode(String.self, forKey: .nextCursor) {
      nextCursor = value
    } else if let value = try? container.decode(Int.self, forKey: .nextCursor) {
      nextCursor = String(value)
    } else {
      nextCursor = nil
    }
  }
}
struct SessionTokens: Codable, Sendable {
  let accessToken: String
  let refreshToken: String
  let expiresIn: Int
  let userId: String

  enum CodingKeys: String, CodingKey {
    case accessToken = "access_token"
    case refreshToken = "refresh_token"
    case expiresIn = "expires_in"
    case userId = "user_id"
  }
}
struct Challenge: Decodable, Sendable {
  let challengeId: String
  let localCode: String?
  let expiresIn: Int

  enum CodingKeys: String, CodingKey {
    case challengeId = "challenge_id"
    case localCode = "local_code"
    case expiresIn = "expires_in"
  }
}
struct APIProblem: Error, LocalizedError, Sendable {
  let code: String
  let message: String
  var errorDescription: String? { message }
}
struct ProblemEnvelope: Decodable {
  struct Detail: Decodable {
    let code: String
    let message: String
  }
  let error: Detail
}
struct Acknowledgement: Decodable, Sendable {}
struct Photo: Decodable, Identifiable, Sendable {
  let id: String
  let position: Int?
  let status: String?
}
struct Compatibility: Decodable, Sendable {
  let score: Int
  let highlights: [String]
  let version: String
}
struct Person: Decodable, Identifiable, Sendable {
  let id: String
  let displayName: String
  let age: Int
  let bio: String
  let gender: String
  let relationshipIntent: String
  let interests: [String]
  let languages: [String]
  let photos: [Photo]
  let compatibility: Compatibility?

  enum CodingKeys: String, CodingKey {
    case id
    case displayName = "display_name"
    case age
    case bio
    case gender
    case relationshipIntent = "relationship_intent"
    case interests
    case languages
    case photos
    case compatibility
  }
}
struct Match: Decodable, Identifiable, Sendable {
  let id: String
  let userA: String
  let userB: String
  let displayName: String?

  enum CodingKeys: String, CodingKey {
    case id
    case userA = "user_a"
    case userB = "user_b"
    case displayName = "display_name"
  }
}
struct SwipeResult: Decodable, Sendable {
  let recorded: Bool
  let match: Match?
}
struct ChatMessage: Codable, Identifiable, Sendable {
  let id: String
  let senderId: String
  let body: String
  let createdAt: Int
  let sequence: Int
  let replyTo: String?

  enum CodingKeys: String, CodingKey {
    case id
    case senderId = "sender_id"
    case body
    case createdAt = "created_at"
    case sequence
    case replyTo = "reply_to"
  }
}
struct Conversation: Decodable, Identifiable, Sendable {
  let id: String
  let matchId: String
  let displayName: String
  let lastMessage: String?
  let unreadCount: Int

  enum CodingKeys: String, CodingKey {
    case id
    case matchId = "match_id"
    case displayName = "display_name"
    case lastMessage = "last_message"
    case unreadCount = "unread_count"
  }
}
struct EditableProfile: Decodable, Sendable {
  let userId: String
  let displayName: String
  let dateOfBirth: String?
  let bio: String
  let gender: String
  let relationshipIntent: String
  let interests: String
  let languages: String
  let onboardingStatus: String

  enum CodingKeys: String, CodingKey {
    case userId = "user_id"
    case displayName = "display_name"
    case dateOfBirth = "date_of_birth"
    case bio
    case gender
    case relationshipIntent = "relationship_intent"
    case interests
    case languages
    case onboardingStatus = "onboarding_status"
  }
}
struct Me: Decodable, Sendable {
  struct User: Decodable, Sendable {
    let status: String
    let ageAssuredAt: Int?

    enum CodingKeys: String, CodingKey {
      case status
      case ageAssuredAt = "age_assured_at"
    }
  }
  let profile: EditableProfile?
  let user: User
  let localMock: Bool

  enum CodingKeys: String, CodingKey {
    case profile
    case user
    case localMock = "local_mock"
  }
}
struct LikeEnvelope: Decodable, Sendable {
  let data: [Person]
  let count: Int
  let requiresUpgrade: Bool

  enum CodingKeys: String, CodingKey {
    case data
    case count
    case requiresUpgrade = "requires_upgrade"
  }
}
struct ExploreMode: Decodable, Identifiable, Sendable {
  let id: String
  let title: String
  let description: String
}
struct Entitlement: Decodable, Sendable {
  let tier: String
  let expiresAt: Int?

  enum CodingKeys: String, CodingKey {
    case tier
    case expiresAt = "expires_at"
  }
}
struct UploadIntent: Decodable, Sendable {
  let photoId: String
  let uploadPath: String
  let uploadToken: String
  let expiresIn: Int
  let maxBytes: Int

  enum CodingKeys: String, CodingKey {
    case photoId = "photo_id"
    case uploadPath = "upload_path"
    case uploadToken = "upload_token"
    case expiresIn = "expires_in"
    case maxBytes = "max_bytes"
  }
}
