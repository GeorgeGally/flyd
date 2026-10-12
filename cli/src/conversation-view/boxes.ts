import type { PlanUsage } from "./plan-usage.js";
import type { ShowItem, ShowKind, ShowLink, ShowScreen, ShowShot } from "./show.js";
import type { WeatherReading } from "./weather.js";

// The artefact as boxes: Flyd's overview, laid out as a tree. A box can hold
// boxes (a group holds its stories, a story holds its screenshots), but the
// screen never shows more than MAX_DEPTH levels, the screen's own groups
// included: past that it is browsing, not glancing. Every box carries why Flyd shows it, and its place is decided by a
// fixed rule, not a model: calls only George can make lead across the top; the
// stories take the wide column; the side column opens with anything Flyd sees
// coming (a plan limit running out, rain due), then the instruments. Pure: the same screen, readings and clock always give
// the same boxes.

export type BoxKind = "group" | "call" | "story" | "shot" | "alert" | "bars" | "gauge" | "weather" | "note";
/** lead: across the top; main: the wide column; side: the narrow column; wide/small: inside a group. */
export type BoxSize = "lead" | "main" | "side" | "wide" | "small";
export type BoxTone = ShowKind | "warn";

export interface BoxBar {
  label: string;
  value: number;
  tone?: BoxTone;
}

export interface BoxGauge {
  label: string;
  /** Share of the window used, 0–100. */
  used: number;
  resetsAt?: string;
}

export interface BoxHour {
  /** Local hour, "15". */
  label: string;
  tempC: number;
  rainChance: number;
}

export interface Box {
  decision?: ShowItem["decision"];
  /** Stable while it is the same thing, so the page animates only what is new. */
  id: string;
  kind: BoxKind;
  size: BoxSize;
  title: string;
  /** The sentence that says what it means or what is asked. */
  line?: string;
  /** Why Flyd puts it in front of him, in a few words. */
  why: string;
  tone?: BoxTone;
  children?: Box[];
  bars?: BoxBar[];
  gauges?: BoxGauge[];
  hours?: BoxHour[];
  shot?: ShowShot;
  links?: ShowLink[];
  /** The web page the work changed: a button that opens it. */
  open?: ShowLink;
  project?: string;
  status?: string;
  at?: string;
  /** The conversation message it opens in the terminal. */
  ref?: string;
  /** Firstmate's task id, named in what he says about it. */
  task?: string;
}

export interface BoxReadings {
  now?: number;
  plan?: PlanUsage | null;
  weather?: WeatherReading | null;
}

/** The screen's groups, what is in them, and one level inside that. */
export const MAX_DEPTH = 3;
const MAX_CALLS = 3;
/** Stories with pictures of the work; the screen is for showing it. */
const MAX_PICTURED = 8;
/** Stories that are words only: a couple, so the cycle never becomes a list. */
const MAX_UNPICTURED = 2;
const SHOTS_PER_STORY = 4;
/** A plan window with less than this left is worth saying before he runs into it. */
export const PLAN_LOW_PERCENT = 25;
/** Rain this likely within RAIN_HOURS is worth saying before it starts. */
export const RAIN_LIKELY_PERCENT = 60;
export const RAIN_HOURS = 6;

const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const STORY_KINDS: ShowKind[] = ["landed", "live", "ready", "waiting", "news"];

function shotsOf(item: ShowItem, prefix: string): Box[] {
  return (item.shots ?? []).slice(0, SHOTS_PER_STORY).map((shot, index) => ({
    id: `${prefix}:shot:${index}`,
    kind: "shot" as const,
    size: "small" as const,
    title: shot.label,
    why: "what the work looks like",
    shot,
  }));
}

