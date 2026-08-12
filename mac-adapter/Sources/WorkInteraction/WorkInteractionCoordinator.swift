import AppKit

enum WorkInteractionPhase: Equatable {
    case idle
    case grounding
    case intervening
    case awaitingFeedback
    case awaitingAuthority
    case executing
}

struct PendingRepositoryAction {
    let expiresAt: Date

    init?(proposal: ActionProposalPayload, receivedAt: Date = Date()) {
        guard proposal.kind == "repository_action",
              let allowedOperation = proposal.allowedOperation?.trimmingCharacters(in: .whitespacesAndNewlines),
              !allowedOperation.isEmpty,
              proposal.expiryMs > 0 else {
            return nil
        }

        self.expiresAt = receivedAt.addingTimeInterval(TimeInterval(proposal.expiryMs) / 1_000)
    }

    func approvalError(at date: Date = Date()) -> String? {
        date >= expiresAt
            ? "This approval window has expired. Ask Flyd to propose the action again."
            : nil
    }
}

struct PendingAction {
    let actionId: String
    let kind: String
    let description: String
    let workSessionRevision: Int
    let targetFingerprint: TargetFingerprintPayload
    let repositoryAuthority: PendingRepositoryAction?

    init(proposal: ActionProposalPayload, receivedAt: Date = Date()) {
        actionId = proposal.actionId
        kind = proposal.kind
        description = proposal.description
        workSessionRevision = proposal.workSessionRevision
        targetFingerprint = proposal.targetFingerprint
        repositoryAuthority = PendingRepositoryAction(proposal: proposal, receivedAt: receivedAt)
    }
}

enum RepositoryActionApprovalPolicy {
    static func presentationLines(for proposal: ActionProposalPayload) -> [String] {
        let operation = proposal.allowedOperation?.trimmingCharacters(in: .whitespacesAndNewlines)
        let operationLabel: String
        if let operation, !operation.isEmpty {
            operationLabel = operation
        } else {
            operationLabel = "unavailable — approval disabled"
        }
        return [
            "Allowed operation: \(operationLabel)",
            "Approval window: \(approvalWindowDescription(expiryMs: proposal.expiryMs))",
        ]
    }

    private static func approvalWindowDescription(expiryMs: Int) -> String {
        guard expiryMs > 0 else { return "expired — approval disabled" }
        let seconds = Int(ceil(Double(expiryMs) / 1_000))
        if seconds >= 60, seconds % 60 == 0 {
            let minutes = seconds / 60
            return "\(minutes) minute\(minutes == 1 ? "" : "s")"
        }
        return "\(seconds) second\(seconds == 1 ? "" : "s")"
    }
}

struct RepositoryActionRunIdentity: Equatable {
    let token: UUID
    let actionId: String
    let workSessionId: String
    let workSessionRevision: Int
    let invocationId: String?
    let interactionId: String?

    func matches(
        activeIdentity: RepositoryActionRunIdentity?,
        workSessionId: String?,
        workSessionRevision: Int,
        invocationId: String?,
        interactionId: String?
    ) -> Bool {
        activeIdentity == self
            && workSessionId == self.workSessionId
            && workSessionRevision == self.workSessionRevision
            && invocationId == self.invocationId
            && interactionId == self.interactionId
    }
}

final class WorkInteractionCoordinator {
    static let shared = WorkInteractionCoordinator()

    private var activePanels: [AugmentPanel] = []
    private var activeInvocationTask: Task<Void, Never>?
    private var repositoryActionTask: Task<Void, Never>?
    private weak var invocationPanel: InvocationPanel?
    private weak var executor: NativeExecutor?

    private(set) var phase: WorkInteractionPhase = .idle
    private(set) var sessionId: String?
    private(set) var sessionRevision: Int = 0
    private(set) var pendingAction: PendingAction?
    private var activeInvocationId: String?
    private var activeInteractionId: String?
    private var activeRepositoryActionIdentity: RepositoryActionRunIdentity?

    func configure(invocationPanel: InvocationPanel, executor: NativeExecutor) {
        self.invocationPanel = invocationPanel
        self.executor = executor
    }

    func beginSession(sessionId: String, revision: Int) {
        self.sessionId = sessionId
        self.sessionRevision = revision
        self.phase = .grounding
    }

