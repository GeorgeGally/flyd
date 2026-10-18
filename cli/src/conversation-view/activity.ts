import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { checkSaid } from "../council/chief-of-staff.js";
import { FLYD_DIR } from "../lib/config.js";
import { clip, inline, sentences } from "./summaries.js";
import type { DayCount } from "./artefact.js";
import type { SemanticObject } from "./semantic.js";

// Flyd's left column: what Flyd itself is doing, as cards. Its own background
// work (watching the news, reading back its answers, keeping memory, running
// scheduled tasks and jobs) comes from the records it already keeps; anything
// else that does or decides something for him writes one line to the activity
// record below. Pure where it can be: the same files and clock always give the
// same panel, and nothing here names the machinery behind a card.

export type ActivityKind = "watching" | "decided" | "reviewed" | "news" | "memory" | "routine" | "work" | "done" | "held" | "noted";

/** One story behind a news card: its headline, a one-line gist, and where it came from. */
export interface ActivityStory {
  title: string;
  gist?: string;
  url: string;
  source?: string;
}

export interface ActivityItem {
  id: string;
  kind: ActivityKind;
  /** What Flyd did or is doing, in a few plain words. */
  title: string;
  /** One line of detail, when there is one worth saying. */
  line?: string;
  /** The fuller outcome behind the card, shown only when he opens it. */
  detail?: string;
  /** The actual stories behind a news card, shown only when he opens it. */
  stories?: ActivityStory[];
  at: string;
}

export interface ActivityPanel {
  /** Under way this minute, newest first. */
  now: ActivityItem[];
  /** What it did or decided lately, newest first. */
  recent: ActivityItem[];
  /** How much it did on each of the last seven days, oldest first: the column's little chart. */
  week: DayCount[];
  /** Firstmate jobs as canonical semantic Activities. These stay one object across phases. */
  semantic?: SemanticObject[];
}

/**
 * One line in `~/.flyd/activity/records.jsonl`. This is the interface for work
 * that has no log of its own: watching the staff, a decision made on his
 * behalf. A `now` record with a `key` is under way until a later record with
 * the same key says `done`; a record without a key is a one-off.
 */
export interface ActivityRecord {
  key?: string;
  kind: ActivityKind;
  title: string;
  line?: string;
  state?: "now" | "done";
  at?: string;
}

/** A `now` record nobody ended is stale after this long: the thing that wrote it is gone. */
export const NOW_MAX_AGE_MS = 30 * 60 * 1000;
/** How far back the column looks. */
export const RECENT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
export const MAX_RECENT = 14;
const LINE_LIMIT = 140;
/** How much of the outcome behind a card is kept for when he opens it. */
const DETAIL_LIMIT = 240;

export function activityRecordPath(dir = FLYD_DIR): string {
  return join(dir, "activity", "records.jsonl");
}

/** Appends one record; never throws, because writing a card must not fail the work it describes. */
export function recordActivity(record: ActivityRecord, dir = FLYD_DIR, now = new Date()): void {
  try {
    const path = activityRecordPath(dir);
    mkdirSync(join(dir, "activity"), { recursive: true });
    appendFileSync(path, `${JSON.stringify({ ...record, at: record.at ?? now.toISOString() })}\n`);
  } catch {
    // The column simply lacks the card.
  }
}

const KINDS = new Set<string>(["watching", "decided", "reviewed", "news", "memory", "routine", "work", "noted"]);

/** Whether a line names the machinery behind the work: those words never reach a card. */
function leaks(text: string): boolean {
  return checkSaid({ surface: "status", interactionClass: "work_status", text }).some((item) => item.requirement === "backstage_hidden");
}

/** Free text from a record, a job or an agenda task is shown only when it names no machinery. */
function plainLine(text: string | undefined): string | undefined {
  const lead = clip(sentences(inline(text ?? "").replace(/^\W+/, ""))[0] ?? "", LINE_LIMIT).trim();
  if (!lead) return undefined;
  return leaks(lead) ? undefined : /[.!?…]$/.test(lead) ? lead : `${lead}.`;
}

