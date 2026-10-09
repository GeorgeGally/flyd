import CoreGraphics
import Foundation

enum ShortcutRouteEvent: Equatable {
    case textTapped
    case voicePressed
    case voiceReleased
    case dictationStart
    case dictationStop
    case dictationCancel
    case liveToggle
}

/// fn alone: tap starts hands-free dictation and the next tap stops it, a hold is
/// push-to-talk, a double-tap opens the text bar. Recording starts optimistically on
/// fn down and is cancelled when fn turns out to be part of a chord or key combo.
fileprivate enum FnGesture: Equatable {
    case idle
    case armed(since: TimeInterval)
    case recording(tapUpAt: TimeInterval)
    /// fn pressed again soon after a tap: the text bar opens on its release,
    /// unless Control joins first (then it is Fn+Control, talking to Flyd).
    case secondTap
    case conversation
    /// A gesture ended while keys are still held; ignore edges until everything is up.
    case draining
}

struct ShortcutRoutingState {
    fileprivate var gesture: FnGesture = .idle
    fileprivate var ctrlWasDown = false
    fileprivate var ctrlPressCount = 0
    fileprivate var lastCtrlDownAt: TimeInterval?
}

enum ShortcutRouter {
    private static let voiceFlags: CGEventFlags = [.maskControl, .maskSecondaryFn]
    private static let chordFlags: CGEventFlags = [.maskShift, .maskControl, .maskAlternate, .maskSecondaryFn]
    private static let gestureFlags: CGEventFlags = chordFlags.union(.maskCommand)

    static let holdThreshold: TimeInterval = 0.3
    /// Maximum gap between the first tap's release and the second press to count as a double-tap.
    static let doubleTapWindow: TimeInterval = 0.4
    static let escapeKeyCode: CGKeyCode = 53

    static let ctrlPressWindow: TimeInterval = 0.4
    static let ctrlSequenceTimeout: TimeInterval = 0.8

    static func route(
        eventType: CGEventType,
        flags: CGEventFlags,
        keyCode: CGKeyCode = 0,
        state: inout ShortcutRoutingState,
        now: TimeInterval = ProcessInfo.processInfo.systemUptime
    ) -> [ShortcutRouteEvent] {
        switch eventType {
        case .keyDown:
            return routeKeyDown(keyCode: keyCode, state: &state)
        case .flagsChanged:
            if routeControlTriple(flags: flags, state: &state, now: now) {
                return [.liveToggle]
            }
            return routeFn(flags: flags, state: &state, now: now)
        default:
            return []
        }
    }

    /// Dictation ended outside the router (5 min cap, error): forget the recording so
    /// the next fn press starts fresh instead of stopping a recording that is gone.
    static func endDictation(state: inout ShortcutRoutingState) {
        switch state.gesture {
        case .armed: state.gesture = .draining
        case .recording: state.gesture = .idle
        case .idle, .secondTap, .conversation, .draining: break
        }
    }

    static func isVoiceChordActive(flags: CGEventFlags) -> Bool {
        flags.intersection(chordFlags) == voiceFlags
    }

    private static func routeKeyDown(keyCode: CGKeyCode, state: inout ShortcutRoutingState) -> [ShortcutRouteEvent] {
        switch state.gesture {
        case .armed:
            state.gesture = .draining
            return [.dictationCancel]
        case .recording where keyCode == escapeKeyCode:
            state.gesture = .idle
            return [.dictationCancel]
        case .secondTap:
            state.gesture = .draining
            return []
        case .idle, .recording, .conversation, .draining:
            return []
        }
    }

