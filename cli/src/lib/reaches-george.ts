// What may reach George, as code. Flyd is his chief of staff (lib/soul.ts):
// five kinds of thing are worth his attention, and each reaches him as one
// plain line. Everything else is Flyd's own to handle: a fault or a stale
// reading is repaired or worked around, staff silence is chased quietly,
// routine work is settled. Every surface that puts words in front of him
// without a model (the panel and its headline, the notices over the message
// box, notifications, the line under his message) asks this first. Pure.

/** What a thing put in front of George is. */
export type GeorgeKind =
  /** A call only he can make. */
  | "decision"
  /** Finished work worth his eyes. */
  | "deliverable"
  /** A real blocker Flyd has run out of moves on. */
  | "blocker"
  /** A login or credential only he can give. */
  | "credential"
  /** Something destructive or irreversible, before it happens. */
  | "irreversible"
  /** Where work stands, on a screen he opened himself. */
  | "status"
  /** A command failed, a read broke. */
  | "fault"
  /** Data too old or unreadable to trust. */
  | "stale"
  /** Staff gone quiet, notes unread, an answer overdue. */
  | "silence"
  /** Progress, acknowledgements, routine merges and follow-ups. */
  | "routine";

/** Where he would see it: pushed at him (a notification, a notice over the box), or on a screen he is looking at. */
export type GeorgeSurface = "notification" | "notice" | "panel" | "status";

/** How Flyd deals with what it keeps from him. */
export type Handling = "repair" | "chase" | "settle";

export type Gated =
  | { reach: true; kind: GeorgeKind; line: string }
  | { reach: false; kind: GeorgeKind; handle: Handling };

export interface ForGeorge {
  kind: GeorgeKind;
  text: string;
}

/** The only things that may interrupt him, in the mission's own words (lib/soul.ts lists these). */
export const REACHES_HIM: ReadonlyArray<{ kind: GeorgeKind; says: string }> = [
  { kind: "decision", says: "A decision only he can make, with your recommendation." },
  { kind: "deliverable", says: "Finished work worth his eyes, with a picture of it." },
  { kind: "blocker", says: "A real blocker you have run out of moves on, with the one thing that would clear it." },
  { kind: "credential", says: "A login or credential only he can give." },
  { kind: "irreversible", says: "Anything destructive or irreversible, before it happens." },
];

const WHITELIST = new Set(REACHES_HIM.map((item) => item.kind));

/** Kinds whose words are read too: a blocker said only in error text is not yet one he can act on. His calls always reach him. */
const READ_BY_WORDS = new Set<GeorgeKind>(["deliverable", "blocker", "status"]);

/** Every kind, for callers that receive one from outside (Core's /notify). */
export const GEORGE_KINDS: ReadonlySet<string> = new Set<GeorgeKind>([
  "decision", "deliverable", "blocker", "credential", "irreversible", "status", "fault", "stale", "silence", "routine",
]);

const HANDLING: Record<GeorgeKind, Handling> = {
  decision: "settle", deliverable: "settle", blocker: "settle", credential: "settle", irreversible: "settle",
  status: "settle", fault: "repair", stale: "repair", silence: "chase", routine: "settle",
};

/** Machine error text: a failed command, an errno, an exit code, a stack frame, data that would not parse or read. */
const FAULT = new RegExp([
  String.raw`\bcommand failed\b`,
  String.raw`\b(?:ENOENT|EACCES|EPERM|ETIMEDOUT|ECONNREFUSED|ECONNRESET|EPIPE|ENOTFOUND|EAI_AGAIN)\b`,
  String.raw`\bexit(?:ed)? (?:with )?(?:code|status) -?\d+`,
  String.raw`\b(?:Type|Syntax|Reference|Range)Error\b`,
  String.raw`\bat \S+ \([^)]*:\d+:\d+\)`,
  String.raw`\bnot valid JSON\b|\bunexpected (?:schema|token|end of JSON)\b`,
  String.raw`\bcouldn['’]?t read\b[^.]*\b(?:fleet|snapshot|state|records?)\b`,
  String.raw`\b(?:snapshot|state|records?) (?:is |was |are |were )?unreadable\b`,
].join("|"), "i");

/** Admin about the staff rather than news: nobody answered, notes unread, something queued for later. */
const SILENCE = new RegExp([
  String.raw`\bheard nothing (?:back )?(?:on|from|about)\b`,
  String.raw`\bno word (?:back )?(?:on|from|about)\b`,
  String.raw`\bnotes? (?:you sent )?(?:are |is )?still waiting\b`,
  String.raw`\bhas been stuck waiting\b`,
  String.raw`\bstill (?:no|without an?) (?:reply|answer|word)\b`,
  String.raw`\bqueued for a next step\b`,
].join("|"), "i");

/** A path on this machine ("/Users/…", "~/…", "…/bin/x.sh"), never part of a link. */
const PATH = /(?<![\w:/.])(?:~|…|\.{3})?\/(?:[\w.@-]+\/)+[\w.@-]*/g;
/** A command-line flag left in prose ("--json"). */
const FLAG = /(?<=\s|^)--[a-z][\w-]*/gi;
/** A parenthesised aside that only carries error text or a path. */
const ASIDE = /\s*\(([^()]*)\)/g;

/** What he is told: one line, error asides and flags taken out, and a file named, never its path. Pure. */
export function plainLine(text: string): string {
  return text
    .replace(ASIDE, (aside, inner: string) => (FAULT.test(inner) || new RegExp(PATH.source).test(inner) ? "" : aside))
    .replace(PATH, (path) => path.split("/").pop() ?? "")
    .replace(FLAG, "")
    .replace(/\s+/g, " ")
    .replace(/\s+([.,;:!?])/g, "$1")
    .replace(/[\s,;:—–-]+$/, "")
    .trim();
}

/** Whether the words themselves are a fault or staff silence, whatever the surface called them. */
export function kindOfText(text: string): GeorgeKind | undefined {
  if (FAULT.test(text)) return "fault";
  if (SILENCE.test(text)) return "silence";
  return undefined;
}

/**
 * The gate. The five kinds on the whitelist reach him anywhere; where work
 * stands reaches him only on a screen he opened (the panel, the line under his
 * own message), never pushed. A deliverable, blocker or status line whose
 * words are a fault or staff silence is that, whatever it was called; a
 * decision, a login or an irreversible step always reaches him, in plain
 * words. Everything else is kept, with how Flyd handles it. Pure.
 */
export function reachesGeorge(item: ForGeorge, surface: GeorgeSurface): Gated {
  const kind = READ_BY_WORDS.has(item.kind) ? kindOfText(item.text) ?? item.kind : item.kind;
  const looking = surface === "panel" || surface === "status";
  if (!WHITELIST.has(kind) && !(kind === "status" && looking)) return { reach: false, kind, handle: HANDLING[kind] };
  const line = plainLine(item.text);
  return line ? { reach: true, kind, line } : { reach: false, kind: "fault", handle: "repair" };
}
