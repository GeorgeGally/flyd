import { config } from "dotenv";
import { resolve as resolvePath, join } from "node:path";

config({ path: resolvePath(join(process.cwd(), "..", ".env")) });
config({ path: resolvePath(join(process.cwd(), ".env")) });

import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
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
import { runRepositoryAction, validateRepositoryActionInput, verifyModuleDependencyBoundary } from "./work-intelligence/repository-action.js";
import { recordJournalEntry } from "./work-intelligence/outcome-journal.js";
import type { FounderJournalEntry } from "./work-intelligence/types.js";
import { handleJournalPost, handleJournalList, handleJournalEntry, handleWorkInteractionContractNegotiation } from "./http/work-interaction-handlers.js";
import { validateShellExecutionRequest, createExecution, runExecution, getExecutionStatus, cancelExecution } from "./work-intelligence/command-execution.js";
import type { ShellExecutionResult } from "./work-intelligence/types.js";
import { validateFileRead, readFile, validateFileGrep, grepCodebase, validateFileWrite, writeFile } from "./work-intelligence/file-operations.js";
import { planTask, parseTaskPlan, buildVerifyPrompt } from "./work-intelligence/task-loop.js";
import type { TaskPlan } from "./work-intelligence/task-loop.js";
import { query } from "./lib/llm.js";

const PORT = 4815;
const HOST = "127.0.0.1";
const AUTH_TOKEN_PATH = join(homedir(), ".flyd", "overlay", "auth-token");
const DELEGATION_ENABLED = process.env.FLYD_DELEGATION_ENABLED === "true";

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

    if (!isDictation) {
      const wiResult = await runWorkIntelligence({
        invocationId: parsed.invocation_id,
        intent: parsed.intent,
        modality: parsed.modality || "text",
        environment: parsed.environment,
        conversationId: parsed.conversation_id,
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

      const mode = isTaskPlan ? 'requires_task'
        : (hasShellCommands || hasFileOperations) ? 'requires_execution'
        : 'requires_augment';

      const augmentJson: Record<string, unknown> = {
        mode,
        resolutionId: wiResult.interactionId,
        invocationId: parsed.invocation_id,
        environmentRevision: parsed.environment_revision ?? 1,
        rationale: wiResult.diagnosis.primaryIssue.finding,
        augmentations: [] as Record<string, unknown>[],
        timing: wiResult.timing,
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
    if (resolved.workSessionId && outcomeMapsToCloseout) {
      try {
        const closeout = closeWorkSession(resolved.workSessionId);
        if (closeout && closeout.retainedLearnings.length > 0) {
          for (const candidate of closeout.retainedLearnings) {
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

  sendJson(res, 200, { acknowledged: true });
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

export function startServer(port = 4815, host = "127.0.0.1"): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    if (serverInstance) {
      reject(new Error("Server is already running"));
      return;
    }

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
      case "/work-intelligence/repository-action": {
        if (!checkAuth(req)) { sendUnauthorized(res); break; }
        if (req.method !== "POST") { sendJson(res, 405, { error: "Method not allowed" }); break; }
        parseBody(req).then(async (body) => {
          try {
            const input = JSON.parse(body);

            const dependencyBoundary = verifyModuleDependencyBoundary();
            if (!dependencyBoundary.ok) {
              sendJson(res, 500, {
                error: "Dependency boundary violation",
                details: dependencyBoundary.violations,
              });
              return;
            }

            if (!input.actionGrantId || typeof input.actionGrantId !== "string") {
              sendJson(res, 422, {
                error: "Missing actionGrantId",
                details: "Only approved interventions can trigger repository work. Provide an actionGrantId from an approved intervention.",
              });
              return;
            }

            const validationError = validateRepositoryActionInput(input);
            if (validationError) {
              sendJson(res, 422, { error: validationError });
              return;
            }

            const result = await runRepositoryAction(input);

            const responseBody = {
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
              error: result.error,
              output: result.output?.slice(0, 500),
            };

            sendJson(res, result.verified ? 200 : 422, responseBody);
          } catch {
            sendJson(res, 400, { error: "Invalid JSON" });
          }
        }).catch(() => sendJson(res, 400, { error: "Failed to read body" }));
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

    server.listen(port, host, () => {
      serverInstance = server;
      console.log(`[Flyd Core] Server listening on http://${host}:${port}`);

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
