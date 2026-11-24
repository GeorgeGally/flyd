import Foundation
import XCTest
@testable import FlydMacAdapter

final class ProviderNoticeLedgerTests: XCTestCase {
    func testOnlyShownIncidentsAreRememberedAcrossClientRestarts() {
        let suite = "flyd-provider-test-\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        let first = ProviderNoticeLedger(defaults: defaults)
        XCTAssertFalse(first.shown.contains("jev:one"))
        first.recordShown("jev:one")
        first.recordShown("jev:one")
        let restarted = ProviderNoticeLedger(defaults: defaults)
        XCTAssertEqual(restarted.shown, ["jev:one"])
        XCTAssertFalse(restarted.shown.contains("jev:two"))
    }
}
