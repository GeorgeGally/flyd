import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { FLYD_APPLICATION_ROOT, FLYD_DIR } from "../lib/config.js";
import { readAdvisories } from "../council/advisors.js";
import { recentJournal } from "../council/journal.js";
import { localDay } from "../council/memory-store.js";
import { normalizeCriteria } from "../runtime/acceptance.js";
import { dispatchCrewTask, listTasks, type CrewTask } from "./crew.js";
import { listDomainRuns } from "../command/store.js";
import type { DomainRun } from "../command/types.js";
import { routingFailureEvidence } from "../runtime/routing-learning.js";

// Flyd improving Flyd, with George holding the gate. Once a day it gathers
// evidence of where it fell short — /flyd-fix corrections, failed chat
// evals, advisories George waved away, moments he pushed back in
// conversation, crew tasks that failed — and asks an improver, in the
// Critic's measured voice, to pick ONE concrete, testable change. That
// change goes to the coding crew on a branch of the Flyd repo, verified by
// the repo's own checks. Nothing lands without George's /land.

export interface Evidence {
  id: string;
  kind: "fix" | "eval" | "dismissed" | "pushback" | "crew" | "job" | "loop" | "domain";
  at: string;
  text: string;
}

// Where a failure came from decides what the fix should be. A fix that lives
// in the harness (a check, a validator, a tool contract, saved state) holds
// on every run; a prompt rule holds only while the model remembers it.
export const FAILURE_CLASSES = ["missing_context", "wrong_tool", "bad_output", "repeated_loop", "unsafe_action", "lost_decision", "judgment", "unknown"] as const;
export type FailureClass = typeof FAILURE_CLASSES[number];
export const FIX_LAYERS = ["check", "tool", "context", "state", "trace", "prompt"] as const;
export type FixLayer = typeof FIX_LAYERS[number];

export interface Improvement {
  title: string;
  outcome: string;
  why: string;
  evidence: string[];
  failureClass?: FailureClass;
  layer?: FixLayer;
  /** Checkable points the crew's reviewer holds the diff to. */
  doneWhen?: string[];
}

export interface Attempt {
  at: string;
  title: string;
  taskId?: string;
  evidence: string[];
}

interface SelfImproveState {
  lastRunAt?: string;
  seen: string[];
  attempts: Attempt[];
}

export function selfImproveDir(): string {
  return process.env.FLYD_SELF_IMPROVE_DIR?.trim() || join(FLYD_DIR, "self-improve");
}

function readState(dir: string): SelfImproveState {
  try {
    const state = JSON.parse(readFileSync(join(dir, "state.json"), "utf8")) as Partial<SelfImproveState>;
    return { seen: state.seen ?? [], attempts: state.attempts ?? [], ...(state.lastRunAt ? { lastRunAt: state.lastRunAt } : {}) };
  } catch {
    return { seen: [], attempts: [] };
  }
}

