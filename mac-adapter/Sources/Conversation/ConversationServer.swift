import Darwin
import Foundation

/// Runs `flyd view` (the conversation view server, TypeScript Core) for the
/// Conversation window: on a free loopback port, restarted if it dies,
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

        let chosen = (port.flatMap { Self.isFree($0) ? $0 : nil }) ?? Self.freeLoopbackPort(preferred: Self.preferredPort)
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
                Self.appendLog("conversation view exited (\(finished.terminationStatus)); restarting in 2s")
                self.queue.asyncAfter(deadline: .now() + 2) { self.launch() }
            }
        }

        do {
            try process.run()
            self.process = process
            Self.appendLog("conversation view starting on 127.0.0.1:\(chosen) (pid \(process.processIdentifier), cwd \(cliDir))")
            waitUntilReady(port: chosen, process: process)
        } catch {
            fail("Could not start the conversation view: \(error.localizedDescription)")
        }
    }

    private func waitUntilReady(port: Int, process: Process, attempt: Int = 0) {
        guard let probe = URL(string: "http://127.0.0.1:\(port)/api/sessions") else { return }
        var request = URLRequest(url: probe)
        request.timeoutInterval = 2
        URLSession.shared.dataTask(with: request) { [weak self] _, response, _ in
            guard let self else { return }
            self.queue.async {
                guard self.process === process, !self.stopping else { return }
                if (response as? HTTPURLResponse)?.statusCode == 200 {
                    let url = URL(string: "http://127.0.0.1:\(port)/")!
                    self.url = url
                    DispatchQueue.main.async { self.onReady?(url) }
                } else if attempt < 120 {
                    self.queue.asyncAfter(deadline: .now() + 0.25) { self.waitUntilReady(port: port, process: process, attempt: attempt + 1) }
                } else {
                    Self.appendLog("conversation view did not answer on port \(port)")
                }
            }
        }.resume()
    }

    private func fail(_ message: String) {
        Self.appendLog(message)
        DispatchQueue.main.async { self.onFailure?(message) }
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
        let handle = (try? FileHandle(forWritingTo: logURL)) ?? FileHandle.nullDevice
        handle.seekToEndOfFile()
        return handle
    }

    static func appendLog(_ message: String) {
        print("[Flyd] \(message)")
        guard let data = "[\(ISO8601DateFormatter().string(from: Date()))] \(message)\n".data(using: .utf8) else { return }
        let handle = logHandle()
        handle.write(data)
        try? handle.close()
    }
}
