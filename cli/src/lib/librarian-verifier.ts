import { defaultModel } from "./config.js";
import { query } from "./llm.js";
import type { SufficiencyAssessment } from "./librarian.js";

export const MAX_VERIFY_ENTRIES = 10;
const MAX_BODY_CHARS = 400;

export interface VerifierEntry {
  path: string;
  body: string;
  freshness?: number;
  epistemicConfidence?: number;
  stalenessMessage?: string | null;
}

export interface EvidenceVerdict {
  relevant: boolean;
  reason: string;
}

export interface VerifiedConflict {
  a: string;
  b: string;
  reason: string;
}

export interface VerificationResult {
  verified: boolean;
  verdicts: Map<string, EvidenceVerdict>;
  sufficiency: SufficiencyAssessment;
  conflicts: VerifiedConflict[];
}

const SUFFICIENCY_VERDICTS = new Set(["sufficient", "partial", "conflicting", "insufficient"]);

const SYSTEM =
  "You are a memory librarian verifier. You judge whether retrieved personal memories actually answer a question. You reason carefully before judging, then respond with ONLY the requested JSON object.";

function formatEntry(entry: VerifierEntry): string {
  const signals = [
    `freshness=${(entry.freshness ?? 0.5).toFixed(2)}`,
    `epistemic=${(entry.epistemicConfidence ?? 0.5).toFixed(2)}`,
    entry.stalenessMessage ? `staleness=${entry.stalenessMessage}` : null,
  ]
    .filter(Boolean)
    .join(" ");
  const body = entry.body.trim().slice(0, MAX_BODY_CHARS);
  return `[${entry.path}]\n${signals}\n${body}`;
}

function buildPrompt(entries: VerifierEntry[], question: string): string {
  const blocks = entries.map(formatEntry).join("\n\n");
  return `${entries.length} personal memories were retrieved for the question below.

Question: ${question}

Memories:
${blocks}

Think step by step about which of these memories actually answer the question, whether they conflict with each other about the same fact, and whether together they are enough to answer it. A memory phrased differently from the question can still be highly relevant; a memory sharing many words but answering something else is not.

Then respond with ONLY this JSON:
{
  "reasoning": "your step-by-step judgment",
  "entries": [{ "path": "exact path as given", "relevant": true, "reason": "one sentence" }],
  "sufficiency": { "verdict": "sufficient|partial|conflicting|insufficient", "reason": "one sentence" },
  "conflicts": [{ "a": "path", "b": "path", "reason": "what fact they disagree on" }]
}

Every retrieved path must appear exactly once in "entries". Use "conflicts": [] if none.`;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseVerdict(raw: string, paths: Set<string>): VerificationResult | null {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    return null;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const obj = parsed as any;
  if (!Array.isArray(obj.entries)) return null;

  const verdicts = new Map<string, EvidenceVerdict>();
  for (const e of obj.entries) {
    if (!e || typeof e.path !== "string" || !paths.has(e.path)) continue;
    verdicts.set(e.path, {
      relevant: e.relevant === true,
      reason: typeof e.reason === "string" ? e.reason : "",
    });
  }
  if (verdicts.size === 0) return null;

  let sufficiency: SufficiencyAssessment = { verdict: "partial", reason: "", coverage: 0 };
  if (
    obj.sufficiency &&
    typeof obj.sufficiency.verdict === "string" &&
    SUFFICIENCY_VERDICTS.has(obj.sufficiency.verdict)
  ) {
    sufficiency = {
      verdict: obj.sufficiency.verdict,
      reason: typeof obj.sufficiency.reason === "string" ? obj.sufficiency.reason : "",
      coverage: typeof obj.sufficiency.coverage === "number" ? obj.sufficiency.coverage : 0,
    };
  }

  const conflicts: VerifiedConflict[] = Array.isArray(obj.conflicts)
    ? obj.conflicts.filter(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (c: any) =>
          c && typeof c.a === "string" && typeof c.b === "string" && paths.has(c.a) && paths.has(c.b),
      )
    : [];

  return { verified: true, verdicts, sufficiency, conflicts };
}

export async function verifyEvidence(
  entries: VerifierEntry[],
  question: string,
): Promise<VerificationResult> {
  const fallback: VerificationResult = {
    verified: false,
    verdicts: new Map(),
    sufficiency: { verdict: "insufficient", reason: "Verification unavailable.", coverage: 0 },
    conflicts: [],
  };
  if (entries.length === 0) return fallback;

  const capped = entries.slice(0, MAX_VERIFY_ENTRIES);
  const prompt = buildPrompt(capped, question);

  let response: string;
  try {
    response = await query(prompt, defaultModel(), SYSTEM, undefined, undefined, { json: true });
  } catch {
    return fallback;
  }

  const paths = new Set(capped.map((e) => e.path));
  return parseVerdict(response, paths) ?? fallback;
}
