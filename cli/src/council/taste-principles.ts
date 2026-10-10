import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { FLYD_DIR } from "../lib/config.js";
import { ruleId, type TasteEvidence, type TasteProfile, type TasteRule, type TasteSkillKind } from "./taste.js";

// George's durable interface principles, seeded into TASTE.md from what he has
// said again and again — in Codex in July, in Claude Code and in Flyd's window
// in October. Learning only ever adds a rule after a correction; these are the
// things he has already said enough times that no agent should need correcting.
//
// Every quote is his, verbatim, spelling kept, with where and when he said it.
// The rule text is Flyd's summary of those words, never presented as his. Words
// others used to describe his taste (firstmate's "Flash-era minimal", "motion
// as the interface") are not his and are not quoted here.
//
// Seeding is once per principle: after that TASTE.md owns it. George can
// reword it, veto it ("not me") or delete it, and it is never re-added.

interface Seed {
  text: string;
  /** "personal", or the id of the one project it holds for. */
  scope: string;
  skill?: TasteSkillKind;
  evidence: TasteEvidence[];
}

const CAPFIVE = "capfive-client-work";
const GNM = "gnm-good-neighbours-market";
const said = (quote: string, source: string, date: string, project?: string): TasteEvidence => ({ quote, source, date, ...(project ? { project } : {}) });

