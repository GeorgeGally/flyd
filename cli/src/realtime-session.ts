import { WebSocket, WebSocketServer } from "ws";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { IncomingMessage } from "node:http";
import { resolve, ManifestRequest } from "./resolve.js";
import { validateResolution, type Resolution, type ResolutionError } from "./resolve-types.js";
import { loadFlydWorkerConfig } from "./runtime/flyd-worker-config.js";

const REALTIME_INSTRUCTIONS =
  "You are Flyd, a voice assistant overlaying the user's Mac. You are connected to Flyd Core " +
  "through the flyd_resolve_intent tool. Core can use the user's personal memory, current Mac " +
  "context, and live external evidence, and can produce operations to execute on their computer. " +
  "You MUST call flyd_resolve_intent whenever the user asks about themselves, their data, work, " +
  "projects, or memories; asks for current, latest, recent, live, price, availability, version, " +
  "news, comparison, recommendation, review, or verification information; explicitly asks you to " +
  "search, browse, check, investigate, or look something up; or refers to a link, page, repo, video, " +
  "listing, or other object currently visible on screen. Never answer those requests from your own " +
  "model knowledge and never claim you lack access to personal information. Stable general-knowledge " +
  "questions may be answered directly. When the tool returns augmentations, speak their content to " +
  "the user as the answer. When it returns operations, briefly confirm what was done.";

const REALTIME_WS_PORT = 4817;
const AUTH_TOKEN_PATH = join(homedir(), ".flyd", "overlay", "auth-token");

function loadToken(): string | null {
  try { return readFileSync(AUTH_TOKEN_PATH, "utf-8").trim(); } catch { return null; }
}

function wsAuth(req: IncomingMessage): boolean {
  const token = loadToken();
  if (!token) return false;
  const auth = req.headers["authorization"] || "";
  return auth === `Bearer ${token}`;
}

let wss: WebSocketServer | null = null;

export function startRealtimeServer(): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    if (wss) { resolvePromise(); return; }

    wss = new WebSocketServer({
      port: REALTIME_WS_PORT,
      host: "127.0.0.1",
      maxPayload: 256 * 1024,
      verifyClient: ({ req }: { req: IncomingMessage }) => wsAuth(req),
    });

    wss.on("listening", () => {
      console.log(`[Flyd Core] Realtime WS listening on 127.0.0.1:${REALTIME_WS_PORT}`);
      resolvePromise();
    });

    wss.on("error", reject);

    wss.on("connection", (adapterWs) => {
      const sessionId = randomUUID();
      console.log(`[Flyd Core] Realtime session ${sessionId.slice(0, 8)} connected`);

      let openaiWs: WebSocket | null = null;
      let sessionActive = false;
      const observationResolvers = new Map<string, (env: Record<string, unknown>) => void>();

      adapterWs.on("message", async (data) => {
        try {
          const msg = JSON.parse(data.toString());

          switch (msg.type) {
          case "start":
            adapterWs.send(JSON.stringify({ type: "connecting" }));
            try {
              openaiWs = await connectRealtime(adapterWs, observationResolvers);
              adapterWs.send(JSON.stringify({ type: "ready" }));
              sessionActive = true;
            } catch {
              adapterWs.send(JSON.stringify({ type: "error", message: "Realtime service unreachable" }));
            }
            break;
          case "audio":
            if (openaiWs && openaiWs.readyState === WebSocket.OPEN) {
              openaiWs.send(JSON.stringify({
                type: "input_audio_buffer.append",
                audio: msg.audio,
              }));
            }
            break;
          case "observation":
            if (msg.request_id && observationResolvers.has(msg.request_id)) {
              const resolve = observationResolvers.get(msg.request_id)!;
              observationResolvers.delete(msg.request_id);
              resolve(msg);
            }
            break;
          case "stop":
            sessionActive = false;
            if (openaiWs) { openaiWs.close(); openaiWs = null; }
            observationResolvers.clear();
            break;
          }
        } catch {
          adapterWs.send(JSON.stringify({ type: "error", message: "Invalid message" }));
        }
      });

      adapterWs.on("close", () => {
        sessionActive = false;
        if (openaiWs) { openaiWs.close(); openaiWs = null; }
        observationResolvers.clear();
        console.log(`[Flyd Core] Realtime session ${sessionId.slice(0, 8)} disconnected`);
      });
    });
  });
}

