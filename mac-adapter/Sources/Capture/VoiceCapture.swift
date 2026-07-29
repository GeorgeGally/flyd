import Accelerate
import AVFoundation

final class VoiceCapture {
    static let shared = VoiceCapture()

    private let engine = AVAudioEngine()
    private var isRunning = false
    private var audioBuffer = Data()
    private let bufferLock = NSLock()
    private var inputSampleRate: Double = 48000

    private let spectrumBandCount = 48
    private let fftLength = 2048
    private let fftLog2n: vDSP_Length = 11
    private var fftSetup: FFTSetup?
    private var spectrumMapper: SpectrumBandMapper

    var onAudioChunk: ((Data) -> Void)?
    var onTranscriptionDelta: ((String) -> Void)?
    var onComplete: ((String) -> Void)?
    var onError: ((String) -> Void)?
    var onLevel: ((Float) -> Void)?
    var onSpectrum: (([Float]) -> Void)?

    var isActive: Bool { isRunning }

    static var currentInputDeviceName: String? {
        AVCaptureDevice.default(for: .audio)?.localizedName
    }

    private init() {
        spectrumMapper = SpectrumBandMapper(bandCount: spectrumBandCount)
        fftSetup = vDSP_create_fftsetup(fftLog2n, FFTRadix(kFFTRadix2))
    }

    deinit {
        if let fftSetup {
            vDSP_destroy_fftsetup(fftSetup)
        }
    }

    func start() -> Bool {
        guard !isRunning else { return true }
        guard PermissionGate.shared.hasMicrophone else {
            onError?("Microphone permission not granted")
            return false
        }

        let inputNode = engine.inputNode
        let format = inputNode.outputFormat(forBus: 0)
        guard format.sampleRate > 0, format.channelCount > 0 else {
            onError?("Audio input not ready")
            return false
        }
        inputSampleRate = format.sampleRate

        inputNode.removeTap(onBus: 0)
        inputNode.installTap(onBus: 0, bufferSize: AVAudioFrameCount(fftLength), format: format) { [weak self] buffer, _ in
            guard let self = self, self.isRunning else { return }
            self.processAudioBuffer(buffer)
        }

        do {
            try engine.start()
            isRunning = true
            audioBuffer = Data()
            PrivacyInvariants.audioEngineActive = true
            return true
        } catch {
            onError?("Audio engine error: \(error.localizedDescription)")
            return false
        }
    }

    func stop() {
        guard isRunning else { return }
        isRunning = false

        engine.inputNode.removeTap(onBus: 0)
        engine.stop()
        engine.reset()

        PrivacyInvariants.audioEngineActive = false

        bufferLock.withLock { audioBuffer = Data() }
        onLevel?(0)
        onSpectrum?(spectrumMapper.reset())
    }

    private func processAudioBuffer(_ buffer: AVAudioPCMBuffer) {
        guard let channelData = buffer.floatChannelData?[0] else { return }
        let frames = Int(buffer.frameLength)

        var power: Float = 0
        for i in 0..<frames {
            let sample = channelData[i]
            power += sample * sample
        }
        let rms = sqrt(power / Float(max(frames, 1)))
        onLevel?(min(1, rms * 18))

        if onSpectrum != nil {
            onSpectrum?(computeSpectrumBands(channelData, frames: frames))
        }

        let ratio = inputSampleRate / 24000.0
        let outputFrames = Int(Double(frames) / ratio)
        guard outputFrames > 0 else { return }

        var pcm16 = Data(capacity: outputFrames * 2)
        for i in 0..<outputFrames {
            let srcIndex = Double(i) * ratio
            let srcFloor = Int(floor(srcIndex))
            let srcCeil = min(srcFloor + 1, frames - 1)
            let frac = Float(srcIndex - Double(srcFloor))

            let sample = channelData[srcFloor] * (1.0 - frac) + channelData[srcCeil] * frac
            let clamped = max(-1.0, min(1.0, sample))
            let int16 = Int16(clamped * Float(Int16.max))
            var value = int16
            pcm16.append(Data(bytes: &value, count: 2))
        }

        bufferLock.withLock { audioBuffer.append(pcm16) }
        onAudioChunk?(pcm16)
    }

    /// Real FFT-based spectrum, binned logarithmically across the speech range.
    private func computeSpectrumBands(_ channelData: UnsafeMutablePointer<Float>, frames: Int) -> [Float] {
        guard let fftSetup, frames > 0 else {
            return [Float](repeating: 0, count: spectrumBandCount)
        }

        let n = fftLength
        var samples = [Float](repeating: 0, count: n)
        let copyCount = min(frames, n)
        samples.withUnsafeMutableBufferPointer { buf in
            buf.baseAddress!.update(from: channelData, count: copyCount)
        }

        var window = [Float](repeating: 0, count: n)
        vDSP_hann_window(&window, vDSP_Length(n), Int32(vDSP_HANN_NORM))
        vDSP_vmul(samples, 1, window, 1, &samples, 1, vDSP_Length(n))

        var realp = [Float](repeating: 0, count: n / 2)
        var imagp = [Float](repeating: 0, count: n / 2)
        var magnitudes = [Float](repeating: 0, count: n / 2)

        realp.withUnsafeMutableBufferPointer { realPtr in
            imagp.withUnsafeMutableBufferPointer { imagPtr in
                var split = DSPSplitComplex(realp: realPtr.baseAddress!, imagp: imagPtr.baseAddress!)

                samples.withUnsafeBufferPointer { samplePtr in
                    samplePtr.baseAddress!.withMemoryRebound(to: DSPComplex.self, capacity: n / 2) { complexPtr in
                        vDSP_ctoz(complexPtr, 2, &split, 1, vDSP_Length(n / 2))
                    }
                }

                vDSP_fft_zrip(fftSetup, &split, 1, fftLog2n, FFTDirection(FFT_FORWARD))
                vDSP_zvabs(&split, 1, &magnitudes, 1, vDSP_Length(n / 2))
            }
        }

        return spectrumMapper.map(
            magnitudes: magnitudes,
            sampleRate: inputSampleRate,
            fftLength: n
        )
    }

    func drainBuffer() -> Data {
        bufferLock.withLock {
            let data = audioBuffer
            audioBuffer = Data()
            return data
        }
    }
}
