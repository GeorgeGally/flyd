import Foundation

struct OverlayConfig: Codable {
    var retention: RetentionMode = .balanced
    var excludedApps: [String] = []
    var redactionRules: [RedactionRule] = []
    var incognito: Bool = false
    var settingsVersion: Int = 1

    enum RetentionMode: String, Codable, CaseIterable {
        case `private` = "private"
        case balanced = "balanced"
        case contextual = "contextual"

        var displayName: String {
            switch self {
            case .private: return "Private"
            case .balanced: return "Balanced"
            case .contextual: return "Contextual"
            }
        }

        var explanation: String {
            switch self {
            case .private:
                return "No intent or outcome data is remembered. Invocations are ephemeral. Audit records deleted after 7 days."
            case .balanced:
                return "Preferences and corrections are remembered. Generic queries are discarded. Audit records kept for 30 days."
            case .contextual:
                return "Recurring routines and teaching patterns are remembered. Decision context is retained. Audit records kept for 90 days."
            }
        }
    }

    struct RedactionRule: Codable, Identifiable {
        var id: String
        var pattern: String
        var enabled: Bool

        var description: String {
            switch pattern {
            case "email": return "Email addresses"
            case "phone": return "Phone numbers"
            case "credit_card": return "Credit card numbers"
            case "ssn": return "Social security numbers"
            case "address": return "Physical addresses"
            case "url": return "URLs and links"
            default: return pattern
            }
        }
    }
}

final class ConfigManager {
    static let shared = ConfigManager()

    private let configURL: URL
    private(set) var config: OverlayConfig

    init() {
        let home = FileManager.default.homeDirectoryForCurrentUser
        let overlayDir = home.appendingPathComponent(".flyd/overlay")
        try? FileManager.default.createDirectory(at: overlayDir, withIntermediateDirectories: true)
        configURL = overlayDir.appendingPathComponent("config.json")
        config = ConfigManager.load(from: configURL)
    }

    func save() {
        guard let data = try? JSONEncoder().encode(config) else { return }
        try? data.write(to: configURL, options: .atomic)
    }

    func setRetention(_ mode: OverlayConfig.RetentionMode) {
        config.retention = mode
        save()
    }

    func setIncognito(_ enabled: Bool) {
        config.incognito = enabled
        save()
    }

    func excludeApp(_ bundleId: String) {
        if !config.excludedApps.contains(bundleId) {
            config.excludedApps.append(bundleId)
            save()
        }
    }

    func removeExcludedApp(_ bundleId: String) {
        config.excludedApps.removeAll { $0 == bundleId }
        save()
    }

    func setRedactionRule(_ id: String, enabled: Bool) {
        if let index = config.redactionRules.firstIndex(where: { $0.id == id }) {
            config.redactionRules[index].enabled = enabled
            save()
        }
    }

    var isAppExcluded: Bool {
        guard let bundleId = ApplicationMonitor.shared.foregroundApp?.bundleId else { return false }
        return config.excludedApps.contains(bundleId)
    }

    var auditRetentionDays: Int {
        switch config.retention {
        case .private: return 7
        case .balanced: return 30
        case .contextual: return 90
        }
    }

    private static func load(from url: URL) -> OverlayConfig {
        guard let data = try? Data(contentsOf: url),
              let config = try? JSONDecoder().decode(OverlayConfig.self, from: data) else {
            return OverlayConfig(
                retention: .balanced,
                excludedApps: [],
                redactionRules: [
                    OverlayConfig.RedactionRule(id: "email", pattern: "email", enabled: false),
                    OverlayConfig.RedactionRule(id: "phone", pattern: "phone", enabled: false),
                    OverlayConfig.RedactionRule(id: "credit_card", pattern: "credit_card", enabled: true),
                    OverlayConfig.RedactionRule(id: "ssn", pattern: "ssn", enabled: true),
                    OverlayConfig.RedactionRule(id: "address", pattern: "address", enabled: false),
                    OverlayConfig.RedactionRule(id: "url", pattern: "url", enabled: false),
                ],
                incognito: false
            )
        }
        return config
    }
}
