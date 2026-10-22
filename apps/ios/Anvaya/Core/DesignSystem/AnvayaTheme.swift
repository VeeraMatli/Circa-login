import SwiftUI

extension Color {
  static let midnightPlum = Color(red: 28 / 255, green: 16 / 255, blue: 42 / 255)
  static let roseMauve = Color(red: 192 / 255, green: 122 / 255, blue: 157 / 255)
  static let champagneGold = Color(red: 229 / 255, green: 185 / 255, blue: 136 / 255)
  static let warmBlush = Color(red: 251 / 255, green: 239 / 255, blue: 237 / 255)
  static let deepOrchid = Color(red: 112 / 255, green: 75 / 255, blue: 134 / 255)
}
struct AnvayaButtonStyle: ButtonStyle {
  func makeBody(configuration: Configuration) -> some View {
    configuration.label.font(.headline).foregroundStyle(Color.midnightPlum).frame(
      maxWidth: .infinity
    ).padding(16).background(Color.champagneGold, in: RoundedRectangle(cornerRadius: 18)).opacity(
      configuration.isPressed ? 0.8 : 1)
  }
}
struct BrandHeader: View {
  var title: String
  var subtitle: String
  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      Text("anvaya ✧").font(.system(.title, design: .serif)).foregroundStyle(Color.roseMauve)
      Text(title).font(.system(.largeTitle, design: .serif))
      Text(subtitle).font(.subheadline).foregroundStyle(.secondary)
    }.frame(maxWidth: .infinity, alignment: .leading).padding(.vertical)
  }
}
struct ErrorNotice: View {
  let message: String
  var body: some View {
    Label(message, systemImage: "exclamationmark.circle").font(.callout).foregroundStyle(.red)
      .padding().accessibilityIdentifier("error.notice")
  }
}
struct PrivatePhoto: View {
  let photoID: String?
  let api: APIClient
  @State private var image: UIImage?
  @State private var failed = false
  var body: some View {
    ZStack {
      LinearGradient(
        colors: [.deepOrchid, .midnightPlum], startPoint: .topLeading, endPoint: .bottomTrailing)
      if let image {
        Image(uiImage: image).resizable().scaledToFill()
      } else {
        VStack(spacing: 10) {
          Image(systemName: "person.crop.rectangle").font(.largeTitle)
          Text(
            failed ? "Photo unavailable" : photoID == nil ? "No approved photo" : "Loading photo…"
          ).font(.caption)
        }.foregroundStyle(.white.opacity(0.8))
      }
    }.clipped().task(id: photoID) {
      image = nil
      failed = false
      guard let photoID else { return }
      do {
        image = UIImage(data: try await api.image(photoID: photoID))
        failed = image == nil
      } catch { failed = true }
    }
  }
}
