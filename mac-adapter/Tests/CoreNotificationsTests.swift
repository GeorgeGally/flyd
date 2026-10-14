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
