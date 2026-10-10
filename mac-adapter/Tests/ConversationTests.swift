import Darwin
import XCTest
@testable import FlydMacAdapter

final class ConversationLinkPolicyTests: XCTestCase {
    let origin = URL(string: "http://127.0.0.1:4818/")!

    func testTheViewsOwnPagesStayInTheWindow() {
        XCTAssertEqual(ConversationLinkPolicy.decide(URL(string: "http://127.0.0.1:4818/?session=abc"), serverOrigin: origin), .allow)
        XCTAssertEqual(ConversationLinkPolicy.decide(URL(string: "about:blank"), serverOrigin: origin), .allow)
    }

    func testWebLinksOpenInTheDefaultBrowser() {
        XCTAssertEqual(ConversationLinkPolicy.decide(URL(string: "https://github.com/GeorgeGally/flyd/pull/59"), serverOrigin: origin), .openExternally)
        XCTAssertEqual(ConversationLinkPolicy.decide(URL(string: "http://localhost:8080/services/"), serverOrigin: origin), .openExternally)
        XCTAssertEqual(ConversationLinkPolicy.decide(URL(string: "http://127.0.0.1:9999/"), serverOrigin: origin), .openExternally)
        XCTAssertEqual(ConversationLinkPolicy.decide(URL(string: "mailto:a@b.c"), serverOrigin: origin), .openExternally)
    }

    func testDroppedFilesAndOtherSchemesGoNowhere() {
        XCTAssertEqual(ConversationLinkPolicy.decide(URL(string: "file:///Users/x/shot.png"), serverOrigin: origin), .block)
        XCTAssertEqual(ConversationLinkPolicy.decide(URL(string: "javascript:alert(1)"), serverOrigin: origin), .block)
        XCTAssertEqual(ConversationLinkPolicy.decide(nil, serverOrigin: origin), .block)
    }
}

final class ConversationServerTests: XCTestCase {
    func testRunsTheViewAsOneNodeProcessOnTheChosenPort() {
        XCTAssertEqual(ConversationServer.arguments(port: 4818), ["--import", "tsx", "src/entry.ts", "view", "--no-open", "--port", "4818"])
    }

    func testABranchCheckoutCanBeNamedForTheView() {
        XCTAssertEqual(ConversationServer.cliDirectory(environment: ["FLYD_VIEW_CLI_DIR": "/tmp/flyd/cli"]), "/tmp/flyd/cli")
    }

    func testPrefersItsPortButMovesWhenItIsTaken() throws {
        let preferred = try XCTUnwrap(ConversationServer.freeLoopbackPort(preferred: 0))
        XCTAssertEqual(ConversationServer.freeLoopbackPort(preferred: preferred), preferred)

        // Occupy it, as a stale server would.
        let fd = socket(AF_INET, SOCK_STREAM, 0)
        defer { close(fd) }
        var address = sockaddr_in()
        address.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
        address.sin_family = sa_family_t(AF_INET)
        address.sin_port = in_port_t(UInt16(preferred).bigEndian)
        address.sin_addr = in_addr(s_addr: inet_addr("127.0.0.1"))
        let bound = withUnsafePointer(to: &address) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { Darwin.bind(fd, $0, socklen_t(MemoryLayout<sockaddr_in>.size)) }
        }
        XCTAssertEqual(bound, 0)
        XCTAssertEqual(Darwin.listen(fd, 1), 0)

        XCTAssertFalse(ConversationServer.isFree(preferred))
        let other = try XCTUnwrap(ConversationServer.freeLoopbackPort(preferred: preferred))
        XCTAssertNotEqual(other, preferred)
    }
}

final class ConversationSurfaceDecodingTests: XCTestCase {
    /// Exactly what Core's /manifest sends for "open Flyd".
    func testCoreAsksForTheConversationWindow() throws {
        let json = """
        {"mode":"requires_surface","surface":"conversation","resolutionId":"r1","invocationId":"i1",
         "environmentRevision":1,"rationale":"open-conversation","operations":[]}
        """
        let response = try JSONDecoder().decode(FlydClient.ResolutionResponse.self, from: Data(json.utf8))
        XCTAssertEqual(response.mode, "requires_surface")
        XCTAssertEqual(response.surface, "conversation")
    }

