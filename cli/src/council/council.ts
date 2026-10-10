import { closeSync, existsSync, mkdirSync, openSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { FLYD_DIR } from "../lib/config.js";
import { readUserProfile } from "../lib/user-profile.js";
import { runAdvisors, type Advisory } from "./advisors.js";
import { readJournalSince, recentJournal } from "./journal.js";
import { collectNewCaptures, readLibrarianState, runLibrarian, tasteCurationDue, type LibrarianRunResult } from "./librarian.js";
import { localDay, memoryPromptText } from "./memory-store.js";
import { describeProject, liveProjects } from "./projects.js";
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
  return tasteCurationDue() || councilPassDueForWork(now);
}

export interface CouncilPassResult {
  skipped?: "locked" | "not_due";
  librarian?: LibrarianRunResult;
  advisories: Advisory[];
  notified: Advisory[];
}

export interface CouncilDependencies {
  complete(prompt: string): Promise<string>;
  notify?: (title: string, message: string) => Promise<void>;
  now?: () => Date;
  force?: boolean;
}

interface NotifyState { day: string; count: number }

function notifyStatePath(): string {
  return join(process.env.FLYD_COUNCIL_DIR?.trim() || join(FLYD_DIR, "council"), "notify-state.json");
}

function readNotifyState(today: string): NotifyState {
  try {
    const state = JSON.parse(readFileSync(notifyStatePath(), "utf8")) as NotifyState;
    return state.day === today ? state : { day: today, count: 0 };
  } catch {
    return { day: today, count: 0 };
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
    if (librarian.skipped || tasteOnly) return { librarian, advisories: [], notified: [] };
    const advisories = await runAdvisors({
      profile: readUserProfile(),
      memory: memoryPromptText(),
      projects: liveProjects().map((project) => `- ${describeProject(project)}`).join("\n"),
      recentTurns: recentJournal(40),
      observations: librarian.observations,
    }, { complete: deps.complete, now: () => now });

    // Urgent advisories reach George even when he is not in a chat — sparingly.
    const notified: Advisory[] = [];
    const today = localDay(now);
    const state = readNotifyState(today);
    for (const advisory of advisories.filter((item) => item.urgency === "high")) {
      if (state.count >= URGENT_NOTIFICATIONS_PER_DAY || !deps.notify) break;
      await deps.notify("Flyd", advisory.text).catch(() => undefined);
      state.count += 1;
      notified.push(advisory);
    }
    if (notified.length) {
      mkdirSync(dirname(notifyStatePath()), { recursive: true, mode: 0o700 });
      writeFileSync(notifyStatePath(), JSON.stringify(state), { encoding: "utf8", mode: 0o600 });
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
    const [{ query }, { notifyMac }] = await Promise.all([import("../lib/llm.js"), import("../runtime/agenda.js")]);
    await runCouncilPass({ complete: (prompt) => query(prompt, undefined, undefined, undefined, undefined, { json: true }), notify: notifyMac, force: options.force });
  })().catch(() => undefined);
}
