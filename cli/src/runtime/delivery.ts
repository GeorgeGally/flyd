import { listDomainRuns } from "../command/store.js";
import type { DomainResult, DomainRun } from "../command/types.js";
import { notificationLine, sentencesOf } from "../council/chief-of-staff.js";
import { ASKS_HIM, fitsAtAGlance, LINE_CHARS, MAX_CHARS, MAX_LINES } from "../conversation-view/for-george.js";
import { replyArtefact } from "../conversation-view/summaries.js";
import type { ExecutiveDecisionRecord } from "../intelligence/executive/decision-step.js";
import { relayShortfalls } from "./honesty-check.js";

// Delivery: how anything that came back reaches George. One report per piece
// of work, one shape for it, and one lead line he reads first, whichever
// surface says it (docs/plans/2026-10-30-flyd-chief-of-staff-split-plan.md,
// Delivery standard). The rules here are deterministic and pure; the
// surfaces (notifications, the conversation window, the next chat turn) call
// `deliver` and never compose their own words for a finished report.

/** The forms a report takes. Words are the fallback whenever a shape's artefact is missing. */
export const DELIVERY_SHAPES = ["picture", "decision", "steps", "document", "landed", "words"] as const;
export type DeliveryShape = typeof DELIVERY_SHAPES[number];

/** What reaches George, and nothing else: SOUL's list as report kinds. */
export type ReportKind = "done" | "decision" | "blocked" | "credential" | "irreversible";

/** One report per piece of work. The outcome is the lead; detail and evidence wait behind "more". */
export interface Report {
  /** Stable across restarts and surfaces: the delivery log keys on it. */
  id: string;
  kind: ReportKind;
  /** L0: one line, outcome first. */
  outcome: string;
  /** L1: what matters and why, only what changes what he does next. */
  detail: string;
  recommendation?: string;
  options?: string[];
  /** L2: where the full result lives. */
  evidenceRefs: string[];
  shape: DeliveryShape;
  /** Screenshots, lab pages, dossiers or links the shape needs. */
  artefacts: string[];
  /** For a steps shape: the items, in order. */
  steps?: string[];
  /** For landed work: the change itself. */
  link?: string;
  /** For a long report: the whole of it, behind the lead. */
  document?: string;
  /** The work, in his words, for batching and for a lead that cannot be used as written. */
  work?: string;
  urgency: "now" | "today" | "whenever";
}

/** Where a report is said. */
export type DeliverySurface = "notification" | "window";

export interface Delivered {
  /** What he sees first on this surface; null when nothing fit to show is left (the report is held). */
  text: string | null;
  shape: DeliveryShape;
  /** The lead line alone. */
  lead: string | null;
  artefacts: string[];
  options?: string[];
  steps?: string[];
  link?: string;
  /** Why it was held, when it was. */
  held?: string[];
}

/** Lists longer than this are steps to open, not lines to read. */
export const STEPS_OVER = 3;

