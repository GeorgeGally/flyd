/** Local-first proactive care: no extra agent, browser, or notification runtime. */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { activityRecordPath, recordActivity, type ActivityRecord } from "../conversation-view/activity.js";
import { readMemoryEntries, memoryEntryIsStale, type MemoryEntry } from "../council/memory-store.js";
import { readProjects, type Project } from "../council/projects.js";
import { latestEdition, type Edition } from "../council/scout.js";
import { contextScore, workFocusFromProjects } from "../council/inspiration.js";
import { CALENDAR_METADATA_CONTRACT, SourceContractRegistry } from "../intelligence/sensors/source-contracts.js";

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
}
export interface CareResult { meetings: number; inspiration: number; skipped: string[] }
const CREATIVE = /\b(?:design|graphic|visual|art|creative|identity|branding|typography|animation|render|website|interface|ui|3d|generative)\b/i;
const hash = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 20);
const dayOf = (d: Date) => [d.getFullYear(), String(d.getMonth() + 1).padStart(2, "0"), String(d.getDate()).padStart(2, "0")].join("-");
const clean = (s: string, max = 150) => s.replace(/\s+/g, " ").trim().slice(0, max);
function validUrl(raw: string): boolean {
  try { const u = new URL(raw); return u.protocol === "https:" && !!u.hostname && !u.username && !u.password; }
  catch { return false; }
}

/** macOS permission alone is not consent to monitor Calendar. */
export function calendarMetadataConsented(registry = new SourceContractRegistry()): boolean {
  registry.register(CALENDAR_METADATA_CONTRACT);
  return registry.status(CALENDAR_METADATA_CONTRACT.sourceId) === "enabled";
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
  const delay = new Date(event.start).getTime() - now.getTime();
  if (!Number.isFinite(delay) || delay < 0 || delay > 90 * 60_000) return null;
  if (!event.title.trim() || /(?:birthday|holiday|focus time|all.day)/i.test(event.title)) return null;
  const people = matchingPeople(event, memory, now);
  if (!people.length) return null;
  return {
    key: "care:meeting:" + hash(event.id + "|" + event.start), kind: "noted", state: "done", at: now.toISOString(),
    title: "Before " + clean(event.title, 72),
    line: (people.map((p) => clean(p.text.replace(/[.!?]+$/, ""), 120) + " (confirmed " + p.date + ")").join(" · ")
      + " · Call in " + Math.ceil(delay / 60_000) + " min.").slice(0, 500),
  };
}

/** Scout's previously gathered, sourced references. No new remote search or data egress. */
export function creativeCard(projects: Project[], edition: Edition | null, now: Date): ActivityRecord | null {
  if (!edition || edition.date !== dayOf(now)) return null;
  const visual = projects.filter((p) =>
    ["active", "launching", "waiting"].includes(p.status) &&
    (p.kind === "creative" || CREATIVE.test([p.name, p.what, p.now].join(" "))));
  if (!visual.length) return null;
  const focus = workFocusFromProjects(visual);
  const ranked = edition.items.flatMap((item) => {
    if (!validUrl(item.url)) return [];
    const score = contextScore({ title: item.title, summary: item.why }, focus);
    return score.score >= 5 ? [{ item, score: score.score, match: score.match }] : [];
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
    key: "care:creative:" + hash(project.id + "|" + edition.date), kind: "news", state: "done", at: now.toISOString(),
    title: clean("For " + project.name, 80),
    line: "A few references that connect with what you're making.",
    stories: selected.map(({ item }) => ({
      title: clean(item.title, 160), url: item.url, gist: clean(item.why, 220),
      source: clean(item.source, 80), kind: "relevant", ...(item.media && item.media !== "article" ? { media: item.media } : {}),
    })),
  };
}

/** The existing activity column is the ambient surface; nothing pushes a notification. */
export async function runProactiveCare(deps: CareDeps = {}): Promise<CareResult> {
  const result: CareResult = { meetings: 0, inspiration: 0, skipped: [] };
  if (process.env.FLYD_PROACTIVE_CARE === "0") return { ...result, skipped: ["disabled"] };
  const now = deps.now?.() ?? new Date();
  const day = dayOf(now);
  const write = deps.record ?? recordActivity;
  const seen = deps.alreadyRecorded ?? alreadyRecorded;
  const creative = creativeCard((deps.projects ?? readProjects)(), (deps.edition ?? latestEdition)(), now);
  if (creative?.key && !seen(creative.key, day)) { write(creative); result.inspiration++; }
  // Calendar metadata and People memory require a separate opt-in; a broad
  // request to "look after me" does not grant perpetual sensitive sensing.
  if (process.env.FLYD_PERSONAL_BRIEFING === "0") {
    result.skipped.push("personal_briefing_disabled"); return result;
  }
  if (!(deps.calendarConsent ?? calendarMetadataConsented)()) {
    result.skipped.push("calendar_metadata_not_consented"); return result;
  }
  const events = await (deps.events ?? defaultEvents)().catch(() => []);
  const memory = (deps.memory ?? readMemoryEntries)();
  for (const event of events.slice(0, 10)) {
    const card = meetingCard(event, memory, now);
    if (!card?.key || seen(card.key, day)) continue;
    write(card); result.meetings++;
  }
  return result;
}

async function defaultEvents(): Promise<CareEvent[]> {
  if (process.platform !== "darwin" || process.env.VITEST) return [];
  const { appRunning } = await import("./personal-tools.js");
  if (!(await appRunning("Calendar"))) return [];
  return (await import("./proactive-calendar.js")).upcomingCalendarMetadata();
}
