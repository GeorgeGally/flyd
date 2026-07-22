import Foundation
import CoreGraphics
import Accelerate

struct ScreenFingerprint {
    static func hash(from image: CGImage) -> UInt64 {
        let width = 16
        let height = 16

        guard let context = CGContext(
            data: nil,
            width: width,
            height: height,
            bitsPerComponent: 8,
            bytesPerRow: width,
            space: CGColorSpaceCreateDeviceGray(),
            bitmapInfo: CGImageAlphaInfo.none.rawValue
        ) else { return 0 }

        context.interpolationQuality = .low
        context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))

        guard let data = context.data else { return 0 }
        let ptr = data.bindMemory(to: UInt8.self, capacity: width * height)

        var hash: UInt64 = 0
        for i in 0..<(width * height) {
            hash = hash &* 31 &+ UInt64(ptr[i])
        }

        return hash
    }

    static func hasChanged(_ new: UInt64, from old: UInt64, threshold: Double = 0.02) -> Bool {
        guard old != 0 else { return true }
        let maxVal: Double = Double(UInt64.max)
        let diff = Double(new > old ? new - old : old - new) / maxVal
        return diff > threshold
    }
}
