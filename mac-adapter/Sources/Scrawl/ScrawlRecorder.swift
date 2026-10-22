import AppKit

/// Owns one explicit screen-and-voice capture. Nothing is sent or filed on stop.
@MainActor
final class ScrawlRecorder {
    static let shared = ScrawlRecorder()
    // Legacy invocation entry points run on the main dispatch queue.
    nonisolated static var blocksInvocation: Bool { MainActor.assumeIsolated { shared.isActive } }
    private var lifecycle = ScrawlLifecycle()
    private var phase: ScrawlLifecycle.Phase { lifecycle.phase }
    var isActive: Bool { lifecycle.isActive }
    private var generation: UUID? { lifecycle.token }
    private var startedAt = 0.0
    private var duration = 0
    private var createdAt = Date()
    private var target: ScrawlManifest.Target?
    private var overlay: ScrawlOverlay?
    private var frames: [ScrawlBundleWriter.Frame] = []
    private var latest: CGImage?
    private var previousThumbnail: [UInt8] = []
    private var strokes: [ScrawlStroke] = []
    private var marks: [ScrawlMark] = []
    private var clicks: [ScrawlClick] = []
    private var segments: [Int: ScrawlSegment] = [:]
    private var relays: [Int: VoiceTranscriptionRelay] = [:]
    private var segmentEnds: [Int: Int] = [:]
    private var segmentIndex = 0
    private var transcriptionFailure: String?
    private var timer: Timer?
    private var finishTimeout: DispatchWorkItem?
    private var clickMonitor: Any?
    private var targetContext: DictationContextCapture?
    private var segmentBytes = 0

    private var elapsed: Int { max(0, Int((ProcessInfo.processInfo.systemUptime - startedAt) * 1000)) }

    /// Returns whether the press started or stopped a recording.
    func toggle() -> Bool {
        switch phase {
        case .idle: return start()
        case .recording: stop(); return true
        case .starting, .finishing: return false
        }
    }

    private func start() -> Bool {
        guard !isActive, FlydState.shared.mode == .present, FlydState.shared.phase == .idle,
              !VoiceCapture.shared.isActive, DictationController.shared.isIdle else {
            DictationPill.shared.show(.notice("Finish the current voice session first")); return false
        }
        let permissions = PermissionGate.shared
        guard permissions.hasScreenRecording else {
            permissions.requestScreenCapturePermission()
            DictationPill.shared.show(.failed("Allow Screen Recording, then press ⌃⌥S again")); return false
        }
        guard permissions.hasMicrophone else {
            permissions.requestMicrophonePermission()
            DictationPill.shared.show(.failed("Allow Microphone, then press ⌃⌥S again")); return false
        }
        guard permissions.hasAccessibility else {
            DictationPill.shared.show(.failed("Allow Accessibility to log recording clicks")); return false
        }
        guard let screen = NSScreen.screens.first(where: { $0.frame.contains(NSEvent.mouseLocation) }),
              let display = screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? UInt32,
              let token = lifecycle.begin() else { return false }
        startedAt = ProcessInfo.processInfo.systemUptime
        createdAt = Date()
        _ = FlydState.shared.startInvocation()
        FlydState.shared.transition(to: .capturing)
        let app = NSWorkspace.shared.frontmostApplication
        let bounds = CGDisplayBounds(display)
        target = .init(app: app?.localizedName ?? "Screen", bundleId: app?.bundleIdentifier ?? "unknown", displayId: display,
                       frame: .init(x: bounds.minX, y: bounds.minY, width: bounds.width, height: bounds.height, scale: screen.backingScaleFactor))
        targetContext = DictationContextCapture(pid: app?.processIdentifier ?? 0, bundleId: app?.bundleIdentifier ?? "unknown")
        Task { await record(token: token, display: display, screen: screen) }
        return true
    }

