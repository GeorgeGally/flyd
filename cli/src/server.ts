import { config } from "dotenv";
import { resolve as resolvePath, join } from "node:path";

config({ path: resolvePath(join(process.cwd(), "..", ".env")) });
config({ path: resolvePath(join(process.cwd(), ".env")) });

import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";
import { memoryGate, gateLearningCandidate } from "./memory-gate.js";
import { provisionalLearn, createMemoryReceipt, createLearningReceipt, acknowledgeLearning, getPendingLearnings, synthesizeLearnings, loadLearnings } from "./memory-receipt.js";
import { persistReceipt, persistLearnings, persistLearningReceipt } from "./memory-persistence.js";
import { resolve, ManifestRequest } from "./resolve.js";
import { isDelegationIntent, buildDelegationEnvelope, validateDelegationCompletion, type DelegationCompletion } from "./delegation.js";
import { buildIntelligenceState } from "./export-state.js";
import type { Resolution, ResolutionOutcome } from "./resolve-types.js";
import { validateResolution } from "./resolve-types.js";
import { loadFlydWorkerConfig, loadFlydRouterConfig } from "./runtime/flyd-worker-config.js";
import { checkUrlResponds, checkArtifacts } from "./artifact-check.js";
import type { ArtifactClaim } from "./verification-types.js";
import { overlayMetricsSnapshot, recordDelegationCompletion } from "./overlay-metrics.js";
import { checkVoiceSetup, startTranscriptionServer, stopTranscriptionServer } from "./transcription.js";
import { startRealtimeServer, stopRealtimeServer } from "./realtime-session.js";
import { synthesizeSpeech, TtsNotConfiguredError } from "./tts.js";
import { conversationHistory } from "./conversation-history.js";
import { workSessionStore } from "./work-intelligence/work-session-store.js";
import { closeWorkSession } from "./work-intelligence/work-session-closeout-store.js";
import { constructCurrentWork, resolveRepositoryFromPath } from "./work-intelligence/current-work.js";
import { runWorkIntelligence } from "./work-intelligence/work-interaction-service.js";
import { runRepositoryAction, validateRepositoryActionInput, verifyModuleDependencyBoundary, type RepositoryActionResult } from "./work-intelligence/repository-action.js";
import { terminalizeRepositoryAction, type RepositoryTerminalOutcome } from "./work-intelligence/repository-action-terminal.js";
import { RepositoryActionJobStore } from "./work-intelligence/repository-action-job.js";
import { recordJournalEntry } from "./work-intelligence/outcome-journal.js";
import type { FounderJournalEntry } from "./work-intelligence/types.js";
import {
  proposeFromOutcome,
  proposeFromLearningCandidate,
  buildSkillifyAugmentOptions,
} from "./work-intelligence/skillify/propose.js";
import {
  confirmProposal,
  declineProposal,
  confirmAllPending,
  declineAllPending,
} from "./work-intelligence/skillify/confirm.js";
import {
  listPendingProposals,
  listPendingForSession,
} from "./work-intelligence/skillify/proposal-store.js";
import {
  listJobs,
  getJob,
  createJobDef,
  setJobEnabled,
  ensureDefaultMorningBriefingJob,
} from "./work-intelligence/jobs/store.js";
import { pauseJobs, resumeJobs, killJobs, clearKillJobs, isJobsGloballyPaused } from "./work-intelligence/jobs/controls.js";
import { runMorningBriefing, runJobById, runDueJobs } from "./work-intelligence/jobs/runner.js";
import type { JobType } from "./work-intelligence/jobs/types.js";
import { startBriefScheduler, stopBriefScheduler, runAndPersistBrief } from "./runtime/brief-scheduler.js";
import { startTransitionJudge, stopTransitionJudge } from "./transitions/judge.js";
import { getKey } from "./lib/config.js";
import { handleCompoundNl, isCompoundNlUtterance } from "./work-intelligence/compound-nl.js";
import { readPresentModel, projectHypothesisLine } from "./work/work-hypothesis/index.js";
import { handleJournalPost, handleJournalList, handleJournalEntry, handleWorkInteractionContractNegotiation } from "./http/work-interaction-handlers.js";
import { validateShellExecutionRequest, createExecution, runExecution, getExecutionStatus, cancelExecution } from "./work-intelligence/command-execution.js";
import type { ShellExecutionResult } from "./work-intelligence/types.js";
import { validateFileRead, readFile, validateFileGrep, grepCodebase, validateFileWrite, writeFile } from "./work-intelligence/file-operations.js";
import { planTask, parseTaskPlan, buildVerifyPrompt } from "./work-intelligence/task-loop.js";
import type { TaskPlan } from "./work-intelligence/task-loop.js";
import { query } from "./lib/llm.js";
import {
  recordForegroundFeedback,
  type ForegroundFeedbackInput,
} from "./runtime/foreground-feedback.js";
import { syncInstalledOpenCodePlugin } from "./runtime/opencode-plugin-sync.js";
import { recordAction, recordNextState } from "./transitions/writer.js";

const PORT = 4815;
const HOST = "127.0.0.1";
const AUTH_TOKEN_PATH = join(homedir(), ".flyd", "overlay", "auth-token");
const DELEGATION_ENABLED = process.env.FLYD_DELEGATION_ENABLED === "true";
const repositoryActionJobs = new RepositoryActionJobStore<RepositoryActionResult>({ durable: true });

function recordRepositoryTerminalOutcome(
  sessionId: string,
  grant: Parameters<typeof terminalizeRepositoryAction>[2],
  outcome: RepositoryTerminalOutcome,
): { ok: true } | { ok: false; error: string } {
  try {
    terminalizeRepositoryAction(workSessionStore, sessionId, grant, outcome, recordJournalEntry);
    return { ok: true };
  } catch (error) {
    const message = (error as Error).message || 'Outcome receipt could not be persisted';
    try {
      workSessionStore.updateActionGrant(sessionId, {
        ...grant,
        status: 'failed',
        invalidationReason: 'Outcome receipt could not be persisted',
      });
    } catch { /* the durable receipt error remains authoritative */ }
    return { ok: false, error: message };
  }
}

function repositoryActionResponse(result: RepositoryActionResult) {
  return {
    actionId: result.actionId,
    verified: result.verified,
    changedFiles: result.changedFiles,
    diffDigest: result.diffDigest,
    diffSummary: result.diffSummary,
    diffPresent: result.diffPresent,
    artifactPresent: result.artifactPresent,
    checksPerformed: result.checksPerformed,
    exitStatus: result.exitStatus,
    integrated: result.integrated ?? false,
    integrationStatus: result.integrationStatus ?? "unintegrated",
    handoffLocation: result.handoffLocation,
    beforeStateDigest: result.beforeStateDigest,
    afterStateDigest: result.afterStateDigest,
    error: result.error,
    output: result.output?.slice(0, 500),
  };
}

function loadAuthToken(): string | null {
  try {
    return readFileSync(AUTH_TOKEN_PATH, "utf-8").trim();
  } catch {
    return null;
  }
}
const AUTH_TOKEN = loadAuthToken();

function checkAuth(req: IncomingMessage): boolean {
  if (!AUTH_TOKEN) return false;
  const auth = req.headers.authorization || "";
  return auth === `Bearer ${AUTH_TOKEN}`;
}