async function connectRealtime(
  adapterWs: WebSocket,
  observationResolvers: Map<string, (env: Record<string, unknown>) => void>
): Promise<WebSocket> {
  const model = process.env.FLYD_REALTIME_MODEL || "gpt-realtime-2.1";
  // Realtime WS is OpenAI-only — prefer OPENAI_API_KEY so FLYD_MODEL_API_KEY
  // can point at a non-OpenAI provider (e.g. OpenRouter) without breaking voice.
  const apiKey = process.env.OPENAI_API_KEY || process.env.FLYD_MODEL_API_KEY;

  if (!apiKey) {
    adapterWs.send(JSON.stringify({ type: "error", message: "Realtime not configured" }));
    throw new Error("No API key configured");
  }

  return new Promise((resolvePromise, reject) => {
    const ws = new WebSocket(`wss://api.openai.com/v1/realtime?model=${encodeURIComponent(model)}`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "OpenAI-Safety-Identifier": "flyd-local-user",
      },
    });

    ws.on("open", () => {
      ws.send(JSON.stringify({
        type: "session.update",
        session: {
          type: "realtime",
          modalities: ["text", "audio"],
          instructions: REALTIME_INSTRUCTIONS,
          turn_detection: { type: "server_vad" },
          audio: {
            input: { format: { type: "audio/pcm", rate: 24000 } },
            output: { format: { type: "audio/pcm", rate: 24000 } },
            transcription: { model: "gpt-realtime-whisper" },
          },
          tools: [{
            type: "function",
            name: "flyd_resolve_intent",
            description: "Resolve a user intent through Flyd Core using current Mac context, personal memory, live external evidence, and safe executable operations.",
            parameters: {
              type: "object",
              properties: {
                intent: { type: "string", description: "What the user wants to accomplish" },
                environment_revision: { type: "number", description: "Current environment revision" },
              },
              required: ["intent", "environment_revision"],
            },
          }],
          tool_choice: "auto",
        },
      }));
      resolvePromise(ws);
    });

    ws.on("message", (data) => {
      try {
        const ev = JSON.parse(data.toString());
        if (ev.type === "response.audio.delta") {
          adapterWs.send(JSON.stringify({ type: "audio_output", audio: ev.delta }));
        }
        if (ev.type === "response.audio_transcript.delta") {
          adapterWs.send(JSON.stringify({ type: "transcript_delta", text: ev.delta }));
        }
        if (ev.type === "response.done") {
          handleToolCalls(adapterWs, ws, ev as Record<string, unknown>, observationResolvers);
        }
        if (ev.type === "error") {
          adapterWs.send(JSON.stringify({ type: "error", message: "Realtime service error" }));
        }
      } catch { /* ignore malformed */ }
    });

    ws.on("error", (err) => {
      adapterWs.send(JSON.stringify({ type: "error", message: "Realtime service error" }));
      reject(err);
    });
  });
}

export interface ResolveToolOutput {
  mode: string;
  operations: Array<{ target?: string; kind?: string; text?: string; success?: boolean; error?: string }>;
  augmentations: Array<{ kind: string; content: string; options?: string[] }>;
  message: string;
}

// The realtime model only ever sees what this returns — answers resolved into
// augmentations (ask_answer route) must come back too, not just insertion ops.
export function buildResolveToolOutput(
  resolution: Resolution,
  validationError: ResolutionError | null,
): ResolveToolOutput {
  if (validationError) {
    return {
      mode: "failed",
      operations: [{ success: false, error: validationError.error }],
      augmentations: [],
      message: `Could not resolve: ${validationError.error}`,
    };
  }

  const operations = resolution.operations.map((op) => ({
    target: op.target,
    kind: op.kind,
    text: op.text,
  }));
  const augmentations = (resolution.augmentations ?? []).map((aug) => ({
    kind: aug.kind,
    content: aug.content,
    ...(aug.options ? { options: aug.options } : {}),
  }));

  const message = augmentations.length > 0
    ? "Answer ready — speak the augmentation content to the user."
    : `Resolved: ${operations.length} operation(s)`;

  return { mode: resolution.mode, operations, augmentations, message };
}

