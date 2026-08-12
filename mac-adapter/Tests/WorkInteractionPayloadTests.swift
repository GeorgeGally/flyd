import XCTest
@testable import FlydMacAdapter

final class WorkInteractionPayloadTests: XCTestCase {
    func testRepositoryActionAsyncJobPayloadsDecode() throws {
        let submission = try JSONDecoder().decode(
            FlydClient.RepositoryActionSubmission.self,
            from: Data(#"{"jobId":"grant-1","status":"running","deadlineAt":"2026-08-12T12:00:00.000Z","pollAfterMs":1000}"#.utf8)
        )
        XCTAssertEqual(submission.jobId, "grant-1")
        XCTAssertEqual(submission.pollAfterMs, 1_000)

        let status = try JSONDecoder().decode(
            FlydClient.RepositoryActionJobResponse.self,
            from: Data(#"{"jobId":"grant-1","status":"completed","deadlineAt":"2026-08-12T12:00:00.000Z","result":{"actionId":"action-1","verified":true,"changedFiles":["cli/src/server.ts"],"diffDigest":"abc","checksPerformed":["npm test"],"integrationStatus":"unintegrated","handoffLocation":"/tmp/handoff","error":null},"error":null}"#.utf8)
        )
        XCTAssertEqual(status.status, "completed")
        XCTAssertEqual(status.result?.changedFiles, ["cli/src/server.ts"])
    }


    func testManifestRepositoryActionResponseDecodesForInstalledApp() throws {
        let json = """
        {
          "resolutionId": "interaction-1",
          "invocationId": "invocation-1",
          "environmentRevision": 1,
          "mode": "work_intelligence",
          "rationale": "The validation boundary is missing",
          "operations": [],
          "augmentations": [],
          "workSessionId": "session-1",
          "workSessionRevision": 4,
          "diagnosis": {
            "primaryIssue": {
              "category": "correctness",
              "severity": "critical",
              "finding": "The validation boundary is missing",
              "causalExplanation": "The input reaches execution unchecked",
              "domain": "code",
              "evidenceRefs": ["repository_status"]
            }
          },
          "intervention": {
            "kind": "actionPlan",
            "content": "Add the missing validation",
            "proposedAction": {
              "actionId": "action-1",
              "kind": "repository_action",
              "description": "Add the missing validation",
              "targetFingerprint": {
                "repositoryRoot": "/tmp/project",
                "branch": "main",
                "headDigest": "head-1",
                "statusDigest": "status-1"
              },
              "workSessionRevision": 4,
              "diagnosedIssueId": "interaction-1",
              "finishCondition": "Tests pass",
              "expiryMs": 60000,
              "allowedOperation": "repository_work"
            }
          }
        }
        """

        let response = try JSONDecoder().decode(FlydClient.ResolutionResponse.self, from: Data(json.utf8))
        XCTAssertEqual(response.mode, "work_intelligence")
        XCTAssertEqual(response.workSessionId, "session-1")
        XCTAssertEqual(response.workSessionRevision, 4)
        XCTAssertEqual(response.intervention?.proposedAction?.actionId, "action-1")
        XCTAssertEqual(response.intervention?.proposedAction?.targetFingerprint.repositoryRoot, "/tmp/project")
    }

    func testDecodeRequestGoldenFixture() throws {
        let json = """
        {
          "contractVersion": 1,
          "interactionId": "wi_test_001",
          "workSessionId": "ws_test_001",
          "workSessionRevision": 1,
          "invocationId": "inv_test_001",
          "intent": "Review this function for correctness issues",
          "modality": "text",
          "currentEvidence": {
            "foregroundApp": { "bundleId": "com.apple.dt.Xcode", "name": "Xcode" },
            "activeWindow": { "title": "AuthService.swift — CleanX" },
            "focusedElement": {
              "ref": "el_01",
              "role": "AXTextArea",
              "value": "func login(email: String, password: String) async throws -> Token",
              "selectedText": ""
            },
            "displayIdentity": "display_0_2560x1440",
            "focusedBounds": { "x": 200, "y": 150, "width": 800, "height": 600 }
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
          "contractVersion": 1,
          "interactionId": "wi_test_001",
          "workSessionId": "ws_test_001",
          "workSessionRevision": 1,
          "currentWork": {
            "project": {
              "value": "CleanX",
              "source": "foreground",
              "confidence": "high",
              "provenance": "Document path resolves to Git repository root",
              "sourceTimestamp": "2026-08-02T10:00:00Z",
              "isHypothesis": false
            },
            "objective": {
              "value": "unknown",
              "source": "foreground",
              "confidence": "low",
              "provenance": "No explicit goal found",
              "sourceTimestamp": "2026-08-02T10:00:00Z",
              "isHypothesis": true
            },
            "artifact": {
              "kind": "code",
              "title": "AuthService.swift",
              "contentDigest": "sha256:abc123"
            },
            "stage": {
              "value": "execution",
              "source": "foreground",
              "confidence": "medium",
              "provenance": "Active editor suggests implementation phase",
              "sourceTimestamp": "2026-08-02T10:00:00Z",
              "isHypothesis": false
            },
            "constraints": {
              "value": [],
              "source": "foreground",
              "confidence": "low",
              "provenance": "No explicit constraints found",
              "sourceTimestamp": "2026-08-02T10:00:00Z",
              "isHypothesis": true
            },
            "openLoops": [],
            "nextAction": {
              "value": { "description": "Review the login function", "readiness": "ready" },
              "source": "conversation",
              "confidence": "high",
              "provenance": "User intent",
              "sourceTimestamp": "2026-08-02T10:00:00Z",
              "isHypothesis": false
            },
            "evidenceSummary": {
              "sources": ["foreground_element", "document_path"],
              "snapshotTimestamp": "2026-08-02T10:00:00Z",
              "foregroundApp": "Xcode",
              "repositoryRoot": "/Users/george/Projects/CleanX",
              "branch": "main",
              "headDigest": "abc123",
              "activeWindowTitle": "AuthService.swift — CleanX"
            },
            "uncertainty": [{ "field": "objective", "reason": "Not found" }]
          },
          "diagnosis": {
            "primaryIssue": {
              "category": "correctness",
              "severity": "critical",
              "finding": "The login function does not handle errors",
              "causalExplanation": "API call can fail for multiple reasons",
              "domain": "code",
              "evidenceRefs": ["foreground_element_value"]
            }
          },
          "intervention": {
            "kind": "critique",
            "content": "Define an AuthError enum",
            "strongerAlternative": "Wrap the api.post call in a do/catch",
            "visualGrounding": {
              "regionDescription": {
                "bounds": { "x": 200, "y": 150, "width": 800, "height": 600 },
                "displayId": "display_0_2560x1440",
                "contentSample": "func login",
                "elementRef": "el_01"
              },
              "placement": "below_element"
            },
            "options": [
              { "label": "Show me the fix", "description": "Generate the refactored function" },
              { "label": "Explain more", "description": "Break down each failure case" }
            ]
          },
          "timing": { "totalMs": 1250 }
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
          "contractVersion": 99,
          "interactionId": "wi_test",
          "workSessionId": "ws_test",
          "workSessionRevision": 1,
          "invocationId": "inv_test",
          "intent": "test",
          "modality": "text",
          "currentEvidence": {
            "foregroundApp": { "bundleId": "test", "name": "Test" },
            "activeWindow": { "title": "Test" },
            "focusedElement": { "ref": "el_01", "role": "test", "value": "", "selectedText": "" }
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
          "grantId": "ag_test_001",
          "actionId": "act_test_001",
          "status": "approved",
          "grantedAt": "2026-08-02T10:02:00Z",
          "workSessionRevision": 1,
          "targetFingerprint": {
            "elementRef": "el_01",
            "fieldValueDigest": "sha256:def789",
            "repositoryRoot": "/Users/george/Projects/CleanX",
            "branch": "main",
            "headDigest": "abc123def456",
            "statusDigest": "clean"
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
          "actionGrantId": "ag_test_001",
          "diagnosisResolved": true,
          "actualChanges": "Replaced login function with error-handled version",
          "verificationChecks": {
            "reRead": { "passed": true, "expected": "AuthError.login(...)", "actual": "AuthError.login(...)" }
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
