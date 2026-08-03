import XCTest
@testable import FlydMacAdapter

final class WorkInteractionPayloadTests: XCTestCase {

    func testDecodeRequestGoldenFixture() throws {
        let json = """
        {
          "contract_version": 1,
          "interaction_id": "wi_test_001",
          "work_session_id": "ws_test_001",
          "work_session_revision": 1,
          "invocation_id": "inv_test_001",
          "intent": "Review this function for correctness issues",
          "modality": "text",
          "current_evidence": {
            "foreground_app": { "bundle_id": "com.apple.dt.Xcode", "name": "Xcode" },
            "active_window": { "title": "AuthService.swift — CleanX" },
            "focused_element": {
              "ref": "el_01",
              "role": "AXTextArea",
              "value": "func login(email: String, password: String) async throws -> Token",
              "selected_text": ""
            },
            "display_identity": "display_0_2560x1440",
            "focused_bounds": { "x": 200, "y": 150, "width": 800, "height": 600 }
          }
        }
        """

        let data = json.data(using: .utf8)!
        let decoder = JSONDecoder()
        let request = try decoder.decode(WorkInteractionRequestPayload.self, from: data)

        XCTAssertEqual(request.contractVersion, 1)
        XCTAssertEqual(request.interactionId, "wi_test_001")
        XCTAssertEqual(request.workSessionId, "ws_test_001")
        XCTAssertEqual(request.workSessionRevision, 1)
        XCTAssertEqual(request.invocationId, "inv_test_001")
        XCTAssertEqual(request.intent, "Review this function for correctness issues")
        XCTAssertEqual(request.modality, "text")
        XCTAssertEqual(request.currentEvidence.foregroundApp.bundleId, "com.apple.dt.Xcode")
        XCTAssertEqual(request.currentEvidence.foregroundApp.name, "Xcode")
        XCTAssertEqual(request.currentEvidence.activeWindow.title, "AuthService.swift — CleanX")
        XCTAssertEqual(request.currentEvidence.focusedElement.ref, "el_01")
        XCTAssertEqual(request.currentEvidence.focusedElement.role, "AXTextArea")
        XCTAssertEqual(request.currentEvidence.displayIdentity, "display_0_2560x1440")
        XCTAssertEqual(request.currentEvidence.focusedBounds?.x, 200)
        XCTAssertEqual(request.currentEvidence.focusedBounds?.y, 150)
        XCTAssertEqual(request.currentEvidence.focusedBounds?.width, 800)
        XCTAssertEqual(request.currentEvidence.focusedBounds?.height, 600)
    }

    func testDecodeResponseGoldenFixture() throws {
        let json = """
        {
          "contract_version": 1,
          "interaction_id": "wi_test_001",
          "work_session_id": "ws_test_001",
          "work_session_revision": 1,
          "current_work": {
            "project": {
              "value": "CleanX",
              "source": "foreground",
              "confidence": "high",
              "provenance": "Document path resolves to Git repository root",
              "source_timestamp": "2026-08-02T10:00:00Z",
              "is_hypothesis": false
            },
            "objective": {
              "value": "unknown",
              "source": "foreground",
              "confidence": "low",
              "provenance": "No explicit goal found",
              "source_timestamp": "2026-08-02T10:00:00Z",
              "is_hypothesis": true
            },
            "artifact": {
              "kind": "code",
              "title": "AuthService.swift",
              "content_digest": "sha256:abc123"
            },
            "stage": {
              "value": "execution",
              "source": "foreground",
              "confidence": "medium",
              "provenance": "Active editor suggests implementation phase",
              "source_timestamp": "2026-08-02T10:00:00Z",
              "is_hypothesis": false
            },
            "constraints": {
              "value": [],
              "source": "foreground",
              "confidence": "low",
              "provenance": "No explicit constraints found",
              "source_timestamp": "2026-08-02T10:00:00Z",
              "is_hypothesis": true
            },
            "open_loops": [],
            "next_action": {
              "value": { "description": "Review the login function", "readiness": "ready" },
              "source": "conversation",
              "confidence": "high",
              "provenance": "User intent",
              "source_timestamp": "2026-08-02T10:00:00Z",
              "is_hypothesis": false
            },
            "evidence_summary": {
              "sources": ["foreground_element", "document_path"],
              "snapshot_timestamp": "2026-08-02T10:00:00Z",
              "foreground_app": "Xcode",
              "repository_root": "/Users/george/Projects/CleanX",
              "branch": "main",
              "head_digest": "abc123",
              "active_window_title": "AuthService.swift — CleanX"
            },
            "uncertainty": [{ "field": "objective", "reason": "Not found" }]
          },
          "diagnosis": {
            "primary_issue": {
              "category": "correctness",
              "severity": "critical",
              "finding": "The login function does not handle errors",
              "causal_explanation": "API call can fail for multiple reasons",
              "domain": "code",
              "evidence_refs": ["foreground_element_value"]
            }
          },
          "intervention": {
            "kind": "critique",
            "content": "Define an AuthError enum",
            "stronger_alternative": "Wrap the api.post call in a do/catch",
            "visual_grounding": {
              "region_description": {
                "bounds": { "x": 200, "y": 150, "width": 800, "height": 600 },
                "display_id": "display_0_2560x1440",
                "content_sample": "func login",
                "element_ref": "el_01"
              },
              "placement": "below_element"
            },
            "options": [
              { "label": "Show me the fix", "description": "Generate the refactored function" },
              { "label": "Explain more", "description": "Break down each failure case" }
            ]
          },
          "timing": { "total_ms": 1250 }
        }
        """

        let data = json.data(using: .utf8)!
        let decoder = JSONDecoder()
        let response = try decoder.decode(WorkInteractionResponsePayload.self, from: data)

        XCTAssertEqual(response.contractVersion, 1)
        XCTAssertEqual(response.currentWork.project.value, "CleanX")
        XCTAssertEqual(response.currentWork.project.source, "foreground")
        XCTAssertEqual(response.currentWork.project.confidence, "high")
        XCTAssertEqual(response.currentWork.project.isHypothesis, false)
        XCTAssertEqual(response.currentWork.objective.isHypothesis, true)
        XCTAssertEqual(response.currentWork.artifact.kind, "code")
        XCTAssertEqual(response.currentWork.artifact.contentDigest, "sha256:abc123")
        XCTAssertEqual(response.currentWork.evidenceSummary.repositoryRoot, "/Users/george/Projects/CleanX")
        XCTAssertEqual(response.currentWork.evidenceSummary.branch, "main")
        XCTAssertEqual(response.currentWork.uncertainty.count, 1)

        XCTAssertEqual(response.diagnosis.primaryIssue.category, "correctness")
        XCTAssertEqual(response.diagnosis.primaryIssue.severity, "critical")
        XCTAssertEqual(response.diagnosis.primaryIssue.domain, "code")
        XCTAssertEqual(response.diagnosis.primaryIssue.evidenceRefs, ["foreground_element_value"])

        XCTAssertEqual(response.intervention.kind, "critique")
        XCTAssertEqual(response.intervention.strongerAlternative, "Wrap the api.post call in a do/catch")
        XCTAssertEqual(response.intervention.options?.count, 2)
        XCTAssertEqual(response.intervention.visualGrounding?.placement, "below_element")
        XCTAssertEqual(response.intervention.visualGrounding?.regionDescription.elementRef, "el_01")

        XCTAssertEqual(response.timing.totalMs, 1250)
    }

