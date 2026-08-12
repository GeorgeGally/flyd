import Foundation

enum RequestTimeoutPolicy {
    static func timeout(for path: String) -> TimeInterval {
        switch path {
        case "/manifest":
            return 180
        default:
            return 60
        }
    }
}
