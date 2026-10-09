import XCTest
@testable import FlydMacAdapter

final class CoreSupervisorTests: XCTestCase {
    private final class Harness {
        var healthy = false
        var launches = 0
        var launchSucceeds = true
        var pendingExit: ((Int32) -> Void)?
        var scheduled: [(delay: TimeInterval, work: () -> Void)] = []
        var logs: [String] = []
        var clock = Date(timeIntervalSince1970: 0)

        lazy var supervisor = CoreSupervisor(
            probe: { [unowned self] done in done(healthy) },
            launch: { [unowned self] onExit in
                launches += 1
                pendingExit = onExit
                return launchSucceeds
            },
            schedule: { [unowned self] delay, work in scheduled.append((delay, work)) },
            now: { [unowned self] in clock },
            log: { [unowned self] in logs.append($0) }
        )

        func runNextScheduled() -> TimeInterval {
            let next = scheduled.removeFirst()
            next.work()
            return next.delay
        }

        func exitCore(_ status: Int32, after seconds: TimeInterval = 1) {
            clock += seconds
            let exit = pendingExit
            pendingExit = nil
            exit?(status)
        }
    }

    func testAdoptsAlreadyRunningCoreWithoutLaunchingAnother() {
        let harness = Harness()
        harness.healthy = true

        harness.supervisor.start()
        for _ in 0..<100 {
            XCTAssertEqual(harness.runNextScheduled(), 30)
        }

        XCTAssertEqual(harness.launches, 0)
        XCTAssertEqual(harness.logs.count, 1, "adoption is logged once, not on every re-check")
        XCTAssertTrue(harness.logs[0].contains("adopting"))
    }

    func testLaunchesWhenAdoptedCoreGoesAway() {
        let harness = Harness()
        harness.healthy = true
        harness.supervisor.start()

        harness.healthy = false
        _ = harness.runNextScheduled()

        XCTAssertEqual(harness.launches, 1)
        XCTAssertTrue(harness.logs.last!.contains("stopped answering"))
    }

    func testPortConflictExitAdoptsTheCoreThatWonTheRace() {
        let harness = Harness()
        harness.supervisor.start()
        XCTAssertEqual(harness.launches, 1)

        // Another Core grabbed the port first; ours exits with "Port 4815 is already in use".
        harness.healthy = true
        harness.exitCore(1)
        _ = harness.runNextScheduled()

        XCTAssertEqual(harness.launches, 1)
        XCTAssertTrue(harness.logs.last!.contains("adopting"))
    }

    func testCrashLoopBacksOffExponentiallyToACap() {
        let harness = Harness()
        harness.supervisor.start()

        var delays: [TimeInterval] = []
        for _ in 0..<10 {
            harness.exitCore(1)
            delays.append(harness.runNextScheduled())
        }

        XCTAssertEqual(delays, [2, 4, 8, 16, 32, 64, 128, 256, 300, 300])
        XCTAssertEqual(harness.launches, 11)
    }

    func testStableRunResetsBackoff() {
        let harness = Harness()
        harness.supervisor.start()
        harness.exitCore(1)
        _ = harness.runNextScheduled()
        harness.exitCore(1)
        XCTAssertEqual(harness.runNextScheduled(), 4)

        harness.exitCore(1, after: 600)

        XCTAssertEqual(harness.runNextScheduled(), 2)
    }

    func testCleanExitIsNotRestarted() {
        let harness = Harness()
        harness.supervisor.start()
        harness.exitCore(0)

        XCTAssertTrue(harness.scheduled.isEmpty)
        XCTAssertEqual(harness.launches, 1)
    }

    func testFailedLaunchBacksOff() {
        let harness = Harness()
        harness.launchSucceeds = false
        harness.supervisor.start()

        XCTAssertEqual(harness.runNextScheduled(), 2)
        XCTAssertEqual(harness.runNextScheduled(), 4)
        XCTAssertEqual(harness.launches, 3)
    }

    func testLaunchLogRotatesWhenOversized() throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("core-launch-log-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let log = directory.appendingPathComponent("core-launch.log")
        let rotated = directory.appendingPathComponent("core-launch.log.1")

        try Data(repeating: 65, count: 10).write(to: log)
        CoreLaunchLog.rotateIfNeeded(at: log, maxBytes: 100)
        XCTAssertTrue(FileManager.default.fileExists(atPath: log.path))
        XCTAssertFalse(FileManager.default.fileExists(atPath: rotated.path))

        try Data(repeating: 66, count: 200).write(to: rotated)
        try Data(repeating: 65, count: 150).write(to: log)
        CoreLaunchLog.rotateIfNeeded(at: log, maxBytes: 100)
        XCTAssertFalse(FileManager.default.fileExists(atPath: log.path))
        XCTAssertEqual(try Data(contentsOf: rotated).count, 150)
    }
}
