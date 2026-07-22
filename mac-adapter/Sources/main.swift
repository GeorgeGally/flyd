import AppKit
import SwiftUI

let app = NSApplication.shared
app.setActivationPolicy(.accessory)

let state = FlydState.shared
let permissionGate = PermissionGate.shared
let statusItem = StatusItem()
let overlayWindow = OverlayWindow()
let applicationMonitor = ApplicationMonitor.shared
let accessibilityInspector = AccessibilityInspector.shared
let stateMachine = InvocationStateMachine.shared
let auditRecorder = AuditRecorder.shared
let auth = AdapterAuth.shared

let invocationPanel = InvocationPanel()

if !permissionGate.allRequiredGranted() {
    showPermissionsWindow()
} else {
    startFlyd()
}

app.run()

func startFlyd() {
    _ = auth.credential()

    statusItem.start()
    overlayWindow.create()

    applicationMonitor.start()
    accessibilityInspector.start()

    stateMachine.onShortcutPressed = {
        handleInvocation()
    }

    stateMachine.onShortcutReleased = {
    }

    stateMachine.start()

    print("[Flyd] Agent started. Press ⌃⌥ to invoke.")
}

func handleInvocation() {
    let currentPhase = state.phase

    if currentPhase != .idle {
        state.cancelInvocation()
        stateMachine.cancel()
        invocationPanel.dismiss()
        return
    }

    let invocationId = state.startInvocation()

    stateMachine.startPrewarm()

    state.transition(to: .awaitingIntent)

    invocationPanel.onIntentSubmitted = { intent in
        stateMachine.captureIntent(intent: intent)

        if stateMachine.hasFocusDrift() {
            print("[Flyd] WARNING: Focus drifted between t₀ and t₁")
        }

        guard let environment = accessibilityInspector.captureEnvironment() else {
            state.cancelInvocation()
            auditRecorder.record(invocationId: invocationId, contextSources: ["none"], error: "Failed to capture environment")
            return
        }

        state.transition(to: .executing)

        if !stateMachine.verifyPreExecution() {
            print("[Flyd] WARNING: App/window changed before execution")
        }

        let contextSources = [
            "app:\(environment.application.bundleId)",
            "element:\(environment.focusedElement.role)",
            "sufficiency:\(environment.sufficiency.rawValue)",
        ]

        print("[Flyd] ===== INVOCATION \(invocationId.prefix(8)) =====")
        print("[Flyd] App: \(environment.application.name) (\(environment.application.bundleId))")
        print("[Flyd] Element: \(environment.focusedElement.role) — \(environment.focusedElement.description)")
        print("[Flyd] Selection: \(environment.focusedElement.selectedText.prefix(80))")
        print("[Flyd] Intent: \(intent)")
        print("[Flyd] =====================================")

        auditRecorder.record(
            invocationId: invocationId,
            contextSources: contextSources,
            error: nil
        )

        DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
            state.transition(to: .present)
        }
    }

    invocationPanel.onCancelled = {
        state.cancelInvocation()
        stateMachine.cancel()
        auditRecorder.record(
            invocationId: invocationId,
            contextSources: ["cancelled"],
            error: "User cancelled"
        )
    }

    invocationPanel.show()
}

func showPermissionsWindow() {
    let window = NSWindow(
        contentRect: NSRect(x: 0, y: 0, width: 400, height: 320),
        styleMask: [.titled, .closable, .miniaturizable],
        backing: .buffered,
        defer: false
    )
    window.title = "Flyd — Permissions"
    window.center()
    window.contentView = NSHostingView(rootView: PermissionsView())

    let appDelegate = PermissionsAppDelegate()
    app.delegate = appDelegate

    window.makeKeyAndOrderFront(nil)

    Timer.scheduledTimer(withTimeInterval: 1.0, repeats: true) { timer in
        if permissionGate.allRequiredGranted() {
            timer.invalidate()
            window.close()
            startFlyd()
        }
    }
}

final class PermissionsAppDelegate: NSObject, NSApplicationDelegate {
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        true
    }
}
