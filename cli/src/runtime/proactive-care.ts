/** Local-first proactive care: no extra agent, browser, or notification runtime. */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { activityRecordPath, recordActivity, type ActivityRecord } from "../conversation-view/activity.js";
import { readMemoryEntries, memoryEntryIsStale, type MemoryEntry } from "../council/memory-store.js";
import { readProjects, type Project } from "../council/projects.js";
import { latestEdition, type Edition } from "../council/scout.js";
import { contextScore, lexicalTokens, workFocusFromProjects } from "../council/inspiration.js";
import { MEETING_PREP_CONTRACT, SourceContractRegistry } from "../intelligence/sensors/source-contracts.js";

export interface CareEvent { id: string; title: string; start: string }
export interface CareDeps {
  now?: () => Date;
  events?: () => Promise<CareEvent[]>;
  memory?: () => MemoryEntry[];
  projects?: () => Project[];
  edition?: () => Edition | null;
  calendarConsent?: () => boolean;
  record?: (record: ActivityRecord) => void;
  alreadyRecorded?: (key: string, day: string) => boolean;
  /** Number of existing, distinct conversation galleries today; for daily attention budget. */
  countConversationCards?: (day: string) => number;
}
export interface CareResult { meetings: number; inspiration: number; commitments: number; skipped: string[] }
const CREATIVE = /\b(?:design|graphic|visual|art|creative|identity|branding|typography|animation|render|website|interface|ui|3d|generative)\b/i;
const hash = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 20);
const dayOf = (d: Date) => [d.getFullYear(), String(d.getMonth() + 1).padStart(2, "0"), String(d.getDate()).padStart(2, "0")].join("-");
const clean = (s: string, max = 150) => s.replace(/\s+/g, " ").trim().slice(0, max);
function validUrl(raw: string): boolean {
  try { const u = new URL(raw); return u.protocol === "https:" && !!u.hostname && !u.username && !u.password; }
  catch { return false; }
}

/** macOS permission alone is not consent to monitor Calendar. */
export function meetingPrepConsented(registry = new SourceContractRegistry()): boolean {
  registry.register(MEETING_PREP_CONTRACT);
  return registry.status(MEETING_PREP_CONTRACT.sourceId) === "enabled";
}
function alreadyRecorded(key: string, day: string): boolean {
  try {
    return readFileSync(activityRecordPath(), "utf8").split("\n").slice(-300).some((line) => {
      try {
        const entry = JSON.parse(line) as ActivityRecord;
        return entry.key === key && !!entry.at && dayOf(new Date(entry.at)) === day;
      } catch { return false; }
    });
  } catch { return false; }
}

/** Older activity cards remain on disk for audit, but the panel only shows
 * them under current consent (activity.ts). Use stored keys for the attention
 * budget so a restarted Core cannot produce endless inspiration cards.
 */
export function conversationCardCount(day: string): number {
  try {
    const unique = new Set<string>();
    for (const line of readFileSync(activityRecordPath(), "utf8").split("\n").slice(-500)) {
      try {
        const item = JSON.parse(line) as ActivityRecord;
        if (item.key?.startsWith("care:creative:conversation:" + day + ":")
          && item.at && dayOf(new Date(item.at)) === day) unique.add(item.key);
      } catch { /* a truncated final record is not a card */ }
    }
    return unique.size;
  } catch { return 0; }
}

/** Require exact two-part names present in both the title and fresh People memory. */
export function matchingPeople(event: CareEvent, memory: MemoryEntry[], now: Date): MemoryEntry[] {
  const groups = new Map<string, MemoryEntry[]>();
  for (const item of memory) {
    if (item.section.toLowerCase() !== "people" || memoryEntryIsStale(item, now)) continue;
    const match = /^([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2})(?:\s*[:—–,-]|\s+(?:is|has|works|lives|said|mentioned|wants|likes|and)\b)/.exec(item.text);
    if (!match) continue;
    const name = match[1]!.trim().toLowerCase();
    groups.set(name, [...(groups.get(name) ?? []), item]);
  }
  const title = event.title.toLowerCase();
  const wholeWord = (name: string): boolean => {
    const index = title.indexOf(name);
    if (index < 0) return false;
    return !/[a-z]/i.test(title[index - 1] ?? "") && !/[a-z]/i.test(title[index + name.length] ?? "");
  };
  // Prefer the complete verified name. A single first name works only if it
  // uniquely identifies exactly one known person; otherwise say nothing.
  const full = [...groups.keys()].filter(wholeWord);
  if (full.length === 1) return groups.get(full[0]!)!.slice(0, 3);
  if (full.length > 1) return [];
  const byFirstName = [...groups.keys()].filter((name) => wholeWord(name.split(" ")[0]!));
  return byFirstName.length === 1 ? groups.get(byFirstName[0]!)!.slice(0, 3) : [];
}

