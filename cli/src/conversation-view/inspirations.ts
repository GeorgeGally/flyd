/**
 * "For this chat": what the existing Evidence Engine finds for the few terms
 * the conversation is about, as plain cards for the sidebar. The page asks
 * once the chat has settled, or when George asks for more; never per keystroke.
 * What comes back is evidence shown to him, never written into memory.
 */
import { createDefaultEvidenceRegistry } from "../evidence/default-registry.js";
import { EvidenceEngine } from "../evidence/evidence-engine.js";
import type { EvidenceBundle, EvidenceKind } from "../evidence/types.js";

export interface Inspiration { kind: string; title: string; text: string; by: string; at: string; url: string }
export interface InspirationResearcher { research(query: string, depth: "quick"): Promise<EvidenceBundle> }

const MOST_TERMS = 6;
const MOST_CARDS = 6;
const KIND: Record<EvidenceKind, string> = {
  video: "Video", news: "News", release: "News", market: "Stat", social: "Quote", discussion: "Quote",
  first_party_statement: "Quote", reference: "Fact", research: "Fact", code: "Fact", job_signal: "Fact",
};

/** The terms the page sent ("Logan,swatches"): a few short plain words, else none. */
export function inspirationTerms(raw: string | null): string[] {
  const terms = String(raw ?? "").split(",").map((term) => term.replace(/\s+/g, " ").trim())
    .filter((term) => term.length >= 2 && term.length <= 40 && /^[\p{L}\p{N}' .’-]+$/u.test(term));
  return [...new Set(terms)].slice(0, MOST_TERMS);
}

function plain(text: string | undefined, most: number): string {
  const flat = String(text ?? "").replace(/\s+/g, " ").trim();
  if (flat.length <= most) return flat;
  const cut = flat.lastIndexOf(" ", most);
  return flat.slice(0, cut > most / 2 ? cut : most);
}

function sourceOf(url: string, backend: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return backend; }
}

let engine: EvidenceEngine | undefined;

/** One quick Evidence Engine lookup for the terms, ranked as the engine ranked it: titled, linked public items only. */
export async function findInspirations(terms: string[], researcher: InspirationResearcher = (engine ??= new EvidenceEngine(createDefaultEvidenceRegistry()))): Promise<Inspiration[]> {
  if (!terms.length) return [];
  const bundle = await researcher.research(terms.join(" "), "quick");
  const seen = new Set<string>();
  const cards: Inspiration[] = [];
  for (const item of bundle.evidence) {
    const url = item.locator ?? "";
    const title = plain(item.title, 200);
    if (!title || !/^https?:\/\//i.test(url) || seen.has(url)) continue;
    seen.add(url);
    cards.push({ kind: KIND[item.kind] ?? "Fact", title, text: plain(item.content, 400), by: sourceOf(url, item.backend), at: item.publishedAt ?? "", url });
    if (cards.length >= MOST_CARDS) break;
  }
  return cards;
}
