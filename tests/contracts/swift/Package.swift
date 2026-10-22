// swift-tools-version: 6.0
import PackageDescription

let package = Package(
  name: "AnvayaContracts",
  products: [.library(name: "AnvayaContracts", targets: ["AnvayaContracts"])],
  targets: [
    .target(name: "AnvayaContracts"),
    .testTarget(name: "AnvayaContractsTests", dependencies: ["AnvayaContracts"]),
  ])