    var isActive: Bool {
        phase != .idle
    }

    func renderWorkIntelligence(invocationId: String, invocationRevision: Int, response: FlydClient.ResolutionResponse) {
        cancelRepositoryActionExecution()
        pendingAction = nil
        guard let diagnosis = response.diagnosis, let intervention = response.intervention else {
            appendCoreLog("WorkInteractionCoordinator: work_intelligence response missing diagnosis or intervention")
            return
        }

        activeInvocationId = invocationId

        if let returnedSessionId = response.workSessionId, let returnedRevision = response.workSessionRevision {
            InvocationStateMachine.shared.adoptWorkSession(sessionId: returnedSessionId, revision: returnedRevision)
        }
        let workSession = InvocationStateMachine.shared.ensureWorkSession()
        sessionId = workSession.sessionId
        sessionRevision = workSession.revision
        activeInteractionId = response.resolutionId

        phase = .intervening

        let proposedAction = intervention.proposedAction.map { PendingAction(proposal: $0) }
        let content = buildInterventionContent(diagnosis: diagnosis, intervention: intervention, proposedAction: proposedAction)
        let options = buildInterventionOptions(intervention: intervention)

        let anchorRect = interventionAnchorRect(from: intervention)

        dismissActivePanels()

        guard let screen = NSScreen.main else { return }
        let visibleFrame = screen.visibleFrame

        let sizes = [AugmentPanel.measure(content: content, options: options)]
        let frames: [NSRect]
        if let anchor = anchorRect, !NSIsEmptyRect(anchor) {
            frames = AugmentPanel.stackedFrames(sizes: sizes, anchorRect: anchor, screenVisibleFrame: visibleFrame)
        } else {
            let cursorPoint = NSEvent.mouseLocation
            let anchor = NSRect(x: cursorPoint.x, y: cursorPoint.y - 24, width: 1, height: 24)
            frames = AugmentPanel.stackedFrames(sizes: sizes, anchorRect: anchor, screenVisibleFrame: visibleFrame)
        }

        let panel = AugmentPanel()
        let frame = frames.first ?? NSRect(x: 0, y: 0, width: AugmentPanel.panelWidth, height: 200)

        panel.onOptionSelected = { [weak self] optionIndex, label in
            self?.handleInterventionOption(optionIndex: optionIndex, label: label, intervention: intervention)
        }
        panel.onAccept = { [weak self] in
            self?.handleAccept()
        }
        panel.onReject = { [weak self] in
            self?.handleReject()
        }
        panel.onCorrect = { [weak self] correctionText in
            self?.handleCorrect(correctionText: correctionText)
        }
        panel.onFollowUp = { [weak self] followUpText in
            self?.handleFollowUp(followUpText: followUpText)
        }
        panel.onApproveAction = { [weak self] in
            self?.handleApproveAction()
        }

        let feedbackKind = feedbackKindForIntervention(intervention, proposedAction: proposedAction)

        panel.showWorkIntervention(
            content: content,
            diagnosis: diagnosis.primaryIssue.finding,
            strongerAlternative: intervention.strongerAlternative,
            options: options,
            feedbackKind: feedbackKind,
            frame: frame
        )

        activePanels = [panel]

        pendingAction = proposedAction

        appendCoreLog("WorkInteractionCoordinator: rendered work-intelligence intervention — session=\(sessionId?.prefix(8) ?? "none") rev=\(sessionRevision)")
    }

