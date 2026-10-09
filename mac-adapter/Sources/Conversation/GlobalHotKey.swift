import Carbon

/// A system-wide shortcut through Carbon's hot-key API, which needs no
/// Accessibility or Input Monitoring permission.
final class GlobalHotKey {
    private static var handlers: [UInt32: () -> Void] = [:]
    private static var handlerInstalled = false
    private var reference: EventHotKeyRef?

    /// ⌃⌥⌘F: opens the Conversation window.
    static let conversation = (keyCode: UInt32(kVK_ANSI_F), modifiers: UInt32(controlKey | optionKey | cmdKey), display: "⌃⌥⌘F")

    init?(keyCode: UInt32, modifiers: UInt32, id: UInt32, handler: @escaping () -> Void) {
        Self.installHandlerOnce()
        let hotKeyID = EventHotKeyID(signature: OSType(0x464C5944), id: id) // 'FLYD'
        let status = RegisterEventHotKey(keyCode, modifiers, hotKeyID, GetApplicationEventTarget(), 0, &reference)
        guard status == noErr else { return nil }
        Self.handlers[id] = handler
    }

    deinit {
        if let reference { UnregisterEventHotKey(reference) }
    }

    private static func installHandlerOnce() {
        guard !handlerInstalled else { return }
        handlerInstalled = true
        var pressed = EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed))
        InstallEventHandler(GetApplicationEventTarget(), { _, event, _ in
            var hotKeyID = EventHotKeyID()
            GetEventParameter(event, EventParamName(kEventParamDirectObject), EventParamType(typeEventHotKeyID), nil,
                              MemoryLayout<EventHotKeyID>.size, nil, &hotKeyID)
            DispatchQueue.main.async { GlobalHotKey.handlers[hotKeyID.id]?() }
            return noErr
        }, 1, &pressed, nil, nil)
    }
}
