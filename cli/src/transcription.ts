import { randomUUID } from "node:crypto";
import { WebSocket, WebSocketServer } from "ws";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { IncomingMessage } from "node:http";

const TRANSCRIPTION_WS_PORT = 4816;
const AUTH_TOKEN_PATH = join(homedir(), ".flyd", "overlay", "auth-token");
const DEFAULT_PUSH_TO_TALK_TRANSCRIPTION_MODEL = "gpt-4o-mini-transcribe-2025-12-15";
const PUSH_TO_TALK_TRANSCRIPTION_FALLBACKS = [
  DEFAULT_PUSH_TO_TALK_TRANSCRIPTION_MODEL,
  "gpt-4o-mini-transcribe-2025-03-20",
  "gpt-4o-mini-transcribe",
  "whisper-1",
];
const TRANSCRIPTION_PROMPT =
  "The user's AI assistant is named Flyd (pronounced Floyd, spelled F-l-y-d). The user may ask Flyd questions or give Flyd commands.";

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
let cachedVoiceSetup:
  | { checkedAt: number; result: { ok: boolean; message?: string } }
  | null = null;

export function sendTranscriptionReady(clientWs: Pick<WebSocket, "send">): void {
  clientWs.send(JSON.stringify({ type: "ready" }));
}

export function pcm16ToWav(pcm: Buffer, sampleRate = 24000): Buffer {
  const header = Buffer.alloc(44);
  const dataSize = pcm.length;
  const byteRate = sampleRate * 2;

  header.write("RIFF", 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(dataSize, 40);

  return Buffer.concat([header, pcm]);
}

export function transcriptionModelForPushToTalk(configured?: string): string {
  if (!configured || configured === "gpt-realtime-whisper") {
    return DEFAULT_PUSH_TO_TALK_TRANSCRIPTION_MODEL;
  }

  return configured;
}

export function transcriptionModelsForPushToTalk(configured?: string): string[] {
  const primary = transcriptionModelForPushToTalk(configured);
  if (primary === "whisper-1") return ["whisper-1"];

  return [primary, ...PUSH_TO_TALK_TRANSCRIPTION_FALLBACKS]
    .filter((model, index, models) => models.indexOf(model) === index);
}

export function voiceSetupMessageForStatus(status: number): string {
  if (status === 401) return "Voice setup needs a valid API key";
  if (status === 403) return "Voice is not active for this key yet";
  return "Voice setup could not be checked";
}

export async function checkVoiceSetup(): Promise<{ ok: boolean; message?: string }> {
  const now = Date.now();
  if (cachedVoiceSetup && now - cachedVoiceSetup.checkedAt < 60_000) {
    return cachedVoiceSetup.result;
  }

  // Voice endpoints are OpenAI-only — prefer OPENAI_API_KEY so FLYD_MODEL_API_KEY
  // can point at a non-OpenAI provider (e.g. OpenRouter) without breaking voice.
  const apiKey = process.env.OPENAI_API_KEY || process.env.FLYD_MODEL_API_KEY;
  if (!apiKey) {
    const result = { ok: false, message: "Voice setup needs a valid API key" };
    cachedVoiceSetup = { checkedAt: now, result };
    return result;
  }

  try {
    const result = await checkTranscriptionModelAccess(apiKey);
    cachedVoiceSetup = { checkedAt: now, result };
    return result;
  } catch {
    return { ok: true };
  }
}

async function checkTranscriptionModelAccess(apiKey: string): Promise<{ ok: boolean; message?: string }> {
  const wav = pcm16ToWav(Buffer.alloc(24000 * 2));

  for (const model of transcriptionModelsForPushToTalk(process.env.FLYD_TRANSCRIPTION_MODEL)) {
    const form = new FormData();
    form.append("model", model);
    form.append("response_format", "json");
    form.append("prompt", TRANSCRIPTION_PROMPT);
    form.append("file", new Blob([new Uint8Array(wav)], { type: "audio/wav" }), "voice-check.wav");

    const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
      signal: AbortSignal.timeout(10_000),
    });

    if (response.ok) return { ok: true };
    if (response.status === 401) return { ok: false, message: voiceSetupMessageForStatus(response.status) };
    if (response.status !== 403) return { ok: false, message: voiceSetupMessageForStatus(response.status) };
  }

  return { ok: false, message: voiceSetupMessageForStatus(403) };
}

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

      let pendingAudio: Buffer[] = [];
      let isTranscribing = false;

      ws.on("message", async (data) => {
        try {
          const msg = JSON.parse(data.toString());

          switch (msg.type) {
          case "start":
            pendingAudio = [];
            sendTranscriptionReady(ws);
            break;
          case "audio":
            if (typeof msg.audio === "string") {
              pendingAudio.push(Buffer.from(msg.audio, "base64"));
            }
            break;
          case "commit":
            if (isTranscribing) break;
            isTranscribing = true;
            transcribeBufferedAudio(pendingAudio, ws)
              .catch((error) => {
                console.warn(`[Flyd Core] Transcription failed: ${error instanceof Error ? error.message : String(error)}`);
                sendJson(ws, { type: "error", message: "Voice transcription failed" });
              })
              .finally(() => {
                pendingAudio = [];
                isTranscribing = false;
              });
            break;
          case "stop":
            pendingAudio = [];
            break;
          }
        } catch {
          ws.send(JSON.stringify({ type: "error", message: "Invalid message" }));
        }
      });

      ws.on("close", () => {
        pendingAudio = [];
        console.log(`[Flyd Core] Transcription session ${sessionId.slice(0, 8)} disconnected`);
      });
    });
  });
}

