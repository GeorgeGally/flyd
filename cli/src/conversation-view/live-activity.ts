import type { Job } from "./jobs.js";
import type { HoldDecision } from "./artefact.js";
import { needsGeorge, type SemanticObject } from "./semantic.js";
import type { ShowItem, ShowLink, ShowPreview, ShowScreen, ShowShot } from "./show.js";

/**
 * The notch: what is running, what needs George and what landed, in one model
 * the island and its sheet both read, so a count can never disagree with the
 * list under it. Built from what the screen already decided to show. Pure.
 */

export type LiveState = "running" | "paused" | "call" | "ready" | "landed";

export interface LiveItem {
  id: string;
  state: LiveState;
  title: string;
  project?: string;
  task?: string;
  /** When it last moved, or when it was asked. */
  at?: string;
  /** When its worker started. */
  since?: string;
  /** Where it stands, in one line. */
  step?: string;
  shots: ShowShot[];
  previews: ShowPreview[];
  links: ShowLink[];
  decision?: { task: string; decisionId?: string; question: string; choices: string[]; replyTo?: string; recommended?: string; decisions?: HoldDecision[] };
  /** A finished piece of work's own word: "Ready to land", "Report ready". */
  status?: string;
}

export interface LiveActivity {
  /** False until the fleet has been read: nothing here may read as calm before that. */
  known: boolean;
  counts: { running: number; needs: number };
  running: LiveItem[];
  paused: LiveItem[];
  /** Asked in the last week, newest first. */
  needs: LiveItem[];
  /** Asked before that, newest first. */
  older: LiveItem[];
  landed: LiveItem[];
}

/** Older asks fold away; they still count. */
const RECENT_MS = 7 * 24 * 60 * 60 * 1000;
const LANDED_SHOWN = 4;

/** A day written without a time is that whole day, not an instant. */
function timeOf(at: string | undefined): number {
  if (!at) return Number.NaN;
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(at);
  return day ? new Date(Number(day[1]), Number(day[2]) - 1, Number(day[3])).getTime() : Date.parse(at);
}

function newestFirst(a: LiveItem, b: LiveItem): number {
  return (timeOf(b.at) || 0) - (timeOf(a.at) || 0);
}

function fromItem(item: ShowItem, state: LiveState): LiveItem {
  const ready = state === "ready";
  return {
    id: item.id,
    state,
    title: item.headline.replace(/^earlier report:\s*/i, ""),
    ...(item.project ? { project: item.project } : {}),
    ...(item.task ? { task: item.task } : {}),
    ...(item.at ? { at: item.at } : {}),
    ...(item.started ? { since: item.started } : {}),
    // "A worker is on it" says nothing the Running list has not.
    ...(item.detail && !/^a worker is on it\b/i.test(item.detail) ? { step: item.detail } : {}),
    shots: item.shots ?? [],
    previews: item.previews ?? [],
    links: (item.links ?? []).filter((link) => !link.closed),
    ...(item.decision ? { decision: item.decision } : {}),
    ...(ready ? { status: item.status === "report available" ? "Report ready" : "Ready to land" } : {}),
  };
}

/** Something that needs him with no fleet call behind it: a design lab, a note. */
function fromObject(object: SemanticObject): LiveItem {
  const decision = object.decision;
  const ready = object.activity?.phase === "ready";
  return {
    id: object.id,
    state: ready ? "ready" : "call",
    ...(ready ? { status: "Ready for review" } : {}),
    title: object.subject,
    ...(object.project ? { project: object.project } : {}),
    ...(object.source.task ? { task: object.source.task } : {}),
    ...(object.updatedAt ?? object.createdAt ? { at: object.updatedAt ?? object.createdAt } : {}),
    ...(object.detail || object.summary ? { step: object.detail || object.summary } : {}),
    shots: object.evidence.flatMap((one) => (one.kind === "image" && !one.closed ? [{ src: one.ref, label: one.label ?? "" }] : [])),
    previews: [],
    links: object.evidence.flatMap((one) => (one.kind === "web" && !one.closed ? [{ label: one.label ?? "Open", url: one.ref }] : [])),
    ...(decision ? { decision: { task: decision.target, ...(decision.decisionId ? { decisionId: decision.decisionId } : {}), question: decision.question, choices: decision.alternatives, ...(decision.replyTo ? { replyTo: decision.replyTo } : {}), ...(decision.recommended ? { recommended: decision.recommended } : {}), ...(decision.decisions ? { decisions: decision.decisions } : {}) } } : {}),
  };
}

