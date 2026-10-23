import Foundation

enum AuthenticationMethod: String, Sendable {
  case email, phone

  func normalizedDestination(_ input: String) throws -> String {
    let trimmed = input.trimmingCharacters(in: .whitespacesAndNewlines)
    switch self {
    case .email:
      guard trimmed.count <= 254,
        trimmed.range(of: #"^[^\s@]+@[^\s@]+\.[^\s@]+$"#, options: .regularExpression) != nil
      else {
        throw APIProblem(code: "EMAIL", message: "Enter a valid email address to continue.")
      }
      return trimmed.lowercased()
    case .phone:
      let number = trimmed.filter { !" ()-".contains($0) }
      guard number.range(of: #"^\+[1-9][0-9]{7,14}$"#, options: .regularExpression) != nil else {
        throw APIProblem(
          code: "PHONE",
          message: "Enter a valid phone number with its country code, such as +14155552671.")
      }
      return number
    }
  }
}
