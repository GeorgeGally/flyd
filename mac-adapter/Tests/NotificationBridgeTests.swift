import XCTest
@testable import FlydMacAdapter

final class NotificationBridgeTests: XCTestCase {
    func testFirstLineReturnsBytesBeforeNewline() {
        let line = NotificationBridge.firstLine(Data("{\"ok\":true}\nremaining".utf8))
        XCTAssertEqual(line.flatMap { String(data: $0, encoding: .utf8) }, "{\"ok\":true}")
    }

    func testFirstLineIsNilUntilANewlineArrives() {
        XCTAssertNil(NotificationBridge.firstLine(Data("partial request".utf8)))
    }
}
