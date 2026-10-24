import { evaluatePredicates, JEV_PINNED_MODEL } from "../cognition/system-one/jev.js";
import { familyEgress, predicateThreshold, questionFor } from "../cognition/system-one/registry.js";
import { retiredPhrasesIn } from "../runtime/honesty-check.js";
import { BACKSTAGE_TELEMETRY, CHAT_BACKSTAGE, firstMatch } from "../lib/backstage.js";
import { readFileSync } from "node:fs";
import { readSoul } from "../lib/soul.js";
import { userProfilePath } from "../lib/user-profile.js";
import type { InteractionClass } from "../runtime/conversation-presence.js";
export type { InteractionClass } from "../runtime/conversation-presence.js";
import { isAcknowledgement } from "../conversation-view/summaries.js";

// The standard Flyd holds its own words to: what a chief of staff puts in
// front of George. Written down in docs/product/flyd-chief-of-staff-standard.md;
// this file is the same standard as checks. Cheap deterministic checks catch
// the plain failures ("Working on it", a helper named, a config call handed
// to him); the subtler ones are Jev Nouls (cognition/system-one/registry.ts,
// family self_review), asked only when the checks found nothing.

/** Where George saw it: a chat answer, a status line, a notification, or something relayed from the work behind Flyd. */
export type Surface = "chat" | "status" | "notification" | "relay";

export const REQUIREMENTS = [
  {
    id: "outcome_first",
    title: "Lead with the outcome",
    rule: "The first sentence tells George what happened, what is true, or what he needs to do. No preamble, no acknowledgement, no narration of what Flyd is about to do.",
  },
  {
    id: "real_status",
    title: "Real status, never a placeholder",
    rule: "A status or progress line names the concrete thing being done or what has happened. \"Working on it\", \"Looking into it\", \"Remembering what I know about this\" say nothing.",
  },
  {
    id: "backstage_hidden",
    title: "One voice, no machinery",
    rule: "George only ever talks to Flyd. Helpers (firstmate, crewmates, the Council, Scout, Jev), task and run ids, branches, worktrees and pipelines stay backstage unless he asked how Flyd works.",
  },
  {
    id: "decisions_handled",
    title: "Handle internal calls; bring him only his decisions",
    rule: "Implementation and process calls (gate it behind config, which test approach, retry or push back) are made by Flyd and the people working for him, and he hears the outcome. Only decisions about what he wants, his money, his name, people, or irreversible outward actions reach him, with a recommendation.",
  },
  {
    id: "artefact_when_visual",
    title: "Show it, don't wall-of-text it",
    rule: "A comparison, plan, multi-part status, or anything tabular reaches him as a Flyd artefact he can scan, not as a long chat message.",
  },
  {
    id: "his_voice",
    title: "His voice",
    rule: "Flyd sounds the way ~/.flyd/SOUL.md and USER.md say: \"sir\", never \"Captain\"; never a phrase he has ruled out; never a bot, a git log, or a scrum master.",
  },
] as const;

export type RequirementId = typeof REQUIREMENTS[number]["id"];

export function requirement(id: RequirementId): typeof REQUIREMENTS[number] {
  return REQUIREMENTS.find((item) => item.id === id)!;
}


export interface Said {
  interactionClass?: InteractionClass;
  /** Execution state and local evidence references, when supplied by the caller. */
  taskState?: string;
  evidenceRefs?: string[];
  surface: Surface;
  text: string;
  /** What George said that this answers, when known. */
  asked?: string;
  /** The tools the turn used ("name: outcome" lines), when known. */
  tools?: string[];
  /** Answered with his whole toolset but no record of which tools: it may hold his email, Drive or WhatsApp. */
  toolsUnknown?: true;
}

export interface Shortfall {
  requirement: RequirementId;
  /** Why this text breaks it, in one line. */
  reason: string;
  /** The offending words, clipped. */
  quote: string;
  by: "check" | "jev";
  probability?: number;
}

/** Phrases George has ruled out in his own files, matched case-insensitively. */
export interface VoiceRules {
  banned: string[];
}

const QUOTE_CHARS = 240;

function clip(text: string, max = QUOTE_CHARS): string {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
}

const normal = (text: string) => text.replace(/[‘’]/g, "'").replace(/[“”]/g, "\"").toLowerCase();

