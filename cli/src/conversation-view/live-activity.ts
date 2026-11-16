import type { Job } from "./jobs.js";
import type { HoldDecision } from "./artefact.js";
import type { ShowLink, ShowPreview, ShowScreen, ShowShot } from "./show.js";
import { STATE_WORDS } from "./placement.js";

/**
 * What is running, what needs George and what landed, read from the one board
 * Core placed (placement.ts) and said in that board's words: the Today feed never
 * re-reads the fleet or shows a worker's own status line. Pure.
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
  /** Its state, in the one set of state words (placement.ts). */
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

/** One card of the board as a feed row: its own title, and its line in the board's plain words. */
function fromJob(job: Job, state: LiveState): LiveItem {
  const step = job.next || job.ask;
  return {
    id: job.id,
    state,
    title: job.title,
    ...(job.project ? { project: job.project } : {}),
    ...(job.decision?.task ? { task: job.decision.task } : {}),
    ...(job.at ? { at: job.at } : {}),
    ...(job.started ? { since: job.started } : {}),
    ...(step && step !== job.title ? { step } : {}),
    shots: job.shots,
    previews: [],
    links: job.links,
    ...(job.decision ? { decision: job.decision } : {}),
    status: job.state,
  };
}

export function liveActivityOf(show: ShowScreen, jobs: readonly Job[] = [], now = Date.now()): LiveActivity {
  const moving = jobs.filter((job) => job.group === "moving");
  const running = moving.filter((job) => job.state === STATE_WORDS.running).map((job) => fromJob(job, "running"));
  const paused = moving.filter((job) => job.state === STATE_WORDS.paused).map((job) => fromJob(job, "paused"));
  const finished = new Set<string>([STATE_WORDS.ready, STATE_WORDS.report]);
  const needs = jobs.filter((job) => job.group === "needs").map((job) => fromJob(job, finished.has(job.state) ? "ready" : "call")).sort(newestFirst);
  const old = (item: LiveItem) => now - timeOf(item.at) > RECENT_MS;
  const landed = jobs.filter((job) => job.group === "done").map((job) => fromJob(job, "landed")).sort(newestFirst);
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
