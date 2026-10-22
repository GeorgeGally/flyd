import AppKit
import Testing
@testable import FlydMacAdapter

struct ScrawlTests {
    @Test func stopWaitsForTranscriptAndRevokesFramesUntilCompletion() throws {
        var lifecycle = ScrawlLifecycle()
        let begun = lifecycle.begin()
        let token = try #require(begun)
        #expect(lifecycle.phase == .starting)
        let refusedBegin = lifecycle.begin()
        #expect(refusedBegin == nil)
        let started = lifecycle.didStart(token)
        #expect(started)
        #expect(lifecycle.acceptsFrame(token))
        let stopped = lifecycle.stop()
        #expect(stopped)
        #expect(lifecycle.phase == .finishing)
        #expect(!lifecycle.acceptsFrame(token))
        #expect(lifecycle.accepts(token))
        let duplicateStop = lifecycle.stop()
        #expect(!duplicateStop)
        let refusedDuringFinish = lifecycle.begin()
        #expect(refusedDuringFinish == nil)
        lifecycle.end()
        #expect(!lifecycle.accepts(token))
        #expect(!lifecycle.isActive)
    }

    @Test func cancelledStartupCannotReviveOrStopANewerRecording() throws {
        var lifecycle = ScrawlLifecycle()
        let first = lifecycle.begin()
        let cancelled = try #require(first)
        lifecycle.end()
        let second = lifecycle.begin()
        let current = try #require(second)
        let lateStartup = lifecycle.didStart(cancelled)
        #expect(!lateStartup)
        #expect(!lifecycle.accepts(cancelled))
        #expect(!lifecycle.acceptsFrame(cancelled))
        #expect(lifecycle.phase == .starting)
        let started = lifecycle.didStart(current)
        #expect(started)
        #expect(lifecycle.acceptsFrame(current))
        lifecycle.end()
        #expect(!lifecycle.accepts(current))
        #expect(lifecycle.phase == .idle)
    }

    @Test @MainActor func cancellingAnIdleRecorderDoesNotCancelAnotherInvocation() {
        let state = FlydState.shared
        let invocation = state.startInvocation().invocationId
        defer { state.cancelInvocation() }
        ScrawlRecorder.shared.cancel()
        #expect(state.invocationId == invocation)
        #expect(state.mode == .invoked)
    }

    @Test func shortcutTogglesOncePerPressAndDoesNotMatchOtherChords() {
        var state = ShortcutRoutingState()
        let chord: CGEventFlags = [.maskControl, .maskAlternate]
        #expect(ShortcutRouter.route(eventType: .keyDown, flags: chord, keyCode: 1, state: &state) == [.scrawlToggle])
        #expect(ShortcutRouter.route(eventType: .keyDown, flags: chord, keyCode: 1, state: &state).isEmpty)
        #expect(ShortcutRouter.route(eventType: .keyUp, flags: [], keyCode: 1, state: &state).isEmpty)
        #expect(ShortcutRouter.route(eventType: .keyDown, flags: chord, keyCode: 1, state: &state) == [.scrawlToggle])
        #expect(ShortcutRouter.route(eventType: .keyDown, flags: chord.union(.maskCommand), keyCode: 1, state: &state).isEmpty)
        #expect(ShortcutRouter.route(eventType: .keyDown, flags: [.maskAlternate, .maskShift], keyCode: 1, state: &state).isEmpty)
        var filter = KeyEventFilter()
        let dropped1 = filter.shouldDrop(eventType: .keyDown, keyCode: 1, flags: chord, routed: [.scrawlToggle])
        #expect(dropped1)
        let dropped2 = filter.shouldDrop(eventType: .keyUp, keyCode: 1, flags: [], routed: [])
        #expect(dropped2)
        let dropped3 = !filter.shouldDrop(eventType: .keyDown, keyCode: 1, flags: [], routed: [])
        #expect(dropped3)
        let ignoredPress = filter.shouldDrop(eventType: .keyDown, keyCode: 1, flags: chord, routed: [])
        let ignoredRelease = filter.shouldDrop(eventType: .keyUp, keyCode: 1, flags: chord, routed: [])
        #expect(!ignoredPress && !ignoredRelease)
    }