/** Code and links are quoted material, not Flyd's own words. */
function prose(text: string): string {
  return text.replace(/```[\s\S]*?```/g, " ").replace(/`[^`\n]*`/g, " ").replace(/https?:\/\/\S+/g, " ");
}

const RULE_LINE = /\b(?:never|don'?t|doesn'?t want|do not|avoid|no)\b/i;
/** Single quotes may hold an apostrophe ('that's on me'): one followed by a letter is not the closing quote. */
const QUOTED = /"([^"\n]{3,60})"|“([^”\n]{3,60})”|(?:^|[\s(])'((?:[^'\n]|'(?=[a-z])){3,60}?)'(?![a-z])|(?:^|[\s(])‘((?:[^’\n]|’(?=[a-z])){3,60}?)’(?![a-z])/g;

/**
 * The phrases George's own files rule out: quoted words on a line that says
 * never / don't / avoid. Patterns ("it's not X, it's Y") and single words
 * are left to judgment: matched literally they would hit ordinary speech.
 */
export function voiceRules(soul: string | null = readSoul(), profile: string | null = readProfile()): VoiceRules {
  const banned = new Set<string>();
  for (const line of `${soul ?? ""}\n${profile ?? ""}`.split("\n")) {
    if (!RULE_LINE.test(line)) continue;
    for (const match of line.matchAll(QUOTED)) {
      const phrase = normal(match[1] ?? match[2] ?? match[3] ?? match[4] ?? "").replace(/[.!?,;:\s]+$/g, "").trim();
      if (phrase.split(/\s+/).length < 2 || /\b[xy]\b/.test(phrase)) continue;
      banned.add(phrase);
    }
  }
  return { banned: [...banned] };
}

/** The whole of USER.md: the prompt copy is truncated, and his voice rules sit anywhere in it. */
function readProfile(): string | null {
  try {
    return readFileSync(userProfilePath(), "utf8");
  } catch {
    return null;
  }
}

const PLACEHOLDER = /^(?:(?:ok(?:ay)?|sure|right|alright|sir)[,!.]?\s+)?(?:(?:i'?m|i am|we'?re|still)\s+)?(?:working on (?:it|this|that)|working|on it|looking into (?:it|this|that)|looking (?:this|that|it) up|checking(?: on)? (?:it|this|that)|thinking|processing|one moment(?: please)?|one sec(?:ond)?|give me a (?:moment|sec(?:ond)?|minute)|hang on|bear with me|let me (?:check|look|see|think)|in progress|remembering what i know(?: about (?:this|that|it))?|getting (?:on|to) it|answering)(?:[,\s]+(?:now|for you|sir|please))*[\s.!…,]*$/i;

const PREAMBLE = /^(?:(?:sure|certainly|of course|absolutely|great question|good question|happy to help|okay so|alright so)\b|let me\b|i'?ll (?:start|begin|take a look|look|check|go|dig)\b|first,? i'?ll\b|i'?m going to\b|sir, done\b)/i;

/** He is being asked to choose. */
const ASKS_HIM = /\b(needs? your (?:call|decision|ok|okay|approval|sign-?off|input)|your (?:call|decision)\b|up to you\b|do you want (?:me|us|it|them) to\b|should (?:i|we)\b|shall (?:i|we)\b|which (?:do you|would you|one)\b|want me to\b[^.?!]*\bor\b|(?:please )?(?:approve|decide)\b|(?:i|we) need you to (?:decide|choose|pick|say|tell|confirm)\b|(?:tell|let) me (?:know )?(?:whether|if|which)\b|waiting (?:on|for) (?:you|your (?:call|decision|answer|word))\b|say the word\b)/i;
/** Flyd promising to bring him his decisions ("I'll flag anything that needs your call") is not asking him one. */
const PROMISES_HIM = /\b(?:i|we)(?:'ll| will| would)?\s+(?:only |always )?(?:flag|bring|tell|raise|surface|report|hand|pass on|escalate)\b[^.?!]*\b(?:needs? your|your (?:call|decision)|you (?:need|have) to decide|you to decide)/i;
/** …about how the work is built or run, which is not his to decide. */
const INTERNAL_MATTER = /\b(config|commit|push|sync|feature flag|flag|guard|gate|refactor|tests?|lint|ci|pipeline|branch|rebase|retry|retries|retried|re-?run|requeue|revert|roll ?back|restart|workaround|drop the (?:run|job|task|fix|change|patch)|push back|implementation|schema|migration|timeout|threshold|regex|prompt|turn-end|hooks?|endpoint|dependency|worktree|supervisor|daemon|inbox)\b/i;
/** Outward or irreversible: these stay his even when they sound technical. */
const HIS_DECISION = /\b(merge|land|ship|publish|deploy|release|send|email|post|delete|buy|spend|price|cost|budget|client|pay\w*|charg\w*|refund\w*|subscri\w*|renew\w*|cancel\w*|invoice\w*|contract\w*|sign\w*)\b/i;

const TABLE_ROW = /^\s*\|.*\|\s*$/;
const LIST_ITEM = /^\s*(?:[-*+•]|\d+[.)])\s+/;

function backstageWord(text: string): string | undefined {
  return firstMatch(prose(text), CHAT_BACKSTAGE) ?? undefined;
}

/**
 * An implementation or process call handed to George, by wording alone: one
 * sentence both asks him and is about how the work is built or run. Sentence
 * by sentence, so "I'll bring you only what needs your decision" after a
 * paragraph about a guard is not read as asking him about the guard, and
 * "I'll flag anything that needs your call" is a promise, not an ask. Anything
 * that touches his money, his name or an outward step stays his.
 */
export function handsHimInternalDecision(text: string): boolean {
  const plain = prose(text);
  if (HIS_DECISION.test(plain)) return false;
  return plain.split(/(?<=[.!?])\s+|\n+/).some((sentence) => ASKS_HIM.test(sentence) && INTERNAL_MATTER.test(sentence) && !PROMISES_HIM.test(sentence));
}

/** Only says something is happening: "Working on it", "Remembering what I know about this". */
export function isPlaceholder(text: string): boolean {
  return PLACEHOLDER.test(text.replace(/\s+/g, " ").trim());
}

function looksVisual(text: string): string | undefined {
  const lines = text.replace(/```[\s\S]*?```/g, "").split("\n");
  if (lines.filter((line) => TABLE_ROW.test(line)).length >= 3) return "a table sent as chat text";
  const items = lines.filter((line) => LIST_ITEM.test(line)).length;
  if (items >= 8) return `a ${items}-item list sent as chat text`;
  if (text.length > 2_000 && items >= 4) return "a long, structured answer sent as chat text";
  return undefined;
}

/** The deterministic half of the standard. Pure. */
export function checkSaid(said: Said, rules: VoiceRules = { banned: [] }): Shortfall[] {
  const text = said.text.trim();
  if (!text) return [];
  const asked = normal(said.asked ?? "");
  const shortfalls: Shortfall[] = [];
  const add = (id: RequirementId, reason: string, quote = text) => shortfalls.push({ requirement: id, reason, quote: clip(quote), by: "check" });

  if (isPlaceholder(text)) {
    add("real_status", "says only that something is happening, not what");
  } else if (said.interactionClass !== "conversation" && said.surface !== "status" && PREAMBLE.test(text)) {
    add("outcome_first", "opens with preamble instead of the outcome", text.split(/(?<=[.!?])\s/)[0] ?? text);
  }

  const word = backstageWord(text);
  const telemetry = firstMatch(prose(text), BACKSTAGE_TELEMETRY);
  // He named it himself, or asked how Flyd works: answering in kind is fine.
  if (word && !asked.includes(normal(word)) && !/\bhow (?:do|does) (?:you|flyd) work\b/.test(asked)) {
    add("backstage_hidden", `names backstage machinery ("${word}")`);
  } else if (telemetry && !/\b(commit|branch|sha|hash|id)\b/.test(asked)) {
    add("backstage_hidden", "reads like git or run telemetry", telemetry);
  }

  if (said.interactionClass !== "conversation" && said.surface !== "status" && handsHimInternalDecision(text)) {
    add("decisions_handled", "hands him an implementation call Flyd should make");
  }

  if (said.interactionClass !== "conversation" && (said.surface === "chat" || said.surface === "relay")) {
    const visual = looksVisual(text);
    if (visual) add("artefact_when_visual", visual);
  }

  const plain = normal(prose(text));
  const retired = retiredPhrasesIn(plain)[0];
  if (retired) add("his_voice", /^captain$/i.test(retired) ? "calls him \"Captain\"" : `uses a phrase he ruled out ("${retired}")`);
  const banned = rules.banned.find((phrase) => plain.includes(phrase));
  if (banned && banned !== retired?.toLowerCase()) add("his_voice", `uses a phrase he ruled out ("${banned}")`);
  return shortfalls;
}

/** One Jev question per requirement it judges; status lines are only asked whether they are placeholders. */
const JUDGED: Array<{ predicate: string; requirement: RequirementId; surfaces: Surface[]; fails: "yes" | "no"; reason: string }> = [
  { predicate: "cos_outcome_first", requirement: "outcome_first", surfaces: ["chat", "notification", "relay"], fails: "no", reason: "the opening does not give him the outcome" },
  { predicate: "cos_placeholder", requirement: "real_status", surfaces: ["chat", "status", "notification", "relay"], fails: "yes", reason: "a placeholder: says work is happening, not what" },
  { predicate: "cos_internal_decision", requirement: "decisions_handled", surfaces: ["chat", "notification", "relay"], fails: "yes", reason: "hands him an internal call Flyd should make" },
  { predicate: "cos_wants_artefact", requirement: "artefact_when_visual", surfaces: ["chat", "relay"], fails: "yes", reason: "would reach him better as an artefact" },
  { predicate: "cos_off_voice", requirement: "his_voice", surfaces: ["chat", "notification", "relay"], fails: "yes", reason: "off his voice" },
];

export interface JudgeOptions {
  apiKey?: string;
  model?: string;
  timeoutMs?: number;
  fetchFn?: typeof fetch;
}

/** The Jev release the self-review asks: FLYD_JEV_MODEL, else the pinned release the thresholds were benched on. */
export function selfReviewJevModel(): string {
  return process.env.FLYD_JEV_MODEL ?? JEV_PINNED_MODEL;
}

/** Email, Drive and WhatsApp content, or talk of it: none of it leaves the machine for a judgment. */
const CONNECTOR_TOOL = /^\s*(?:connected_accounts|email_\w+|drive_\w+|whatsapp_\w+)\b/i;
const CONNECTOR_CONTENT = /\b(e-?mails?|gmail|inbox|mailbox|dreamhost|drafts?|google drive|drive|google docs?|docs?|sheets?|slides|whatsapp|messages?|messaged|texted|chats?|threads?|attachments?|subject|cc|replied|wrote)\b/i;

/** May this text be sent to Jev: only when nothing in it or its turn came from his accounts. */
export function mayJudgeRemotely(said: Said): boolean {
  if (said.toolsUnknown || said.tools?.some((line) => CONNECTOR_TOOL.test(line))) return false;
  return !CONNECTOR_CONTENT.test(said.text) && !CONNECTOR_CONTENT.test(said.asked ?? "");
}

/**
 * The judgment half: every applicable question about one text in a single
 * Jev request. Off unless FLYD_SELF_REVIEW_JEV=1, and never for anything
 * built from his email, Drive or WhatsApp. Empty when off, unconfigured or
 * failing; the checks still stand on their own.
 */
export async function judgeSaid(said: Said, options: JudgeOptions = {}): Promise<Shortfall[]> {
  // Tests pass their own key; a developer's real one never makes a test call Jev.
  const apiKey = options.apiKey ?? (process.env.VITEST ? undefined : process.env.TYPESAFE_API_KEY);
  if (!apiKey || process.env.FLYD_SELF_REVIEW_JEV !== "1" || !mayJudgeRemotely(said)) return [];
  const judged = JUDGED.filter((item) => item.surfaces.includes(said.surface)
    && (said.interactionClass !== "conversation" || item.requirement === "his_voice"));
  const state = {
    text: said.text.slice(0, 4_000),
    surface: said.surface,
    george_said: (said.asked ?? "").slice(0, 1_000),
  };
  const result = await evaluatePredicates(
    state,
    judged.map((item) => questionFor(item.predicate)),
    { apiKey, timeoutMs: options.timeoutMs ?? 5_000, model: options.model ?? selfReviewJevModel(), ...(options.fetchFn ? { fetchFn: options.fetchFn } : {}) },
    familyEgress("self_review"),
  );
  if (!result.ok) return [];
  return judged.flatMap((item) => {
    const probability = result.answers[item.predicate]?.probability;
    if (probability === undefined) return [];
    const threshold = predicateThreshold(item.predicate);
    const failed = item.fails === "yes" ? probability >= threshold : probability <= 1 - threshold;
    return failed ? [{ requirement: item.requirement, reason: item.reason, quote: clip(said.text), by: "jev" as const, probability }] : [];
  });
}

/**
 * The whole review of one text: the checks, and Jev only when the checks
 * found nothing (a plain failure needs no model to confirm it).
 */
export async function reviewSaid(said: Said, options: JudgeOptions & { rules?: VoiceRules } = {}): Promise<Shortfall[]> {
  const checked = checkSaid(said, options.rules);
  if (checked.length) return checked;
  return judgeSaid(said, options).catch(() => []);
}

/**
 * Before display: should this never reach George as written? A placeholder
 * carries nothing; an internal call handed to him is Flyd's to settle. Sync
 * and deterministic, so it can sit in front of any surface.
 */
export function screenBeforeDisplay(said: Said): { hold: boolean; shortfalls: Shortfall[] } {
  const shortfalls = checkSaid(said).filter((item) => item.requirement === "real_status" || item.requirement === "decisions_handled");
  return { hold: shortfalls.length > 0, shortfalls };
}

/** The longest notification: one line, read at a glance on the island or in a banner. */
export const NOTIFICATION_CHARS = 140;
/** Openings that only address or acknowledge him, or announce what follows. */
const NOTICE_LEAD = /^(?:(?:sir|captain|george)\s*[,!:—-]\s*)?(?:(?:done|ok(?:ay)?|sure|right|noted|got it|all set|update)[.!,:]\s+)?(?:here(?:'s| is) (?:your|the) [^.:!?]{1,40}[.:]\s+)?/i;

/**
 * A notification as George reads it: one line, outcome first. Markdown,
 * lists, the opening address and sentences that say nothing go; the rest
 * stays whole when it fits, else its first sentence that says something,
 * cut at a word when it runs long. Pure.
 */
export function notificationLine(text: string): string {
  const flat = text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/^\s*(?:#{1,6}\s+|[-*+•]\s+|\d+[.)]\s+|>\s*)/gm, "")
    .replace(/\*\*([^*]+)\*\*|__([^_]+)__/g, "$1$2")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  const opened = flat.replace(NOTICE_LEAD, "") || flat;
  const said = opened.match(/.+?[.!?](?=\s|$)|.+$/g)?.map((sentence) => sentence.trim()).filter(Boolean) ?? [opened];
  const kept = said.filter((sentence) => !isPlaceholder(sentence) && !isAcknowledgement(sentence));
  const whole = kept.join(" ");
  const first = whole && whole.length <= NOTIFICATION_CHARS ? whole : kept[0] ?? said[0] ?? opened;
  const line = first.length <= NOTIFICATION_CHARS ? first : `${first.slice(0, first.lastIndexOf(" ", NOTIFICATION_CHARS - 1) > 60 ? first.lastIndexOf(" ", NOTIFICATION_CHARS - 1) : NOTIFICATION_CHARS - 1).replace(/[\s,;:—-]+$/, "")}…`;
  return line.charAt(0).toUpperCase() + line.slice(1);
}

/** A coding session's own idle prompt ("Claude is waiting for your input"): never George's, whoever forwards it. */
const IDLE_NOTICE = /\b(?:is )?waiting (?:on|for) your input\b|\bneeds your attention\b/i;
/** Who sends those notices: a coding agent's session, never Flyd or its agenda. */
const CODING_AGENT = /\b(?:claude(?: code)?|codex|opencode)\b/i;

/**
 * Whether a notification only says a coding session is idle at its prompt.
 * Those sessions wait while their checks run; Flyd watches them, George
 * never needs to hear it. Pure.
 */
export function isIdleNotice(title: string, message: string): boolean {
  const said = `${title} ${message}`;
  return (/\bidle_prompt\b/i.test(said) || (IDLE_NOTICE.test(said) && CODING_AGENT.test(said))) && !/\b(?:permission|allow|approve|usage limit)\b/i.test(message);
}