function sendUnauthorized(res: ServerResponse) {
  res.writeHead(401, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Unauthorized" }));
}

const intentHistory: Array<{ intent: string; timestamp: string }> = [];
const resolvedContexts = new Map<string, { intent: string; resolutionMode: string; environmentSummary: string; consequenceClass?: string; workSessionId?: string; timestamp: number }>();
const completedDelegations = new Map<string, { completion: DelegationCompletion; timestamp: number }>();

setInterval(() => {
  const cutoff = Date.now() - 60 * 60 * 1000;
  for (const [key, ctx] of resolvedContexts) {
    if (ctx.timestamp < cutoff) resolvedContexts.delete(key);
  }
  for (const [key, entry] of completedDelegations) {
    if (entry.timestamp < cutoff) completedDelegations.delete(key);
  }
}, 5 * 60 * 1000).unref();

const COMPOSE_URL = "http://127.0.0.1:3000/surface";
const COMPOSE_LIVENESS_TIMEOUT_MS = 800;

interface ManifestRequestBody {
  invocation_id: string;
  environment_revision: number;
  environment: ManifestRequest["environment"];
  intent: string;
  modality: "text" | "voice";
  conversation_id?: string;
  work_session_id?: string;
  work_session_revision?: number;
  screenshot?: string;
  invocation_fingerprint: ManifestRequest["invocation_fingerprint"];
}

const DEFAULT_BODY_LIMIT = 64 * 1024;
// Manifest may carry a base64 JPEG screenshot (1280px wide ≈ 100–400KB).
const MANIFEST_BODY_LIMIT = 4 * 1024 * 1024;

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

// Removed snakeCaseKeys

function parseBody(req: IncomingMessage, limit = DEFAULT_BODY_LIMIT): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk: Buffer) => {
      data += chunk.toString();
      if (data.length > limit) {
        req.destroy();
        reject(new Error("Request body too large"));
      }
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

async function handleManifest(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }

  let body: string;
  try {
    body = await parseBody(req, MANIFEST_BODY_LIMIT);
  } catch {
    sendJson(res, 413, { error: "Request body too large" });
    return;
  }

  let parsed: ManifestRequestBody;
  try {
    parsed = JSON.parse(body);
  } catch {
    sendJson(res, 400, { error: "Invalid JSON" });
    return;
  }

  if (!parsed.invocation_id || !parsed.intent) {
    sendJson(res, 400, { error: "Missing invocation_id or intent" });
    return;
  }

  if (!parsed.environment || !parsed.environment.application) {
    sendJson(res, 400, { error: "Missing environment payload" });
    return;
  }

  try {
    const config = loadFlydWorkerConfig();
    const isDictation = /^(type|write|dictate|insert)\s/i.test(parsed.intent);
    const hasEditableTarget = parsed.environment?.focused_element?.role?.includes("Text") ?? false;

    if (!isDictation && isCompoundNlUtterance(parsed.intent)) {
      const selection =
        parsed.environment?.focused_element?.selected_text ||
        parsed.environment?.focused_element?.value ||
        null;
      const present = readPresentModel();
      const compound = handleCompoundNl(parsed.intent, {
        selection,
        presentHypothesis: projectHypothesisLine(present),
        projectHint: present?.primaryThreads?.[0]?.name,
      });
      if (compound) {
        resolvedContexts.set(parsed.invocation_id, {
          intent: parsed.intent,
          resolutionMode: "requires_augment",
          environmentSummary: parsed.environment.application?.name ?? "",
          timestamp: Date.now(),
        });

        try {
          recordAction({
            sessionId: parsed.work_session_id ?? parsed.conversation_id ?? parsed.invocation_id,
            invocationId: parsed.invocation_id,
            surface: "overlay",
            intent: parsed.intent,
            resolutionMode: "requires_augment",
            appSummary: `${parsed.environment.application?.bundle_id || "unknown"} — ${parsed.environment.focused_element?.role || "unknown"}`,
          });
        } catch (error) {
          console.warn("[Flyd Core] Transition action capture failed:", (error as Error).message);
        }

        sendJson(res, 200, {
          mode: "requires_augment",
          resolutionId: randomUUID(),
          invocationId: parsed.invocation_id,
          environmentRevision: parsed.environment_revision ?? 1,
          rationale: `compound-nl:${compound.kind}`,
          operations: [],
          augmentations: [{
            kind: "explanation",
            content: compound.reply,
            placement: "cursor",
          }],
        });
        return;
      }
    }

    if (!isDictation) {
      const wiResult = await runWorkIntelligence({
        invocationId: parsed.invocation_id,
        intent: parsed.intent,
        modality: parsed.modality || "text",
        environment: parsed.environment,
        conversationId: parsed.work_session_id ?? parsed.conversation_id,
        screenshotBase64: typeof parsed.screenshot === "string" && parsed.screenshot.length > 0 ? parsed.screenshot : undefined,
        modelConfig: { model: config.model, apiKey: config.apiKey, baseURL: config.baseURL },
      });

      const hasShellCommands = wiResult.intervention.proposedAction?.kind === 'shell_execute'
        && wiResult.intervention.proposedAction?.shellCommands
        && wiResult.intervention.proposedAction.shellCommands.length > 0;

      const hasFileOperations = ['file_read', 'file_grep', 'file_write'].includes(wiResult.intervention.proposedAction?.kind ?? '')
        && wiResult.intervention.proposedAction?.fileOperations
        && wiResult.intervention.proposedAction.fileOperations.length > 0;

      const isTaskPlan = wiResult.intervention.proposedAction?.kind === 'task_plan'
        && wiResult.intervention.proposedAction?.taskIntent;

      const isRepositoryAction = wiResult.intervention.proposedAction?.kind === 'repository_action';

      const mode = isTaskPlan ? 'requires_task'
        : (hasShellCommands || hasFileOperations) ? 'requires_execution'
        : isRepositoryAction ? 'work_intelligence'
        : 'requires_augment';

      const augmentJson: Record<string, unknown> = {
        mode,
        resolutionId: wiResult.interactionId,
        invocationId: parsed.invocation_id,
        environmentRevision: parsed.environment_revision ?? 1,
        rationale: wiResult.diagnosis.primaryIssue.finding,
        operations: [],
        augmentations: [] as Record<string, unknown>[],
        timing: wiResult.timing,
        workSessionId: wiResult.workSessionId,
        workSessionRevision: wiResult.workSessionRevision,
        currentWork: wiResult.currentWork,
        diagnosis: wiResult.diagnosis,
        intervention: wiResult.intervention,
      };

      if (isTaskPlan) {
        const repoInfo = resolveRepositoryFromPath(
          (parsed.environment as ManifestRequest['environment'])?.document_path
        );
        const projectRoot = repoInfo.root || process.cwd();

        try {
          const config = loadFlydWorkerConfig();
          const plan = await planTask({
            intent: wiResult.intervention.proposedAction!.taskIntent!,
            projectRoot,
            currentWork: `${wiResult.diagnosis.primaryIssue.finding}\n${wiResult.intervention.content}`,
            modelConfig: { model: config.model, apiKey: config.apiKey, baseURL: config.baseURL },
          });

          if (plan) {
            (augmentJson.augmentations as Record<string, unknown>[]).push({
              kind: 'task_plan',
              content: `${wiResult.diagnosis.primaryIssue.finding}\n\n${wiResult.intervention.content}`,
              placement: 'cursor',
              taskPlan: plan,
            });
          } else {
            (augmentJson.augmentations as Record<string, unknown>[]).push({
              kind: 'explanation',
              content: `Failed to produce task plan for: ${wiResult.intervention.proposedAction!.taskIntent}`,
              placement: 'cursor',
            });
            augmentJson.mode = 'requires_augment';
          }
        } catch {
          (augmentJson.augmentations as Record<string, unknown>[]).push({
            kind: 'explanation',
            content: `Task planning failed. Try a more specific request.`,
            placement: 'cursor',
          });
          augmentJson.mode = 'requires_augment';
        }
      } else if (hasShellCommands) {
        (augmentJson.augmentations as Record<string, unknown>[]).push({
          kind: 'execution',
          content: `${wiResult.diagnosis.primaryIssue.finding}\n\n${wiResult.intervention.content}`,
          placement: 'cursor',
          commands: wiResult.intervention.proposedAction!.shellCommands!.map(cmd => ({
            command: cmd.command,
            workingDirectory: cmd.workingDirectory,
            explanation: cmd.explanation,
            isDestructive: cmd.isDestructive,
          })),
        });
      } else if (hasFileOperations) {
        (augmentJson.augmentations as Record<string, unknown>[]).push({
          kind: 'execution',
          content: `${wiResult.diagnosis.primaryIssue.finding}\n\n${wiResult.intervention.content}`,
          placement: 'cursor',
          fileOperations: wiResult.intervention.proposedAction!.fileOperations!.map(op => ({
            kind: op.kind,
            path: op.path,
            pattern: op.pattern,
            explanation: op.explanation,
          })),
        });
      } else {
        (augmentJson.augmentations as Record<string, unknown>[]).push({
          kind: 'explanation',
          content: `${wiResult.diagnosis.primaryIssue.finding}\n\n${wiResult.intervention.content}${wiResult.intervention.strongerAlternative ? `\n\n${wiResult.intervention.strongerAlternative}` : ''}`,
          placement: 'cursor',
        });
      }

      if (!isTaskPlan && !hasShellCommands && !hasFileOperations && wiResult.intervention.options && wiResult.intervention.options.length > 0) {
        (augmentJson.augmentations as Record<string, unknown>[])!.push({
          kind: 'choice',
          content: wiResult.diagnosis.primaryIssue.finding,
          placement: 'beside_selection',
          options: wiResult.intervention.options.map(o => o.label),
        });
      }

      sendJson(res, 200, augmentJson);

      intentHistory.push({ intent: parsed.intent, timestamp: new Date().toISOString() });
      if (intentHistory.length > 100) intentHistory.shift();

      resolvedContexts.set(parsed.invocation_id, {
        intent: parsed.intent,
        resolutionMode: mode,
        environmentSummary: `${parsed.environment.application?.bundle_id || "unknown"} — ${parsed.environment.focused_element?.role || "unknown"}`,
        workSessionId: wiResult.workSessionId,
        timestamp: Date.now(),
      });

      return;
    }

    const routerConfig = loadFlydRouterConfig();
    const conversationTurns = parsed.conversation_id
      ? conversationHistory.get(parsed.conversation_id)
      : [];
    const startedAt = Date.now();
    const resolution = await resolve(
      {
        invocation_id: parsed.invocation_id,
        environment_revision: parsed.environment_revision ?? 1,
        environment: parsed.environment,
        intent: parsed.intent,
        modality: parsed.modality || "text",
        conversation_id: parsed.conversation_id,
        screenshot: typeof parsed.screenshot === "string" && parsed.screenshot.length > 0 ? parsed.screenshot : undefined,
        invocation_fingerprint: parsed.invocation_fingerprint,
      },
      config.model,
      config.apiKey,
      config.baseURL,
      routerConfig,
      conversationTurns
    );
    const modelMs = Date.now() - startedAt;

    const validationError = validateResolution(resolution);
    if (validationError) {
      sendJson(res, 422, { error: validationError.error, code: validationError.code });
      return;
    }

    if (resolution.mode === "requires_compose") {
      // Never hand the user a dead link — verify the surface server is
      // actually alive before promising it.
      const liveness = await checkUrlResponds(COMPOSE_URL, COMPOSE_LIVENESS_TIMEOUT_MS);
      if (liveness.ok) {
        resolution.composeUrl = COMPOSE_URL;
      } else {
        resolution.mode = "requires_augment";
        resolution.augmentations = [{
          kind: "explanation",
          content: "This needs a full Flyd surface, but the surface server isn't running. Start it and try again.",
          placement: "cursor",
        }];
        resolution.composeRationale = undefined;
        resolution.composeUrl = undefined;
      }
    }

    if (isDelegationIntent(parsed.intent) && DELEGATION_ENABLED) {
      const worldState = buildIntelligenceState();
      const envelope = buildDelegationEnvelope(
        parsed.intent,
        worldState as unknown as Record<string, unknown>,
        parsed.environment.focused_element?.ref ? [parsed.environment.focused_element.ref] : [],
        parsed.environment.application?.bundle_id || null
      );
      resolution.delegationEnvelope = envelope as unknown as Record<string, unknown>;
      // Delegated work always requires user confirmation before launch,
      // regardless of how the intent was classified.
      resolution.requiresConfirmation = true;
    }

    sendJson(res, 200, {
      ...resolution,
      timing: { model_total_ms: modelMs },
    });

    intentHistory.push({
      intent: parsed.intent,
      timestamp: new Date().toISOString(),
    });
    if (intentHistory.length > 100) intentHistory.shift();

    const workSessionId = parsed.conversation_id || workSessionStore.createSession().sessionId;
    workSessionStore.bump(workSessionId);

    resolvedContexts.set(parsed.invocation_id, {
      intent: parsed.intent,
      resolutionMode: resolution.mode,
      environmentSummary: `${parsed.environment.application?.bundle_id || "unknown"} — ${parsed.environment.focused_element?.role || "unknown"}`,
      consequenceClass: resolution.consequence?.class,
      workSessionId,
      timestamp: Date.now(),
    });

    try {
      recordAction({
        sessionId: workSessionId,
        invocationId: parsed.invocation_id,
        surface: "overlay",
        intent: parsed.intent,
        resolutionMode: resolution.mode,
        model: config.model || undefined,
        appSummary: `${parsed.environment.application?.bundle_id || "unknown"} — ${parsed.environment.focused_element?.role || "unknown"}`,
      });
    } catch (error) {
      console.warn("[Flyd Core] Transition action capture failed:", (error as Error).message);
    }

    const assistantText = [
        ...(resolution.augmentations ?? [])
          .filter((augmentation) => augmentation.kind === "explanation")
          .map((augmentation) => augmentation.content),
        ...resolution.operations.map((operation) => operation.text),
      ].filter(Boolean).join("\n");

    if (parsed.conversation_id) {
      if (assistantText) {
        conversationHistory.append(parsed.conversation_id, parsed.intent, assistantText);
      }
    }

    const repoInfo = resolveRepositoryFromPath(
      parsed.environment?.focused_element?.description || undefined
    );

    const currentWork = constructCurrentWork({
      environment: parsed.environment,
      resolvedProjectRoot: repoInfo.root,
      gitBranch: repoInfo.branch,
      gitHeadDigest: repoInfo.headDigest,
      gitStatusDigest: repoInfo.statusDigest,
      gitIsDirty: repoInfo.isDirty,
      screenshotBase64: typeof parsed.screenshot === 'string' ? parsed.screenshot : undefined,
    });

    workSessionStore.addTurn(
      workSessionId,
      parsed.intent,
      assistantText,
      resolution.mode,
      currentWork,
      undefined,
    );
  } catch (err) {
    console.error("[Flyd Core] Manifest resolution failed:", err);
    sendJson(res, 500, { error: "Resolution failed" });
  }
}