    private static func routeFn(flags: CGEventFlags, state: inout ShortcutRoutingState, now: TimeInterval) -> [ShortcutRouteEvent] {
        let held = flags.intersection(gestureFlags)
        let isVoiceChord = flags.intersection(chordFlags) == voiceFlags
        let isFnAlone = held == [.maskSecondaryFn]

        switch state.gesture {
        case .idle, .draining:
            if isVoiceChord {
                state.gesture = .conversation
                return [.voicePressed]
            }
            if state.gesture == .idle, isFnAlone {
                state.gesture = .armed(since: now)
                return [.dictationStart]
            }
            if held.isEmpty { state.gesture = .idle }
            return []

        case .armed(let since):
            if held.isEmpty {
                if now - since >= holdThreshold {
                    state.gesture = .idle
                    return [.dictationStop]
                }
                state.gesture = .recording(tapUpAt: now)
                return []
            }
            if isFnAlone { return [] }
            if isVoiceChord {
                state.gesture = .conversation
                return [.dictationCancel, .voicePressed]
            }
            state.gesture = .draining
            return [.dictationCancel]

        case .recording(let tapUpAt):
            if isVoiceChord {
                state.gesture = .conversation
                return [.dictationCancel, .voicePressed]
            }
            guard isFnAlone else { return [] }
            if now - tapUpAt <= doubleTapWindow {
                // Decide on release: Fn+Control often starts with Fn a moment early.
                state.gesture = .secondTap
                return [.dictationCancel]
            }
            state.gesture = .draining
            return [.dictationStop]

        case .secondTap:
            if isVoiceChord {
                state.gesture = .conversation
                return [.voicePressed]
            }
            if held.isEmpty {
                state.gesture = .idle
                return [.textTapped]
            }
            if isFnAlone { return [] }
            state.gesture = .draining
            return []

        case .conversation:
            if isVoiceChord { return [] }
            state.gesture = held.isEmpty ? .idle : .draining
            return [.voiceReleased]
        }
    }

    /// ⌃ pressed alone three times in quick succession toggles LIVE.
    private static func routeControlTriple(flags: CGEventFlags, state: inout ShortcutRoutingState, now: TimeInterval) -> Bool {
        let ctrlDown = flags.contains(.maskControl)
            && !flags.contains(.maskShift)
            && !flags.contains(.maskSecondaryFn)
            && !flags.contains(.maskAlternate)
        defer { state.ctrlWasDown = ctrlDown }

        if ctrlDown && !state.ctrlWasDown {
            if let lastCtrl = state.lastCtrlDownAt, now - lastCtrl <= ctrlPressWindow {
                state.ctrlPressCount += 1
            } else {
                state.ctrlPressCount = 1
            }
            state.lastCtrlDownAt = now
            if state.ctrlPressCount >= 3 {
                state.ctrlPressCount = 0
                return true
            }
        }
        if !ctrlDown, let lastCtrl = state.lastCtrlDownAt, now - lastCtrl > ctrlSequenceTimeout {
            state.ctrlPressCount = 0
        }
        return false
    }
}

/// Decides which events the HID-level tap swallows so the system never sees them: the
/// fn-alone press and its matching release (no emoji picker or input-source switch on
/// the globe key), and an Esc that cancelled a dictation (so it doesn't also interrupt
/// the app underneath, e.g. a running OpenCode turn). Everything else passes through.
struct KeyEventFilter {
    static let fnKeyCode: CGKeyCode = 63
    private static let gestureFlags: CGEventFlags = [.maskShift, .maskControl, .maskAlternate, .maskCommand, .maskSecondaryFn]

    private var fnPressDropped = false
    private var escapeDownDropped = false

    mutating func shouldDrop(
        eventType: CGEventType,
        keyCode: CGKeyCode,
        flags: CGEventFlags,
        routed: [ShortcutRouteEvent]
    ) -> Bool {
        switch eventType {
        case .flagsChanged where keyCode == Self.fnKeyCode:
            let held = flags.intersection(Self.gestureFlags)
            if held == [.maskSecondaryFn] {
                fnPressDropped = true
                return true
            }
            if held.isEmpty, fnPressDropped {
                fnPressDropped = false
                return true
            }
            fnPressDropped = false
            return false
        case .keyDown where keyCode == ShortcutRouter.escapeKeyCode:
            escapeDownDropped = routed.contains(.dictationCancel)
            return escapeDownDropped
        case .keyUp where keyCode == ShortcutRouter.escapeKeyCode:
            defer { escapeDownDropped = false }
            return escapeDownDropped
        default:
            return false
        }
    }
}