async function handleToolCalls(
  adapterWs: WebSocket,
  openaiWs: WebSocket,
  responseEvent: Record<string, unknown>,
  observationResolvers: Map<string, (env: Record<string, unknown>) => void>
) {
  const output = (responseEvent.response as Record<string, unknown>)?.output;
  if (!Array.isArray(output)) return;

  for (const item of output) {
    if ((item as Record<string, unknown>).type !== "function_call") continue;
    if ((item as Record<string, unknown>).name !== "flyd_resolve_intent") continue;

    const args = JSON.parse((item as Record<string, unknown>).arguments as string || "{}");
    const callId = (item as Record<string, unknown>).call_id as string;
    const { intent } = args;

    try {
      const requestId = randomUUID();

      const observationPromise = new Promise<Record<string, unknown>>((resolve, reject) => {
        observationResolvers.set(requestId, resolve);
        setTimeout(() => {
          if (observationResolvers.has(requestId)) {
            observationResolvers.delete(requestId);
            reject(new Error("Observation request timed out"));
          }
        }, 5000);
      });

      adapterWs.send(JSON.stringify({
        type: "observation_request",
        request_id: requestId,
      }));

      let observation: Record<string, unknown>;
      try {
        observation = await observationPromise;
      } catch {
        adapterWs.send(JSON.stringify({ type: "error", message: "Observation timed out" }));
        continue;
      }

      const manifest: ManifestRequest = {
        invocation_id: randomUUID(),
        environment_revision: (observation.revision as number) || 1,
        environment: {
          application: {
            bundle_id: (observation.environment as Record<string, unknown>)?.bundleId as string || "unknown",
            name: "",
          },
          window: {
            title: (observation.environment as Record<string, unknown>)?.windowTitle as string || "",
            ref: "win_01",
          },
          focused_element: {
            ref: "el_01",
            role: (observation.environment as Record<string, unknown>)?.elementRole as string || "AXUnknown",
            description: "",
            value: "",
            placeholder: "",
            selected_text: "",
          },
          selection: "",
          sufficiency: "partial" as const,
        },
        intent: intent || "",
        modality: "voice",
        invocation_fingerprint: {
          app: (observation.fingerprint as Record<string, unknown>)?.app as string || "unknown",
          window: (observation.fingerprint as Record<string, unknown>)?.window as string || "win_01",
          element: "el_01",
        } as ManifestRequest["invocation_fingerprint"],
      };

      let workerConfig = null;
      try {
        workerConfig = loadFlydWorkerConfig();
      } catch { /* not configured */ }
      const resolution = workerConfig
        ? await resolve(manifest, workerConfig.model, workerConfig.apiKey, workerConfig.baseURL)
        : await resolve(manifest);
      const validationError = validateResolution(resolution);
      const toolOutput = buildResolveToolOutput(resolution, validationError);

      adapterWs.send(JSON.stringify({
        type: "resolution_result",
        call_id: callId,
        observation_id: (observation.observation_id as string) || "",
        resolution,
      }));

      openaiWs.send(JSON.stringify({
        type: "conversation.item.create",
        item: {
          type: "function_call_output",
          call_id: callId,
          output: JSON.stringify(toolOutput),
        },
      }));

      openaiWs.send(JSON.stringify({ type: "response.create" }));
    } catch {
      adapterWs.send(JSON.stringify({ type: "error", message: "Tool call failed" }));
    }
  }
}

export function stopRealtimeServer(): Promise<void> {
  return new Promise((resolvePromise) => {
    if (!wss) { resolvePromise(); return; }
    wss.close(() => { wss = null; resolvePromise(); });
  });
}
