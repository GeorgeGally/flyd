import { describe, expect, it } from "vitest";
import { openStreamingTranscriber, type TranscriberSocket } from "../stream.js";

class FakeSocket implements TranscriberSocket {
  sent: Array<Record<string, any>> = [];
  private listeners = new Map<string, Array<(arg?: any) => void>>();
  send(data: string) { this.sent.push(JSON.parse(data)); }
  close() {}
  on(event: string, listener: (arg?: any) => void) {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]);
    return this;
  }
  emit(event: string, arg?: unknown) { for (const listener of this.listeners.get(event) ?? []) listener(arg); }
  server(event: Record<string, unknown>) { this.emit("message", { toString: () => JSON.stringify(event) }); }
}

function transcriber() {
  const socket = new FakeSocket();
  const stream = openStreamingTranscriber({ apiKey: "k", model: "gpt-4o-mini-transcribe", prompt: "Flyd", connect: () => socket });
  return { socket, stream };
}

describe("streaming transcription", () => {
  it("configures the session first, then sends audio queued before the socket opened", () => {
    const { socket, stream } = transcriber();
    stream.append(Buffer.from([1, 2]));
    socket.emit("open");

    expect(socket.sent.map((event) => event.type)).toEqual(["session.update", "input_audio_buffer.append"]);
    expect(socket.sent[0].session.audio.input.transcription).toEqual({ model: "gpt-4o-mini-transcribe", prompt: "Flyd" });
    expect(socket.sent[1].audio).toBe("AQI=");
  });

  it("joins phrases in commit order once the final commit is transcribed", async () => {
    const { socket, stream } = transcriber();
    socket.emit("open");
    socket.server({ type: "input_audio_buffer.committed", item_id: "a" });
    const done = stream.finish(1_000);
    socket.server({ type: "input_audio_buffer.committed", item_id: "b" });
    socket.server({ type: "conversation.item.input_audio_transcription.completed", item_id: "b", transcript: "then run the tests." });
    socket.server({ type: "conversation.item.input_audio_transcription.completed", item_id: "a", transcript: "Rename it to check gate," });

    await expect(done).resolves.toBe("Rename it to check gate, then run the tests.");
    expect(socket.sent.at(-1)).toEqual({ type: "input_audio_buffer.commit" });
  });

  it("finishes when voice detection already committed everything", async () => {
    const { socket, stream } = transcriber();
    socket.emit("open");
    socket.server({ type: "input_audio_buffer.committed", item_id: "a" });
    socket.server({ type: "conversation.item.input_audio_transcription.completed", item_id: "a", transcript: "Sounds good" });
    const done = stream.finish(1_000);
    socket.server({ type: "error", error: { code: "input_audio_buffer_commit_empty", message: "buffer too small" } });

    await expect(done).resolves.toBe("Sounds good");
  });

  it("rejects on a server error so the caller can upload the audio instead", async () => {
    const { socket, stream } = transcriber();
    socket.emit("open");
    const done = stream.finish(1_000);
    socket.server({ type: "error", error: { code: "model_not_found", message: "no access" } });

    await expect(done).rejects.toThrow("Realtime transcription error: no access");
  });

  it("rejects when the transcript does not arrive in time", async () => {
    const { socket, stream } = transcriber();
    socket.emit("open");

    await expect(stream.finish(20)).rejects.toThrow("timed out");
  });
});
