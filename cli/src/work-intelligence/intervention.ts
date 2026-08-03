import type { CurrentWork, Diagnosis, Intervention, ActionProposal } from './types.js';
import type { DomainStandard } from './domain-standards.js';

export function buildWorkIntelligencePrompt(params: {
  currentWork: CurrentWork;
  domainStandard: DomainStandard;
  intent: string;
  conversationHistory?: string;
}): string {
  const { currentWork, domainStandard, intent, conversationHistory } = params;

  const projectLine = `Project: ${currentWork.project.value} (confidence: ${currentWork.project.confidence}${currentWork.project.isHypothesis ? ', hypothesis' : ''})`;
  const objectiveLine = `Objective: ${currentWork.objective.value} (confidence: ${currentWork.objective.confidence}${currentWork.objective.isHypothesis ? ', hypothesis' : ''})`;
  const artifactLine = `Artifact: ${currentWork.artifact.title} (${currentWork.artifact.kind})`;
  const stageLine = `Stage: ${currentWork.stage.value} (confidence: ${currentWork.stage.confidence})`;
  const evidenceLine = `Evidence: foreground=${currentWork.evidenceSummary.foregroundApp}, repo=${currentWork.evidenceSummary.repositoryRoot || 'none'}, branch=${currentWork.evidenceSummary.branch || 'none'}`;

  const uncertaintyBlock = currentWork.uncertainty.length > 0
    ? `\nUNKNOWN FIELDS:\n${currentWork.uncertainty.map(u => `- ${u.field}: ${u.reason}`).join('\n')}`
    : '';

  const conversationBlock = conversationHistory
    ? `\nRECENT CONVERSATION:\n${conversationHistory}`
    : '';

  return `You are Flyd, an intelligent work assistant. The user has invoked you while working. Your job is to understand the work, identify the most important issue or opportunity, and deliver ONE high-leverage intervention.

CURRENT WORK:
- ${projectLine}
- ${objectiveLine}
- ${artifactLine}
- ${stageLine}
- ${evidenceLine}${uncertaintyBlock}

DOMAIN: ${domainStandard.domain}
Evaluation dimensions:
${domainStandard.evaluationDimensions.map(d => `  - ${d}`).join('\n')}

GROUND RULES:
- Lead with the ONE most important issue, not a list.
- Explain WHY it matters — the causal link between the issue and the outcome.
- Propose ONE stronger alternative or next move.
- Distinguish fact from inference. Name uncertainty where it exists.
- If a field is unknown and material, ask ONE clarifying question. Otherwise proceed with what you have.
- Do not praise, narrate process, repeat the request, or pad.
${domainStandard.avoidances.map(a => `  - ${a}`).join('\n')}${conversationBlock}

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
    "kind": "<insight|critique|reframe|alternative|comparison|question|recommendation|proposedEdit|actionPlan>",
    "content": "<the intervention delivered in clear language the user can act on>",
    "stronger_alternative": "<the specific alternative or next move, or null if not applicable>",
    "options": [
      {"label": "<short action label>", "description": "<what happens if chosen>", "consequence": "<expected result or null>"}
    ]
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
