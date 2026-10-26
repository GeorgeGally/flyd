import { afterEach, describe, expect, it, vi } from "vitest";

const sockets = vi.hoisted(() => [] as string[]);
const posts = vi.hoisted(() => vi.fn(async (_url: string, _init?: RequestInit) =>
  new Response(JSON.stringify({ text: "hello there" }), { status: 200 })));

vi.mock("ws", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ws")>();
  class RecordingWebSocket extends actual.WebSocket {
    constructor(...args: ConstructorParameters<typeof actual.WebSocket>) {
      sockets.push(String(args[0]));
      super(...args);
    }
  }
  return { ...actual, WebSocket: RecordingWebSocket, default: RecordingWebSocket };
});

vi.mock("../dictation/http.js", () => ({ dictationFetch: posts, warmDictationHosts() {} }));

const {
  pcm16ToWav,
  sendTranscriptionReady,
  transcribeBufferedAudio,
  transcriptionModelForPushToTalk,
  transcriptionModelsForPushToTalk,
  voiceSetupMessageForStatus,
} = await import("../transcription.js");

afterEach(() => vi.unstubAllEnvs());

describe("transcription relay", () => {
  it("sends an explicit ready event so adapters can flush buffered audio", () => {
    const send = vi.fn();

    sendTranscriptionReady({ send });

    expect(send).toHaveBeenCalledWith(JSON.stringify({ type: "ready" }));
  });

  it("wraps mono 24k pcm16 audio as a wav file for push-to-talk transcription", () => {
    const pcm = Buffer.from([1, 0, 2, 0, 3, 0, 4, 0]);
    const wav = pcm16ToWav(pcm);

    expect(wav.subarray(0, 4).toString()).toBe("RIFF");
    expect(wav.subarray(8, 12).toString()).toBe("WAVE");
    expect(wav.readUInt16LE(20)).toBe(1);
    expect(wav.readUInt16LE(22)).toBe(1);
    expect(wav.readUInt32LE(24)).toBe(24000);
    expect(wav.readUInt16LE(34)).toBe(16);
    expect(wav.subarray(36, 40).toString()).toBe("data");
    expect(wav.readUInt32LE(40)).toBe(pcm.length);
    expect(wav.subarray(44)).toEqual(pcm);
  });

  it("maps the old realtime transcription model to a push-to-talk transcription model", () => {
    expect(transcriptionModelForPushToTalk("gpt-realtime-whisper")).toBe("gpt-4o-mini-transcribe-2025-12-15");
    expect(transcriptionModelForPushToTalk(undefined)).toBe("gpt-4o-mini-transcribe-2025-12-15");
    expect(transcriptionModelForPushToTalk("gpt-4o-transcribe")).toBe("gpt-4o-transcribe");
  });

  it("falls back through allowed push-to-talk transcription models", () => {
    expect(transcriptionModelsForPushToTalk("gpt-realtime-whisper")).toEqual([
      "gpt-4o-mini-transcribe-2025-12-15",
      "gpt-4o-mini-transcribe-2025-03-20",
      "gpt-4o-mini-transcribe",
      "whisper-1",
    ]);
    expect(transcriptionModelsForPushToTalk("gpt-4o-transcribe")).toEqual([
      "gpt-4o-transcribe",
      "gpt-4o-mini-transcribe-2025-12-15",
      "gpt-4o-mini-transcribe-2025-03-20",
      "gpt-4o-mini-transcribe",
      "whisper-1",
    ]);
    expect(transcriptionModelsForPushToTalk("whisper-1")).toEqual(["whisper-1"]);
  });

  it("turns invalid OpenAI credentials into a product setup message", () => {
    expect(voiceSetupMessageForStatus(401)).toBe("Voice setup needs a valid API key");
    expect(voiceSetupMessageForStatus(403)).toBe("Voice is not active for this key yet");
    expect(voiceSetupMessageForStatus(500)).toBe("Voice setup could not be checked");
  });

  it("transcribes a voice turn by upload after stop, never over a realtime socket", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    vi.stubEnv("FLYD_TRANSCRIPTION_MODEL", "");
    const sent: string[] = [];

    await transcribeBufferedAudio([Buffer.alloc(24000 * 2)], { send: (data: string) => sent.push(data) }, { kind: "conversation" });

    expect(posts).toHaveBeenCalledTimes(1);
    expect(posts.mock.calls[0]![0]).toBe("https://api.openai.com/v1/audio/transcriptions");
    expect((posts.mock.calls[0]![1]!.body as FormData).get("model")).toBe("gpt-4o-mini-transcribe-2025-12-15");
    expect(sockets).toEqual([]);
    expect(JSON.parse(sent[0]!)).toMatchObject({ type: "complete" });
  });
});
