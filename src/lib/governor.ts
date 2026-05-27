import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { basename, join } from "path";
import { WIKI_DIR, DISPUTES_DIR, PROPOSED_DIR, hasApiKey } from "./config.js";
import { parse, serialize } from "./frontmatter.js";
import { query } from "./llm.js";
import { WIKI_FOLDERS } from "./wiki.js";

export interface MomVerdict {
  vote: "accept" | "reject";
  rationale: string;
  confidence?: number;
  risks?: string[];
}

export interface GeorgeVerdict {
  vote: "accept" | "reject";
  rationale: string;
}

export interface PromotionResult {
  action: "promoted" | "rejected" | "disputed";
  writtenPath: string;
  principalReviewRequired: boolean;
}

export async function reviewWithMom(proposalPath: string, model: string): Promise<MomVerdict> {
  const content = readFileSync(proposalPath, "utf8");
  const { metadata } = parse(content);

  if (!hasApiKey(model)) {
    return deterministicMomVerdict(metadata);
  }

  const prompt = buildMomPrompt(content, metadata);
  const response = await query(prompt, model);
  return parseMomVerdict(response);
}

export async function reviewWithGeorge(proposalPath: string, model: string): Promise<GeorgeVerdict> {
  const content = readFileSync(proposalPath, "utf8");
  const { metadata } = parse(content);

  if (!hasApiKey(model)) {
    return deterministicGeorgeVerdict(metadata);
  }

  const prompt = buildGeorgePrompt(content, metadata);
  const response = await query(prompt, model);
  return parseGeorgeVerdict(response);
}

export function applyDecision(
  proposalPath: string,
  mom: MomVerdict,
  george: GeorgeVerdict,
): PromotionResult {
  const content = readFileSync(proposalPath, "utf8");
  const { metadata, body } = parse(content);

  const momAccepts = mom.vote === "accept";
  const georgeAccepts = george.vote === "accept";

  if (momAccepts && georgeAccepts) {
    return promoteToWiki(proposalPath, metadata, body);
  }
  if (!momAccepts && !georgeAccepts) {
    return appendRejectedLog(proposalPath, body);
  }
  return openDisputeArtifact(proposalPath, body, mom, george);
}

function deterministicMomVerdict(metadata: Record<string, unknown>): MomVerdict {
  const proposedBy = metadata.proposed_by;
  const confidence = Number(metadata.confidence ?? 0);
  const status = String(metadata.status ?? "").toLowerCase();
  const sources = (metadata.source as string[] | undefined) ?? [];

  if (proposedBy !== "Host") {
    return { vote: "reject", rationale: "Deterministic Mom gate only accepts Host-proposed candidates.", risks: ["unsupported-proposer"] };
  }
  if (!sources.some((s) => s.startsWith("raw/"))) {
    return { vote: "reject", rationale: "Missing raw provenance.", confidence, risks: ["missing-raw-provenance"] };
  }
  if (confidence < 0.75) {
    return { vote: "reject", rationale: "Confidence below Mom's deterministic threshold (0.75).", confidence, risks: ["low-confidence"] };
  }
  if (!["working", "canon"].includes(status)) {
    return { vote: "reject", rationale: "Unsupported status for deterministic acceptance.", confidence, risks: ["unsupported-status"] };
  }
  return { vote: "accept", rationale: `CV-derived ${metadata.type ?? "memory"}; high-confidence source with preserved provenance.`, confidence };
}

function deterministicGeorgeVerdict(metadata: Record<string, unknown>): GeorgeVerdict {
  const proposedBy = metadata.proposed_by;
  const confidence = Number(metadata.confidence ?? 0);
  const sources = (metadata.source as string[] | undefined) ?? [];

  if (proposedBy !== "Host") {
    return { vote: "reject", rationale: "Deterministic George gate only accepts Host-proposed candidates." };
  }
  if (!sources.some((s) => s.startsWith("raw/"))) {
    return { vote: "reject", rationale: "Missing raw provenance." };
  }
  if (confidence < 0.6) {
    return { vote: "reject", rationale: "Confidence below George's deterministic threshold (0.6)." };
  }
  return { vote: "accept", rationale: `Working memory with clear provenance; preserves possibility.` };
}

function buildMomPrompt(content: string, metadata: Record<string, unknown>): string {
  return `You are Mom, a Council peer reviewer. Decide whether this proposed memory protects the principal's agency across time without crowding present attention.

Role: Protect focus and restraint. Accept when the memory is useful, appropriately scoped, and low-burden. Reject when stale, over-broad, clearly low-provenance, or speculative identity inflation.

Calibration — what these terms mean here:
- "Identity-heavy" means premature crystallization from thin episodic evidence (e.g. "I am an entrepreneur" inferred from one tweet). It does NOT mean rejecting well-sourced facts like degrees, awards, career history, or testimonials that have clear primary-source provenance.
- "Low-provenance" means no traceable primary source. A memory extracted from a CV or résumé (raw/ source) has high provenance — do not reject it on provenance grounds.
- Education, career history, awards, and testimonials from a CV are legitimate identity facts worth keeping. Accept them unless there is a specific reason to doubt accuracy or scope.

## Proposed Memory Metadata
${Object.entries(metadata).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join("\n")}

## Proposed Memory Body
${parse(content).body}

## Required JSON Output
Return only JSON with this shape:
{"vote": "accept|reject", "confidence": 0.0, "rationale": "...", "risks": ["..."]}`;
}

