import XCTest
@testable import FlydMacAdapter

final class CoreNotificationsTests: XCTestCase {
    func testReadsNotificationsFromTheFeedAndKeepsAPartialEvent() {
        let stream = ": connected\n\nevent: notification\ndata: {\"title\":\"Agenda done\",\"message\":\"The meeting is at 9.\"}\n\nevent: notification\ndata: {\"title\":\"Sc"
        let parsed = CoreNotificationPayload.parse(Data(stream.utf8))
        XCTAssertEqual(parsed.notifications, [CoreNotificationPayload(title: "Agenda done", message: "The meeting is at 9.")])
        XCTAssertEqual(parsed.rest, Data("event: notification\ndata: {\"title\":\"Sc".utf8))
    }

    func testANotificationSplitInsideACharacterStillArrivesWhole() {
        let event = Data("event: notification\ndata: {\"title\":\"Scout — today\",\"message\":\"Three new reads\"}\n\n".utf8)
        let dash = event.firstRange(of: Data("—".utf8))!
        let first = CoreNotificationPayload.parse(event[..<(dash.lowerBound + 1)])
        XCTAssertEqual(first.notifications, [])
        let second = CoreNotificationPayload.parse(first.rest + event[(dash.lowerBound + 1)...])
        XCTAssertEqual(second.notifications, [CoreNotificationPayload(title: "Scout — today", message: "Three new reads")])
        XCTAssertEqual(second.rest, Data())
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
