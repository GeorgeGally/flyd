import { randomUUID } from "node:crypto";
import { WebSocket, WebSocketServer } from "ws";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { IncomingMessage } from "node:http";
import { finishDictation } from "./dictation/cleanup.js";
import { dictationFetch, warmDictationHosts } from "./dictation/http.js";
import type { DictationTarget } from "./dictation/profile.js";
import { openStreamingTranscriber, type StreamingTranscriber } from "./dictation/stream.js";
import { loadReplacementRules, loadVocabulary, transcriptionPrompt } from "./dictation/vocabulary.js";

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

export type TranscriptionPurpose =
  | { kind: "conversation" }
  | { kind: "dictation"; target: DictationTarget };

/** The adapter's `start` message says whether this is a question for Flyd or text for another app. */
export function transcriptionPurpose(message: Record<string, unknown>): TranscriptionPurpose {
  if (message.purpose !== "dictation") return { kind: "conversation" };
  const app = (typeof message.app === "object" && message.app !== null ? message.app : {}) as Record<string, unknown>;
  const windowTitle = typeof app.windowTitle === "string" && app.windowTitle.trim() ? app.windowTitle : undefined;
  return {
    kind: "dictation",
    target: {
      bundleId: typeof app.bundleId === "string" && app.bundleId ? app.bundleId : "unknown",
      ...(windowTitle ? { windowTitle } : {}),
    },
  };
}

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
      let purpose: TranscriptionPurpose = { kind: "conversation" };
      let stream: StreamingTranscriber | null = null;
      const closeStream = () => { stream?.close(); stream = null; };

      ws.on("message", async (data) => {
        try {
          const msg = JSON.parse(data.toString());

          switch (msg.type) {
          case "start":
            pendingAudio = [];
            closeStream();
            purpose = transcriptionPurpose(msg);
            if (purpose.kind === "dictation") warmDictationHosts();
            stream = openTranscriptionStream(purpose);
            sendTranscriptionReady(ws);
            break;
          case "audio":
            if (typeof msg.audio === "string") {
              const chunk = Buffer.from(msg.audio, "base64");
              pendingAudio.push(chunk);
              stream?.append(chunk);
            }
            break;
          case "commit": {
            if (isTranscribing) break;
            isTranscribing = true;
            const streamed = stream;
            stream = null;
            (streamed
              ? finishStreamedTranscription(streamed, pendingAudio, ws, purpose)
              : transcribeBufferedAudio(pendingAudio, ws, purpose))
              .catch((error) => {
                console.warn(`[Flyd Core] Transcription failed: ${error instanceof Error ? error.message : String(error)}`);
                sendJson(ws, { type: "error", message: "Voice transcription failed" });
              })
              .finally(() => {
                streamed?.close();
                pendingAudio = [];
                isTranscribing = false;
              });
            break;
          }
          case "stop":
            pendingAudio = [];
            closeStream();
            break;
          }
        } catch {
          ws.send(JSON.stringify({ type: "error", message: "Invalid message" }));
        }
      });

      ws.on("close", () => {
        pendingAudio = [];
        closeStream();
        console.log(`[Flyd Core] Transcription session ${sessionId.slice(0, 8)} disconnected`);
      });
    });
  });
}

function sendJson(ws: Pick<WebSocket, "send">, payload: Record<string, unknown>): void {
  ws.send(JSON.stringify(payload));
}

const STREAM_FINISH_TIMEOUT_MS = 4_000;
const PCM_BYTES_PER_SECOND = 24_000 * 2;

function transcriptionApiKey(): string | undefined {
  // Voice endpoints are OpenAI-only — prefer OPENAI_API_KEY so FLYD_MODEL_API_KEY
  // can point at a non-OpenAI provider (e.g. OpenRouter) without breaking voice.
  return process.env.OPENAI_API_KEY || process.env.FLYD_MODEL_API_KEY;
}

function openTranscriptionStream(purpose: TranscriptionPurpose): StreamingTranscriber | null {
  const apiKey = transcriptionApiKey();
  if (!apiKey) return null;
  try {
    return openStreamingTranscriber({
      apiKey,
      model: transcriptionModelForPushToTalk(process.env.FLYD_TRANSCRIPTION_MODEL),
      prompt: purpose.kind === "dictation"
        ? transcriptionPrompt(loadVocabulary(purpose.target.windowTitle))
        : TRANSCRIPTION_PROMPT,
    });
  } catch (error) {
    console.warn(`[Flyd Core] Streaming transcription unavailable: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

/** The streamed transcript when it arrives in time; otherwise the same audio, uploaded whole. */
async function finishStreamedTranscription(
  stream: StreamingTranscriber,
  chunks: Buffer[],
  clientWs: WebSocket,
  purpose: TranscriptionPurpose,
): Promise<void> {
  const pcm = Buffer.concat(chunks);
  if (pcm.length < 1600) {
    sendJson(clientWs, { type: "error", message: "No speech detected" });
    return;
  }
  let transcript: string;
  try {
    transcript = await stream.finish(STREAM_FINISH_TIMEOUT_MS);
  } catch (error) {
    console.warn(`[Flyd Core] Streaming transcription fell back to upload: ${error instanceof Error ? error.message : String(error)}`);
    await transcribeBufferedAudio(chunks, clientWs, purpose);
    return;
  }
  if (purpose.kind === "dictation") {
    await completeDictation(clientWs, transcript, pcm.length / PCM_BYTES_PER_SECOND, purpose, loadVocabulary(purpose.target.windowTitle));
    return;
  }
  sendJson(clientWs, { type: "complete", text: transcript });
}

async function completeDictation(
  clientWs: WebSocket,
  transcript: string,
  audioSeconds: number,
  purpose: Extract<TranscriptionPurpose, { kind: "dictation" }>,
  vocabulary: string[],
): Promise<void> {
  const result = await finishDictation(transcript, {
    target: purpose.target,
    audioSeconds,
    rules: loadReplacementRules(),
    vocabulary,
  });
  sendJson(clientWs, { type: "complete", text: result.text, profile: result.profile });
}

async function transcribeBufferedAudio(chunks: Buffer[], clientWs: WebSocket, purpose: TranscriptionPurpose): Promise<void> {
  const pcm = Buffer.concat(chunks);
  if (pcm.length < 1600) {
    sendJson(clientWs, { type: "error", message: "No speech detected" });
    return;
  }

  const apiKey = transcriptionApiKey();

  if (!apiKey) {
    sendJson(clientWs, { type: "error", message: "Transcription not configured" });
    return;
  }

  const wav = pcm16ToWav(pcm);
  const vocabulary = purpose.kind === "dictation" ? loadVocabulary(purpose.target.windowTitle) : [];
  const prompt = purpose.kind === "dictation" ? transcriptionPrompt(vocabulary) : TRANSCRIPTION_PROMPT;

  for (const model of transcriptionModelsForPushToTalk(process.env.FLYD_TRANSCRIPTION_MODEL)) {
    const form = new FormData();
    form.append("model", model);
    form.append("response_format", "json");
    form.append("prompt", prompt);
    form.append("file", new Blob([new Uint8Array(wav)], { type: "audio/wav" }), "voice.wav");

    const response = await dictationFetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });

    if (response.ok) {
      const body = await response.json() as { text?: string };
      if (purpose.kind === "dictation") {
        await completeDictation(clientWs, body.text || "", pcm.length / PCM_BYTES_PER_SECOND, purpose, vocabulary);
        return;
      }
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