function fromItem(item: ShowItem, kind: "call" | "story", size: BoxSize): Box {
  const children = shotsOf(item, item.id);
  return {
    id: item.id,
    kind,
    size,
    title: item.headline,
    ...(item.decision ? { decision: item.decision } : {}),
    ...(item.detail ? { line: item.detail } : {}),
    why: item.why,
    tone: item.kind,
    ...(children.length ? { children } : {}),
    ...(item.links?.length ? { links: item.links } : {}),
    ...(item.open ? { open: item.open } : {}),
    ...(item.project ? { project: item.project } : {}),
    ...(item.status ? { status: item.status } : {}),
    ...(item.at ? { at: item.at } : {}),
    ...(item.ref ? { ref: item.ref } : {}),
    ...(item.task ? { task: item.task } : {}),
  };
}

function resetPhrase(resetsAt: string | undefined, now: number): string {
  if (!resetsAt) return "";
  const ms = new Date(resetsAt).getTime() - now;
  if (!Number.isFinite(ms) || ms <= 0) return "";
  const hours = Math.round(ms / 3_600_000);
  if (hours < 1) return ", resets within the hour";
  if (hours < 48) return `, resets in ${hours}h`;
  return `, resets in ${Math.round(hours / 24)} days`;
}

/** What Flyd sees coming that he would want to know before it arrives. Pure. */
export function alertsOf(readings: BoxReadings): Box[] {
  const now = readings.now ?? Date.now();
  const alerts: Box[] = [];
  for (const window of readings.plan?.windows ?? []) {
    if (window.percentRemaining >= PLAN_LOW_PERCENT) continue;
    alerts.push({
      id: `alert:plan:${window.label}`,
      kind: "alert",
      size: "small",
      tone: "warn",
      title: `Claude ${window.label} limit: ${Math.round(window.percentRemaining)}% left${resetPhrase(window.resetsAt, now)}.`,
      why: "you'll run into it before it resets",
    });
  }
  const soon = (readings.weather?.hours ?? []).slice(0, RAIN_HOURS);
  const wet = soon.find((hour) => hour.rainChance >= RAIN_LIKELY_PERCENT);
  if (wet && readings.weather) {
    const place = readings.weather.place ? ` in ${readings.weather.place}` : "";
    alerts.push({
      id: "alert:rain",
      kind: "alert",
      size: "small",
      tone: "warn",
      title: `Rain likely from ${wet.at.slice(11, 16)}${place} (${wet.rainChance}%).`,
      why: `rain due in the next ${RAIN_HOURS} hours`,
    });
  }
  return alerts;
}

/** The small boxes along the bottom: weather, plan usage, what landed, where the work stands. Pure. */
export function instrumentsOf(screen: ShowScreen, readings: BoxReadings): Box[] {
  const boxes: Box[] = [];
  const weather = readings.weather;
  if (weather) {
    boxes.push({
      id: "weather",
      kind: "weather",
      size: "small",
      title: `${Math.round(weather.tempC)}° ${weather.condition}`,
      ...(weather.place ? { line: weather.place } : {}),
      why: "the next twelve hours",
      hours: weather.hours.map((hour) => ({ label: hour.at.slice(11, 13), tempC: hour.tempC, rainChance: hour.rainChance })),
      at: weather.read,
    });
  }
  const windows = readings.plan?.windows ?? [];
  if (windows.length) {
    boxes.push({
      id: "plan",
      kind: "gauge",
      size: "small",
      title: "Claude plan",
      why: "how much of each limit is used",
      gauges: windows.map((window) => ({
        label: window.label,
        used: Math.max(0, Math.min(100, Math.round(100 - window.percentRemaining))),
        ...(window.resetsAt ? { resetsAt: window.resetsAt } : {}),
      })),
    });
  }
  const week = screen.landedByDay ?? [];
  const landedThisWeek = week.reduce((sum, day) => sum + day.count, 0);
  if (landedThisWeek > 0) {
    boxes.push({
      id: "landed-week",
      kind: "bars",
      size: "small",
      title: `${landedThisWeek} landed this week`,
      why: "what the fleet finished, day by day",
      bars: week.map((day) => ({ label: WEEKDAY[new Date(`${day.day}T12:00:00Z`).getUTCDay()] ?? day.day, value: day.count, tone: "landed" as const })),
    });
  }
  const states: Array<[ShowKind, string]> = [["call", "need you"], ["live", "under way"], ["ready", "to land"], ["waiting", "held up"], ["next", "queued"]];
  const bars = states.map(([kind, label]) => ({ label, value: screen.counts[kind] ?? 0, tone: kind })).filter((bar) => bar.value > 0);
  if (bars.length) {
    boxes.push({
      id: "work-state",
      kind: "bars",
      size: "small",
      title: "Where the work stands",
      why: "every piece of work by state",
      bars,
    });
  }
  return boxes;
}

