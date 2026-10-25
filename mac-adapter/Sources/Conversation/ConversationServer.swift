import Darwin
import Foundation

/// When the conversation view is relaunched and when a running one counts as gone.
/// Pure, so the backoff is testable without a process.
struct ConversationRestartPolicy {
    var initialDelay: TimeInterval = 2
    var maxDelay: TimeInterval = 60
    /// A view that ran at least this long before exiting restarts from the initial delay.
    var stableRunDuration: TimeInterval = 60
    /// How long a started view may take to answer before it is replaced.
    var readyDeadline: TimeInterval = 180
    /// How often a ready view is asked whether it still answers.
    var livenessInterval: TimeInterval = 30
    /// Missed liveness checks in a row before the view is replaced.
    var livenessMisses = 3
    /// How long a view asked to stop may linger before it is killed.
    var killGrace: TimeInterval = 5

    /// The wait before relaunch number `failures` (1-based): doubling, capped.
    func delay(afterFailures failures: Int) -> TimeInterval {
        let exponent = Double(min(max(failures - 1, 0), 30))
        return min(initialDelay * pow(2, exponent), maxDelay)
    }

    /// The failure count after an exit: a long, healthy run starts the count again.
    func failures(after previous: Int, ranFor duration: TimeInterval) -> Int {
        duration >= stableRunDuration ? 1 : previous + 1
    }
}

/// Runs `flyd view` (the conversation view server, TypeScript Core) for the
/// Conversation window: on a free loopback port, relaunched with backoff
/// whenever it exits (cleanly or not), fails to start, or stops answering,
/// stopped when Flyd quits. The captain never touches a terminal.
final class ConversationServer {
    static let shared = ConversationServer()

    /// Called on the main queue whenever the server is up at a (new) URL.
    var onReady: ((URL) -> Void)?
    /// Called on the main queue when the server cannot run at all.
    var onFailure: ((String) -> Void)?

    private let queue = DispatchQueue(label: "flyd.conversation-server")
    private var process: Process?
    private var port: Int?
    private var stopping = false
    private var nodePath: String?
    private(set) var url: URL?
    private let policy = ConversationRestartPolicy()
    /// Exits, failed launches and unanswered starts since the last healthy run.
    private var consecutiveFailures = 0
    private var startedAt = Date()
    private var relaunchScheduled = false

    static let preferredPort = 4818
    static let logURL = FileManager.default.homeDirectoryForCurrentUser
        .appendingPathComponent(".flyd/overlay/conversation-view.log", isDirectory: false)

    /// FLYD_VIEW_CLI_DIR overrides where the view runs from (e.g. a branch
    /// checkout); otherwise the same cli/ Core runs from.
    static func cliDirectory(environment: [String: String] = ProcessInfo.processInfo.environment) -> String {
        if let dir = environment["FLYD_VIEW_CLI_DIR"], !dir.isEmpty { return dir }
        return resolveCliDir()
    }

    /// One node process: tsx is loaded in-process, so terminating it stops the server.
    static func arguments(port: Int) -> [String] {
        ["--import", "tsx", "src/entry.ts", "view", "--no-open", "--port", String(port)]
    }

    func start() {
        queue.async { self.stopping = false; self.launch() }
    }

    func stop() {
        queue.sync {
            stopping = true
            process?.terminate()
            process = nil
        }
    }

