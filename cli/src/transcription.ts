import { randomUUID } from "node:crypto";
import { WebSocket, WebSocketServer } from "ws";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { IncomingMessage } from "node:http";

const TRANSCRIPTION_WS_PORT = 4816;
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

export function startTranscriptionServer(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (wss) { resolve(); return; }

    wss = new WebSocketServer({
      port: TRANSCRIPTION_WS_PORT,
      host: "127.0.0.1",
      maxPayload: 256 * 1024,
      verifyClient: ({ req }: { req: IncomingMessage }) => wsAuth(req),
    });

    wss.on("listening", () => {
      console.log(`[Flyd Core] Transcription WS listening on 127.0.0.1:${TRANSCRIPTION_WS_PORT}`);
      resolve();
    });

    wss.on("error", reject);

    wss.on("connection", (ws) => {
      const sessionId = randomUUID();
      console.log(`[Flyd Core] Transcription session ${sessionId.slice(0, 8)} connected`);

      let openaiWs: WebSocket | null = null;

      ws.on("message", async (data) => {
        try {
          const msg = JSON.parse(data.toString());

          switch (msg.type) {
          case "start":
            openaiWs = await connectTranscription(ws);
            break;
          case "audio":
            if (openaiWs && openaiWs.readyState === WebSocket.OPEN) {
              openaiWs.send(JSON.stringify({
                type: "input_audio_buffer.append",
                audio: msg.audio,
              }));
            }
            break;
          case "commit":
            if (openaiWs && openaiWs.readyState === WebSocket.OPEN) {
              openaiWs.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
            }
            break;
          case "stop":
            if (openaiWs) { openaiWs.close(); openaiWs = null; }
            break;
          }
        } catch {
          ws.send(JSON.stringify({ type: "error", message: "Invalid message" }));
        }
      });

      ws.on("close", () => {
        if (openaiWs) { openaiWs.close(); openaiWs = null; }
        console.log(`[Flyd Core] Transcription session ${sessionId.slice(0, 8)} disconnected`);
      });
    });
  });
}

async function connectTranscription(clientWs: WebSocket): Promise<WebSocket> {
  const model = process.env.FLYD_TRANSCRIPTION_MODEL || "gpt-realtime-whisper";
  const apiKey = process.env.FLYD_MODEL_API_KEY || process.env.OPENAI_API_KEY;

  if (!apiKey) {
    clientWs.send(JSON.stringify({ type: "error", message: "Transcription not configured" }));
    throw new Error("No API key configured");
  }

  return new Promise((resolve, reject) => {
    const ws = new WebSocket("wss://api.openai.com/v1/realtime?intent=transcription", {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "OpenAI-Beta": "realtime=v1",
      },
    });

    ws.on("open", () => {
      ws.send(JSON.stringify({
        type: "session.update",
        session: {
          type: "transcription",
          audio: {
            input: {
              format: { type: "audio/pcm", rate: 24000 },
              transcription: { model, language: "en", delay: "low" },
            },
          },
        },
      }));
      resolve(ws);
    });

    ws.on("message", (data) => {
      try {
        const ev = JSON.parse(data.toString());
        if (ev.type === "conversation.item.input_audio_transcription.delta") {
          clientWs.send(JSON.stringify({ type: "delta", text: ev.delta }));
        }
        if (ev.type === "conversation.item.input_audio_transcription.completed") {
          clientWs.send(JSON.stringify({ type: "complete", text: ev.transcript || "" }));
        }
      } catch { /* ignore malformed */ }
    });

    ws.on("error", (err) => {
      clientWs.send(JSON.stringify({ type: "error", message: "Transcription service error" }));
      reject(err);
    });
  });
}

export function stopTranscriptionServer(): Promise<void> {
  return new Promise((resolve) => {
    if (!wss) { resolve(); return; }
    wss.close(() => { wss = null; resolve(); });
  });
}