export const TASTE_PRINCIPLES: Seed[] = [
  // ── Interface: how a screen of his should feel ──────────────────────────
  {
    text: "A screen, not a page: one composed, full-screen interface rather than a scrolling website.",
    scope: "personal",
    skill: "interface",
    evidence: [
      said('we have a scrolling page! not a "Macromedia Flash" screen interface. this still feels like a website', "Codex", "2026-07-14", "flyd"),
      said("it still looks like a webpage, rather than a Flash page", "Codex", "2026-07-10", "flyd"),
      said("It feels like it's a full-screen interface.", "Claude Code", "2026-10-04", CAPFIVE),
    ],
  },
  {
    text: "The intelligence decides what is on screen: a few chosen things, never every record there is.",
    scope: "personal",
    skill: "interface",
    evidence: [
      said("those cards, as i've said like 10x, should come from flyd. we ask it what it thinks we would want to know", "Codex", "2026-07-11", "flyd"),
      said("not a million things, a few choice ones", "Claude Code", "2026-10-09", "flyd"),
      said('what "evidence" on the UI - feels like noise. not something a super intelligent agent interface would throw at me', "Codex", "2026-07-14", "flyd"),
    ],
  },
  {
    text: "Calm and empty is fine and noise is the enemy, but a blank screen is never an excuse for having nothing to show.",
    scope: "personal",
    skill: "interface",
    evidence: [
      said("there's nothing wrong with an empty clean screen, we don't want to be overwhelme by interface", "Codex", "2026-07-10", "flyd"),
      said("is a complete cop-out. flyd has a lot of info about me. and what about interesting facts, news", "Codex", "2026-07-14", "flyd"),
      said("Reduce some of the noise on the output.", "Claude Code", "2026-10-03"),
    ],
  },
  {
    text: "Never look dead: while something works, say briefly and honestly what is happening.",
    scope: "personal",
    skill: "interface",
    evidence: [
      said("it should show me shome info, even a loading bar. Fetching… message , simple quick updates. a bit of information as to whats happening, not an overload", "Flyd window", "2026-10-09", "flyd"),
      said("instead of just dots, flyd can say what its doing under in small", "Flyd window", "2026-10-07", "flyd"),
    ],
  },
  {
    text: "Motion carries the state: things fade, rise and swap like a TV title sequence; nothing sits static.",
    scope: "personal",
    skill: "interface",
    evidence: [
      said("things should fade in and out. and move. like a beautiful moinimal title sequence", "Claude Code", "2026-10-03", CAPFIVE),
      said("Fade in like it was TV", "Claude Code", "2026-10-03", CAPFIVE),
      said("the interfsace is static. not fluid.", "Codex", "2026-07-14", "flyd"),
    ],
  },
  {
    text: "Data is shown as art, in the spirit of yugop or Ryoji Ikeda: it flickers in, says something and gets out. Never a plain dashboard.",
    scope: "personal",
    skill: "interface",
    evidence: [
      said("somethinkg like yugop or ryoji ikeda would do. show the data in a cool way", "Claude Code", "2026-10-03", CAPFIVE),
      said("data should be on for less time. flicker. and look a bit cooler and minimal", "Claude Code", "2026-10-03", CAPFIVE),
      said("it looks bad, not lke a poster. not like art.", "Codex", "2026-07-14", "flyd"),
    ],
  },
  {
    text: "Design it like a game or TV, not a spreadsheet or old web design.",
    scope: "personal",
    skill: "interface",
    evidence: [
      said("Think game interface, how would these cards be designed?", "Claude Code", "2026-10-03", CAPFIVE),
      said("it still feels a little bit like old web design and not like a game would be", "Claude Code", "2026-10-04", CAPFIVE),
      said("the ui flyd makes is our TV/video game vibe we've been circling around", "Claude Code", "2026-10-09", "flyd"),
    ],
  },
  {
    text: "Flat and borderless: no decorative lines, borders or boxes around things.",
    scope: "personal",
    skill: "interface",
    evidence: [
      said("change the deal cards to be flat like in Ledger", "Claude Code", "2026-09-30", "flyd"),
      said("Remove the border from the text box here and flyd", "Flyd window", "2026-10-06", "flyd"),
      said("remove the horizontal lines", "Flyd window", "2026-10-06", CAPFIVE),
    ],
  },
  {
    text: "It has to feel like something, not like a technical utility.",
    scope: "personal",
    skill: "interface",
    evidence: [
      said("there's no like feeling when you're open it. It's too like technical.", "Codex", "2026-07-24", "flyd"),
      said("this greeting is very tech/oprational and not a muse or PA vibe at all", "Claude Code", "2026-09-27", "flyd"),
    ],
  },
  {
    text: "Never show the machinery: no tool calls, self-talk or raw agent chatter on his screen.",
    scope: "personal",
    skill: "interface",
    evidence: [
      said("i wantto leave out all the toolcalls and selftalk, so i get a minimalist, neat conversation", "Claude Code", "2026-10-05", "flyd"),
      said("i don't want to see any of the toolcalls, its too much noise on the screen for me", "Claude Code", "2026-10-05", "flyd"),
      said("i'm stil getting alerts in the the island that seems like direct firstmate stuff", "Claude Code", "2026-10-09", "flyd"),
    ],
  },
  {
    text: "Talk to him in prose, not bullet points.",
    scope: "personal",
    skill: "interface",
    evidence: [
      said("don’t think bullet points are th best way to walk to me", "Flyd window", "2026-10-10", "flyd"),
    ],
  },

  // ── Spacing: his most repeated correction ───────────────────────────────
  {
    text: "Balance the spacing between text elements: every text block gets real room above and below it, and the gaps between a headline, its text and the next element read as even, never cramped.",
    scope: "personal",
    skill: "spacing",
    evidence: [
      said("i am constantly asking for more padding, better, more balanced spacing between text elements", "Flyd window", "2026-10-10", GNM),
      said("In industry sectors, the paragraph should have more padding above.", "Flyd window", "2026-10-06", CAPFIVE),
      said("the text content - should also be in the middle of the page (same top and bottom spacing)", "Flyd window", "2026-10-06", CAPFIVE),
    ],
  },
  {
    text: "Buttons get clear space above them, and buttons that sit together are the same size.",
    scope: "personal",
    skill: "spacing",
    evidence: [
      said("make these buttons same size. add padding above them.", "Flyd window", "2026-10-10", GNM),
      said("make the top and bottom spacing of the stats and buttons as a block. that block should have eqyal spacing on top and bottom", "Flyd window", "2026-10-06", CAPFIVE),
    ],
  },

  // ── Good Neighbours: the Christmas market site ──────────────────────────
  {
    text: "Every section is one full screen (100vh), with its content block centred.",
    scope: GNM,
    evidence: [
      said("every section should be 100vh", "Claude Code", "2026-10-09", GNM),
      said("the whole content block should be centred", "Claude Code", "2026-10-09", GNM),
    ],
  },
  {
    text: "No dividing lines: no horizontal rules between sections and no line under the menu bar.",
    scope: GNM,
    evidence: [
      said("remove the horizontal lines", "Claude Code", "2026-10-09", GNM),
      said("remove the line under the menubar", "Claude Code", "2026-10-09", GNM),
    ],
  },
  {
    text: "Navigation buttons are rounded pills; the hero's main buttons stay square.",
    scope: GNM,
    evidence: [
      said("make the Become a Vendor and Become a Sponsor navigation buttons rounded pills", "Claude Code", "2026-10-09", GNM),
      said("these buttons should have stayed square.", "Flyd window", "2026-10-10", GNM),
    ],
  },
  {
    text: "It must read as Christmas at a glance, done with real images or GIFs, never flat drawn SVG.",
    scope: GNM,
    evidence: [
      said("GNM the visuals need to look christmassy", "Flyd window", "2026-10-09", GNM),
      said("the GNM website doesn't scream christmas", "Claude Code", "2026-10-09", GNM),
      said("no! terrible. use an image/gif", "Claude Code", "2026-10-10", GNM),
    ],
  },
];

