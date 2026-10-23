import SwiftUI
import UserNotifications

@main
struct ZyraApp: App {
  @UIApplicationDelegateAdaptor(AppDelegate.self) private var delegate
  @State private var app: AppState?
  @State private var coordinator = AppCoordinator()
  @State private var configurationError: String?
  var body: some Scene {
    WindowGroup {
      Group {
        if let app {
          RootView().environment(app).environment(coordinator).task {
            delegate.api = app.api
            await app.restore()
          }.onOpenURL { coordinator.handle($0) }
        } else if let configurationError {
          ContentUnavailableView(
            "Configuration required", systemImage: "gear.badge.exclamationmark",
            description: Text(configurationError))
        } else {
          ProgressView("Preparing Zyra…").task {
            guard let value = Bundle.main.object(forInfoDictionaryKey: "API_BASE_URL") as? String,
              let url = URL(string: value), ["https", "http"].contains(url.scheme ?? "")
            else {
              configurationError = "Set API_BASE_URL in the build configuration."
              return
            }
            #if !DEBUG
              guard url.scheme == "https" else {
                configurationError = "Production requires an HTTPS API."
                return
              }
            #endif
            app = AppState(api: APIClient(baseURL: url))
          }
        }
      }.tint(.hotPink).preferredColorScheme(.dark)
    }
  }
}
struct RootView: View {
  @Environment(AppState.self) private var app
  @Environment(AppCoordinator.self) private var coordinator
  var body: some View {
    @Bindable var navigation = coordinator
    NavigationStack(path: $navigation.path) {
      Group {
        if app.loading {
          ProgressView("Restoring your space…")
        } else if !app.signedIn {
          AuthenticationView()
        } else if app.me?.profile?.onboardingStatus != "complete" {
          OnboardingView()
        } else {
          TabView(selection: $navigation.selectedTab) {
            DiscoverView(mode: coordinator.discoveryMode).tabItem {
              Label("Discover", systemImage: "suit.heart")
            }.tag(AppCoordinator.Tab.discover)
            LikesView().tabItem { Label("Likes", systemImage: "heart.circle") }.tag(
              AppCoordinator.Tab.likes)
            ExploreView().tabItem { Label("Explore", systemImage: "sparkles") }.tag(
              AppCoordinator.Tab.explore)
            MatchesView().tabItem { Label("Matches", systemImage: "bubble.left.and.bubble.right") }
              .tag(AppCoordinator.Tab.matches)
            ProfileView().tabItem { Label("Profile", systemImage: "person.crop.circle") }.tag(
              AppCoordinator.Tab.profile)
          }
        }
      }.navigationDestination(for: AppCoordinator.Route.self) { route in
        switch route {
        case .conversation(let id): ChatView(conversationID: id)
        case .safety: SafetyCenter()
        case .premium: PremiumView()
        }
      }
    }
  }
}
@MainActor
final class AppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
  var api: APIClient?
  func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    UNUserNotificationCenter.current().delegate = self
    return true
  }
  func application(
    _ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data
  ) {
    guard let api else { return }
    let token = deviceToken.map { String(format: "%02x", $0) }.joined()
    #if DEBUG
      let environment = "sandbox"
    #else
      let environment = "production"
    #endif
    Task {
      do {
        let _: Envelope<Acknowledgement> = try await api.request(
          "/v1/devices", method: "POST",
          body: JSONEncoder().encode(["token": token, "environment": environment]))
      } catch { NSLog("APNs device registration failed; retry registration from Profile.") }
    }
  }
  nonisolated func userNotificationCenter(
    _ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse
  ) async {
    guard let value = response.notification.request.content.userInfo["conversation_id"] as? String,
      UUID(uuidString: value) != nil, let url = URL(string: "zyra://conversation/\(value)")
    else { return }
    await MainActor.run { UIApplication.shared.open(url) }
  }
}