function buildGeorgePrompt(content: string, metadata: Record<string, unknown>): string {
  return `You are George, a Council peer reviewer. Decide whether this proposed memory deserves to exist and grow.

Role: Protect possibility and emergence. Accept most well-sourced working memories. Reject only if clearly mistaken, clearly private, or representing premature identity crystallization from thin evidence.

## Proposed Memory Metadata
${Object.entries(metadata).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join("\n")}

## Proposed Memory Body
${parse(content).body}

## Required JSON Output
Return only JSON with this shape:
{"vote": "accept|reject", "rationale": "..."}`;
}

function parseMomVerdict(raw: string): MomVerdict {
  const json = extractJson(raw);
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(json);
  } catch {
    return { vote: "reject", rationale: "Mom returned unparseable response." };
  }
  const vote = String(payload.vote ?? "").trim().toLowerCase();
  if (vote !== "accept" && vote !== "reject") {
    return { vote: "reject", rationale: "Mom returned invalid vote." };
  }
  return {
    vote,
    rationale: String(payload.rationale ?? ""),
    confidence: typeof payload.confidence === "number" ? payload.confidence : undefined,
    risks: Array.isArray(payload.risks) ? payload.risks.map(String) : undefined,
  };
}

function parseGeorgeVerdict(raw: string): GeorgeVerdict {
  const json = extractJson(raw);
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(json);
  } catch {
    return { vote: "reject", rationale: "George returned unparseable response." };
  }
  const vote = String(payload.vote ?? "").trim().toLowerCase();
  if (vote !== "accept" && vote !== "reject") {
    return { vote: "reject", rationale: "George returned invalid vote." };
  }
  return { vote, rationale: String(payload.rationale ?? "") };
}

function extractJson(raw: string): string {
  const stripped = raw.trim();
  const match = stripped.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (match) return match[1].trim();
  const obj = stripped.match(/\{[\s\S]*\}/);
  return obj ? obj[0] : stripped;
}

function promoteToWiki(
  proposalPath: string,
  metadata: Record<string, unknown>,
  body: string,
): PromotionResult {
  const memType = String(metadata.type ?? "");
  const folder = WIKI_FOLDERS[memType] ?? "entries";
  const wikiSubDir = join(WIKI_DIR, folder);
  mkdirSync(wikiSubDir, { recursive: true });

  const filename = basename(proposalPath);
  const dest = join(wikiSubDir, filename);
  writeFileSync(dest, serialize(metadata, body), "utf8");
  rmSync(proposalPath);

  return { action: "promoted", writtenPath: `wiki/${folder}/${filename}`, principalReviewRequired: false };
}

function appendRejectedLog(proposalPath: string, body: string): PromotionResult {
  mkdirSync(WIKI_DIR, { recursive: true });
  const logPath = join(WIKI_DIR, "rejected.md");
  const existing = existsSync(logPath) ? readFileSync(logPath, "utf8") : "# Rejected Memories\n";
  const entry = `\n## ${basename(proposalPath)}\n\n${body.trim()}\n`;
  writeFileSync(logPath, existing.trimEnd() + entry, "utf8");
  rmSync(proposalPath);
  return { action: "rejected", writtenPath: "wiki/rejected.md", principalReviewRequired: false };
}

export function resolveDispute(
  disputePath: string,
  decision: "accept" | "reject",
): PromotionResult {
  const content = readFileSync(disputePath, "utf8");
  const { metadata, body: disputeBody } = parse(content);
  const proposalFilename = String(metadata.proposal ?? "");

  let result: PromotionResult;
  if (decision === "accept") {
    const proposalPath = join(PROPOSED_DIR, proposalFilename);
    if (!existsSync(proposalPath)) {
      throw new Error(`proposal not found: ${proposalPath}`);
    }
    const { metadata: pm, body } = parse(readFileSync(proposalPath, "utf8"));
    result = promoteToWiki(proposalPath, pm, body);
  } else {
    result = appendRejectedLog(disputePath, disputeBody);
  }

  rmSync(disputePath);
  return result;
}

function openDisputeArtifact(
  proposalPath: string,
  body: string,
  mom: MomVerdict,
  george: GeorgeVerdict,
): PromotionResult {
  mkdirSync(DISPUTES_DIR, { recursive: true });
  const today = new Date().toISOString().split("T")[0];
  const stem = basename(proposalPath, ".md");
  const filename = `${today}-dispute-${stem}.md`;
  const dest = join(DISPUTES_DIR, filename);

  const metadata: Record<string, unknown> = {
    proposal: basename(proposalPath),
    opened_on: today,
    principal_review_required: true,
    mom_vote: mom.vote,
    george_vote: george.vote,
  };
  const disputeBody = [
    "# Dispute",
    "",
    "## Proposal excerpt",
    body.trim().slice(0, 400),
    "",
    "## Mom",
    `Vote: ${mom.vote}`,
    mom.rationale,
    mom.risks?.length ? `Risks: ${mom.risks.join(", ")}` : "",
    "",
    "## George",
    `Vote: ${george.vote}`,
    george.rationale,
  ].filter((l) => l !== undefined).join("\n");

  writeFileSync(dest, serialize(metadata, disputeBody), "utf8");
  return { action: "disputed", writtenPath: `disputes/${filename}`, principalReviewRequired: true };
}
