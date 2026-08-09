import Foundation

struct OverlayConfig: Codable {
    var retention: RetentionMode = .balanced
    var excludedApps: [String] = []
    var redactionRules: [RedactionRule] = []
    var incognito: Bool = false
    var replyMode: ReplyMode = .text
    var foregroundFeedbackCapture: Bool = true
    var settingsVersion: Int = 1

    init(
        retention: RetentionMode = .balanced,
        excludedApps: [String] = [],
        redactionRules: [RedactionRule] = [],
        incognito: Bool = false,
        replyMode: ReplyMode = .text,
        foregroundFeedbackCapture: Bool = true,
        settingsVersion: Int = 1
    ) {
        self.retention = retention
        self.excludedApps = excludedApps
        self.redactionRules = redactionRules
        self.incognito = incognito
        self.replyMode = replyMode
        self.foregroundFeedbackCapture = foregroundFeedbackCapture
        self.settingsVersion = settingsVersion
    }

    // Decode field-by-field with fallbacks rather than relying on synthesized Decodable,
    // which does NOT apply property defaults to missing keys — every field addition here
    // would otherwise throw keyNotFound on any config.json written before that field
    // existed, and ConfigManager.load()'s try? turns that single missing key into a full
    // reset of every persisted setting, not just the new one.
    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        retention = try container.decodeIfPresent(RetentionMode.self, forKey: .retention) ?? .balanced
        excludedApps = try container.decodeIfPresent([String].self, forKey: .excludedApps) ?? []
        redactionRules = try container.decodeIfPresent([RedactionRule].self, forKey: .redactionRules) ?? []
        incognito = try container.decodeIfPresent(Bool.self, forKey: .incognito) ?? false
        replyMode = try container.decodeIfPresent(ReplyMode.self, forKey: .replyMode) ?? .text
        foregroundFeedbackCapture = try container.decodeIfPresent(Bool.self, forKey: .foregroundFeedbackCapture) ?? true
        settingsVersion = try container.decodeIfPresent(Int.self, forKey: .settingsVersion) ?? 1
    }

    private enum CodingKeys: String, CodingKey {
        case retention, excludedApps, redactionRules, incognito, replyMode, foregroundFeedbackCapture, settingsVersion
    }

    enum ReplyMode: String, Codable, CaseIterable {
        case text = "text"
        case voice = "voice"

        var displayName: String {
            switch self {
            case .text: return "Text"
            case .voice: return "Voice"
            }
        }

        var explanation: String {
            switch self {
            case .text:
                return "Voice invocations (fn+⌃) are transcribed and resolved silently — no spoken response."
            case .voice:
                return "Voice invocations (fn+⌃) get a spoken response read back after resolving."
            }
        }
    }

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
        guard let data = try? JSONEncoder().encode(config) else {
            print("[ConfigManager] ERROR: Failed to encode config")
            return
        }
        do {
            try data.write(to: configURL, options: .atomic)
            DispatchQueue.main.async {
                NotificationCenter.default.post(name: .flydConfigDidChange, object: nil)
            }
        } catch {
            print("[ConfigManager] ERROR: Failed to write config: \(error.localizedDescription)")
        }
    }

    func setRetention(_ mode: OverlayConfig.RetentionMode) {
        config.retention = mode
        save()
    }

    func setIncognito(_ enabled: Bool) {
        config.incognito = enabled
        save()
    }

    func setReplyMode(_ mode: OverlayConfig.ReplyMode) {
        config.replyMode = mode
        save()
    }

    func setForegroundFeedbackCapture(_ enabled: Bool) {
        config.foregroundFeedbackCapture = enabled
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

    func isBundleExcluded(_ bundleId: String) -> Bool {
        config.excludedApps.contains(bundleId)
    }

    var isAppExcluded: Bool {
        guard let bundleId = ApplicationMonitor.shared.foregroundApp?.bundleId else { return false }
        return isBundleExcluded(bundleId)
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
