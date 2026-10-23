import Observation
import StoreKit
import SwiftUI

@MainActor @Observable final class PurchaseModel {
  var products: [Product] = []
  var entitlement = "free"
  var error: String?
  var busy = false
  func load(api: APIClient) async {
    busy = true
    defer { busy = false }
    do {
      struct CatalogItem: Decodable, Sendable { let id: String }
      let catalog: Envelope<[CatalogItem]> = try await api.request("/v1/products")
      products = try await Product.products(for: catalog.data.map(\.id)).sorted {
        $0.price < $1.price
      }
      let result: Envelope<Entitlement> = try await api.request("/v1/entitlements")
      entitlement = result.data.tier
      error = nil
    } catch { self.error = error.localizedDescription }
  }
  func purchase(_ product: Product, api: APIClient) async {
    busy = true
    defer { busy = false }
    do {
      guard let userID = await api.currentUserID(), let uuid = UUID(uuidString: userID) else {
        throw APIProblem(code: "ACCOUNT", message: "Sign in before purchasing.")
      }
      switch try await product.purchase(options: [.appAccountToken(uuid)]) {
      case .success(let result): try await reconcile(result, api: api)
      case .pending: error = "Your purchase is pending approval. No entitlement has been granted."
      case .userCancelled: break
      @unknown default: error = "The purchase returned an unknown state. Please restore purchases."
      }
      await load(api: api)
    } catch { self.error = error.localizedDescription }
  }
  func reconcile(_ result: VerificationResult<StoreKit.Transaction>, api: APIClient) async throws {
    guard case .verified(let transaction) = result else {
      throw APIProblem(code: "PURCHASE", message: "Apple could not verify this transaction.")
    }
    let _: Envelope<Acknowledgement> = try await api.request(
      "/v1/purchases/sync", method: "POST",
      body: JSONEncoder().encode(["signed_transaction": result.jwsRepresentation]))
    await transaction.finish()
  }
  func restore(api: APIClient) async {
    do {
      try await AppStore.sync()
      for await result in StoreKit.Transaction.currentEntitlements {
        try await reconcile(result, api: api)
      }
      await load(api: api)
    } catch { self.error = error.localizedDescription }
  }
  func observe(api: APIClient) async {
    for await result in StoreKit.Transaction.updates {
      if Task.isCancelled { return }
      do { try await reconcile(result, api: api) } catch { self.error = error.localizedDescription }
    }
  }
}
struct PremiumView: View {
  @Environment(AppState.self) private var app
  @State private var model = PurchaseModel()
  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 24) {
        BrandHeader(
          title: "A little more possibility.",
          subtitle: "Your safety and matching consent are always included.")
        Text("Current plan: \(model.entitlement.capitalized)").font(.headline)
        if model.busy { ProgressView("Checking your membership…") }
        ForEach(model.products, id: \.id) { product in
          VStack(alignment: .leading, spacing: 13) {
            Text(product.displayName).font(.system(.title, design: .serif))
            Text(product.description).foregroundStyle(.secondary)
            Text(product.displayPrice).font(.title2.bold())
            if let period = product.subscription?.subscriptionPeriod {
              Text("Renews every \(period.value) \(String(describing: period.unit)).").font(
                .footnote)
            }
            Button("Continue with \(product.displayName)") {
              Task { await model.purchase(product, api: app.api) }
            }.buttonStyle(ZyraButtonStyle()).disabled(model.busy)
          }.padding(24).background(
            Color.hotPink.opacity(0.08), in: RoundedRectangle(cornerRadius: 22))
        }
        if model.products.isEmpty && !model.busy {
          Text(
            "Purchases are unavailable until the operator configures App Store products and independent server verification. Free discovery and conversations remain available."
          ).foregroundStyle(.secondary)
        }
        if let error = model.error { ErrorNotice(message: error) }
        Button("Restore purchases") { Task { await model.restore(api: app.api) } }
          .accessibilityIdentifier("premium.restore")
        if let subscriptionsURL = URL(string: "https://apps.apple.com/account/subscriptions") {
          Link("Manage or cancel subscriptions", destination: subscriptionsURL)
        }
        Text(
          "Payment is charged to your Apple Account. Subscriptions renew automatically unless canceled at least 24 hours before the current period ends. Manage subscriptions in your Apple Account settings. No purchase is required for essential safety controls."
        ).font(.footnote).foregroundStyle(.secondary)
      }.padding(25)
    }.task { await model.load(api: app.api) }.accessibilityIdentifier("premium.screen")
  }
}
