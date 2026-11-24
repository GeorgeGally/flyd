import { createHash } from "node:crypto";
import { localDay } from "../../council/memory-store.js";
import { contextScore, workFocusFromProjects } from "../../council/inspiration.js";
import type { Project } from "../../council/projects.js";
import type { Edition } from "../../council/scout.js";
import type { Advisory } from "../../council/advisors.js";
import type { StoredEvent } from "../../intelligence/event-store.js";
import { projectRevision, scoutItemRevision, councilRevision } from "./lineage.js";

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
  /** Bounded source observations; not evidence of the hypothesized effect. */
  observed: string[];
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
const GENERIC_STORY = new Set(["design", "archive", "article", "story", "guide", "examples", "latest", "update", "visual", "creative", "generative"]);
function words(text: string): string[] {
  return [...new Set(text.toLowerCase().match(/[a-z0-9]{4,}/g) ?? [])].filter((word) =>
    !["with", "from", "that", "this", "your", "have", "will", "about", "these", "work", "project", "what", "next"].includes(word));
}
function oneLine(text: string, limit = 170): string {
  return text.replace(/[<>\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, limit);
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
    && Number.isFinite(Date.parse(p.updated + "T00:00:00"))
    && Date.parse(p.updated + "T00:00:00") <= now.getTime() + 86_400_000
    && Date.parse(p.updated + "T00:00:00") >= now.getTime() - 45 * 86_400_000
    && !NO_PERSONAL.test([p.name, p.what, p.now].join(" ")));

  // Creative synthesis: one already-curated public Scout reference contrasted
  // with a real active project. Unlike existing creativeCard, asks whether a
  // particular experiment is useful and what would disprove it.
  if (input.edition?.date === today && isFresh(input.edition.generatedAt, now, 2)) {
    const focus = workFocusFromProjects(projects);
    for (const project of projects.filter((p) => p.kind === "creative" || p.kind === "product").slice(0, 5)) {
      const currentTerms = new Set(words([project.name, project.what, project.now, project.next ?? ""].join(" ")));
      const relevant = input.edition.items.map((item) => ({
        item, match: contextScore({ title: item.title, summary: item.why }, focus),
        novel: words(item.title + " " + item.why).filter(w => !currentTerms.has(w) && !GENERIC_STORY.has(w)),
      })).filter(({ item, match, novel }) =>
        match.score >= 5 && item.url.startsWith("https://")
        && !NO_PERSONAL.test(item.title + " " + item.why)
        && novel.length > 0
        && words(item.title + " " + item.why).some(w => currentTerms.has(w))
      ).sort((a, b) => b.match.score - a.match.score).slice(0, 1);
      for (const { item, novel } of relevant) {
        const sources = [
          source("project:" + project.id, projectRevision(project), "local_operational", "project:" + project.id),
          source("scout:" + (item.storyId ?? item.url), scoutItemRevision(item), "public", item.url),
        ];
        const technique = novel.slice(0, 2).join(" ");
        const question = "Could " + technique + " from " + oneLine(item.title, 64) + " help " + oneLine(project.name, 48) + "?";
        made.push({
          id: initiativeKey("scout", project.id, question),
          origin: "scout", domain: project.kind === "creative" ? "creative" : "product", subject: project.name,
          question, hypothesis: "This reference may suggest a specific, distinct creative or technical experiment.",
          counterQuestion: "Is this a genuinely different technique or the same approach under another name?",
          proposedTest: "Compare the public " + technique + " example with the current " + oneLine(project.name, 55) + " implementation; suggest a small reversible sketch only if the difference is real.",
          observed: ["Curated project: " + oneLine(project.what + " " + project.now, 200), "Public Scout reference: " + oneLine(item.title + " — " + item.why, 200)],
          sources, createdAt: now.toISOString(),
          expiresAt: new Date(now.getTime() + 36 * 60 * 60_000).toISOString(),
          benefit: 0.6, confidence: 0.55, novelty: 0.8, effort: 0.25, urgency: 0.2,
        });
      }
    }
  }

  // A recorded near-term deadline and a project explicitly marked waiting
  // can form a specific independent question without Calendar, email, or
  // inferring a missing commitment. One source = private investigation only.
  for (const project of projects.filter(p => p.status === "waiting" && p.due && p.next)) {
    const at = Date.parse(project.due! + "T00:00:00");
    const delta = Math.floor((at - now.getTime()) / 86_400_000);
    if (!Number.isFinite(at) || delta < -3 || delta > 14 || NO_PERSONAL.test(project.next ?? "")) continue;
    const question = "Does " + oneLine(project.name, 55) + " have what it needs for " + oneLine(project.next!, 75) + " before " + project.due + "?";
    const sources = [source("project:" + project.id, projectRevision(project), "local_operational", "project:" + project.id)];
    made.push({
      id: initiativeKey("project", project.id, question), origin: "project",
      domain: project.kind === "venture" ? "venture" : project.kind === "client" ? "client" : "work",
      subject: project.name, question,
      hypothesis: "The next recorded step may be blocked before an explicitly dated milestone.",
      counterQuestion: "Is the waiting state still accurate, or has the dependency already cleared?",
      proposedTest: "Check current objective and dependency evidence; only report a risk if the recorded waiting state is still confirmed.",
      observed: ["Project status: waiting", "Recorded next step: " + oneLine(project.next!, 170), "Recorded due date: " + project.due],
      sources, createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + 2 * 86_400_000).toISOString(),
      benefit: 0.72, confidence: 0.8, novelty: 0.2, effort: 0.15, urgency: 0.75,
    });
  }

  // Council already has evidence-backed, dated critical thinking. Only a
  // question about improving evidence is made here; Council still owns
  // advisory display, so this never creates a second notification.
  for (const advisory of (input.advisories ?? []).slice(0, 12)) {
    if (advisory.status !== "open" || advisory.confidence === "low" || advisory.evidence.length === 0
      || Date.parse(advisory.expires) < Date.parse(today)
      || !isFresh(advisory.createdAt, now, 14) || NO_PERSONAL.test(advisory.text)) continue;
    const sources = [source("council:" + advisory.id, councilRevision(advisory), "local_operational", "advisory:" + advisory.id)];
    made.push({
      id: initiativeKey("council", advisory.id, advisory.text),
      origin: "council", domain: "work", subject: oneLine(advisory.headline || advisory.text, 75),
      question: "What evidence would confirm or disprove this concern: " + oneLine(advisory.text, 130) + "?",
      hypothesis: oneLine(advisory.text), counterQuestion: "Could the supporting observation be stale or misleading?",
      proposedTest: "Verify source claims and identify the smallest low-risk next check; do not treat the advice as a fact.",
      sources, observed: ["Council advisory (not independently verified): " + oneLine(advisory.text, 200)], createdAt: now.toISOString(),
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
      && isFresh(event.capturedAt, now, 30) && !NO_PERSONAL.test(report.outcome)
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
      sources, observed: refs.map(e => "Recorded blocked outcome: " + oneLine(String((e.payload?.report as { outcome?: string } | undefined)?.outcome ?? ""), 180)),
      createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + 3 * 86_400_000).toISOString(),
      benefit: 0.75, confidence: 0.55, novelty: 0.55, effort: 0.2, urgency: 0.6,
    });
  }
  // No independent personal sensing, no personal details sent to any model.
  // Semantic duplicates from different producers share one candidate key.
  return [...new Map(made.filter((candidate) => ready(candidate, allowed, now))
    .map((candidate) => [candidate.id, candidate])).values()].slice(0, 20);
}
