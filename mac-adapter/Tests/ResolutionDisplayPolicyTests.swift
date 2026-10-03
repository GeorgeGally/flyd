import XCTest
@testable import FlydMacAdapter

final class ResolutionDisplayPolicyTests: XCTestCase {
    private func resolution(_ mode: String, extra: String = "") throws -> FlydClient.ResolutionResponse {
        let json = """
        {
          "resolutionId": "res-1",
          "invocationId": "inv-1",
          "environmentRevision": 1,
          "mode": "\(mode)",
          "rationale": "test",
          "operations": []\(extra.isEmpty ? "" : ",\n  \(extra)")
        }
        """
        return try JSONDecoder().decode(FlydClient.ResolutionResponse.self, from: Data(json.utf8))
    }

    private let augmentation = """
    "augmentations": [{ "kind": "explanation", "content": "It is 4pm in London.", "placement": "near_cursor" }]
    """

    func testAnswerWithAnAugmentRenders() throws {
        XCTAssertNil(ResolutionDisplayPolicy.failure(for: try resolution("requires_augment", extra: augmentation)))
    }

    func testAugmentWithNothingInItFailsVisibly() throws {
        XCTAssertEqual(
            ResolutionDisplayPolicy.failure(for: try resolution("requires_augment")),
            ResolutionDisplayPolicy.nothingToShow
        )
        XCTAssertEqual(
            ResolutionDisplayPolicy.failure(for: try resolution("requires_augment", extra: #""augmentations": []"#)),
            ResolutionDisplayPolicy.nothingToShow
        )
    }

    func testNativeWithoutOperationsFailsVisibly() throws {
        XCTAssertEqual(ResolutionDisplayPolicy.failure(for: try resolution("native")), ResolutionDisplayPolicy.nothingToShow)
    }

    func testNativeWithAnOperationRenders() throws {
        let json = """
        {"resolutionId":"r","invocationId":"i","environmentRevision":1,"mode":"native","rationale":"t",
         "operations":[{"target":"el_01","kind":"insert","text":"hello"}]}
        """
        let native = try JSONDecoder().decode(FlydClient.ResolutionResponse.self, from: Data(json.utf8))
        XCTAssertNil(ResolutionDisplayPolicy.failure(for: native))
    }

    func testExecutionTaskAndWorkModesWithoutTheirPayloadFailVisibly() throws {
        for mode in ["requires_execution", "requires_task", "work_intelligence"] {
            XCTAssertEqual(ResolutionDisplayPolicy.failure(for: try resolution(mode)), ResolutionDisplayPolicy.nothingToShow, mode)
        }
    }

    func testComposeAlwaysOpensASurface() throws {
        XCTAssertNil(ResolutionDisplayPolicy.failure(for: try resolution("requires_compose")))
    }

    func testUnknownModeFailsVisibly() throws {
        XCTAssertEqual(ResolutionDisplayPolicy.failure(for: try resolution("requires_magic")), ResolutionDisplayPolicy.nothingToShow)
    }
}
