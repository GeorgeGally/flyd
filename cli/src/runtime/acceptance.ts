// What "done" means, agreed before the work starts, and an independent
// verdict on each point after it. Shared by background jobs and the crew:
// the worker that built something never grades it.

import { validateDomainHandoff, type HandoffLayer } from "../command/result.js";
import type { DomainResult, DomainRun } from "../command/types.js";

export interface AcceptanceCheck {
  criterion: string;
  met: boolean;
  note: string;
  /** The check itself couldn't run: not evidence that the work fell short. */
  unchecked?: boolean;
  /** Not done, but the report names a specific blocker with evidence, as the point allowed. */
  blocked?: boolean;
}

/** done_when from a tool call: a list, or a single string; blanks dropped. */
export function normalizeCriteria(value: unknown): string[] {
  return (Array.isArray(value) ? value : [value])
    .map((item) => String(item ?? "").replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

export const VERDICT_FORMAT = [
  "Reply with exactly one line per point, in order, and nothing else:",
  "MET <n>: <what you saw that proves it>",
  "UNMET <n>: <what is missing or wrong>",
];

const VERDICT_LINE = /^[*_\s-]*(MET|UNMET)\s*(\d+)[*_]*\s*[:.)-]\s*(.*)$/i;

/**
 * Points the checker didn't answer are unconfirmed, not unmet: silence is
 * neither evidence the work is done nor that it fell short.
 * A reply with no verdict lines at all is a broken check, not a failed one,
 * so it throws: the caller mustn't pay for a repair round on no feedback.
 */
export function parseVerdicts(criteria: string[], reply: string): AcceptanceCheck[] {
  const verdicts = new Map<number, { met: boolean; note: string }>();
  const lines = reply.split("\n").map((line) => line.trim());
  if (!lines.some((line) => VERDICT_LINE.test(line))) throw new Error("the check gave no verdicts");
  for (const line of lines) {
    const match = line.match(VERDICT_LINE);
    if (!match) continue;
    const index = Number(match[2]) - 1;
    if (!verdicts.has(index)) verdicts.set(index, { met: match[1].toUpperCase() === "MET", note: match[3].trim() });
  }
  return criteria.map((criterion, index) => ({
    criterion,
    ...(verdicts.get(index) ?? { met: false, note: "the check couldn't confirm it", unchecked: true }),
  }));
}

export function unmetChecks(checks: AcceptanceCheck[]): AcceptanceCheck[] {
  return checks.filter((check) => !check.met);
}

/** "a (why); b (why)" — the shortfall in one plain line. */
export function shortfall(checks: AcceptanceCheck[]): string {
  return unmetChecks(checks).map((check) => `${check.criterion} (${check.note})`).join("; ");
}

// "X, or if blocked, report one specific blocker with evidence": two clauses.
// The work is done only when X holds; the blocker clause is the honest way
// out, never another way to succeed.
const BLOCKER_ALTERNATIVE = /^(.*?)[\s,;:(—–-]*\b(?:or|otherwise)\b[\s,]+(?:if|when)\s+(?:(?:it|that|this|the job|you)(?:'s|’s|'re|’re| is| are)\s+)?(?:blocked|stuck)\b[\s,:;—–-]*(.*?)[).\s]*$/i;

export function splitClauses(criterion: string): { success: string; blocker?: string } {
  const match = criterion.match(BLOCKER_ALTERNATIVE);
  if (!match || !match[1].trim()) return { success: criterion };
  return { success: match[1].trim(), blocker: match[2].trim() || "name one specific blocker with evidence" };
}

/** What the checker is asked to confirm: each point's success clause alone. */
export function successClauses(criteria: string[]): string[] {
  return criteria.map((criterion) => splitClauses(criterion).success);
}

// A concrete reference someone else could check: a URL, a path or file, a
// quoted command or its output, an opaque id (a Canva design, a commit, a pid).
const EVIDENCE = [
  /\bhttps?:\/\/\S+/i,
  /(?:^|[\s("'`])(?:~|\.{1,2})?\/[\w.@%+-]+/,
  /\b[\w.-]+\/(?=[\s"'`),:;]|$)/,
  /\b[\w-]+(?:\/[\w.-]+)*\.(?:html?|css|[cm]?[jt]sx?|json|md|txt|csv|log|pdf|png|jpe?g|gif|webp|svg|mp[34]|wav|m4a|mov|py|sh|ya?ml|toml|pptx?|docx?|xlsx?|key|zip)\b/i,
  /`[^`\n]+`/,
  /(?<![\w-])(?=\w*\d)(?=\w*[a-z])\w{8,}(?![\w-])/i,
  /\b[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\b/i,
  /\b(?:exit(?:ed)?(?: with)?(?: code| status)?|HTTP|status|pid) ?:? ?\d{1,6}\b/i,
];

export function citesEvidence(text: string): boolean {
  return EVIDENCE.some((pattern) => pattern.test(text));
}

const STOP_WORDS = new Set("about after also been before both does done each every from have into just made make must only over report should some such than that their them then there they this were what when which will with your".split(" "));

function stems(text: string): Set<string> {
  return new Set((text.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((word) => word.length >= 4 && !STOP_WORDS.has(word)).map((word) => word.slice(0, 5)));
}

function sentences(report: string): string[] {
  return report.split(/\n+|(?<=[.!?])\s+(?=[A-Z`"'(])/).map((line) => line.trim()).filter(Boolean);
}

/** The report's first sentence about this point that cites something checkable and passes the test. */
function reportEvidence(clause: string, report: string, onlyPoint: boolean, test: (line: string) => boolean = () => true): string | undefined {
  const about = stems(clause);
  return sentences(report).find((line) => test(line) && citesEvidence(line) && (onlyPoint || [...stems(line)].some((stem) => about.has(stem))));
}

const BLOCKER_WORDS = /\b(?:blocked|blocker|couldn'?t|could not|can'?t|cannot|unable|failed|fails|denied|refused|rejected|no access|not allowed|forbidden|unauthori[sz]ed)\b/i;

/** A process the job started that outlived it: a tunnel, a server. */
export interface LeftoverProcess { pid: number; command: string }

export interface DoneWhenEvidence {
  criteria: string[];
  /** The worker's final report: a claim, but where its evidence is cited. */
  report: string;
  /** The independent checker's verdicts on each success clause, in order. Omitted, only the report's own evidence counts. */
  verdicts?: AcceptanceCheck[];
  /** Processes the job started that are still running now it has finished. */
  leftovers?: LeftoverProcess[];
}

export const LEFTOVER_CRITERION = "nothing it started is left running";

/**
 * The done_when verdict, deterministically, after any model check: a point is
 * met only when its success clause was confirmed and something concrete backs
 * it (in the checker's note or the report's own words about that point).
 * A point that isn't met may still be honestly blocked; a leftover process is
 * one more unmet point.
 */
export function evaluateDoneWhen(input: DoneWhenEvidence): AcceptanceCheck[] {
  const onlyPoint = input.criteria.length === 1;
  const checks = input.criteria.map((criterion, index): AcceptanceCheck => {
    const { success, blocker } = splitClauses(criterion);
    const verdict = input.verdicts?.[index];
    if (verdict?.unchecked) return { ...verdict, criterion: success };
    const cited = verdict?.met && citesEvidence(verdict.note) ? verdict.note : reportEvidence(success, input.report, onlyPoint);
    if ((verdict?.met ?? true) && cited) return { criterion: success, met: true, note: verdict?.note || cited };
    const why = verdict && !verdict.met ? verdict.note : "nothing concrete shows it (no file, command output, link or id)";
    if (blocker) {
      // Blocked is its own claim: a report that only says it worked never satisfies it.
      const named = reportEvidence(success, input.report, onlyPoint, (line) => BLOCKER_WORDS.test(line));
      if (named) return { criterion: success, met: false, blocked: true, note: `${why}; blocked: ${named}` };
    }
    return { criterion: success, met: false, note: why };
  });
  const leftovers = input.leftovers ?? [];
  if (leftovers.length) {
    const running = leftovers.map((process) => `pid ${process.pid} \`${process.command.slice(0, 120)}\``).join(", ");
    checks.push({ criterion: LEFTOVER_CRITERION, met: false, note: `still running: ${running}` });
  }
  return checks;
}

/** done: every point met; blocked: every unmet point is an honest blocker; short: anything else. */
export function doneWhenStatus(checks: AcceptanceCheck[]): "done" | "blocked" | "short" {
  const unmet = unmetChecks(checks);
  if (!unmet.length) return "done";
  return unmet.every((check) => check.blocked) ? "blocked" : "short";
}

/** "point: why" for each point not done: what the job record keeps instead of a success. */
export function unresolvedItems(checks: AcceptanceCheck[]): string[] {
  return unmetChecks(checks).map((check) => `${check.criterion}: ${check.note}`);
}

export interface DomainHandoffCheck {
  ok: boolean;
  missing: string[];
  reason?: string;
  /** The "report" was a shell flag or nothing at all: not prose that fell short, but no report. */
  fragment?: boolean;
}

const VERB = /\b(is|are|was|were|be|been|has|have|had|now|added|removed|changed|fixed|updated|moved|landed|shipped|built|wrote|written|ran|runs|works|sets|set|keeps|kept|made|makes|cuts|ticks|shows|reads|uses|takes|gives|puts|ranks|widens|tallies|stacks|aligns|matches|fills|swaps|replaces|renames|splits|merges|deletes|creates|returns|emits|renders|reloads|ships|verified|tested|passes|failed|pass|fails)\b/i;

/** The only report shapes that read as prose paragraph(s): one sentence, at least, with a verb in it. */
function readsAsReport(value: string): boolean {
  const text = value.trim();
  if (!text) return false;
  if (/^(-{1,2}|\/)\S*/.test(text)) return false;
  const clauses = text.split(/[.;:!?\n]+/).map((clause) => clause.trim()).filter((clause) => clause.split(/\s+/).length >= 3);
  return clauses.some((clause) => VERB.test(clause));
}

/**
 * The layered brief/report/evidence contract, checked against a handoff payload
 * of any shape. A run whose reply misses a section has not delivered work Flyd
 * can act on, so it is refused at the check layer rather than reported as an
 * outcome: twelve-plus domain runs came back unstructured today, three with a
 * bare shell flag as the "report", and prose alone could not stop that.
 */
export function checkDomainHandoff(detail: unknown): DomainHandoffCheck {
  const record = (detail && typeof detail === "object" ? detail : {}) as Record<string, unknown>;
  const pick = (...keys: string[]): string =>
    keys.map((key) => record[key]).find((value) => typeof value === "string" && value.trim())?.toString().trim() ?? "";
  const list = (value: unknown): string[] =>
    Array.isArray(value) ? value.map((item) => String(item ?? "").trim()).filter(Boolean) : typeof value === "string" && value.trim() ? [value.trim()] : [];

  const brief = pick("brief", "summary", "intent");
  const report = pick("report", "detailed_report", "detailedReport", "detail");
  const evidence = [...list(record.evidence), ...list(record.artifacts)];
  const missing: string[] = [];
  if (!brief) missing.push("brief");
  if (!readsAsReport(report)) missing.push("report");
  if (!evidence.some((item) => item.trim())) missing.push("evidence");
  const fragment = !report || /^(-{1,2}|\/)\S*/.test(report);
  return missing.length ? { ok: false, missing, reason: `handoff:missing ${missing.join(",")}`, ...(fragment ? { fragment } : {}) } : { ok: true, missing: [] };
}

const LAYERS: HandoffLayer[] = ["brief", "report", "evidence"];

/** What each layer of the contract is, said when it is missing. */
const LAYER_GAPS: Record<HandoffLayer, string> = {
  brief: "brief (no one-line outcome)",
  report: "report (no prose account of what was done)",
  evidence: "evidence (no link, commit, file, id or command output to check it against)",
};

/**
 * A FirstMate return, after parseDomainResult's light normalisation (key
 * casing, wrapped or fenced JSON, "key: value" lines), checked against both
 * definitions of the brief/report/evidence contract: a layer is there only
 * when validateDomainHandoff finds it and checkDomainHandoff does not refuse
 * it (a report that is a shell flag, or only the reply itself, is no report;
 * prose is never re-requested for its choice of verb). Evidence counts when
 * either finds it: a PR URL in the brief, or an artefact pointer, stands in for it.
 */
export function validateFirstmateReturn(result: DomainResult): { ok: true; missing: [] } | { ok: false; missing: HandoffLayer[] } {
  const layered = validateDomainHandoff(result);
  const strict = checkDomainHandoff(result);
  const layeredMisses = (layer: HandoffLayer) => !layered.ok && layered.missing.includes(layer);
  // A structured reply that named no report carries the whole reply as one (parseDomainResult): no report was written.
  const noReport = result.format === "structured" && result.detailedReport.trim() === (result.raw[0] ?? "").trim();
  const missing = LAYERS.filter((layer) => layer === "evidence"
    ? layeredMisses(layer) && strict.missing.includes(layer)
    : layeredMisses(layer) || strict.missing.includes(layer) && (layer !== "report" || Boolean(strict.fragment)) || (layer === "report" && noReport));
  return missing.length ? { ok: false, missing } : { ok: true, missing: [] };
}

/** "the brief and evidence layers" */
function layerNames(missing: HandoffLayer[]): string {
  const names = missing.length > 1 ? `${missing.slice(0, -1).join(", ")} and ${missing.at(-1)}` : missing[0] ?? "";
  return `the ${names} layer${missing.length > 1 ? "s" : ""}`;
}

/** Flyd's one structured re-request to FirstMate when its return missed the contract: which layers, and the shape to answer in. */
export function handoffReRequest(missing: HandoffLayer[]): string {
  return [
    `Flyd recorded your last reply, but it misses ${layerNames(missing)} of the handoff contract: ${missing.map((layer) => LAYER_GAPS[layer]).join("; ")}.`,
    'Reply once more with one JSON object and nothing else: {"status": "completed|needs_decision|failed", "brief": "the outcome in one line", "detailed_report": "what was done and verified, in prose", "evidence": ["PR URL, commit, file path or command output"]}',
    "Keep the same outcome; this only restates it in the contract's shape. Flyd asks once.",
  ].join("\n");
}

/** Why a FirstMate return still misses the contract after Flyd's one re-request, naming each missing layer. */
export function handoffFailureReason(missing: HandoffLayer[]): string {
  return `handoff contract unmet after one structured re-request: missing ${missing.map((layer) => LAYER_GAPS[layer]).join("; ")}`;
}

/** How long the one re-request may go unanswered before the run counts as a contract failure. */
export const HANDOFF_RETRY_WAIT_MS = 24 * 60 * 60_000;

/**
 * What a run's recorded handoff still misses after its one structured re-request, as one clause naming each
 * missing layer, or undefined when it met the contract, was never re-requested, or is still waiting on the
 * answer: a return that was normalised, or is being retried, is not a failure.
 */
export function domainHandoffShortfall(run: DomainRun, now: Date = new Date()): string | undefined {
  const retry = run.handoffRetry;
  if (!run.result || !retry) return undefined;
  const check = validateFirstmateReturn(run.result);
  if (check.ok) return undefined;
  const gaps = `${layerNames(check.missing)}: ${check.missing.map((layer) => LAYER_GAPS[layer]).join("; ")}`;
  if (retry.answeredAt) return `still missed ${gaps}, after one structured re-request`;
  return now.getTime() - Date.parse(retry.askedAt) < HANDOFF_RETRY_WAIT_MS ? undefined : `missed ${gaps}, and the one structured re-request went unanswered`;
}
