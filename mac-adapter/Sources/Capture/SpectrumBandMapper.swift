import Foundation

struct SpectrumBandMapper {
    let bandCount: Int
    let minimumFrequency: Double
    let maximumFrequency: Double
    let attack: Float
    let decay: Float

    private var previousBands: [Float]

    init(
        bandCount: Int,
        minimumFrequency: Double = 80,
        maximumFrequency: Double = 8_000,
        attack: Float = 0.86,
        decay: Float = 0.70
    ) {
        self.bandCount = max(1, bandCount)
        self.minimumFrequency = minimumFrequency
        self.maximumFrequency = maximumFrequency
        self.attack = max(0, min(1, attack))
        self.decay = max(0, min(1, decay))
        self.previousBands = [Float](repeating: 0, count: max(1, bandCount))
    }

    mutating func reset() -> [Float] {
        previousBands = [Float](repeating: 0, count: bandCount)
        return previousBands
    }

    mutating func map(
        magnitudes: [Float],
        sampleRate: Double,
        fftLength: Int
    ) -> [Float] {
        guard !magnitudes.isEmpty, sampleRate > 0, fftLength > 0 else {
            return previousBands
        }

        let binHz = sampleRate / Double(fftLength)
        let nyquist = sampleRate / 2
        let lowHz = max(binHz, minimumFrequency)
        let highHz = min(maximumFrequency, nyquist)
        guard highHz > lowHz else { return previousBands }

        let logLow = log(lowHz)
        let logHigh = log(highHz)
        var next = previousBands

        for band in 0..<bandCount {
            let startFraction = Double(band) / Double(bandCount)
            let endFraction = Double(band + 1) / Double(bandCount)
            let startHz = exp(logLow + startFraction * (logHigh - logLow))
            let endHz = exp(logLow + endFraction * (logHigh - logLow))
            let startBin = max(1, min(magnitudes.count - 1, Int(floor(startHz / binHz))))
            let endBin = max(startBin + 1, min(magnitudes.count, Int(ceil(endHz / binHz))))

            var peak: Float = 0
            for index in startBin..<endBin {
                peak = max(peak, magnitudes[index])
            }

            let scaledMagnitude = max(peak / Float(fftLength), 0.000_001)
            let decibels = 20 * log10(scaledMagnitude)
            let normalized = max(0, min(1, (decibels + 75) / 52))
            let prior = previousBands[band]
            next[band] = normalized >= prior
                ? prior + (normalized - prior) * attack
                : prior * decay
        }

        previousBands = next
        return next
    }
}

