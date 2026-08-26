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

export interface IngestPageProposal {
  path: string;
  title?: string;
  body: string;
}

export type PageVerdictValue = "justified" | "invented" | "borderline";

export interface PageVerdict {
  path: string;
  verdict: PageVerdictValue;
  reason: string;
}

export interface IngestVerificationResult {
  verified: boolean;
  pages: Map<string, PageVerdict>;
}

const PAGE_VERDICTS = new Set(["justified", "invented", "borderline"]);

function formatCapture(body: string, i: number): string {
  return `[capture ${i + 1}]\n${body.trim().slice(0, MAX_BODY_CHARS)}`;
}

function formatProposal(page: IngestPageProposal): string {
  const title = page.title ? ` (title: ${page.title})` : "";
  return `[${page.path}]${title}\n${page.body.trim().slice(0, MAX_BODY_CHARS * 2)}`;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function judgePages(
  systemMarkerPrompt: string,
  proposals: IngestPageProposal[],
  captures: string[],
): Promise<Map<string, PageVerdict>> {
  const pages = new Map<string, PageVerdict>();
  if (proposals.length === 0) return pages;

  const prompt = `${systemMarkerPrompt}

## Source captures (the only permitted factual basis)
${captures.map(formatCapture).join("\n\n")}

## Proposed wiki changes
${proposals.map(formatProposal).join("\n\n")}

For each proposed page, judge whether every factual claim in it traces to the source captures above:
- "justified" — all claims come from the captures.
- "invented" — contains facts no capture supports.
- "borderline" — you cannot tell.

Think step by step, then respond with ONLY this JSON:
{
  "reasoning": "your step-by-step judgment",
  "pages": [{ "path": "exact path as given", "verdict": "justified|invented|borderline", "reason": "one sentence" }]
}`;

  let response: string;
  try {
    response = await query(prompt, defaultModel(), SYSTEM, undefined, undefined, { json: true });
  } catch {
    return pages;
  }

  const match = response.match(/\{[\s\S]*\}/);
  if (!match) return pages;
  let parsed: unknown;
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    return pages;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const obj = parsed as any;
  if (!Array.isArray(obj.pages)) return pages;

  for (const p of obj.pages) {
    if (!p || typeof p.path !== "string") continue;
    const known = proposals.some((prop) => prop.path === p.path);
    if (!known || !PAGE_VERDICTS.has(p.verdict)) continue;
    pages.set(p.path, {
      path: p.path,
      verdict: p.verdict,
      reason: typeof p.reason === "string" ? p.reason : "",
    });
  }
  return pages;
}

/**
 * Verify-before-promote gate for ingest plans: every proposed page is judged
 * against the captures it was generated from. Borderline pages get two extra
 * votes and go with the majority (test-time compute spent only where the
 * first judgment was uncertain). Fail-soft: an unusable model response yields
 * verified:false and callers fall open.
 */
export async function verifyIngestPlan(
  proposals: IngestPageProposal[],
  captures: string[],
): Promise<IngestVerificationResult> {
  if (proposals.length === 0 || captures.length === 0) {
    return { verified: false, pages: new Map() };
  }

  const pages = await judgePages(
    `You are verifying ${proposals.length} proposed wiki changes before they are written to permanent memory. Only knowledge present in the source captures may be promoted.`,
    proposals,
    captures,
  );
  if (pages.size === 0) return { verified: false, pages };

  const borderline = [...pages.values()].filter((v) => v.verdict === "borderline").map((v) => v.path);
  for (const path of borderline) {
    const proposal = proposals.find((p) => p.path === path)!;
    const extra = await judgePages(
      "You are judging a single proposed wiki page against its source captures before it is written to permanent memory.",
      [proposal],
      captures,
    );
    const revote = extra.get(path);
    if (!revote) continue;
    const votes = ["borderline", revote.verdict];
    const keepVotes = votes.filter((v) => v !== "invented").length;
    pages.set(path, {
      ...revote,
      verdict: keepVotes >= 2 ? "justified" : "invented",
    });
  }

  return { verified: true, pages };
}