    func renderExecutionCards(invocationId: String, resolution: FlydClient.ResolutionResponse) {
        cancelRepositoryActionExecution()
        pendingAction = nil
        guard let augmentations = resolution.augmentations, !augmentations.isEmpty else {
            appendCoreLog("WorkInteractionCoordinator: requires_execution response missing augmentations")
            return
        }

        activeInvocationId = invocationId
        activeInteractionId = resolution.resolutionId

        let workSession = InvocationStateMachine.shared.ensureWorkSession()
        sessionId = workSession.sessionId
        sessionRevision = workSession.revision

        var commands: [(id: String, command: String, workingDirectory: String, explanation: String, isDestructive: Bool)] = []

        for aug in augmentations {
            guard let augCommands = aug.commands else { continue }
            for (i, cmd) in augCommands.enumerated() {
                commands.append((
                    id: "cmd-\(i)",
                    command: cmd.command,
                    workingDirectory: cmd.workingDirectory ?? ".",
                    explanation: cmd.explanation,
                    isDestructive: cmd.isDestructive ?? false
                ))
            }
        }

        guard !commands.isEmpty else {
            appendCoreLog("WorkInteractionCoordinator: no commands found in execution augmentations")
            return
        }

        dismissActivePanels()

        guard let screen = NSScreen.main else { return }
        let visibleFrame = screen.visibleFrame
        let cursorPoint = NSEvent.mouseLocation
        let anchor = NSRect(x: cursorPoint.x, y: cursorPoint.y - 24, width: 1, height: 24)

        let panel = AugmentPanel()
        let frame = AugmentPanel.stackedFrames(
            sizes: [AugmentPanel.measure(content: buildExecutionContent(commands: commands), options: nil)],
            anchorRect: anchor,
            screenVisibleFrame: visibleFrame
        ).first ?? NSRect(x: 0, y: 0, width: AugmentPanel.panelWidth, height: 400)

        panel.onOptionSelected = { [weak self] index, label in
            self?.handleExecutionOption(index: index, label: label, commands: commands)
        }

        panel.showExecutionCard(
            diagnosis: resolution.rationale,
            intervention: "Flyd recommends running the following commands:",
            commands: commands,
            frame: frame
        )

        activePanels = [panel]

        appendCoreLog("WorkInteractionCoordinator: rendered \(commands.count) execution commands")
    }

    private func handleExecutionOption(
        index: Int,
        label: String,
        commands: [(id: String, command: String, workingDirectory: String, explanation: String, isDestructive: Bool)]
    ) {
        if label == "Reject All" {
            appendCoreLog("WorkInteraction: all commands rejected")
            dismissActivePanels()
            phase = .idle
            return
        }

        let approvedCommands = commands.enumerated()
            .filter { label.contains("Approve:") && $0.offset == index }
            .map { i, cmd in
                ShellCommandPayload(
                    command: cmd.command,
                    workingDirectory: cmd.workingDirectory,
                    explanation: cmd.explanation,
                    isDestructive: cmd.isDestructive
                )
            }

        guard !approvedCommands.isEmpty else { return }

        appendCoreLog("WorkInteraction: approved \(approvedCommands.count) command(s)")

        let executionId = UUID().uuidString
        let workSession = InvocationStateMachine.shared.ensureWorkSession()

        dismissActivePanels()

        Task { [weak self] in
            guard let self = self else { return }

            guard let result = await FlydClient.shared.approveCommands(
                executionId: executionId,
                workSessionId: workSession.sessionId,
                interactionId: self.activeInteractionId ?? executionId,
                commands: approvedCommands,
                projectRoot: commands.first?.workingDirectory ?? "."
            ) else {
                await MainActor.run {
                    self.showExecutionResult(success: false, output: "Failed to submit commands to Core", commands: approvedCommands)
                }
                return
            }

            var pollResult = result
            let maxPolls = 120
            var pollCount = 0

            while (pollResult.status == "approved" || pollResult.status == "running") && pollCount < maxPolls {
                try? await Task.sleep(nanoseconds: 500_000_000)
                pollCount += 1
                if let updated = await FlydClient.shared.pollCommandOutput(executionId: executionId) {
                    pollResult = updated
                }
            }

            let finalResult = pollResult
            await MainActor.run {
                self.showExecutionResult(
                    success: finalResult.status == "completed",
                    output: self.formatExecutionOutput(finalResult),
                    commands: approvedCommands
                )
            }
        }
    }

    private func showExecutionResult(success: Bool, output: String, commands: [ShellCommandPayload]) {
        dismissActivePanels()

        let resultContent = """
        \(success ? "Commands completed successfully" : "Command execution failed or was incomplete")

        \(output)
        """

        guard let screen = NSScreen.main else { return }
        let visibleFrame = screen.visibleFrame
        let cursorPoint = NSEvent.mouseLocation
        let anchor = NSRect(x: cursorPoint.x, y: cursorPoint.y - 24, width: 1, height: 24)

        let panel = AugmentPanel()
        let frame = AugmentPanel.stackedFrames(
            sizes: [AugmentPanel.measure(content: resultContent, options: nil)],
            anchorRect: anchor,
            screenVisibleFrame: visibleFrame
        ).first ?? NSRect(x: 0, y: 0, width: AugmentPanel.panelWidth, height: 300)

        panel.show(
            content: resultContent,
            options: nil,
            kind: "explanation",
            frame: frame
        )

        activePanels = [panel]
        phase = .idle
    }

