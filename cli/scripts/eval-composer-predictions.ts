import { readFileSync } from "node:fs";
import { boundedSuffix, completePrediction, predictionPrompt } from "../src/conversation-view/composer-predictions.js";
import type { ConversationMessage } from "../src/conversation-view/types.js";

// Explicit offline benchmark: a private JSON array, never collected drafts.
// Prints aggregate latency/usage and reference-prefix agreement, never wording.
const [file, ...models] = process.argv.slice(2);
if (!file || !models.length) throw new Error("Usage: npm run evals:composer -- /private/cases.json openrouter:inception/mercury-2.5 openrouter:google/gemini-2.5-flash-lite");
const data: unknown = JSON.parse(readFileSync(file, "utf8"));
if (!Array.isArray(data) || data.length === 0 || data.length > 100) throw new Error("Expected 1–100 private cases");
const cases = data.map(c => {
  if (!c || typeof c.draft !== "string" || c.draft.length > 2000 || !Array.isArray(c.messages) || c.messages.some((m: ConversationMessage) => !m || !["user", "assistant"].includes(m.role) || typeof m.text !== "string")) throw new Error("Expected {draft, messages, expectedSuffix?}");
  return c as { draft: string; messages: ConversationMessage[]; expectedSuffix?: string };
});
for (const model of models) {
  const times: number[] = []; let errors = 0, empty = 0, matched = 0, reference = 0, inputTokens = 0, outputTokens = 0, cost = 0, billed = 0;
  for (const c of cases) {
    const started = Date.now();
    try {
      const out = await completePrediction(predictionPrompt({ session: "benchmark", ...c }), model, AbortSignal.timeout(1200));
      times.push(Date.now() - started); const suffix = boundedSuffix(out.text); if (!suffix) empty++;
      inputTokens += out.inputTokens ?? 0; outputTokens += out.outputTokens ?? 0;
      if (typeof out.cost === "number") { cost += out.cost; billed++; }
      if (typeof c.expectedSuffix === "string") { reference += c.expectedSuffix.length; for (let i = 0; i < Math.min(suffix.length, c.expectedSuffix.length) && suffix[i] === c.expectedSuffix[i]; i++) matched++; }
    } catch { errors++; }
  }
  times.sort((a, b) => a - b);
  console.log(JSON.stringify({ model, cases: cases.length, errors, empty, p50Ms: times.length ? times[Math.floor(times.length / 2)] : null, p95Ms: times.length ? times[Math.min(times.length - 1, Math.floor(times.length * .95))] : null, referencePrefixCharacters: matched, referenceCharacters: reference, inputTokens, outputTokens, billedCost: billed ? cost : null, billedRequests: billed }));
}
