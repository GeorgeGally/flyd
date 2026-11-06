import { plainNote } from "./rail.js";
import { isRoutine } from "./summaries.js";
import type { ConversationMessage } from "./types.js";

// Which project each message of George's conversations is about. Pure: the same
// messages, catalogue and judged answers always give the same tags. A turn is
// the unit of meaning here: what he said, and what came back. Names in the words
// themselves are the strong signal; a turn that names nothing carries on the
// talk around it, and one that cannot is firstmate's to place (project-asker.ts).
// Nothing here leaves the machine.

export interface ThreadProject {
  /** The name firstmate and George use for it. */
  name: string;
  /** Written in lower case: any case matches. Otherwise exactly as written. */
  aliases: string[];
  /** Extra forms an alias cannot say: a task id, a lower-case word in his own message. */
  patterns?: RegExp[];
}

/** The names that are not the registry's own: what George types, and the older names of a project. */
const KNOWN: Array<ThreadProject & { keys: string[] }> = [
  { name: "Flyd", aliases: ["flyd"], keys: ["flyd", "georgegally-flyd"] },
  {
    name: "DIR", aliases: ["DIR", "Dead Internet Radio", "dead-internet-radio", "dead internet radio"],
    // A task is "dir-video-cache"; he types "on dir"; a bare "dir" elsewhere is a folder.
    patterns: [/(?<![a-z0-9/._-])dir(?:-[a-z0-9]+)+/, /\b(?:on|for|in|to|of|the)\s+dir\b(?![/.])/i],
    keys: ["dead-internet-radio", "dir-dead-internet-radio", "dir"],
  },
  { name: "CapFive", aliases: ["capfive", "cap5", "cap 5", "captfive", "aica"], keys: ["capfive", "cap5", "capfive-client-work"] },
  { name: "Logan", aliases: ["logan"], keys: ["logan"] },
  { name: "HFTW", aliases: ["hftw"], keys: ["hftw"] },
  { name: "Atomise", aliases: ["atomise", "atomize"], keys: ["atomise"] },
  { name: "Liesel", aliases: ["liesel", "easel"], keys: ["easel", "easel-design-board", "liesel"] },
  { name: "CleanX", aliases: ["cleanx"], keys: ["cleanx"] },
  { name: "GNM", aliases: ["gnm", "gmn", "good neighbours", "good_neighbours", "good-neighbours", "goodneighbours"], keys: ["good_neighbours", "gnm-good-neighbours-market", "gnm"] },
  { name: "Guido", aliases: ["guido"], keys: ["guides", "guido", "ruler"] },
  { name: "Roger", aliases: ["Roger", "copycopy", "copyover"], keys: ["roger", "copycopy"] },
  { name: "Thingthing", aliases: ["thingthing", "obj0"], keys: ["thingthing"] },
  { name: "Bloom", aliases: ["Bloom"], keys: ["bloom"] },
  { name: "Servers", aliases: ["apps1", "hosthatch"], keys: ["servers"] },
];

const norm = (text: string): string => text.toLowerCase().replace(/\s*\(.*\)\s*$/, "").trim();
const lastPart = (path: string): string => path.replace(/\/+$/, "").split("/").pop() ?? "";

/**
 * The projects to tag with: firstmate's registry (`data/projects.md`, one
 * "- slug [mode] - Name: what it is" line each), then Flyd's own list of what he
 * is moving, folded into the names above. A name is matched as it is written, so
 * a new project needs no change here.
 */
export function threadCatalogue(registry: string, projects: Array<{ id: string; name: string; status?: string; repos?: string[] }>): ThreadProject[] {
  const out = KNOWN.map(({ keys: _keys, ...project }) => ({ ...project }));
  const known = (keys: string[]): ThreadProject | undefined => {
    const asked = keys.map(norm);
    const seat = KNOWN.findIndex((project) => project.keys.some((key) => asked.includes(key)) || asked.includes(norm(project.name)));
    return seat >= 0 ? out[seat] : out.find((project) => asked.includes(norm(project.name)));
  };
  for (const line of registry.split("\n")) {
    const entry = /^- (\S+)(?: \[[^\]]*\])? - ([^:;(]+?)(?: \([^)]*\))?\s*[:;]/.exec(line);
    if (!entry) continue;
    const [, slug, name] = entry as unknown as [string, string, string];
    if (!known([slug, name])) out.push({ name: name.trim(), aliases: [name.trim()] });
  }
  for (const project of projects) {
    const name = project.name.replace(/\s*\(.*\)\s*$/, "").trim();
    if (project.status === "done" || !name || name.length > 32 || name.includes("/")) continue;
    if (known([project.id, name, ...(project.repos ?? []).map(lastPart)])) continue;
    out.push({ name, aliases: [name] });
  }
  return out;
}

