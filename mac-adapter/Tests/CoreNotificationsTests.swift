import XCTest
@testable import FlydMacAdapter

final class CoreNotificationsTests: XCTestCase {
    func testReadsNotificationsFromTheFeedAndKeepsAPartialEvent() {
        let stream = ": connected\n\nevent: notification\ndata: {\"title\":\"Agenda done\",\"message\":\"The meeting is at 9.\"}\n\nevent: notification\ndata: {\"title\":\"Sc"
        let parsed = CoreNotificationPayload.parse(stream)
        XCTAssertEqual(parsed.notifications, [CoreNotificationPayload(title: "Agenda done", message: "The meeting is at 9.")])
        XCTAssertEqual(parsed.rest, "event: notification\ndata: {\"title\":\"Sc")
    }
}

final class CoreNotificationTurnTests: XCTestCase {
    func testANotificationWaitsForDictationAFailureAndTheOneShowingButNotARoutineStatus() {
        XCTAssertTrue(CoreNotificationPayload.canShow(over: nil))
        XCTAssertTrue(CoreNotificationPayload.canShow(over: .inserted))
        XCTAssertTrue(CoreNotificationPayload.canShow(over: .status("", .working)))
        XCTAssertFalse(CoreNotificationPayload.canShow(over: .listening))
        XCTAssertFalse(CoreNotificationPayload.canShow(over: .working))
        XCTAssertFalse(CoreNotificationPayload.canShow(over: .failed("Microphone permission required")))
        XCTAssertFalse(CoreNotificationPayload.canShow(over: .notification("Agenda done", "The meeting is at 9.")))
        XCTAssertFalse(CoreNotificationPayload.canShow(over: .status("Needs you: pick one", .decision)))
    }
}
