import { WebSocket, WebSocketServer } from "ws";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { IncomingMessage } from "node:http";
import { resolve, ManifestRequest } from "./resolve.js";
import { validateResolution } from "./resolve-types.js";

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

      adapterWs.on("message", async (data) => {
        try {
          const msg = JSON.parse(data.toString());

          switch (msg.type) {
          case "start":
            openaiWs = await connectRealtime(adapterWs);
            sessionActive = true;
            break;
          case "audio":
            if (openaiWs && openaiWs.readyState === WebSocket.OPEN) {
              openaiWs.send(JSON.stringify({
                type: "input_audio_buffer.append",
                audio: msg.audio,
              }));
            }
            break;
          case "stop":
            sessionActive = false;
            if (openaiWs) { openaiWs.close(); openaiWs = null; }
            break;
          }
        } catch {
          adapterWs.send(JSON.stringify({ type: "error", message: "Invalid message" }));
        }
      });

      adapterWs.on("close", () => {
        sessionActive = false;
        if (openaiWs) { openaiWs.close(); openaiWs = null; }
        console.log(`[Flyd Core] Realtime session ${sessionId.slice(0, 8)} disconnected`);
      });
    });
  });
}

async function connectRealtime(adapterWs: WebSocket): Promise<WebSocket> {
  const model = process.env.FLYD_REALTIME_MODEL || "gpt-realtime-2.1";
  const apiKey = process.env.FLYD_MODEL_API_KEY || process.env.OPENAI_API_KEY;

  if (!apiKey) {
    adapterWs.send(JSON.stringify({ type: "error", message: "Realtime not configured" }));
    throw new Error("No API key configured");
  }

  return new Promise((resolvePromise, reject) => {
    const ws = new WebSocket("wss://api.openai.com/v1/realtime", {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "OpenAI-Beta": "realtime=v1",
      },
    });

    ws.on("open", () => {
      ws.send(JSON.stringify({
        type: "session.update",
        session: {
          type: "realtime",
          model,
          modalities: ["text", "audio"],
          turn_detection: { type: "server_vad" },
          audio: {
            input: { format: { type: "audio/pcm", rate: 24000 } },
            output: { format: { type: "audio/pcm", rate: 24000 } },
            transcription: { model: "gpt-realtime-whisper" },
          },
          tools: [{
            type: "function",
            name: "flyd_resolve_intent",
            description: "Execute a user intent on their computer. Returns concrete text operations targeting the focused element.",
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
          handleToolCalls(adapterWs, ws, ev as Record<string, unknown>);
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

async function handleToolCalls(
  adapterWs: WebSocket,
  openaiWs: WebSocket,
  responseEvent: Record<string, unknown>
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
      const manifest: ManifestRequest = {
        invocation_id: randomUUID(),
        environment_revision: args.environment_revision || 1,
        environment: {
          application: { bundle_id: "unknown", name: "LIVE session" },
          window: { title: "LIVE", ref: "win_01" },
          focused_element: { ref: "el_01", role: "AXTextArea", description: "LIVE target", value: "", placeholder: "", selected_text: "" },
          selection: "",
          sufficiency: "partial",
        },
        intent: intent || "",
        modality: "voice",
        invocation_fingerprint: { app: "flyd-live", window: "live_01", element: "el_01" },
      };

      const resolution = await resolve(manifest);
      const validationError = validateResolution(resolution);

      const opResults = validationError
        ? [{ success: false, error: validationError.error }]
        : resolution.operations.map((op) => ({
            target: op.target,
            kind: op.kind,
            text: op.text,
          }));

      adapterWs.send(JSON.stringify({
        type: "resolve_operations",
        call_id: callId,
        operations: opResults,
      }));

      openaiWs.send(JSON.stringify({
        type: "conversation.item.create",
        item: {
          type: "function_call_output",
          call_id: callId,
          output: JSON.stringify({
            mode: validationError ? "failed" : "native",
            operations: opResults,
            message: validationError
              ? `Could not resolve: ${validationError.error}`
              : `Resolved: ${resolution.operations.length} operation(s)`,
          }),
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