function writeState(state: SelfImproveState, dir: string): void {
  const path = join(dir, "state.json");
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.tmp`;
  // Keep the seen set bounded; old evidence ages out of every source anyway.
  writeFileSync(temporary, `${JSON.stringify({ ...state, seen: state.seen.slice(-2_000), attempts: state.attempts.slice(-50) }, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  renameSync(temporary, path);
}

function readJsonFiles<T>(dir: string): Array<{ name: string; value: T }> {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((name) => name.endsWith(".json")).flatMap((name) => {
    try { return [{ name, value: JSON.parse(readFileSync(join(dir, name), "utf8")) as T }]; } catch { return []; }
  });
}

// Phrases George uses when an answer missed. Only a filter for what the
// improver reads; the improver decides whether it was really Flyd's fault.
const PUSHBACK = /^(?:no\b|nope\b|wrong\b|that'?s (?:not|wrong)|not what i|i (?:never|didn'?t) (?:ask|say|want)|you (?:forgot|missed|didn'?t|ignored)|why did you|stop\b|that'?s not (?:right|true|it)|still (?:not|wrong|broken))/i;

export interface EvidenceSources {
  flydDir?: string;
  since?: string;
  now?: Date;
}

/** Everything that says Flyd fell short, newest first, bounded. */
export function gatherEvidence(sources: EvidenceSources = {}): Evidence[] {
  const flydDir = sources.flydDir ?? FLYD_DIR;
  const now = sources.now ?? new Date();
  const since = sources.since ?? new Date(now.getTime() - 14 * 86_400_000).toISOString();
  const evidence: Evidence[] = [];
  // Provisional judge disagreements never become facts. Reviewed routing
  // errors and current-policy revalidation failures share this evidence loop.
  evidence.push(...routingFailureEvidence(flydDir).filter((item) => item.at >= since));

  const recorded = new Map(readJsonFiles<{ id: string; recordedAt: string }>(join(flydDir, "fixes")).map(({ value }) => [value.id, value.recordedAt]));
  for (const { value } of readJsonFiles<{ incidentId: string; prompt?: string; rejectedAnswer?: string; expected?: { feedback?: string; failureClasses?: string[] } }>(join(flydDir, "evals", "incidents"))) {
    const at = recorded.get(value.incidentId) ?? now.toISOString();
    if (at < since) continue;
    evidence.push({
      id: `fix:${value.incidentId}`, kind: "fix", at,
      text: `George corrected a reply. Asked: "${(value.prompt ?? "").slice(0, 300)}" — Flyd said: "${(value.rejectedAnswer ?? "").slice(0, 300)}" — his feedback: "${value.expected?.feedback ?? ""}" (${(value.expected?.failureClasses ?? []).join(", ")})`,
    });
  }

  const evalDir = join(flydDir, "evals", "chat");
  const latest = existsSync(evalDir) ? readdirSync(evalDir).filter((name) => name.endsWith(".jsonl")).sort().at(-1) : undefined;
  if (latest) {
    const at = new Date(latest.replace(/\.jsonl$/, "").replace(/T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/, "T$1:$2:$3.$4Z")).toISOString();
    for (const line of readFileSync(join(evalDir, latest), "utf8").split("\n").filter(Boolean)) {
      try {
        const row = JSON.parse(line) as { id: string; passed: boolean; failures?: string[]; judgeReason?: string; judgeScore?: number };
        if (row.passed) continue;
        evidence.push({
          id: `eval:${latest}:${row.id}`, kind: "eval", at,
          text: `Chat eval case ${row.id} failed: ${(row.failures ?? []).join("; ")}${row.judgeReason ? ` — judge (${row.judgeScore ?? "?"}/10): ${row.judgeReason}` : ""}`.slice(0, 600),
        });
      } catch { /* torn line */ }
    }
  }

  for (const advisory of readAdvisories()) {
    if (advisory.status !== "dismissed" || advisory.createdAt < since) continue;
    evidence.push({ id: `dismissed:${advisory.id}`, kind: "dismissed", at: advisory.createdAt, text: `George dismissed a ${advisory.advisor} advisory as unhelpful: "${advisory.text}"` });
  }

  const turns = recentJournal(400);
  for (let index = 1; index < turns.length; index += 1) {
    const turn = turns[index];
    if (turn.at < since || !PUSHBACK.test(turn.user.trim())) continue;
    const before = turns[index - 1];
    evidence.push({
      id: `pushback:${turn.id}`, kind: "pushback", at: turn.at,
      text: `George pushed back. Earlier he asked: "${before.user.slice(0, 200)}" — Flyd answered: "${before.assistant.slice(0, 300)}" — then he said: "${turn.user.slice(0, 300)}"`,
    });
  }

  for (const task of listTasks()) {
    if (task.createdAt < since) continue;
    if (task.status === "failed") {
      evidence.push({ id: `crew:${task.id}`, kind: "crew", at: task.createdAt, text: `A crew task failed (${task.failure ?? "unknown"}): "${task.outcome.slice(0, 200)}"` });
      continue;
    }
    // A review that couldn't run says nothing about the work.
    const short = (task.review ?? []).filter((check) => !check.met && !check.unchecked);
    if (short.length && task.status !== "running") {
      evidence.push({
        id: `crew-review:${task.id}`, kind: "crew", at: task.createdAt,
        text: `A crew task passed its tests but an independent review found it short of what was asked: "${task.outcome.slice(0, 200)}" — ${short.map((check) => `${check.criterion} (${check.note})`).join("; ").slice(0, 300)}`,
      });
    }
  }

  // Domain management failures are not a second learning system. They feed the
  // same governed improver, which decides whether the durable fix belongs in
  // routing, transport, state, validation, or (last) a prompt.
  for (const run of listDomainRuns(join(flydDir, "command"))) {
    if (run.createdAt < since) continue;
    if (run.status === "failed") {
      evidence.push({
        id: `domain:${run.id}`, kind: "domain", at: run.updatedAt,
        text: `${run.request.domain} domain work failed under ${run.owner}: "${run.request.intendedOutcome.slice(0, 220)}" — ${(run.failure ?? run.result?.brief ?? "unknown").slice(0, 300)}`,
      });
      continue;
    }
    if (run.result?.format === "raw" && ["completed", "needs_decision"].includes(run.status)) {
      evidence.push({
        id: `domain-result:${run.id}`, kind: "domain", at: run.updatedAt,
        text: `${run.owner} returned an unstructured domain handoff. Flyd preserved the raw detail, but the layered brief/report/evidence contract was not met for: "${run.request.intendedOutcome.slice(0, 220)}"`,
      });
    }
  }

  // Background jobs that ended short of their contract or were cut off.
  for (const { value: job } of readJsonFiles<{ id: string; status: string; startedAt: string; contract?: { task?: string }; checks?: Array<{ criterion: string; met: boolean; note: string; unchecked?: boolean }> }>(join(flydDir, "jobs"))) {
    if (job.startedAt < since || (job.status !== "short" && job.status !== "interrupted")) continue;
    const unmet = (job.checks ?? []).filter((check) => !check.met && !check.unchecked);
    if (job.status === "short" && !unmet.length) continue;
    const short = unmet.map((check) => `${check.criterion} (${check.note})`).join("; ");
    evidence.push({
      id: `job:${job.id}`, kind: "job", at: job.startedAt,
      text: job.status === "interrupted"
        ? `A background job was cut off by a restart: "${(job.contract?.task ?? "").slice(0, 200)}"`
        : `A background job ended short of its done_when: "${(job.contract?.task ?? "").slice(0, 200)}" — ${short.slice(0, 300)}`,
    });
  }

  // Turns where the harness had to stop the same failing call being retried.
  const receipts = join(flydDir, "turn-receipts");
  if (existsSync(receipts)) {
    for (const session of readdirSync(receipts, { withFileTypes: true }).filter((entry) => entry.isDirectory())) {
      const sessionDir = join(receipts, session.name);
      try { if (statSync(sessionDir).mtime.toISOString() < since) continue; } catch { continue; }
      for (const { name, value } of readJsonFiles<{ recordedAt?: string; message?: string; toolCalls?: Array<{ name: string; error?: string }> }>(sessionDir)) {
        if (name === "latest.json" || !value.recordedAt || value.recordedAt < since) continue;
        const stopped = (value.toolCalls ?? []).find((call) => call.error?.startsWith("Skipped: this exact"));
        if (!stopped) continue;
        evidence.push({
          id: `loop:${session.name}:${name}`, kind: "loop", at: value.recordedAt,
          text: `Flyd kept retrying a failing ${stopped.name} call until the harness stopped it. George had asked: "${(value.message ?? "").slice(0, 200)}" — ${stopped.error!.slice(0, 250)}`,
        });
      }
    }
  }

  return evidence.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 40);
}

export function improverPrompt(evidence: Evidence[], attempts: Attempt[], today: string): string {
  return [
    "You are Flyd's Critic, turned on Flyd itself: a measured, fair-minded engineer who wants Flyd to serve George better.",
    "Flyd is George's personal agent (TypeScript Core in cli/src; AGENTS.md describes the architecture).",
    "Where things live: chat system prompt and turn budgets cli/src/runtime/conversation-responder.ts; answer checks cli/src/runtime/honesty-check.ts; tools cli/src/runtime/personal-tools.ts and assistant-tools.ts; tool approval cli/src/runtime/tool-policy.ts; retry limits cli/src/runtime/repeat-guard.ts; background jobs cli/src/runtime/background-jobs.ts; done_when checks cli/src/runtime/acceptance.ts; coding crew cli/src/crew/crew.ts; agent loop cli/src/lib/llm.ts; council (Librarian, Critic, Strategist, Muse, Scout) cli/src/council/; chat eval cases cli/src/evals/chat/cases.json.",
    "Name only files from that list or describe the behaviour; never invent paths.",
    `Today is ${today}. Below is recent evidence of where Flyd fell short.`,
    "",
    "First name what kind of failure it is: missing_context (the right information wasn't loaded), wrong_tool (wrong tool, or a tool with an unclear contract), bad_output (an answer or artifact a validator could have caught), repeated_loop (retrying without changing anything), unsafe_action (something that should have been gated), lost_decision (something decided earlier was forgotten), judgment (a call no code can check), unknown.",
    "Then fix the system that allowed it, not the one reply. Prefer the layer that holds on every run, strongest first:",
    "  check (code that detects or blocks the failure: a validator, a guard, a test of behaviour) > tool (a clearer tool contract, argument validation, better errors) > context (loading the right information) > state (saving what must not be forgotten) > trace (recording what's needed to diagnose it) > prompt (a rule in the system prompt).",
    "A prompt rule is the last resort: choose it only for judgment code can't check, and say why nothing stronger works. If the chat prompt already states a rule that keeps being broken, the fix is a check, not a louder rule.",
    "",
    "Pick at most ONE improvement to Flyd's code that would most reduce these failures. It must be:",
    "- concrete and small enough for one focused branch;",
    "- verifiable: a test can pin the new behaviour;",
    "- supported by at least one evidence id below — cite them;",
    "- not a repeat of a recent attempt (listed below), and never a change to which models Flyd uses.",
    "If the evidence is noise, one-off, or not Flyd's fault, reply {\"improvement\": null}. That is often the right answer.",
    "",
    'Reply with JSON only: {"improvement": {"title": "short imperative title", "failure_class": "one of the kinds above", "layer": "check|tool|context|state|trace|prompt", "outcome": "the finished change, precise enough to build and verify unattended, naming the files or behaviour to change and the test to add", "done_when": ["checkable point a reviewer can confirm in the diff", "..."], "why": "one sentence tying it to the evidence, and for a prompt fix why nothing stronger works", "evidence": ["id", "..."]}}',
    "",
    "--- Evidence ---",
    ...evidence.map((item) => `[${item.id}] ${item.text}`),
    "",
    "--- Recent attempts (do not repeat) ---",
    ...(attempts.slice(-10).map((attempt) => `- ${attempt.at.slice(0, 10)} ${attempt.title}`)),
    attempts.length ? "" : "(none)",
  ].join("\n");
}

export function parseImprovement(text: string, evidence: Evidence[]): Improvement | null {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]) as { improvement?: Record<string, unknown> | null };
    const raw = parsed.improvement;
    if (!raw) return null;
    const known = new Set(evidence.map((item) => item.id));
    const cited = Array.isArray(raw.evidence) ? raw.evidence.map(String).filter((id) => known.has(id)) : [];
    const title = String(raw.title ?? "").replace(/\s+/g, " ").trim();
    const outcome = String(raw.outcome ?? "").replace(/\s+/g, " ").trim();
    // An improvement with no real evidence behind it is a guess, not a fix.
    if (!title || !outcome || cited.length === 0) return null;
    const failureClass = FAILURE_CLASSES.find((value) => value === raw.failure_class);
    const layer = FIX_LAYERS.find((value) => value === raw.layer);
    const doneWhen = normalizeCriteria(raw.done_when ?? []);
    return {
      title, outcome, why: String(raw.why ?? "").trim(), evidence: cited,
      ...(failureClass ? { failureClass } : {}),
      ...(layer ? { layer } : {}),
      ...(doneWhen.length ? { doneWhen } : {}),
    };
  } catch {
    return null;
  }
}