function seededPath(): string {
  const state = process.env.FLYD_TASTE_STATE?.trim();
  return join(state ? dirname(state) : FLYD_DIR, "taste-seeded.json");
}

function readSeeded(): Set<string> {
  try {
    const value = JSON.parse(readFileSync(seededPath(), "utf8")) as unknown;
    return new Set(Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : []);
  } catch {
    return new Set();
  }
}

/**
 * Add the principles TASTE.md has never had. A principle already there (in any
 * tier, or reworded under its id), or seeded before and since deleted by
 * George, is left alone. Returns how many were added; the caller writes
 * TASTE.md and then calls markPrinciplesSeeded, so a failed write never loses one.
 */
export function seedPrinciples(profile: TasteProfile, seeds: Seed[] = TASTE_PRINCIPLES): number {
  const seeded = readSeeded();
  const present = new Set([...profile.rules, ...profile.vetoed, ...(profile.retired ?? [])].map((rule) => rule.id));
  let added = 0;
  for (const seed of seeds) {
    const id = ruleId(seed.text);
    if (present.has(id) || seeded.has(id)) continue;
    const dates = seed.evidence.map((item) => item.date).sort();
    const projects = [...new Set(seed.evidence.flatMap((item) => (item.project ? [item.project] : [])))];
    const rule: TasteRule = {
      id,
      text: seed.text,
      scope: seed.scope,
      count: seed.evidence.length,
      projects: seed.scope === "personal" ? projects : [seed.scope],
      first: dates[0]!,
      last: dates.at(-1)!,
      evidence: seed.evidence.map((item) => ({ ...item })),
      principle: true,
      ...(seed.skill ? { skill: seed.skill } : {}),
    };
    profile.rules.push(rule);
    added += 1;
  }
  return added;
}

/** Remember every principle TASTE.md now holds, so deleting one later forgets it for good. */
export function markPrinciplesSeeded(profile: TasteProfile, seeds: Seed[] = TASTE_PRINCIPLES): void {
  const seeded = readSeeded();
  const present = new Set([...profile.rules, ...profile.vetoed, ...(profile.retired ?? [])].map((rule) => rule.id));
  const before = seeded.size;
  for (const seed of seeds) {
    const id = ruleId(seed.text);
    if (present.has(id)) seeded.add(id);
  }
  if (seeded.size === before && existsSync(seededPath())) return;
  const path = seededPath();
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify([...seeded].sort(), null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  renameSync(temporary, path);
}
