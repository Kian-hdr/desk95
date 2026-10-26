// swift-tools-version: 6.0
import PackageDescription
let package = Package(name: "Desk95", platforms: [.macOS(.v14)], products: [.executable(name: "Desk95", targets: ["Desk95"])], targets: [.executableTarget(name: "Desk95"), .testTarget(name: "Desk95Tests", dependencies: ["Desk95"])], swiftLanguageModes: [.v5])
