import AppKit
import ApplicationServices

final class ApplicationMonitor {
    static let shared = ApplicationMonitor()

    private let lock = NSLock()
    private var _currentApp: EnvironmentState.ApplicationInfo?
    private var currentApp: EnvironmentState.ApplicationInfo? {
        get { lock.withLock { _currentApp } }
        set { lock.withLock { _currentApp = newValue } }
    }

    var excludedBundleIds: Set<String> = [
        "com.flyd.overlay",
        "com.flyd.mac-adapter",
    ]

    var foregroundApp: EnvironmentState.ApplicationInfo? {
        currentApp
    }

    func start() {
        let workspace = NSWorkspace.shared
        updateCurrentApp(from: workspace)

        workspace.notificationCenter.addObserver(
            forName: NSWorkspace.didActivateApplicationNotification,
            object: nil,
            queue: .main
        ) { [weak self] notification in
            guard let self else { return }
            if let app = notification.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication {
                let info = self.appInfo(from: app)
                if !self.excludedBundleIds.contains(info.bundleId) {
                    self.currentApp = info
                    NotificationCenter.default.post(name: .foregroundAppDidChange, object: nil)
                }
            }
        }
    }

    private func updateCurrentApp(from workspace: NSWorkspace) {
        guard let app = workspace.frontmostApplication,
              let bundleId = app.bundleIdentifier else { return }
        let name = app.localizedName ?? bundleId
        let info = EnvironmentState.ApplicationInfo(bundleId: bundleId, name: name)
        if !excludedBundleIds.contains(bundleId) {
            currentApp = info
        }
    }

    private func appInfo(from app: NSRunningApplication) -> EnvironmentState.ApplicationInfo {
        EnvironmentState.ApplicationInfo(
            bundleId: app.bundleIdentifier ?? "unknown",
            name: app.localizedName ?? app.bundleIdentifier ?? "Unknown"
        )
    }
}

extension Notification.Name {
    static let foregroundAppDidChange = Notification.Name("ForegroundAppDidChange")
}
