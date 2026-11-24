import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import type { NotificationOutcome } from "../runtime/agenda.js";
import { dirname, join } from "node:path";
import { FLYD_DIR } from "../lib/config.js";
import { readUserProfile } from "../lib/user-profile.js";
import { IntelligenceEventStore } from "../intelligence/event-store.js";
import { readyKnowledgeIssues } from "../cognition/curator/knowledge-maintenance.js";
import { runAdvisors, updateAdvisoryStatus, type Advisory } from "./advisors.js";
import { readJournalSince, recentJournal } from "./journal.js";
import { collectNewCaptures, readLibrarianState, runLibrarian, tasteCurationDue, type LibrarianRunResult } from "./librarian.js";
import { localDay, memoryPromptText } from "./memory-store.js";
import { describeProject, liveProjects } from "./projects.js";
import { readTaste } from "./taste.js";
import { syncTasteSkills } from "./taste-skills.js";

// A council pass: the Librarian curates what is new, then the Critic and the
// Strategist advise on it. Runs in the background — after a burst of turns,
// when a chat ends, and on the agenda/Core tick — never in the user's way.

const PASS_EVERY_TURNS = 8;
const PASS_MAX_AGE_MS = 6 * 60 * 60 * 1000;
const IDLE_AFTER_MS = 20 * 60 * 1000;
const STALE_LOCK_MS = 15 * 60 * 1000;
export const URGENT_NOTIFICATIONS_PER_DAY = 2;

function lockPath(): string {
  return join(process.env.FLYD_COUNCIL_DIR?.trim() || join(FLYD_DIR, "council"), "pass.lock");
}

function acquire(path: string): boolean {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  try {
    closeSync(openSync(path, "wx"));
    return true;
  } catch {
    try {
      if (Date.now() - statSync(path).mtimeMs > STALE_LOCK_MS) {
        unlinkSync(path);
        closeSync(openSync(path, "wx"));
        return true;
      }
    } catch { /* another pass won */ }
    return false;
  }
}

/** Cheap check: is there enough new material to be worth a pass? */
function councilPassDueForWork(now: Date): boolean {
  const state = readLibrarianState();
  const pending = readJournalSince(state.journalCursor, undefined, PASS_EVERY_TURNS);
  const newTurns = pending.length;
  if (newTurns >= PASS_EVERY_TURNS) return true;
  // A conversation that has gone quiet is ready to be curated.
  const lastTurnAt = pending.at(-1)?.at;
  if (lastTurnAt && now.getTime() - Date.parse(lastTurnAt) >= IDLE_AFTER_MS) return true;
  const age = state.lastRunAt ? now.getTime() - Date.parse(state.lastRunAt) : Infinity;
  if (age < PASS_MAX_AGE_MS) return false;
  return newTurns > 0 || collectNewCaptures(state.captureCursorMs, undefined, 1).length > 0;
}

export function councilPassDue(now = new Date()): boolean {
  const store = new IntelligenceEventStore();
  try { return readyKnowledgeIssues(store).length > 0 || tasteCurationDue() || councilPassDueForWork(now); }
  finally { store.close(); }
}

export interface CouncilPassResult {
  skipped?: "locked" | "not_due";
  librarian?: LibrarianRunResult;
  advisories: Advisory[];
  notified: Advisory[];
}

export interface CouncilDependencies {
  complete(prompt: string): Promise<string>;
  /** A void-returning notification attempt is never proof of delivery. */
  notify?: (title: string, message: string) => Promise<NotificationOutcome>;
  now?: () => Date;
  force?: boolean;
}

/** Count attempted candidates, not people notified. */
interface NotifyState { day: string; count: number; attempts?: Record<string, NotificationOutcome | "attempted"> }

function notifyStatePath(): string {
  return join(process.env.FLYD_COUNCIL_DIR?.trim() || join(FLYD_DIR, "council"), "notify-state.json");
}