const RUN_EVERY_MS = 24 * 60 * 60 * 1000;

function awaitingGeorge(tasks: CrewTask[]): CrewTask | DomainRun | undefined {
  const crew = tasks.find((task) => task.source === "self-improvement" && ["running", "verifying", "ready"].includes(task.status));
  if (crew) return crew;
  return listDomainRuns().find((run) => run.request.source === "self-improvement"
    && ["queued", "accepted", "working", "needs_decision"].includes(run.status));
}

export interface SelfImproveDependencies {
  complete(prompt: string): Promise<string>;
  /** Test seam for the read-only audit; production uses its own daily cadence. */
  routingAudit?: () => Promise<unknown>;
  now?: () => Date;
  dir?: string;
  flydDir?: string;
  repo?: string;
  force?: boolean;
  notify?: (title: string, message: string) => Promise<void>;
  /** Evidence George just gave in person ("you need to be smarter at X"). */
  extraEvidence?: Evidence[];
  /** Test seam; defaults to dispatching a real crewmate. */
  dispatch?: (repo: string, outcome: string, doneWhen: string[]) => Promise<CrewTask>;
}

export interface SelfImproveResult {
  status: "disabled" | "not_due" | "awaiting_george" | "no_new_evidence" | "nothing_worth_fixing" | "dispatched";
  improvement?: Improvement;
  task?: CrewTask | DomainRun;
  evidence?: number;
}

