import Foundation

/// Which shortcut events Flyd saw and what each one did, so a surprise (say,
/// the text bar opening on Fn+Control) can be traced to the real key events.
/// Only routed chord events and handler names: no keystrokes, no text.
enum ShortcutLog {
    static let url = FileManager.default.homeDirectoryForCurrentUser
        .appendingPathComponent(".flyd/overlay/shortcut-events.log", isDirectory: false)
    private static let maxBytes = 256 * 1024
    private static let queue = DispatchQueue(label: "flyd.shortcut-log")

    static func record(_ message: String) {
        let line = "[\(ISO8601DateFormatter().string(from: Date()))] \(message)\n"
        queue.async {
            let manager = FileManager.default
            try? manager.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
            if let size = (try? manager.attributesOfItem(atPath: url.path))?[.size] as? Int, size > maxBytes {
                try? manager.removeItem(at: url)
            }
            if !manager.fileExists(atPath: url.path) { manager.createFile(atPath: url.path, contents: nil) }
            guard let handle = try? FileHandle(forWritingTo: url), let data = line.data(using: .utf8) else { return }
            handle.seekToEndOfFile()
            handle.write(data)
            try? handle.close()
        }
    }
}
