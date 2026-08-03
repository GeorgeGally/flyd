import AppKit

/// Coordinates the full work-intelligence interaction lifecycle:
/// capture → Core resolution → augmentation → feedback → closeout.
/// Extracted from main.swift so the entry point stays thin.
final class WorkInteractionCoordinator {
    static let shared = WorkInteractionCoordinator()

    private var activePanels: [AugmentPanel] = []
    private var activeInvocationTask: Task<Void, Never>?
    private weak var invocationPanel: InvocationPanel?
    private weak var executor: NativeExecutor?

    func configure(invocationPanel: InvocationPanel, executor: NativeExecutor) {
        self.invocationPanel = invocationPanel
        self.executor = executor
    }

    func showAugmentations(_ augmentations: [AugmentPayload], anchorRect: NSRect? = nil) {
        dismissActivePanels()

        guard let screen = NSScreen.main else { return }
        let visibleFrame = screen.visibleFrame

        let sizes = augmentations.map { augmentation in
            AugmentPanel.measure(content: augmentation.content, options: augmentation.options)
        }

        let frames: [NSRect]
        if let anchor = anchorRect, !NSIsEmptyRect(anchor) {
            frames = AugmentPanel.stackedFrames(sizes: sizes, anchorRect: anchor, screenVisibleFrame: visibleFrame)
        } else {
            let cursorPoint = NSEvent.mouseLocation
            let anchor = NSRect(x: cursorPoint.x, y: cursorPoint.y - 24, width: 1, height: 24)
            frames = AugmentPanel.stackedFrames(sizes: sizes, anchorRect: anchor, screenVisibleFrame: visibleFrame)
        }

        for (index, augmentation) in augmentations.enumerated() {
            let panel = AugmentPanel()
            let frame = index < frames.count ? frames[index] : frames.last!

            panel.onOptionSelected = { [weak self] optionIndex, label in
                self?.handleOptionSelected(augmentationIndex: index, optionIndex: optionIndex, label: label)
            }

            panel.show(
                content: augmentation.content,
                options: augmentation.options,
                kind: augmentation.kind,
                frame: frame
            )

            activePanels.append(panel)
        }
    }

    func dismissActivePanels() {
        for panel in activePanels {
            panel.dismiss()
        }
        activePanels.removeAll()
    }

    func cancelActiveInvocation() {
        activeInvocationTask?.cancel()
        activeInvocationTask = nil
        invocationPanel?.dismiss()
        dismissActivePanels()
    }

    func setActiveTask(_ task: Task<Void, Never>) {
        cancelActiveInvocation()
        activeInvocationTask = task
    }

    private func handleOptionSelected(augmentationIndex: Int, optionIndex: Int, label: String) {
        appendCoreLog("WorkInteraction: option \(optionIndex) selected on augmentation \(augmentationIndex): \(label)")
    }

    struct AugmentPayload {
        let kind: String
        let content: String
        let placement: String
        let options: [String]?
        let temporalSpan: TemporalSpan?
    }

    struct TemporalSpan {
        let delayMs: Int
        let durationMs: Int
    }

    struct ResolutionResponse {
        let resolutionId: String
        let invocationId: String
        let environmentRevision: Int
        let mode: String
        let rationale: String
        let augmentations: [AugmentPayload]?
        let requiresConfirmation: Bool?
    }
}