function readNotifyState(today: string): NotifyState {
  try {
    const state = JSON.parse(readFileSync(notifyStatePath(), "utf8")) as NotifyState;
    return state.day === today && Number.isSafeInteger(state.count) && state.count >= 0
      ? { ...state, attempts: state.attempts ?? {} }
      : { day: today, count: 0, attempts: {} };
  } catch {
    return { day: today, count: 0, attempts: {} };
  }
}

function saveNotifyState(state: NotifyState): void {
  const path = notifyStatePath();
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temp = path + "." + process.pid + "." + randomUUID().slice(0, 8) + ".tmp";
  writeFileSync(temp, JSON.stringify(state), { encoding: "utf8", mode: 0o600 });
  renameSync(temp, path);
}

/** His taste rules as plain lines, for judging how he will react; empty when none or unreadable. */
function tasteForAdvice(): string | undefined {
  try {
    const lines = readTaste().rules.slice(0, 40).map((rule) => `- ${rule.text}`);
    return lines.length ? lines.join("\n") : undefined;
  } catch {
    return undefined;
  }
}

export async function runCouncilPass(deps: CouncilDependencies): Promise<CouncilPassResult> {
  const now = (deps.now ?? (() => new Date()))();
  if (!deps.force && !councilPassDue(now)) return { skipped: "not_due", advisories: [], notified: [] };
  const tasteOnly = !deps.force && !councilPassDueForWork(now);
  const lock = lockPath();
  if (!acquire(lock)) return { skipped: "locked", advisories: [], notified: [] };
  try {
    const librarian = await runLibrarian({ complete: deps.complete, now: () => now });
    // What the Librarian just curated reaches every agent as skills.
    try { syncTasteSkills(); } catch { /* next pass */ }
    // A taste-only pass still reads (and consumes) new turns; when it did, the advisors
    // must see them now, or the work-due check never fires for those turns again.
    if (librarian.skipped || (tasteOnly && !librarian.turns && !librarian.captures)) return { librarian, advisories: [], notified: [] };
    const advisories = await runAdvisors({
      profile: readUserProfile(),
      memory: memoryPromptText(),
      projects: liveProjects().map((project) => `- ${describeProject(project)}`).join("\n"),
      taste: tasteForAdvice(),
      recentTurns: recentJournal(40),
      observations: librarian.observations,
    }, { complete: deps.complete, now: () => now });

    // Urgent advisories reach George even when he is not in a chat — sparingly.
    const notified: Advisory[] = [];
    const today = localDay(now);
    const state = readNotifyState(today);
    for (const advisory of advisories.filter((item) => item.urgency === "high")) {
      if (state.count >= URGENT_NOTIFICATIONS_PER_DAY || !deps.notify) break;
      // Claim before the outward effect: a crash cannot ring the same
      // advisory twice on the next background pass.
      if (state.attempts?.[advisory.id]) continue;
      state.attempts ??= {};
      state.attempts[advisory.id] = "attempted";
      state.count += 1;
      saveNotifyState(state);
      const outcome = await deps.notify("Flyd", advisory.text).catch(() => "undelivered" as const);
      state.attempts[advisory.id] = outcome;
      saveNotifyState(state);
      if (outcome === "shown") {
        notified.push(advisory);
        updateAdvisoryStatus(advisory.id, "shown", now);
      }
    }
    return { librarian, advisories, notified };
  } finally {
    try { if (existsSync(lock)) unlinkSync(lock); } catch { /* already gone */ }
  }
}

/** Fire-and-forget pass for live surfaces (chat turns, session exit). */
export function runCouncilInBackground(options: { force?: boolean } = {}): void {
  if (process.env.VITEST || process.env.FLYD_COUNCIL === "0") return;
  void (async () => {
    const [{ query }, { notifyMacOutcome }] = await Promise.all([import("../lib/llm.js"), import("../runtime/agenda.js")]);
    await runCouncilPass({ complete: (prompt) => query(prompt, undefined, undefined, undefined, undefined, { json: true, source: "council/council" }), notify: notifyMacOutcome, force: options.force });
  })().catch(() => undefined);
}
