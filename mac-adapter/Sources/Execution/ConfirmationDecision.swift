import Foundation

struct ConfirmationDecision {
    enum Reason: String {
        case executionConsequence = "execution_consequence"
        case destructiveReplacement = "destructive_replacement"

        var displayName: String {
            switch self {
            case .executionConsequence: return "external consequence"
            case .destructiveReplacement: return "large replacement"
            }
        }
    }

    let reasons: [Reason]

    var requiresConfirmation: Bool { return !reasons.isEmpty }
}
