import { WebSocket } from "ws";

// Dictation audio streamed to OpenAI's realtime transcription while George
// speaks. Server VAD transcribes each phrase at its pause, so when he stops
// only the last phrase is left: measured 0.64 s after stop for a 9 s sample,
// against 1.1–1.4 s to upload and transcribe the whole WAV. Any failure
// rejects `finish`, and the caller falls back to the batch upload.

export interface TranscriberSocket {
  send(data: string): void;
  close(): void;
  on(event: "open", listener: () => void): unknown;
  on(event: "message", listener: (data: { toString(): string }) => void): unknown;
  on(event: "error", listener: (error: Error) => void): unknown;
  on(event: "close", listener: () => void): unknown;
}

export interface StreamingTranscriber {
  append(pcm: Buffer): void;
  /** Commits what's left and resolves with every phrase joined in order. */
  finish(timeoutMs: number): Promise<string>;
  close(): void;
}

export interface StreamingOptions {
  apiKey: string;
  model: string;
  prompt: string;
  connect?: (url: string, headers: Record<string, string>) => TranscriberSocket;
}

export const REALTIME_TRANSCRIPTION_URL = "wss://api.openai.com/v1/realtime?intent=transcription";

export function sessionUpdate(model: string, prompt: string): Record<string, unknown> {
  return {
    type: "session.update",
    session: {
      type: "transcription",
      audio: {
        input: {
          format: { type: "audio/pcm", rate: 24_000 },
          transcription: { model, prompt },
          turn_detection: { type: "server_vad", silence_duration_ms: 500, prefix_padding_ms: 300 },
        },
      },
    },
  };
}

export function openStreamingTranscriber(options: StreamingOptions): StreamingTranscriber {
  const connect = options.connect ?? ((url, headers) => new WebSocket(url, { headers }) as unknown as TranscriberSocket);
  const socket = connect(REALTIME_TRANSCRIPTION_URL, { Authorization: `Bearer ${options.apiKey}` });

  let open = false;
  let failure: Error | null = null;
  const queued: string[] = [];
  const items: string[] = [];
  const transcripts = new Map<string, string>();
  let finalCommit: "none" | "sent" | "acked" = "none";
  let settle: { resolve: (text: string) => void; reject: (error: Error) => void } | null = null;

  const send = (payload: Record<string, unknown>) => {
    const data = JSON.stringify(payload);
    if (open) socket.send(data); else queued.push(data);
  };

  const fail = (error: Error) => {
    failure ??= error;
    settle?.reject(failure);
    settle = null;
  };

  const settleIfDone = () => {
    if (!settle || finalCommit !== "acked") return;
    if (items.some((id) => !transcripts.has(id))) return;
    settle.resolve(items.map((id) => transcripts.get(id)!.trim()).filter(Boolean).join(" "));
    settle = null;
  };

  socket.on("open", () => {
    open = true;
    socket.send(JSON.stringify(sessionUpdate(options.model, options.prompt)));
    for (const data of queued.splice(0)) socket.send(data);
  });

  socket.on("message", (data) => {
    let event: Record<string, any>;
    try { event = JSON.parse(data.toString()); } catch { return; }
    switch (event.type) {
      case "input_audio_buffer.committed":
        items.push(String(event.item_id));
        if (finalCommit === "sent") finalCommit = "acked";
        break;
      case "conversation.item.input_audio_transcription.completed":
        transcripts.set(String(event.item_id), String(event.transcript ?? ""));
        break;
      case "conversation.item.input_audio_transcription.failed":
        fail(new Error(`Realtime transcription failed: ${JSON.stringify(event.error ?? {})}`));
        return;
      case "error":
        // VAD already committed everything and only an empty buffer was left.
        if (finalCommit === "sent" && event.error?.code === "input_audio_buffer_commit_empty") {
          finalCommit = "acked";
          break;
        }
        fail(new Error(`Realtime transcription error: ${event.error?.message ?? "unknown"}`));
        return;
    }
    settleIfDone();
  });

  socket.on("error", (error) => fail(error));
  socket.on("close", () => fail(new Error("Realtime transcription closed")));

  return {
    append(pcm) {
      if (failure) return;
      send({ type: "input_audio_buffer.append", audio: pcm.toString("base64") });
    },
    finish(timeoutMs) {
      if (failure) return Promise.reject(failure);
      return new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => fail(new Error("Realtime transcription timed out")), timeoutMs);
        settle = {
          resolve: (text) => { clearTimeout(timer); resolve(text); },
          reject: (error) => { clearTimeout(timer); reject(error); },
        };
        finalCommit = "sent";
        send({ type: "input_audio_buffer.commit" });
      });
    },
    close() {
      settle = null;
      failure ??= new Error("closed");
      try { socket.close(); } catch { /* already closed */ }
    },
  };
}
