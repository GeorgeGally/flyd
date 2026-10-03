/// A resolution that arrives with nothing the adapter can put on screen must end in a
/// visible failure. Otherwise the busy indicator clears and Flyd looks like it never answered.
enum ResolutionDisplayPolicy {
    static let nothingToShow = "Flyd came back empty - try again"
    static let superseded = "Things changed while Flyd was thinking - try again"

    /// The failure to show instead of the answer, or nil when the resolution renders.
    static func failure(for resolution: FlydClient.ResolutionResponse) -> String? {
        let augmentations = resolution.augmentations ?? []
        switch resolution.mode {
        case "native":
            return resolution.operations.isEmpty ? nothingToShow : nil
        case "requires_augment", "requires_execution":
            return augmentations.isEmpty ? nothingToShow : nil
        case "work_intelligence":
            return resolution.diagnosis == nil || resolution.intervention == nil ? nothingToShow : nil
        case "requires_task":
            return resolution.taskPlan == nil ? nothingToShow : nil
        case "requires_compose":
            return nil
        default:
            return nothingToShow
        }
    }
}
