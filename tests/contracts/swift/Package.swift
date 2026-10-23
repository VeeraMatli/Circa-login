// swift-tools-version: 6.0
import PackageDescription

let package = Package(
  name: "ZyraContracts",
  products: [.library(name: "ZyraContracts", targets: ["ZyraContracts"])],
  targets: [
    .target(name: "ZyraContracts"),
    .testTarget(name: "ZyraContractsTests", dependencies: ["ZyraContracts"]),
  ])
