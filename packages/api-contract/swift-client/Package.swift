// swift-tools-version: 6.0
import PackageDescription

let package = Package(
  name: "ZyraGenerated", platforms: [.iOS(.v17), .macOS(.v14)],
  products: [.library(name: "ZyraGenerated", targets: ["ZyraGenerated"])],
  dependencies: [
    .package(url: "https://github.com/apple/swift-openapi-generator", from: "1.10.0"),
    .package(url: "https://github.com/apple/swift-openapi-runtime", from: "1.8.0"),
    .package(url: "https://github.com/apple/swift-openapi-urlsession", from: "1.0.0"),
  ],
  targets: [
    .target(
      name: "ZyraGenerated",
      dependencies: [
        .product(name: "OpenAPIRuntime", package: "swift-openapi-runtime"),
        .product(name: "OpenAPIURLSession", package: "swift-openapi-urlsession"),
      ], plugins: [.plugin(name: "OpenAPIGenerator", package: "swift-openapi-generator")])
  ])
