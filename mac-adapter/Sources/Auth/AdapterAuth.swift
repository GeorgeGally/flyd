import Foundation
import Security

final class AdapterAuth {
    static let shared = AdapterAuth()

    func credential() -> String {
        if let existing = readTokenFromFile() {
            return existing
        }

        let newCredential = generateCredential()
        writeTokenToFile(newCredential)
        return newCredential
    }

    private func generateCredential() -> String {
        var bytes = [UInt8](repeating: 0, count: 32)
        _ = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
        return bytes.map { String(format: "%02x", $0) }.joined()
    }

    private func readTokenFromFile() -> String? {
        let tokenPath = tokenFileURL()
        guard let token = try? String(contentsOf: tokenPath, encoding: .utf8)
            .trimmingCharacters(in: .whitespacesAndNewlines),
              !token.isEmpty else { return nil }

        enforceTokenFilePermissions(at: tokenPath)
        return token
    }

    private func writeTokenToFile(_ token: String) {
        let tokenPath = tokenFileURL()
        let overlayDir = tokenPath.deletingLastPathComponent()
        try? FileManager.default.createDirectory(at: overlayDir, withIntermediateDirectories: true)
        try? token.write(to: tokenPath, atomically: true, encoding: .utf8)
        enforceTokenFilePermissions(at: tokenPath)
    }

    private func tokenFileURL() -> URL {
        FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".flyd/overlay/auth-token")
    }

    private func enforceTokenFilePermissions(at tokenPath: URL) {
        try? FileManager.default.setAttributes(
            [.posixPermissions: 0o600],
            ofItemAtPath: tokenPath.path
        )
    }
}
