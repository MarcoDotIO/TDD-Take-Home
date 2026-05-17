// swift-tools-version: 5.10
import PackageDescription

let package = Package(
    name: "COLAReview",
    platforms: [.macOS(.v13)],
    products: [
        .executable(name: "COLAReview", targets: ["COLAReview"])
    ],
    targets: [
        .executableTarget(
            name: "COLAReview",
            path: "COLAReview"
        )
    ]
)