export function meetingCard(event: CareEvent, memory: MemoryEntry[], now: Date): ActivityRecord | null {
  const start = new Date(event.start);
  const delay = start.getTime() - now.getTime();
  if (!Number.isFinite(delay) || delay < 0 || delay > 90 * 60_000) return null;
  if (!event.title.trim() || /(?:birthday|holiday|focus time|all.day)/i.test(event.title)) return null;
  const people = matchingPeople(event, memory, now);
  if (!people.length) return null;
  return {
    key: "care:meeting:" + hash(event.id + "|" + event.start), kind: "noted", state: "done", at: now.toISOString(), expiresAt: start.toISOString(),
    title: "Before " + clean(event.title, 72),
    line: (people.map((p) => clean(p.text.replace(/[.!?]+$/, ""), 120) + " (confirmed " + p.date + ")").join(" · ")
      + " · Call in " + Math.ceil(delay / 60_000) + " min.").slice(0, 500),
  };
}

/** Scout's previously gathered, sourced references. No new remote search or data egress. */
export function creativeCard(projects: Project[], edition: Edition | null, now: Date, minimumScore = 5): ActivityRecord | null {
  if (!edition || edition.date !== dayOf(now)) return null;
  const visual = projects.filter((p) =>
    ["active", "launching", "waiting"].includes(p.status) &&
    (p.kind === "creative" || CREATIVE.test([p.name, p.what, p.now].join(" "))));
  if (!visual.length) return null;
  const focus = workFocusFromProjects(visual);
  const ranked = edition.items.flatMap((item) => {
    if (!validUrl(item.url)) return [];
    const score = contextScore({ title: item.title, summary: item.why }, focus);
    return score.score >= minimumScore ? [{ item, score: score.score, match: score.match }] : [];
  }).sort((a, b) => b.score - a.score);
  const seen = new Set<string>();
  const selected = ranked.filter(({ item }) => {
    if (seen.has(item.url)) return false;
    seen.add(item.url);
    return true;
  }).slice(0, 3);
  if (selected.length < 2) return null;
  const project = visual.find((p) => p.name === selected[0]!.match) ?? visual[0]!;
  return {
    key: "care:creative:" + hash(project.id + "|" + edition.date), kind: "news", state: "done", at: now.toISOString(), expiresAt: new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).toISOString(),
    title: clean("For " + project.name, 80),
    line: "A few references that connect with what you're making.",
    stories: selected.map(({ item }) => ({
      title: clean(item.title, 160), url: item.url, gist: clean(item.why, 220),
      source: clean(item.source, 80), kind: "relevant", ...(item.media && item.media !== "article" ? { media: item.media } : {}),
    })),
  };
}

/** Up to three dated, curated commitments, ordered by due date.
 * Never infer deadlines or turn a vague note into a user-facing promise.
 */
export function commitmentCards(memory: MemoryEntry[], now: Date): ActivityRecord[] {
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const candidates = memory.flatMap((item) => {
    if (item.section.toLowerCase() !== "commitments" || memoryEntryIsStale(item, now)) return [];
    const dates = [...item.text.matchAll(/\b(20\d{2}-\d{2}-\d{2})\b/g)].map((match) => match[1]!);
    if (dates.length !== 1 || !/\b(?:send|follow up|follow-up|reply|call|review|submit|deliver|renew|pay|meet|finish|prepare)\b/i.test(item.text)) return [];
    const date = new Date(dates[0] + "T00:00:00");
    if (Number.isNaN(date.getTime()) || dayOf(date) !== dates[0]) return [];
    const days = Math.round((date.getTime() - midnight) / 86_400_000);
    return days >= 0 && days <= 2 ? [{ item, due: dates[0], days }] : [];
  }).sort((a, b) => a.days - b.days || a.item.text.localeCompare(b.item.text));
  const ids = new Set<string>();
  return candidates.filter(({ item }) => {
    if (ids.has(item.id)) return false;
    ids.add(item.id); return true;
  }).slice(0, 3).map(({ item, due, days }) => {
    const when = days === 0 ? "Today" : days === 1 ? "Tomorrow" : "In two days";
    const date = new Date(due + "T00:00:00");
    return {
      key: "care:commitment:" + hash(item.id + "|" + due),
      kind: "noted", state: "done", at: now.toISOString(),
      expiresAt: new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1).toISOString(),
      title: when + ": something you committed to",
      line: clean(item.text.replace(/[.!?]+$/, ""), 190) + " (noted " + item.date + ").",
    };
  });
}

