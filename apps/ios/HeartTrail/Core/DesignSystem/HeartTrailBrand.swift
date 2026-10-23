import SwiftUI

struct HeartTrailWordmark: View {
  var body: some View {
    HStack(spacing: 5) {
      Text("HeartTrail").font(.system(.title, design: .rounded).weight(.bold))
      Image(systemName: "heart").font(.title3).foregroundStyle(Color.hotPink)
    }.accessibilityElement(children: .ignore).accessibilityLabel("HeartTrail")
  }
}

struct HeartTrailMark: View {
  var body: some View {
    HStack(spacing: 10) {
      Text("H").font(.system(size: 78, weight: .medium, design: .rounded))
      Image(systemName: "heart").font(.system(size: 62, weight: .light))
    }.foregroundStyle(.white).padding(35)
      .background {
        Circle().fill(
          RadialGradient(
            colors: [.hotPink.opacity(0.18), .electricPurple.opacity(0.1), .clear],
            center: .center, startRadius: 10, endRadius: 125))
      }
  }
}

struct HeartTrailMatchCelebration: View {
  var onConversation: () -> Void
  var onContinue: () -> Void
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @State private var revealed = false
  var body: some View {
    VStack(spacing: 25) {
      Spacer()
      ZStack {
        Circle().stroke(Color.champagneGold.opacity(0.25), lineWidth: 1)
          .frame(width: 215, height: 215).scaleEffect(revealed ? 1.12 : 0.8)
        Circle().fill(
          RadialGradient(
            colors: [.hotPink.opacity(0.28), .electricPurple.opacity(0.12), .clear],
            center: .center, startRadius: 15, endRadius: 140)
        ).frame(width: 280, height: 280)
        HStack(spacing: -22) {
          Image(systemName: "heart.fill").foregroundStyle(Color.electricPurple)
            .rotationEffect(.degrees(reduceMotion ? 0 : -15))
          Image(systemName: "heart.fill").foregroundStyle(Color.hotPink)
            .rotationEffect(.degrees(reduceMotion ? 0 : 15))
        }.font(.system(size: 90)).scaleEffect(reduceMotion || revealed ? 1 : 0.65)
        Image(systemName: "sparkles").font(.title).foregroundStyle(Color.champagneGold)
          .offset(x: 92, y: -78).opacity(revealed ? 1 : 0)
      }.accessibilityHidden(true)
      Text("It’s a spark.").font(.system(.largeTitle, design: .rounded).weight(.bold))
      Text("You both chose to connect.\nLet your story begin.")
        .multilineTextAlignment(.center).foregroundStyle(.secondary)
      Spacer()
      Button("Start a conversation", action: onConversation).buttonStyle(HeartTrailButtonStyle())
      Button("Continue exploring", action: onContinue).foregroundStyle(Color.champagneGold)
    }.padding(35).frame(maxWidth: .infinity)
      .background(Color.midnightPlum)
      .onAppear {
        withAnimation(reduceMotion ? nil : .spring(response: 0.7, dampingFraction: 0.7)) {
          revealed = true
        }
      }
  }
}