    private func formatExecutionOutput(_ result: ShellExecutionResultPayload) -> String {
        var parts: [String] = []
        for cmd in result.commands {
            parts.append("[\(cmd.commandId.prefix(8))] Exit code: \(cmd.exitCode?.description ?? "none")")
            if !cmd.stdout.isEmpty {
                parts.append(cmd.stdout)
            }
            if !cmd.stderr.isEmpty {
                parts.append(cmd.stderr)
            }
        }
        return parts.joined(separator: "\n")
    }

    private func buildExecutionContent(commands: [(id: String, command: String, workingDirectory: String, explanation: String, isDestructive: Bool)]) -> String {
        return "Shell execution requested — review and approve each command below."
    }

    func renderTaskPlan(invocationId: String, resolution: FlydClient.ResolutionResponse) {
        guard let taskPlan = resolution.taskPlan else { return }

        activeInvocationId = invocationId
        activeInteractionId = resolution.resolutionId

        let workSession = InvocationStateMachine.shared.ensureWorkSession()
        sessionId = workSession.sessionId
        sessionRevision = workSession.revision

        var taskContent = "\(resolution.rationale)\n\n"
        taskContent += "Task: \(taskPlan.intent)\n\n"
        taskContent += "Steps:\n"
        for step in taskPlan.steps {
            taskContent += "  [\(step.kind)] \(step.description)\n"
        }

        dismissActivePanels()

        guard let screen = NSScreen.main else { return }
        let visibleFrame = screen.visibleFrame
        let cursorPoint = NSEvent.mouseLocation
        let anchor = NSRect(x: cursorPoint.x, y: cursorPoint.y - 24, width: 1, height: 24)

        let options: [String] = ["Execute Plan", "Reject"]

        let panel = AugmentPanel()
        let frame = AugmentPanel.stackedFrames(
            sizes: [AugmentPanel.measure(content: taskContent, options: options)],
            anchorRect: anchor,
            screenVisibleFrame: visibleFrame
        ).first ?? NSRect(x: 0, y: 0, width: AugmentPanel.panelWidth, height: 400)

        panel.onOptionSelected = { [weak self] index, label in
            if label == "Execute Plan" {
                self?.executeTaskPlanSteps(taskPlan: taskPlan)
            } else {
                self?.dismissActivePanels()
                self?.phase = .idle
            }
        }

        panel.show(
            content: taskContent,
            options: options,
            kind: "control",
            frame: frame
        )

        activePanels = [panel]
        phase = .awaitingFeedback
    }

