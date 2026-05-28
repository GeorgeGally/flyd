import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { basename, join } from "path";
import { WIKI_DIR, DISPUTES_DIR, PROPOSED_DIR, hasApiKey } from "./config.js";
import { parse, serialize } from "./frontmatter.js";
import { agentLoop, AgentTool, ToolHandler } from "./llm.js";
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

// --- Tools ---

const WIKI_TOOLS: AgentTool[] = [
  {
    name: "list_wiki_entries",
    description: "List existing governed memory entries of a given type. Use this to check for duplicates or contradictions before voting.",
    input_schema: {
      type: "object",
      properties: {
        type: {
          type: "string",
          enum: ["career", "education", "skill", "award", "testimonial", "project", "person", "constraint"],
          description: "The memory type to list",
        },
      },
      required: ["type"],
    },
  },
  {
    name: "read_wiki_entry",
    description: "Read the full content of a specific wiki entry by its relative path (e.g. career/filename.md).",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Relative path within the wiki (e.g. career/filename.md)" },
      },
      required: ["path"],
    },
  },
];

function makeToolHandler(): ToolHandler {
  return (name: string, input: Record<string, unknown>): string => {
    if (name === "list_wiki_entries") {
      const type = String(input.type ?? "");
      const folder = WIKI_FOLDERS[type];
      if (!folder) return `unknown type: ${type}`;
      const dir = join(WIKI_DIR, folder);
      if (!existsSync(dir)) return "no entries found";
      const files = readdirSync(dir).filter((f) => f.endsWith(".md"));
      if (!files.length) return "no entries found";
      return files.map((f) => {
        const { body } = parse(readFileSync(join(dir, f), "utf8"));
        return `${folder}/${f}:\n${body.trim().slice(0, 400)}`;
      }).join("\n\n---\n\n");
    }

    if (name === "read_wiki_entry") {
      const relPath = String(input.path ?? "");
      const full = join(WIKI_DIR, relPath);
      if (!existsSync(full)) return `not found: ${relPath}`;
      return readFileSync(full, "utf8");
    }

    return `unknown tool: ${name}`;
  };
}

// --- Agent system prompts ---

function momSystemPrompt(): string {
  return `You are Mom, a peer reviewer in a personal memory governance system.

Role: Protect focus and restraint. Accept memories that are well-sourced, appropriately scoped, and durable. Reject stale, speculative, or identity-inflating entries — but do NOT reject well-sourced factual records like CV entries, degrees, awards, or testimonials.

You have two tools:
- list_wiki_entries(type): see what already exists for this memory type
- read_wiki_entry(path): read a specific entry in full

Before voting, always call list_wiki_entries for the same type as the proposed entry. Check for:
1. Near-duplicates — if the same fact is already governed, reject the duplicate
2. Contradictions with existing canon — flag as risk
3. Identity inflation — speculative claims unsupported by evidence

Calibration:
- "Identity-heavy" = premature crystallisation from thin evidence (e.g. "I am an entrepreneur" from one tweet). NOT the same as rejecting CV-derived facts.
- Career history, education, awards, testimonials from a CV are legitimate. Accept them unless duplicated or factually suspect.
- Missing raw/ provenance = reject.

After your tool calls, respond with ONLY this JSON:
{"vote": "accept|reject", "confidence": 0.0-1.0, "rationale": "...", "risks": ["..."]}`;
}

function georgeSystemPrompt(): string {
  return `You are George, a peer reviewer in a personal memory governance system.

Role: Protect possibility and emergence. Accept most well-sourced working memories. Reject only if clearly mistaken, clearly private, or representing premature identity crystallisation from thin evidence.

You have two tools:
- list_wiki_entries(type): see what already exists for this memory type
- read_wiki_entry(path): read a specific entry in full

Before voting, always call list_wiki_entries for the same type as the proposed entry. Check for:
1. Near-duplicates — if the same fact is already governed, reject the duplicate
2. Clear factual errors against existing canon

After your tool calls, respond with ONLY this JSON:
{"vote": "accept|reject", "rationale": "..."}`;
}

// --- Reviewers ---

export async function reviewWithMom(proposalPath: string, model: string): Promise<MomVerdict> {
  const content = readFileSync(proposalPath, "utf8");
  const { metadata } = parse(content);

  if (!hasApiKey(model)) return deterministicMomVerdict(metadata);

  try {
    const raw = await agentLoop(momSystemPrompt(), content, WIKI_TOOLS, makeToolHandler(), model);
    return parseMomVerdict(raw);
  } catch {
    return deterministicMomVerdict(metadata);
  }
}

export async function reviewWithGeorge(proposalPath: string, model: string): Promise<GeorgeVerdict> {
  const content = readFileSync(proposalPath, "utf8");
  const { metadata } = parse(content);

  if (!hasApiKey(model)) return deterministicGeorgeVerdict(metadata);

  try {
    const raw = await agentLoop(georgeSystemPrompt(), content, WIKI_TOOLS, makeToolHandler(), model);
    return parseGeorgeVerdict(raw);
  } catch {
    return deterministicGeorgeVerdict(metadata);
  }
}

// --- Decision ---

export function applyDecision(
  proposalPath: string,
  mom: MomVerdict,
  george: GeorgeVerdict,
): PromotionResult {
  const content = readFileSync(proposalPath, "utf8");
  const { metadata, body } = parse(content);

  const momAccepts = mom.vote === "accept";
  const georgeAccepts = george.vote === "accept";

  if (momAccepts && georgeAccepts) return promoteToWiki(proposalPath, metadata, body);
  if (!momAccepts && !georgeAccepts) return appendRejectedLog(proposalPath, body);
  return openDisputeArtifact(proposalPath, body, mom, george);
}