/**
 * The fuller text behind a card, plain and bounded: the whole outcome, not only
 * its first sentence. Sentences that name the machinery stay out, exactly as on
 * the card's own line, and nothing is kept when it would only repeat that line.
 */
function detailBehind(text: string | undefined, line: string | undefined): string | undefined {
  if (!line) return undefined;
  const said = clip(sentences(inline(text ?? "")).filter((one) => !leaks(one)).join(" "), DETAIL_LIMIT).trim();
  const bare = (one: string): string => one.replace(/[.!?…\s]+$/, "").toLowerCase();
  return said && bare(said) !== bare(line) ? said : undefined;
}

/** What a scheduled task is called: its words up to the colon ("Morning brief: …"), else its first sentence. */
function taskName(task: string): string | undefined {
  const head = /^(.{3,60}?)(?::| [—–-] )/.exec(inline(task))?.[1];
  if (!head) return plainLine(task);
  return plainLine(`${head.replace(/\bfor George\b/, "for you")}.`);
}

function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

interface LogEntry {
  at: string;
  group: string;
  kind: ActivityKind;
  title: string;
  line?: string;
}

/** One line of the agenda log, said plainly; the lines that only report upkeep are dropped. */
export function activityFromLogLine(raw: string): LogEntry | null {
  const match = /^(\d{4}-\d{2}-\d{2}T[\d:.]+Z) (.*)$/.exec(raw.trim());
  if (!match) return null;
  const at = match[1]!;
  const text = match[2]!;
  let found: RegExpExecArray | null;
  if ((found = /^self-review: reviewed, (\d+) reviewed, (\d+) short/.exec(text))) {
    const reviewed = Number(found[1]);
    const short = Number(found[2]);
    if (!reviewed) return null;
    return {
      at, group: "reviewed", kind: "reviewed", title: "Read back its own answers",
      line: short ? `${plural(reviewed, "recent answer")} checked; ${short} to do better on.` : `${plural(reviewed, "recent answer")} checked; all held up.`,
    };
  }
  if ((found = /^scout: watch: (\d+) must-know/.exec(text))) {
    const count = Number(found[1]);
    return { at, group: "watch-news", kind: "news", title: "Watched the news for you", line: count ? `${plural(count, "story", "stories")} you should not miss.` : "Nothing urgent." };
  }
  if ((found = /^scout: edition: (\d+) items/.exec(text))) {
    const count = Number(found[1]);
    return count ? { at, group: "edition", kind: "news", title: "Put together today's news", line: `${plural(count, "story", "stories")} from your sources.` } : null;
  }
  if ((found = /^council: (\d+) turns, (\d+) captures, (\d+) advisories/.exec(text))) {
    const turns = Number(found[1]);
    const notes = Number(found[2]);
    const thoughts = Number(found[3]);
    if (!turns && !notes && !thoughts) return null;
    const read = [turns ? plural(turns, "conversation") : "", notes ? plural(notes, "note") : ""].filter(Boolean).join(" and ");
    return {
      at, group: "memory", kind: "memory", title: "Kept its memory of you up to date",
      line: `${read ? `Read ${read}` : "Read what was new"}${thoughts ? `; ${plural(thoughts, "thing")} worth your attention.` : "."}`,
    };
  }
  if (/^investigator: done/.test(text)) {
    return { at, group: "gaps", kind: "memory", title: "Filled gaps in what it knows about you" };
  }
  if (/^self-improve: dispatched/.test(text)) {
    return { at, group: "improve", kind: "decided", title: "Started fixing something it noticed in itself" };
  }
  if ((found = /^(ok|failed|error) [0-9a-f]{8} (.+)$/.exec(text))) {
    const line = taskName(found[2]!);
    return {
      at, group: `task:${found[2]!.slice(0, 40)}`, kind: "routine",
      title: found[1] === "ok" ? "Ran a scheduled task" : "A scheduled task didn't finish",
      ...(line ? { line } : {}),
    };
  }
  return null;
}

