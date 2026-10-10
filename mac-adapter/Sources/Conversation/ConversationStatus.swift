import AppKit
import Foundation

/// What the view server's /api/status feed says about the conversation.
struct ConversationStatusPayload: Decodable, Equatable {
    struct Reply: Decodable, Equatable {
        let id: String
        let headline: String
        let asks: Bool
    }
    /// His newest message still waiting for its answer, and the line the window shows under it.
    struct Waiting: Decodable, Equatable {
        let id: String
        let text: String
        /// The line says the answer failed, not that work is under way.
        let failed: Bool?

        /// "Firstmate is on it: run the tests" and "Firstmate is on it - GNM" are the stage "Firstmate is on it"; neither the step nor the project is news.
        var stage: String {
            let cut = [": ", " - "].compactMap { text.range(of: $0)?.lowerBound }.min()
            return cut.map { String(text[..<$0]) } ?? text
        }
    }
    let session: String
    let working: Bool
    let reply: Reply?
    let waiting: Waiting?
}

/// What the island should do for a status change. Pure, so it is testable.
enum ConversationStatusDecision: Equatable {
    case none
    case showWorking
    case clearWorking
    case announce(String, DictationPill.StatusTone)

    /// `previous` nil means this is the first reading of a session: it sets the
    /// baseline and announces nothing old.
    static func decide(previous: ConversationStatusPayload?, current: ConversationStatusPayload) -> [ConversationStatusDecision] {
        var decisions: [ConversationStatusDecision] = []
        let newSession = previous?.session != current.session
        if !newSession, let reply = current.reply, reply.id != previous?.reply?.id {
            decisions.append(reply.asks ? .announce("Needs you: \(reply.headline)", .decision) : .announce(reply.headline, .reply))
        }
        // The window's living line, mirrored briefly: once per message and stage, never per step.
        // A new reply is the news; its headline is never overwritten by the line.
        if !newSession, decisions.isEmpty, let waiting = current.waiting,
           waiting.id != previous?.waiting?.id || waiting.stage != previous?.waiting?.stage {
            decisions.append(.announce(waiting.text, waiting.failed == true ? .reply : .progress))
        }
        if current.working {
            if previous?.working != true || newSession { decisions.append(.showWorking) }
        } else if previous?.working == true {
            decisions.append(.clearWorking)
        }
        return decisions.isEmpty ? [.none] : decisions
    }
}

/// The firstmate conversation at a glance in the notch island: working,
/// sent, what is happening to his message, reply ready, needs your decision. Never takes focus; a click opens
/// the Conversation window. Dictation and voice keep priority over it.
final class ConversationStatus: NSObject, URLSessionDataDelegate {
    static let shared = ConversationStatus()

    private let island = DictationPill.shared
    private var session: URLSession?
    private var task: URLSessionDataTask?
    private var baseURL: URL?
    private var buffer = ""
    private var last: ConversationStatusPayload?
    private var working = false
    /// An announcement that arrived while dictation was using the island.
    private var pending: (String, DictationPill.StatusTone)?
    private var timer: Timer?

    /// Working shows only the island's small spinning glyph.
    static let workingText = ""

    func start(serverURL: URL) {
        island.onStatusClick = { ConversationWindow.shared.show() }
        guard serverURL != baseURL else { return }
        baseURL = serverURL
        last = nil
        connect()
        if timer == nil {
            let timer = Timer(timeInterval: 2, repeats: true) { [weak self] _ in self?.reassert() }
            RunLoop.main.add(timer, forMode: .common)
            self.timer = timer
        }
    }

    /// A message went out from the Conversation (typed or push-to-talk).
    func sent() {
        announce("Sent", .sent)
    }

    // MARK: - Feed

    private func connect() {
        task?.cancel()
        guard let baseURL, let url = URL(string: "api/status", relativeTo: baseURL) else { return }
        if session == nil {
            let configuration = URLSessionConfiguration.ephemeral
            configuration.timeoutIntervalForRequest = 120
            configuration.timeoutIntervalForResource = .greatestFiniteMagnitude
            session = URLSession(configuration: configuration, delegate: self, delegateQueue: .main)
        }
        buffer = ""
        task = session?.dataTask(with: url)
        task?.resume()
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        guard dataTask === task, let text = String(data: data, encoding: .utf8) else { return }
        buffer += text
        while let end = buffer.range(of: "\n\n") {
            let event = String(buffer[..<end.lowerBound])
            buffer = String(buffer[end.upperBound...])
            guard event.contains("event: status"),
                  let line = event.split(separator: "\n").first(where: { $0.hasPrefix("data: ") }),
                  let payload = try? JSONDecoder().decode(ConversationStatusPayload.self, from: Data(line.dropFirst(6).utf8))
            else { continue }
            apply(payload)
        }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        guard task === self.task else { return }
        // The server restarts or the session changes: reconnect shortly.
        DispatchQueue.main.asyncAfter(deadline: .now() + 3) { [weak self] in self?.connect() }
    }

    // MARK: - Island

    func apply(_ payload: ConversationStatusPayload) {
        for decision in ConversationStatusDecision.decide(previous: last, current: payload) {
            if decision != .none { ConversationServer.appendLog("island: \(decision)") }
            switch decision {
            case .none:
                break
            case .showWorking:
                working = true
                showWorkingIfIdle()
            case .clearWorking:
                working = false
                if case .status(_, .working) = island.currentPhase { island.hide() }
            case .announce(let text, let tone):
                announce(text, tone)
            }
        }
        last = payload
    }

    private func announce(_ text: String, _ tone: DictationPill.StatusTone) {
        // The captain is reading the conversation already.
        if ConversationWindow.shared.isKeyAndVisible { return }
        if island.isBusyWithVoice {
            pending = (text, tone)
            return
        }
        island.show(.status(text, tone))
    }

    private func showWorkingIfIdle() {
        guard working, !island.isBusyWithVoice, !ConversationWindow.shared.isKeyAndVisible else { return }
        if island.currentPhase == nil { island.show(.status(Self.workingText, .working)) }
    }

    /// After dictation hands the island back: say what was waiting, or that firstmate is still working.
    private func reassert() {
        guard !island.isBusyWithVoice else { return }
        if let (text, tone) = pending {
            pending = nil
            announce(text, tone)
            return
        }
        showWorkingIfIdle()
    }
}