// --- Deterministic fallbacks (no API key) ---

export function deterministicMomVerdict(metadata: Record<string, unknown>): MomVerdict {
  const confidence = Number(metadata.confidence ?? 0);
  const status = String(metadata.status ?? "").toLowerCase();
  const sources = (metadata.source as string[] | undefined) ?? [];

  if (metadata.proposed_by !== "Host")
    return { vote: "reject", rationale: "Deterministic Mom gate only accepts Host-proposed candidates.", risks: ["unsupported-proposer"] };
  if (!sources.some((s) => s.startsWith("raw/")))
    return { vote: "reject", rationale: "Missing raw provenance.", confidence, risks: ["missing-raw-provenance"] };
  if (confidence < 0.75)
    return { vote: "reject", rationale: "Confidence below Mom's deterministic threshold (0.75).", confidence, risks: ["low-confidence"] };
  if (!["working", "canon"].includes(status))
    return { vote: "reject", rationale: "Unsupported status for deterministic acceptance.", confidence, risks: ["unsupported-status"] };
  return { vote: "accept", rationale: `CV-derived ${metadata.type ?? "memory"}; high-confidence source with preserved provenance.`, confidence };
}

export function deterministicGeorgeVerdict(metadata: Record<string, unknown>): GeorgeVerdict {
  const confidence = Number(metadata.confidence ?? 0);
  const sources = (metadata.source as string[] | undefined) ?? [];

  if (metadata.proposed_by !== "Host")
    return { vote: "reject", rationale: "Deterministic George gate only accepts Host-proposed candidates." };
  if (!sources.some((s) => s.startsWith("raw/")))
    return { vote: "reject", rationale: "Missing raw provenance." };
  if (confidence < 0.6)
    return { vote: "reject", rationale: "Confidence below George's deterministic threshold (0.6)." };
  return { vote: "accept", rationale: "Working memory with clear provenance; preserves possibility." };
}

// --- Verdict parsers ---

export function parseMomVerdict(raw: string): MomVerdict {
  const json = extractJson(raw);
  let payload: Record<string, unknown>;
  try { payload = JSON.parse(json); }
  catch { return { vote: "reject", rationale: "Mom returned unparseable response." }; }
  const vote = String(payload.vote ?? "").trim().toLowerCase();
  if (vote !== "accept" && vote !== "reject")
    return { vote: "reject", rationale: "Mom returned invalid vote." };
  return {
    vote,
    rationale: String(payload.rationale ?? ""),
    confidence: typeof payload.confidence === "number" ? payload.confidence : undefined,
    risks: Array.isArray(payload.risks) ? payload.risks.map(String) : undefined,
  };
}

export function parseGeorgeVerdict(raw: string): GeorgeVerdict {
  const json = extractJson(raw);
  let payload: Record<string, unknown>;
  try { payload = JSON.parse(json); }
  catch { return { vote: "reject", rationale: "George returned unparseable response." }; }
  const vote = String(payload.vote ?? "").trim().toLowerCase();
  if (vote !== "accept" && vote !== "reject")
    return { vote: "reject", rationale: "George returned invalid vote." };
  return { vote, rationale: String(payload.rationale ?? "") };
}

export function extractJson(raw: string): string {
  const stripped = raw.trim();
  const match = stripped.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (match) return match[1].trim();
  const obj = stripped.match(/\{[\s\S]*\}/);
  return obj ? obj[0] : stripped;
}

// --- Wiki writes ---

function promoteToWiki(proposalPath: string, metadata: Record<string, unknown>, body: string): PromotionResult {
  const folder = WIKI_FOLDERS[String(metadata.type ?? "")] ?? "entries";
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
  writeFileSync(logPath, existing.trimEnd() + `\n## ${basename(proposalPath)}\n\n${body.trim()}\n`, "utf8");
  rmSync(proposalPath);
  return { action: "rejected", writtenPath: "wiki/rejected.md", principalReviewRequired: false };
}

export function resolveDispute(disputePath: string, decision: "accept" | "reject"): PromotionResult {
  const content = readFileSync(disputePath, "utf8");
  const { metadata, body: disputeBody } = parse(content);
  const proposalFilename = String(metadata.proposal ?? "");

  let result: PromotionResult;
  if (decision === "accept") {
    const proposalPath = join(PROPOSED_DIR, proposalFilename);
    if (!existsSync(proposalPath)) throw new Error(`proposal not found: ${proposalPath}`);
    const { metadata: pm, body } = parse(readFileSync(proposalPath, "utf8"));
    result = promoteToWiki(proposalPath, pm, body);
    rmSync(disputePath);
  } else {
    const proposalPath = join(PROPOSED_DIR, proposalFilename);
    if (existsSync(proposalPath)) rmSync(proposalPath);
    result = appendRejectedLog(disputePath, disputeBody);
  }

  return result;
}

function openDisputeArtifact(proposalPath: string, body: string, mom: MomVerdict, george: GeorgeVerdict): PromotionResult {
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
    "# Dispute", "",
    "## Proposal excerpt",
    body.trim().slice(0, 400), "",
    "## Mom", `Vote: ${mom.vote}`, mom.rationale,
    mom.risks?.length ? `Risks: ${mom.risks.join(", ")}` : "", "",
    "## George", `Vote: ${george.vote}`, george.rationale,
  ].join("\n");

  writeFileSync(dest, serialize(metadata, disputeBody), "utf8");
  return { action: "disputed", writtenPath: `disputes/${filename}`, principalReviewRequired: true };
}
