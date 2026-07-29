import { afterEach, describe, expect, it } from "vitest";
import { buildSpeechRequestBody, prepareSpeechText } from "../tts.js";

const originalVoice = process.env.FLYD_TTS_VOICE;

afterEach(() => {
  if (originalVoice === undefined) {
    delete process.env.FLYD_TTS_VOICE;
  } else {
    process.env.FLYD_TTS_VOICE = originalVoice;
  }
});

describe("prepareSpeechText", () => {
  it("removes Markdown structure before speech synthesis", () => {
    expect(prepareSpeechText("## Answer\n**Wait:** hold.\n- Ship now")).toBe(
      "Answer\nWait: hold.\nShip now"
    );
  });
});

describe("buildSpeechRequestBody", () => {
  it("uses a high-quality voice with conversational delivery instructions", () => {
    delete process.env.FLYD_TTS_VOICE;

    expect(buildSpeechRequestBody("Hello")).toMatchObject({
      voice: "marin",
      input: "Hello",
      instructions: expect.stringContaining("natural conversation"),
    });
  });
});
