import type { CurrentWork, Diagnosis, Intervention, ActionProposal, ShellCommand, FileOperation } from './types.js';
import type { DomainStandard } from './domain-standards.js';

export function buildWorkIntelligencePrompt(params: {
  currentWork: CurrentWork;
  domainStandard: DomainStandard;
  intent: string;
  conversationHistory?: string;
  memoryContext?: string;
}): string {
  const { currentWork, domainStandard, intent, conversationHistory, memoryContext } = params;

  const projectLine = `Project: ${currentWork.project.value} (confidence: ${currentWork.project.confidence}${currentWork.project.isHypothesis ? ', hypothesis' : ''})`;
  const projectSourceLine = currentWork.project.source === 'foreground' && currentWork.project.confidence === 'high'
    ? `You are currently in the ${currentWork.project.value} repository. This is authoritative foreground evidence — work from this context.`
    : `Project context is uncertain. Ask if the project matters.`;
  const objectiveLine = `Objective: ${currentWork.objective.value} (confidence: ${currentWork.objective.confidence}${currentWork.objective.isHypothesis ? ', hypothesis' : ''})`;
  const artifactLine = `Artifact: ${currentWork.artifact.title} (${currentWork.artifact.kind})`;
  const stageLine = `Stage: ${currentWork.stage.value} (confidence: ${currentWork.stage.confidence})`;
  const evidenceLine = `Evidence: foreground=${currentWork.evidenceSummary.foregroundApp}, repo=${currentWork.evidenceSummary.repositoryRoot || 'none'}, branch=${currentWork.evidenceSummary.branch || 'none'}`;
  const repoLine = currentWork.evidenceSummary.repositoryRoot
    ? `Repository root: ${currentWork.evidenceSummary.repositoryRoot} (branch: ${currentWork.evidenceSummary.branch || 'unknown'})`
    : '';

  const recentCommitsLine = currentWork.evidenceSummary.recentCommits?.length
    ? `Recent commits:\n${currentWork.evidenceSummary.recentCommits.map(c => `  ${c}`).join('\n')}`
    : '';

  const changedFilesLine = currentWork.evidenceSummary.changedFiles?.length
    ? `Changed files (uncommitted):\n${currentWork.evidenceSummary.changedFiles.map(f => `  ${f}`).join('\n')}`
    : currentWork.evidenceSummary.statusDigest === 'dirty'
      ? 'Working tree is dirty (uncommitted changes present).'
      : '';

  const openDocsLine = currentWork.evidenceSummary.openDocuments?.length
    ? `Open documents:\n${currentWork.evidenceSummary.openDocuments.map(d => `  ${d}`).join('\n')}`
    : '';

  const uncertaintyBlock = currentWork.uncertainty.length > 0
    ? `\nUNKNOWN FIELDS:\n${currentWork.uncertainty.map(u => `- ${u.field}: ${u.reason}`).join('\n')}`
    : '';

  const conversationBlock = conversationHistory
    ? `\nRECENT CONVERSATION:\n${conversationHistory}`
    : '';

  const memoryBlock = memoryContext
    ? `\nPERSONAL MEMORY (background context — foreground evidence is authoritative):\n${memoryContext}`
    : '';

  return `You are Flyd, an intelligent work assistant. The user has invoked you while working. Your job is to understand the work, identify the most important issue or opportunity, and deliver ONE high-leverage intervention.

FOREGROUND CONTEXT (authoritative — this is what the user is doing RIGHT NOW):
- ${projectLine}
- ${projectSourceLine}${repoLine ? `\n- ${repoLine}` : ''}${recentCommitsLine ? `\n\nRECENT ACTIVITY:\n${recentCommitsLine}` : ''}${changedFilesLine ? `\n\nCURRENT STATE:\n${changedFilesLine}` : ''}${openDocsLine ? `\n\nOPEN DOCUMENTS:\n${openDocsLine}` : ''}
- ${objectiveLine}
- ${artifactLine}
- ${stageLine}
- ${evidenceLine}${uncertaintyBlock}

DOMAIN: ${domainStandard.domain}
Evaluation dimensions:
${domainStandard.evaluationDimensions.map(d => `  - ${d}`).join('\n')}

GROUND RULES:
- The foreground context is authoritative. If your memory suggests a different project, it is stale — use the foreground.
- Lead with the ONE most important issue, not a list.
- Explain WHY it matters — the causal link between the issue and the outcome.
- Propose ONE stronger alternative or next move.
- Distinguish fact from inference. Name uncertainty where it exists.
- If a field is unknown and material, ask ONE clarifying question. Otherwise proceed with what you have.
- Do not praise, narrate process, repeat the request, or pad.
${domainStandard.avoidances.map(a => `  - ${a}`).join('\n')}${conversationBlock}${memoryBlock}

USER INTENT: "${intent}"

Respond with ONLY a JSON object in this format:
{
  "grounding_notes": "<what you understand, what you don't, what assumptions you're making>",
  "diagnosis": {
    "primary_issue": {
      "category": "<quality|correctness|completeness|clarity|strategy|risk|structure|audience>",
      "severity": "<critical|improvement|note>",
      "finding": "<the specific issue in the user's language>",
      "causal_explanation": "<why this matters — the consequence>",
      "domain": "<${domainStandard.domain}>",
      "evidence_refs": ["foreground_element_value"]
    },
    "contrary_evidence": "<if something in the work contradicts your diagnosis, state it here or null>"
  },
  "intervention": {
    "kind": "<insight|critique|reframe|alternative|comparison|question|recommendation|proposedEdit|actionPlan|shellExecute|fileOperation|taskPlan>",
    "content": "<the intervention delivered in clear language the user can act on>",
    "stronger_alternative": "<the specific alternative or next move, or null if not applicable>",
    "options": [
      {"label": "<short action label>", "description": "<what happens if chosen>", "consequence": "<expected result or null>"}
    ],
    "proposed_action": {
      "kind": "<text_edit|repository_action|shell_execute|file_read|file_grep|file_write|task_plan>",
      "description": "<what the action will do>",
      "shell_commands": [
        {"command": "<exact command to run>", "working_directory": "<absolute path>", "explanation": "<one-line description for approval UI>", "is_destructive": <true|false>}
      ],
      "file_operations": [
        {"kind": "<read|grep|write>", "path": "<file path relative to project>", "pattern": "<grep pattern if kind=grep>", "content": "<content to write if kind=write>", "explanation": "<why this operation>"}
      ],
      "task_intent": "<if kind=task_plan, the intent to plan a multi-step task for>"
    }
  }
}`;
}

