import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type ProjectKnowledgeKind = "command" | "architecture" | "constraint" | "convention" | "gotcha" | "workflow" | "danger";

export interface ProjectKnowledgeCandidate {
  text: string;
  kind: ProjectKnowledgeKind;
  source: string;
  confidence: "high" | "medium" | "low";
  durable: boolean;
}

export interface ProjectKnowledgePromotion {
  accepted: ProjectKnowledgeCandidate[];
  rejected: Array<{ candidate: ProjectKnowledgeCandidate; reason: string }>;
  changed: boolean;
  agentsPath: string;
}

const GENERATED_START = "<!-- flyd:project-knowledge:start -->";
const GENERATED_END = "<!-- flyd:project-knowledge:end -->";
const TEMPORARY = /\b(today|tomorrow|currently|right now|this branch|current branch|temporary|for now|worker|pid|blocked on|waiting on)\b/i;

function normalize(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

function classify(candidate: ProjectKnowledgeCandidate): string | null {
  const text = normalize(candidate.text);
  if (!candidate.durable) return "not durable";
  if (candidate.confidence !== "high") return "insufficient confidence";
  if (!text || text.length < 8) return "too little information";
  if (text.length > 500) return "candidate too long";
  if (TEMPORARY.test(text)) return "task-local or temporary state";
  return null;
}

const labels: Record<ProjectKnowledgeKind, string> = {
  command: "Commands",
  architecture: "Architecture",
  constraint: "Constraints",
  convention: "Conventions",
  gotcha: "Gotchas",
  workflow: "Workflow",
  danger: "Dangerous operations",
};

function candidateFragment(candidates: ProjectKnowledgeCandidate[]): string {
  const grouped = new Map<ProjectKnowledgeKind, string[]>();
  for (const candidate of candidates) {
    const list = grouped.get(candidate.kind) ?? [];
    list.push(normalize(candidate.text));
    grouped.set(candidate.kind, list);
  }
  const lines: string[] = [];
  for (const kind of Object.keys(labels) as ProjectKnowledgeKind[]) {
    const values = grouped.get(kind);
    if (!values?.length) continue;
    lines.push(`### ${labels[kind]}`, ...values.sort().map((value) => `- ${value}`), "");
  }
  return lines.join("\n").trim();
}

function mergeGeneratedSection(existing: string, candidates: ProjectKnowledgeCandidate[]): string {
  const fragment = candidateFragment(candidates);
  const start = existing.indexOf(GENERATED_START);
  const end = existing.indexOf(GENERATED_END);
  if (start >= 0 && end >= start) {
    return `${existing.slice(0, end).trimEnd()}\n\n${fragment}\n${existing.slice(end).trimStart()}`.trimEnd() + "\n";
  }
  const section = [GENERATED_START, "## Flyd-maintained project knowledge", "", fragment, "", GENERATED_END].join("\n");
  return `${existing.trimEnd()}\n\n${section}\n`;
}

/** Promote only high-confidence durable project-native knowledge into AGENTS.md. */
export function promoteProjectKnowledge(input: {
  projectRoot: string;
  candidates: ProjectKnowledgeCandidate[];
  apply?: boolean;
}): ProjectKnowledgePromotion {
  const agentsPath = join(input.projectRoot, "AGENTS.md");
  const existing = existsSync(agentsPath) ? readFileSync(agentsPath, "utf8") : "# AGENTS.md\n";
  const existingNormalized = existing.toLowerCase().replace(/\s+/g, " ");
  const rejected: ProjectKnowledgePromotion["rejected"] = [];
  const accepted: ProjectKnowledgeCandidate[] = [];
  const seen = new Set<string>();

  for (const candidate of input.candidates) {
    const reason = classify(candidate);
    const text = normalize(candidate.text);
    const key = `${candidate.kind}:${text.toLowerCase()}`;
    if (reason) {
      rejected.push({ candidate, reason });
      continue;
    }
    if (seen.has(key) || existingNormalized.includes(text.toLowerCase())) {
      rejected.push({ candidate, reason: "already documented" });
      continue;
    }
    seen.add(key);
    accepted.push({ ...candidate, text });
  }

  if (accepted.length === 0) return { accepted, rejected, changed: false, agentsPath };
  const next = mergeGeneratedSection(existing, accepted);
  const changed = next !== existing;
  if (changed && input.apply) writeFileSync(agentsPath, next, "utf8");
  return { accepted, rejected, changed, agentsPath };
}
