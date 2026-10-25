import { recommendationText } from "../intelligence/executive/decision-step.js";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, watch, writeFileSync, type FSWatcher } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, extname, join, relative, sep } from "node:path";
import { FLYD_DIR, PLANS_DIR } from "../lib/config.js";
import { firstmateHome } from "../lib/firstmate-home.js";
import { syncFleetFollowups } from "../runtime/fleet-followups.js";
import { readPlans, type Plan } from "../lib/plans.js";
import { reachesGeorge, type GeorgeKind } from "../lib/reaches-george.js";
import { recordKept } from "../council/reply-review.js";
import type { ArtefactVoice, Said, VoiceItem } from "./artefact-voice.js";
import type { ExecutiveDecisionRecord } from "../intelligence/executive/decision-step.js";
import type { FirstmateChange } from "../intelligence/executive/firstmate-decision.js";
import { readVerdicts } from "../council/reply-review.js";
import { readDomainRun } from "../command/store.js";
import type { ShowItem, ShowKind } from "./show.js";

// Flyd's artefact: the panel's content, built from four inputs — firstmate's
// fleet snapshot (the authoritative "everything going on"), Flyd's own memory,
// the news, and Flyd's taste. Firstmate's snapshot is read from its bearings
// script; a read that fails is Flyd's own hiccup, so it is logged and never
// shown, and the list he last saw is kept. That list persists and accumulates:
// a refresh adds or updates a row rather than resetting the screen. Everything
// here is bounded, cached and fails soft.

export interface ArtefactRow {
  /** Original evidence for Core judgment; never a display string. */
  sourceDetail?: string;
  choices?: string[];
  references?: Array<{ label: string; url: string }>;
  context?: string;
  label: string;
  /** The plain-language next step or state, whole. */
  detail?: string;
  repo?: string;
  url?: string;
  /** A word or two for its state: "merged", "checks green", "paused". */
  status?: string;
  /** Firstmate's task id, so its screenshots and full title can be found. */
  task?: string;
  /** When the task last reported, as an ISO time. */
  at?: string;
  /** When a call was raised, from the backlog: unlike `at`, a status line never moves it. */
  raised?: string;
  /** When its worker started, as an ISO time. */
  started?: string;
  /** Screenshots the task saved, as paths under its data directory. */
  shots?: string[];
  /** The data directory the screenshots are in, when it is not the task's own (a call's lab, say). */
  shotDir?: string;
  /** Flyd's own words for it, once its model has said them. */
  said?: Said;
  /** The shared decision step's question and recommendation, when George owns it. */
  executiveDecisionId?: string;
  question?: string;
  recommendation?: { option?: string; rationale: string };
  notable?: boolean;
  /** The list still holds it but the latest read no longer reports it: a call shows as settled, never as asking him. */
  ledgerOnly?: boolean;
}

export interface FleetArtefact {
  /** When firstmate generated the snapshot, as it reported. */
  generated?: string;
  /** A plain reason the snapshot could not be read; never a made-up feed. Internal only: never shown. */
  unavailable?: string;
  /** Captain holds: calls only he can make. */
  calls: ArtefactRow[];
  /** Work moving right now. */
  live: ArtefactRow[];
  /** Work a worker finished that has not landed yet. */
  ready: ArtefactRow[];
  /** Work that landed recently. */
  landed: ArtefactRow[];
  /** Work that stopped: paused, failed, or gone quiet. */
  held: ArtefactRow[];
  /** Queued next. */
  next: ArtefactRow[];
  /** Source changes awaiting or carrying their Core-owned disposition. */
  changes?: FirstmateChange[];
}

export interface ArtefactNews {
  title: string;
  url?: string;
  why?: string;
}

/** A plan George made, already read and bounded: its outcome and its checkable points. */
export interface PlanArtefact {
  id: string;
  headline: string;
  /** Its done_when points, one line, when it has them — a plan in progress shows them. */
  points?: string;
  status?: string;
  at?: string;
}

/** The inputs, already read and bounded. */
export interface ArtefactInputs {
  fleet?: FleetArtefact;
  memories: string[];
  news: ArtefactNews[];
  /** Top taste rules: they shape wording; shown only when nothing else exists. */
  taste: string[];
  /** WhatsApp is not linked yet: the panel offers to link it, and drops the offer the moment it is. */
  whatsappLink?: boolean;
  /** Plans he made, newest first. */
  plans?: PlanArtefact[];
  /** Work landed on each of the last seven days, oldest first. */
  landedByDay?: DayCount[];
  /** Every piece of work that landed in that same week, newest first. */
  landedWeek?: ArtefactRow[];
}

export interface DayCount {
  /** YYYY-MM-DD. */
  day: string;
  count: number;
}

export const EMPTY_ARTEFACT: ArtefactInputs = { memories: [], news: [], taste: [] };

const emptyFleet = (): FleetArtefact => ({ calls: [], live: [], ready: [], landed: [], held: [], next: [], changes: [] });

const FLEET_UNAVAILABLE = (reason: string): FleetArtefact => ({ ...emptyFleet(), unavailable: reason });

/** The fleet's arrays, in the order the screen reads them. */
type FleetField = "calls" | "live" | "ready" | "landed" | "held" | "next";
const FLEET_FIELDS: FleetField[] = ["calls", "live", "ready", "landed", "held", "next"];

/** One artefact the screen has shown, kept so a later refresh adds or updates it rather than restarting the list. */
interface LedgerEntry {
  field: FleetField;
  row: ArtefactRow;
  seenAt: number;
  /** When Flyd first saw it: a landed row firstmate gave no time of its own is dated by this. */
  firstSeen?: number;
  ledgerOnly?: boolean;
  /** A call that was put to him as a decision: only such a call stays on as settled once it goes, in the words he last saw. */
  asked?: boolean;
}

/** An artefact's stable name: its task, else its words, so the same work keeps the same place on screen. */
function artefactKey(row: ArtefactRow): string | undefined {
  return row.task ? `task:${row.task}` : row.label ? `label:${row.label}` : undefined;
}

/** A row's place in the list: a call keeps its own, apart from the work it is about, so it stays on once the work moves on. */
function ledgerKey(field: FleetField, row: ArtefactRow): string | undefined {
  const key = artefactKey(row);
  return key && field === "calls" ? `call:${key}` : key;
}

/** How many of each kind the artefact shows; the section says how many more there are. */
export const ARTEFACT_LIMITS = { call: 4, live: 4, ready: 4, landed: 8, waiting: 4, next: 3 } as const;

/**
 * The one action card while WhatsApp is unlinked: the same words in the
 * timeline, the artefacts panel and the artefact view. `/whatsapp` is the
 * People page, where the code is drawn live.
 */
export const WHATSAPP_LINK = {
  id: "whatsapp-link",
  title: "Link WhatsApp so Flyd can message people for you",
  line: "In WhatsApp: Linked devices, then Link a device, then scan the code.",
  url: "/whatsapp",
} as const;

const str = (value: unknown): string => (typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "");
const rows = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value) ? value.filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object") : [];
const capitalise = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

const PR_URL = /https:\/\/github\.com\/[\w.-]+\/([\w.-]+)\/pull\/(\d+)\b/g;

/** The stock line an unreadable ask used to get: it says nothing, so it is never a headline. */
const STOCK_ASK = /^an unresolved choice needs clarification\.?$/i;
const HEADLINE_MAX = 110;

/**
 * A call's headline in a glance: its own words (the task's title when the
 * words say nothing), a pull request as "PR #9" and any other link as its
 * site, and a long ask cut to its first sentence. Pure.
 */
export function callHeadline(text: string | undefined, fallback?: string): string {
  let line = (text ?? "").replace(/\s+/g, " ").trim();
  if (!line || STOCK_ASK.test(line)) line = (fallback ?? "").replace(/\s+/g, " ").trim();
  line = line.replace(new RegExp(`(?:\\bPR\\s+)?${PR_URL.source}`, "g"), (_url, _repo: string, number: string) => `PR #${number}`)
    .replace(/https?:\/\/(?:www\.)?([^/\s]+)\S*/g, "$1");
  if (line.length <= HEADLINE_MAX) return line;
  const first = /^.{12,}?[?.!](?=\s|$)/.exec(line)?.[0];
  if (first && first.length <= HEADLINE_MAX + 30) return first;
  return `${line.slice(0, HEADLINE_MAX).replace(/\s+\S*$/, "")}…`;
}

