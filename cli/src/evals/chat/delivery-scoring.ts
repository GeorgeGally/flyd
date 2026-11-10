import { relayShortfalls } from "../../runtime/honesty-check.js";
import { LINE_CHARS, MAX_CHARS, MAX_LINES } from "../../conversation-view/for-george.js";
import type { DomainResult, DomainRun } from "../../command/types.js";

// Delivery evals: how finished work reaches George, scored against the split
// plan's Delivery standard (docs/plans/2026-10-30-flyd-chief-of-staff-split-plan.md).
// Each case is something that came back (a finished run, a staff reply, Flyd's
// own answer, a failed turn) and the scoring reads only what he would see.
// Pure, so every rule is unit-tested; the producers live in delivery-run.ts.

/** The forms a delivery takes; anything without a shape is words. */
export const DELIVERY_SHAPES = ["picture", "decision", "steps", "document", "landed", "words"] as const;
export type DeliveryShape = typeof DELIVERY_SHAPES[number];

/**
 * Which of today's paths a case goes through:
 * - notification: a finished run, through the review step to his notification;
 * - window: a staff reply under his message in the conversation window;
 * - answer: Flyd's own answer body as the window shows it;
 * - desk-error: a window turn that failed;
 * - recorded: a line no code path can replay yet, scored as he was shown it.
 */
export type DeliverySurface = "notification" | "window" | "answer" | "desk-error" | "recorded";

/** A finished run, with only what the case needs; the runner fills the rest. */
export interface DeliveryRunFixture {
  domain: DomainRun["request"]["domain"];
  status: DomainRun["status"];
  words: string;
  outcome?: string;
  result: Partial<DomainResult>;
  /** Notes Flyd already sent the boss about it, so the review step's one send-back is spent. */
  sentToBoss?: string[];
}

export interface DeliveryExpect {
  /** False for chatter Flyd should keep: nothing may reach him. Default true. */
  delivered?: boolean;
  shape?: DeliveryShape;
  /** Clarity rubric for the judge; the delivery must score at least judgeMin (default 7). */
  judge?: string;
  judgeMin?: number;
}

export interface DeliveryCase {
  id: string;
  category: "delivery";
  /** A fixture covers a rule; a real case is a delivery George actually got. */
  origin: "fixture" | "real";
  surface: DeliverySurface;
  /** For a real case: what he was shown, and where the record of it is. */
  seen?: string;
  source?: string;
  run?: DeliveryRunFixture;
  reply?: { question: string; text: string };
  answer?: unknown;
  error?: string;
  /** What he was already told on earlier occasions; saying it again fails. */
  previous?: string[];
  expect: DeliveryExpect;
}

export interface DeliveryObservation {
  /** What he sees first, or null when nothing reached him. */
  text: string | null;
  shape: DeliveryShape;
  seconds: number;
  error?: string;
  judgeScore?: number;
  judgeReason?: string;
}

export interface DeliveryScore {
  passed: boolean;
  failures: string[];
}