    private func executeTaskPlanSteps(taskPlan: TaskPlanResponsePayload) {
        dismissActivePanels()
        phase = .idle

        Task { [weak self] in
            guard let self = self else { return }

            var results: [String] = ["Task execution results:"]

            for step in taskPlan.steps {
                let description = step.description
                results.append("\n[\(description)]")

                switch step.kind {
                case "read_file":
                    let path = step.params["path"].flatMap { self.rawValueToString($0) } ?? ""
                    let result = await FlydClient.shared.readFile(path: path, projectRoot: ".")
                    if let result {
                        results.append(result.content.prefix(500).description)
                    } else {
                        results.append("Failed to read file")
                    }
                case "grep":
                    let pattern = step.params["pattern"].flatMap { self.rawValueToString($0) } ?? ""
                    let filePattern = step.params["filePattern"].flatMap { self.rawValueToString($0) }
                    let result = await FlydClient.shared.grepCodebase(pattern: pattern, projectRoot: ".", filePattern: filePattern)
                    if let matches = result?.matches, !matches.isEmpty {
                        for match in matches.prefix(10) {
                            results.append("\(match.file):\(match.line) — \(match.content)")
                        }
                    } else {
                        results.append("No matches found")
                    }
                case "shell_command":
                    let command = step.params["command"].flatMap { self.rawValueToString($0) } ?? ""
                    let execId = UUID().uuidString
                    let cmdPayload = ShellCommandPayload(
                        command: command,
                        workingDirectory: step.params["workingDirectory"].flatMap { self.rawValueToString($0) } ?? ".",
                        explanation: description,
                        isDestructive: step.params["isDestructive"].flatMap { self.rawValueToBool($0) } ?? false
                    )
                    guard let execResult = await FlydClient.shared.approveCommands(
                        executionId: execId,
                        workSessionId: self.sessionId ?? execId,
                        interactionId: self.activeInteractionId ?? execId,
                        commands: [cmdPayload],
                        projectRoot: "."
                    ) else { results.append("Command failed"); continue }

                    var pollResult = execResult
                    var pollCount = 0
                    while (pollResult.status == "approved" || pollResult.status == "running") && pollCount < 120 {
                        try? await Task.sleep(nanoseconds: 500_000_000)
                        pollCount += 1
                        if let updated = await FlydClient.shared.pollCommandOutput(executionId: execId) {
                            pollResult = updated
                        }
                    }
                    let output = pollResult.commands.first.map { $0.stdout + ($0.stderr.isEmpty ? "" : "\n\($0.stderr)") } ?? ""
                    results.append("Exit code: \(pollResult.commands.first?.exitCode?.description ?? "none")")
                    results.append(output.prefix(500).description)
                default:
                    results.append("Unknown step kind: \(step.kind)")
                }
            }

            let finalOutput = results.joined(separator: "\n")
            await MainActor.run {
                self.showExecutionResult(success: true, output: finalOutput, commands: [])
            }
        }
    }

    private func rawValueToString(_ val: RawJSONValue) -> String? {
        if case .string(let s) = val { return s }
        if case .int(let i) = val { return String(i) }
        if case .double(let d) = val { return String(d) }
        if case .bool(let b) = val { return String(b) }
        return nil
    }

    private func rawValueToBool(_ val: RawJSONValue) -> Bool? {
        if case .bool(let b) = val { return b }
        if case .string(let s) = val { return s == "true" ? true : s == "false" ? false : nil }
        return nil
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
        cancelRepositoryActionExecution()
        phase = .idle
        pendingAction = nil
        activeInvocationId = nil
        activeInteractionId = nil
        invocationPanel?.dismiss()
        dismissActivePanels()
    }

    func setActiveTask(_ task: Task<Void, Never>) {
        cancelActiveInvocation()
        activeInvocationTask = task
    }

    func hasPendingActionProposal() -> Bool {
        pendingAction != nil
    }

    private func buildInterventionContent(
        diagnosis: DiagnosisPayload,
        intervention: InterventionPayload,
        proposedAction: PendingAction?
    ) -> String {
        var parts: [String] = []

        let severityLabel: String
        switch diagnosis.primaryIssue.severity {
        case "critical": severityLabel = "Critical"
        case "high": severityLabel = "High priority"
        case "medium": severityLabel = "Worth noting"
        default: severityLabel = diagnosis.primaryIssue.severity.capitalized
        }

        parts.append("\(severityLabel): \(diagnosis.primaryIssue.finding)")

        if !diagnosis.primaryIssue.causalExplanation.isEmpty {
            parts.append(diagnosis.primaryIssue.causalExplanation)
        }

        if let observations = diagnosis.supportingObservations, !observations.isEmpty {
            for obs in observations {
                parts.append("• \(obs.finding)")
            }
        }

        if let contrary = diagnosis.contraryEvidence, !contrary.isEmpty {
            parts.append("Consider: \(contrary)")
        }

        if !intervention.content.isEmpty {
            parts.append(intervention.content)
        }

        if let action = intervention.proposedAction {
            parts.append("Proposed: \(action.description)")
            if action.kind == "repository_action" {
                if let root = action.targetFingerprint.repositoryRoot {
                    parts.append("Repository: \(root)\nBranch: \(action.targetFingerprint.branch ?? "unknown")")
                }
                parts.append("Finish condition: \(action.finishCondition)")
                parts.append(contentsOf: RepositoryActionApprovalPolicy.presentationLines(for: action))
                if proposedAction?.repositoryAuthority == nil {
                    parts.append("Approval unavailable: Core did not provide valid operation authority and an active approval window.")
                }
            }
        }

        return parts.joined(separator: "\n\n")
    }

