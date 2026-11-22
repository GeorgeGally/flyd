import { createHash } from "node:crypto";
import { localDay } from "../../council/memory-store.js";
import { contextScore, workFocusFromProjects } from "../../council/inspiration.js";
import type { Project } from "../../council/projects.js";
import type { Edition } from "../../council/scout.js";
import type { Advisory } from "../../council/advisors.js";
import type { StoredEvent } from "../../intelligence/event-store.js";

/**
 * One bounded insight proposal, NOT a user intention or a work order.
 * The parent sources remain authoritative. This type is a projection, not
 * another ledger of project goals or tasks.
 */
export type InitiativeOrigin = "scout" | "council" | "cos_failure" | "project";
export type InitiativeDomain = "creative" | "product" | "venture" | "client" | "work";
export interface InitiativeSource {
  id: string;
  revision: string;
  /** Only existing local curated operational context or public sources. */
  scope: "local_operational" | "public";
  evidenceRef: string;
}
export interface InitiativeCandidate {
  id: string;
  origin: InitiativeOrigin;
  domain: InitiativeDomain;
  subject: string;
  question: string;
  hypothesis: string;
  counterQuestion: string;
  sources: InitiativeSource[];
  createdAt: string;
  expiresAt: string;
  /** Prior estimates, never fabricated measured outcomes. */
  benefit: number;
  confidence: number;
  novelty: number;
  effort: number;
  urgency: number;
  /** A fast local conclusion that cannot authorize execution. */
  proposedTest: string;
}

const NO_PERSONAL = /(?:\b(?:medical|health|diagnos|pregnan|password|secret|token|ssn|passport|bank account|private message|relationship|family|salary)\b)/i;
const MIN_WORD = 4;
function words(text: string): string[] {
  return [...new Set(text.toLowerCase().match(/[a-z0-9]{4,}/g) ?? [])].filter((word) =>
    !["with", "from", "that", "this", "your", "have", "will", "about", "these", "work", "project", "what", "next"].includes(word));
}
function oneLine(text: string, limit = 170): string {
  return text.replace(/\s+/g, " ").trim().slice(0, limit);
}
export function initiativeKey(origin: InitiativeOrigin, subject: string, question: string): string {
  // Normalize paraphrases and punctuation before hashing stable semantic source.
  const canonical = words(question).sort().join(" ") || question.toLowerCase().trim();
  return createHash("sha256").update([origin, subject.trim().toLowerCase(), canonical].join("\0")).digest("hex").slice(0, 24);
}
export function initiativeRevision(sources: InitiativeSource[]): string {
  return createHash("sha256").update(sources.map((s) => s.id + "@" + s.revision).sort().join("|")).digest("hex").slice(0, 24);
}
function source(id: string, revision: string, scope: InitiativeSource["scope"], evidenceRef: string): InitiativeSource {
  return { id, revision, scope, evidenceRef };
}
export interface InitiativeSignals {
  now: Date;
  projects: Project[];
  edition?: Edition | null;
  advisories?: Advisory[];
  /** Canonical CoS report events, not raw messages from team prompts. */
  reports?: StoredEvent[];
  /** Source permission evaluated against current policy, including revocations. */
  sourceAllowed?: (source: InitiativeSource) => boolean;
}

function isFresh(iso: string, now: Date, days: number): boolean {
  const at = Date.parse(iso);
  return Number.isFinite(at) && at <= now.getTime() + 60_000 && at >= now.getTime() - days * 86_400_000;
}

function ready(candidate: InitiativeCandidate, allowed: (source: InitiativeSource) => boolean, now: Date): boolean {
  return candidate.sources.length > 0
    && candidate.sources.every((s) => allowed(s))
    && candidate.sources.some((s) => s.scope === "local_operational")
    && candidate.sources.every((s) => s.revision && s.evidenceRef)
    && Date.parse(candidate.expiresAt) > now.getTime();
}