const escaped = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Reads project names out of text. Built once per catalogue: the same words are read for every message. */
export function nameReader(projects: ThreadProject[]): (text: string) => string[] {
  const readers = projects.map((project) => {
    const alternatives = (aliases: string[]): string => aliases.map((alias) => escaped(alias).replace(/ /g, "[ _-]")).join("|");
    const anyCase = project.aliases.filter((alias) => alias === alias.toLowerCase());
    const exact = project.aliases.filter((alias) => alias !== alias.toLowerCase());
    return {
      name: project.name,
      tests: [
        ...(anyCase.length ? [new RegExp(`(?<![a-z0-9])(?:${alternatives(anyCase)})(?![a-z0-9])`, "i")] : []),
        ...(exact.length ? [new RegExp(`(?<![A-Za-z0-9])(?:${alternatives(exact)})(?![A-Za-z0-9])`)] : []),
        ...(project.patterns ?? []),
      ],
    };
  });
  return (text) => readers.filter((reader) => reader.tests.some((test) => test.test(text))).map((reader) => reader.name);
}

/** A message naming more projects than this is a fleet round-up: it is about the fleet, and stays in All. */
const ROUND_UP = 4;

/** What he said, and what came back. */
export interface Turn {
  /** Stable for the turn's lifetime: its first message's id. */
  key: string;
  asked: ConversationMessage[];
  reply?: ConversationMessage;
}

/** Words the harness put in his place: a session starting, a slash command, a probe. */
const PLUMBING = /^\s*(?:run bin\/fm-|\/[a-z][\w:-]*\s*$|reply with exactly\b|<)/i;

/** What a thread never shows: the harness's words, and a supervision wake with nothing to say. */
export function offThread(message: ConversationMessage): boolean {
  if (!message.text.trim() && !message.images?.length) return true;
  if (message.role === "user") return PLUMBING.test(message.text);
  return message.wake === true && isRoutine(message.text);
}

/**
 * The conversation as turns. His messages stacked before a reply are one turn
 * with it. A supervision wake answers nothing he said, so it stands alone and
 * what he asked still waits for its own reply.
 */
export function turnsOf(messages: ConversationMessage[]): Turn[] {
  const turns: Turn[] = [];
  let asked: ConversationMessage[] = [];
  for (const message of messages) {
    if (offThread(message)) continue;
    if (message.role === "user") { asked.push(message); continue; }
    if (message.wake) { turns.push({ key: message.id, asked: [], reply: message }); continue; }
    // Nothing asked and nothing to say: firstmate talking to itself.
    if (!asked.length && isRoutine(message.text)) continue;
    turns.push({ key: asked[0]?.id ?? message.id, asked, reply: message });
    asked = [];
  }
  if (asked.length) turns.push({ key: asked[0]!.id, asked });
  return turns;
}

const stamp = (message?: ConversationMessage): number => Date.parse(message?.timestamp ?? "");
const turnTime = (turn: Turn): number => {
  const at = stamp(turn.reply ?? turn.asked.at(-1));
  return Number.isNaN(at) ? stamp(turn.asked[0]) : at;
};

/** How long a quiet turn is taken to carry on the talk before it, with nobody to ask. */
const CARRIES_MS = 20 * 60_000;

/** A project a question is explicitly about: the window's own line, or the words. */
function ownNames(message: ConversationMessage, read: (text: string) => string[]): string[] {
  const note = plainNote(message.text);
  const named = note.project ? [note.project, ...read(note.words)] : read(message.text);
  const unique = [...new Set(named)];
  return unique.length > ROUND_UP ? [] : unique;
}

export interface TaggedTurns {
  /** Message id to the projects it appears in. */
  tags: Map<string, string[]>;
  /** What each turn names, by index. */
  named: string[][];
  /** The turns nothing here could place, in order: firstmate's to answer. */
  unplaced: number[];
}

