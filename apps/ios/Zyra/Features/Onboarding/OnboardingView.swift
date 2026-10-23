import CoreLocation
import SwiftUI

struct OnboardingView: View {
  @Environment(AppState.self) private var app
  @State private var step = 0
  @State private var name = ""
  @State private var birthday =
    Calendar.current.date(byAdding: .year, value: -18, to: Date()) ?? Date()
  @State private var gender = "woman"
  @State private var interested = "all"
  @State private var intention = "serious"
  @State private var city = "New York"
  @State private var latitude = "40.71"
  @State private var longitude = "-74.01"
  @State private var interests: Set<String> = []
  @State private var bio = ""
  @State private var busy = false
  @State private var error: String?
  let titles = [
    "Your story starts here.", "What brings you here?", "A little common ground.",
    "Make it feel like you.",
  ]
  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 24) {
        BrandHeader(
          title: titles[step],
          subtitle: "\(step + 1) of 4 · Share what feels right. Optional details can wait.")
        ProgressView(value: Double(step + 1), total: 4).tint(.hotPink)
        if app.me?.localMock == true {
          Text(
            "LOCAL DEVELOPMENT · Adult assurance uses a mock adapter. This is not a live dating service."
          ).font(.caption).foregroundStyle(.secondary)
        }
        switch step {
        case 0:
          TextField("Display name", text: $name).textContentType(.givenName).textFieldStyle(
            .roundedBorder
          ).accessibilityIdentifier("onboarding.name")
          DatePicker(
            "Date of birth (private)", selection: $birthday, in: ...Date(),
            displayedComponents: .date
          ).accessibilityIdentifier("onboarding.birthday")
          Text("You must be at least 18. Your full date of birth is never shown on your profile.")
            .font(.footnote).foregroundStyle(.secondary)
          Picker("I identify as", selection: $gender) {
            Text("Woman").tag("woman")
            Text("Man").tag("man")
            Text("Nonbinary").tag("nonbinary")
            Text("Self-described").tag("self_described")
          }
        case 1:
          Picker("Interested in", selection: $interested) {
            Text("All genders").tag("all")
            Text("Women").tag("woman")
            Text("Men").tag("man")
            Text("Nonbinary people").tag("nonbinary")
          }
          Picker("Connection Compass", selection: $intention) {
            Text("A serious relationship").tag("serious")
            Text("Long-term love").tag("long_term")
            Text("Exploring compatibility").tag("exploring")
            Text("Casual dating").tag("casual")
            Text("Shared interests first").tag("shared_interests")
          }.pickerStyle(.inline)
        case 2:
          Text("Choose a few things you love.").font(.headline)
          ForEach(
            ["Hiking", "Coffee", "Live music", "Travel", "Reading", "Art", "Cooking", "Dogs"],
            id: \.self
          ) { interest in
            Button {
              if interests.contains(interest) {
                interests.remove(interest)
              } else {
                interests.insert(interest)
              }
            } label: {
              HStack {
                Text(interest)
                Spacer()
                Image(systemName: interests.contains(interest) ? "checkmark.circle.fill" : "circle")
              }
            }.padding(10).foregroundStyle(.primary).background(
              Color.hotPink.opacity(0.08), in: RoundedRectangle(cornerRadius: 10)
            ).accessibilityAddTraits(interests.contains(interest) ? .isSelected : [])
          }
        default:
          TextField("Your city", text: $city).textFieldStyle(.roundedBorder)
          HStack {
            TextField("Latitude", text: $latitude)
            TextField("Longitude", text: $longitude)
          }.keyboardType(.numbersAndPunctuation).textFieldStyle(.roundedBorder)
          Text(
            "Select a city center. Precise coordinates are private; distance display is off by default."
          ).font(.caption).foregroundStyle(.secondary)
          TextField("A little about you (optional)", text: $bio, axis: .vertical).lineLimit(3...6)
            .textFieldStyle(.roundedBorder)
          Text(
            "Photo uploads are available in Profile. Photos remain private until moderation completes."
          ).font(.footnote).foregroundStyle(.secondary)
          if app.me?.localMock == false {
            Text(
              "An independent adult eligibility attestation is required. Follow the provider flow configured by your operator before completing onboarding."
            ).foregroundStyle(.secondary)
          }
        }
        if let error { ErrorNotice(message: error) }
        Button(busy ? "Saving…" : step == 3 ? "Meet your community" : "Continue") {
          if step < 3 { step += 1 } else { Task { await complete() } }
        }.buttonStyle(ZyraButtonStyle()).disabled(
          busy || (step == 0 && name.trimmingCharacters(in: .whitespaces).isEmpty)
        ).accessibilityIdentifier("onboarding.continue")
        if step > 0 { Button("Back") { step -= 1 } }
      }.padding(25)
    }.onAppear {
      if let profile = app.me?.profile, !profile.displayName.isEmpty {
        name = profile.displayName
        gender = profile.gender
        bio = profile.bio
        intention = profile.relationshipIntent
        if let value = profile.dateOfBirth {
          let formatter = DateFormatter()
          formatter.dateFormat = "yyyy-MM-dd"
          formatter.locale = Locale(identifier: "en_US_POSIX")
          formatter.timeZone = .current
          if let date = formatter.date(from: value) { birthday = date }
        }
        if let data = profile.interests.data(using: .utf8),
          let values = try? JSONDecoder().decode([String].self, from: data)
        {
          interests = Set(values)
        }
      }
    }
  }
  private func complete() async {
    busy = true
    error = nil
    defer { busy = false }
    do {
      guard let lat = Double(latitude), let lon = Double(longitude) else {
        throw APIProblem(code: "LOCATION", message: "Enter valid city coordinates.")
      }
      let formatter = DateFormatter()
      formatter.dateFormat = "yyyy-MM-dd"
      formatter.locale = Locale(identifier: "en_US_POSIX")
      formatter.timeZone = .current
      let value: [String: Any] = [
        "display_name": name, "date_of_birth": formatter.string(from: birthday), "bio": bio,
        "gender": gender, "relationship_intent": intention, "interests": Array(interests).sorted(),
        "languages": ["English"], "location": ["latitude": lat, "longitude": lon, "city": city],
        "complete": true,
      ]
      let _: Envelope<Acknowledgement> = try await app.api.request(
        "/v1/me", method: "PATCH", body: JSONSerialization.data(withJSONObject: value))
      let preferences: [String: Any] = [
        "min_age": 18, "max_age": 99, "genders": interested == "all" ? [] : [interested],
        "radius_km": 50, "intentions": [],
      ]
      let _: Envelope<Acknowledgement> = try await app.api.request(
        "/v1/preferences", method: "PATCH",
        body: JSONSerialization.data(withJSONObject: preferences))
      try await app.refresh()
    } catch { self.error = error.localizedDescription }
  }
}
