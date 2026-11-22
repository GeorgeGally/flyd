import Foundation

/// Safe diagnostic from the authenticated loopback Core, not from a shell
/// spawned by the Mac adapter. No credentials, receipts or personal data.
struct NodeRuntimeDiagnostic: Codable, Equatable {
    let mode: String
    let enabled: Bool
    let reason: String
    let nodeVersion: String
    let minimumNodeVersion: String
    let nodeUpgradeRequired: Bool
}

enum NodeRuntimeUpdatePolicy {
    static let dismissalKey = "FlydAgentRunNodeUpdateLastNotice"
    static let downloadURL = URL(string: "https://nodejs.org/en/download")!

    /// Each incompatible installed version can be acknowledged once, even
    /// across app restarts. Success clears the dismissal so later regressions
    /// are visible again. No alert for an explicitly disabled feature.
    static func noticeID(for diagnostic: NodeRuntimeDiagnostic) -> String? {
        guard diagnostic.nodeUpgradeRequired else { return nil }
        return "agentrun-node:\(diagnostic.minimumNodeVersion):\(diagnostic.nodeVersion)"
    }

    static func shouldPresent(
        _ diagnostic: NodeRuntimeDiagnostic,
        lastNoticeID: String?
    ) -> Bool {
        guard let id = noticeID(for: diagnostic) else { return false }
        return id != lastNoticeID
    }

    static func message(for diagnostic: NodeRuntimeDiagnostic) -> String {
        "Flyd Core is using Node \(diagnostic.nodeVersion). AgentRun needs Node " +
        "\(diagnostic.minimumNodeVersion) or later. Flyd continues using its " +
        "existing recovery system.\n\nUpdate Node from the official site, " +
        "then restart Flyd so its Core uses the new version. Flyd won't " +
        "change your Node installation automatically."
    }
}