    private func buildInterventionOptions(intervention: InterventionPayload) -> [String]? {
        guard let options = intervention.options, !options.isEmpty else { return nil }
        return options.map { $0.label }
    }

    private func interventionKind(from intervention: InterventionPayload) -> String {
        switch intervention.kind {
        case "critique": return "explanation"
        case "suggestion": return "annotation"
        default: return "explanation"
        }
    }

    private func feedbackKindForIntervention(
        _ intervention: InterventionPayload,
        proposedAction: PendingAction?
    ) -> AugmentPanel.FeedbackKind {
        if let action = intervention.proposedAction,
           action.kind != "repository_action" || proposedAction?.repositoryAuthority != nil {
            return .actionProposal
        }
        return .intervention
    }

    private func interventionAnchorRect(from intervention: InterventionPayload) -> NSRect? {
        guard let grounding = intervention.visualGrounding else { return nil }
        let bounds = grounding.regionDescription.bounds
        return NSRect(x: CGFloat(bounds.x), y: CGFloat(bounds.y), width: CGFloat(bounds.width), height: CGFloat(bounds.height))
    }

    func handleInterventionOption(optionIndex: Int, label: String, intervention: InterventionPayload) {
        switch label {
        case "Correct":
            handleCorrect(correctionText: "")
            return
        case "Follow-up":
            handleFollowUp(followUpText: "")
            return
        case "Approve Action":
            handleApproveAction()
            return
        default:
            break
        }

        guard let options = intervention.options, optionIndex < options.count else { return }
        appendCoreLog("WorkInteraction: option '\(label)' selected")
        sessionRevision = InvocationStateMachine.shared.incrementWorkSessionRevision()
        sendFeedback(status: "option_selected", correction: "selected: \(label)")
    }

    private func handleAccept() {
        appendCoreLog("WorkInteraction: accepted")
        phase = .idle
        sendFeedback(status: "accepted", correction: nil)
        dismissActivePanels()
    }

    private func handleReject() {
        appendCoreLog("WorkInteraction: rejected")
        phase = .idle
        sendFeedback(status: "rejected", correction: nil)
        dismissActivePanels()
    }

    private func handleCorrect(correctionText: String) {
        appendCoreLog("WorkInteraction: corrected — \(correctionText)")
        sessionRevision = InvocationStateMachine.shared.incrementWorkSessionRevision()
        sendFeedback(status: "rejected", correction: correctionText)
        dismissActivePanels()
    }

    private func handleFollowUp(followUpText: String) {
        appendCoreLog("WorkInteraction: follow-up — \(followUpText)")
        sessionRevision = InvocationStateMachine.shared.incrementWorkSessionRevision()
        sendFeedback(status: "follow_up", correction: followUpText)
        dismissActivePanels()
    }

    private func handleApproveAction() {
        guard let pending = pendingAction, let sessionId = sessionId else { return }
        if pending.kind == "repository_action", pending.repositoryAuthority == nil {
            pendingAction = nil
            phase = .idle
            return
        }
        if let error = pending.repositoryAuthority?.approvalError() {
            pendingAction = nil
            phase = .idle
            dismissActivePanels()
            showRepositoryActionResult(nil, fallback: error)
            return
        }
        appendCoreLog("WorkInteraction: action approved — \(pending.actionId)")
        pendingAction = nil
        phase = .awaitingAuthority
        dismissActivePanels()

        guard pending.kind == "repository_action" else {
            phase = .idle
            sendFeedback(status: "failed", correction: "No verified executor exists for action \(pending.actionId)")
            return
        }

        cancelRepositoryActionExecution()
        let identity = RepositoryActionRunIdentity(
            token: UUID(),
            actionId: pending.actionId,
            workSessionId: sessionId,
            workSessionRevision: pending.workSessionRevision,
            invocationId: activeInvocationId,
            interactionId: activeInteractionId
        )
        activeRepositoryActionIdentity = identity
        repositoryActionTask = Task { [weak self] in
            guard let self = self else { return }
            let approval = await FlydClient.shared.approveRepositoryAction(
                workSessionId: sessionId,
                actionId: pending.actionId,
                workSessionRevision: pending.workSessionRevision
            )
            guard !Task.isCancelled,
                  await self.repositoryActionIsCurrent(identity) else { return }
            guard let approval else {
                await MainActor.run {
                    guard self.activeRepositoryActionIdentity == identity else { return }
                    self.finishRepositoryAction(identity)
                    self.showRepositoryActionResult(nil, fallback: "Core rejected or could not mint the repository action grant.")
                }
                return
            }

            let beganExecution = await MainActor.run {
                guard self.activeRepositoryActionIdentity == identity else { return false }
                self.phase = .executing
                return true
            }
            guard beganExecution, !Task.isCancelled else { return }
            let result = await FlydClient.shared.executeRepositoryAction(
                workSessionId: sessionId,
                actionGrantId: approval.actionGrantId,
                workSessionRevision: approval.workSessionRevision
            )
            guard !Task.isCancelled,
                  await self.repositoryActionIsCurrent(identity) else { return }
            await MainActor.run {
                guard self.activeRepositoryActionIdentity == identity else { return }
                self.finishRepositoryAction(identity)
                self.showRepositoryActionResult(result, fallback: "Repository execution did not return a result.")
            }
        }
    }

