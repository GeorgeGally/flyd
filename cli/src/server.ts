import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { resolve, ManifestRequest } from "./resolve.js";
import type { Resolution, ResolutionOutcome } from "./resolve-types.js";
import { validateResolution } from "./resolve-types.js";
import { loadFlydWorkerConfig } from "./runtime/flyd-worker-config.js";

const PORT = 4815;
const HOST = "127.0.0.1";

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

    sendJson(res, 200, resolution);
  } catch (err) {
    sendJson(res, 500, {
      error: err instanceof Error ? err.message : "Internal server error",
    });
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
    sendJson(res, 400, { error: "Missing resolution_id or invocation_id" });
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

  sendJson(res, 200, { acknowledged: true });
}

function handleHealth(_req: IncomingMessage, res: ServerResponse) {
  sendJson(res, 200, { status: "ok", version: "1.0" });
}

let serverInstance: ReturnType<typeof createServer> | null = null;

export function startServer(port: number = PORT, host: string = HOST): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    if (serverInstance) {
      reject(new Error("Server is already running"));
      return;
    }

    const server = createServer((req, res) => {
      const url = new URL(req.url || "/", `http://${host}:${port}`);

      switch (url.pathname) {
        case "/manifest":
          handleManifest(req, res);
          break;
        case "/manifest/outcome":
          handleOutcome(req, res);
          break;
        case "/health":
          handleHealth(req, res);
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
        await fetch(`http://${HOST}:${PORT}/health`);
        console.log("[Flyd Core] Server is running. Send SIGTERM to stop.");
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
