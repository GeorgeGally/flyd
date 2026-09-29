// OpenAI's transcription models sometimes return the prompt itself when a clip
// holds little or no speech (a trailing pause, a breath), so George's text box
// got "Flyd (pronounced Floyd) is George's AI assistant. Names and terms he
// uses: …". Real speech almost never repeats the prompt four words at a time,
// so a sentence made mostly of the prompt's four-word runs is an echo.

const RUN = 4;
const ECHO_SHARE = 0.5;

function words(text: string): string[] {
  return text.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter(Boolean);
}

function runs(list: string[]): string[] {
  const out: string[] = [];
  for (let index = 0; index + RUN <= list.length; index += 1) out.push(list.slice(index, index + RUN).join(" "));
  return out;
}

export function isPromptEcho(text: string, prompt: string): boolean {
  const spoken = runs(words(text));
  if (!spoken.length || !prompt.trim()) return false;
  const promptRuns = new Set(runs(words(prompt)));
  return spoken.filter((run) => promptRuns.has(run)).length / spoken.length >= ECHO_SHARE;
}

/** The transcript with any sentence that echoes the prompt removed. */
export function removePromptEcho(text: string, prompt: string): string {
  return text
    .split(/(?<=[.!?])\s+/)
    .filter((sentence) => !isPromptEcho(sentence, prompt))
    .join(" ")
    .trim();
}
