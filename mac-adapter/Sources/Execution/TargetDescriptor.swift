import Foundation
import ApplicationServices
import CryptoKit

struct WindowIdentity: Equatable {
    let title: String
    let frame: CGRect?
    let isMain: Bool

    func matches(_ other: WindowIdentity) -> Bool {
        title == other.title && isMain == other.isMain
    }
}

struct TargetDescriptor: Equatable {
    let applicationId: String
    let processId: pid_t
    let windowIdentity: WindowIdentity
    let role: String
    let identifier: String?
    let description: String?
    let capturedAt: ContinuousClock.Instant
    var contentDigest: String? = nil
    var revision: Int = 0

    static func == (lhs: TargetDescriptor, rhs: TargetDescriptor) -> Bool {
        lhs.applicationId == rhs.applicationId &&
        lhs.windowIdentity == rhs.windowIdentity &&
        lhs.role == rhs.role &&
        lhs.identifier == rhs.identifier &&
        lhs.description == rhs.description
    }

    static func capture(from inspector: AccessibilityInspector, app: ApplicationMonitor?) -> TargetDescriptor? {
        guard let inspector = inspector as AccessibilityInspector? else { return nil }
        guard let element = inspector.capturedAXElement() else { return nil }
        guard let role = inspector.currentRole else { return nil }

        let appId = app?.foregroundApp?.bundleId ?? "unknown"
        let winTitle = app?.foregroundApp?.name ?? ""

        var contentDigest: String? = nil
        var valueRef: CFTypeRef?
        if AXUIElementCopyAttributeValue(element, kAXValueAttribute as CFString, &valueRef) == .success,
           let value = valueRef as? String {
            contentDigest = SHA256.hash(data: Data(value.utf8)).compactMap { String(format: "%02x", $0) }.joined()
        }

        return TargetDescriptor(
            applicationId: appId,
            processId: 0,
            windowIdentity: WindowIdentity(title: winTitle, frame: nil, isMain: true),
            role: role,
            identifier: inspector.currentIdentifier,
            description: inspector.currentDescription,
            capturedAt: .now,
            contentDigest: contentDigest,
            revision: 0
        )
    }

    func matchesElement(_ element: AXUIElement) -> Bool {
        var roleValue: CFTypeRef?
        guard AXUIElementCopyAttributeValue(element, kAXRoleAttribute as CFString, &roleValue) == .success,
              let currentRole = roleValue as? String,
              currentRole == role else { return false }

        if let id = identifier {
            var idValue: CFTypeRef?
            if AXUIElementCopyAttributeValue(element, kAXIdentifierAttribute as CFString, &idValue) == .success,
               let currentId = idValue as? String,
               currentId != id { return false }
        }

        if let desc = description {
            var descValue: CFTypeRef?
            if AXUIElementCopyAttributeValue(element, kAXDescriptionAttribute as CFString, &descValue) == .success,
               let currentDesc = descValue as? String,
               currentDesc != desc { return false }
        }

        return true
    }

    func matchesReality(currentApp: ApplicationMonitor) -> Bool {
        guard let app = currentApp.foregroundApp else { return false }
        return app.bundleId == applicationId
    }
}
