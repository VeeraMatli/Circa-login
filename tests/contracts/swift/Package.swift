// swift-tools-version: 6.0
import PackageDescription

let package = Package(
  name: "HeartTrailContracts",
  products: [.library(name: "HeartTrailContracts", targets: ["HeartTrailContracts"])],
  targets: [
    .target(name: "HeartTrailContracts"),
    .testTarget(name: "HeartTrailContractsTests", dependencies: ["HeartTrailContracts"]),
  ])