/**
 * Tags every message. `answered` is firstmate's word on a turn: a project, null
 * for none of them, undefined when it has not said. A reply that names nothing
 * joins the question it answers, so the answer sits under it in the thread; a
 * quiet message takes the nearest thing he said in the turn, then the turn.
 */
export function tagTurns(turns: Turn[], read: (text: string) => string[], answered: (turn: Turn) => string | null | undefined = () => undefined): TaggedTurns {
  const tags = new Map<string, string[]>();
  const own = new Map<string, string[]>();
  const named = turns.map((turn) => {
    const said = [...turn.asked, ...(turn.reply ? [turn.reply] : [])];
    for (const message of said) own.set(message.id, ownNames(message, read));
    return [...new Set(said.flatMap((message) => own.get(message.id)!))];
  });
  const unplaced: number[] = [];
  const settled = turns.map((turn, index) => {
    if (named[index]!.length) return named[index]!;
    const answer = answered(turn);
    if (answer !== undefined) return answer ? [answer] : [];
    const around = carried(turns, named, index);
    if (!around.length) unplaced.push(index);
    return around;
  });
  turns.forEach((turn, index) => {
    const whole = settled[index]!;
    let before: string[] = [];
    for (const message of turn.asked) {
      const mine = own.get(message.id)!;
      const shown = mine.length ? mine : before.length ? before : whole;
      tags.set(message.id, shown);
      before = shown;
    }
    if (turn.reply) {
      // A reply that names projects is about those: work reported back can land between his question and its answer.
      const mine = own.get(turn.reply.id)!;
      // Otherwise it answers the last thing he said; stacked questions on other projects wait for their own.
      const last = turn.asked.at(-1);
      const asked = last ? tags.get(last.id)! : [];
      tags.set(turn.reply.id, mine.length ? mine : asked.length ? asked : whole);
    }
  });
  return { tags, named, unplaced };
}

/** The one project of the last named turns, when they agree and are close; failing that, of the next one. */
function carried(turns: Turn[], named: string[][], index: number): string[] {
  const at = turnTime(turns[index]!);
  if (Number.isNaN(at)) return [];
  const close = (look: number): boolean => Math.abs(at - turnTime(turns[look]!)) <= CARRIES_MS;
  const before: string[][] = [];
  for (let look = index - 1; look >= 0 && before.length < 2 && close(look); look -= 1) {
    if (named[look]!.length) before.push(named[look]!);
  }
  const projects = new Set(before.flat());
  if (projects.size) return projects.size === 1 ? [...projects] : [];
  for (let look = index + 1; look < turns.length && close(look); look += 1) {
    if (named[look]!.length) return named[look]!.length === 1 ? named[look]! : [];
  }
  return [];
}

const ITEM = /^(?:[-*+]|\d+[.)])\s|^\*\*/;

/**
 * A reply as one project's thread shows it: the paragraphs and points that name
 * only other projects are left to their threads. A reply with nothing of this
 * project's but a lead-in stays whole. Pure.
 */
export function aboutOnly(text: string, project: string, read: (text: string) => string[]): string {
  const points: string[][] = [[]];
  let fenced = false;
  for (const line of text.split("\n")) {
    if (/^\s*```/.test(line)) fenced = !fenced;
    if (!fenced && (ITEM.test(line) || !line.trim())) points.push([line]);
    else points.at(-1)!.push(line);
  }
  const others = (point: string[]): boolean => {
    const said = point.join("\n");
    if (said.includes("```")) return false;
    const names = read(said);
    return names.length > 0 && !names.includes(project);
  };
  const kept = points.filter((point) => !others(point));
  const left = kept.flat().join("\n").trim();
  return kept.length === points.length || !left || /:$/.test(left) ? text : left;
}

const clipped = (text: string, limit: number): string => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > limit ? `${flat.slice(0, limit - 1)}…` : flat;
};

/** One quiet turn as firstmate reads it: what was said, and the projects of the talk around it. Pure. */
export function askLine(turns: Turn[], index: number, named: string[][]): string {
  const turn = turns[index]!;
  const near = [...new Set(named.slice(Math.max(0, index - 4), index + 5).flat())];
  return [
    turn.asked.length ? `he said: ${clipped(turn.asked.map((message) => plainNote(message.text).words).join(" / "), 120)}` : "",
    turn.reply ? `reply: ${clipped(turn.reply.text, 120)}` : "",
    near.length ? `around: ${near.join(", ")}` : "",
  ].filter(Boolean).join(" | ");
}
