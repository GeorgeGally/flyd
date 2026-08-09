import { randomUUID } from 'node:crypto';
import { query } from '../lib/llm.js';
import type { EnvironmentCapture } from './current-work.js';
import { constructCurrentWork as buildCurrentWork, resolveRepositoryFromPath } from './current-work.js';
import { workSessionStore, type WorkSessionTurn } from './work-session-store.js';
import { selectDomainStandard } from './domain-standards.js';
import { buildWorkIntelligencePrompt, parseWorkIntelligenceResponse } from './intervention.js';
import { recordLlmResolution } from '../overlay-metrics.js';
import type { ActionProposal, CurrentWork, Diagnosis, Intervention } from './types.js';

export interface WorkInteractionParams {
  invocationId: string;
  intent: string;
  modality: 'text' | 'voice';
  environment: EnvironmentCapture;
  conversationId?: string;
  screenshotBase64?: string;
  modelConfig: { model: string; apiKey: string; baseURL: string };
}

export interface WorkInteractionOutput {
  interactionId: string;
  workSessionId: string;
  workSessionRevision: number;
  currentWork: CurrentWork;
  diagnosis: Diagnosis;
  intervention: Intervention;
  timing: { total_ms: number };
  isDeterministic: boolean;
}

export async function runWorkIntelligence(params: WorkInteractionParams): Promise<WorkInteractionOutput> {
  const startedAt = Date.now();
  const interactionId = randomUUID();

  let workSessionId: string;
  if (params.conversationId) {
    const existing = workSessionStore.get(params.conversationId);
    workSessionId = existing
      ? existing.sessionId
      : workSessionStore.createSession(params.conversationId).sessionId;
  } else {
    workSessionId = workSessionStore.createSession().sessionId;
  }

  const repoInfo = resolveRepositoryFromPath(
    params.environment.document_path
  );

  const currentWork = buildCurrentWork({
    environment: params.environment,
    resolvedProjectRoot: repoInfo.root,
    gitBranch: repoInfo.branch,
    gitHeadDigest: repoInfo.headDigest,
    gitStatusDigest: repoInfo.statusDigest,
    gitRecentCommits: repoInfo.recentCommits,
    gitChangedFiles: repoInfo.changedFiles,
    screenshotBase64: params.screenshotBase64,
  });

  const domainStandard = selectDomainStandard({
    artifactKind: currentWork.artifact.kind,
    bundleId: currentWork.artifact.bundleId,
  });

  const conversationTurns = workSessionStore.getActiveConversationTurns(workSessionId);
  const conversationHistory = conversationTurns.length > 0
    ? conversationTurns.slice(-6).map(t => `User: ${t.user}\nFlyd: ${t.assistant}`).join('\n')
    : undefined;

  const memoryContext = await retrieveMemoryContext(params.intent, repoInfo.root);

  const prompt = buildWorkIntelligencePrompt({
    currentWork,
    domainStandard,
    intent: params.intent,
    conversationHistory,
    memoryContext,
  });

  const responseText = await query(
    prompt,
    params.modelConfig.model,
    undefined,
    params.modelConfig.apiKey,
    params.modelConfig.baseURL,
    { json: true }
  );

  const result = parseWorkIntelligenceResponse(responseText);
  recordLlmResolution();

  workSessionStore.updateCurrentWork(workSessionId, currentWork);

  const session = workSessionStore.bump(workSessionId) ?? workSessionStore.createSession();
  session.revision += 1;
  result.intervention.proposedAction = bindProposedAction(
    result.intervention.proposedAction,
    currentWork,
    session.revision,
    interactionId,
  );

  const turn: WorkSessionTurn = {
    turnId: randomUUID(),
    interactionId,
    intent: params.intent,
    assistant: result.intervention.content,
    timestamp: new Date().toISOString(),
    resolutionMode: 'work_intelligence',
    proposedAction: result.intervention.proposedAction,
  };

  session.turns.push(turn);
  session.currentWork = currentWork || session.currentWork;

  while (session.turns.length > 50) {
    session.turns.shift();
  }

  const modelMs = Date.now() - startedAt;

  return {
    interactionId,
    workSessionId,
    workSessionRevision: session.revision,
    currentWork,
    diagnosis: result.diagnosis,
    intervention: result.intervention,
    timing: { total_ms: modelMs },
    isDeterministic: false,
  };
}

export function bindProposedAction(
  proposal: ActionProposal | undefined,
  currentWork: CurrentWork,
  workSessionRevision: number,
  diagnosedIssueId: string,
): ActionProposal | undefined {
  if (!proposal) return undefined;

  const bound: ActionProposal = {
    ...proposal,
    workSessionRevision,
    diagnosedIssueId,
  };
  if (proposal.kind !== 'repository_action') return bound;

  const evidence = currentWork.evidenceSummary;
  if (!evidence.repositoryRoot || !evidence.branch || !evidence.headDigest || !evidence.statusDigest) {
    return undefined;
  }
  return {
    ...bound,
    allowedOperation: 'repository_work',
    targetFingerprint: {
      repositoryRoot: evidence.repositoryRoot,
      branch: evidence.branch,
      headDigest: evidence.headDigest,
      statusDigest: evidence.statusDigest,
    },
  };
}

const MEMORY_TIMEOUT_MS = 2000;
const MAX_MEMORY_EXCERPTS = 8;

async function retrieveMemoryContext(intent: string, projectRoot?: string): Promise<string | undefined> {
  try {
    const { retrieveResilientLexicalBrainEvidence } = await import('../lib/brain-retrieval.js');
    const timeout = new Promise<null>((res) => setTimeout(() => res(null), MEMORY_TIMEOUT_MS).unref?.());
    const result = await Promise.race([retrieveResilientLexicalBrainEvidence(intent, projectRoot), timeout]);
    if (!result || result.matches.length === 0) return undefined;

    const lines = result.matches.slice(0, MAX_MEMORY_EXCERPTS).map(m => {
      const marker = m.content.isCurrent ? '[CURRENT]' : '[BACKGROUND]';
      return `  ${marker} ${m.content.excerpt.slice(0, 400)}`;
    });

    return lines.join('\n');
  } catch {
    return undefined;
  }
}