async function handleForegroundFeedback(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }

  let body: string;
  try {
    body = await parseBody(req);
  } catch {
    sendJson(res, 413, { error: "Request body too large" });
    return;
  }

  try {
    const raw = JSON.parse(body) as Record<string, unknown>;
    const rawApplication = raw.application as Record<string, unknown> | undefined;
    const result = await recordForegroundFeedback({
      version: raw.version,
      capturedAt: raw.captured_at ?? raw.capturedAt,
      source: raw.source,
      authorship: raw.authorship,
      application: {
        bundleId: rawApplication?.bundle_id ?? rawApplication?.bundleId,
        name: rawApplication?.name,
      },
      windowTitle: raw.window_title ?? raw.windowTitle,
      browserURL: raw.browser_url ?? raw.browserURL,
      text: raw.text,
    } as ForegroundFeedbackInput);
    sendJson(res, 200, result);
  } catch (error) {
    sendJson(res, 400, { error: (error as Error).message });
  }
}

async function handleOutcome(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }

  let body: string;
  try {
    body = await parseBody(req);
  } catch {
    sendJson(res, 413, { error: "Request body too large" });
    return;
  }

  let outcome: ResolutionOutcome;
  try {
    outcome = JSON.parse(body);
  } catch {
    sendJson(res, 400, { error: "Invalid JSON" });
    return;
  }

  if (!outcome.resolutionId || !outcome.invocationId) {
    sendJson(res, 400, { error: "Missing resolutionId or invocationId" });
    return;
  }

  const validStatuses = ["succeeded", "rejected", "failed", "cancelled"];
  if (!validStatuses.includes(outcome.status)) {
    sendJson(res, 400, { error: `Invalid status: ${outcome.status}` });
    return;
  }

  console.log(
    `[Flyd Core] Outcome received: ${outcome.resolutionId.slice(0, 8)} → ${outcome.status}` +
      (outcome.correction ? ` (correction: ${outcome.correction})` : "")
  );

  const resolved = resolvedContexts.get(outcome.invocationId);

  try {
    recordNextState({
      sessionId: resolved?.workSessionId,
      invocationId: outcome.invocationId,
      origin: "user",
      signal: outcome.status as "succeeded" | "rejected" | "failed" | "cancelled",
      correction: outcome.correction ?? undefined,
      causalComplete: Boolean(resolved),
    });
  } catch (error) {
    console.warn("[Flyd Core] Transition next-state capture failed:", (error as Error).message);
  }

  if (resolved) {
    resolvedContexts.delete(outcome.invocationId);

    const gateResult = memoryGate({
      intent: resolved.intent,
      resolutionMode: resolved.resolutionMode,
      outcomeStatus: outcome.status,
      correction: outcome.correction,
      intentHistory: intentHistory.slice(-20),
      topicCount: intentHistory.length,
    });

    if (gateResult.shouldRemember) {
      const receipt = createMemoryReceipt(
        resolved.intent,
        resolved.resolutionMode,
        outcome.status,
        resolved.environmentSummary,
        outcome.correction,
        gateResult.reason,
        gateResult.category
      );
      console.log(`[MemoryGate] REMEMBER (${gateResult.category}/${gateResult.confidence}): ${gateResult.reason}`);
      persistReceipt(receipt);

      const learning = provisionalLearn(resolved.intent);
      if (learning) {
        console.log(`[MemoryGate] Provisional learning: ${learning.domain}=${learning.value}`);
      }
    } else {
      console.log(`[MemoryGate] DISCARD (${gateResult.category}): ${gateResult.reason}`);
    }

    const sessionEndStatuses = new Set(["rejected", "cancelled", "action_completed"]);
    const outcomeMapsToCloseout = sessionEndStatuses.has(outcome.status);

    const skillifyFromOutcome = resolved.workSessionId
      ? proposeFromOutcome({
          workSessionId: resolved.workSessionId,
          interactionId: outcome.invocationId,
          outcomeStatus: outcome.status,
          correction: outcome.correction,
          domain: resolved.resolutionMode,
          intent: resolved.intent,
        })
      : [];

    const pendingForSession = resolved.workSessionId
      ? listPendingForSession(resolved.workSessionId)
      : [];
    const shouldCloseout =
      Boolean(resolved.workSessionId) &&
      (outcomeMapsToCloseout ||
        (outcome.status === "succeeded" &&
          (skillifyFromOutcome.length > 0 || pendingForSession.length > 0)));

    if (shouldCloseout && resolved.workSessionId) {
      try {
        const closeout = closeWorkSession(resolved.workSessionId);
        if (closeout && closeout.retainedLearnings.length > 0) {
          for (const candidate of closeout.retainedLearnings) {
            const skillifyProposal = proposeFromLearningCandidate(candidate, {
              workSessionId: resolved.workSessionId,
              interactionId: outcome.invocationId,
            });
            if (skillifyProposal) continue;

            const learningGate = gateLearningCandidate({
              id: candidate.id,
              source: candidate.source,
              content: candidate.content,
              domain: candidate.domain,
              outcomeRef: candidate.outcomeRef,
              epistemicConfidence: candidate.epistemicConfidence,
              timestamp: candidate.timestamp,
            });

            if (learningGate.shouldRemember) {
              const learningReceipt = createLearningReceipt(
                candidate,
                learningGate.reason,
                candidate.domain
              );
              console.log(`[LearningGate] PROMOTED (${learningGate.category}/${learningGate.confidence}): ${learningGate.reason}`);
              persistLearningReceipt(learningReceipt);
              recordJournalEntry({
                entryId: `learning-${candidate.id}`,
                interactionId: resolved.workSessionId,
                workSessionId: resolved.workSessionId,
                timestamp: new Date().toISOString(),
                eventType: 'learning_promoted',
                details: {
                  domain: candidate.domain,
                  promoted: true,
                },
              });
            } else {
              console.log(`[LearningGate] DISCARD (${learningGate.category}): ${learningGate.reason}`);
            }
          }
        }
      } catch (err) {
        console.warn(`[Flyd Core] Closeout failed:`, (err as Error).message);
      }
    }
  } else {
    console.warn(`[Flyd Core] Outcome received with no matching manifest: ${outcome.invocationId.slice(0, 8)}`);
  }

  // Record founder journal entry for product metrics
  try {
    const journalEntry: FounderJournalEntry = {
      entryId: `outcome-${outcome.invocationId}`,
      interactionId: outcome.invocationId,
      workSessionId: outcome.resolutionId || outcome.invocationId,
      timestamp: new Date().toISOString(),
      eventType: outcome.status === 'succeeded' ? 'action_completed' :
                  outcome.status === 'failed' ? 'action_failed' :
                  outcome.status === 'rejected' ? 'intervention_rejected' : 'intervention_rejected',
      details: {
        actionKind: 'text_edit',
        verified: outcome.status === 'succeeded',
        userCorrection: outcome.correction || undefined,
      },
    };

    if (outcome.status === 'succeeded' && resolved) {
      journalEntry.details.verified = true;
    }
    if (outcome.status === 'failed') {
      journalEntry.details.verified = false;
    }

    recordJournalEntry(journalEntry);
  } catch (err) {
    console.warn(`[Flyd Core] Failed to record journal entry:`, (err as Error).message);
  }

  sendJson(res, 200, {
    acknowledged: true,
    skillifyPending: listPendingProposals().map((p) => ({
      id: p.id,
      kind: p.kind,
      targetPath: p.targetPath,
      excerpt: p.body.slice(0, 160),
      revision: p.revision,
    })),
    skillifyAugmentOptions: buildSkillifyAugmentOptions(listPendingProposals()),
  });
}

