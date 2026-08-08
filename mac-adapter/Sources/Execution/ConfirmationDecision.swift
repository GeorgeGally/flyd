import Foundation

struct ConfirmationDecision {
    enum Reason: String {
        case executionConsequence = "execution_consequence"
        case destructiveReplacement = "destructive_replacement"
        case actionGrantInvalid = "action_grant_invalid"
        case targetDrifted = "target_drifted"

        var displayName: String {
            switch self {
            case .executionConsequence: return "external consequence"
            case .destructiveReplacement: return "large replacement"
            case .actionGrantInvalid: return "action grant invalid"
            case .targetDrifted: return "target drifted"
            }
        }
    }

    let reasons: [Reason]

    var requiresConfirmation: Bool { return !reasons.isEmpty }
}
