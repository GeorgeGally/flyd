import { randomUUID } from "node:crypto";
import { WebSocket, WebSocketServer } from "ws";

const TRANSCRIPTION_WS_PORT = 4816;

let wss: WebSocketServer | null = null;

interface TranscriptionSessionConfig {
  model: string;
}

interface TranscriptionDelta {
  type: "delta";
  text: string;
}

interface TranscriptionComplete {
  type: "complete";
  text: string;
}

interface TranscriptionError {
  type: "error";
  message: string;
}

type TranscriptionEvent = TranscriptionDelta | TranscriptionComplete | TranscriptionError;

export function startTranscriptionServer(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (wss) {
      resolve();
      return;
    }

    wss = new WebSocketServer({ port: TRANSCRIPTION_WS_PORT, host: "127.0.0.1" });

    wss.on("listening", () => {
      console.log(`[Flyd Core] Transcription WS listening on 127.0.0.1:${TRANSCRIPTION_WS_PORT}`);
      resolve();
    });

    wss.on("error", (err) => {
      reject(err);
    });

    wss.on("connection", (ws) => {
      const sessionId = randomUUID();
      console.log(`[Flyd Core] Transcription session ${sessionId.slice(0, 8)} connected`);

      let openaiWs: WebSocket | null = null;

      ws.on("message", async (data) => {
        try {
          const msg = JSON.parse(data.toString());

          switch (msg.type) {
          case "start":
            openaiWs = await connectOpenAIRealtime(ws, msg.config as TranscriptionSessionConfig);
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
            if (openaiWs) {
              openaiWs.close();
              openaiWs = null;
            }
            break;
          }
        } catch (err) {
          console.error(`[Flyd Core] Transcription error:`, err);
          ws.send(JSON.stringify({ type: "error", message: String(err) }));
        }
      });

      ws.on("close", () => {
        if (openaiWs) {
          openaiWs.close();
          openaiWs = null;
        }
        console.log(`[Flyd Core] Transcription session ${sessionId.slice(0, 8)} disconnected`);
      });
    });
  });
}

async function connectOpenAIRealtime(
  clientWs: WebSocket,
  config: TranscriptionSessionConfig
): Promise<WebSocket> {
  const model = config.model || process.env.FLYD_TRANSCRIPTION_MODEL || "gpt-realtime-whisper";
  const apiKey = process.env.FLYD_MODEL_API_KEY || process.env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new Error("No OpenAI API key configured (set FLYD_MODEL_API_KEY or OPENAI_API_KEY)");
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
              transcription: {
                model,
                language: "en",
                delay: "low",
              },
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
      } catch {
        // ignore malformed messages
      }
    });

    ws.on("error", (err) => {
      clientWs.send(JSON.stringify({ type: "error", message: err.message }));
      reject(err);
    });

    ws.on("close", () => { /* handled by caller */ });
  });
}

export function stopTranscriptionServer(): Promise<void> {
  return new Promise((resolve) => {
    if (!wss) {
      resolve();
      return;
    }

    wss.close(() => {
      wss = null;
      console.log("[Flyd Core] Transcription WS stopped");
      resolve();
    });
  });
}

export function isTranscriptionServerRunning(): boolean {
  return wss !== null;
}