export function crewOutcome(improvement: Improvement, evidence: Evidence[]): string {
  const cited = evidence.filter((item) => improvement.evidence.includes(item.id));
  return [
    `Self-improvement for Flyd: ${improvement.title}.`,
    improvement.outcome,
    ...(improvement.failureClass || improvement.layer ? [`Failure kind: ${improvement.failureClass ?? "unknown"}; fix it at the ${improvement.layer ?? "most durable"} layer.`] : []),
    `Why: ${improvement.why}`,
    `Evidence: ${cited.map((item) => item.text.slice(0, 300)).join(" | ")}`,
    "Add a test that fails before your change and passes after. Do not change which models Flyd uses or its .env.",
  ].join(" ");
}

/** One nightly step of the loop; every exit is a named status so the tick can log it. */
export async function runSelfImprovement(deps: SelfImproveDependencies): Promise<SelfImproveResult> {
  if (process.env.FLYD_SELF_IMPROVE === "0") return { status: "disabled" };
  const now = (deps.now ?? (() => new Date()))();
  // Audit on its own cadence even when an improvement is awaiting review or
  // there are no fresh complaints. Failure must not stop the existing loop.
  if (process.env.FLYD_ROUTING_LEARNING !== "0") {
    try {
      if (deps.routingAudit) await deps.routingAudit();
      else if (!process.env.VITEST) {
        const { auditRouting } = await import("../runtime/routing-audit-runner.js");
        await auditRouting(deps.flydDir ?? FLYD_DIR);
      }
    } catch { /* evidence capture is best effort */ }
  }
  const dir = deps.dir ?? selfImproveDir();
  const state = readState(dir);
  if (!deps.force && state.lastRunAt && now.getTime() - Date.parse(state.lastRunAt) < RUN_EVERY_MS) return { status: "not_due" };
  // One improvement in flight at a time: George reviews before the next.
  const pending = awaitingGeorge(listTasks());
  if (pending) return { status: "awaiting_george", task: pending };

  const seen = new Set(state.seen);
  const evidence = [...(deps.extraEvidence ?? []), ...gatherEvidence({ flydDir: deps.flydDir, now })];
  const fresh = evidence.filter((item) => !seen.has(item.id));
  if (fresh.length === 0) {
    writeState({ ...state, lastRunAt: now.toISOString() }, dir);
    return { status: "no_new_evidence", evidence: 0 };
  }

  const improvement = parseImprovement(await deps.complete(improverPrompt(evidence, state.attempts, localDay(now))), evidence);
  if (!improvement) {
    // Nothing worth fixing in this batch; don't reconsider it tomorrow.
    writeState({ ...state, lastRunAt: now.toISOString(), seen: [...state.seen, ...fresh.map((item) => item.id)] }, dir);
    return { status: "nothing_worth_fixing", evidence: fresh.length };
  }

  const repo = deps.repo ?? FLYD_APPLICATION_ROOT;
  const outcome = crewOutcome(improvement, evidence);
  const doneWhen = [...(improvement.doneWhen ?? []), "the diff adds or changes a test that exercises the new behaviour"];
  let task: CrewTask | DomainRun;
  if (deps.dispatch) {
    task = await deps.dispatch(repo, outcome, doneWhen);
  } else {
    const { FirstmateDomainTransport } = await import("../command/firstmate.js");
    const firstmate = new FirstmateDomainTransport();
    if (process.env.FLYD_FIRSTMATE !== "0" && firstmate.available()) {
      const { dispatchCodingDomain } = await import("../command/coding.js");
      task = await dispatchCodingDomain({
        originalMessage: `Flyd self-improvement: ${improvement.title}`,
        intendedOutcome: outcome,
        doneWhen,
        source: "self-improvement",
        project: { name: "Flyd", root: repo },
        transport: firstmate,
      });
    } else {
      task = await dispatchCrewTask({ repo, outcome, doneWhen, source: "self-improvement" });
    }
  }
  writeState({
    lastRunAt: now.toISOString(),
    // Only the evidence this fix addresses is spent; the rest stays for later nights.
    seen: [...state.seen, ...improvement.evidence],
    attempts: [...state.attempts, { at: now.toISOString(), title: improvement.title, taskId: task.id, evidence: improvement.evidence }],
  }, dir);
  await deps.notify?.("Flyd", `I'm teaching myself to ${improvement.title.charAt(0).toLowerCase()}${improvement.title.slice(1)}. I'll show you before anything changes.`).catch(() => undefined);
  return { status: "dispatched", improvement, task, evidence: fresh.length };
}

export function selfImproveStatus(dir = selfImproveDir()): { lastRunAt?: string; attempts: Attempt[] } {
  const state = readState(dir);
  return { ...(state.lastRunAt ? { lastRunAt: state.lastRunAt } : {}), attempts: state.attempts };
}
