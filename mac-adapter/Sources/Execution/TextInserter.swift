import AppKit
import Carbon.HIToolbox

enum CopyReason: Equatable {
    case secureInput
    case targetChanged
    case pasteFailed
}

enum InsertOutcome: Equatable {
    case pasted
    case typed
    case copiedOnly(reason: CopyReason)
}

/// Puts dictated text into whatever app has focus: paste via the general pasteboard
/// (restored afterwards), synthetic typing when the pasteboard cannot be written, and
/// clipboard-only when inserting would be unsafe.
enum TextInserter {
    enum Route: Equatable {
        case paste
        case copyOnly(CopyReason)
    }

    enum TypingStep: Equatable {
        case text(String)
        case shiftReturn
    }

    static let restoreDelay: TimeInterval = 0.75
    private static let transientType = NSPasteboard.PasteboardType("org.nspasteboard.TransientType")
    private static let typingChunkCharacters = 16

    static func route(secureInputEnabled: Bool, targetPid: pid_t?, frontmostPid: pid_t?) -> Route {
        if secureInputEnabled { return .copyOnly(.secureInput) }
        if let targetPid, targetPid != frontmostPid { return .copyOnly(.targetChanged) }
        return .paste
    }

    /// Restore George's clipboard only when our paste went out and nobody has written
    /// to the pasteboard since; otherwise the newer content (or the unpasted text) wins.
    static func shouldRestore(pasted: Bool, changeCountAfterWrite: Int, changeCountNow: Int) -> Bool {
        pasted && changeCountAfterWrite == changeCountNow
    }

    /// Newlines go out as Shift+Return so chat and terminal prompts are not submitted mid-text.
    static func typingPlan(for text: String) -> [TypingStep] {
        var steps: [TypingStep] = []
        for (index, line) in text.components(separatedBy: "\n").enumerated() {
            if index > 0 { steps.append(.shiftReturn) }
            let characters = Array(line)
            for start in stride(from: 0, to: characters.count, by: typingChunkCharacters) {
                let end = min(start + typingChunkCharacters, characters.count)
                steps.append(.text(String(characters[start..<end])))
            }
        }
        return steps
    }

    @MainActor
    static func insert(_ text: String, targetPid: pid_t?) async -> InsertOutcome {
        let pasteboard = NSPasteboard.general
        let route = route(
            secureInputEnabled: IsSecureEventInputEnabled(),
            targetPid: targetPid,
            frontmostPid: NSWorkspace.shared.frontmostApplication?.processIdentifier
        )
        if case .copyOnly(let reason) = route {
            _ = write(text, to: pasteboard, transient: false)
            return .copiedOnly(reason: reason)
        }

        let snapshot = PasteboardSnapshot(pasteboard)
        guard write(text, to: pasteboard, transient: true) else {
            snapshot.restore(to: pasteboard)
            await type(text)
            return .typed
        }
        let changeCountAfterWrite = pasteboard.changeCount

        let pasted = postPaste()
        let restoreAt = DispatchTime.now() + restoreDelay
        DispatchQueue.main.asyncAfter(deadline: restoreAt) {
            if shouldRestore(pasted: pasted, changeCountAfterWrite: changeCountAfterWrite, changeCountNow: pasteboard.changeCount) {
                snapshot.restore(to: pasteboard)
            }
        }
        return pasted ? .pasted : .copiedOnly(reason: .pasteFailed)
    }

    private static func write(_ text: String, to pasteboard: NSPasteboard, transient: Bool) -> Bool {
        pasteboard.clearContents()
        let item = NSPasteboardItem()
        item.setString(text, forType: .string)
        if transient {
            item.setData(Data(), forType: transientType)
        }
        return pasteboard.writeObjects([item])
    }