function sendJson(ws: Pick<WebSocket, "send">, payload: Record<string, unknown>): void {
  ws.send(JSON.stringify(payload));
}

async function transcribeBufferedAudio(chunks: Buffer[], clientWs: WebSocket): Promise<void> {
  const pcm = Buffer.concat(chunks);
  if (pcm.length < 1600) {
    sendJson(clientWs, { type: "error", message: "No speech detected" });
    return;
  }

  // Voice endpoints are OpenAI-only — prefer OPENAI_API_KEY so FLYD_MODEL_API_KEY
  // can point at a non-OpenAI provider (e.g. OpenRouter) without breaking voice.
  const apiKey = process.env.OPENAI_API_KEY || process.env.FLYD_MODEL_API_KEY;

  if (!apiKey) {
    sendJson(clientWs, { type: "error", message: "Transcription not configured" });
    return;
  }

  const wav = pcm16ToWav(pcm);

  for (const model of transcriptionModelsForPushToTalk(process.env.FLYD_TRANSCRIPTION_MODEL)) {
    const form = new FormData();
    form.append("model", model);
    form.append("response_format", "json");
    form.append("prompt", TRANSCRIPTION_PROMPT);
    form.append("file", new Blob([new Uint8Array(wav)], { type: "audio/wav" }), "voice.wav");

    const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });

    if (response.ok) {
      const body = await response.json() as { text?: string };
      sendJson(clientWs, { type: "complete", text: body.text || "" });
      return;
    }

    const errorBody = await response.text();
    console.warn(`[Flyd Core] Transcription API error (${response.status}) for ${model}: ${errorBody.slice(0, 500)}`);

    if (response.status === 403) continue;
    const message = response.status === 401
      ? "Voice setup needs a valid API key"
      : "Voice transcription failed";
    sendJson(clientWs, { type: "error", message });
    return;
  }

  sendJson(clientWs, { type: "error", message: voiceSetupMessageForStatus(403) });
}

export function stopTranscriptionServer(): Promise<void> {
  return new Promise((resolve) => {
    if (!wss) { resolve(); return; }
    wss.close(() => { wss = null; resolve(); });
  });
}