async function handleJobsRequest(req: IncomingMessage, res: ServerResponse, pathname: string) {
  if (pathname === "/jobs") {
    if (req.method === "GET") {
      sendJson(res, 200, {
        paused: isJobsGloballyPaused(),
        jobs: listJobs().map((j) => ({
          id: j.id,
          type: j.type,
          enabled: j.enabled,
          schedule: j.schedule,
          projectId: j.projectId,
        })),
      });
      return;
    }
    if (req.method === "POST") {
      let body: string;
      try {
        body = await parseBody(req);
      } catch {
        sendJson(res, 413, { error: "Request body too large" });
        return;
      }
      try {
        const input = JSON.parse(body) as Record<string, unknown>;
        if (typeof input.type !== "string" || typeof input.schedule !== "string") {
          sendJson(res, 422, { error: "Missing type or schedule" });
          return;
        }
        const job = createJobDef({
          type: input.type as JobType,
          schedule: input.schedule,
          enabled: input.enabled !== false,
          projectId: typeof input.projectId === "string" ? input.projectId : undefined,
          skillIds: Array.isArray(input.skillIds) ? (input.skillIds as string[]) : [],
          toolPolicy: Array.isArray(input.toolPolicy) ? (input.toolPolicy as ["*"]) : ["*"],
        });
        sendJson(res, 201, { job });
      } catch (error) {
        sendJson(res, 400, { error: (error as Error).message });
      }
      return;
    }
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }

  if (pathname === "/jobs/pause") {
    if (req.method !== "POST") {
      sendJson(res, 405, { error: "Method not allowed" });
      return;
    }
    pauseJobs();
    sendJson(res, 200, { paused: true });
    return;
  }

  if (pathname === "/jobs/resume") {
    if (req.method !== "POST") {
      sendJson(res, 405, { error: "Method not allowed" });
      return;
    }
    resumeJobs();
    clearKillJobs();
    sendJson(res, 200, { paused: false });
    return;
  }

  if (pathname === "/jobs/kill") {
    if (req.method !== "POST") {
      sendJson(res, 405, { error: "Method not allowed" });
      return;
    }
    killJobs();
    sendJson(res, 200, { killed: true });
    return;
  }

  if (pathname === "/jobs/run") {
    if (req.method !== "POST") {
      sendJson(res, 405, { error: "Method not allowed" });
      return;
    }
    let body: string;
    try {
      body = await parseBody(req);
    } catch {
      sendJson(res, 413, { error: "Request body too large" });
      return;
    }
    let input: Record<string, unknown> = {};
    try {
      if (body.trim()) input = JSON.parse(body) as Record<string, unknown>;
    } catch {
      sendJson(res, 400, { error: "Invalid JSON" });
      return;
    }

    if (input.due === true) {
      sendJson(res, 200, { results: runDueJobs({ force: Boolean(input.force) }) });
      return;
    }

    if (typeof input.jobId === "string") {
      sendJson(res, 200, runJobById(input.jobId, { force: true }));
      return;
    }

    const type = typeof input.type === "string" ? input.type : "morning_briefing";
    if (type === "morning_briefing" || type === "morning-briefing") {
      if (typeof input.projectId === "string") {
        ensureDefaultMorningBriefingJob(input.projectId);
      }
      sendJson(res, 200, runMorningBriefing({
        projectId: typeof input.projectId === "string" ? input.projectId : undefined,
        force: true,
      }));
      return;
    }

    sendJson(res, 422, { error: "Unknown job type" });
    return;
  }

  if (pathname.startsWith("/jobs/") && pathname.endsWith("/enable")) {
    if (req.method !== "POST") {
      sendJson(res, 405, { error: "Method not allowed" });
      return;
    }
    const id = pathname.slice("/jobs/".length, -"/enable".length);
    const job = setJobEnabled(id, true) ?? (id === "morning-briefing"
      ? setJobEnabled(ensureDefaultMorningBriefingJob().id, true)
      : null);
    if (!job) {
      sendJson(res, 404, { error: "Job not found" });
      return;
    }
    sendJson(res, 200, { job });
    return;
  }

  if (pathname.startsWith("/jobs/") && pathname.endsWith("/disable")) {
    if (req.method !== "POST") {
      sendJson(res, 405, { error: "Method not allowed" });
      return;
    }
    const id = pathname.slice("/jobs/".length, -"/disable".length);
    const existing = getJob(id) ?? (id === "morning-briefing" ? ensureDefaultMorningBriefingJob() : null);
    if (!existing) {
      sendJson(res, 404, { error: "Job not found" });
      return;
    }
    const job = setJobEnabled(existing.id, false);
    sendJson(res, 200, { job });
    return;
  }

  sendJson(res, 404, { error: "Not found" });
}

