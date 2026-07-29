import XCTest
@testable import FlydMacAdapter

final class SpectrumBandMapperTests: XCTestCase {
    func testProducesDenseBoundedSpectrum() {
        var mapper = SpectrumBandMapper(bandCount: 48)
        let magnitudes = (0..<1024).map { Float($0 % 17) / 17 }

        let bands = mapper.map(
            magnitudes: magnitudes,
            sampleRate: 48_000,
            fftLength: 2048
        )

        XCTAssertEqual(bands.count, 48)
        XCTAssertTrue(bands.allSatisfy { (0...1).contains($0) })
    }

    func testDominantFrequencyRaisesItsOwnLogBand() {
        var mapper = SpectrumBandMapper(bandCount: 48)
        var magnitudes = [Float](repeating: 0, count: 1024)
        let dominantBin = Int(1_000 / (48_000.0 / 2048.0))
        magnitudes[dominantBin] = 100

        let bands = mapper.map(
            magnitudes: magnitudes,
            sampleRate: 48_000,
            fftLength: 2048
        )

        guard let peakIndex = bands.indices.max(by: { bands[$0] < bands[$1] }) else {
            return XCTFail("Expected a peak band")
        }
        XCTAssertTrue((15...30).contains(peakIndex), "1 kHz should land near the middle log-frequency bands")
        XCTAssertGreaterThan(bands[peakIndex], bands.first ?? 0)
        XCTAssertGreaterThan(bands[peakIndex], bands.last ?? 0)
    }

    func testPreviousPeakDecaysInsteadOfBecomingSyntheticMotion() {
        var mapper = SpectrumBandMapper(bandCount: 48, decay: 0.70)
        var magnitudes = [Float](repeating: 0, count: 1024)
        magnitudes[42] = 100

        let first = mapper.map(magnitudes: magnitudes, sampleRate: 48_000, fftLength: 2048)
        let second = mapper.map(
            magnitudes: [Float](repeating: 0, count: 1024),
            sampleRate: 48_000,
            fftLength: 2048
        )

        guard let peakIndex = first.indices.max(by: { first[$0] < first[$1] }) else {
            return XCTFail("Expected a peak band")
        }
        XCTAssertGreaterThan(second[peakIndex], 0)
        XCTAssertLessThan(second[peakIndex], first[peakIndex])
    }
}

