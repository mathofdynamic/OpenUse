// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "OpenUseMacController",
    platforms: [.macOS(.v13)],
    products: [
        .executable(name: "OpenUseMacController", targets: ["OpenUseMacController"]),
    ],
    targets: [
        .target(name: "OpenUseMacCore"),
        .executableTarget(name: "OpenUseMacController", dependencies: ["OpenUseMacCore"]),
        .executableTarget(name: "OpenUseMacProtocolTests", dependencies: ["OpenUseMacCore"]),
    ],
    swiftLanguageVersions: [.v5]
)
