import Foundation

enum ComposeTarget {
    private static let origin = "http://127.0.0.1:3000"
    private static let fallback = "\(origin)/surface"

    static func url(serverValue: String?, resolutionId: String) -> String {
        if let alias = safeResolutionAlias(resolutionId) {
            return "\(origin)/surface/\(alias)"
        }

        guard let serverValue,
              let url = URL(string: serverValue),
              url.scheme == "http",
              url.host == "127.0.0.1",
              url.port == 3000,
              url.user == nil,
              url.password == nil,
              url.query == nil,
              url.fragment == nil,
              isAllowedSurfacePath(url.path)
        else {
            return fallback
        }

        return url.absoluteString
    }

    private static func safeResolutionAlias(_ value: String) -> String? {
        let normalized = value.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard normalized.count >= 8, normalized.count <= 64 else { return nil }
        let allowed = CharacterSet(charactersIn: "0123456789abcdef-")
        guard normalized.unicodeScalars.allSatisfy({ allowed.contains($0) }) else { return nil }
        return normalized
    }

    private static func isAllowedSurfacePath(_ path: String) -> Bool {
        if path == "/surface" || path == "/surface/" { return true }
        guard path.hasPrefix("/surface/") else { return false }
        let suffix = String(path.dropFirst("/surface/".count))
        return safeResolutionAlias(suffix) != nil
    }
}
