import ScreenCaptureKit
import CoreGraphics
import AppKit

final class ScreenCaptureManager {
    static let shared = ScreenCaptureManager()

    var isCapturing: Bool {
        stream != nil
    }

    private(set) var capturedDisplayID: String?
    private(set) var capturedDisplayBounds: CGRect?

    private var stream: SCStream?
    private var streamOutput: CaptureOutput?

    func captureScreenshot() async -> CGImage? {
        guard PermissionGate.shared.hasScreenRecording else { return nil }

        stop()

        let content = try? await SCShareableContent.current
        guard let content, let display = content.displays.first else { return nil }

        capturedDisplayID = "\(display.displayID)"
        let bounds = CGDisplayBounds(display.displayID)
        capturedDisplayBounds = bounds

        let excludedWindows = content.windows.filter { window in
            guard let bundleId = window.owningApplication?.bundleIdentifier else { return false }
            return ApplicationMonitor.shared.excludedBundleIds.contains(bundleId)
        }

        let filter = SCContentFilter(display: display, excludingWindows: excludedWindows)
        let config = SCStreamConfiguration()
        config.width = 1280
        config.height = Int(CGFloat(1280) * (CGFloat(display.height) / CGFloat(display.width)))
        config.pixelFormat = kCVPixelFormatType_32BGRA
        config.scalesToFit = true
        config.queueDepth = 1

        return await withUnsafeContinuation { continuation in
            var resumed = false
            let resume: (CGImage?) -> Void = { [weak self] image in
                guard !resumed else { return }
                resumed = true
                self?.stop()
                continuation.resume(returning: image)
            }

            let output = CaptureOutput { resume($0) }

            let stream = SCStream(filter: filter, configuration: config, delegate: nil)
            do {
                try stream.addStreamOutput(output, type: .screen, sampleHandlerQueue: .main)
                stream.startCapture()
            } catch {
                resume(nil)
                return
            }

            self.stream = stream
            self.streamOutput = output

            DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) {
                resume(output.lastImage)
            }
        }
    }

    /// Explicit recording only. The selected display stays fixed for the session.
    func startRecording(displayID: CGDirectDisplayID, onFrame: @escaping (CGImage) -> Void) async throws {
        guard PermissionGate.shared.hasScreenRecording else {
            throw NSError(domain: "Flyd.Scrawl", code: 1, userInfo: [NSLocalizedDescriptionKey: "Screen Recording permission required"])
        }
        guard stream == nil else {
            throw NSError(domain: "Flyd.Scrawl", code: 2, userInfo: [NSLocalizedDescriptionKey: "Screen capture is already in use"])
        }
        let content = try await SCShareableContent.current
        guard let display = content.displays.first(where: { $0.displayID == displayID }) else {
            throw NSError(domain: "Flyd.Scrawl", code: 3, userInfo: [NSLocalizedDescriptionKey: "The recording display is unavailable"])
        }
        // Exclude the whole app, including overlay windows created after this filter.
        let excluded = content.applications.filter { $0.processID == ProcessInfo.processInfo.processIdentifier }
        let filter = SCContentFilter(display: display, excludingApplications: excluded, exceptingWindows: [])
        let config = SCStreamConfiguration()
        config.width = min(1600, display.width)
        config.height = Int(Double(config.width) * Double(display.height) / Double(display.width))
        config.pixelFormat = kCVPixelFormatType_32BGRA
        config.minimumFrameInterval = CMTime(value: 1, timescale: 4)
        config.queueDepth = 2
        config.showsCursor = false
        let output = CaptureOutput { image in if let image { onFrame(image) } }
        let recording = SCStream(filter: filter, configuration: config, delegate: nil)
        try recording.addStreamOutput(output, type: .screen, sampleHandlerQueue: .main)
        stream = recording
        streamOutput = output
        capturedDisplayID = "\(displayID)"
        capturedDisplayBounds = CGDisplayBounds(displayID)
        do { try await recording.startCapture() }
        catch { stop(); throw error }
    }

    func stop() {
        if let stream, let streamOutput {
            try? stream.removeStreamOutput(streamOutput, type: .screen)
            stream.stopCapture { _ in }
        }
        stream = nil
        streamOutput = nil
    }
}

private final class CaptureOutput: NSObject, SCStreamOutput, @unchecked Sendable {
    private(set) var lastImage: CGImage?
    private let onFrame: (CGImage?) -> Void

    init(onFrame: @escaping (CGImage?) -> Void) {
        self.onFrame = onFrame
    }

    func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of type: SCStreamOutputType) {
        guard type == .screen, let imageBuffer = sampleBuffer.imageBuffer else { return }
        let ciImage = CIImage(cvPixelBuffer: imageBuffer)
        let context = CIContext()
        guard let cgImage = context.createCGImage(ciImage, from: ciImage.extent) else { return }
        lastImage = cgImage
        onFrame(cgImage)
    }
}
