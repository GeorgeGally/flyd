import { randomUUID } from 'node:crypto';
import { query } from '../lib/llm.js';
import type { EnvironmentCapture } from './current-work.js';
import { constructCurrentWork as buildCurrentWork, resolveRepositoryFromPath } from './current-work.js';
import { workSessionStore, type WorkSessionTurn } from './work-session-store.js';
import { buildWorkIntelligencePrompt, parseWorkIntelligenceResponse } from './intervention.js';
import { recordLlmResolution } from '../overlay-metrics.js';
import type { ActionProposal, CurrentWork, Diagnosis, Intervention } from './types.js';
import { readPresentModel } from '../work/work-hypothesis/index.js';
import type { WorkHypothesis } from '../work/work-hypothesis/types.js';
import { readCanonicalPresent } from '../work/runtime-present.js';
import { createRuntimePool } from '../runtime/database.js';
import { ensureContinuousSupervisionStarted } from '../runtime/supervision-runtime.js';
import { assembleGroundPack, buildForegroundSummary } from './ground-pack.js';
import {
  loadDomainStandard,
  loadWikiProjectSection,
  readSafeWikiPage,
  extractPeopleRefs,
  loadPeopleSections,
  slugifyName,
} from './ground-pack-wiki.js';
import { readLatestCloseoutForProject } from './work-session-closeout-store.js';
import { recordJournalEntry } from './outcome-journal.js';
import { selectWorkIntelligenceAction } from './planner.js';
import { compileContext } from '../cognition/context-compiler.js';
import { formatCompiledContext } from '../cognition/context-format.js';

// server.ts imports this service during Core boot. Start deterministic operational
// supervision with the Core module lifecycle, while keeping test imports inert.
if (process.env.NODE_ENV !== 'test') ensureContinuousSupervisionStarted();

export interface WorkInteractionParams {
  invocationId: string;
  intent: string;
  modality: 'text' | 'voice';
  environment: EnvironmentCapture;
  conversationId?: string;
  screenshotBase64?: string;
  modelConfig: { model: string; apiKey: string; baseURL: string };
  presentModel?: WorkHypothesis | null;
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

async function resolvePresentModel(explicit: WorkHypothesis | null | undefined): Promise<WorkHypothesis | null> {
  if (explicit !== undefined) return explicit;
  const pool = createRuntimePool(undefined, { connectionTimeoutMillis: 400, statementTimeoutMs: 800 });
  try {
    return await readCanonicalPresent(pool) ?? readPresentModel();
  } catch {
    return readPresentModel();
  } finally {
    await pool.end().catch(() => undefined);
  }
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
    gitIsDirty: repoInfo.isDirty,
    gitRecentCommits: repoInfo.recentCommits,
    gitChangedFiles: repoInfo.changedFiles,
    screenshotBase64: params.screenshotBase64,
  });

  const domainFromWiki = loadDomainStandard({
    artifactKind: currentWork.artifact.kind,
    bundleId: currentWork.artifact.bundleId,
    projectName: currentWork.project.value,
  });

  if (domainFromWiki.provenance.startsWith('wiki/')) {
    try {
      recordJournalEntry({
        entryId: `standard-hit-${interactionId}`,
        interactionId,
        workSessionId,
        timestamp: new Date().toISOString(),
        eventType: 'standard_hit',
        details: { domain: domainFromWiki.standard.domain, artifactKind: currentWork.artifact.kind },
      });
      if (domainFromWiki.skillifyAuthored) {
        recordJournalEntry({
          entryId: `skill-applied-${interactionId}`,
          interactionId,
          workSessionId,
          timestamp: new Date().toISOString(),
          eventType: 'skill_applied',
          details: { domain: domainFromWiki.standard.domain, artifactKind: currentWork.artifact.kind },
        });
      }
    } catch {
      // counter failure must never abort the invocation
    }
  }

  const presentModel = await resolvePresentModel(params.presentModel);
  const closeout = readLatestCloseoutForProject(currentWork.project.value);
  const wikiProjectSection = loadWikiProjectSection(currentWork.project.value);
  const projectParsed = readSafeWikiPage(`projects/${slugifyName(currentWork.project.value)}.md`);
  const peopleSections = loadPeopleSections(extractPeopleRefs(projectParsed));

  const groundPack = assembleGroundPack({
    foregroundSummary: buildForegroundSummary(currentWork),
    domainStandard: domainFromWiki.standard,
    domainStandardProvenance: domainFromWiki.provenance,
    presentModel,
    closeout,
    foregroundProject: currentWork.project.value,
    wikiProjectSection,
    peopleSections,
  });

  const conversationTurns = workSessionStore.getActiveConversationTurns(workSessionId);
  const conversationHistory = conversationTurns.length > 0
    ? conversationTurns.slice(-6).map(t => `User: ${t.user}\nFlyd: ${t.assistant}`).join('\n')
    : undefined;

  const compiledContext = await compileContext({
    intent: params.intent,
    projectRoot: repoInfo.root,
    projectHint: currentWork.project.value ? `project:${currentWork.project.value.toLowerCase().replace(/[^a-z0-9]+/g, "-")}` : undefined,
    environment: { app: params.environment.application.name, documentPath: params.environment.document_path },
    conversation: conversationTurns.flatMap((turn) => [
      { role: "user" as const, content: turn.user },
      { role: "assistant" as const, content: turn.assistant },
    ]),
    capabilities: ["work-intelligence", "memory", "git", "planning", "execution"],
  });
  const memoryContext = formatCompiledContext(compiledContext);

  const prompt = buildWorkIntelligencePrompt({
    currentWork,
    domainStandard: groundPack.domainStandard,
    intent: params.intent,
    conversationHistory,
    memoryContext,
    groundPack,
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

  // The model proposes a bounded candidate set; canonical planning state chooses
  // which single action is allowed to reach the existing approval/execution UI.
  // Selection is advisory only and never grants execution authority.
  try {
    const selection = await selectWorkIntelligenceAction({
      intent: params.intent,
      interactionId,
      currentWork,
      candidates: result.candidateActions,
      projectRoot: repoInfo.root,
    });
    result.intervention.proposedAction = selection.proposal;
  } catch {
    // Planning is best-effort. Preserve the first bounded proposal rather than
    // making Work Intelligence unavailable if planner telemetry/state fails.
    result.intervention.proposedAction = result.candidateActions[0];
  }

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
