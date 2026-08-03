import { randomUUID } from 'node:crypto';
import { query } from '../lib/llm.js';
import type { EnvironmentCapture } from './current-work.js';
import { constructCurrentWork as buildCurrentWork, resolveRepositoryFromPath } from './current-work.js';
import { workSessionStore, type WorkSessionTurn } from './work-session-store.js';
import { selectDomainStandard } from './domain-standards.js';
import { buildWorkIntelligencePrompt, parseWorkIntelligenceResponse } from './intervention.js';
import { recordLlmResolution } from '../overlay-metrics.js';
import type { CurrentWork, Diagnosis, Intervention } from './types.js';

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
    workSessionId = existing ? existing.sessionId : params.conversationId;
  } else {
    workSessionId = workSessionStore.createSession().sessionId;
  }

  const repoInfo = resolveRepositoryFromPath(
    params.environment.focused_element?.description || params.environment.document_path
  );

  const currentWork = buildCurrentWork({
    environment: params.environment,
    resolvedProjectRoot: repoInfo.root,
    gitBranch: repoInfo.branch,
    gitHeadDigest: repoInfo.headDigest,
    gitStatusDigest: repoInfo.statusDigest,
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

  const prompt = buildWorkIntelligencePrompt({
    currentWork,
    domainStandard,
    intent: params.intent,
    conversationHistory,
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

  const turn: WorkSessionTurn = {
    turnId: randomUUID(),
    interactionId,
    intent: params.intent,
    assistant: result.intervention.content,
    timestamp: new Date().toISOString(),
    resolutionMode: 'work_intelligence',
  };

  session.turns.push(turn);
  session.currentWork = currentWork || session.currentWork;

  while (session.turns.length > 20) {
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