    func testRejectsIncompatibleContractVersion() throws {
        let json = """
        {
          "contract_version": 99,
          "interaction_id": "wi_test",
          "work_session_id": "ws_test",
          "work_session_revision": 1,
          "invocation_id": "inv_test",
          "intent": "test",
          "modality": "text",
          "current_evidence": {
            "foreground_app": { "bundle_id": "test", "name": "Test" },
            "active_window": { "title": "Test" },
            "focused_element": { "ref": "el_01", "role": "test", "value": "", "selected_text": "" }
          }
        }
        """

        let data = json.data(using: .utf8)!
        let decoder = JSONDecoder()
        let request = try decoder.decode(WorkInteractionRequestPayload.self, from: data)

        XCTAssertEqual(request.contractVersion, 99)
    }

    func testActionGrantPayloadDecode() throws {
        let json = """
        {
          "grant_id": "ag_test_001",
          "action_id": "act_test_001",
          "status": "approved",
          "granted_at": "2026-08-02T10:02:00Z",
          "work_session_revision": 1,
          "target_fingerprint": {
            "element_ref": "el_01",
            "field_value_digest": "sha256:def789",
            "repository_root": "/Users/george/Projects/CleanX",
            "branch": "main",
            "head_digest": "abc123def456",
            "status_digest": "clean"
          }
        }
        """

        let data = json.data(using: .utf8)!
        let decoder = JSONDecoder()
        let grant = try decoder.decode(ActionGrantPayload.self, from: data)

        XCTAssertEqual(grant.grantId, "ag_test_001")
        XCTAssertEqual(grant.actionId, "act_test_001")
        XCTAssertEqual(grant.status, "approved")
        XCTAssertEqual(grant.workSessionRevision, 1)
        XCTAssertEqual(grant.targetFingerprint.elementRef, "el_01")
        XCTAssertEqual(grant.targetFingerprint.repositoryRoot, "/Users/george/Projects/CleanX")
        XCTAssertEqual(grant.targetFingerprint.branch, "main")
        XCTAssertEqual(grant.targetFingerprint.statusDigest, "clean")
    }

    func testVerificationResultPayloadDecode() throws {
        let json = """
        {
          "action_grant_id": "ag_test_001",
          "diagnosis_resolved": true,
          "actual_changes": "Replaced login function with error-handled version",
          "verification_checks": {
            "re_read": { "passed": true, "expected": "AuthError.login(...)", "actual": "AuthError.login(...)" }
          },
          "verdict": "verified",
          "evidence": "Post-execution re-read confirmed text matches expected",
          "timestamp": "2026-08-02T10:03:00Z"
        }
        """

        let data = json.data(using: .utf8)!
        let decoder = JSONDecoder()
        let result = try decoder.decode(VerificationResultPayload.self, from: data)

        XCTAssertEqual(result.actionGrantId, "ag_test_001")
        XCTAssertEqual(result.diagnosisResolved, true)
        XCTAssertEqual(result.verdict, "verified")
        XCTAssertEqual(result.verificationChecks.reRead.passed, true)
        XCTAssertEqual(result.verificationChecks.reRead.expected, "AuthError.login(...)")
    }
}
