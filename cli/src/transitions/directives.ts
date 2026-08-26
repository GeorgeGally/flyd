import { randomUUID } from "node:crypto";
import {
  findDirectiveByDedupeKey,
  loadDirectives,
  saveDirectives,
  type BehaviouralDirective,
} from "./directives-store.js";

/**
 * Directive extraction and lifecycle (transition-log plan U6).
 *
 * Corrections become sanitized, provenance-carrying directives. V1 is pure
 * normalization — no model call; the user's words usually are the directive.
 */

export const DIRECTIVE_MAX_CHARS = 200;
/** Raw corrections above this are rejected whole before any cleanup. */
export const DIRECTIVE_RAW_MAX_CHARS = 400;
/** Duplicate window for dedupe, matching SKILLIFY_TTL_DAYS semantics. */
export const DIRECTIVE_TTL_DAYS = 7;
/** Negatives at or above this (with negatives > utility) suppress a directive. */
export const DIRECTIVE_SUPPRESSION_NEGATIVE_THRESHOLD = 3;
export const DIRECTIVE_SUPPRESSED_REASON = "suppressed:negative_outcomes";

const CONTROL_AND_INVISIBLE =
  /[\u0000-\u0008\u000b-\u001f\u007f\u200b-\u200f\u2028\u2029\u2060\ufeff]/g;

// Injection-scaffolding blocklist, deliberately small: override imperatives
// and markup/fence scaffolding. Anything subtler is contained downstream by
// the bounded prompt boundary (U8), not by trying to outsmart text here.
const OVERRIDE_PHRASES: readonly RegExp[] = [
  /ignore\s+(all\s+)?(previous|prior|above)/i,
  /disregard\s+(all\s+)?(previous|prior|above)/i,
  /you\s+are\s+now/i,
  /new\s+(system\s+)?instructions\s*:/i,
  /\bsystem\s*prompt\b/i,
];

function truncateAtWordBoundary(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const slice = text.slice(0, maxChars);
  const lastSpace = slice.lastIndexOf(" ");
  return lastSpace > maxChars / 2 ? slice.slice(0, lastSpace) : slice;
}

export function extractDirective(correctionText: string): { text: string } | null {
  if (!correctionText || correctionText.length > DIRECTIVE_RAW_MAX_CHARS) return null;
  const cleaned = correctionText
    .replace(CONTROL_AND_INVISIBLE, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return null;
  if (cleaned.includes("```")) return null;
  if (/<\/?[a-zA-Z][^>]*>/.test(cleaned)) return null;
  for (const phrase of OVERRIDE_PHRASES) {
    if (phrase.test(cleaned)) return null;
  }
  return { text: truncateAtWordBoundary(cleaned, DIRECTIVE_MAX_CHARS) };
}

function dedupeKeyFor(text: string): string {
  return text.toLowerCase().replace(/[\p{P}\p{S}]/gu, "").replace(/\s+/g, " ").trim();
}

export function ingestCorrectionDirective(input: {
  text: string;
  sourceSeq: number;
  sourceCorrelationId: string;
}): BehaviouralDirective | null {
  const extracted = extractDirective(input.text);
  if (!extracted) return null;

  const now = new Date();
  const nowIso = now.toISOString();
  const key = dedupeKeyFor(extracted.text);
  const ttlCutoff = now.getTime() - DIRECTIVE_TTL_DAYS * 24 * 60 * 60 * 1000;

  const existing = findDirectiveByDedupeKey(key);
  if (existing && Date.parse(existing.lastSeenAt) >= ttlCutoff) {
    existing.occurrences += 1;
    existing.corroborations += 1;
    existing.lastSeenAt = nowIso;
    saveDirectives(loadDirectives().map((d) => (d.directiveId === existing.directiveId ? existing : d)));
    return existing;
  }

  const record: BehaviouralDirective = {
    directiveId: randomUUID(),
    text: extracted.text,
    dedupeKey: key,
    sourceSeq: input.sourceSeq,
    sourceCorrelationId: input.sourceCorrelationId,
    createdAt: nowIso,
    lastSeenAt: nowIso,
    occurrences: 1,
    corroborations: 0,
    utility: 0,
    negatives: 0,
    active: true,
  };
  saveDirectives([...loadDirectives(), record]);
  return record;
}

/** verdict +1 → utility, verdict −1 → negatives; suppression checked per bump. */
export function applySignalToDirectives(sourceCorrelationId: string, verdict: 1 | -1): number {
  const directives = loadDirectives();
  let touched = 0;
  const nowIso = new Date().toISOString();
  for (const directive of directives) {
    if (!directive.active || directive.sourceCorrelationId !== sourceCorrelationId) continue;
    if (verdict === 1) directive.utility += 1;
    else directive.negatives += 1;
    directive.lastSeenAt = nowIso;
    touched += 1;
    if (
      directive.negatives >= DIRECTIVE_SUPPRESSION_NEGATIVE_THRESHOLD &&
      directive.negatives > directive.utility
    ) {
      directive.active = false;
      directive.inactiveReason = DIRECTIVE_SUPPRESSED_REASON;
    }
  }
  if (touched > 0) saveDirectives(directives);
  return touched;
}
