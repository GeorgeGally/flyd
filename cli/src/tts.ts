const DEFAULT_TTS_MODEL = "gpt-4o-mini-tts";
const DEFAULT_TTS_VOICE = "marin";
const MAX_TTS_CHARS = 4000;
const CONVERSATIONAL_TTS_INSTRUCTIONS =
  "Speak like natural conversation: warm, relaxed, and grounded. Use subtle pauses, avoid announcer cadence, and do not overemphasize.";

export class TtsNotConfiguredError extends Error {}

export function prepareSpeechText(text: string): string {
  return text
    .trim()
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/__(.*?)__/g, "$1")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+[.)]\s+/gm, "")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .trim()
    .slice(0, MAX_TTS_CHARS);
}

export function buildSpeechRequestBody(text: string): {
  model: string;
  voice: string;
  input: string;
  instructions?: string;
  response_format: "aac";
} {
  const model = process.env.FLYD_TTS_MODEL || DEFAULT_TTS_MODEL;
  const body: {
    model: string;
    voice: string;
    input: string;
    instructions?: string;
    response_format: "aac";
  } = {
    model,
    voice: process.env.FLYD_TTS_VOICE || DEFAULT_TTS_VOICE,
    input: prepareSpeechText(text),
    response_format: "aac",
  };

  if (!/^tts-1(?:-hd)?$/.test(model)) {
    body.instructions = CONVERSATIONAL_TTS_INSTRUCTIONS;
  }
  return body;
}

export async function synthesizeSpeech(text: string): Promise<Buffer> {
  // OpenAI-only endpoint — prefer OPENAI_API_KEY so FLYD_MODEL_API_KEY
  // can point at a non-OpenAI provider (e.g. OpenRouter) without breaking TTS.
  const apiKey = process.env.OPENAI_API_KEY || process.env.FLYD_MODEL_API_KEY;
  if (!apiKey) {
    throw new TtsNotConfiguredError("No API key configured for speech synthesis");
  }

  const requestBody = buildSpeechRequestBody(text);
  if (!requestBody.input) {
    throw new Error("No text to speak");
  }

  let response: Response;
  try {
    response = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    if (err instanceof Error && err.name === "TimeoutError") {
      throw new Error("Speech synthesis timed out");
    }
    throw err;
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Speech synthesis failed (${response.status}): ${detail.slice(0, 300)}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}
