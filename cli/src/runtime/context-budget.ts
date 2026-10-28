import { extractKeywords } from "../lib/retrieval.js";

export type ContextRoute = "companion" | "work" | "recall";
const LIMITS: Record<ContextRoute, { profile: number; memory: number }> = {
  companion: { profile: 2_400, memory: 2_000 },
  work: { profile: 3_200, memory: 4_000 },
  recall: { profile: 4_000, memory: 12_000 },
};

// These sections are explicit instructions and must never be shortened.
const PROTECTED = new Set(["constraints", "how to be with me", "instructions", "safety", "preferences"]);
const INSTRUCTION = /\b(?:always|never|must|do not|don't|should|please|avoid|prefer|ask before|only|without (?:asking|approval)|wants? (?:flyd|you) to)\b|^\s*[-*]?\s*(?:use|write|speak|tell|keep|avoid|ask|show|give|be|respond|answer|treat|preserve|ensure|include|exclude|follow|respect)\b/i;

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

function selectedLines(items: Line[], cap: number): string {
  const chosen = items.filter((item) => item.mandatory);
  const seen = new Set(chosen.map((item) => item.text.toLowerCase()));
  let length = chosen.reduce((sum, item) => sum + item.text.length + item.section.length + 4, 0);
  for (const item of items.filter((item) => !item.mandatory && item.score > 0).sort((a, b) => b.score - a.score)) {
    if (seen.has(item.text.toLowerCase()) || length + item.text.length > cap) continue;
    chosen.push(item); seen.add(item.text.toLowerCase()); length += item.text.length + item.section.length + 4;
  }
  return chosen.map((item) => `[${item.section}] ${item.text}`).join("\n");
}

export function budgetPersonalContext(input: { profile: string; memory: string; query: string; route: ContextRoute }): string {
  const keywords = extractKeywords(input.query);
  const limits = LIMITS[input.route];
  const profile = selectedLines(lines(input.profile, keywords, true), limits.profile);
  const memory = selectedLines(lines(input.memory, keywords, false), limits.memory);
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
