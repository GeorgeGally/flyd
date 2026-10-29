import { extractKeywords } from "../lib/retrieval.js";

export type ContextRoute = "companion" | "work" | "recall";
const LIMITS: Record<ContextRoute, { profile: number; memory: number }> = {
  companion: { profile: 2_400, memory: 2_000 },
  work: { profile: 3_200, memory: 4_000 },
  recall: { profile: 4_000, memory: 12_000 },
};

// These sections are explicit instructions and must never be shortened.
const PROTECTED = new Set(["constraints", "how to be with me", "instructions", "safety", "preferences"]);
const INSTRUCTION = /^\s*[-*]?\s*(?:always|never|must|stop|avoid|do not|don['’]t|use|keep|give|be)\s+(?!(?:\w+ed|been|had|was|were|did|seen|gone|done|got|went|knew|met|grew|lived)\b)\w/i;

export function isProfileInstruction(text: string): boolean { return INSTRUCTION.test(text); }

interface Line { section: string; text: string; mandatory: boolean; score: number }

function lines(text: string, keywords: string[], profile: boolean): Line[] {
  let section = "";
  let aboutCount = 0;
  const out: Line[] = [];
  for (const raw of text.split("\n")) {
    const heading = /^##\s+(.+)/.exec(raw);
    if (heading) { section = heading[1]!.trim(); continue; }
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const mandatory = profile && (PROTECTED.has(section.toLowerCase()) || INSTRUCTION.test(line) || (section === "About me" && aboutCount++ < 2));
    const low = line.toLowerCase();
    const score = keywords.filter((word) => low.includes(word)).length;
    out.push({ section, text: line, mandatory, score });
  }
  return out;
}

function identity(text: string): string {
  return text.replace(/^[-*]\s*/, "").replace(/^\[[^\]]+\]\s*/, "").replace(/\s*\(\d{4}-\d{2}-\d{2}\)\s*$/, "").replace(/\s+/g, " ").toLowerCase().trim();
}

function selectedLines(items: Line[], cap: number, seen: Set<string>): string {
  const chosen = items.filter((item) => item.mandatory);
  for (const item of chosen) seen.add(identity(item.text));
  let length = chosen.reduce((sum, item) => sum + item.text.length + item.section.length + 4, 0);
  for (const item of items.filter((item) => !item.mandatory && item.score > 0).sort((a, b) => b.score - a.score)) {
    const key = identity(item.text);
    if (seen.has(key) || length + item.text.length > cap) continue;
    chosen.push(item); seen.add(key); length += item.text.length + item.section.length + 4;
  }
  return chosen.map((item) => `[${item.section}] ${item.text}`).join("\n");
}

export function budgetPersonalContext(input: { profile: string; memory: string; query: string; route: ContextRoute }): string {
  const keywords = extractKeywords(input.query);
  if (/\b(?:vent(?:ing)?|long day|tired|exhausted|overwhelmed)\b/i.test(input.query)) keywords.push("tired", "exhaust", "stress", "rough", "burnout");
  const limits = LIMITS[input.route];
  const seen = new Set<string>();
  const profile = selectedLines(lines(input.profile, keywords, true), limits.profile, seen);
  const memory = selectedLines(lines(input.memory, keywords, false), limits.memory, seen);
  return [profile ? `## George's profile (USER.md; explicit instructions take priority)\n${profile}` : "", memory ? `## Flyd memory (curated, possibly stale)\n${memory}` : ""].filter(Boolean).join("\n\n");
}

/** Keep recent turns, plus earlier user instructions, without cutting an instruction mid-line. */
export function budgetHistory<T extends { role: string; content: string }>(history: T[], route: ContextRoute): T[] {
  const cap = route === "recall" ? 12_000 : route === "work" ? 8_000 : 6_000;
  let used = 0;
  const kept: T[] = [];
  for (const turn of [...history].reverse()) {
    const mandatory = turn.role === "user";
    if (mandatory || used + turn.content.length <= cap) {
      kept.push(turn);
      used += turn.content.length;
    }
  }
  return kept.reverse();
}