async function handleSkillifyRequest(req: IncomingMessage, res: ServerResponse, pathname: string) {
  if (pathname === "/skillify/pending") {
    if (req.method !== "GET") {
      sendJson(res, 405, { error: "Method not allowed" });
      return;
    }
    sendJson(res, 200, {
      proposals: listPendingProposals().map((p) => ({
        id: p.id,
        kind: p.kind,
        targetPath: p.targetPath,
        excerpt: p.body.slice(0, 160),
        revision: p.revision,
        expiresAt: p.expiresAt,
      })),
    });
    return;
  }

  if (pathname === "/skillify/confirm") {
    if (req.method !== "POST") {
      sendJson(res, 405, { error: "Method not allowed" });
      return;
    }
    let body: string;
    try {
      body = await parseBody(req);
    } catch {
      sendJson(res, 413, { error: "Request body too large" });
      return;
    }

    let input: Record<string, unknown>;
    try {
      input = JSON.parse(body) as Record<string, unknown>;
    } catch {
      sendJson(res, 400, { error: "Invalid JSON" });
      return;
    }

    const action = typeof input.action === "string" ? input.action : "confirm";
    if (action === "confirm_all") {
      sendJson(res, 200, { results: confirmAllPending() });
      return;
    }
    if (action === "decline_all") {
      sendJson(res, 200, { results: declineAllPending() });
      return;
    }

    if (typeof input.proposalId !== "string" || !Number.isInteger(input.revision)) {
      sendJson(res, 422, { error: "Missing proposalId or revision" });
      return;
    }

    const result =
      action === "decline"
        ? declineProposal(input.proposalId, input.revision as number)
        : confirmProposal(input.proposalId, input.revision as number);

    if (!result.ok) {
      sendJson(res, 409, { error: result.error ?? "Skillify action failed" });
      return;
    }
    sendJson(res, 200, result);
  }
}

async function handleDelegationComplete(req: IncomingMessage, res: ServerResponse) {
  if (!DELEGATION_ENABLED) {
    sendJson(res, 501, { error: "delegation not enabled", hint: "set FLYD_DELEGATION_ENABLED=true" });
    return;
  }
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }

  let body: string;
  try {
    body = await parseBody(req);
  } catch {
    sendJson(res, 413, { error: "Request body too large" });
    return;
  }

  let completion: DelegationCompletion;
  try {
    completion = JSON.parse(body);
  } catch {
    sendJson(res, 400, { error: "Invalid JSON" });
    return;
  }

  const validationError = validateDelegationCompletion(completion);
  if (validationError) {
    recordDelegationCompletion("rejected_validation");
    sendJson(res, 422, { error: validationError });
    return;
  }

  // Trust but re-verify: the reporter's own checks are necessary but not
  // sufficient. Core re-runs every file/url claim before accepting a
  // completion — a deleted file or dead URL between runner-check and claim
  // fails here, not in front of the user.
  if (completion.status === "completed" && completion.verification) {
    const recheckable: ArtifactClaim[] = completion.verification.artifactChecks
      .map((check) => check.claim)
      .filter((claim) => claim.kind === "file" || claim.kind === "url");
    if (recheckable.length > 0) {
      const rechecks = await checkArtifacts(recheckable);
      const failed = rechecks.filter((check) => !check.passed);
      if (failed.length > 0) {
        recordDelegationCompletion("rejected_reverification");
        sendJson(res, 422, {
          error: "reverification_failed",
          failures: failed.map((check) => ({
            claim: check.claim.description,
            checks: check.failures,
          })),
        });
        return;
      }
    }
  }

  recordDelegationCompletion("accepted");
  completedDelegations.set(completion.delegationId, {
    completion,
    timestamp: Date.now(),
  });
  console.log(
    `[Flyd Core] Delegation ${completion.delegationId.slice(0, 8)} → ${completion.status}` +
      (completion.blocker ? ` (blocked: ${completion.blocker})` : "")
  );
  sendJson(res, 200, { acknowledged: true });
}

function handleDelegationCompletions(req: IncomingMessage, res: ServerResponse) {
  if (!DELEGATION_ENABLED) {
    sendJson(res, 501, { error: "delegation not enabled", hint: "set FLYD_DELEGATION_ENABLED=true" });
    return;
  }
  if (req.method !== "GET") {
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }
  sendJson(res, 200, {
    completions: [...completedDelegations.values()].map((entry) => entry.completion),
  });
}

function handleHealth(_req: IncomingMessage, res: ServerResponse) {
  // Counters only — privacy invariant #9 forbids string fields in telemetry.
  sendJson(res, 200, { status: "ok", version: "1.0", metrics: overlayMetricsSnapshot() });
}

async function handleVoiceStatus(_req: IncomingMessage, res: ServerResponse) {
  sendJson(res, 200, await checkVoiceSetup());
}

async function handleTts(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }

  let body: string;
  try {
    body = await parseBody(req);
  } catch {
    sendJson(res, 413, { error: "Request body too large" });
    return;
  }

  let parsed: { text?: string };
  try {
    parsed = JSON.parse(body);
  } catch {
    sendJson(res, 400, { error: "Invalid JSON" });
    return;
  }

  if (typeof parsed.text !== "string" || !parsed.text.trim()) {
    sendJson(res, 400, { error: "Missing text" });
    return;
  }

  try {
    const audio = await synthesizeSpeech(parsed.text);
    res.writeHead(200, { "Content-Type": "audio/aac", "Content-Length": audio.length });
    res.end(audio);
  } catch (err) {
    if (err instanceof TtsNotConfiguredError) {
      sendJson(res, 503, { error: "Speech synthesis not configured" });
      return;
    }
    console.error("[Flyd Core] TTS failed:", err);
    sendJson(res, 500, { error: "Speech synthesis failed" });
  }
}

let serverInstance: ReturnType<typeof createServer> | null = null;

