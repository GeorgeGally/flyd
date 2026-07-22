// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "FlydMacAdapter",
    platforms: [.macOS(.v14)],
    targets: [
        .executableTarget(
            name: "FlydMacAdapter",
            path: "Sources"
        )
    ]
)
