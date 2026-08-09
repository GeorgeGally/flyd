import Foundation

enum RequestTimeoutPolicy {
    static func timeout(for path: String) -> TimeInterval {
        path == "/manifest" ? 180 : 60
    }
}