/** A file path in the text, a URL aside. */
const PATH = /(?:^|[\s(:;])(?:~|\.{1,2})?\/?[\w.-]+\/[\w./-]*[\w-]\.(?:md|tsx?|jsx?|json|html?|txt|log|ya?ml|sh|swift|sqlite)\b/i;
/** A task or run slug: lowercase, hyphenated, with a digit ("cap5-dash-lab-r5-calls"). */
const SLUG = /\b(?=[a-z0-9-]*\d)[a-z0-9]+(?:-[a-z0-9]+){2,}\b/;
/** The review and fleet words the staff use among themselves. */
const PIPELINE = /\b(?:ask-user|parked at|no-mistakes|review gate|worker|handoff|fleet)\b|\bfinding\(s\)/i;
/** Error text, said as it was thrown. */
const ERROR_TEXT = /\b(?:[A-Z]\w*Error|ENOENT|EACCES|ECONN\w+|ETIMEDOUT|stderr|stack trace|exit code \d+)\b|couldn['’]t answer this:/;
/** The diagnosis card's labels, which are Flyd's own working notes. */
const CARD_LABEL = /^\s*(?:\*\*)?(?:Diagnosis|Expected|Observed|Cause|Evidence|Next)\s*:/im;
/** Talking about him rather than to him. */
const THIRD_PERSON = /\bGeorge(?:['’]s)?\b/;

const plain = (text: string): string => text.replace(/\s+/g, " ").trim().toLowerCase();
const withoutUrls = (text: string): string => text.replace(/https?:\/\/\S+/g, "");

function sentencesOf(text: string): string[] {
  return text.split(/(?<=[.!?])\s+|\n+/).map(plain).filter((sentence) => sentence.length > 12);
}

/** The text as he reads it: a Markdown link shows its words, not its address. */
export function visibleText(text: string): string {
  return text.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
}

/** What he reads first: the first line, as shown. */
export function leadOf(text: string): string {
  return visibleText(text).split("\n").map((line) => line.trim()).find(Boolean) ?? "";
}

export function scoreDelivery(testCase: DeliveryCase, observed: DeliveryObservation): DeliveryScore {
  const failures: string[] = [];
  if (observed.error) failures.push(`errored: ${observed.error}`);
  const text = (observed.text ?? "").trim();
  const expect = testCase.expect;
  if (expect.delivered === false) {
    if (text) failures.push(`told him about work Flyd should keep: "${text.slice(0, 120)}"`);
    return { passed: failures.length === 0, failures };
  }
  if (!text) {
    failures.push("nothing reached him");
    return { passed: false, failures };
  }
  if (expect.shape && observed.shape !== expect.shape) failures.push(`delivered as ${observed.shape}, expected ${expect.shape}`);
  const lead = leadOf(text);
  if (lead.length > LINE_CHARS) failures.push(`lead line ${lead.length} chars > ${LINE_CHARS}`);
  const shown = visibleText(text);
  const lines = shown.split("\n").filter((line) => line.trim()).length;
  if (lines > MAX_LINES) failures.push(`${lines} lines > ${MAX_LINES}`);
  if (shown.length > MAX_CHARS) failures.push(`${shown.length} chars > ${MAX_CHARS} before "more"`);
  for (const shortfall of relayShortfalls(text)) failures.push(shortfall.reason);
  const bare = withoutUrls(text);
  const path = bare.match(PATH)?.[0]?.trim();
  if (path) failures.push(`shows a path ("${path}")`);
  const slug = bare.match(SLUG)?.[0];
  if (slug) failures.push(`shows a task id ("${slug}")`);
  const pipeline = bare.match(PIPELINE)?.[0];
  if (pipeline) failures.push(`uses the staff's words ("${pipeline}")`);
  if (ERROR_TEXT.test(text) || (testCase.error && text.includes(testCase.error))) failures.push("shows him the error");
  if (CARD_LABEL.test(text)) failures.push("shows the diagnosis card's labels");
  if (THIRD_PERSON.test(text)) failures.push("talks about him, not to him");
  const said = sentencesOf(text);
  if (new Set(said).size < said.length) failures.push("repeats itself");
  const before = (testCase.previous ?? []).map(plain);
  if (before.includes(plain(text)) || before.includes(plain(lead))) failures.push("tells him what he was already told");
  if (expect.judge) {
    const minimum = expect.judgeMin ?? 7;
    if (observed.judgeScore === undefined) failures.push("judge did not score the delivery");
    else if (observed.judgeScore < minimum) failures.push(`judge ${observed.judgeScore}/10 < ${minimum}: ${observed.judgeReason ?? ""}`.trim());
  }
  return { passed: failures.length === 0, failures };
}

/** The judge's prompt: clarity for George, from what he sees alone. */
export function buildDeliveryJudgePrompt(testCase: DeliveryCase, text: string): string {
  const asked = testCase.run?.words ?? testCase.reply?.question ?? "";
  return [
    "You are grading how Flyd, a personal assistant, told its user, George, about work that came back. Flyd speaks to him in the first person: \"I\" is Flyd, and work it or its people do is Flyd's own. Be demanding: 10 is what a brilliant human PA would say in a line or two; 5 is merely acceptable.",
    "Judge only what he sees. He should know at once what happened and what, if anything, he needs to do, with no internal machinery, staff names, ids, paths or error text, and no more words than that needs.",
    asked ? `What he had asked for: ${asked}` : "",
    `What he was shown:\n${text || "(nothing)"}`,
    `Rubric: ${testCase.expect.judge}`,
    'Reply with JSON only: {"score": <integer 1-10>, "reason": "<one sentence on the biggest weakness>"}',
  ].filter(Boolean).join("\n\n");
}
