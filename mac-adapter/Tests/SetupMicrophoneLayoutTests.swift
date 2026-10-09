import AppKit
import SwiftUI
import XCTest
@testable import FlydMacAdapter

final class SetupMicrophoneLayoutTests: XCTestCase {
    func testFoldKeepsEachGroupsPeak() {
        let bands: [CGFloat] = [0.1, 0.9, 0.2, 0.3, 0.0, 0.4]

        XCTAssertEqual(WaveformBars.fold(bands, into: 3), [0.9, 0.3, 0.4])
    }

    func testFoldAlwaysReturnsRequestedCount() {
        XCTAssertEqual(WaveformBars.fold(Array(repeating: 0.5, count: 48), into: 16).count, 16)
        XCTAssertEqual(WaveformBars.fold([0.2, 0.7], into: 16).count, 16)
        XCTAssertEqual(WaveformBars.fold([], into: 16), Array(repeating: 0, count: 16))
    }

    /// The setup step gives the visual a 310pt column; the live spectrum once pushed it to ~760pt,
    /// so the card covered the "Flyd can hear you." text and ran off the window.
    func testMicrophoneVisualFitsItsColumnWithTheLiveSpectrum() {
        let liveBands = (0..<48).map { CGFloat($0 % 5) / 4 }
        let host = NSHostingView(rootView: MicrophoneTestVisual(bands: liveBands, isHeard: true))

        XCTAssertLessThanOrEqual(host.fittingSize.width, 310)
    }
}