    func testOtherResolutionsCarryNoSurface() throws {
        let json = """
        {"mode":"requires_augment","resolutionId":"r1","invocationId":"i1","environmentRevision":1,
         "rationale":"x","operations":[],"augmentations":[{"kind":"explanation","content":"hi","placement":"cursor"}]}
        """
        XCTAssertNil(try JSONDecoder().decode(FlydClient.ResolutionResponse.self, from: Data(json.utf8)).surface)
    }
}

final class ConversationVoiceBridgeTests: XCTestCase {
    func testTranscriptsReachThePageAsSafeJavaScriptStrings() throws {
        let tricky = "say \"hi\"\nthen </script> and \\ done — ✓"
        let literal = ConversationWindow.jsString(tricky)
        let decoded = try JSONSerialization.jsonObject(with: Data("[\(literal)]".utf8)) as? [String]
        XCTAssertEqual(decoded, [tricky])
        XCTAssertFalse(literal.contains("\n"))
    }
}

final class ConversationStatusDecisionTests: XCTestCase {
    private func status(_ session: String = "s1", working: Bool = false, reply: (String, String, Bool)? = nil) -> ConversationStatusPayload {
        var json = "{\"session\":\"\(session)\",\"working\":\(working)"
        if let reply { json += ",\"reply\":{\"id\":\"\(reply.0)\",\"headline\":\"\(reply.1)\",\"asks\":\(reply.2)}" }
        json += "}"
        return try! JSONDecoder().decode(ConversationStatusPayload.self, from: Data(json.utf8))
    }

    func testTheFirstReadingAnnouncesNothingOld() {
        XCTAssertEqual(ConversationStatusDecision.decide(previous: nil, current: status(reply: ("r1", "Old news.", false))), [.none])
        XCTAssertEqual(ConversationStatusDecision.decide(previous: nil, current: status(working: true)), [.showWorking])
    }

    func testANewReplyIsAnnouncedAndAQuestionAsksForADecision() {
        let before = status(working: true, reply: ("r1", "Old.", false))
        XCTAssertEqual(
            ConversationStatusDecision.decide(previous: before, current: status(reply: ("r2", "Pushed.", false))),
            [.announce("Pushed.", .reply), .clearWorking]
        )
        XCTAssertEqual(
            ConversationStatusDecision.decide(previous: before, current: status(reply: ("r2", "Merge it?", true))),
            [.announce("Needs you: Merge it?", .decision), .clearWorking]
        )
    }

    func testANewSessionStartsFromItsOwnBaseline() {
        let before = status("s1", reply: ("r1", "Old.", false))
        XCTAssertEqual(ConversationStatusDecision.decide(previous: before, current: status("s2", reply: ("r9", "Other.", false))), [.none])
    }

    func testStatusPhasesHoldForTheirTone() {
        XCTAssertNil(DictationPill.StatusTone.working.holdSeconds)
        XCTAssertEqual(DictationPill.StatusTone.sent.holdSeconds, 2)
        XCTAssertEqual(DictationPill.StatusTone.reply.holdSeconds, 6)
        XCTAssertEqual(DictationPill.StatusTone.decision.holdSeconds, 10)
    }
}

final class ConversationStatusWorkingTests: XCTestCase {
    func testWorkingIsAnnouncedOnceNotOnEveryTick() throws {
        let decode = { (json: String) in try JSONDecoder().decode(ConversationStatusPayload.self, from: Data(json.utf8)) }
        let idle = try decode(#"{"session":"s1","working":false}"#)
        let busy = try decode(#"{"session":"s1","working":true}"#)
        XCTAssertEqual(ConversationStatusDecision.decide(previous: idle, current: busy), [.showWorking])
        XCTAssertEqual(ConversationStatusDecision.decide(previous: busy, current: busy), [.none])
    }
}

final class IslandStatusTextTests: XCTestCase {
    func testStatusTextStaysShortOnAWordBoundary() {
        let short = DictationPill.quoted("Good idea. I've asked the worker to turn the Mac's top-of-screen pill into a status line that shows what firstmate is doing", limit: DictationPill.statusLimit)
        XCTAssertLessThanOrEqual(short.count, DictationPill.statusLimit + 1)
        XCTAssertTrue(short.hasSuffix("…"))
        XCTAssertEqual(ConversationStatus.workingText, "")
    }
}