export async function startServer(port = 4815, host = "127.0.0.1"): Promise<void> {
  if (serverInstance) {
    throw new Error("Server is already running");
  }

  // Fail repository-action runs stranded by a previous process BEFORE the
  // socket opens — otherwise this sweep can clobber jobs started moments
  // after listen(). Parked runs survive restarts untouched.
  await repositoryActionJobs.recoverInterrupted().catch(() => undefined);

  return new Promise((resolvePromise, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url || "/", `http://${host}:${port}`);

      switch (url.pathname) {
      case "/manifest":
        if (!checkAuth(req)) { sendUnauthorized(res); break; }
        handleManifest(req, res);
        break;
      case "/manifest/outcome":
        if (!checkAuth(req)) { sendUnauthorized(res); break; }
        handleOutcome(req, res);
        break;
      case "/skillify/pending":
      case "/skillify/confirm": {
        if (!checkAuth(req)) { sendUnauthorized(res); break; }
        void handleSkillifyRequest(req, res, url.pathname);
        break;
      }
      case "/jobs":
      case "/jobs/pause":
      case "/jobs/resume":
      case "/jobs/kill":
      case "/jobs/run": {
        if (!checkAuth(req)) { sendUnauthorized(res); break; }
        void handleJobsRequest(req, res, url.pathname);
        break;
      }
      case "/foreground-feedback":
        if (!checkAuth(req)) { sendUnauthorized(res); break; }
        handleForegroundFeedback(req, res);
        break;
      case "/learnings/pending":
        if (!checkAuth(req)) { sendUnauthorized(res); break; }
        sendJson(res, 200, { learnings: getPendingLearnings() });
        break;
      case "/learnings/acknowledge": {
        if (!checkAuth(req)) { sendUnauthorized(res); break; }
        if (req.method !== "POST") { sendJson(res, 405, { error: "Method not allowed" }); break; }
        parseBody(req).then((body) => {
          try {
            const { learningId } = JSON.parse(body);
            const ok = acknowledgeLearning(learningId);
            sendJson(res, ok ? 200 : 404, ok ? { acknowledged: true } : { error: "Learning not found" });
          } catch { sendJson(res, 400, { error: "Invalid JSON" }); }
        }).catch(() => sendJson(res, 400, { error: "Failed to read body" }));
        break;
      }
      case "/learnings/synthesize": {
        if (!checkAuth(req)) { sendUnauthorized(res); break; }
        if (req.method !== "POST") { sendJson(res, 405, { error: "Method not allowed" }); break; }
        const result = synthesizeLearnings();
        if (result.beliefs.length > 0 || result.behaviours.length > 0) {
          persistLearnings(
            result.beliefs.map(b => ({ ...b })),
            result.behaviours.map(b => ({ ...b }))
          );
        }
        sendJson(res, 200, {
          synthesized: result.beliefs.length + result.behaviours.length,
          beliefs: result.beliefs.length,
          behaviours: result.behaviours.length,
        });
        break;
      }
      case "/delegation/complete":
        if (!checkAuth(req)) { sendUnauthorized(res); break; }
        handleDelegationComplete(req, res);
        break;
      case "/delegation/completions":
        if (!checkAuth(req)) { sendUnauthorized(res); break; }
        handleDelegationCompletions(req, res);
        break;
      case "/health":
        handleHealth(req, res);
        break;
      case "/work-intelligence/session": {
        if (!checkAuth(req)) { sendUnauthorized(res); break; }
        const sessionParams = url.searchParams;
        if (req.method === "POST") {
          const session = workSessionStore.createSession();
          sendJson(res, 201, { sessionId: session.sessionId, revision: session.revision });
        } else {
          const sessionId = sessionParams.get("session_id");
          if (!sessionId) { sendJson(res, 400, { error: "Missing session_id" }); break; }
          const session = workSessionStore.get(sessionId);
          if (!session) { sendJson(res, 404, { error: "Session not found" }); break; }
          sendJson(res, 200, {
            sessionId: session.sessionId,
            revision: session.revision,
            turnCount: session.turns.length,
            currentWork: session.currentWork,
            evidenceSummary: session.evidenceSummary,
          });
        }
        break;
      }
      case "/voice/status":
        if (!checkAuth(req)) { sendUnauthorized(res); break; }
        handleVoiceStatus(req, res);
        break;
      case "/tts":
        if (!checkAuth(req)) { sendUnauthorized(res); break; }
        handleTts(req, res);
        break;
      case "/shutdown":
        if (!checkAuth(req)) { sendUnauthorized(res); break; }
        sendJson(res, 200, { status: "shutting_down" });
        process.nextTick(() => process.exit(0));
        break;
      case "/work-intelligence/contract":
        if (!checkAuth(req)) { sendUnauthorized(res); break; }
        handleWorkInteractionContractNegotiation(req, res);
        break;
      case "/work-intelligence/action/approve": {
        if (!checkAuth(req)) { sendUnauthorized(res); break; }
        if (req.method !== "POST") { sendJson(res, 405, { error: "Method not allowed" }); break; }
        parseBody(req).then((body) => {
          try {
            const input = JSON.parse(body) as Record<string, unknown>;
            if (typeof input.workSessionId !== "string" || typeof input.actionId !== "string" || !Number.isInteger(input.workSessionRevision)) {
              sendJson(res, 422, { error: "Missing Work Session, action, or revision" });
              return;
            }
            const approval = workSessionStore.approveActionProposal(
              input.workSessionId,
              input.actionId,
              input.workSessionRevision as number,
            );
            if (!approval.ok) {
              sendJson(res, 409, { error: approval.error });
              return;
            }
            const grant = approval.grant;
            try {
              recordJournalEntry({
              entryId: `approval-${grant.grantId}`,
              interactionId: grant.interactionId,
              workSessionId: input.workSessionId,
              timestamp: new Date().toISOString(),
              eventType: 'action_approved',
              details: {
                actionKind: 'repository_action',
                verified: false,
                repositoryOutcome: {
                  actionId: grant.actionId,
                  actionGrantId: grant.grantId,
                  diagnosedIssueId: grant.diagnosedIssueId,
                  approval: 'approved',
                  changedFileCount: 0,
                  changedFiles: [],
                  checksPerformed: [],
                  verificationResults: [],
                  verdict: 'approved',
                  handoffAvailable: false,
                },
              },
              });
            } catch (journalError) {
              workSessionStore.updateActionGrant(input.workSessionId, {
                ...grant,
                status: 'invalidated',
                invalidationReason: 'Approval receipt could not be persisted',
              });
              sendJson(res, 500, { error: (journalError as Error).message });
              return;
            }
            sendJson(res, 201, {
              actionGrantId: grant.grantId,
              actionId: grant.actionId,
              workSessionRevision: grant.workSessionRevision,
              expiresAt: grant.expiresAt,
              scope: {
                repositoryRoot: grant.targetFingerprint.repositoryRoot,
                branch: grant.targetFingerprint.branch,
                operation: grant.allowedOperation,
                instruction: grant.instruction,
                finishCondition: grant.finishCondition,
              },
            });
          } catch (error) {
            sendJson(res, 400, { error: (error as Error).message || "Invalid JSON" });
          }
        }).catch(() => sendJson(res, 400, { error: "Failed to read body" }));
        break;
      }
      case "/work-intelligence/repository-action": {
        if (!checkAuth(req)) { sendUnauthorized(res); break; }
        if (req.method !== "POST") { sendJson(res, 405, { error: "Method not allowed" }); break; }
        parseBody(req).then(async (body) => {
          try {
            const input = JSON.parse(body) as Record<string, unknown>;

            const dependencyBoundary = verifyModuleDependencyBoundary();
            if (!dependencyBoundary.ok) {
              sendJson(res, 500, {
                error: "Dependency boundary violation",
                details: dependencyBoundary.violations,
              });
              return;
            }

            if (typeof input.workSessionId !== "string" || typeof input.actionGrantId !== "string" || !Number.isInteger(input.workSessionRevision)) {
              sendJson(res, 422, {
                error: "Missing Work Session, action grant, or revision",
                details: "Repository work requires a grant minted from an approved intervention.",
              });
              return;
            }

            const claim = workSessionStore.claimActionGrant(
              input.workSessionId,
              input.actionGrantId,
              input.workSessionRevision as number,
            );
            if (!claim.ok) {
              sendJson(res, 409, { error: claim.error });
              return;
            }
            const grant = claim.grant;
            if (grant.allowedOperation !== 'repository_work') {
              const terminal = recordRepositoryTerminalOutcome(input.workSessionId, grant, {
                verified: false,
                diffPresent: false,
                error: 'Action grant does not authorize repository work',
                changedFiles: [],
              });
              if (!terminal.ok) {
                sendJson(res, 500, { error: 'Repository result could not be recorded durably' });
                return;
              }
              sendJson(res, 422, { error: 'Action grant does not authorize repository work' });
              return;
            }
            const repositoryInput = {
              approvedRoot: grant.targetFingerprint.repositoryRoot ?? '',
              instruction: grant.instruction,
              finishCondition: grant.finishCondition,
              workSessionRevision: grant.workSessionRevision,
              actionGrantId: grant.grantId,
              expectedFingerprint: grant.targetFingerprint,
            };
            const validationError = validateRepositoryActionInput(repositoryInput);
            if (validationError) {
              const terminal = recordRepositoryTerminalOutcome(input.workSessionId, grant, {
                verified: false,
                diffPresent: false,
                error: validationError,
                changedFiles: [],
              });
              if (!terminal.ok) {
                sendJson(res, 500, { error: 'Repository result could not be recorded durably' });
                return;
              }
              sendJson(res, 422, { error: validationError });
              return;
            }

            try {
              const job = await repositoryActionJobs.start(grant.grantId, async () => {
                let result: RepositoryActionResult;
                try {
                  result = await runRepositoryAction(repositoryInput);
                } catch (error) {
                  const message = (error as Error).message || 'Repository execution failed';
                  const terminal = recordRepositoryTerminalOutcome(input.workSessionId as string, grant, {
                    verified: false,
                    diffPresent: false,
                    error: message,
                    changedFiles: [],
                  });
                  throw new Error(terminal.ok ? message : 'Repository result could not be recorded durably');
                }
                const terminal = recordRepositoryTerminalOutcome(input.workSessionId as string, grant, result);
                if (!terminal.ok) {
                  throw new Error('Repository result could not be recorded durably');
                }
                return result;
              });
              sendJson(res, 202, { jobId: job.jobId, status: job.status, deadlineAt: job.deadlineAt, pollAfterMs: 1000 });
            } catch (error) {
              const terminal = recordRepositoryTerminalOutcome(input.workSessionId, grant, {
                verified: false,
                diffPresent: false,
                error: (error as Error).message,
                changedFiles: [],
              });
              sendJson(res, terminal.ok ? 503 : 500, { error: terminal.ok ? (error as Error).message : 'Repository result could not be recorded durably' });
              return;
            }
          } catch {
            sendJson(res, 400, { error: "Invalid JSON" });
          }
        }).catch(() => sendJson(res, 400, { error: "Failed to read body" }));
        break;
      }
      case "/work-intelligence/repository-action/status": {
        if (!checkAuth(req)) { sendUnauthorized(res); break; }
        if (req.method !== "GET") { sendJson(res, 405, { error: "Method not allowed" }); break; }
        const jobId = url.searchParams.get("jobId");
        if (!jobId) { sendJson(res, 400, { error: "Missing jobId parameter" }); break; }
        void repositoryActionJobs.get(jobId).then((job) => {
          if (!job) {
            sendJson(res, 404, { error: "Repository action not found" });
            return;
          }
          sendJson(res, 200, {
            jobId: job.jobId,
            status: job.status,
            deadlineAt: job.deadlineAt,
            result: job.result ? repositoryActionResponse(job.result) : undefined,
            error: job.error,
          });
        }).catch(() => sendJson(res, 500, { error: "Repository action status failed" }));
        break;
      }
      case "/work-intelligence/command/execute": {
        if (!checkAuth(req)) { sendUnauthorized(res); break; }
        if (req.method !== "POST") { sendJson(res, 405, { error: "Method not allowed" }); break; }
        parseBody(req, MANIFEST_BODY_LIMIT).then(async (body) => {
          try {
            const parsedBody = JSON.parse(body);
            const validation = validateShellExecutionRequest(parsedBody);
            if (!validation.ok) {
              sendJson(res, 422, { error: validation.reason });
              return;
            }
            const execResult = createExecution({
              executionId: validation.request.executionId,
              status: 'approved',
              commands: validation.request.commands.map(c => ({
                commandId: c.commandId,
                stdout: '',
                stderr: '',
                exitCode: null,
                timedOut: false,
                startedAt: new Date().toISOString(),
                completedAt: null,
                status: 'pending' as const,
              })),
              startTime: new Date().toISOString(),
              endTime: null,
            });
            sendJson(res, 200, { executionId: execResult.executionId, status: 'approved' });
            runExecution(validation.request).catch(err => {
              console.warn(`[Flyd Core] Command execution ${execResult.executionId} failed:`, err);
            });
          } catch {
            sendJson(res, 400, { error: "Invalid JSON" });
          }
        }).catch(() => sendJson(res, 400, { error: "Failed to read body" }));
        break;
      }
      case "/work-intelligence/command/status": {
        if (!checkAuth(req)) { sendUnauthorized(res); break; }
        if (req.method !== "GET") { sendJson(res, 405, { error: "Method not allowed" }); break; }
        const executionId = url.searchParams.get("executionId");
        if (!executionId) { sendJson(res, 400, { error: "Missing executionId parameter" }); break; }
        const status = getExecutionStatus(executionId);
        if (!status) { sendJson(res, 404, { error: "Execution not found" }); break; }
        sendJson(res, 200, status);
        break;
      }
      case "/work-intelligence/command/cancel": {
        if (!checkAuth(req)) { sendUnauthorized(res); break; }
        if (req.method !== "POST") { sendJson(res, 405, { error: "Method not allowed" }); break; }
        parseBody(req).then((body) => {
          try {
            const { executionId } = JSON.parse(body);
            const cancelled = cancelExecution(executionId);
            sendJson(res, cancelled ? 200 : 404, cancelled ? { cancelled: true } : { error: "Execution not found" });
          } catch {
            sendJson(res, 400, { error: "Invalid JSON" });
          }
        }).catch(() => sendJson(res, 400, { error: "Failed to read body" }));
        break;
      }
      case "/work-intelligence/file/read": {
        if (!checkAuth(req)) { sendUnauthorized(res); break; }
        if (req.method !== "POST") { sendJson(res, 405, { error: "Method not allowed" }); break; }
        parseBody(req).then((body) => {
          try {
            const { path, projectRoot, startLine, endLine } = JSON.parse(body);
            if (!projectRoot) { sendJson(res, 400, { error: "Missing projectRoot" }); return; }
            const validation = validateFileRead(path, projectRoot);
            if (!validation.ok) { sendJson(res, 422, { error: validation.reason }); return; }
            const result = readFile({ path, projectRoot, resolved: validation.resolved, startLine, endLine });
            sendJson(res, 200, result);
          } catch (err) {
            sendJson(res, 500, { error: (err as Error).message });
          }
        }).catch(() => sendJson(res, 400, { error: "Failed to read body" }));
        break;
      }
      case "/work-intelligence/file/grep": {
        if (!checkAuth(req)) { sendUnauthorized(res); break; }
        if (req.method !== "POST") { sendJson(res, 405, { error: "Method not allowed" }); break; }
        parseBody(req).then((body) => {
          try {
            const { pattern, projectRoot, filePattern, maxResults } = JSON.parse(body);
            if (!projectRoot) { sendJson(res, 400, { error: "Missing projectRoot" }); return; }
            const validation = validateFileGrep(pattern);
            if (!validation.ok) { sendJson(res, 422, { error: validation.reason }); return; }
            const result = grepCodebase({ pattern, projectRoot, filePattern, maxResults });
            sendJson(res, 200, result);
          } catch (err) {
            sendJson(res, 500, { error: (err as Error).message });
          }
        }).catch(() => sendJson(res, 400, { error: "Failed to read body" }));
        break;
      }
      case "/work-intelligence/file/write": {
        if (!checkAuth(req)) { sendUnauthorized(res); break; }
        if (req.method !== "POST") { sendJson(res, 405, { error: "Method not allowed" }); break; }
        parseBody(req, MANIFEST_BODY_LIMIT).then((body) => {
          try {
            const { path, content, projectRoot, createDirectories } = JSON.parse(body);
            if (!projectRoot) { sendJson(res, 400, { error: "Missing projectRoot" }); return; }
            const validation = validateFileWrite(path, content, projectRoot);
            if (!validation.ok) { sendJson(res, 422, { error: validation.reason }); return; }
            const result = writeFile({ path, content, projectRoot, resolved: validation.resolved, createDirectories });
            sendJson(res, 200, result);
          } catch (err) {
            sendJson(res, 500, { error: (err as Error).message });
          }
        }).catch(() => sendJson(res, 400, { error: "Failed to read body" }));
        break;
      }
      case "/work-intelligence/task/plan": {
        if (!checkAuth(req)) { sendUnauthorized(res); break; }
        if (req.method !== "POST") { sendJson(res, 405, { error: "Method not allowed" }); break; }
        parseBody(req).then(async (body) => {
          try {
            const { intent, projectRoot, currentWork, context } = JSON.parse(body);
            if (!intent || !projectRoot) { sendJson(res, 400, { error: "Missing intent or projectRoot" }); return; }
            const config = loadFlydWorkerConfig();
            const plan = await planTask({
              intent,
              projectRoot,
              currentWork: currentWork || projectRoot,
              context,
              modelConfig: { model: config.model, apiKey: config.apiKey, baseURL: config.baseURL },
            });
            if (!plan) { sendJson(res, 422, { error: "Failed to produce task plan" }); return; }
            sendJson(res, 200, plan);
          } catch (err) {
            sendJson(res, 500, { error: (err as Error).message });
          }
        }).catch(() => sendJson(res, 400, { error: "Failed to read body" }));
        break;
      }
      case "/work-intelligence/task/verify": {
        if (!checkAuth(req)) { sendUnauthorized(res); break; }
        if (req.method !== "POST") { sendJson(res, 405, { error: "Method not allowed" }); break; }
        parseBody(req).then(async (body) => {
          try {
            const taskPlan = JSON.parse(body) as TaskPlan;
            const prompt = buildVerifyPrompt(taskPlan);
            const config = loadFlydWorkerConfig();
            const raw = await query(
              prompt,
              config.model,
              undefined,
              config.apiKey,
              config.baseURL,
              { json: true }
            );
            const jsonMatch = raw.trim().match(/\{[\s\S]*\}/);
            const parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : { verdict: 'failed', summary: 'Unable to verify', unresolved_items: [], next_action: null };
            sendJson(res, 200, parsed);
          } catch (err) {
            sendJson(res, 500, { error: (err as Error).message });
          }
        }).catch(() => sendJson(res, 400, { error: "Failed to read body" }));
        break;
      }
      case "/journal": {
        if (!checkAuth(req)) { sendUnauthorized(res); break; }
        if (req.method === "POST") {
          parseBody(req).then(body => handleJournalPost(req, res, body)).catch(() => sendJson(res, 400, { error: "Failed to read body" }));
        } else {
          handleJournalList(req, res, url.searchParams);
        }
        break;
      }
        default: {
          const journalEntryMatch = url.pathname.match(/^\/journal\/([a-zA-Z0-9_-]+)$/);
          if (journalEntryMatch) {
            if (!checkAuth(req)) { sendUnauthorized(res); break; }
            handleJournalEntry(req, res, journalEntryMatch[1]);
            break;
          }
          if (/^\/jobs\/[^/]+\/(enable|disable)$/.test(url.pathname)) {
            if (!checkAuth(req)) { sendUnauthorized(res); break; }
            void handleJobsRequest(req, res, url.pathname);
            break;
          }
          sendJson(res, 404, { error: "Not found" });
        }
      }
    });

    server.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") {
        reject(new Error(`Port ${port} is already in use. Is Flyd Core already running?`));
      } else {
        reject(err);
      }
    });

    server.listen(port, host, async () => {
      serverInstance = server;
      console.log(`[Flyd Core] Server listening on http://${host}:${port}`);

      try {
        const pluginSync = await syncInstalledOpenCodePlugin();
        if (pluginSync.status === "updated") {
          console.log("[Flyd Core] Updated the installed OpenCode capture integration");
        }
      } catch (error) {
        console.warn("[Flyd Core] OpenCode capture integration sync failed:", (error as Error).message);
      }

      const loaded = loadLearnings();
      if (loaded.beliefs > 0 || loaded.behaviours > 0) {
        console.log(`[Flyd Core] Loaded ${loaded.beliefs} beliefs, ${loaded.behaviours} behaviours from previous sessions`);
      }

      startTranscriptionServer().then(() => {
        console.log(`[Flyd Core] Transcription server ready`);
      }).catch((err) => {
        console.warn(`[Flyd Core] Transcription server failed to start:`, err.message);
      });

      startRealtimeServer().then(() => {
        console.log(`[Flyd Core] Realtime server ready`);
      }).catch((err) => {
        console.warn(`[Flyd Core] Realtime server failed to start:`, err.message);
      });

      // Background daily-brief cron: composes and persists the brief so the
      // opening / /brief show a fresh brief without blocking the session on
      // network research. Runs immediately on start, then on an interval.
      // Default cadence is daily; override minutes via FLYD_BRIEF_INTERVAL_MINUTES.
      const briefIntervalMs = (() => {
        const minutes = Number(getKey("FLYD_BRIEF_INTERVAL_MINUTES"));
        if (Number.isFinite(minutes) && minutes > 0) return minutes * 60 * 1000;
        return undefined;
      })();
      startBriefScheduler({
        intervalMs: briefIntervalMs,
        deps: {
          last30daysScript: getKey("LAST30DAYS_SCRIPT"),
          last30daysTopics: getKey("LAST30DAYS_TOPICS")
            ?.split(",").map((t) => t.trim()).filter(Boolean),
        },
      });
      console.log(`[Flyd Core] Daily brief scheduler started`);

      startTransitionJudge();
      console.log(`[Flyd Core] Transition judge sweep started`);

      resolvePromise();
    });
  });
}

