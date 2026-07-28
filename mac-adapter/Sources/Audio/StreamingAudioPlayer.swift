import AVFoundation
import Foundation

final class StreamingAudioPlayer {
    private let engine = AVAudioEngine()
    private let playerNode = AVAudioPlayerNode()
    private var started = false

    func start() {
        guard !started else { return }
        let format = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: 24000, channels: 1, interleaved: false)!
        engine.attach(playerNode)
        engine.connect(playerNode, to: engine.mainMixerNode, format: format)
        do {
            try engine.start()
            playerNode.play()
            started = true
        } catch {
            print("[Flyd] StreamingAudioPlayer start failed: \(error.localizedDescription)")
        }
    }

    func stop() {
        guard started else { return }
        playerNode.stop()
        engine.stop()
        engine.detach(playerNode)
        started = false
    }

    func schedulePCM(base64Encoded: String) {
        guard started, let raw = Data(base64Encoded: base64Encoded) else { return }
        let format = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: 24000, channels: 1, interleaved: false)!
        let frameCount = AVAudioFrameCount(raw.count / MemoryLayout<Int16>.size)
        guard let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: frameCount) else { return }
        buffer.frameLength = frameCount
        raw.withUnsafeBytes { (ptr: UnsafeRawBufferPointer) in
            if let out = buffer.int16ChannelData?.pointee {
                UnsafeMutableRawPointer(out).copyMemory(from: ptr.baseAddress!, byteCount: raw.count)
            }
        }
        playerNode.scheduleBuffer(buffer)
    }
}