    private func repositoryActionIsCurrent(_ identity: RepositoryActionRunIdentity) async -> Bool {
        await MainActor.run {
            identity.matches(
                activeIdentity: self.activeRepositoryActionIdentity,
                workSessionId: self.sessionId,
                workSessionRevision: self.sessionRevision,
                invocationId: self.activeInvocationId,
                interactionId: self.activeInteractionId
            )
        }
    }

    private func finishRepositoryAction(_ identity: RepositoryActionRunIdentity) {
        guard activeRepositoryActionIdentity == identity else { return }
        repositoryActionTask = nil
        activeRepositoryActionIdentity = nil
    }

    private func cancelRepositoryActionExecution() {
        repositoryActionTask?.cancel()
        repositoryActionTask = nil
        activeRepositoryActionIdentity = nil
    }

    private func showRepositoryActionResult(_ result: FlydClient.RepositoryActionResponse?, fallback: String) {
        dismissActivePanels()
        let content: String
        if let result = result {
            let verdict = result.verified ? "Verified improvement" : (result.changedFiles.isEmpty ? "Failed" : "Partial result")
            let files = result.changedFiles.isEmpty ? "No changed files" : result.changedFiles.joined(separator: "\n")
            let handoff = result.handoffLocation.map { "\nPreserved for handoff: \($0)" } ?? ""
            let error = result.error.map { "\n\n\($0)" } ?? ""
            content = "\(verdict)\n\n\(files)\n\nChecks: \(result.checksPerformed.joined(separator: ", "))\(handoff)\(error)"
        } else {
            content = fallback
        }

        guard let screen = NSScreen.main else { phase = .idle; return }
        let cursorPoint = NSEvent.mouseLocation
        let anchor = NSRect(x: cursorPoint.x, y: cursorPoint.y - 24, width: 1, height: 24)
        let panel = AugmentPanel()
        let frame = AugmentPanel.stackedFrames(
            sizes: [AugmentPanel.measure(content: content, options: nil)],
            anchorRect: anchor,
            screenVisibleFrame: screen.visibleFrame
        ).first ?? NSRect(x: 0, y: 0, width: AugmentPanel.panelWidth, height: 320)
        panel.show(content: content, options: nil, kind: "explanation", frame: frame)
        activePanels = [panel]
        phase = .idle
    }

    private func sendFeedback(status: String, correction: String?) {
        guard let resolutionId = activeInteractionId, let invocationId = activeInvocationId else { return }
        Task {
            await FlydClient.shared.sendOutcome(
                resolutionId: resolutionId,
                invocationId: invocationId,
                status: status,
                correction: correction
            )
        }
    }

    func clearOnContextChange() {
        cancelRepositoryActionExecution()
        guard phase != .idle else { return }
        appendCoreLog("WorkInteraction: context changed — clearing pending actions")
        pendingAction = nil
        phase = .idle
        DispatchQueue.main.async { [weak self] in
            self?.dismissActivePanels()
        }
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