export function stopServer(): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    if (!serverInstance) {
      resolvePromise();
      return;
    }

    serverInstance.close((err) => {
      serverInstance = null;
      if (err) {
        console.warn("[Flyd Core] Server close error:", err.message);
        resolvePromise();
      } else {
        console.log("[Flyd Core] Server stopped");
        const fallback = setTimeout(resolvePromise, 5000);
        stopBriefScheduler();
        stopTransitionJudge();
        stopTranscriptionServer().then(() => stopRealtimeServer()).then(() => {
          clearTimeout(fallback);
          resolvePromise();
        }).catch((stopErr) => {
          clearTimeout(fallback);
          console.warn("[Flyd Core] Sub-server stop error:", stopErr?.message ?? stopErr);
          resolvePromise();
        });
      }
    });
  });
}

export function isRunning(): boolean {
  return serverInstance !== null;
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  switch (command) {
    case "start":
      await startServer();
      break;
    case "stop": {
      try {
        const res = await fetch(`http://${HOST}:${PORT}/shutdown`, { method: "POST" });
        if (res.ok) console.log("[Flyd Core] Server stopped.");
        else console.log("[Flyd Core] Server returned unexpected status.");
      } catch {
        console.log("[Flyd Core] Server is not running.");
      }
      break;
    }
    case "status": {
      try {
        const res = await fetch(`http://${HOST}:${PORT}/health`);
        const body = await res.json();
        console.log(`[Flyd Core] Running: ${JSON.stringify(body)}`);
      } catch {
        console.log("[Flyd Core] Not running.");
      }
      break;
    }
    default:
      console.log("Usage: flyd-core-server start|stop|status");
      process.exit(1);
  }
}

const isMainModule = process.argv[1]?.includes("server");
if (isMainModule) {
  main().catch((err) => {
    console.error("[Flyd Core] Fatal:", err);
    process.exit(1);
  });
}

process.on("SIGTERM", async () => {
  console.log("[Flyd Core] Received SIGTERM, draining...");
  await stopServer();
  process.exit(0);
});

process.on("SIGINT", async () => {
  console.log("[Flyd Core] Received SIGINT, draining...");
  await stopServer();
  process.exit(0);
});
