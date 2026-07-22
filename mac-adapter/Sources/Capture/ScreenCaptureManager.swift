import ScreenCaptureKit
import CoreGraphics
import AppKit

final class ScreenCaptureManager {
    static let shared = ScreenCaptureManager()

    var isCapturing: Bool {
        stream != nil
    }

    private var stream: SCStream?
    private var streamOutput: CaptureOutput?

    func captureScreenshot() async -> CGImage? {
        guard PermissionGate.shared.hasScreenRecording else { return nil }

        let content = try? await SCShareableContent.current
        guard let content, let display = content.displays.first else { return nil }

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

    func stop() {
        if let stream, let streamOutput {
            try? stream.removeStreamOutput(streamOutput, type: .screen)
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
