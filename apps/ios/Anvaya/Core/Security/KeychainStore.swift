import Foundation
import Security

struct KeychainStore: Sendable {
  private let service = "com.anvaya.session"
  func load() throws -> SessionTokens? {
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service,
      kSecAttrAccount as String: "session", kSecReturnData as String: true,
      kSecMatchLimit as String: kSecMatchLimitOne,
    ]
    var result: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &result)
    if status == errSecItemNotFound { return nil }
    guard status == errSecSuccess, let data = result as? Data else {
      throw APIProblem(code: "KEYCHAIN", message: "Your secure session could not be read.")
    }
    return try JSONDecoder().decode(SessionTokens.self, from: data)
  }
  func save(_ tokens: SessionTokens) throws {
    let key: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service,
      kSecAttrAccount as String: "session",
    ]
    let attributes: [String: Any] = [
      kSecValueData as String: try JSONEncoder().encode(tokens),
      kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
    ]
    let update = SecItemUpdate(key as CFDictionary, attributes as CFDictionary)
    if update == errSecItemNotFound {
      let status = SecItemAdd(key.merging(attributes) { _, new in new } as CFDictionary, nil)
      guard status == errSecSuccess else {
        throw APIProblem(code: "KEYCHAIN", message: "Your session could not be stored securely.")
      }
    } else if update != errSecSuccess {
      throw APIProblem(code: "KEYCHAIN", message: "Your secure session could not be updated.")
    }
  }
  func clear() throws {
    let status = SecItemDelete(
      [
        kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service,
        kSecAttrAccount as String: "session",
      ] as CFDictionary)
    guard status == errSecSuccess || status == errSecItemNotFound else {
      throw APIProblem(code: "KEYCHAIN", message: "Your session could not be removed.")
    }
  }
}
