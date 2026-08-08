import type { CommitmentKind, EntityRef } from "./types.js";
import { commitmentStore } from "./commitment-store.js";

const EXPLICIT_PROMISE = /\b(i|I|we|We)\s+(will|promise|plan\s+to|shall|am\s+going\s+to)\s+(.+?)(\s+by\s+(.+?))?(\s|$)/i;
const EXPLICIT_REMINDER = /\b(remind\s+(me|us)\s+(to|about)|don'?t\s+forget\s+(to|about))\s+(.+?)(\s+by\s+(.+?))?(\s|$)/i;
const DEADLINE_PATTERN = /\b(due|deadline|by\s+(tomorrow|next\s+\w+|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|\d{4}-\d{2}-\d{2}))\b/i;

function parseRelativeDate(text: string): string | undefined {
  const now = new Date();

  if (/\btomorrow\b/i.test(text)) {
    now.setDate(now.getDate() + 1);
    return now.toISOString();
  }
  if (/\bnext\s+week\b/i.test(text)) {
    now.setDate(now.getDate() + 7);
    return now.toISOString();
  }
  if (/\btoday\b/i.test(text)) {
    return now.toISOString();
  }

  const isoMatch = text.match(/\d{4}-\d{2}-\d{2}/);
  if (isoMatch) return new Date(isoMatch[0]).toISOString();

  return undefined;
}

function estimateConfidence(text: string): number {
  const highConfidence = /\b(definitely|sure|absolutely|certainly|must|have to|need to)\b/i;
  const lowConfidence = /\b(maybe|perhaps|possibly|might|could|consider|think about|sometime)\b/i;

  if (highConfidence.test(text)) return 0.9;
  if (lowConfidence.test(text)) return 0.3;
  return 0.6;
}

function classifyKind(text: string): CommitmentKind {
  if (/\b(will|promise|plan\s+to|shall)\b/i.test(text)) return "promise";
  if (/\b(remind|don'?t\s+forget|remember\s+to)\b/i.test(text)) return "follow_up";
  if (/\b(delegate|agent|spawn|background)\b/i.test(text)) return "delegation";
  if (DEADLINE_PATTERN.test(text)) return "deadline";
  if (/\b(request|ask|need\s+from|waiting\s+on)\b/i.test(text)) return "request";
  if (/\b(payment|pay|invoice|bill|charge)\b/i.test(text)) return "payment";
  return "follow_up";
}

export interface ExtractedCommitment {
  title: string;
  kind: CommitmentKind;
  dueAt?: string;
  confidence: number;
  text: string;
}

export function extractCommitmentsFromText(text: string): ExtractedCommitment[] {
  const results: ExtractedCommitment[] = [];

  for (const pattern of [EXPLICIT_PROMISE, EXPLICIT_REMINDER]) {
    const match = pattern.exec(text);
    if (match) {
      const what = match[3]?.trim();
      const when = match[5]?.trim();
      if (what) {
        results.push({
          title: what,
          kind: classifyKind(what),
          dueAt: when ? parseRelativeDate(when) : undefined,
          confidence: estimateConfidence(text),
          text,
        });
      }
    }
  }

  return results;
}

export interface CommitmentExtractionResult {
  created: string[];
  updated: string[];
}

export function extractAndPersistCommitments(
  text: string,
  source: string,
  owner?: EntityRef,
  project?: EntityRef,
): CommitmentExtractionResult {
  const extracted = extractCommitmentsFromText(text);
  const result: CommitmentExtractionResult = { created: [], updated: [] };

  for (const ext of extracted) {
    const existing = commitmentStore.list().filter((c) => {
      const similarity = titleSimilarity(c.title, ext.title);
      return similarity > 0.6 && c.status !== "done" && c.status !== "cancelled";
    });

    if (existing.length > 0) {
      for (const match of existing) {
        const updated = commitmentStore.update(match.id, {
          confidence: Math.min(1, (match.confidence + ext.confidence) / 2),
          lastVerifiedAt: new Date().toISOString(),
        });
        if (updated) result.updated.push(updated.id);
      }
    } else {
      const created = commitmentStore.create({
        kind: ext.kind,
        title: ext.title,
        owner,
        project,
        dueAt: ext.dueAt,
        status: ext.confidence >= 0.7 ? "open" : "proposed",
        confidence: ext.confidence,
        sourceEvidence: [{
          sourceId: `text-extraction-${Date.now()}`,
          sourceKind: source,
          description: `Extracted from: "${ext.text.slice(0, 120)}"`,
          observedAt: new Date().toISOString(),
        }],
      });
      result.created.push(created.id);
    }
  }

  return result;
}

function titleSimilarity(a: string, b: string): number {
  const wordsA = new Set(a.toLowerCase().split(/\s+/).filter((w) => w.length > 2));
  const wordsB = new Set(b.toLowerCase().split(/\s+/).filter((w) => w.length > 2));
  if (wordsA.size === 0 || wordsB.size === 0) return 0;
  let intersection = 0;
  for (const w of wordsA) {
    if (wordsB.has(w)) intersection++;
  }
  return intersection / Math.max(wordsA.size, wordsB.size);
}
