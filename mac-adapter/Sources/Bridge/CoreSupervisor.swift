import Foundation

/// Keeps one Flyd Core serving on 127.0.0.1:4815.
///
/// Before every launch it asks the port for `/health`: a Core that is already serving
/// (left over from a previous app instance, or started by hand with `npm run core`) is
/// adopted and watched instead of being raced by a second Core that can only die with
/// "Port 4815 is already in use". Crashes restart with exponential backoff, and only
/// state changes are logged, so the launch log cannot grow by a few lines every 2s.
final class CoreSupervisor {
    struct Timing {
        var initialRestartDelay: TimeInterval = 2
        var maxRestartDelay: TimeInterval = 300
        /// How often an adopted Core is re-checked, so it is replaced if it goes away.
        var adoptedRecheckInterval: TimeInterval = 30
        /// A Core that ran at least this long before crashing restarts from the initial delay.
        var stableRunDuration: TimeInterval = 60
    }

    /// Calls back with whether a Core already answers `/health`.
    typealias HealthProbe = (@escaping (Bool) -> Void) -> Void
    /// Starts a Core and calls back with its exit status; returns false if it could not start.
    typealias Launcher = (@escaping (Int32) -> Void) -> Bool
    typealias Scheduler = (TimeInterval, @escaping () -> Void) -> Void

    private let timing: Timing
    private let probe: HealthProbe
    private let launch: Launcher
    private let schedule: Scheduler
    private let now: () -> Date
    private let log: (String) -> Void

    private var adopted = false
    private var consecutiveFailures = 0

    init(
        timing: Timing = Timing(),
        probe: @escaping HealthProbe,
        launch: @escaping Launcher,
        schedule: @escaping Scheduler,
        now: @escaping () -> Date = Date.init,
        log: @escaping (String) -> Void
    ) {
        self.timing = timing
        self.probe = probe
        self.launch = launch
        self.schedule = schedule
        self.now = now
        self.log = log
    }

    func start() {
        attempt()
    }

    private func attempt() {
        probe { [self] healthy in
            if healthy {
                if !adopted {
                    adopted = true
                    log("Core already serving on port 4815 — adopting it instead of launching another")
                }
                consecutiveFailures = 0
                schedule(timing.adoptedRecheckInterval) { [self] in attempt() }
                return
            }
            if adopted {
                adopted = false
                log("Adopted Core stopped answering — launching a new one")
            }
            launchOwnCore()
        }
    }

    private func launchOwnCore() {
        let startedAt = now()
        let started = launch { [self] status in
            log("Core exited with status \(status)")
            guard status != 0 else { return }
            if now().timeIntervalSince(startedAt) >= timing.stableRunDuration {
                consecutiveFailures = 0
            }
            scheduleRetry()
        }
        if !started { scheduleRetry() }
    }

    private func scheduleRetry() {
        consecutiveFailures += 1
        let delay = restartDelay(afterFailures: consecutiveFailures)
        log("Restarting in \(Int(delay))s...")
        schedule(delay) { [self] in attempt() }
    }

    func restartDelay(afterFailures failures: Int) -> TimeInterval {
        let exponent = Double(min(max(failures - 1, 0), 30))
        return min(timing.initialRestartDelay * pow(2, exponent), timing.maxRestartDelay)
    }
}

enum CoreLaunchLog {
    static let maxBytes: UInt64 = 5 * 1024 * 1024

    /// Moves an oversized log to `<name>.1` (replacing the previous one), so the launch log
    /// is bounded at roughly twice `maxBytes` on disk.
    static func rotateIfNeeded(at url: URL, maxBytes: UInt64 = maxBytes) {
        let fileManager = FileManager.default
        guard let size = (try? fileManager.attributesOfItem(atPath: url.path))?[.size] as? UInt64,
              size > maxBytes else { return }
        let rotatedURL = url.appendingPathExtension("1")
        try? fileManager.removeItem(at: rotatedURL)
        try? fileManager.moveItem(at: url, to: rotatedURL)
    }
}