    private func launch() {
        guard !stopping, process == nil else { return }
        let cliDir = Self.cliDirectory()
        guard FileManager.default.fileExists(atPath: cliDir + "/src/conversation-view/server.ts") else {
            fail("This Flyd checkout (\(cliDir)) has no conversation view yet.")
            return
        }
        guard let node = nodePath ?? Self.findNode() else {
            fail("Node.js was not found on your login shell's PATH.")
            return
        }
        nodePath = node

        // 4818 whenever it is free: a start that found it still held by the old
        // view must not keep the fallback port for the rest of the session.
        let chosen = (Self.isFree(Self.preferredPort) ? Self.preferredPort : nil)
            ?? (port.flatMap { Self.isFree($0) ? $0 : nil })
            ?? Self.freeLoopbackPort(preferred: Self.preferredPort)
        guard let chosen else {
            fail("No free local port for the conversation view.")
            return
        }
        port = chosen

        let process = Process()
        process.executableURL = URL(fileURLWithPath: node)
        process.arguments = Self.arguments(port: chosen)
        process.currentDirectoryURL = URL(fileURLWithPath: cliDir)
        var environment = ProcessInfo.processInfo.environment
        environment["FLYD_VIEW_PARENT_PID"] = String(getpid())
        let nodeDir = (node as NSString).deletingLastPathComponent
        environment["PATH"] = "\(nodeDir):\(environment["PATH"] ?? "/usr/bin:/bin")"
        process.environment = environment
        let log = Self.logHandle()
        process.standardOutput = log
        process.standardError = log
        process.terminationHandler = { [weak self] finished in
            guard let self else { return }
            self.queue.async {
                guard self.process === finished else { return }
                self.process = nil
                guard !self.stopping else { return }
                let how = finished.terminationReason == .uncaughtSignal
                    ? "killed by signal \(finished.terminationStatus)"
                    : "exited (\(finished.terminationStatus))"
                let ran = Date().timeIntervalSince(self.startedAt)
                self.consecutiveFailures = self.policy.failures(after: self.consecutiveFailures, ranFor: ran)
                self.scheduleRelaunch("conversation view \(how) after \(Int(ran))s")
            }
        }

        do {
            try process.run()
            self.process = process
            startedAt = Date()
            Self.appendLog("conversation view starting on 127.0.0.1:\(chosen) (pid \(process.processIdentifier), cwd \(cliDir))")
            waitUntilReady(port: chosen, process: process)
        } catch {
            fail("Could not start the conversation view: \(error.localizedDescription)")
        }
    }

    /// Relaunches after the policy's backoff; one relaunch is pending at a time.
    private func scheduleRelaunch(_ why: String) {
        guard !stopping, !relaunchScheduled else { return }
        relaunchScheduled = true
        let delay = policy.delay(afterFailures: max(consecutiveFailures, 1))
        Self.appendLog("\(why); restarting in \(Int(delay))s")
        queue.asyncAfter(deadline: .now() + delay) {
            self.relaunchScheduled = false
            self.launch()
        }
    }

    /// Asks the view whether it answers; calls back on the server queue.
    private func probe(port: Int, timeout: TimeInterval, _ done: @escaping (Bool) -> Void) {
        guard let url = URL(string: "http://127.0.0.1:\(port)/api/sessions") else { return }
        var request = URLRequest(url: url)
        request.timeoutInterval = timeout
        URLSession.shared.dataTask(with: request) { [weak self] _, response, _ in
            self?.queue.async { done((response as? HTTPURLResponse)?.statusCode == 200) }
        }.resume()
    }

    /// Polls until the view answers, never giving up on a live process: a slow
    /// start (a loaded machine compiling tsx) still reaches the window. A view
    /// that has not answered by the deadline is replaced.
    private func waitUntilReady(port: Int, process: Process, attempt: Int = 0) {
        probe(port: port, timeout: 2) { [weak self] answered in
            guard let self, self.process === process, !self.stopping else { return }
            if answered {
                let url = URL(string: "http://127.0.0.1:\(port)/")!
                self.url = url
                if attempt >= 120 { Self.appendLog("conversation view answered on port \(port) after a slow start") }
                DispatchQueue.main.async { self.onReady?(url) }
                self.watch(port: port, process: process)
                return
            }
            if attempt == 120 { Self.appendLog("conversation view not answering on port \(port) yet; still waiting") }
            if Date().timeIntervalSince(self.startedAt) >= self.policy.readyDeadline {
                self.replace(process, why: "conversation view never answered on port \(port)")
                return
            }
            let wait: TimeInterval = attempt < 120 ? 0.25 : 2
            self.queue.asyncAfter(deadline: .now() + wait) { self.waitUntilReady(port: port, process: process, attempt: attempt + 1) }
        }
    }

    /// While the view runs, checks it still answers: a process that stopped
    /// serving without exiting (stuck event loop, lingering after SIGTERM) is
    /// replaced instead of leaving the window dead until the app restarts.
    private func watch(port: Int, process: Process, misses: Int = 0) {
        queue.asyncAfter(deadline: .now() + policy.livenessInterval) { [weak self] in
            guard let self, self.process === process, !self.stopping else { return }
            if misses == 0, Date().timeIntervalSince(self.startedAt) >= self.policy.stableRunDuration {
                self.consecutiveFailures = 0
            }
            self.probe(port: port, timeout: 10) { answered in
                guard self.process === process, !self.stopping else { return }
                if answered {
                    if misses > 0 { Self.appendLog("conversation view on port \(port) answering again") }
                    self.watch(port: port, process: process)
                } else if misses + 1 >= self.policy.livenessMisses {
                    self.replace(process, why: "conversation view stopped answering on port \(port)")
                } else {
                    Self.appendLog("conversation view on port \(port) did not answer (\(misses + 1)/\(self.policy.livenessMisses))")
                    self.watch(port: port, process: process, misses: misses + 1)
                }
            }
        }
    }

