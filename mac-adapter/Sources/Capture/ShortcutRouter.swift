import CoreGraphics
import Foundation

enum ShortcutRouteEvent: Equatable {
    case none
    case textTapped
    case voicePressed
    case voiceReleased
    case liveToggle
}

struct ShortcutRoutingState {
    fileprivate var voiceActive = false
    fileprivate var fnDownAlone = false
    fileprivate var lastFnTapUpAt: TimeInterval?
    fileprivate var ctrlWasDown = false
    fileprivate var ctrlPressCount = 0
    fileprivate var lastCtrlDownAt: TimeInterval?
}

enum ShortcutRouter {
    private static let voiceFlags: CGEventFlags = [.maskControl, .maskSecondaryFn]
    private static let fnOnly: CGEventFlags = [.maskSecondaryFn]
    private static let relevantFlags: CGEventFlags = [.maskControl, .maskAlternate, .maskSecondaryFn]

    /// Maximum gap between two clean fn taps to count as a double-tap.
    static let doubleTapWindow: TimeInterval = 0.4

    static let ctrlPressWindow: TimeInterval = 0.4
    static let ctrlSequenceTimeout: TimeInterval = 0.8

    static func route(
        eventType: CGEventType,
        flags: CGEventFlags,
        state: inout ShortcutRoutingState,
        now: TimeInterval = ProcessInfo.processInfo.systemUptime
    ) -> ShortcutRouteEvent {
        guard eventType == .flagsChanged else { return .none }
        let relevant = flags.intersection(relevantFlags)

        let ctrlOnly = flags.contains(.maskControl) && !flags.contains(.maskSecondaryFn) && !flags.contains(.maskAlternate)
        let ctrlDown = ctrlOnly
        if ctrlDown && !state.ctrlWasDown {
            if let lastCtrl = state.lastCtrlDownAt, now - lastCtrl <= ctrlPressWindow {
                state.ctrlPressCount += 1
            } else {
                state.ctrlPressCount = 1
            }
            state.lastCtrlDownAt = now
            if state.ctrlPressCount >= 3 {
                state.ctrlPressCount = 0
                state.ctrlWasDown = true
                return .liveToggle
            }
        }
        if !ctrlDown, let lastCtrl = state.lastCtrlDownAt, now - lastCtrl > ctrlSequenceTimeout {
            state.ctrlPressCount = 0
        }
        state.ctrlWasDown = ctrlDown

        if state.voiceActive {
            if relevant == voiceFlags { return .none }
            state.voiceActive = false
            return .voiceReleased
        }

        if relevant == voiceFlags {
            state.voiceActive = true
            state.fnDownAlone = false
            state.lastFnTapUpAt = nil
            return .voicePressed
        }

        if relevant == fnOnly {
            state.fnDownAlone = true
            return .none
        }

        if state.fnDownAlone {
            state.fnDownAlone = false
            // A clean tap ends with all relevant modifiers released. If another
            // modifier joined instead, this was the start of a chord — not a tap.
            guard relevant.isEmpty else {
                state.lastFnTapUpAt = nil
                return .none
            }
            if let last = state.lastFnTapUpAt, now - last <= doubleTapWindow {
                state.lastFnTapUpAt = nil
                return .textTapped
            }
            state.lastFnTapUpAt = now
            return .none
        }

        if !relevant.isEmpty {
            state.lastFnTapUpAt = nil
        }
        return .none
    }

    static func isVoiceChordActive(flags: CGEventFlags) -> Bool {
        flags.intersection(relevantFlags) == voiceFlags
    }
}
