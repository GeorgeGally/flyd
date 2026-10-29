import { roomItemText, type RoomItem } from "./read-the-room.js";
import { isProfileInstruction } from "./context-budget.js";
import { memoryEntryIsStale } from "../council/memory-store.js";

// What Flyd could draw on for this turn, split three ways: a small core it
// always carries (who George is and how to be with him), an indexed pool of
// knowledge the room-reader selects from, and private notes from background
// work. Nothing in the pool reaches the answer unless it was selected.

const CORE_SECTIONS = new Set(["About me", "People", "Preferences", "How to be with me", "Constraints"]);
const CORE_MAX_CHARS = 3_000;
const INSTRUCTION_SECTIONS = new Set(["Preferences", "How to be with me", "Constraints", "Instructions", "Safety"]);

export function profileSections(profile: string): Map<string, string[]> {
  const sections = new Map<string, string[]>();
  let current = "";
  for (const line of profile.split("\n")) {
    const heading = line.match(/^##\s+(.+?)\s*$/);
    if (heading) { current = heading[1]; continue; }
    const item = line.match(/^\s*-\s+(.+\S)\s*$/);
    if (current && item) sections.set(current, [...(sections.get(current) ?? []), item[1]]);
  }
  return sections;
}

export interface RoomSources {
  profile: string | null;
  memory: Array<{ id: string; section: string; text: string; date?: string; tier?: "aging" | "perishable" }>;
  retrieved: Array<{ excerpt: string; authority?: string; outcome?: string; path?: string; stale?: boolean; updatedAt?: string }>;
  now?: Date;
}

export function buildRoomContext(sources: RoomSources): { core: string; knowledge: RoomItem[] } {
  const sections = sources.profile ? profileSections(sources.profile) : new Map<string, string[]>();
  const coreLines: string[] = [];
  const instructions: string[] = [];
  const knowledge: RoomItem[] = [];
  let n = 0;
  for (const [section, items] of sections) {
    if (INSTRUCTION_SECTIONS.has(section)) instructions.push(`${section}: ${items.join("; ")}`);
    else if (section === "About me") {
      const identity = items.slice(0, 2);
      if (identity.length) instructions.push(`About me: ${identity.join("; ")}`);
      const remaining = items.slice(2);
      const directives = remaining.filter(isProfileInstruction);
      if (directives.length) instructions.push(`About me: ${directives.join("; ")}`);
      const facts = remaining.filter((item) => !isProfileInstruction(item));
      if (facts.length) coreLines.push(`About me: ${facts.join("; ")}`);
    } else {
      const directiveItems = items.filter(isProfileInstruction);
      if (directiveItems.length) instructions.push(`${section}: ${directiveItems.join("; ")}`);
      if (CORE_SECTIONS.has(section)) coreLines.push(`${section}: ${items.filter((item) => !isProfileInstruction(item)).join("; ")}`);
      else for (const item of items) knowledge.push({ id: `u${++n}`, text: item, authority: "user_profile", sourceRef: `USER.md:${section}` });
    }
  }
  const now = sources.now ?? new Date();
  const curated = sources.memory.map((entry) => {
    const stale = memoryEntryIsStale(entry, now);
    return { ...entry, authority: "curated_memory", sourceRef: `MEMORY.md:${entry.id}`, observedAt: entry.date, stale };
  });
  // Who he is, his people, and how he's been lately are what a friend always carries.
  const whoHeIs = curated.filter((entry) => entry.section === "Who he is" && !entry.stale).map(entry => roomItemText(entry));
  if (whoHeIs.length) coreLines.push(`Also known: ${whoHeIs.join("; ")}`);
  const people = curated.filter((entry) => entry.section === "People" && !entry.stale).map(entry => roomItemText(entry));
  if (people.length) coreLines.push(`People (noticed): ${people.join("; ")}`);
  const lately = curated.filter((entry) => entry.section === "Lately" && entry.observedAt && !entry.stale).map(entry => roomItemText(entry));
  if (lately.length) coreLines.push(`Lately: ${lately.join("; ")}`);
  for (const entry of curated.filter((item) => !["People", "Who he is"].includes(item.section) || item.stale)) {
    if (entry.section === "Lately" && entry.observedAt && !entry.stale) continue;
    knowledge.push({ id: `m${++n}`, text: `${entry.text} (${entry.section.toLowerCase()})`, authority: entry.authority, sourceRef: entry.sourceRef, observedAt: entry.observedAt, stale: entry.stale ?? entry.section === "Lately" });
  }
  const seen = new Set(knowledge.map((item) => item.text.toLowerCase()));
  for (const match of sources.retrieved.slice(0, 8)) {
    if (match.authority === "assistant_output" || match.outcome === "rejected") continue;
    const text = match.excerpt.replace(/\s+/g, " ").trim().slice(0, 240);
    if (!text || seen.has(text.toLowerCase())) continue;
    seen.add(text.toLowerCase());
    knowledge.push({ id: `r${++n}`, text, authority: match.authority ?? "user_observation", sourceRef: match.path, stale: match.stale, observedAt: match.updatedAt, outcome: match.outcome });
  }
  const required = instructions.join("\n");
  const room = Math.max(0, CORE_MAX_CHARS - required.length - 1);
  const optional = coreLines.join("\n");
  const fitted = optional.length > room ? `${optional.slice(0, Math.max(0, room - 1))}…` : optional;
  return { core: [required, room ? fitted : ""].filter(Boolean).join("\n"), knowledge };
}

/** Findings from backstage work, for Flyd's eyes only. */
export async function privateNotes(now = new Date()): Promise<Array<RoomItem & { advisoryId?: string }>> {
  const notes: Array<RoomItem & { advisoryId?: string }> = [];
  try {
    const { openAdvisories, readAdvisories, sameIdea } = await import("../council/advisors.js");
    const weekAgo = now.getTime() - 7 * 86_400_000;
    const raised = readAdvisories().filter((advisory) => advisory.status === "dismissed" || (advisory.shownAt && Date.parse(advisory.shownAt) >= weekAgo));
    for (const advisory of openAdvisories(now).filter((item) => !raised.some((other) => sameIdea(other, item))).slice(0, 4)) {
      notes.push({ id: `a${notes.length + 1}`, text: `${advisory.text}${advisory.whyNow ? ` (why now: ${advisory.whyNow})` : ""}`, advisoryId: advisory.id });
    }
  } catch { /* advisory store optional */ }
  try {
    const { latestEdition, recentFlashes } = await import("../council/scout.js");
    for (const flash of recentFlashes()) notes.push({ id: `s${notes.length + 1}`, text: `Must-know news: ${flash.title} — ${flash.why} ${flash.url}` });
    const edition = latestEdition();
    for (const item of edition?.items.slice(0, 4) ?? []) notes.push({ id: `s${notes.length + 1}`, text: `Story picked for him today: ${item.title} — ${item.why} ${item.url}` });
  } catch { /* news optional */ }
  try {
    const crew = await import("../crew/crew.js");
    for (const task of crew.listTasks().filter((item) => item.status === "ready").slice(0, 2)) {
      notes.push({ id: `c${notes.length + 1}`, text: `Finished and tested in the background, waiting for his OK (/land): ${crew.plainOutcome(task)}` });
    }
  } catch { /* crew optional */ }
  return notes;
}