interface JobFile {
  id?: unknown;
  status?: unknown;
  startedAt?: unknown;
  updatedAt?: unknown;
  contract?: { task?: unknown };
  result?: unknown;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function stamp(value: unknown): string | undefined {
  const raw = text(value);
  return raw && !Number.isNaN(Date.parse(raw)) ? raw : undefined;
}

/** A background job, as Flyd says it: under way, or how it ended. */
export function activityFromJob(job: JobFile, now: number): { item: ActivityItem; live: boolean } | null {
  const id = text(job.id);
  const status = text(job.status);
  const asked = text(job.contract?.task);
  const task = plainLine(asked);
  const updated = stamp(job.updatedAt) ?? stamp(job.startedAt);
  if (!id || !status || !updated) return null;
  const running = status === "running" || status === "verifying";
  if (running) {
    // A job left "running" by a crashed process is not under way.
    if (now - Date.parse(updated) > NOW_MAX_AGE_MS) return null;
    const detail = detailBehind(asked, task);
    return { live: true, item: { id: `job:${id}`, kind: "work", title: "Working on a job for you", ...(task ? { line: task } : {}), ...(detail ? { detail } : {}), at: stamp(job.startedAt) ?? updated } };
  }
  const outcome = plainLine(text(job.result));
  const title = status === "ok" ? "Finished a job for you" : status === "failed" || status === "blocked" ? "A job couldn't be finished" : status === "short" ? "Finished a job, with something left open" : "Stopped a job before it finished";
  const line = status === "ok" ? outcome ?? task : task ?? outcome;
  const detail = detailBehind(text(job.result), line);
  const kind = status === "ok" || status === "short" ? "done" : "held";
  return { live: false, item: { id: `job:${id}`, kind, title, ...(line ? { line } : {}), ...(detail ? { detail } : {}), at: updated } };
}

/** The council's thoughts about his projects, kept as one calm card without saying who had them. */
export function activityFromAdvice(entry: { id?: unknown; text?: unknown; at?: unknown; createdAt?: unknown }): ActivityItem | null {
  const id = text(entry.id);
  const at = stamp(entry.at) ?? stamp(entry.createdAt);
  const line = plainLine(text(entry.text));
  if (!id || !at || !line) return null;
  const detail = detailBehind(text(entry.text), line);
  return { id: `thought:${id}`, kind: "noted", title: "Noticed something about your projects", line, ...(detail ? { detail } : {}), at };
}

/** Records, newest word per key: the one-offs as written, the keyed ones as they last stood. */
export function activityFromRecords(records: unknown[], now: number): { now: ActivityItem[]; done: ActivityItem[] } {
  const latest = new Map<string, ActivityRecord & { at: string }>();
  records.forEach((raw, index) => {
    const record = raw as Partial<ActivityRecord> | null;
    const title = text(record?.title);
    const at = stamp(record?.at);
    if (!record || !title || !at || typeof record.kind !== "string" || !KINDS.has(record.kind)) return;
    const key = text(record.key) ?? `once:${index}`;
    const before = latest.get(key);
    if (!before || Date.parse(at) >= Date.parse(before.at)) latest.set(key, { ...record, title, at, kind: record.kind });
  });
  const live: ActivityItem[] = [];
  const done: ActivityItem[] = [];
  for (const [key, record] of latest) {
    const line = plainLine(record.line);
    const detail = detailBehind(record.line, line);
    const item: ActivityItem = { id: `record:${key}`, kind: record.kind, title: record.title.trim(), ...(line ? { line } : {}), ...(detail ? { detail } : {}), at: record.at };
    if (record.state === "now") {
      if (now - Date.parse(record.at) <= NOW_MAX_AGE_MS) live.push(item);
    } else {
      done.push(item);
    }
  }
  return { now: live, done };
}

export interface ActivityInputs {
  log: string[];
  jobs: JobFile[];
  advice: Array<{ id?: unknown; text?: unknown; at?: unknown; createdAt?: unknown }>;
  records: unknown[];
  /** The stories behind today's news cards: the day's edition, and the watch's must-knows. */
  news?: NewsStories;
}

/** The stories a news card opens onto, each bound to the day it belongs to. */
export interface NewsStories {
  edition?: { day: string; stories: ActivityStory[] };
  watch?: { day: string; stories: ActivityStory[] };
}

/** One story from a scout edition item or a flash row, in the terms a news card shows it. Pure. */
function storyOf(raw: unknown): ActivityStory | null {
  const item = raw as Record<string, unknown> | null;
  const title = typeof item?.title === "string" ? item.title.replace(/\s+/g, " ").trim() : "";
  const url = typeof item?.url === "string" ? item.url.trim() : "";
  if (!title || !/^https?:\/\//i.test(url)) return null;
  const gist = typeof item?.why === "string" ? item.why.replace(/\s+/g, " ").trim() : "";
  const source = typeof item?.source === "string" ? item.source.trim() : "";
  return { title, url, ...(gist ? { gist } : {}), ...(source ? { source } : {}) };
}

/** The stories in a scout edition file, or none when it is for another day. Pure. */
export function editionStories(raw: unknown, day: string): { day: string; stories: ActivityStory[] } | undefined {
  const data = raw as { date?: unknown; items?: unknown } | null;
  if (!data || typeof data !== "object" || data.date !== day || !Array.isArray(data.items)) return undefined;
  const stories = data.items.map(storyOf).filter((item): item is ActivityStory => item !== null);
  return stories.length ? { day, stories } : undefined;
}

/** The must-know stories the watch kept for a day. Pure. */
export function flashStories(rows: unknown[], day: string): { day: string; stories: ActivityStory[] } | undefined {
  const stories = rows
    .filter((row) => (row as { date?: unknown } | null)?.date === day)
    .map(storyOf)
    .filter((item): item is ActivityStory => item !== null);
  return stories.length ? { day, stories } : undefined;
}

const byNewest = (a: ActivityItem, b: ActivityItem): number => Date.parse(b.at) - Date.parse(a.at);

const localDay = (date: Date): string => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

/** How much Flyd did on each of the last seven local days, oldest first. Pure. */
export function activityByDay(items: ActivityItem[], now: number): DayCount[] {
  const today = new Date(now);
  const days: DayCount[] = [];
  for (let back = 6; back >= 0; back -= 1) days.push({ day: localDay(new Date(today.getFullYear(), today.getMonth(), today.getDate() - back)), count: 0 });
  for (const item of items) {
    const slot = days.find((each) => each.day === localDay(new Date(item.at)));
    if (slot) slot.count += 1;
  }
  return days;
}

/** The panel: what is under way, then what it did lately. Pure. */
export function composeActivity(inputs: ActivityInputs, now: number): ActivityPanel {
  const live: ActivityItem[] = [];
  const done: ActivityItem[] = [];
  // Upkeep that repeats every few minutes shows once, as its latest run.
  const seen = new Set<string>();
  // The stories behind a news run, only while the card is the day they belong to.
  const storiesOf = (group: string, at: string): ActivityStory[] => {
    const day = localDay(new Date(at));
    const found = group === "edition" ? inputs.news?.edition : group === "watch-news" ? inputs.news?.watch : undefined;
    return found && found.day === day ? found.stories : [];
  };
  for (const raw of [...inputs.log].reverse()) {
    const entry = activityFromLogLine(raw);
    if (!entry || seen.has(entry.group)) continue;
    seen.add(entry.group);
    const stories = storiesOf(entry.group, entry.at);
    done.push({ id: `log:${entry.group}:${entry.at}`, kind: entry.kind, title: entry.title, ...(entry.line ? { line: entry.line } : {}), ...(stories.length ? { stories } : {}), at: entry.at });
  }
  for (const job of inputs.jobs) {
    const made = activityFromJob(job, now);
    if (made) (made.live ? live : done).push(made.item);
  }
  for (const entry of inputs.advice.slice(-2)) {
    const made = activityFromAdvice(entry);
    if (made) done.push(made);
  }
  const written = activityFromRecords(inputs.records, now);
  live.push(...written.now);
  done.push(...written.done);
  const liveIds = new Set(live.map((item) => item.id));
  const cutoff = now - RECENT_WINDOW_MS;
  const nowItems = live.sort(byNewest);
  const windowed = done.filter((item) => !liveIds.has(item.id) && Date.parse(item.at) >= cutoff && Date.parse(item.at) <= now + 60_000).sort(byNewest);
  return {
    now: nowItems,
    recent: windowed.slice(0, MAX_RECENT),
    week: activityByDay([...nowItems, ...windowed], now),
  };
}

function lines(path: string, keep: number): string[] {
  try {
    return readFileSync(path, "utf8").split("\n").filter(Boolean).slice(-keep);
  } catch {
    return [];
  }
}

function jsonLines(path: string, keep: number): unknown[] {
  return lines(path, keep).flatMap((line) => {
    try {
      return [JSON.parse(line) as unknown];
    } catch {
      return [];
    }
  });
}

/** One JSON file's content, or null when it is absent or unreadable. */
function oneJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as unknown;
  } catch {
    return null;
  }
}