export interface WorkIntelligenceResult {
  groundingNotes: string;
  diagnosis: Diagnosis;
  intervention: Intervention;
}

export function parseWorkIntelligenceResponse(raw: string): WorkIntelligenceResult {
  let jsonStr = raw.trim();
  const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    jsonStr = jsonMatch[0];
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(jsonStr) as Record<string, unknown>;
  } catch {
    return fallbackResult('Model response was not valid JSON');
  }

  const g = (parsed.grounding_notes as string) || '';
  const d = (parsed.diagnosis as Record<string, unknown>) || {};
  const pi = (d.primary_issue as Record<string, unknown>) || {};
  const iv = (parsed.intervention as Record<string, unknown>) || {};

  const result: WorkIntelligenceResult = {
    groundingNotes: g,
    diagnosis: {
      primaryIssue: {
        category: (pi.category as Diagnosis['primaryIssue']['category']) || 'quality',
        severity: (pi.severity as Diagnosis['primaryIssue']['severity']) || 'improvement',
        finding: (pi.finding as string) || 'Assessment unavailable from model response',
        causalExplanation: (pi.causal_explanation as string) || '',
        domain: (pi.domain as Diagnosis['primaryIssue']['domain']) || 'writing',
        evidenceRefs: Array.isArray(pi.evidence_refs) ? pi.evidence_refs as string[] : [],
      },
      contraryEvidence: (d.contrary_evidence as string) || undefined,
    },
    intervention: {
      kind: (iv.kind as Intervention['kind']) || 'insight',
      content: (iv.content as string) || (pi.finding as string) || 'Analysis produced no usable intervention.',
      strongerAlternative: (iv.stronger_alternative as string) || undefined,
      options: Array.isArray(iv.options)
        ? (iv.options as Record<string, string>[]).map((o) => ({
            label: o.label || '',
            description: o.description || '',
            consequence: o.consequence || undefined,
          }))
        : undefined,
      proposedAction: parseProposedAction(iv.proposed_action as Record<string, unknown> | undefined),
    },
  };

  return result;
}

function fallbackResult(reason: string): WorkIntelligenceResult {
  return {
    groundingNotes: reason,
    diagnosis: {
      primaryIssue: {
        category: 'quality',
        severity: 'improvement',
        finding: 'Unable to produce a reliable diagnosis from the current context.',
        causalExplanation: reason,
        domain: 'strategy',
        evidenceRefs: [],
      },
    },
    intervention: {
      kind: 'insight',
      content: `I couldn't produce a structured response. ${reason}. Please try again with a more specific question or different context.`,
    },
  };
}

function parseProposedAction(raw: Record<string, unknown> | undefined): ActionProposal | undefined {
  if (!raw || typeof raw !== 'object') return undefined;

  const kind = raw.kind as string;
  const validKinds = ['text_edit', 'repository_action', 'shell_execute', 'file_read', 'file_grep', 'file_write', 'task_plan'];
  if (!kind || !validKinds.includes(kind)) return undefined;

  const action: ActionProposal = {
    actionId: `action-${Date.now()}`,
    kind: kind as ActionProposal['kind'],
    description: (raw.description as string) || '',
    targetFingerprint: {},
    workSessionRevision: 0,
    diagnosedIssueId: '',
    finishCondition: (raw.description as string) || '',
    expiryMs: 120000,
    allowedOperation: kind === 'shell_execute' ? 'shell_execute'
      : kind === 'file_read' ? 'shell_execute'
      : kind === 'file_grep' ? 'shell_execute'
      : kind === 'file_write' ? 'shell_execute'
      : kind === 'task_plan' ? 'shell_execute'
      : kind === 'repository_action' ? 'repository_work'
      : 'replace_text',
  };

  if (kind === 'shell_execute' && Array.isArray(raw.shell_commands)) {
    action.shellCommands = (raw.shell_commands as Record<string, unknown>[]).map((cmd, i) => ({
      commandId: `cmd-${i}`,
      command: (cmd.command as string) || '',
      workingDirectory: (cmd.working_directory as string) || process.cwd(),
      explanation: (cmd.explanation as string) || '',
      isDestructive: Boolean(cmd.is_destructive),
    }));
  }

  if (['file_read', 'file_grep', 'file_write'].includes(kind) && Array.isArray(raw.file_operations)) {
    action.fileOperations = (raw.file_operations as Record<string, unknown>[]).map((op, i) => ({
      kind: (op.kind as FileOperation['kind']) || 'read',
      path: (op.path as string) || '',
      pattern: (op.pattern as string) || undefined,
      content: (op.content as string) || undefined,
      explanation: (op.explanation as string) || `File operation ${i + 1}`,
    }));
  }

  if (kind === 'task_plan') {
    action.taskIntent = (raw.task_intent as string) || (raw.description as string) || '';
  }

  return action;
}
