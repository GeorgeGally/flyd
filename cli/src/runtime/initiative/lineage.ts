import { createHash } from "node:crypto";
import type { Project } from "../../council/projects.js";
import type { Advisory } from "../../council/advisors.js";
import type { EditionItem } from "../../council/scout.js";

/**
 * Material content, not the day an editor touched a record, determines a
 * source revision. These hashes do not disclose private values or reuse a
 * globally mutable metadata timestamp as a content fingerprint.
 */
export function initiativeContentDigest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 24);
}
export function projectRevision(project: Project): string {
  return initiativeContentDigest({
    name: project.name, what: project.what, kind: project.kind,
    status: project.status, now: project.now, next: project.next,
    due: project.due, repos: project.repos, facts: project.facts,
    people: project.people,
  });
}
export function scoutItemRevision(item: EditionItem): string {
  return initiativeContentDigest({
    title: item.title, url: item.url, why: item.why, topic: item.topic,
    status: item.evidenceStatus, checkedAt: item.evidenceCheckedAt,
    evidenceUrls: item.evidenceUrls, snippets: item.evidenceSnippets,
    confidence: item.confidence,
  });
}
export function councilRevision(advisory: Advisory): string {
  return initiativeContentDigest({
    text: advisory.text, headline: advisory.headline, whyNow: advisory.whyNow,
    evidence: advisory.evidence, confidence: advisory.confidence,
    urgency: advisory.urgency, expires: advisory.expires, status: advisory.status,
  });
}

/** Idempotency identity never includes provisional timestamps. */
export function normalizedQuestionClass(value: string): string {
  return value.toLowerCase().normalize("NFKC").replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}