    private static func postPaste() -> Bool {
        let source = CGEventSource(stateID: .combinedSessionState)
        let v = keyCode(for: "v") ?? CGKeyCode(kVK_ANSI_V)
        guard let down = CGEvent(keyboardEventSource: source, virtualKey: v, keyDown: true),
              let up = CGEvent(keyboardEventSource: source, virtualKey: v, keyDown: false) else { return false }
        down.flags = .maskCommand
        up.flags = .maskCommand
        down.post(tap: .cghidEventTap)
        up.post(tap: .cghidEventTap)
        return true
    }

    @MainActor
    private static func type(_ text: String) async {
        let source = CGEventSource(stateID: .combinedSessionState)
        for step in typingPlan(for: text) {
            switch step {
            case .shiftReturn:
                postKey(CGKeyCode(kVK_Return), flags: .maskShift, source: source)
            case .text(let chunk):
                let units = Array(chunk.utf16)
                guard let down = CGEvent(keyboardEventSource: source, virtualKey: 0, keyDown: true),
                      let up = CGEvent(keyboardEventSource: source, virtualKey: 0, keyDown: false) else { continue }
                down.keyboardSetUnicodeString(stringLength: units.count, unicodeString: units)
                up.keyboardSetUnicodeString(stringLength: units.count, unicodeString: units)
                down.post(tap: .cghidEventTap)
                up.post(tap: .cghidEventTap)
            }
            try? await Task.sleep(nanoseconds: 5_000_000)
        }
    }

    private static func postKey(_ keyCode: CGKeyCode, flags: CGEventFlags, source: CGEventSource?) {
        guard let down = CGEvent(keyboardEventSource: source, virtualKey: keyCode, keyDown: true),
              let up = CGEvent(keyboardEventSource: source, virtualKey: keyCode, keyDown: false) else { return }
        down.flags = flags
        up.flags = flags
        down.post(tap: .cghidEventTap)
        up.post(tap: .cghidEventTap)
    }

    /// The key that produces `character` in the current layout, so ⌘V still means paste on
    /// Dvorak/AZERTY. Non-Latin layouts have no "v" and fall back to the ANSI position.
    static func keyCode(for character: String) -> CGKeyCode? {
        guard let source = TISCopyCurrentKeyboardLayoutInputSource()?.takeRetainedValue(),
              let layoutPointer = TISGetInputSourceProperty(source, kTISPropertyUnicodeKeyLayoutData) else { return nil }
        let layoutData = Unmanaged<CFData>.fromOpaque(layoutPointer).takeUnretainedValue() as Data
        return layoutData.withUnsafeBytes { raw -> CGKeyCode? in
            guard let layout = raw.baseAddress?.assumingMemoryBound(to: UCKeyboardLayout.self) else { return nil }
            for code in 0..<128 {
                var deadKeyState: UInt32 = 0
                var characters = [UniChar](repeating: 0, count: 4)
                var length = 0
                let status = UCKeyTranslate(
                    layout,
                    UInt16(code),
                    UInt16(kUCKeyActionDisplay),
                    0,
                    UInt32(LMGetKbdType()),
                    OptionBits(kUCKeyTranslateNoDeadKeysBit),
                    &deadKeyState,
                    characters.count,
                    &length,
                    &characters
                )
                if status == noErr, length > 0,
                   String(utf16CodeUnits: characters, count: length).lowercased() == character {
                    return CGKeyCode(code)
                }
            }
            return nil
        }
    }
}

private struct PasteboardSnapshot {
    private let items: [[NSPasteboard.PasteboardType: Data]]

    init(_ pasteboard: NSPasteboard) {
        items = (pasteboard.pasteboardItems ?? []).map { item in
            var contents: [NSPasteboard.PasteboardType: Data] = [:]
            for type in item.types {
                if let data = item.data(forType: type) { contents[type] = data }
            }
            return contents
        }
    }

    func restore(to pasteboard: NSPasteboard) {
        pasteboard.clearContents()
        let restored = items.map { contents -> NSPasteboardItem in
            let item = NSPasteboardItem()
            for (type, data) in contents { item.setData(data, forType: type) }
            return item
        }
        if !restored.isEmpty {
            pasteboard.writeObjects(restored)
        }
    }
}