/** Backward-compatible single-best commitment for existing consumers. */
export function commitmentCard(memory: MemoryEntry[], now: Date): ActivityRecord | null {
  return commitmentCards(memory, now)[0] ?? null;
}

/** The existing activity column is the ambient surface; nothing pushes a notification. */
export async function runProactiveCare(deps: CareDeps = {}): Promise<CareResult> {
  const result: CareResult = { meetings: 0, inspiration: 0, commitments: 0, skipped: [] };
  if (process.env.FLYD_PROACTIVE_CARE === "0") return { ...result, skipped: ["disabled"] };
  const now = deps.now?.() ?? new Date();
  const day = dayOf(now);
  const write = deps.record ?? recordActivity;
  const seen = deps.alreadyRecorded ?? alreadyRecorded;
  const creative = creativeCard((deps.projects ?? readProjects)(), (deps.edition ?? latestEdition)(), now);
  if (creative?.key && !seen(creative.key, day)) { write(creative); result.inspiration++; }
  // Reuse already consented curated memory only; no calendar, contact or model lookup.
  const memory = (deps.memory ?? readMemoryEntries)();
  for (const commitment of commitmentCards(memory, now)) {
    if (!commitment.key || seen(commitment.key, day)) continue;
    write(commitment); result.commitments++;
  }
  // Calendar metadata and People memory require a separate opt-in; a broad
  // request to "look after me" does not grant perpetual sensitive sensing.
  if (process.env.FLYD_PERSONAL_BRIEFING === "0") {
    result.skipped.push("personal_briefing_disabled"); return result;
  }
  if (!(deps.calendarConsent ?? meetingPrepConsented)()) {
    result.skipped.push("calendar_metadata_not_consented"); return result;
  }
  const events = await (deps.events ?? defaultEvents)().catch(() => []);
  for (const event of events.slice(0, 10)) {
    const card = meetingCard(event, memory, now);
    if (!card?.key || seen(card.key, day)) continue;
    write(card); result.meetings++;
  }
  return result;
}

/**
 * Conversation-triggered visual preparation. George can be talking about
 * design before the Librarian has registered a project; use the Scout edition
 * already on disk and put at most one contextual gallery in the ambient
 * activity panel per day. This does not modify the reply or start a search.
 */
export function prepareCreativeForConversation(message: string, deps: CareDeps = {}): boolean {
  if (process.env.FLYD_PROACTIVE_CARE === "0" || !CREATIVE.test(message) || message.trim().length < 10) return false;
  const now = deps.now?.() ?? new Date();
  const day = dayOf(now);
  const edition = (deps.edition ?? latestEdition)();
  const focus: Project = {
    id: "conversation-design", name: "Your current design direction",
    kind: "creative", status: "active", what: clean(message, 400), now: "",
    people: [], repos: [], updated: day,
  };
  const candidate = creativeCard([focus], edition, now, 3);
  if (!candidate) return false;
  // Normalize the subject rather than keying off raw prose, so edits to
  // punctuation do not create new cards. Distinct directions can each get a
  // useful gallery, but two per day is the hard interruption/attention budget.
  const topic = lexicalTokens(message).slice(0, 12).sort().join(" ");
  const key = "care:creative:conversation:" + day + ":" + hash(topic);
  if ((deps.alreadyRecorded ?? alreadyRecorded)(key, day)) return false;
  if ((deps.countConversationCards ?? conversationCardCount)(day) >= 2) return false;
  const card: ActivityRecord = {
    ...candidate, key, title: "References for this direction",
  };
  (deps.record ?? recordActivity)(card);
  return true;
}

async function defaultEvents(): Promise<CareEvent[]> {
  if (process.platform !== "darwin" || process.env.VITEST) return [];
  const { appRunning } = await import("./personal-tools.js");
  if (!(await appRunning("Calendar"))) return [];
  return (await import("./proactive-calendar.js")).upcomingCalendarMetadata();
}