export interface ActivityReaderOptions {
  dir?: string;
  pollMs?: number;
  now?: () => number;
}

/** Reads the records Flyd already keeps and tells the page when the panel changed. */
export class ActivityReader {
  private readonly dir: string;
  private readonly pollMs: number;
  private readonly now: () => number;
  private panel: ActivityPanel | null = null;
  private signature = "";
  private readonly listeners = new Set<() => void>();
  private timer: NodeJS.Timeout | undefined;

  constructor(options: ActivityReaderOptions = {}) {
    this.dir = options.dir ?? FLYD_DIR;
    this.pollMs = options.pollMs ?? 15_000;
    this.now = options.now ?? Date.now;
  }

  private jobs(): JobFile[] {
    const folder = join(this.dir, "jobs");
    if (!existsSync(folder)) return [];
    const newest = readdirSync(folder)
      .filter((name) => name.endsWith(".json"))
      .map((name) => ({ name, at: statSync(join(folder, name)).mtimeMs }))
      .sort((a, b) => b.at - a.at)
      .slice(0, 12);
    return newest.flatMap(({ name }) => {
      try {
        return [JSON.parse(readFileSync(join(folder, name), "utf8")) as JobFile];
      } catch {
        return [];
      }
    });
  }

  /** Re-reads everything; returns whether the panel changed. */
  refresh(): boolean {
    const now = this.now();
    const day = localDay(new Date(now));
    const scout = join(this.dir, "scout");
    const panel = composeActivity({
      log: lines(join(this.dir, "logs", "agenda.log"), 600),
      jobs: this.jobs(),
      advice: jsonLines(join(this.dir, "council", "advisories.jsonl"), 4) as ActivityInputs["advice"],
      records: jsonLines(activityRecordPath(this.dir), 300),
      news: {
        edition: editionStories(oneJson(join(scout, "edition-latest.json")), day),
        watch: flashStories(jsonLines(join(scout, "flash.jsonl"), 200), day),
      },
    }, now);
    const signature = JSON.stringify(panel);
    this.panel = panel;
    if (signature === this.signature) return false;
    this.signature = signature;
    return true;
  }

  current(): ActivityPanel {
    if (!this.panel) this.refresh();
    return this.panel!;
  }

  /** Calls back when the panel changes; polls only while someone listens. */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    if (!this.timer) {
      this.current();
      this.timer = setInterval(() => {
        if (this.refresh()) for (const each of this.listeners) each();
      }, this.pollMs);
      this.timer.unref?.();
    }
    return () => {
      this.listeners.delete(listener);
      if (!this.listeners.size && this.timer) {
        clearInterval(this.timer);
        this.timer = undefined;
      }
    };
  }
}