/** One list of what needs him: Core's own, with each row's fleet card behind it when it has one. */
function needsOf(show: ShowScreen, jobs: readonly Job[] = []): LiveItem[] {
  const calls = new Map((show.calls ?? []).map((item) => [item.id, item]));
  const ready = new Map((show.ready ?? []).map((item) => [item.id, item]));
  const objects = [...(show.focus && needsGeorge(show.focus) ? [show.focus] : []), ...(show.needs ?? [])];
  const listed = objects.map((object) => {
    const id = object.source.showItemId;
    const call = calls.get(id);
    const done = ready.get(id);
    calls.delete(id);
    ready.delete(id);
    return call ? fromItem(call, "call") : done ? fromItem(done, "ready") : fromObject(object);
  });
  const all = [...listed, ...[...calls.values()].map((item) => fromItem(item, "call")), ...[...ready.values()].map((item) => fromItem(item, "ready"))];
  for (const job of jobs) {
    if (job.group !== "needs" || !job.id.startsWith("run:")) continue;
    all.push({ id: job.id, task: job.id.slice(4), state: "call", title: job.ask || job.title,
      ...(job.project ? { project: job.project } : {}), ...(job.at ? { at: job.at } : {}),
      shots: job.shots, previews: [], links: job.links, ...(job.decision ? { decision: job.decision } : {}) });
  }
  all.sort((a, b) => Number(b.state === "call") - Number(a.state === "call"));
  const seen = new Set<string>();
  return all.filter((item) => {
    const key = item.task ?? item.id;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Open runs the board has beside the fleet's workers: their cards count as running too. */
function runningRuns(jobs: readonly Job[] | undefined): LiveItem[] {
  return (jobs ?? []).filter((job) => job.group === "working" && !job.id.startsWith("live:")).map((job) => ({
    id: job.id, state: "running", title: job.title, ...(job.project ? { project: job.project } : {}), ...(job.at ? { at: job.at } : {}), ...(job.started ? { since: job.started } : {}),
    ...(job.next && job.next !== job.title ? { step: job.next } : {}), shots: job.shots, previews: [], links: job.links,
  }));
}

export function liveActivityOf(show: ShowScreen, jobs?: readonly Job[], now = Date.now()): LiveActivity {
  const running = [...(show.underway ?? []).map((item) => fromItem(item, "running")), ...runningRuns(jobs)];
  const paused = (show.held ?? []).filter((item) => item.status === "paused").map((item) => fromItem(item, "paused"));
  const needs = needsOf(show, jobs).sort(newestFirst);
  const old = (item: LiveItem) => now - timeOf(item.at) > RECENT_MS;
  const seen = new Set<string>();
  const landed = [...(show.done ?? []), ...(show.landedWeek ?? [])]
    .filter((item) => {
      const key = item.task ?? item.headline;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((item) => fromItem(item, "landed"))
    .sort(newestFirst);
  const pictured = landed.filter((item) => item.shots.length);
  return {
    known: Boolean(show.read),
    counts: { running: running.length, needs: needs.length },
    running,
    paused,
    needs: needs.filter((item) => !old(item)),
    older: needs.filter(old),
    landed: [...pictured, ...landed.filter((item) => !item.shots.length)].slice(0, LANDED_SHOWN).sort(newestFirst),
  };
}
