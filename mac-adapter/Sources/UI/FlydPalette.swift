import AppKit

/// Shared visual language for Flyd's floating overlay surfaces (InvocationPanel, AugmentPanel).
///
/// Direction: an "instrument readout," not a frosted launcher clone. Warm ink instead of
/// blue-black glass, one brass signal color instead of blue-everywhere, monospace state
/// labels because these panels' entire job is reporting a state transition.
enum FlydPalette {
    /// Warm near-black surface. Deliberately not blue-tinted — avoids the Spotlight/Raycast look.
    static let ink = NSColor(calibratedRed: 0.086, green: 0.075, blue: 0.058, alpha: 1)
    /// Warm off-white for primary text. Never pure white.
    static let paper = NSColor(calibratedRed: 0.953, green: 0.937, blue: 0.890, alpha: 1)
    /// The one signature accent: idle/working/thinking states.
    static let brass = NSColor(calibratedRed: 0.788, green: 0.541, blue: 0.239, alpha: 1)
    /// Reserved for the literal "microphone is live" state — matches the system mic convention.
    static let listenBlue = NSColor(calibratedRed: 0.310, green: 0.659, blue: 0.878, alpha: 1)
    static let signalGreen = NSColor(calibratedRed: 0.435, green: 0.635, blue: 0.529, alpha: 1)
    static let signalRust = NSColor(calibratedRed: 0.788, green: 0.376, blue: 0.239, alpha: 1)
    static let line = paper.withAlphaComponent(0.14)

    static func monospace(_ size: CGFloat, weight: NSFont.Weight = .semibold) -> NSFont {
        .monospacedSystemFont(ofSize: size, weight: weight)
    }

    static func tracked(_ string: String, font: NSFont, color: NSColor, tracking: CGFloat) -> NSAttributedString {
        NSAttributedString(string: string, attributes: [
            .font: font,
            .foregroundColor: color,
            .kern: tracking
        ])
    }

    static var reduceMotion: Bool {
        NSWorkspace.shared.accessibilityDisplayShouldReduceMotion
    }
}

/// A small glowing indicator dot — the one recurring signature mark across Flyd's overlays.
/// Recolors per state and pulses gently while a state is "live," standing in for the
/// generic colored-pill/glow-everywhere treatment.
final class FlydStatusDot: NSView {
    private let dotSize: CGFloat = 7

    override init(frame frameRect: NSRect) {
        super.init(frame: NSRect(x: frameRect.origin.x, y: frameRect.origin.y, width: 7, height: 7))
        wantsLayer = true
        layer?.cornerRadius = dotSize / 2
        layer?.backgroundColor = FlydPalette.brass.cgColor
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    func set(color: NSColor, pulsing: Bool) {
        layer?.removeAnimation(forKey: "pulse")
        layer?.backgroundColor = color.cgColor
        layer?.shadowColor = color.cgColor
        layer?.shadowRadius = 4
        layer?.shadowOpacity = 0.85
        layer?.shadowOffset = .zero

        guard pulsing, !FlydPalette.reduceMotion else {
            layer?.opacity = 1
            return
        }
        let pulse = CABasicAnimation(keyPath: "opacity")
        pulse.fromValue = 1.0
        pulse.toValue = 0.35
        pulse.duration = 0.9
        pulse.autoreverses = true
        pulse.repeatCount = .infinity
        pulse.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
        layer?.add(pulse, forKey: "pulse")
    }
}
