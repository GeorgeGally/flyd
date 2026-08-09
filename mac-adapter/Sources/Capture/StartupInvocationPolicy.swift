import Foundation

enum StartupInvocationPolicy {
    static let acceptanceArgument = "--invoke-on-launch"
    static let acceptanceFocusDelay: TimeInterval = 10

    static func shouldInvoke(arguments: [String]) -> Bool {
        arguments.contains(acceptanceArgument)
    }
}
