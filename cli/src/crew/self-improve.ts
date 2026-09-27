import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { FLYD_APPLICATION_ROOT, FLYD_DIR } from "../lib/config.js";
import { readAdvisories } from "../council/advisors.js";
import { recentJournal } from "../council/journal.js";
import { localDay } from "../council/memory-store.js";
import { dispatchCrewTask, listTasks, type CrewTask } from "./crew.js";

// Flyd improving Flyd, with George holding the gate. Once a day it gathers
// evidence of where it fell short — /flyd-fix corrections, failed chat
// evals, advisories George waved away, moments he pushed back in
// conversation, crew tasks that failed — and asks an improver, in the
// Critic's measured voice, to pick ONE concrete, testable change. That
// change goes to the coding crew on a branch of the Flyd repo, verified by
// the repo's own checks. Nothing lands without George's /land.

export interface Evidence {
  id: string;
  kind: "fix" | "eval" | "dismissed" | "pushback" | "crew";
  at: string;
  text: string;
}

export interface Improvement {
  title: string;
  outcome: string;
  why: string;
  evidence: string[];
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
    if (task.status !== "failed" || task.createdAt < since) continue;
    evidence.push({ id: `crew:${task.id}`, kind: "crew", at: task.createdAt, text: `A crew task failed (${task.failure ?? "unknown"}): "${task.outcome.slice(0, 200)}"` });
  }

  return evidence.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 40);
}

export function improverPrompt(evidence: Evidence[], attempts: Attempt[], today: string): string {
  return [
    "You are Flyd's Critic, turned on Flyd itself: a measured, fair-minded engineer who wants Flyd to serve George better.",
    "Flyd is George's personal agent (TypeScript Core in cli/src; AGENTS.md describes the architecture).",
    "Where things live: chat system prompt and turn budgets cli/src/runtime/conversation-responder.ts; tools cli/src/runtime/personal-tools.ts and assistant-tools.ts; tool approval cli/src/runtime/tool-policy.ts; agent loop cli/src/lib/llm.ts; council (Librarian, Critic, Strategist, Muse, Scout) cli/src/council/; chat eval cases cli/src/evals/chat/cases.json.",
    "Name only files from that list or describe the behaviour; never invent paths.",
    `Today is ${today}. Below is recent evidence of where Flyd fell short.`,
    "",
    "Pick at most ONE improvement to Flyd's code that would most reduce these failures. It must be:",
    "- concrete and small enough for one focused branch (a prompt rule, a tool fix, a retrieval tweak, a missing test);",
    "- verifiable: a test can pin the new behaviour;",
    "- supported by at least one evidence id below — cite them;",
    "- not a repeat of a recent attempt (listed below), and never a change to which models Flyd uses.",
    "If the evidence is noise, one-off, or not Flyd's fault, reply {\"improvement\": null}. That is often the right answer.",
    "",
    'Reply with JSON only: {"improvement": {"title": "short imperative title", "outcome": "the finished change, precise enough to build and verify unattended, naming the files or behaviour to change and the test to add", "why": "one sentence tying it to the evidence", "evidence": ["id", "..."]}}',
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
    return { title, outcome, why: String(raw.why ?? "").trim(), evidence: cited };
  } catch {
    return null;
  }
}

const RUN_EVERY_MS = 24 * 60 * 60 * 1000;

function awaitingGeorge(tasks: CrewTask[]): CrewTask | undefined {
  return tasks.find((task) => task.source === "self-improvement" && ["running", "verifying", "ready"].includes(task.status));
}

export interface SelfImproveDependencies {
  complete(prompt: string): Promise<string>;
  now?: () => Date;
  dir?: string;
  flydDir?: string;
  repo?: string;
  force?: boolean;
  notify?: (title: string, message: string) => Promise<void>;
  /** Evidence George just gave in person ("you need to be smarter at X"). */
  extraEvidence?: Evidence[];
  /** Test seam; defaults to dispatching a real crewmate. */
  dispatch?: (repo: string, outcome: string) => Promise<CrewTask>;
}

export interface SelfImproveResult {
  status: "disabled" | "not_due" | "awaiting_george" | "no_new_evidence" | "nothing_worth_fixing" | "dispatched";
  improvement?: Improvement;
  task?: CrewTask;
  evidence?: number;
}

export function crewOutcome(improvement: Improvement, evidence: Evidence[]): string {
  const cited = evidence.filter((item) => improvement.evidence.includes(item.id));
  return [
    `Self-improvement for Flyd: ${improvement.title}.`,
    improvement.outcome,
    `Why: ${improvement.why}`,
    `Evidence: ${cited.map((item) => item.text.slice(0, 300)).join(" | ")}`,
    "Add a test that fails before your change and passes after. Do not change which models Flyd uses or its .env.",
  ].join(" ");
}

/** One nightly step of the loop; every exit is a named status so the tick can log it. */
export async function runSelfImprovement(deps: SelfImproveDependencies): Promise<SelfImproveResult> {
  if (process.env.FLYD_SELF_IMPROVE === "0") return { status: "disabled" };
  const now = (deps.now ?? (() => new Date()))();
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
  const task = await (deps.dispatch ?? ((root, text) => dispatchCrewTask({ repo: root, outcome: text, source: "self-improvement" })))(repo, outcome);
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