    private func record(token: UUID, display: UInt32, screen: NSScreen) async {
        do {
            try await ScreenCaptureManager.shared.startRecording(displayID: display, onFrame: { [weak self] image in
                guard let self, self.lifecycle.acceptsFrame(token) else { return }
                self.receive(image)
            }, onError: { [weak self] message in
                guard let self, self.lifecycle.accepts(token) else { return }
                self.fail("Screen recording stopped: \(message)")
            })
            guard lifecycle.didStart(token) else { return }
            let overlay = ScrawlOverlay(screen: screen)
            overlay.ink.now = { [weak self] in self?.elapsed ?? 0 }
            overlay.ink.onStroke = { [weak self] stroke in self?.marked(stroke) }
            overlay.onStop = { [weak self] in self?.stop() }
            overlay.onCancel = { [weak self] in self?.cancel() }
            self.overlay = overlay
            overlay.show()
            openSegment()
            VoiceCapture.shared.onAudioChunk = { [weak self] data in
                DispatchQueue.main.async {
                    guard let self, self.generation == token, case .recording = self.phase else { return }
                    self.relays[self.segmentIndex]?.sendAudioChunk(data)
                    self.segmentBytes += data.count
                    _ = VoiceCapture.shared.drainBuffer()
                    if self.segmentBytes >= 15 * 48_000 { self.commitSegment(); self.segmentIndex += 1; self.openSegment() }
                }
            }
            VoiceCapture.shared.onError = { [weak self] message in
                DispatchQueue.main.async {
                    guard self?.generation == token else { return }
                    self?.fail(message)
                }
            }
            guard VoiceCapture.shared.start(muteOutput: false) else { fail("Microphone unavailable"); return }
            clickMonitor = NSEvent.addGlobalMonitorForEvents(matching: [.leftMouseDown, .rightMouseDown, .otherMouseDown]) { [weak self] event in
                self?.clicked(event)
            }
            timer = Timer.scheduledTimer(withTimeInterval: 0.25, repeats: true) { [weak self] _ in
                Task { @MainActor in
                    guard let self else { return }
                    self.overlay?.updateTime(self.elapsed)
                    if self.elapsed >= 300_000 { self.stop() }
                }
            }
        } catch {
            guard lifecycle.accepts(token) else { return }
            fail(error.localizedDescription)
        }
    }

    private func openSegment() {
        let index = segmentIndex
        guard let token = generation else { return }
        segmentBytes = 0
        segments[index] = .init(t0: elapsed, t1: elapsed, text: "")
        let relay = VoiceTranscriptionRelay()
        relay.sessionIsCurrent = { [weak self] _ in self?.generation == token && self?.isActive == true }
        relay.onComplete = { [weak self] text in
            guard self?.generation == token else { return }
            self?.transcribed(index, text: text, error: nil)
        }
        relay.onError = { [weak self] message in
            guard self?.generation == token else { return }
            self?.transcribed(index, text: "", error: message)
        }
        relays[index] = relay
        let context = targetContext
        relay.connect(sessionId: index) { context?.startFields() ?? ["purpose": "dictation"] }
    }

    private func commitSegment() {
        segmentEnds[segmentIndex] = elapsed
        if segmentBytes == 0 {
            relays.removeValue(forKey: segmentIndex)?.disconnect()
            return
        }
        relays[segmentIndex]?.commitAudio()
    }

    private func transcribed(_ index: Int, text: String, error: String?) {
        guard let relay = relays.removeValue(forKey: index) else { return }
        relay.disconnect()
        if let error { transcriptionFailure = error }
        if var segment = segments[index] {
            segment.t1 = segmentEnds[index] ?? elapsed
            segment.text = text
            segments[index] = segment
        }
        if case .finishing = phase, relays.isEmpty { finish() }
    }

    private func receive(_ image: CGImage) {
        switch phase { case .starting, .recording: break; case .idle, .finishing: return }
        latest = image
        let thumb = ScrawlBundleWriter.thumbnail(image)
        let changed = ScrawlBundleWriter.sceneDifference(previousThumbnail, thumb) > 0.08
        if frames.isEmpty { select(image, reason: "initial") }
        else if changed, elapsed - (frames.last?.t ?? 0) >= 750 { select(image, reason: "scene_change") }
        previousThumbnail = thumb
    }

    private func select(_ image: CGImage, reason: String) {
        let frame = ScrawlBundleWriter.Frame(t: elapsed, image: image, reason: reason)
        if frames.count > 1, frame.t - (frames.last?.t ?? 0) < 750 {
            if reason != "scene_change" { frames[frames.count - 1] = frame }
            return
        }
        let budget = min(12, 6 + max(0, elapsed - 20_000) / 20_000)
        if frames.count >= budget {
            if let replace = frames.indices.dropFirst().first(where: { frames[$0].reason == "scene_change" }) {
                frames.remove(at: replace)
            } else if reason == "scene_change" { return }
            else if frames.count > 1 { frames.remove(at: 1) }
        }
        frames.append(frame)
    }

