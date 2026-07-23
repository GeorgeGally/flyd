import Foundation
import Security

final class AdapterAuth {
    static let shared = AdapterAuth()

    private let keychainService = "com.flyd.overlay.adapter"
    private let keychainAccount = "adapter-credential"

    func credential() -> String {
        if let existing = readCredential() {
            return existing
        }
        let newCredential = generateCredential()
        storeCredential(newCredential)
        return newCredential
    }

    private func readCredential() -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: keychainService,
            kSecAttrAccount as String: keychainAccount,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]

        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        guard status == errSecSuccess, let data = result as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    private func storeCredential(_ credential: String) {
        guard let data = credential.data(using: .utf8) else { return }

        let addQuery: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: keychainService,
            kSecAttrAccount as String: keychainAccount,
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlock,
        ]

        let addStatus = SecItemAdd(addQuery as CFDictionary, nil)

        if addStatus == errSecDuplicateItem {
            let updateQuery: [String: Any] = [
                kSecClass as String: kSecClassGenericPassword,
                kSecAttrService as String: keychainService,
                kSecAttrAccount as String: keychainAccount,
            ]
            let updateAttributes: [String: Any] = [
                kSecValueData as String: data,
            ]
            SecItemUpdate(updateQuery as CFDictionary, updateAttributes as CFDictionary)
        }
    }

    private func generateCredential() -> String {
        var bytes = [UInt8](repeating: 0, count: 32)
        _ = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
        let credential = bytes.map { String(format: "%02x", $0) }.joined()

        writeTokenToFile(credential)
        return credential
    }

    private func writeTokenToFile(_ token: String) {
        let home = FileManager.default.homeDirectoryForCurrentUser
        let overlayDir = home.appendingPathComponent(".flyd/overlay")
        try? FileManager.default.createDirectory(at: overlayDir, withIntermediateDirectories: true)
        let tokenPath = overlayDir.appendingPathComponent("auth-token")
        try? token.write(to: tokenPath, atomically: true, encoding: .utf8)
        var attrs = try? FileManager.default.attributesOfItem(atPath: tokenPath.path)
        attrs?[.posixPermissions] = 0o600
        try? FileManager.default.setAttributes(attrs ?? [:], ofItemAtPath: tokenPath.path)
    }
}
