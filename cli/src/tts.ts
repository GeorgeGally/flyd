const DEFAULT_TTS_MODEL = "gpt-4o-mini-tts";
const DEFAULT_TTS_VOICE = "alloy";
const MAX_TTS_CHARS = 4000;

export class TtsNotConfiguredError extends Error {}

export async function synthesizeSpeech(text: string): Promise<Buffer> {
  // OpenAI-only endpoint — prefer OPENAI_API_KEY so FLYD_MODEL_API_KEY
  // can point at a non-OpenAI provider (e.g. OpenRouter) without breaking TTS.
  const apiKey = process.env.OPENAI_API_KEY || process.env.FLYD_MODEL_API_KEY;
  if (!apiKey) {
    throw new TtsNotConfiguredError("No API key configured for speech synthesis");
  }

  const trimmed = text.trim().slice(0, MAX_TTS_CHARS);
  if (!trimmed) {
    throw new Error("No text to speak");
  }

  const response = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.FLYD_TTS_MODEL || DEFAULT_TTS_MODEL,
      voice: process.env.FLYD_TTS_VOICE || DEFAULT_TTS_VOICE,
      input: trimmed,
      response_format: "aac",
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Speech synthesis failed (${response.status}): ${detail.slice(0, 300)}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}
