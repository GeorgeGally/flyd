import Foundation
import ApplicationServices
import AppKit

struct EnvironmentState {
    let application: ApplicationInfo
    let surface: SurfaceInfo?
    let window: WindowInfo
    let focusedElement: FocusedElementInfo
    let semanticNeighbourhood: SemanticNeighbourhood?
    let selection: String
    let sufficiency: SufficiencyLevel
    let timestamp: Date

    struct ApplicationInfo: Codable {
        let bundleId: String
        let name: String
    }

    struct SurfaceInfo: Codable {
        let kind: String
        let host: String?
        let title: String?
    }

    struct WindowInfo: Codable {
        let title: String
        let ref: String
    }

    struct FocusedElementInfo: Codable {
        let ref: String
        let role: String
        let description: String
        let value: String
        let placeholder: String
        let selectedText: String
    }

    struct SemanticNeighbourhood: Codable {
        let parentType: String?
        let context: [String: String]
    }

    enum SufficiencyLevel: String, Codable {
        case semantic
        case partial
    }
}

struct InvocationFingerprint: Codable {
    let app: String
    let surface: String?
    let window: String
    let element: String
    let capturedAt: Date

    func matches(_ other: InvocationFingerprint) -> Bool {
        app == other.app &&
        surface == other.surface &&
        window == other.window &&
        element == other.element
    }

    func appAndWindowMatch(_ other: InvocationFingerprint) -> Bool {
        app == other.app && window == other.window
    }
}