/** Source-backed, low-cost independent questions; no model, network or Mac sensing. */
export function deriveInitiatives(input: InitiativeSignals): InitiativeCandidate[] {
  const { now } = input;
  const allowed = input.sourceAllowed ?? (() => true);
  const today = localDay(now);
  const made: InitiativeCandidate[] = [];
  const projects = input.projects.filter((p) => p.status !== "done" && p.status !== "paused"
    && isFresh(p.updated + "T23:59:59", now, 45)
    && !NO_PERSONAL.test([p.name, p.what, p.now].join(" ")));

  // Creative synthesis: one already-curated public Scout reference contrasted
  // with a real active project. Unlike existing creativeCard, asks whether a
  // particular experiment is useful and what would disprove it.
  if (input.edition?.date === today && isFresh(input.edition.generatedAt, now, 2)) {
    const focus = workFocusFromProjects(projects);
    for (const project of projects.filter((p) => p.kind === "creative" || p.kind === "product").slice(0, 5)) {
      const relevant = input.edition.items.map((item) => ({
        item, match: contextScore({ title: item.title, summary: item.why }, focus),
      })).filter(({ item, match }) =>
        match.score >= 5 && item.url.startsWith("https://")
        && !NO_PERSONAL.test(item.title)
        && (words(item.title + " " + item.why).filter(w => words(project.name + " " + project.what).includes(w)).length >= 1)
      ).sort((a, b) => b.match.score - a.match.score).slice(0, 1);
      for (const { item } of relevant) {
        const sources = [
          source("project:" + project.id, project.updated, "local_operational", "project:" + project.id),
          source("scout:" + (item.storyId ?? item.url), input.edition.generatedAt, "public", item.url),
        ];
        const question = "Would " + oneLine(item.title, 70) + " improve " + oneLine(project.name, 60) + "?";
        made.push({
          id: initiativeKey("scout", project.id, question),
          origin: "scout", domain: project.kind, subject: project.name,
          question, hypothesis: "This reference may suggest a useful, specific design or implementation experiment.",
          counterQuestion: "Is the apparent connection superficial or already part of the project's current work?",
          proposedTest: "Compare the reference's documented technique with the project's stated constraints before proposing a prototype.",
          sources, createdAt: now.toISOString(),
          expiresAt: new Date(now.getTime() + 36 * 60 * 60_000).toISOString(),
          benefit: 0.6, confidence: 0.55, novelty: 0.8, effort: 0.25, urgency: 0.2,
        });
      }
    }
  }

  // Council already has evidence-backed, dated critical thinking. Only a
  // question about improving evidence is made here; Council still owns
  // advisory display, so this never creates a second notification.
  for (const advisory of (input.advisories ?? []).slice(0, 12)) {
    if (advisory.status !== "open" || advisory.confidence === "low" || advisory.evidence.length === 0
      || Date.parse(advisory.expires) < Date.parse(today)
      || !isFresh(advisory.createdAt, now, 14) || NO_PERSONAL.test(advisory.text)) continue;
    const sources = [source("council:" + advisory.id, advisory.createdAt, "local_operational", "advisory:" + advisory.id)];
    made.push({
      id: initiativeKey("council", advisory.id, advisory.text),
      origin: "council", domain: "work", subject: oneLine(advisory.headline || advisory.text, 75),
      question: "What evidence would confirm or disprove this concern: " + oneLine(advisory.text, 130) + "?",
      hypothesis: oneLine(advisory.text), counterQuestion: "Could the supporting observation be stale or misleading?",
      proposedTest: "Verify source claims and identify the smallest low-risk next check; do not treat the advice as a fact.",
      sources, createdAt: now.toISOString(),
      expiresAt: new Date(Math.min(Date.parse(advisory.expires + "T23:59:59"), now.getTime() + 7 * 86_400_000)).toISOString(),
      benefit: advisory.urgency === "high" ? 0.85 : 0.65,
      confidence: advisory.confidence === "high" ? 0.78 : 0.6,
      novelty: 0.45, effort: 0.25, urgency: advisory.urgency === "high" ? 0.85 : 0.45,
    });
  }

  // Two distinct accepted objectives failing for similar reasons can reveal
  // a shared problem. Never issue a new CoS objective from this observation.
  const failures = (input.reports ?? []).flatMap((event) => {
    if (event.erased || event.kind !== "observation" || event.sourceId !== "cos.report") return [];
    const report = event.payload?.report as { kind?: string; outcome?: string; objectiveId?: string } | undefined;
    return report?.kind === "blocked" && report.objectiveId && report.outcome
      ? [{ event, report, tokens: words(report.outcome) }] : [];
  }).filter(x => x.tokens.length >= MIN_WORD);
  for (const [i, first] of failures.entries()) {
    const second = failures.slice(i + 1).find((other) =>
      other.report.objectiveId !== first.report.objectiveId
      && first.tokens.filter((w) => other.tokens.includes(w)).length >= 3);
    if (!second) continue;
    const refs = [first.event, second.event];
    const sources = refs.map((e) => source("cos:" + e.id, String(e.sequence), "local_operational", "event:" + e.id));
    const question = "Are these recurring blocked outcomes symptoms of one underlying dependency?";
    made.push({
      id: initiativeKey("cos_failure", first.tokens.slice(0, 5).sort().join(" "), question),
      origin: "cos_failure", domain: "work", subject: "Repeated blocked work",
      question, hypothesis: "Two separate CoS objectives encountered possibly related obstacles.",
      counterQuestion: "Are they independent problems that only happen to share words?",
      proposedTest: "Compare both failure receipts, check common causes, and leave CoS's existing objectives untouched.",
      sources, createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + 3 * 86_400_000).toISOString(),
      benefit: 0.75, confidence: 0.55, novelty: 0.55, effort: 0.2, urgency: 0.6,
    });
  }
  // No independent personal sensing, no personal details sent to any model.
  // Semantic duplicates from different producers share one candidate key.
  return [...new Map(made.filter((candidate) => ready(candidate, allowed, now))
    .map((candidate) => [candidate.id, candidate])).values()].slice(0, 20);
}