function linkLabel(url: string): string {
  const pr = url.match(/github\.com\/[\w.-]+\/([\w.-]+)\/pull\/(\d+)/);
  if (pr) return `${pr[1]} #${pr[2]}`;
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function httpUrl(value: unknown): string | undefined {
  const url = str(value);
  return /^https?:\/\//.test(url) ? url : undefined;
}

/** Firstmate's run notes, said plainly: no run ids, no harness words, PRs by number. Pure. */
export function plainStep(doing: string): string {
  let line = str(doing)
    .replace(/\s*(?:·\s*)?\brun:\s*[0-9A-Z]{8,}…?/g, "")
    .replace(/\b(\d+) MERGED\b/g, "#$1 merged");
  line = line
    .replace(PR_URL, (_url, _repo: string, number: string) => (line.includes(`#${number} `) ? "" : `#${number}`))
    .replace(/\s*https?:\/\/\S*…/g, "…")
    .replace(/\s+\|\s+/g, "; ")
    .replace(/\s+([;,.])/g, "$1")
    .replace(/[;,]\s*…$/, "…")
    .replace(/\s*[·|;]\s*$/, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  const said: Array<[RegExp, string]> = [
    [/^harness busy\b.*$/i, "A worker is on it"],
    [/^harness state unavailable\b.*$/i, "No word from the worker"],
    [/^run passed: PR open\b.*$/i, "PR open; its checks passed"],
    [/^run failed\b.*$/i, "The run failed"],
    [/^run cancelled\b.*$/i, "The run was cancelled before a verdict"],
    [/^ready in branch\b/i, "Ready on branch"],
  ];
  for (const [pattern, plain] of said) {
    if (pattern.test(line)) {
      line = line.replace(pattern, plain);
      break;
    }
  }
  return capitalise(line);
}

/** A word or two for where finished work stands. Pure. */
export function readyStatus(doing: string): string {
  if (/\bmerged\b/i.test(doing)) return "merged";
  if (/\b(?:checks?|tests?|ci)\b[^.;]*\bgreen\b|\bgreen\b/i.test(doing)) return "checks green";
  if (/\bPR\b|\/pull\/\d+/.test(doing)) return "PR open";
  if (/\bbranch\b/i.test(doing)) return "on its branch";
  return "done";
}

/** firstmate's bearings JSON → the small model the panel needs. Pure. */
export function parseBearings(raw: unknown): FleetArtefact {
  if (!raw || typeof raw !== "object") return FLEET_UNAVAILABLE("it was not valid JSON");
  const data = raw as Record<string, unknown>;
  const schema = str(data.schema);
  if (schema && !schema.startsWith("fm-bearings")) return FLEET_UNAVAILABLE(`unexpected schema ${schema}`);
  const recorded = new Map(rows(data.recorded_prs).map((row) => [str(row.id), httpUrl(row.url)]));
  const flight = rows(data.in_flight).map((row) => {
    const doing = str(row.doing);
    const url = recorded.get(str(row.id)) ?? doing.match(PR_URL)?.[0];
    return {
      state: str(row.state),
      kind: str(row.kind),
      doing,
      row: {
        label: str(row.name) || str(row.id),
        ...(str(row.id) ? { task: str(row.id) } : {}),
        ...(doing ? { detail: plainStep(doing) } : {}),
        ...(str(row.repo) ? { repo: str(row.repo) } : {}),
        ...(url ? { url } : {}),
      } as ArtefactRow,
    };
  }).filter((entry) => entry.row.label);
  const changes: FirstmateChange[] = flight.map((entry) => ({
    eventId: str(entry.row.task) || entry.row.label,
    ...(entry.row.task ? { taskId: entry.row.task } : {}),
    kind: "fleet_state",
    state: entry.state,
    label: entry.row.label,
    detail: entry.row.url && !entry.doing.includes(entry.row.url) ? [entry.doing, entry.row.url].filter(Boolean).join("\n") : entry.doing,
    evidenceRefs: entry.row.task ? [`firstmate-task:${entry.row.task}`] : [],
  }));
  const inState = (...states: string[]) => flight.filter((entry) => states.includes(entry.state));
  changes.push(...rows(data.decisions_open).map((row): FirstmateChange => ({
    eventId: `decision:${str(row.id) || str(row.summary)}`,
    ...(str(row.id) ? { taskId: str(row.id) } : {}),
    kind: "decision", state: "needs-decision", label: str(row.summary) || str(row.id),
    detail: [str(row.summary), str(row.question), str(row.detail)].filter(Boolean).join("\n"),
    evidenceRefs: str(row.id) ? [`firstmate-task:${str(row.id)}`] : [],
  })));
  const finished = inState("done").map((entry) => ({ ...entry.row, status: entry.kind === "scout" ? "report available" : readyStatus(entry.doing) }));
  const HELD: Record<string, string> = { failed: "failed", unknown: "no word", paused: "paused" };
  return {
    ...(str(data.generated) ? { generated: str(data.generated) } : {}),
    changes,
    calls: rows(data.decisions_open).map((row) => ({ label: str(row.summary) || str(row.id), ...(str(row.id) ? { task: str(row.id) } : {}) })).filter((row) => row.label),
    live: inState("working").map((entry) => entry.row),
    ready: finished.filter((row) => row.status !== "merged"),
    landed: [
      ...finished.filter((row) => row.status === "merged"),
      ...rows(data.landed)
        .map((row) => {
          const url = httpUrl(row.artifact);
          const repo = url?.match(/github\.com\/[\w.-]+\/([\w.-]+)\/pull\//)?.[1];
          return {
            label: str(row.what) || str(row.id),
            ...(str(row.id) ? { task: str(row.id) } : {}),
            ...(repo ? { repo } : {}),
            ...(url ? { url } : {}),
            status: "landed",
          };
        })
        .filter((row) => row.label),
    ],
    held: (["failed", "unknown", "paused"] as const).flatMap((state) => inState(state).map((entry) => ({ ...entry.row, status: HELD[state]! }))),
    next: rows(data.gates)
      .map((row) => {
        const blocked = str(row.blocked_by);
        return {
          label: str(row.title) || str(row.id),
          ...(str(row.id) ? { task: str(row.id) } : {}),
          status: blocked && blocked !== "-" ? `blocked by ${blocked}` : "queued",
        };
      })
      .filter((row) => row.label),
  };
}

export interface BacklogEntry {
  title: string;
  repo?: string;
  notes?: string;
  /** Why a hold is open: for a captain hold, the concrete ask. */
  hold?: string;
  /** The day the task was opened, from its `since` tag: how long a hold has waited. */
  since?: string;
  /** The day it finished, for done items. */
  finished?: string;
  /** The pull request (or other link) the row names. */
  url?: string;
}

/** Firstmate stores a hold's reason as `fm-hold-v1:<base64>`; its plain words, or nothing when it does not decode. Pure. */
export function holdReason(value: string): string {
  const marked = /^fm-hold-v1:([A-Za-z0-9+/]*={0,2})$/.exec(value.trim());
  if (!marked) return value.startsWith("fm-hold-v1:") ? "" : value;
  try {
    const bytes = Buffer.from(marked[1]!, "base64");
    if (bytes.toString("base64") !== marked[1]) return "";
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/\s+/g, " ").trim();
  } catch {
    return "";
  }
}

/** Firstmate's backlog.md rows by task id: the full title bearings shortens. Pure. */
export function parseBacklog(markdown: string): Map<string, BacklogEntry> {
  const entries = new Map<string, BacklogEntry>();
  let current: BacklogEntry | undefined;
  for (const line of markdown.split("\n")) {
    const row = /^- \[([ x])\] ([\w.-]+) - (.+)$/.exec(line.trim());
    if (!row) {
      if (current && /^\s+\S/.test(line)) current.notes = ((current.notes ?? "") + " " + line.trim()).trim().slice(0, 2000);
      else if (/^#/.test(line)) current = undefined;
      continue;
    }
    let rest = row[3]!;
    const tags = new Map<string, string>();
    for (let tag = /\s*\(([\w-]+):? ([^()]*)\)\s*$/.exec(rest); tag; tag = /\s*\(([\w-]+):? ([^()]*)\)\s*$/.exec(rest)) {
      tags.set(tag[1]!.toLowerCase(), tag[2]!.trim());
      rest = rest.slice(0, tag.index);
    }
    const title = rest
      .replace(/\s+blocked-by:\s*\S+/g, "")
      .replace(/https?:\/\/\S+/g, "")
      .replace(/\bdata\/\S+/g, "")
      .replace(/\(\s*\)/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (!title) continue;
    const finished = [tags.get("merged"), tags.get("done"), tags.get("landed")].find((value) => value && /^\d{4}-\d{2}-\d{2}/.test(value));
    const hold = holdReason(tags.get("hold") ?? "");
    const since = tags.get("since");
    const url = rest.match(PR_URL)?.[0] ?? rest.match(/https?:\/\/[^\s()]+/)?.[0];
    current = {
      title,
      ...(url ? { url } : {}),
      ...(tags.get("repo") ? { repo: tags.get("repo") } : {}),
      ...(hold ? { hold } : {}),
      ...(since && /^\d{4}-\d{2}-\d{2}/.test(since) ? { since: since.slice(0, 10) } : {}),
      ...(row[1] === "x" && finished ? { finished: finished.slice(0, 10) } : {}),
    };
    entries.set(row[2]!, current);
  }
  return entries;
}

/** Bearings' shortened line, said whole when the backlog has it. */
function wholeLabel(label: string, full: string): string {
  if (!label.endsWith("…")) return label;
  const kept = label.slice(0, -1).trimEnd().toLowerCase();
  return full.toLowerCase().startsWith(kept.slice(0, Math.min(kept.length, 24))) ? full : label;
}

export interface TaskExtra {
  at?: string;
  /** When its worker was started, from the task's own record. */
  started?: string;
  shots?: string[];
  /** When the newest of those screenshots was taken. */
  shotAt?: string;
  /** The task's own last status note, whole. */
  note?: string;
}

const NOTE_CHARS = 180;

/** A worker's status line as one plain sentence: no state prefix, no file paths. Pure. */
export function statusNote(line: string): string {
  const note = str(line)
    .replace(/^[a-z-]+(?:\s*\[[^\]]*\])*\s*:\s*/i, "")
    .replace(/[;,]?\s*(?:screenshots?|shots?|proof|report)?\s*(?:at\s+)?(?:\/private|\/Users|\/tmp|~)\/[^\s;,]+/gi, "")
    .replace(/\s+([;,.])/g, "$1")
    .trim();
  const plain = plainStep(note);
  if (plain.length <= NOTE_CHARS) return plain;
  // Long notes end at a clause, never mid-word.
  const cut = plain.slice(0, NOTE_CHARS);
  const clause = Math.max(cut.lastIndexOf("; "), cut.lastIndexOf(". "));
  return clause > 60 ? cut.slice(0, clause) : cut.replace(/\s+\S*$/, "");
}

/** Holds that ask him to read or remember something rather than to decide. */
const NOT_A_DECISION = /\bready to read\b|\(report \+ artefact\)|(?:^|:\s)Read:|^Remind (?:the )?captain\b/i;

/** Whether a hold asks him to read or remember something rather than to decide. Pure. */
function notADecision(row: ArtefactRow): boolean {
  return NOT_A_DECISION.test(row.label) || Boolean(row.detail && NOT_A_DECISION.test(row.detail));
}

/** A hold nobody has touched for this long, with nothing to answer, is no longer a call. */
export const STALE_CALL_MS = 3 * 24 * 60 * 60 * 1000;

/** Whether a hold is a decision still waiting on him: not a read-me or reminder, and not an old hold with no question to answer. Pure. */
export function isCurrentDecision(row: ArtefactRow, now: number): boolean {
  if (notADecision(row)) return false;
  if (row.choices?.length) return true;
  const touched = row.at ? Date.parse(row.at) : Number.NaN;
  return !Number.isNaN(touched) && now - touched <= STALE_CALL_MS;
}

/** Bearings' rows with the backlog's full words, last-report times and screenshots. Pure. */
export function enrichFleet(fleet: FleetArtefact, backlog: Map<string, BacklogEntry>, extras: Map<string, TaskExtra> = new Map(), now = Date.now(), options: { includeUnclassifiedCalls?: boolean } = {}): FleetArtefact {
  const enrich = (row: ArtefactRow, call = false): ArtefactRow => {
    const entry = row.task ? backlog.get(row.task) : undefined;
    const extra = row.task ? extras.get(row.task) : undefined;
    let next: ArtefactRow = { ...row };
    if (entry && call) next = { ...next, label: entry.title, ...(entry.hold ? { detail: entry.hold, ...(options.includeUnclassifiedCalls ? { sourceDetail: [row.sourceDetail, entry.hold].filter(Boolean).join("\n") } : {}) } : {}) };
    else if (entry) next = { ...next, label: wholeLabel(row.label, entry.title) };
    if (entry?.repo) next.repo = entry.repo;
    if (call && entry?.hold) {
      next.choices = decisionChoices(entry.hold);
      next.references = [...new Set(entry.hold.match(/https?:\/\/[^\s,)]+/g) ?? [])].map((url) => ({ label: /\/session\//.test(url) ? "Open design review" : "Open reference", url }));
    }
    if (next.repo) {
      const related = [...backlog].filter(([task, other]) => task !== row.task && other.repo === next.repo);
      next.context = related.slice(-6).map(([, other]) => `${other.finished ? `Finished ${other.finished}` : "Still open"}: ${other.title}. ${other.notes ?? ""}`).join("\n").slice(0, 2400);
    }
    if (call && entry?.since) next.raised = entry.since;
    if (extra?.at) next.at = extra.at;
    else if (call && entry?.since) next.at = entry.since;
    if (extra?.started) next.started = extra.started;
    if (extra?.note && next.detail && !call) next.detail = wholeLabel(next.detail, extra.note);
    if (extra?.shots?.length) next.shots = extra.shots;
    else if (entry) {
      // No pictures of its own: the lab or report its words point at has them.
      const dir = referencedDirs(entry).find((name) => name !== row.task && extras.get(name)?.shots?.length);
      if (dir) next = { ...next, shots: extras.get(dir)!.shots, shotDir: dir };
    }
    if (!next.url && entry?.url) next.url = entry.url;
    return next;
  };
  if (fleet.unavailable) return fleet;
  return {
    ...fleet,
    calls: fleet.calls.map((row) => (row.ledgerOnly ? row : enrich(row, true))).filter((row) => (row.ledgerOnly ? !notADecision(row) : options.includeUnclassifiedCalls || isCurrentDecision(row, now))),
    live: fleet.live.map((row) => enrich(row)),
    ready: fleet.ready.map((row) => enrich(row)),
    landed: fleet.landed.map((row) => enrich(row)),
    held: fleet.held.map((row) => enrich(row)),
    next: fleet.next.map((row) => enrich(row)),
  };
}

export function firstmateChangesFromFleet(fleet: FleetArtefact): FirstmateChange[] {
  const changes = new Map<string, FirstmateChange>();
  const add = (change: FirstmateChange) => changes.set(`${change.taskId ?? change.eventId}:${change.state}`, change);
  for (const change of fleet.changes ?? []) add(change);
  for (const row of fleet.calls) {
    if (row.ledgerOnly) continue;
    const original = fleet.changes?.find((change) => change.taskId === row.task && change.kind === "decision");
    add({
      eventId: `decision:${row.task ?? row.label}`,
      ...(row.task ? { taskId: row.task } : {}),
      kind: "decision",
      state: "needs-decision",
      label: row.label,
      detail: [original?.detail, row.sourceDetail ?? row.detail, row.context].filter(Boolean).join("\n"),
      goalContext: row.context,
      evidenceRefs: row.task ? [`firstmate-task:${row.task}`] : [],
    });
  }
  for (const row of [...fleet.ready, ...fleet.landed]) {
    if (fleet.changes?.some((change) => change.taskId === row.task && change.kind === "fleet_state")) continue;
    add({
      eventId: `result:${row.task ?? row.label}`,
      ...(row.task ? { taskId: row.task } : {}),
      kind: "fleet_state",
      state: "done",
      label: row.label,
      detail: [row.sourceDetail ?? row.detail ?? row.status, row.url].filter(Boolean).join("\n"),
      evidenceRefs: row.task ? [`firstmate-task:${row.task}`] : [],
    });
  }
  for (const row of [...fleet.live, ...fleet.held, ...fleet.next]) {
    if (fleet.changes?.some((change) => change.taskId === row.task && change.kind === "fleet_state")) continue;
    const state = row.status ?? (fleet.live.includes(row) ? "working" : fleet.next.includes(row) ? "queued" : "unknown");
    add({
      eventId: `status:${row.task ?? row.label}`,
      ...(row.task ? { taskId: row.task } : {}),
      kind: "fleet_state",
      state,
      label: row.label,
      detail: row.sourceDetail ?? row.detail ?? "",
      evidenceRefs: row.task ? [`firstmate-task:${row.task}`] : [],
    });
  }
  return [...changes.values()].slice(0, 40);
}

/** Domain runs Flyd held for its own attention after their boss could not settle them, until the run moves on. */
export function heldForAttention(): ArtefactRow[] {
  const rows = new Map<string, ArtefactRow>();
  for (const verdict of readVerdicts()) {
    if (!verdict.held || verdict.shortfalls.length || !verdict.source.startsWith("domain:")) continue;
    const task = verdict.source.slice("domain:".length);
    const run = readDomainRun(task);
    if (!run?.notified || run.updatedAt > verdict.at) continue;
    // A run that finished has nothing left for him: it is done work, told in its own result, not a call.
    const brief = run.status === "completed" ? run.result?.brief?.trim() : "";
    rows.set(task, brief ? { label: brief, task, status: "landed", at: run.updatedAt } : { label: run.request.intendedOutcome, task, status: "needs attention", at: verdict.at });
  }
  return [...rows.values()];
}

export function projectFleetDecisions(fleet: FleetArtefact, decisions: readonly ExecutiveDecisionRecord[], attention: readonly ArtefactRow[] = []): FleetArtefact {
  const byTask = new Map<string, ExecutiveDecisionRecord>();
  for (const decision of decisions) {
    if (!decision.taskId) continue;
    const previous = byTask.get(decision.taskId);
    if (previous?.disposition === "ask_george" && previous.show) continue;
    byTask.set(decision.taskId, decision);
  }
  // A George choice can come from a work row's state as well as from an open decision.
  const askedIn = new Set(fleet.calls.map((row) => row.task));
  const stateRows = [...fleet.live, ...fleet.ready, ...fleet.landed, ...fleet.held, ...fleet.next]
    .filter((row) => row.task && !askedIn.has(row.task) && askedIn.add(row.task));
  const calls = [...fleet.calls, ...stateRows].flatMap((row) => {
    if (row.ledgerOnly) return [row];
    const decision = row.task ? byTask.get(row.task) : undefined;
    if (decision?.disposition !== "ask_george" || !decision.show || !decision.question) return [];
    return [{
      ...row,
      executiveDecisionId: decision.decisionId,
      status: "Needs your choice",
      label: decision.question,
      question: decision.question,
      // The executive decision's own grounded options win; a row that already
      // parsed its choices from the hold keeps them rather than losing them to
      // an empty list. A recommendation that names no option is not shown as one.
      choices: decision.options?.length ? decision.options : (row.choices ?? []),
      ...(decision.recommendation?.option ? { recommendation: decision.recommendation, detail: recommendationText(decision.recommendation) } : {}),
    }];
  });
  const verified = [...fleet.ready, ...fleet.landed].flatMap((row) => {
    const decision = row.task ? byTask.get(row.task) : undefined;
    if (decision?.disposition !== "handle_internally" || !decision.show || decision.verification.status !== "verified") return [];
    return [{
      ...row,
      // When the work finished: its own report time, else when Flyd verified it had landed (never invented).
      ...(!row.at && decision.createdAt ? { at: decision.createdAt } : {}),
      executiveDecisionId: decision.decisionId,
      label: decision.summary,
      detail: undefined,
      status: "verified",
      ...(decision.notify ? { notable: true } : {}),
    }];
  });
  const asking = new Set(calls.map((row) => row.task));
  const failed = fleet.held.flatMap((row) => row.status === "failed" && !asking.has(row.task) ? [{ ...row, detail: undefined }] : []);
  const finished = attention.filter((row) => row.status === "landed");
  const open = attention.filter((row) => row.status !== "landed");
  return { ...emptyFleet(), ...(fleet.generated ? { generated: fleet.generated } : {}), ...(fleet.unavailable ? { unavailable: fleet.unavailable } : {}), calls, landed: [...verified, ...finished], held: [...failed, ...open] };
}

/** The firstmate data directories a backlog row's words point at ("report data/gnm-lab/report.md"). Pure. */
export function referencedDirs(entry: BacklogEntry): string[] {
  const text = `${entry.hold ?? ""} ${entry.notes ?? ""}`;
  return [...new Set([...text.matchAll(/\bdata\/([\w-][\w.-]*)\//g)].map((match) => match[1]!))];
}

/** How far back finished work still counts as just landed. */
export const RECENT_DAYS = 3;

/**
 * Work that finished in the last few days, newest first: firstmate moves done
 * rows to its archive, and its snapshot keeps only the last six landings, so
 * the work worth showing (the pictures of it) is found here. Pure.
 */
export function recentlyFinished(entries: Map<string, BacklogEntry>, now: number, days = RECENT_DAYS): Array<{ task: string; entry: BacklogEntry }> {
  const since = new Date(now - days * 86_400_000).toISOString().slice(0, 10);
  return [...entries]
    .map(([task, entry], index) => ({ task, entry, index }))
    .filter(({ entry }) => entry.finished && entry.finished >= since)
    // Same day: the archive's later rows are the newer ones.
    .sort((a, b) => b.entry.finished!.localeCompare(a.entry.finished!) || b.index - a.index)
    .map(({ task, entry }) => ({ task, entry }));
}

/** The option a hold recommends ("1 Evergreen luxe (recommended after round 1: …)"), when it names one. Pure. */
export function recommendedChoice(question: string): string | undefined {
  const match = question.match(/(?:^|:\s*|,\s*)\d+\s+([^,(]+?)\s*\(recommended\b/i);
  return match ? match[1]!.trim() : undefined;
}

/**
 * A hold's question in plain words: who asks and the numbered options gone (the
 * buttons say them), and the file paths and board addresses in brackets with them.
 * "Captain picks the Christmas direction for the site from the lab (board …): 1 …"
 * reads "Pick the Christmas direction for the site from the lab". Pure.
 */
export function plainQuestion(question: string): string {
  let asked = question
    .replace(/\s*\([^)]*\)/g, "")
    .replace(/:\s*1\s[\s\S]*$/, "")
    .replace(/[\s:;,.]+$/, "")
    .trim();
  // "Captain picks …" is said about him; to him it is "Pick …".
  const captain = asked.match(/^(?:the\s+)?captain\s+(\w+)\b/i);
  if (captain) asked = captain[1]!.replace(/(sh|ch|x)es$/i, "$1").replace(/([^s])s$/i, "$1") + asked.slice(captain[0].length);
  return asked ? asked.charAt(0).toUpperCase() + asked.slice(1) : "";
}

export function decisionChoices(question: string): string[] {
  const choices = [...question.matchAll(/(?:^|:\s*|,\s*)(\d+)\s+(.+?)(?=,\s*\d+\s+|,?\s+or a mix\b|$)/g)]
    .map((match) => match[2]!.replace(/\s*\([^)]*\)/g, "").replace(/[.,;]+$/, "").trim());
  return choices.length >= 2 && choices.length <= 8 ? choices : [];
}

/** The seven days "landed this week" covers, oldest first, as YYYY-MM-DD. Pure. */
function weekDays(now: number): string[] {
  return Array.from({ length: 7 }, (_unused, back) => new Date(now - (6 - back) * 86_400_000).toISOString().slice(0, 10));
}

/** How much landed on each of the last seven days, from the backlog's finish dates. Pure. */
export function landedByDay(backlog: Map<string, BacklogEntry>, now: number): DayCount[] {
  const days: DayCount[] = weekDays(now).map((day) => ({ day, count: 0 }));
  for (const entry of backlog.values()) {
    const day = days.find((slot) => slot.day === entry.finished);
    if (day) day.count += 1;
  }
  return days;
}

/** Every piece of work that landed in that week, newest first, one row each. Pure. */
export function weekLandedRows(entries: Map<string, BacklogEntry>, now: number): ArtefactRow[] {
  const week = new Set(weekDays(now));
  return [...entries]
    .filter(([, entry]) => Boolean(entry.finished && week.has(entry.finished)))
    .sort((a, b) => (b[1].finished ?? "").localeCompare(a[1].finished ?? ""))
    .map(([task, entry]) => ({
      label: entry.title,
      task,
      status: "landed",
      at: entry.finished!,
      ...(entry.repo ? { repo: entry.repo } : {}),
      ...(entry.url ? { url: entry.url } : {}),
    }));
}

const IMAGE = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);
export const SHOTS_PER_TASK = 4;
/** Smaller than this is an icon or a texture, not a picture of the work. */
const MIN_SHOT_BYTES = 12_000;

export type Device = "phone" | "tablet" | "desktop";

/** What a screenshot's name says it was taken on, when it says. Pure. */
export function deviceOf(path: string): Device | undefined {
  const name = path.toLowerCase().split("/").pop() ?? "";
  const width = (widths: string) => new RegExp(`(?:^|[^0-9])(?:${widths})(?:[^0-9]|$)`).test(name);
  const named: Device[] = [];
  if (/phone|mobile|android/.test(name) || width("360|375|390|393|402|412|414|428|430")) named.push("phone");
  if (/ipad|tablet/.test(name) || width("768|810|820|834")) named.push("tablet");
  if (/desk|laptop|wide/.test(name) || width("1024|1080|1200|1280|1366|1440|1512|1536|1600|1680|1728|1920|2560")) named.push("desktop");
  // A name that names more than one screen is a composite ("…-desktop-and-phone.png"): it is its own picture.
  return named.length === 1 ? named[0] : undefined;
}

/**
 * The screenshots worth showing from a task's files: "after" shots before
 * "before" ones, newest first, and when the work was captured on more than one
 * device, the best desktop and phone shots lead so the screen can show the
 * pair. Pure.
 */
export function pickShots(files: Array<{ path: string; mtime: number; size?: number }>): string[] {
  // What the captain sent in (his screenshots, his artwork) is the ask, not the work.
  const images = files.filter((file) => IMAGE.has(extname(file.path).toLowerCase()) && (file.size === undefined || file.size >= MIN_SHOT_BYTES) && !/captain/i.test(file.path));
  // "Before" shots and references come last: they are not the work.
  const score = (path: string) => (/\bafter\b|after[-_]/i.test(path) ? 0 : /\bbefore\b|before[-_]|reference|inspiration/i.test(path) ? 2 : 1);
  const ranked = [...images].sort((a, b) => score(a.path) - score(b.path) || b.mtime - a.mtime).map((file) => file.path);
  const lead = (["desktop", "phone"] as const).map((device) => ranked.find((path) => deviceOf(path) === device)).filter((path): path is string => Boolean(path));
  const ordered = lead.length === 2 ? [...lead, ...ranked.filter((path) => !lead.includes(path))] : ranked;
  return ordered.slice(0, SHOTS_PER_TASK);
}

/** A commitment older than this is not news to him. */
const MEMORY_FRESH_MS = 7 * 86_400_000;

/** The one line Flyd carries from its own memory: the newest open commitment still fresh. Pure. */
export function memoryHighlights(markdown: string, now = Date.now()): string[] {
  const section = markdown.split(/^##\s+Commitments\s*$/m)[1]?.split(/^##\s+/m)[0];
  if (!section) return [];
  const lines = section
    .split("\n")
    .filter((entry) => {
      const noted = /<!--p:(\d{4}-\d{2}-\d{2})-->/.exec(entry)?.[1];
      return !noted || now - Date.parse(noted) < MEMORY_FRESH_MS;
    })
    .map((entry) => entry.replace(/<!--[\s\S]*?-->/g, "").trim())
    .filter((entry) => entry.startsWith("- "));
  const line = lines.at(-1);
  return line ? [line.slice(2).trim()] : [];
}

/** The newest relevant item from the scout edition. Pure. */
export function newsHighlights(raw: unknown): ArtefactNews[] {
  if (!raw || typeof raw !== "object") return [];
  const items = rows((raw as Record<string, unknown>).items).filter((item) => str(item.kind) === "relevant" || !str(item.kind));
  return items.slice(0, 1).map((item) => ({ title: str(item.title), url: httpUrl(item.url), why: str(item.why) || undefined })).filter((item) => item.title);
}

export function tasteHighlights(markdown: string): string[] {
  return markdown
    .split("\n")
    .filter((line) => /^- /.test(line))
    .map((line) => line.replace(/<!--[\s\S]*?-->/g, "").slice(2).trim())
    .filter(Boolean)
    .slice(0, 3);
}

/** When the work a row names last moved, for ordering newest first; 0 when it says nothing. Pure. */
function rowMovedAt(row: ArtefactRow): number {
  const at = row.at ?? row.started ?? row.raised;
  const moved = at ? Date.parse(at) : Number.NaN;
  return Number.isNaN(moved) ? 0 : moved;
}

/** The rows of one kind the artefact shows, this read's rows first and newest of them leading. Pure. */
export function shownRows(list: ArtefactRow[] | undefined, limit: number): ArtefactRow[] {
  return [...(list ?? [])].sort((a, b) => (a.ledgerOnly ? 1 : 0) - (b.ledgerOnly ? 1 : 0) || newestFirst(a, b)).slice(0, limit);
}

function newestFirst(a: ArtefactRow, b: ArtefactRow): number {
  return rowMovedAt(b) - rowMovedAt(a) || (b.shots?.length ? 1 : 0) - (a.shots?.length ? 1 : 0);
}

/** The calls the artefact shows, newest first: up to its limit of open ones, and every settled one in its own place. Pure. */
function shownCalls(list: ArtefactRow[] | undefined): ArtefactRow[] {
  const open = new Set(shownRows(list?.filter((row) => !row.ledgerOnly), ARTEFACT_LIMITS.call));
  return [...(list ?? [])].sort(newestFirst).filter((row) => row.ledgerOnly || open.has(row));
}

/** What a panel item is to George, by its kind: his calls, finished work, and otherwise where work stands. Pure. */
export function aboutItem(item: ShowItem): GeorgeKind {
  if (item.decision || item.kind === "call") return "decision";
  return item.kind === "landed" ? "deliverable" : "status";
}

/** A fleet row as George would take it: work that stopped by failing is the staff's to repair, work gone quiet theirs to chase. Pure. */
function aboutRow(kind: keyof typeof ARTEFACT_LIMITS, row: ArtefactRow): GeorgeKind {
  if (kind === "call") return "decision";
  if (kind === "landed") return "deliverable";
  if (row.status === "failed") return "fault";
  return row.status === "no word" ? "silence" : "status";
}

/**
 * A panel item as the gate (lib/reaches-george.ts) lets it through, in its
 * plain words: none when its headline is Flyd's own to handle, and its detail
 * only when that may reach him too. Pure.
 */
export function gatedItem(item: ShowItem | undefined, about?: GeorgeKind): ShowItem | undefined {
  if (!item) return undefined;
  const kind = about ?? aboutItem(item);
  const headline = reachesGeorge({ kind, text: item.headline }, "panel");
  if (!headline.reach) return undefined;
  const { detail, ...shown } = item;
  const said = detail ? reachesGeorge({ kind, text: detail }, "panel") : undefined;
  return { ...shown, headline: headline.line, ...(said?.reach ? { detail: said.line } : {}) };
}

/** How many of each kind the fleet holds, before the artefact's limits: held work only as far as the gate shows it. Pure. */
export function fleetCounts(fleet: FleetArtefact | undefined): Partial<Record<ShowKind, number>> {
  if (!fleet || fleet.unavailable) return {};
  return {
    call: fleet.calls.filter((row) => !row.ledgerOnly).length,
    live: fleet.live.length,
    ready: fleet.ready.filter((row) => row.status !== "report available").length,
    landed: fleet.landed.length,
    waiting: fleet.held.filter((row) => reachesGeorge({ kind: aboutRow("waiting", row), text: row.label }, "panel").reach).length,
    next: fleet.next.length,
  };
}

export interface ComposeOptions {
  /** His own name for a repository's project, when Flyd knows it. */
  project?: (repo: string) => string | undefined;
}

/** Where the page loads a task's screenshot from; the server serves only listed ones. */
export function shotSrc(task: string, file: string): string {
  return `/api/artefact-shot?task=${encodeURIComponent(task)}&file=${encodeURIComponent(file)}`;
}

/** "Flyd: drag and drop…" under the Flyd project reads "Drag and drop…". */
function withoutProject(label: string, names: string[]): string {
  for (const name of names) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const bare = label.replace(new RegExp(`^${escaped}\\s*:\\s+`, "i"), "");
    if (bare !== label && bare) return capitalise(bare);
  }
  return label;
}

/** One fleet row as a panel item; a call carries its question to answer. Pure. */
function rowItem(kind: ShowKind, id: string, row: ArtefactRow, options: ComposeOptions): ShowItem | undefined {
  const project = row.repo ? options.project?.(row.repo) ?? row.repo : undefined;
  const names = [project, row.repo].filter((name): name is string => Boolean(name));
  const detail = row.said?.line || row.detail;
  const sourceHeadline = withoutProject(row.label, names);
  // A question with options leads with the question in plain words, and under it the work it is about.
  const asked = kind === "call" ? row.question ?? (row.choices?.length && row.detail ? plainQuestion(row.detail) : "") : "";
  const recommended = row.recommendation?.option ?? (asked ? recommendedChoice(row.detail ?? "") : undefined);
  const headline = asked || (row.said?.headline ?? (row.status === "report available" ? `Earlier report: ${sourceHeadline}` : sourceHeadline));
  if (!headline) return undefined;
  return {
    id: `${kind}:${id}`,
    kind,
    ...(row.executiveDecisionId ? { executiveDecisionId: row.executiveDecisionId } : {}),
    headline,
    why: "",
    ...(kind === "call" && row.task ? { decision: { task: row.task, ...(row.executiveDecisionId ? { decisionId: row.executiveDecisionId } : {}), question: row.question ?? row.detail ?? row.label, choices: row.choices ?? [], ...(recommended ? { recommended } : {}) } } : {}),
    ...(asked ? { detail: row.recommendation?.option ? recommendationText(row.recommendation) : row.said?.line || sourceHeadline } : detail ? { detail } : {}),
    ...(row.at ? { at: row.at } : {}),
    ...(row.started ? { started: row.started } : {}),
    ...((row.shotDir ?? row.task) && row.shots?.length
      ? { shots: row.shots.map((file) => ({ src: shotSrc(row.shotDir ?? row.task!, file), label: file.split("/").pop()! })) }
      : {}),
    ...(row.status ? { status: row.status } : {}),
    ...(project ? { project } : {}),
    ...(row.task ? { task: row.task } : {}),
    ...withLink(row.url),
    ...(row.references?.length ? { links: [...(row.url ? [{ label: linkLabel(row.url), url: row.url }] : []), ...row.references] } : {}),
  };
}

function withLink(url: string | undefined): Partial<ShowItem> {
  return url ? { links: [{ label: linkLabel(url), url }] } : {};
}

/** Every call the fleet holds for him, past the panel's limit, each with its question. Pure. */
export function callItems(fleet: FleetArtefact | undefined, options: ComposeOptions = {}): ShowItem[] {
  if (!fleet || fleet.unavailable) return [];
  return fleet.calls.filter((row) => !row.ledgerOnly).flatMap((row, index) => gatedItem(rowItem("call", `call-${row.task ?? index}`, row, options)) ?? []);
}

/** Every job a worker is on right now, the longest running first. Pure. */
export function underwayItems(fleet: FleetArtefact | undefined, options: ComposeOptions = {}): ShowItem[] {
  if (!fleet || fleet.unavailable) return [];
  const since = (row: ArtefactRow) => (row.started ? Date.parse(row.started) : Number.POSITIVE_INFINITY);
  return [...fleet.live].sort((a, b) => since(a) - since(b)).flatMap((row, index) => gatedItem(rowItem("live", `live-${row.task ?? index}`, row, options)) ?? []);
}

/** How many finished jobs the Done list carries; the page shows a few and a "Show all" for the rest. */
export const DONE_LIMIT = 40;

/** Work that landed, newest first, one line each. Pure. */
export function doneItems(fleet: FleetArtefact | undefined, options: ComposeOptions = {}, limit = DONE_LIMIT): ShowItem[] {
  if (!fleet || fleet.unavailable) return [];
  const when = (row: ArtefactRow) => (row.at ? Date.parse(row.at) : 0);
  return [...fleet.landed].sort((a, b) => when(b) - when(a)).slice(0, limit)
    .flatMap((row, index) => gatedItem(rowItem("landed", `landed-${row.task ?? index}`, row, options)) ?? []);
}

/** Finished work that waits to land, newest first, one line each. Pure. */
export function readyItems(fleet: FleetArtefact | undefined, options: ComposeOptions = {}): ShowItem[] {
  if (!fleet || fleet.unavailable) return [];
  const when = (row: ArtefactRow) => (row.at ? Date.parse(row.at) : 0);
  // Whether it is worth his screen is Flyd's judgment (importance-judge.ts), not its age.
  return [...fleet.ready].filter((row) => row.status !== "report available").sort((a, b) => when(b) - when(a))
    .flatMap((row, index) => rowItem("ready", `ready-${row.task ?? index}`, row, options) ?? []);
}

/** Work that stopped — paused, failed, gone quiet — newest first, one line each. Pure. */
export function heldItems(fleet: FleetArtefact | undefined, options: ComposeOptions = {}): ShowItem[] {
  if (!fleet || fleet.unavailable) return [];
  const when = (row: ArtefactRow) => (row.at ? Date.parse(row.at) : 0);
  return [...fleet.held].sort((a, b) => when(b) - when(a))
    .flatMap((row, index) => gatedItem(rowItem("waiting", `held-${row.task ?? index}`, row, options), aboutRow("waiting", row)) ?? []);
}

/** Work queued next, in the fleet's own order, one line each. Pure. */
export function nextItems(fleet: FleetArtefact | undefined, options: ComposeOptions = {}): ShowItem[] {
  if (!fleet || fleet.unavailable) return [];
  return fleet.next.flatMap((row, index) => rowItem("next", `next-${row.task ?? index}`, row, options) ?? []);
}

/** Every piece of work that landed this week, uncapped, newest first, one line each. Pure. */
export function weekLandedItems(inputs: ArtefactInputs | undefined, options: ComposeOptions = {}): ShowItem[] {
  return (inputs?.landedWeek ?? []).flatMap((row, index) => rowItem("landed", `landed-week-${row.task ?? index}`, row, options) ?? []);
}

/** When a task's worker was started: firstmate stamps its spawn as `spawn_gen=s<epoch>.…` in the task's meta. Pure. */
export function workerStarted(meta: string): string | undefined {
  const epoch = /^spawn_gen=s(\d{9,11})\b/m.exec(meta)?.[1];
  return epoch ? new Date(Number(epoch) * 1000).toISOString() : undefined;
}

/** How many plans the artefact shows at once. */
export const PLAN_LIMIT = 3;
/** Points a plan's card line carries before it stops being glanceable. */
const PLAN_POINTS = 4;
const PLAN_POINTS_CHARS = 240;

/** How long a plan stays on the panel after it was made. */
const PLAN_SHOWN_MS = 7 * 24 * 60 * 60 * 1000;
const PLAN_CLOSED = new Set(["done", "abandoned"]);

/** The plans he made this week that are still open, bounded for the panel: outcome, and the checkable points when it has them. Pure. */
export function planArtefacts(plans: Plan[], now: number): PlanArtefact[] {
  return plans.filter((plan) => {
    const created = Date.parse(plan.created);
    return !PLAN_CLOSED.has(plan.status.toLowerCase()) && now - created < PLAN_SHOWN_MS;
  }).map((plan) => {
    const line = plan.phases.flatMap((phase) => phase.doneWhen).slice(0, PLAN_POINTS).join("; ").slice(0, PLAN_POINTS_CHARS);
    return {
      id: plan.filename,
      headline: plan.outcome || plan.topic,
      ...(line ? { points: line } : {}),
      ...(plan.status ? { status: plan.status } : {}),
      ...(plan.created ? { at: plan.created } : {}),
    };
  });
}

/** A call the fleet no longer reports: its card stays where it was, with nothing left to do. */
const SETTLED_CALL = "Settled, nothing needed.";

/** Compose the panel's items from the inputs, in priority order, each one through the gate. Pure. */
export function composeArtefact(inputs: ArtefactInputs, options: ComposeOptions = {}): ShowItem[] {
  const items: ShowItem[] = [];
  const shown = (item: ShowItem | undefined, about?: GeorgeKind): void => {
    const gated = gatedItem(item, about);
    if (gated) items.push(gated);
  };
  const add = (kind: ShowKind, id: string, headline: string, why: string, extra: Partial<ShowItem> = {}): void => {
    if (headline) shown({ id: `${kind}:${id}`, kind, headline, why, ...extra });
  };
  const fromRow = (kind: ShowKind, id: string, row: ArtefactRow, about: GeorgeKind): void => {
    const item = rowItem(kind, id, row, options);
    if (!item || kind !== "call" || !row.ledgerOnly) {
      shown(item, about);
      return;
    }
    const { decision: _decision, status: _status, ...settled } = item;
    shown({ ...settled, kind: "clear", detail: SETTLED_CALL }, about);
  };
  const rowsOf = (kind: keyof typeof ARTEFACT_LIMITS, list: ArtefactRow[] | undefined): void => {
    (kind === "call" ? shownCalls(list) : shownRows(list, ARTEFACT_LIMITS[kind])).forEach((row, index) =>
      fromRow(row.status === "report available" ? "news" : kind, `${kind}-${row.task ?? index}`, row, aboutRow(kind, row)));
  };

  const fleet = inputs.fleet;
  // Unlinked WhatsApp leads: it is one step only he can take, and it goes the moment it is done.
  if (inputs.whatsappLink) add("news", WHATSAPP_LINK.id, WHATSAPP_LINK.title, "only you can link it", { detail: WHATSAPP_LINK.line, links: [{ label: "Open the code", url: WHATSAPP_LINK.url }] });
  rowsOf("call", fleet?.calls);
  rowsOf("live", fleet?.live);
  rowsOf("ready", fleet?.ready);
  rowsOf("landed", fleet?.landed);
  rowsOf("waiting", fleet?.held);
  rowsOf("next", fleet?.next);
  const beforeMemory = items.length;
  inputs.memories.slice(0, 1).forEach((line, index) => add("news", `memory-${index}`, line, "from your memory"));
  const memoryCount = items.length - beforeMemory;
  inputs.news.slice(0, 1).forEach((item, index) => add("news", `news-${index}`, item.title, item.why || "from the news", withLink(item.url)));
  // Plans he made come last: they wait on his /land, so they never lead urgent work.
  (inputs.plans ?? []).slice(0, PLAN_LIMIT).forEach((plan) => add("plan", plan.id, plan.headline, "a plan you made", {
    ...(plan.points ? { detail: plan.points } : {}),
    ...(plan.status ? { status: plan.status } : {}),
    ...(plan.at ? { at: plan.at } : {}),
  }));
  // A lone memory line is not a screen: drop it when nothing else earned a place beside it.
  if (items.length === memoryCount) items.splice(beforeMemory, memoryCount);
  return items;
}

const VOICED: Array<[keyof Pick<FleetArtefact, "calls" | "live" | "ready" | "landed" | "held">, keyof typeof ARTEFACT_LIMITS, string]> = [
  ["calls", "call", "needs you"],
  ["live", "live", "under way"],
  ["ready", "ready", "waiting to land"],
  ["landed", "landed", "landed"],
  ["held", "waiting", "held up"],
];

function voiceItem(row: ArtefactRow, kind: string): VoiceItem {
  return {
    kind: row.status === "report available" ? "report available" : kind,
    title: row.label,
    ...(row.detail ? { detail: row.detail } : {}),
    ...(row.status ? { status: row.status } : {}),
    ...(row.repo ? { project: row.repo } : {}),
    ...(row.context ? { context: row.context } : {}),
  };
}

/** The rows the artefact can show, each with Flyd's words when it has them; and the rows still unsaid. */
export function withVoice(
  fleet: FleetArtefact,
  said: (item: VoiceItem) => Said | undefined,
  lastSaid: (kind: string, task: string) => Said | undefined = () => undefined,
): { fleet: FleetArtefact; unsaid: VoiceItem[] } {
  if (fleet.unavailable) return { fleet, unsaid: [] };
  const next: FleetArtefact = { ...fleet };
  const unsaid: VoiceItem[] = [];
  for (const [field, limit, kind] of VOICED) {
    // Every call and every job under way is said: the conversation lists them all, not just the panel's few.
    const shown = new Set(shownRows(fleet[field], field === "calls" || field === "live" ? Number.POSITIVE_INFINITY : ARTEFACT_LIMITS[limit]));
    next[field] = fleet[field].map((row) => {
      if (!shown.has(row)) return row;
      const item = voiceItem(row, kind);
      const words = said(item);
      if (!words) unsaid.push(item);
      const showing = words ?? (row.task ? lastSaid(item.kind, row.task) : undefined);
      return showing ? { ...row, said: showing } : row;
    });
  }
  return { fleet: next, unsaid };
}

/** No more than this many landed rows from one project, so one busy repository never fills the screen. */
export const LANDED_PER_REPO = 3;

/** Recently finished work with pictures of it, as landed rows, the most recently pictured first. Pure. */
export function landedRows(recent: Array<{ task: string; entry: BacklogEntry }>, extras: Map<string, TaskExtra>): ArtefactRow[] {
  const at = (task: string) => extras.get(task)?.shotAt ?? extras.get(task)?.at ?? "";
  const perRepo = new Map<string, number>();
  return recent
    .filter(({ task }) => extras.get(task)?.shots?.length)
    .sort((a, b) => at(b.task).localeCompare(at(a.task)))
    .filter(({ entry }) => {
      const seen = perRepo.get(entry.repo ?? "") ?? 0;
      perRepo.set(entry.repo ?? "", seen + 1);
      return seen < LANDED_PER_REPO;
    })
    .map(({ task, entry }) => ({
      label: entry.title,
      task,
      status: "landed",
      ...(entry.repo ? { repo: entry.repo } : {}),
      ...(entry.url ? { url: entry.url } : {}),
    }));
}

function reason(error: unknown): string {
  const message = (error instanceof Error ? error.message : String(error))
    .replace(/Command failed:[^\n]*/gi, " ")
    .replace(/(?:^|[\s("'=])(?:~|\/)[^\s;,)'"]*/g, " ");
  return message.replace(/\s+/g, " ").trim().slice(0, 120) || "no reason given";
}

/** After a job reports, how long to wait for its other records to settle before reading the fleet again. */
const REPORT_SETTLE_MS = 2_000;
/** The fleet is read at most this often when jobs report: the bearings script is not free. */
const REPORT_GAP_MS = 15_000;
/** How long the bearings script may take before its read is abandoned; it runs long on a loaded machine. */
const FLEET_READ_TIMEOUT_MS = 60_000;
/** The most a read is given however slow the last one was. */
const FLEET_READ_MAX_TIMEOUT_MS = 180_000;
/** How long the last good read stands in for reads that fail: transient failures change nothing on screen. */
const FLEET_LAST_GOOD_MS = 30 * 60_000;

/** A read's time limit: three times the last good read's duration, never under the default nor over the bound. Pure. */
export function fleetReadTimeout(lastDurationMs: number | undefined): number {
  return Math.min(FLEET_READ_MAX_TIMEOUT_MS, Math.max(FLEET_READ_TIMEOUT_MS, 3 * (lastDurationMs ?? 0)));
}

/**
 * Runs the bearings script in its own process group. On timeout the whole group
 * is killed: the script's work runs in children it waits on, and killing only
 * the shell left them running, slowing every later read until those timed out too.
 * Rejects with why it failed, carrying no command line.
 */
function runFleetScript(script: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(script, ["--json"], { detached: true, stdio: ["ignore", "pipe", "pipe"] });
    } catch (error) {
      reject(error);
      return;
    }
    const out: Buffer[] = [];
    let outBytes = 0;
    let err = "";
    let failure: string | undefined;
    const killGroup = (signal: NodeJS.Signals) => {
      try {
        if (child.pid) process.kill(-child.pid, signal);
      } catch {
        // Already gone.
      }
    };
    const stop = (why: string) => {
      failure ??= why;
      killGroup("SIGTERM");
      setTimeout(() => killGroup("SIGKILL"), 2_000).unref();
    };
    const timer = setTimeout(() => stop(`timed out after ${Math.round(timeoutMs / 1000)}s`), timeoutMs);
    child.stdout?.on("data", (chunk: Buffer) => {
      outBytes += chunk.length;
      if (outBytes > 4 * 1024 * 1024) stop("its output was too large");
      else out.push(chunk);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      if (err.length < 2_000) err += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (failure) return reject(new Error(failure));
      if (code === 0) return resolve(Buffer.concat(out).toString("utf8"));
      const said = err.trim().split("\n").at(-1) ?? "";
      reject(new Error(`${signal ? `killed by ${signal}` : `exited ${code}`}${said ? `: ${said}` : " with nothing on stderr"}`));
    });
  });
}

/** The snapshot's JSON, read past any stray lines printed around it. */
function bearingsJson(out: string): unknown {
  try {
    return JSON.parse(out);
  } catch (error) {
    const start = out.indexOf("{");
    const end = out.lastIndexOf("}");
    if (start < 0 || end <= start) throw error;
    return JSON.parse(out.slice(start, end + 1));
  }
}
/** How long an artefact the screen has shown stays once nothing reports it, before it ages out. */
const LEDGER_KEEP_MS = RECENT_DAYS * 86_400_000;

/**
 * Whether the staff's record of a pending call's task says it was overtaken
 * (see overtaken.ts), and the note that tells the staff to close one that was.
 */
export interface OvertakenCheck {
  /** What overtook the call, or undefined while it may still be live. */
  check(entry: BacklogEntry | undefined, row: ArtefactRow, entries: Map<string, BacklogEntry>): string | undefined | Promise<string | undefined>;
  /** Tells the staff to close it; rejects when they did not take the note. */
  close(row: ArtefactRow, why: string): Promise<void>;
}

/**
 * One raising of a call: when it was raised and what it asks, then its task.
 * A status line never changes it; the call reopened with what changed does. Pure.
 */
export function callId(row: ArtefactRow): string {
  const asked = createHash("sha256").update(`${row.raised ?? ""}\0${row.detail ?? row.label}`).digest("hex").slice(0, 12);
  return `${asked}-${row.task ?? ""}`;
}

/** Runs the bearings script and reads the other three inputs. Bounded; never throws. */
export class ArtefactFeed {
  private inputs: ArtefactInputs = EMPTY_ARTEFACT;
  /** Screenshots the page may load, by task: only files listed here are ever served. */
  private shots = new Map<string, Set<string>>();
  private timer?: NodeJS.Timeout;
  private watcher?: FSWatcher;
  private soon?: NodeJS.Timeout;
  private lastRefresh = 0;
  /** A job reported while the fleet was being read: read it again when that read is done. */
  private again = false;
  private refreshing = false;
  private generation = 0;
  /** The artefacts the screen has shown, so a refresh adds or updates them rather than resetting the view. */
  private readonly ledger = new Map<string, LedgerEntry>();
  private ledgerLoaded = false;
  /** The last words Flyd said for each task on screen, shown while new ones are asked for. */
  private lastSaid = new Map<string, Said>();
  private readonly listeners = new Set<() => void>();
  /** Calls already found overtaken and closed with the staff, by callId: kept out of Needs you. */
  private readonly overtaken = new Map<string, string>();
  /** The last good bearings JSON, when it was read and how long the read took. */
  private good?: { raw: unknown; at: number; durationMs?: number };
  /** The fleet read in progress, shared by anyone who asks while it runs. */
  private reading?: Promise<FleetArtefact>;

  /** Notices and replies use the same decision owner as polled fleet changes. */
  decide(changes: FirstmateChange[]): Promise<ExecutiveDecisionRecord[]> | null {
    return this.options.decideChanges?.(changes) ?? null;
  }

  constructor(
    private readonly options: {
      home?: string;
      memoryFile?: string;
      newsFile?: string;
      tasteFile?: string;
      /** The plans folder; under vitest the real one is never read unless a test passes this. */
      plansDir?: string;
      /** The persisted artefact list; under vitest a temp file is used unless a test passes this. */
      artefactsFile?: string;
      /** Flyd's model, to say each row in its own words. */
      voice?: ArtefactVoice;
      /** Every FirstMate change must receive a Core decision before it can reach a surface. */
      decideChanges?: (changes: FirstmateChange[]) => Promise<ExecutiveDecisionRecord[]>;
      /** Reads whether old calls were overtaken; without it every call is shown. */
      overtaken?: OvertakenCheck;
      intervalMs?: number;
      timeoutMs?: number;
    } = {},
  ) {}

  current(): ArtefactInputs {
    return this.inputs;
  }

  onRefresh(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Under vitest the real firstmate home and Flyd dir are never read. */
  private paths() {
    const home = this.options.home ?? firstmateHome();
    return {
      home,
      backlog: join(home, "data", "backlog.md"),
      archive: join(home, "data", "done-archive.md"),
      memory: this.options.memoryFile ?? join(FLYD_DIR, "MEMORY.md"),
      news: this.options.newsFile ?? join(FLYD_DIR, "scout", "edition-latest.json"),
      taste: this.options.tasteFile ?? join(FLYD_DIR, "TASTE.md"),
      plans: this.options.plansDir ?? (process.env.VITEST ? join(home, "no-plans") : PLANS_DIR),
    };
  }

  private static async text(file: string): Promise<string> {
    try {
      return await readFile(file, "utf8");
    } catch {
      return "";
    }
  }

  /** Where the last good snapshot is kept, beside the artefact list, so a restart or a second view shares it. */
  private lastGoodPath(): string {
    return join(dirname(this.ledgerPath()), "fleet-last-good.json");
  }

  /** The last good read, from memory or disk, while it is recent enough to stand in for a failed one. */
  private lastGood(now: number): { raw: unknown; at: number } | undefined {
    if (!this.good) {
      try {
        const stored = JSON.parse(readFileSync(this.lastGoodPath(), "utf8")) as { raw?: unknown; at?: unknown; durationMs?: unknown };
        if (stored.raw && Number.isFinite(Number(stored.at))) {
          this.good = { raw: stored.raw, at: Number(stored.at), durationMs: Number(stored.durationMs) || undefined };
        }
      } catch {
        // No good read kept yet.
      }
    }
    return this.good && now - this.good.at <= FLEET_LAST_GOOD_MS ? this.good : undefined;
  }

  private keepGood(raw: unknown, at: number, durationMs: number): void {
    this.good = { raw, at, durationMs };
    try {
      const file = this.lastGoodPath();
      mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
      const temp = `${file}.${process.pid}.tmp`;
      writeFileSync(temp, JSON.stringify(this.good), { mode: 0o600 });
      renameSync(temp, file);
    } catch (error) {
      console.warn(`[view] could not keep the fleet snapshot: ${reason(error)}`);
    }
  }

  /** One read at a time: a caller that comes while one runs shares it rather than starting the script again. */
  private readFleet(): Promise<FleetArtefact> {
    this.reading ??= this.readFleetOnce().finally(() => {
      this.reading = undefined;
    });
    return this.reading;
  }

  private async readFleetOnce(): Promise<FleetArtefact> {
    const script = join(this.paths().home, "bin", "fm-bearings-snapshot.sh");
    const started = Date.now();
    this.lastGood(started);
    const timeout = this.options.timeoutMs ?? fleetReadTimeout(this.good?.durationMs);
    try {
      const raw = bearingsJson(await runFleetScript(script, timeout));
      const fleet = parseBearings(raw);
      if (fleet.unavailable) throw new Error(fleet.unavailable);
      this.keepGood(raw, Date.now(), Date.now() - started);
      if (!process.env.VITEST) {
        try {
          syncFleetFollowups(fleet.held.flatMap((row) => row.task ? [{ id: row.task, task: row.label, status: row.status ?? "" }] : []));
        } catch (error) {
          console.warn(`[view] fleet follow-ups not filed: ${reason(error)}`);
        }
      }
      return fleet;
    } catch (error) {
      // A read that failed is Flyd's own hiccup: the reason goes to Flyd's log, never to George.
      // While the last good read is recent it stands in unchanged, so a transient failure makes
      // nothing vanish and come back (and no call ring the island again).
      const good = this.lastGood(Date.now());
      const standIn = good ? parseBearings(good.raw) : undefined;
      if (good && standIn && !standIn.unavailable) {
        console.warn(`[view] fleet snapshot unreadable: ${reason(error)}; showing the read from ${Math.round((Date.now() - good.at) / 1000)}s ago`);
        return standIn;
      }
      console.warn(`[view] fleet snapshot unreadable: ${reason(error)}`);
      return FLEET_UNAVAILABLE("unreadable");
    }
  }

  /** Where the artefact list is kept, so the screen survives a restart and never resets under him. */
  private ledgerPath(): string {
    if (this.options.artefactsFile) return this.options.artefactsFile;
    if (process.env.VITEST) return join(this.paths().home, "artefacts.json");
    return join(FLYD_DIR, "view", "artefacts.json");
  }

  /** Loads the list once, so the first screen after a restart is the one he last saw. */
  private loadLedger(): void {
    if (this.ledgerLoaded) return;
    this.ledgerLoaded = true;
    try {
      const stored = JSON.parse(readFileSync(this.ledgerPath(), "utf8")) as { rows?: unknown };
      for (const raw of Array.isArray(stored.rows) ? stored.rows : []) {
        const entry = raw as { field?: unknown; seenAt?: unknown; firstSeen?: unknown; row?: unknown; ledgerOnly?: unknown; asked?: unknown };
        const field = str(entry.field) as FleetField;
        const row = entry.row as ArtefactRow;
        if (!FLEET_FIELDS.includes(field) || !row || typeof row !== "object" || !row.label) continue;
        const key = ledgerKey(field, row);
        const seenAt = Number(entry.seenAt) || 0;
        if (key) this.ledger.set(key, { field, row, seenAt, firstSeen: Number(entry.firstSeen) || seenAt, ledgerOnly: entry.ledgerOnly === true, asked: entry.asked === true });
      }
    } catch {
      // No list yet, or an unreadable one: start empty rather than fail the screen.
    }
  }

  private saveLedger(): void {
    try {
      const file = this.ledgerPath();
      mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
      const temp = `${file}.${process.pid}.tmp`;
      writeFileSync(temp, JSON.stringify({ rows: [...this.ledger.values()] }), { mode: 0o600 });
      renameSync(temp, file);
    } catch (error) {
      console.warn(`[view] could not save the artefact list: ${reason(error)}`);
    }
  }

  /** Folds a fresh read into the list: rows are added or updated in place, and only age out once reported no more. */
  private mergeLedger(incoming: FleetArtefact, now: number, prune: boolean): FleetArtefact {
    // One row per thing: a thing the read lists in two sections keeps the earliest, a call leading,
    // so a collision never drops a call; and this read's rows keep its own order, ahead of rows only
    // the list still holds, so a newly queued item is never pushed off by older entries.
    const merged = new Map<string, LedgerEntry>();
    const reported = new Set<string>();
    const reportedCall = (field: FleetField, row: ArtefactRow) => field !== "calls" && reported.has(ledgerKey("calls", row) ?? "");
    for (const field of FLEET_FIELDS) {
      for (const row of incoming[field]) {
        const key = ledgerKey(field, row);
        const known = key ? this.ledger.get(key) : undefined;
        if (key && !merged.has(key) && !reportedCall(field, row)) merged.set(key, { field, row, seenAt: now, firstSeen: known?.firstSeen || known?.seenAt || now, ledgerOnly: false, asked: known?.asked === true });
      }
      if (field === "calls") for (const key of merged.keys()) reported.add(key);
    }
    for (const [key, entry] of this.ledger) {
      if (merged.has(key) || reportedCall(entry.field, entry.row) || (prune && entry.field === "calls" && !entry.asked)) continue;
      merged.set(key, { ...entry, ...(prune ? { ledgerOnly: true } : {}) });
    }
    if (prune) for (const [key, entry] of merged) if (now - entry.seenAt > LEDGER_KEEP_MS) merged.delete(key);
    this.ledger.clear();
    for (const [key, entry] of merged) this.ledger.set(key, entry);
    return { ...this.ledgerFleet(incoming.generated), changes: incoming.changes };
  }

  /** The accumulated list as the fleet the screen reads, this read's rows first, ledger-only rows after. */
  private ledgerFleet(generated?: string): FleetArtefact {
    const fleet: FleetArtefact = { ...emptyFleet(), ...(generated ? { generated } : {}) };
    for (const entry of this.ledger.values()) {
      // A landed row with no time of its own is dated by when Flyd first saw it, so it sorts and ages honestly.
      const dated = entry.field === "landed" && !entry.row.at && entry.firstSeen ? { ...entry.row, at: new Date(entry.firstSeen).toISOString() } : entry.row;
      fleet[entry.field].push(entry.ledgerOnly ? { ...dated, ledgerOnly: true } : dated);
    }
    return fleet;
  }

  /** The absolute path of a screenshot the artefact listed, or null for anything else. */
  shotPath(task: string, file: string): string | null {
    if (!this.shots.get(task)?.has(file)) return null;
    return join(this.paths().home, "data", task, file);
  }

  /** Each task's last report time and its screenshots, newest "after" shots first. Bounded. */
  private async extras(tasks: string[]): Promise<Map<string, TaskExtra>> {
    const { home } = this.paths();
    const extras = new Map<string, TaskExtra>();
    await Promise.all(tasks.filter((task) => /^[\w.-]+$/.test(task) && !task.startsWith(".")).map(async (task) => {
      const extra: TaskExtra = {};
      const status = join(home, "state", `${task}.status`);
      try {
        const started = workerStarted(await readFile(join(home, "state", `${task}.meta`), "utf8"));
        if (started) extra.started = started;
      } catch {
        // No record of the worker: no start time to show.
      }
      try {
        extra.at = (await stat(status)).mtime.toISOString();
        const last = (await readFile(status, "utf8")).trim().split("\n").at(-1) ?? "";
        if (last) extra.note = statusNote(last);
      } catch {
        // No status file: no time or note to show.
      }
      const dir = join(home, "data", task);
      try {
        const names = (await readdir(dir, { recursive: true })).slice(0, 400);
        const files = await Promise.all(names
          .filter((name) => IMAGE.has(extname(name).toLowerCase()) && name.split(sep).length <= 3)
          .map(async (name) => {
            const info = await stat(join(dir, name));
            return { path: relative(dir, join(dir, name)).split(sep).join("/"), mtime: info.mtimeMs, size: info.size };
          }));
        const shots = pickShots(files);
        if (shots.length) {
          extra.shots = shots;
          extra.shotAt = new Date(Math.max(...files.filter((file) => shots.includes(file.path)).map((file) => file.mtime))).toISOString();
          // Without a status report, when its pictures were taken says how recent it is.
          extra.at ??= extra.shotAt;
        }
      } catch {
        // No data directory: no screenshots.
      }
      if (extra.at || extra.shots) extras.set(task, extra);
    }));
    return extras;
  }

  async refresh(): Promise<void> {
    if (this.refreshing) {
      this.again = true;
      return;
    }
    this.refreshing = true;
    this.again = false;
    this.lastRefresh = Date.now();
    try {
      const { backlog, archive, memory, news, taste, plans: plansDir } = this.paths();
      const [bearings, backlogText, archiveText, memoryText, newsText, tasteText] = await Promise.all([
        this.readFleet(),
        ArtefactFeed.text(backlog),
        ArtefactFeed.text(archive),
        ArtefactFeed.text(memory),
        ArtefactFeed.text(news),
        ArtefactFeed.text(taste),
      ]);
      // Flyd's to repair, never his to read: recorded, and read again on the next tick.
      if (bearings.unavailable) recordKept("fleet read", { kind: "fault", handle: "repair" }, bearings.unavailable);
      let newsRaw: unknown;
      try {
        newsRaw = JSON.parse(newsText);
      } catch {
        newsRaw = undefined;
      }
      // Done rows move to the archive; the live backlog wins for a task in both.
      const entries = new Map([...parseBacklog(archiveText), ...parseBacklog(backlogText)]);
      const listed = [bearings.calls, bearings.live, bearings.ready, bearings.landed, bearings.held, bearings.next]
        .flat().map((row) => row.task).filter((task): task is string => Boolean(task));
      // Finished work is shown whether or not the fleet read succeeded: a failed read never empties the screen.
      const recent = recentlyFinished(entries, Date.now()).filter(({ task }) => !listed.includes(task)).slice(0, 30);
      const referenced = bearings.calls.flatMap((row) => {
        const entry = row.task ? entries.get(row.task) : undefined;
        return entry ? referencedDirs(entry) : [];
      });
      const extras = await this.extras([...new Set([...listed, ...recent.map(({ task }) => task), ...referenced])]);
      this.shots = new Map([...extras].map(([task, extra]) => [task, new Set(extra.shots ?? [])]));
      const withRecent: FleetArtefact = { ...bearings, landed: [...bearings.landed, ...landedRows(recent, extras)] };
      // The screen is an accumulating list, persisted: a refresh adds or updates rows, and a read that fails drops nothing.
      this.loadLedger();
      const merged = this.mergeLedger(withRecent, Date.now(), !bearings.unavailable);
      const content = bearings.unavailable && !FLEET_FIELDS.some((field) => merged[field].length) ? FLEET_UNAVAILABLE("unreadable") : merged;
      const allQuestions = enrichFleet(content, entries, extras, Date.now(), { includeUnclassifiedCalls: Boolean(this.options.decideChanges) });
      const enriched = await this.withoutOvertaken(allQuestions, entries);
      const decided = this.options.decideChanges
        ? projectFleetDecisions(enriched, await this.options.decideChanges(firstmateChangesFromFleet(enriched)).catch((error: unknown) => {
          console.warn(`[view] executive decision step failed: ${reason(error)}`);
          return [];
        }), heldForAttention())
        : enriched;
      decided.calls = decided.calls.map((row) => ({ ...row, label: callHeadline(row.label, row.task ? entries.get(row.task)?.title : undefined) }));
      for (const row of decided.calls) {
        const entry = row.ledgerOnly ? undefined : this.ledger.get(ledgerKey("calls", row) ?? "");
        if (entry) Object.assign(entry, { asked: true, row });
      }
      this.saveLedger();
      const voice = this.options.voice;
      const generation = ++this.generation;
      const { fleet, unsaid } = voice && !this.options.decideChanges ? this.voiced(voice, decided) : { fleet: decided, unsaid: [] };
      this.inputs = {
        fleet,
        ...(bearings.unavailable ? {} : { landedByDay: landedByDay(entries, Date.now()), landedWeek: weekLandedRows(entries, Date.now()) }),
        memories: memoryHighlights(memoryText),
        news: newsHighlights(newsRaw),
        taste: tasteHighlights(tasteText),
        plans: planArtefacts(readPlans(plansDir), Date.now()),
      };
      for (const listener of this.listeners) listener();
      if (voice && !this.options.decideChanges && unsaid.length) void this.say(voice, decided, unsaid, generation);
    } finally {
      this.refreshing = false;
      if (this.again) this.refreshSoon();
    }
  }

  /**
   * The fleet with the calls the work has moved past settled: George is never
   * asked a question the record already answers. Each is closed with the
   * staff once.
   */
  private async withoutOvertaken(fleet: FleetArtefact, entries: Map<string, BacklogEntry>): Promise<FleetArtefact> {
    const check = this.options.overtaken;
    if (!check || fleet.unavailable) return fleet;
    const calls = fleet.calls.filter((row) => !row.ledgerOnly).map((row) => ({ row, call: callId(row) }));
    for (const call of this.overtaken.keys()) if (!calls.some((item) => item.call === call)) this.overtaken.delete(call);
    const verdicts = await Promise.all(calls.map(async ({ row, call }) => {
      if (!row.task) return undefined;
      const known = this.overtaken.get(call);
      if (known) return known;
      const why = await check.check(entries.get(row.task), row, entries);
      if (!why) return undefined;
      // A call the staff were not told to close stays in front of him.
      const closed = await check.close(row, why).then(() => true, () => false);
      if (!closed) return undefined;
      this.overtaken.set(call, why);
      return why;
    }));
    const closed = new Set<ArtefactRow>();
    calls.forEach(({ row }, index) => { if (verdicts[index]) closed.add(row); });
    const closedTasks = new Set([...closed].map((row) => row.task));
    return {
      ...fleet,
      // The staff's own decision change for a settled call never reaches Core either.
      ...(fleet.changes ? { changes: fleet.changes.filter((change) => !(change.kind === "decision" && closedTasks.has(change.taskId))) } : {}),
      calls: fleet.calls.flatMap((row) => {
        if (!closed.has(row)) return [row];
        return this.ledger.get(ledgerKey("calls", row) ?? "")?.asked ? [{ ...row, ledgerOnly: true }] : [];
      }),
    };
  }

  /**
   * A job reported (firstmate appends a status line, or records a new worker):
   * the fleet is read again within seconds, not at the next two-minute tick.
   */
  private refreshSoon(): void {
    if (this.soon) return;
    const wait = Math.max(REPORT_SETTLE_MS, this.lastRefresh + REPORT_GAP_MS - Date.now());
    this.soon = setTimeout(() => {
      this.soon = undefined;
      void this.refresh();
    }, wait);
    this.soon.unref?.();
  }

  /** Reads the fleet again as soon as a job reports; start() does this, and tests call it directly. */
  followReports(): void {
    try {
      this.watcher = watch(join(this.paths().home, "state"), (_event, name) => {
        if (name && /\.(?:status|meta)$/.test(String(name))) this.refreshSoon();
      });
      this.watcher.on("error", () => {
        this.watcher?.close();
        this.watcher = undefined;
      });
      this.watcher.unref?.();
    } catch {
      // No state folder to watch: the timer alone keeps the fleet fresh.
    }
  }

  /** Asks Flyd's model for the rows it has not said yet, then shows its words. */
  private async say(voice: ArtefactVoice, enriched: FleetArtefact, unsaid: VoiceItem[], generation: number): Promise<void> {
    if (!(await voice.request(unsaid))) return;
    if (generation === this.generation) {
      this.inputs = { ...this.inputs, fleet: this.voiced(voice, enriched).fleet };
      for (const listener of this.listeners) listener();
    }
  }

  private voiced(voice: ArtefactVoice, enriched: FleetArtefact): { fleet: FleetArtefact; unsaid: VoiceItem[] } {
    const result = withVoice(enriched, (item) => voice.said(item), (kind, task) => this.lastSaid.get(`${kind}:${task}`));
    this.lastSaid = new Map(VOICED.flatMap(([field, , kind]) => result.fleet[field]
      .flatMap((row) => (row.task && row.said ? [[`${voiceItem(row, kind).kind}:${row.task}`, row.said] as [string, Said]] : []))));
    return result;
  }

  /** Start the background refresh; a no-op under vitest. */
  start(): void {
    if (process.env.VITEST || this.timer) return;
    void this.refresh();
    this.timer = setInterval(() => void this.refresh(), this.options.intervalMs ?? 120_000);
    this.timer.unref?.();
    this.followReports();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    if (this.soon) clearTimeout(this.soon);
    this.soon = undefined;
    this.watcher?.close();
    this.watcher = undefined;
  }
}
