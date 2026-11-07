import type { ActivityItem, ActivityKind, ActivityPanel } from "./activity.js";
import type { Job } from "./jobs.js";
import type { ShowItem, ShowScreen } from "./show.js";

/**
 * The home page's feed: what is actually happening, newest first. Each note
 * comes from a record Flyd already keeps: work under way, work that landed,
 * the jobs he is moving, what Flyd did itself and where he left off. Nothing here is invented, so a
 * quiet day reaches back to the last days that had something in them. Pure.
 */

export interface TodayNote {
  id: string;
  at: string;
  text: string;
  /** Project or a word on the side, set quieter after the note. */
  aside?: string;
  /** Under way right now. */
  moving?: boolean;
  /** A picture of the work, already a page-safe source. */
  shot?: string;
}

export interface TodayInputs {
  show: Pick<ShowScreen, "underway" | "done" | "landedWeek">;
  /** The job list: it stands even while the fleet has not been read. */
  jobs?: Array<Pick<Job, "id" | "group" | "title" | "at" | "next" | "digest">>;
  activity?: Pick<ActivityPanel, "now" | "recent">;
  /** His other conversations; the newest says where he left off. */
  sessions?: Array<{ id: string; title: string; project?: string; updatedAt: string }>;
  current?: string;
}

export const TODAY_LIMIT = 24;
/** Fewer notes than this today, and the feed reaches further back. */
const ENOUGH_TODAY = 6;
const REACH_MS = 7 * 24 * 60 * 60 * 1000;
const NOTE_CHARS = 180;

/** Upkeep repeats all day and says nothing about his work. */
const UPKEEP: ReadonlySet<ActivityKind> = new Set(["watching", "memory", "reviewed"]);

const dayOf = (ms: number): string => new Date(ms).toDateString();

/** A record dated only by its day is that day where he is, under the notes that have a time. */
const timeOf = (at: string): number => Date.parse(at.length <= 10 ? `${at}T00:00:00` : at);

function clipNote(text: string): string {
  const line = text.replace(/\s+/g, " ").trim();
  if (line.length <= NOTE_CHARS) return line;
  const first = new RegExp(`^.{24,${NOTE_CHARS}}?[.!?](?=\\s|$)`).exec(line);
  if (first) return first[0];
  const cut = line.lastIndexOf(" ", NOTE_CHARS - 1);
  return `${line.slice(0, cut > 60 ? cut : NOTE_CHARS - 1).replace(/[\s,;:-]+$/, "")}…`;
}

const clockOf = (iso: string): string => {
  const at = new Date(iso);
  return `${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`;
};

function movingNote(item: ShowItem): TodayNote | null {
  const at = item.at ?? item.started;
  if (!item.headline || !at) return null;
  const shot = item.shots?.find((one) => one.src)?.src;
  return {
    id: `moving:${item.id}`, at, text: clipNote(item.headline), moving: true,
    ...(item.started ? { aside: `Started ${clockOf(item.started)}.` } : item.project ? { aside: item.project } : {}),
    ...(shot ? { shot } : {}),
  };
}

function landedNote(item: ShowItem): TodayNote | null {
  if (!item.headline || !item.at) return null;
  return { id: `landed:${item.id}`, at: item.at, text: clipNote(item.headline), ...(item.project ? { aside: item.project } : {}) };
}

/** Jobs made by a note about an artefact or an answer: bookkeeping, not news of the day. */
const JOB_BOOKKEEPING = /^(?:about the artefact|answer to pending)\b/i;
const NAME_CHARS = 24;

function jobNote(job: NonNullable<TodayInputs["jobs"]>[number]): TodayNote | null {
  if (!job.at || !job.title || job.group === "waiting" || JOB_BOOKKEEPING.test(job.title)) return null;
  const text = clipNote(job.digest?.changed || job.next || job.title);
  // A short title is the project's name, worth saying beside the note; a long one only says the note again.
  const named = job.title.length <= NAME_CHARS && !text.toLowerCase().startsWith(job.title.toLowerCase());
  return { id: `job:${job.id}`, at: job.at, text, ...(named ? { aside: job.title } : {}), ...(job.group === "working" ? { moving: true } : {}) };
}

function ownNote(item: ActivityItem, moving: boolean): TodayNote | null {
  if (UPKEEP.has(item.kind) || !item.title || !item.at) return null;
  return { id: `own:${item.id}`, at: item.at, text: clipNote(item.title), ...(moving ? { moving: true } : {}) };
}

/** The feed for this moment, newest first. Pure. */
export function todayNotes(inputs: TodayInputs, now: number): TodayNote[] {
  const left = (inputs.sessions ?? []).find((session) => session.id !== inputs.current && session.title);
  const notes: TodayNote[] = [
    ...(inputs.show.underway ?? []).map(movingNote),
    ...[...(inputs.show.done ?? []), ...(inputs.show.landedWeek ?? [])].map(landedNote),
    ...(inputs.jobs ?? []).map(jobNote),
    ...(inputs.activity?.now ?? []).map((item) => ownNote(item, true)),
    ...(inputs.activity?.recent ?? []).map((item) => ownNote(item, false)),
    left ? { id: `left:${left.id}`, at: left.updatedAt, text: `You left off on ${left.project || left.title}.` } : null,
  ].filter((note): note is TodayNote => note !== null && !Number.isNaN(timeOf(note.at)));

  const seen = new Set<string>();
  const unique = notes
    .sort((a, b) => Number(Boolean(b.moving)) - Number(Boolean(a.moving)) || timeOf(b.at) - timeOf(a.at))
    .filter((note) => {
      const key = note.text.toLowerCase();
      if (seen.has(key) || timeOf(note.at) > now + 60_000) return false;
      seen.add(key);
      return true;
    });
  const today = unique.filter((note) => note.moving || dayOf(timeOf(note.at)) === dayOf(now));
  const chosen = today.length >= ENOUGH_TODAY ? today : unique.filter((note) => note.moving || now - timeOf(note.at) <= REACH_MS);
  return chosen.slice(0, TODAY_LIMIT);
}