    @Test func shortcutPressesDoNotCountTowardControlTriple() {
        var state = ShortcutRoutingState()
        var events: [ShortcutRouteEvent] = []
        for start in [0.0, 0.2] {
            events += ShortcutRouter.route(eventType: .flagsChanged, flags: [.maskControl], state: &state, now: start)
            events += ShortcutRouter.route(eventType: .flagsChanged, flags: [.maskControl, .maskAlternate], state: &state, now: start + 0.02)
            events += ShortcutRouter.route(eventType: .keyDown, flags: [.maskControl, .maskAlternate], keyCode: 1, state: &state, now: start + 0.04)
            events += ShortcutRouter.route(eventType: .keyUp, flags: [.maskControl, .maskAlternate], keyCode: 1, state: &state, now: start + 0.06)
            events += ShortcutRouter.route(eventType: .flagsChanged, flags: [.maskControl], state: &state, now: start + 0.08)
            events += ShortcutRouter.route(eventType: .flagsChanged, flags: [], state: &state, now: start + 0.1)
        }
        events += ShortcutRouter.route(eventType: .flagsChanged, flags: [.maskControl], state: &state, now: 0.35)
        events += ShortcutRouter.route(eventType: .flagsChanged, flags: [], state: &state, now: 0.37)
        #expect(events == [.scrawlToggle, .scrawlToggle])
    }

    @Test func sceneChangesIgnoreIdenticalFramesAndCatchLocalizedChanges() {
        let base = [UInt8](repeating: 0, count: 2304)
        #expect(ScrawlBundleWriter.sceneDifference(base, base) == 0)
        var changed = base
        for y in 0..<6 { for x in 0..<32 { changed[y * 64 + x] = 255 } }
        #expect(ScrawlBundleWriter.sceneDifference(base, changed) > 0.9)
    }

    @Test @MainActor func bundleHasNativePngFramesTimelineAndCamelCaseManifest() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let bitmap = try #require(NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: 320, pixelsHigh: 200, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0))
        let context = try #require(NSGraphicsContext(bitmapImageRep: bitmap))
        NSGraphicsContext.saveGraphicsState()
        NSGraphicsContext.current = context
        NSColor.white.setFill(); NSRect(x: 0, y: 0, width: 320, height: 200).fill()
        NSGraphicsContext.restoreGraphicsState()
        let image = try #require(bitmap.cgImage)
        let manifest = ScrawlManifest(id: "sample", createdAtMs: 1000, durationMs: 5000,
                                     target: .init(app: "Test", bundleId: "test", displayId: 1, frame: .init(x: 0, y: 0, width: 320, height: 200, scale: 1)),
                                     transcript: .init(text: "Fix this", segments: [.init(t0: 1000, t1: 4000, text: "Fix this")]),
                                     strokes: [.init(t0: 2000, t1: 3000, fw: 320, fh: 200, pts: [1000, 2000, 0, 8000, 2000, 1000])],
                                     marks: [.init(id: "m1", strokes: [0], t0: 2000, t1: 3000, boxNorm: [0.1, 0.2, 0.8, 0.2])],
                                     events: [.init(t: 4000, x: 0.5, y: 0.5, button: "left")], keyframes: [])
        let directory = try ScrawlBundleWriter.write(manifest: manifest, frames: [.init(t: 5000, image: image, reason: "mark")], to: root)
        let saved = try JSONDecoder().decode(ScrawlManifest.self, from: Data(contentsOf: directory.appendingPathComponent("scrawl.json")))
        #expect(saved.durationMs == 5000)
        #expect(saved.strokes[0].pts == [1000, 2000, 0, 8000, 2000, 1000])
        #expect(saved.events[0].kind == "click")
        #expect(saved.keyframes[0].said == "Fix this")
        let summary = try String(contentsOf: directory.appendingPathComponent("summary.md"))
        #expect(summary.contains("[0:01–0:04] Fix this"))
        #expect(summary.contains("[0:04] left click"))
        #expect(summary.contains("Mark m1: 1 stroke(s)"))
        let frame = try #require(NSImage(contentsOf: directory.appendingPathComponent("frames/frame-01.png")))
        #expect(frame.size.width == 320)
        let sheet = try #require(NSImage(contentsOf: directory.appendingPathComponent("contact-sheet.png")))
        #expect(sheet.size.width == 640)
        #expect(!FileManager.default.fileExists(atPath: root.appendingPathComponent(".sample.partial").path))
    }
}