/** Cuts every branch at MAX_DEPTH levels. Pure. */
export function clampDepth(boxes: Box[], depth = 1): Box[] {
  return boxes.map((box) => {
    if (!box.children) return box;
    if (depth >= MAX_DEPTH) {
      const { children: _dropped, ...rest } = box;
      return rest;
    }
    return { ...box, children: clampDepth(box.children, depth + 1) };
  });
}

/** Flyd's overview as boxes, most deserving first. Pure. */
export function boxesOf(screen: ShowScreen, readings: BoxReadings = {}): Box[] {
  const boxes: Box[] = [];
  const calls = screen.items.filter((item) => item.kind === "call").slice(0, MAX_CALLS);
  if (calls.length) {
    boxes.push({
      id: "calls",
      kind: "group",
      size: "lead",
      tone: "call",
      title: calls.length === 1 ? "One call only you can make" : `${calls.length} calls only you can make`,
      why: "waiting on you",
      // The group already says it waits on him.
      children: calls.map((item) => ({ ...fromItem(item, "call", "lead"), why: "" })),
    });
  } else {
    boxes.push({ id: "situation", kind: "note", size: "wide", title: screen.title, line: screen.summary, why: "where things stand" });
  }
  const told = screen.items.filter((item) => STORY_KINDS.includes(item.kind));
  // Finished work is the showcase; what is still moving follows it.
  const pictured = STORY_KINDS.flatMap((kind) => told.filter((item) => item.kind === kind && item.shots?.length));
  const stories = [
    ...pictured.slice(0, MAX_PICTURED),
    ...told.filter((item) => !item.shots?.length).slice(0, MAX_UNPICTURED),
  ];
  if (stories.length) {
    boxes.push({
      id: "stories",
      kind: "group",
      size: "main",
      title: "What's happening",
      why: "the work, the fleet and the news",
      children: stories.map((item) => fromItem(item, "story", item.shots?.length ? "wide" : "small")),
    });
  }
  // The side column: what Flyd sees coming first, then the numbers.
  const side = [...alertsOf(readings), ...instrumentsOf(screen, readings)];
  if (side.length) {
    boxes.push({ id: "instruments", kind: "group", size: "side", title: "Coming up and the numbers", why: "what Flyd sees coming, then the numbers", children: side });
  }
  return clampDepth(boxes);
}

/** A page on this machine: 127.0.0.1, localhost or [::1]. Pure. */
export function isLocalPage(url: string): boolean {
  try {
    return ["127.0.0.1", "localhost", "[::1]"].includes(new URL(url).hostname);
  } catch {
    return false;
  }
}

/**
 * The boxes with every link to a page on this machine that no longer answers
 * marked closed, so the screen says so instead of offering a dead link. A page
 * not yet checked stays a link. `live` says what the page did when last asked.
 */
export function withClosedLinks(boxes: Box[], live: (url: string) => string): Box[] {
  const mark = (box: Box): Box => {
    const links = box.links && closedLinks(box.links, live);
    const children = box.children?.map(mark);
    return { ...box, ...(links ? { links } : {}), ...(children ? { children } : {}) };
  };
  return boxes.map(mark);
}

/** The links with each one to a page on this machine that stopped answering marked closed. Pure. */
export function closedLinks(links: ShowLink[], live: (url: string) => string): ShowLink[] {
  return links.map((link) => (isLocalPage(link.url) && live(link.url) === "down" ? { ...link, closed: true } : link));
}
