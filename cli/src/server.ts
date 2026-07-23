import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { memoryGate } from "./memory-gate.js";
import { provisionalLearn, createMemoryReceipt, acknowledgeLearning, getPendingLearnings, synthesizeLearnings } from "./memory-receipt.js";
import { persistReceipt, persistLearnings } from "./memory-persistence.js";
import { resolve, ManifestRequest } from "./resolve.js";
import { isDelegationIntent, buildDelegationEnvelope } from "./delegation.js";
import { buildIntelligenceState } from "./export-state.js";
import type { Resolution, ResolutionOutcome } from "./resolve-types.js";
import { validateResolution } from "./resolve-types.js";
import { loadFlydWorkerConfig } from "./runtime/flyd-worker-config.js";

const PORT = 4815;
const HOST = "127.0.0.1";
const AUTH_TOKEN_PATH = join(homedir(), ".flyd", "overlay", "auth-token");

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
const resolvedContexts = new Map<string, { intent: string; resolutionMode: string; environmentSummary: string; timestamp: number }>();

setInterval(() => {
  const cutoff = Date.now() - 60 * 60 * 1000;
  for (const [key, ctx] of resolvedContexts) {
    if (ctx.timestamp < cutoff) resolvedContexts.delete(key);
  }
}, 5 * 60 * 1000).unref();

interface ManifestRequestBody {
  invocation_id: string;
  environment_revision: number;
  environment: ManifestRequest["environment"];
  intent: string;
  modality: "text" | "voice";
  invocation_fingerprint: ManifestRequest["invocation_fingerprint"];
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function parseBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk: Buffer) => {
      data += chunk.toString();
      if (data.length > 64 * 1024) {
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
    body = await parseBody(req);
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
    const resolution = await resolve(
      {
        invocation_id: parsed.invocation_id,
        environment_revision: parsed.environment_revision || 1,
        environment: parsed.environment,
        intent: parsed.intent,
        modality: parsed.modality || "text",
        invocation_fingerprint: parsed.invocation_fingerprint,
      },
      config.model
    );

    const validationError = validateResolution(resolution);
    if (validationError) {
      sendJson(res, 422, { error: validationError.error, code: validationError.code });
      return;
    }

    if (resolution.mode === "requires_compose") {
      resolution.composeUrl = "http://127.0.0.1:3000/surface";
    }

    if (isDelegationIntent(parsed.intent)) {
      const worldState = buildIntelligenceState();
      const envelope = buildDelegationEnvelope(
        parsed.intent,
        worldState as unknown as Record<string, unknown>,
        parsed.environment.focused_element?.ref ? [parsed.environment.focused_element.ref] : [],
        parsed.environment.application?.bundle_id || null
      );
      resolution.delegationEnvelope = envelope as unknown as Record<string, unknown>;
    }

    sendJson(res, 200, resolution);

    intentHistory.push({
      intent: parsed.intent,
      timestamp: new Date().toISOString(),
    });
    if (intentHistory.length > 100) intentHistory.shift();

    resolvedContexts.set(parsed.invocation_id, {
      intent: parsed.intent,
      resolutionMode: resolution.mode,
      environmentSummary: `${parsed.environment.application?.bundle_id || "unknown"} — ${parsed.environment.focused_element?.role || "unknown"}`,
      timestamp: Date.now(),
    });
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
        gateResult.reason
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
  } else {
    console.warn(`[Flyd Core] Outcome received with no matching manifest: ${outcome.invocationId.slice(0, 8)}`);
  }

  sendJson(res, 200, { acknowledged: true });
}

function handleHealth(_req: IncomingMessage, res: ServerResponse) {
  sendJson(res, 200, { status: "ok", version: "1.0" });
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
      case "/health":
        handleHealth(req, res);
        break;
      case "/shutdown":
        if (!checkAuth(req)) { sendUnauthorized(res); break; }
        sendJson(res, 200, { status: "shutting_down" });
        process.nextTick(() => process.exit(0));
        break;
        default:
          sendJson(res, 404, { error: "Not found" });
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
      if (err) {
        reject(err);
      } else {
        serverInstance = null;
        console.log("[Flyd Core] Server stopped");
        resolvePromise();
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
