import XCTest
@testable import FlydMacAdapter

final class NodeRuntimeUpdatePolicyTests: XCTestCase {
    private func status(
        node: String = "22.16.0",
        required: Bool = true,
        mode: String = "off"
    ) -> NodeRuntimeDiagnostic {
        NodeRuntimeDiagnostic(
            mode: mode, enabled: false, reason: "legacy recovery selected",
            nodeVersion: node, minimumNodeVersion: "24.22.3",
            nodeUpgradeRequired: required
        )
    }

    func testOneNoticePerIncompatibleCoreVersion() {
        let old = status()
        let id = NodeRuntimeUpdatePolicy.noticeID(for: old)
        XCTAssertNotNil(id)
        XCTAssertTrue(NodeRuntimeUpdatePolicy.shouldPresent(old, lastNoticeID: nil))
        XCTAssertFalse(NodeRuntimeUpdatePolicy.shouldPresent(old, lastNoticeID: id))
        XCTAssertTrue(NodeRuntimeUpdatePolicy.shouldPresent(
            status(node: "22.17.0"), lastNoticeID: id
        ))
    }

    func testNoPromptWhenNotRequiredOrUserOptedOut() {
        let compatible = status(node: "24.22.3", required: false, mode: "on")
        XCTAssertNil(NodeRuntimeUpdatePolicy.noticeID(for: compatible))
        XCTAssertFalse(NodeRuntimeUpdatePolicy.shouldPresent(compatible, lastNoticeID: nil))
        let optedOut = status(required: false, mode: "off")
        XCTAssertFalse(NodeRuntimeUpdatePolicy.shouldPresent(optedOut, lastNoticeID: nil))
    }

    func testOnlyTheOfficialDownloadAndManualRestartAreOffered() {
        XCTAssertEqual(NodeRuntimeUpdatePolicy.downloadURL.host, "nodejs.org")
        let message = NodeRuntimeUpdatePolicy.message(for: status())
        XCTAssertTrue(message.contains("Node 22.16.0"))
        XCTAssertTrue(message.contains("24.22.3"))
        XCTAssertTrue(message.contains("restart Flyd"))
        XCTAssertTrue(message.contains("won't"))
    }

    func testDiagnosticUsesCanonicalCoreResponseKeys() throws {
        let json = """
        {
          "mode": "off", "enabled": false, "reason": "Node version too old",
          "nodeVersion": "22.16.0", "minimumNodeVersion": "24.22.3",
          "nodeUpgradeRequired": true
        }
        """
        let decoded = try JSONDecoder().decode(NodeRuntimeDiagnostic.self, from: Data(json.utf8))
        XCTAssertEqual(decoded.nodeVersion, "22.16.0")
        XCTAssertEqual(decoded.minimumNodeVersion, "24.22.3")
        XCTAssertTrue(NodeRuntimeUpdatePolicy.shouldPresent(decoded, lastNoticeID: nil))
    }
}