    /// Stops a view that no longer serves; its exit relaunches it. One that
    /// ignores SIGTERM is killed after a grace period.
    private func replace(_ process: Process, why: String) {
        Self.appendLog("\(why); stopping pid \(process.processIdentifier) to restart it")
        process.terminate()
        let pid = process.processIdentifier
        queue.asyncAfter(deadline: .now() + policy.killGrace) {
            guard process.isRunning else { return }
            Self.appendLog("conversation view pid \(pid) ignored SIGTERM; killing it")
            kill(pid, SIGKILL)
        }
    }

    /// A launch that could not happen is retried with backoff, not abandoned.
    private func fail(_ message: String) {
        DispatchQueue.main.async { self.onFailure?(message) }
        consecutiveFailures += 1
        scheduleRelaunch(message)
    }


    // MARK: - Helpers

    /// GUI apps get a minimal PATH; ask a login shell where node lives, as Core's launch does.
    static func findNode() -> String? {
        let shell = Process()
        shell.executableURL = URL(fileURLWithPath: "/bin/zsh")
        shell.arguments = ["-l", "-c", "command -v node"]
        let pipe = Pipe()
        shell.standardOutput = pipe
        shell.standardError = FileHandle.nullDevice
        do { try shell.run() } catch { return nil }
        shell.waitUntilExit()
        let output = String(data: pipe.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8)?
            .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let path = output.split(separator: "\n").last.map(String.init) ?? ""
        return path.hasPrefix("/") && FileManager.default.isExecutableFile(atPath: path) ? path : nil
    }

    /// True when nothing listens on 127.0.0.1:port.
    static func isFree(_ port: Int) -> Bool {
        bindLoopback(port: port) != nil
    }

    /// The preferred port when free, else one the system assigns.
    static func freeLoopbackPort(preferred: Int) -> Int? {
        if preferred > 0, isFree(preferred) { return preferred }
        return bindLoopback(port: 0)
    }

    private static func bindLoopback(port: Int) -> Int? {
        let fd = socket(AF_INET, SOCK_STREAM, 0)
        guard fd >= 0 else { return nil }
        defer { close(fd) }
        // As node binds: a port with only TIME_WAIT leftovers counts as free.
        var reuse: Int32 = 1
        setsockopt(fd, SOL_SOCKET, SO_REUSEADDR, &reuse, socklen_t(MemoryLayout<Int32>.size))
        var address = sockaddr_in()
        address.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
        address.sin_family = sa_family_t(AF_INET)
        address.sin_port = in_port_t(UInt16(port).bigEndian)
        address.sin_addr = in_addr(s_addr: inet_addr("127.0.0.1"))
        let bound = withUnsafePointer(to: &address) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { bind(fd, $0, socklen_t(MemoryLayout<sockaddr_in>.size)) }
        }
        guard bound == 0 else { return nil }
        var assigned = sockaddr_in()
        var length = socklen_t(MemoryLayout<sockaddr_in>.size)
        let named = withUnsafeMutablePointer(to: &assigned) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { getsockname(fd, $0, &length) }
        }
        guard named == 0 else { return nil }
        return Int(UInt16(bigEndian: assigned.sin_port))
    }

    private static func logHandle() -> FileHandle {
        try? FileManager.default.createDirectory(at: logURL.deletingLastPathComponent(), withIntermediateDirectories: true)
        if !FileManager.default.fileExists(atPath: logURL.path) {
            FileManager.default.createFile(atPath: logURL.path, contents: nil)
        }
        // O_APPEND: the view's own output and these lines share the file; with a plain
        // write offset each writer overwrote the other's lines.
        let fd = open(logURL.path, O_WRONLY | O_APPEND | O_CREAT, 0o644)
        guard fd >= 0 else { return FileHandle.nullDevice }
        return FileHandle(fileDescriptor: fd, closeOnDealloc: true)
    }

    static func appendLog(_ message: String) {
        print("[Flyd] \(message)")
        guard let data = "[\(ISO8601DateFormatter().string(from: Date()))] \(message)\n".data(using: .utf8) else { return }
        let handle = logHandle()
        handle.write(data)
        try? handle.close()
    }
}