const IMAGE = /\.(?:png|jpe?g|webp|gif|avif|svg)(?:[?#].*)?$/i;
const CHANGE_LINK = /https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/(?:pull\/\d+|commit\/[0-9a-f]{7,40})\b/i;
const ANY_LINK = /https?:\/\/[^\s<>()\]]+[^\s<>()\].,;:!?'"”’]/;
const LANDED = /\b(?:merged|landed|shipped|is (?:now )?live|now live|went live|deployed|released)\b/i;
const NOT_YET = /\b(?:will|once|when|after|until|unless|not|isn['’]?t|hasn['’]?t|yet|ready to|waiting)\b/i;
/** A file path shown as text, an address aside. */
const PATH = /(?:^|[\s(:;])(?:~|\.{1,2})?\/?[\w.-]+\/[\w./-]*[\w-]\.(?:md|tsx?|jsx?|json|html?|txt|log|ya?ml|sh|swift|sqlite)\b/i;
/** Lowercase hyphenated words: a task or run slug when it carries a digit and is mostly words. */
const HYPHENATED = /\b[a-z0-9]+(?:-[a-z0-9]+){2,}\b/g;
/** Talking about him rather than to him. */
const ABOUT_HIM = /\bGeorge(?:['’]s)?\b/;
/** The review and fleet words the staff use among themselves. */
const STAFF_WORDS = /\b(?:ask-user|parked at|review gate|no-mistakes|worker|handoff|fleet)\b|\bfinding\(s\)/i;

/** A task or run slug ("cap5-dash-lab-r5-calls"), never a date, a phone number or a model name. Pure. */
function showsTaskId(text: string): boolean {
  return (text.match(HYPHENATED) ?? []).some((token) => /\d/.test(token) && token.split("-").filter((part) => /^[a-z]+$/.test(part)).length >= 3);
}

/** The images among a run's artefacts. */
function imagesOf(artefacts: string[]): string[] {
  return artefacts.filter((artefact) => IMAGE.test(artefact));
}

/** Items a text lists, numbered or bulleted, on their own lines or run together ("1) … 2) …"). */
export function listedItems(text: string): string[] {
  const listed = replyArtefact(text)?.artefact.steps ?? [];
  if (listed.length) return listed;
  const inline = text.split(/\s(?=\d+[.)]\s)/).slice(1).map((item) => item.replace(/^\d+[.)]\s*/, "").replace(/[,;]?\s*$/, "").trim()).filter(Boolean);
  return inline.length > 1 ? inline : [];
}

/**
 * The shape the Delivery standard requires, deterministic rules first, in the
 * table's order: visual work, a choice only he can make, a long list, a long
 * report, code that landed, and words for everything else. A failure is
 * words: one plain sentence on what happened and what Flyd is doing. Pure.
 */
export function chooseShape(input: {
  kind: ReportKind;
  outcome: string;
  options?: string[];
  artefacts: string[];
  steps?: string[];
  link?: string;
  document?: string;
}): DeliveryShape {
  if (input.kind !== "blocked" && imagesOf(input.artefacts).length) return "picture";
  if (input.kind === "decision" || input.kind === "irreversible" || input.kind === "credential") return "decision";
  if (input.kind === "blocked") return "words";
  if ((input.steps?.length ?? 0) > STEPS_OVER) return "steps";
  if (input.document && input.document.length > LINE_CHARS * MAX_LINES) return "document";
  // Landed, said as done: "merged", not "will merge once green".
  if (input.link && CHANGE_LINK.test(input.link) && LANDED.test(input.outcome) && !NOT_YET.test(input.outcome.slice(0, input.outcome.search(LANDED)))) return "landed";
  return "words";
}

/** The shape this report can actually be shown in: a shape whose artefact is missing falls back to words. Pure. */
export function shownShape(report: Report): DeliveryShape {
  switch (report.shape) {
    case "picture": return imagesOf(report.artefacts).length ? "picture" : "words";
    case "decision": return (report.options?.length ?? 0) >= 2 || report.recommendation ? "decision" : "words";
    case "steps": return (report.steps?.length ?? 0) > STEPS_OVER ? "steps" : "words";
    case "document": return report.document ? "document" : "words";
    case "landed": return report.link ? "landed" : "words";
    case "words": return "words";
  }
}

/** One line he reads first: at most 120 characters, outcome first, no address or preamble; the window keeps its links. Pure. */
export function leadLine(text: string, surface: DeliverySurface = "window"): string {
  return text.trim() ? notificationLine(text, LINE_CHARS, surface === "window") : "";
}

/** Why a line is not fit to show him, if it is not: backstage names, paths, ids, staff words, talk about him. Pure. */
export function unfitForHim(line: string): string[] {
  const bare = line.replace(/https?:\/\/\S+/g, "");
  return [
    ...relayShortfalls(line).map((shortfall) => shortfall.reason),
    ...(PATH.test(bare) ? ["It shows a path."] : []),
    ...(showsTaskId(bare) ? ["It shows a task id."] : []),
    ...(STAFF_WORDS.test(bare) ? ["It uses the staff's words."] : []),
    ...(ABOUT_HIM.test(bare) ? ["It talks about him, not to him."] : []),
  ];
}

/** The lines after the lead: at most two, each a short line, only those that are fit to show; a line that asks him is never hidden. Pure. */
function detailLines(report: Report, lead: string): string[] {
  // What the first line already says, the landed link included, is never said again (leadLine capitalises, so compare without case).
  const said = `${lead} ${report.link ?? ""}`.toLowerCase();
  const candidates = [...(report.recommendation ? [report.recommendation] : []), ...proseOf(report.detail)];
  const fit = (line: string) => line && !said.includes(line.toLowerCase()) && unfitForHim(line).length === 0;
  // A line that had to be cut is left for "more", never shown half-said.
  const lines = [...new Set(candidates.map((line) => leadLine(line)).filter((line) => fit(line) && !line.endsWith("…")))].slice(0, MAX_LINES - 1);
  // What waits on him takes the last line whole, as condense keeps it, cut only past what the lead leaves of the glance.
  const ask = candidates.map((line) => notificationLine(line, Math.max(80, MAX_CHARS - lead.length - 1), true)).find((line) => fit(line) && ASKS_HIM.test(line));
  if (ask && !lines.includes(ask)) lines.splice(Math.min(lines.length, MAX_LINES - 2), lines.length, ask);
  return lines;
}

/**
 * A report as one surface says it. A notification carries the lead line only;
 * the window the lead, at most two more lines and the artefact; the next
 * chat turn carries the line he was sent. A lead that is not fit to show him falls
 * back to the work's own name, and with neither the report is held. Pure.
 */
export function deliver(report: Report, surface: DeliverySurface): Delivered {
  const shape = shownShape(report);
  const extras = {
    artefacts: shape === "picture" ? imagesOf(report.artefacts) : report.artefacts,
    ...(shape === "decision" && report.options?.length ? { options: report.options } : {}),
    ...(shape === "steps" && report.steps ? { steps: report.steps } : {}),
    ...(report.link ? { link: report.link } : {}),
  };
  const written = leadLine(report.outcome, surface);
  const reasons = unfitForHim(written);
  // Finished work, or his call, whose own words are not fit to show is told by its name; a report that says nothing is held.
  const work = report.work?.replace(/[.\s]+$/, "") ?? "";
  const fallback = !written || !work ? "" : report.kind === "done" ? `Done: ${notificationLine(`${work}.`, LINE_CHARS - "Done: ".length)}` : report.kind === "decision" ? `Your call is needed: ${notificationLine(`${work}.`, LINE_CHARS - "Your call is needed: ".length)}` : "";
  const lead = reasons.length === 0 && written ? written : fallback && unfitForHim(fallback).length === 0 ? fallback : "";
  if (!lead) return { text: null, lead: null, shape, ...extras, held: reasons.length ? reasons : ["It says nothing."] };
  if (surface === "notification") return { text: lead, lead, shape, ...extras };
  const link = report.link && !lead.includes(report.link) ? report.link : "";
  const lines = detailLines(report, lead);
  const text = [shape === "landed" && link ? `${lead} ${link}` : lead, ...lines].join("\n");
  return { text, lead, shape, ...extras };
}

const EMPTY: DomainResult = {
  format: "raw", brief: "", detailedReport: "", decisionsMade: [], unresolvedQuestions: [], risks: [],
  evidence: [], artifacts: [], specialistOutputs: [], raw: [], informationLossRisk: "low",
};

/** A text's prose sentences: fenced code and table rows wait behind "more". Pure. */
function proseOf(text: string): string[] {
  return sentencesOf(text.replace(/```[\s\S]*?```/g, "\n").split("\n").filter((line) => !line.trim().startsWith("|")).join("\n"));
}

/** Lines said twice in one question (a staff question repeated seven times) said once. Pure. */
export function saidOnce(text: string): string {
  const seen = new Set<string>();
  return proseOf(text).filter((sentence) => {
    const key = sentence.trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).join(" ");
}

/**
 * A finished run, with the review step's decision when there is one, as one
 * report. Works without a decision, so runs the review step skips still get a
 * shaped delivery. Pure.
 */
export function reportFromRun(run: DomainRun, decision?: ExecutiveDecisionRecord | null): Report {
  const result = run.result ?? EMPTY;
  // With the review step's decision, its disposition says whether the call is still his; a settled call is told as settled.
  const asks = decision ? decision.disposition === "ask_george" : run.status === "needs_decision";
  const kind: ReportKind = asks ? "decision" : run.status === "failed" ? "blocked" : "done";
  const question = decision ? (decision.disposition === "ask_george" ? decision.question : "") : result.unresolvedQuestions[0] ?? "";
  const recommendation = decision?.disposition === "ask_george" && decision.recommendation
    ? (decision.recommendation.option ? `I'd go with ${decision.recommendation.option}: ${decision.recommendation.rationale}` : decision.recommendation.rationale)
    : result.recommendation ? [result.recommendation.action, result.recommendation.reasoning].filter(Boolean).join(": ") : undefined;
  const options = decision?.disposition === "ask_george" && decision.options.length ? decision.options : undefined;
  const brief = saidOnce(result.brief || run.failure || "");
  // With the review step's decision, its reading is what he is told, never the staff's own brief.
  const reading = decision ? decision.summary : brief;
  const outcome = saidOnce(kind === "decision" ? question || reading : reading);
  const artefacts = [...new Set([...result.artifacts, ...result.specialistOutputs.flatMap((output) => output.artifacts ?? [])])];
  const linkFrom = [...artefacts, ...result.evidence, result.brief].join(" ");
  const link = linkFrom.match(CHANGE_LINK)?.[0] || (kind === "done" ? linkFrom.match(ANY_LINK)?.[0] : undefined) || undefined;
  const steps = listedItems(result.brief);
  const document = result.detailedReport.trim() && `${result.brief}\n\n${result.detailedReport}`.length > LINE_CHARS * MAX_LINES * 2 ? `${result.brief}\n\n${result.detailedReport}`.trim() : undefined;
  // The staff's brief adds to the lead only when no review step read it: its words are then all there is.
  const detail = kind !== "done" || decision || brief === outcome ? "" : brief;
  const shape = chooseShape({ kind, outcome, ...(options ? { options } : {}), artefacts, steps, ...(link ? { link } : {}), ...(document ? { document } : {}) });
  return {
    id: `work:${run.id}`,
    kind,
    outcome,
    detail,
    ...(recommendation ? { recommendation } : {}),
    ...(options ? { options } : {}),
    evidenceRefs: [`domain-run:${run.id}`, ...(decision?.evidenceRefs ?? [])],
    shape,
    artefacts,
    ...(steps.length ? { steps } : {}),
    ...(link ? { link } : {}),
    ...(document ? { document } : {}),
    // Only finished work may be told by its name as done; anything else unfit to show is held.
    ...(kind !== "done" || run.status === "completed" ? { work: run.request.intendedOutcome } : {}),
    urgency: kind === "decision" ? "now" : "today",
  };
}

/**
 * A staff reply under his message, as Flyd read it: Flyd's reading is the
 * outcome, and the reply itself decides the shape (its link, its list, its
 * options). Pure.
 */
export function reportFromReply(input: { id: string; reading: string; reply: string; options?: string[]; shots?: string[] }): Report {
  const steps = listedItems(input.reply);
  const link = input.reply.match(CHANGE_LINK)?.[0];
  const options = input.options?.length ? input.options : undefined;
  const kind: ReportKind = options ? "decision" : "done";
  const sentences = proseOf(input.reading);
  // The reading's first sentence fit to show him leads; the rest wait behind it.
  const lead = Math.max(0, sentences.findIndex((sentence) => unfitForHim(leadLine(sentence)).length === 0));
  const outcome = sentences[lead] ?? "";
  const artefacts = [...(input.shots ?? [])];
  const document = input.reply.length > LINE_CHARS * MAX_LINES * 3 ? input.reply : undefined;
  const shape = chooseShape({ kind, outcome: input.reading, ...(options ? { options } : {}), artefacts, steps, ...(link ? { link } : {}), ...(document ? { document } : {}) });
  return {
    id: input.id,
    kind,
    outcome,
    detail: sentences.filter((_, at) => at !== lead).join("\n"),
    ...(options ? { options } : {}),
    evidenceRefs: [],
    shape,
    artefacts,
    ...(steps.length ? { steps } : {}),
    ...(link ? { link } : {}),
    ...(document ? { document } : {}),
    urgency: "today",
  };
}

/** Flyd's own answer, held to the lead-line rule: whole when it already fits, else its lead and two lines. Pure. */
export function answerLead(answer: string): string | null {
  const shown = answer.trim();
  if (!shown) return null;
  const firstLine = (shown.split("\n").find((line) => line.trim()) ?? "").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").trim();
  if (fitsAtAGlance(shown) && firstLine.length <= LINE_CHARS) return null;
  const sentences = proseOf(shown);
  if (!sentences.length) return null;
  // His own answer passed the turn's checks already: when no line fits, its first line still leads.
  return deliver({ id: "answer", kind: "done", outcome: sentences[0]!, detail: sentences.slice(1).join("\n"), evidenceRefs: [], shape: "words", artefacts: [], urgency: "now" }, "window").text ?? (leadLine(shown) || null);
}

/** Finished work the next turn carries, newest first, and how far back it reaches. */
export const CONTEXT_REPORTS = 5;
export const CONTEXT_HOURS = 48;

/**
 * Work that came back lately, each as the line he was actually sent, for
 * the next chat turn: so "what did it say?" is answered without a tool call.
 * Only work he was actually told about is in it: Flyd's own notes to the staff,
 * its own fixes, and runs settled quietly or held are backstage.
 */
export function deliveredPromptBlock(now = new Date(), runs: DomainRun[] = listDomainRuns()): string {
  const since = now.getTime() - CONTEXT_HOURS * 3_600_000;
  const lines = runs
    .filter((run) => run.notified && run.told?.line && ["completed", "failed", "needs_decision"].includes(run.status)
      && run.request.source !== "flyd" && run.request.source !== "self-improvement" && Date.parse(run.updatedAt) >= since)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, CONTEXT_REPORTS)
    .map((run) => `- ${run.told!.line}`);
  if (!lines.length) return "";
  return ["", "## Work that came back lately (newest first)", ...lines, "When he asks what came back or what it said, answer from this. The full report is in domain_work.", ""].join("\n");
}
