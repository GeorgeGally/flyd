import ApplicationServices
import Foundation

struct ObservedTarget {
    let observationId: String
    let revision: Int
    let element: AXUIElement
    let descriptor: TargetDescriptor
    let fingerprint: InvocationFingerprint

    func serialized(workSessionId: String? = nil, workSessionRevision: Int? = nil) -> ObservationPayload {
        return ObservationPayload(
            observation_id: observationId,
            revision: revision,
            work_session_id: workSessionId,
            work_session_revision: workSessionRevision,
            environment: EnvironmentPayload(
                bundleId: fingerprint.app,
                windowTitle: fingerprint.window,
                elementRef: fingerprint.element,
                elementRole: descriptor.role
            ),
            fingerprint: InvocationFingerprintPayload(
                app: fingerprint.app,
                window: fingerprint.window,
                element: fingerprint.element
            )
        )
    }

    struct ObservationPayload: Codable {
        let observation_id: String
        let revision: Int
        let work_session_id: String?
        let work_session_revision: Int?
        let environment: EnvironmentPayload
        let fingerprint: InvocationFingerprintPayload
    }

    struct EnvironmentPayload: Codable {
        let bundleId: String
        let windowTitle: String
        let elementRef: String
        let elementRole: String
    }

    struct InvocationFingerprintPayload: Codable {
        let app: String
        let window: String
        let element: String
    }
}