    private func marked(_ stroke: ScrawlStroke) {
        guard case .recording = phase else { return }
        let index = strokes.count
        strokes.append(stroke)
        let xs = stride(from: 0, to: stroke.pts.count - 2, by: 3).map { Double(stroke.pts[$0]) / 10_000 }
        let ys = stride(from: 1, to: stroke.pts.count - 1, by: 3).map { Double(stroke.pts[$0]) / 10_000 }
        let box: [Double] = [xs.min() ?? 0, ys.min() ?? 0, xs.max() ?? 0, ys.max() ?? 0]
        if let last = marks.last, stroke.t0 - last.t1 <= 1200, last.strokes.count < 6,
           !(clicks.last.map { $0.t >= last.t1 } ?? false) {
            let i = marks.count - 1
            marks[i].strokes.append(index)
            marks[i].t1 = stroke.t1
            marks[i].boxNorm = [min(last.boxNorm[0], box[0]), min(last.boxNorm[1], box[1]), max(last.boxNorm[2], box[2]), max(last.boxNorm[3], box[3])]
        } else {
            marks.append(.init(id: "m\(marks.count + 1)", strokes: [index], t0: stroke.t0, t1: stroke.t1, boxNorm: box))
        }
        if let latest { select(latest, reason: "mark") }
    }

    private func clicked(_ event: NSEvent) {
        guard case .recording = phase, let target else { return }
        let location = event.cgEvent?.location ?? .zero
        let frame = target.frame
        let x = (location.x - frame.x) / frame.width
        let y = (location.y - frame.y) / frame.height
        guard (0...1).contains(x), (0...1).contains(y) else { return }
        clicks.append(.init(t: elapsed, x: x, y: y, button: event.type == .rightMouseDown ? "right" : "left"))
        let token = generation
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) { [weak self] in
            guard let self, self.generation == token, case .recording = self.phase, let image = self.latest else { return }
            self.select(image, reason: "click")
        }
    }

    func stop() {
        guard case .recording = phase else { return }
        overlay?.ink.finishStroke()
        duration = elapsed
        if let latest { select(latest, reason: "scene_change") }
        commitSegment()
        guard lifecycle.stop() else { return }
        stopCapture()
        DictationPill.shared.show(.notice("Preparing recording…"))
        if relays.isEmpty { finish(); return }
        let timeout = DispatchWorkItem { [weak self] in
            guard let self, case .finishing = self.phase else { return }
            self.transcriptionFailure = "Some audio could not be transcribed before the timeout."
            self.finish()
        }
        finishTimeout = timeout
        DispatchQueue.main.asyncAfter(deadline: .now() + 30, execute: timeout)
    }

    private func finish() {
        guard case .finishing = phase, let target else { return }
        let ordered = segments.keys.sorted().compactMap { segments[$0] }.filter { !$0.text.isEmpty }
        let manifest = ScrawlManifest(id: "flyd-\(UUID().uuidString.lowercased())", createdAtMs: Int(createdAt.timeIntervalSince1970 * 1000), durationMs: duration,
                                      target: target, transcript: .init(text: ordered.map(\.text).joined(separator: " "), segments: ordered,
                                                                        missing: transcriptionFailure.map { .init(reason: $0) }),
                                      strokes: strokes, marks: marks, events: clicks, keyframes: [])
        do {
            let directory = try ScrawlBundleWriter.write(manifest: manifest, frames: frames)
            let sheet = try Data(contentsOf: directory.appendingPathComponent("contact-sheet.png"))
            ConversationWindow.shared.attachScrawl(path: directory.path, sheet: sheet)
            teardown()
            DictationPill.shared.show(.notice("Recording attached. Ready when you are."))
        } catch { fail("Could not save recording: \(error.localizedDescription)") }
    }

    func cancel() { guard isActive else { return }; teardown(); DictationPill.shared.hide() }
    private func fail(_ message: String) { teardown(); DictationPill.shared.show(.failed(message)) }
    private func stopCapture() {
        timer?.invalidate(); timer = nil
        if let clickMonitor { NSEvent.removeMonitor(clickMonitor) }; clickMonitor = nil
        overlay?.close(); overlay = nil
        ScreenCaptureManager.shared.stop()
        VoiceCapture.shared.stop()
        VoiceCapture.shared.onAudioChunk = nil
        VoiceCapture.shared.onError = nil
    }
    private func teardown() {
        lifecycle.end()
        stopCapture()
        finishTimeout?.cancel(); finishTimeout = nil
        for relay in relays.values { relay.disconnect() }
        relays = [:]; segments = [:]; segmentEnds = [:]
        frames = []; strokes = []; marks = []; clicks = []; latest = nil; previousThumbnail = []
        targetContext = nil; target = nil; transcriptionFailure = nil; segmentIndex = 0
        InvocationStateMachine.shared.endDictationGesture()
        FlydState.shared.cancelInvocation()
    }
}
