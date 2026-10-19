import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { FLYD_DIR } from "../../lib/config.js";
import { IntelligenceEventStore } from "../event-store.js";
import { EXPERIENCE_RUNTIME_CONTRACT, SourceContractRegistry } from "../sensors/source-contracts.js";
import {
  DREAM_EXPERIENCE_CHECKPOINT,
  consolidateExperience,
  isExperienceInputEvent,
  persistDreamInsights,
} from "./experience.js";

const MIN_INTERVAL_MS = 20 * 60 * 60 * 1000;
const STALE_LOCK_MS = 30 * 60 * 1000;

interface DreamState {
  lastRunAt?: string;
  runs: number;
  lastSequence?: number;
  lastInsights?: number;
}

export interface DreamCycleResult {
  status: "disabled" | "source_disabled" | "not_due" | "locked" | "no_new_experience" | "no_new_insights" | "consolidated";
  fromSequence?: number;
  toSequence?: number;
  processed?: number;
  insights?: number;
}

export interface DreamCycleOptions {
  flydDir?: string;
  store?: IntelligenceEventStore;
  now?: () => Date;
  force?: boolean;
}

function statePath(flydDir: string): string {
  return join(flydDir, "intelligence", "dream-state.json");
}

function lockPath(flydDir: string): string {
  return join(flydDir, "intelligence", "dream.lock");
}

function readState(path: string): DreamState {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<DreamState>;
    return {
      runs: Number.isFinite(parsed.runs) ? Number(parsed.runs) : 0,
      ...(typeof parsed.lastRunAt === "string" ? { lastRunAt: parsed.lastRunAt } : {}),
      ...(Number.isFinite(parsed.lastSequence) ? { lastSequence: Number(parsed.lastSequence) } : {}),
      ...(Number.isFinite(parsed.lastInsights) ? { lastInsights: Number(parsed.lastInsights) } : {}),
    };
  } catch {
    return { runs: 0 };
  }
}

function writeState(path: string, state: DreamState): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  renameSync(temporary, path);
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
    } catch {
      // Another process owns the cycle.
    }
    return false;
  }
}

function digest(parts: unknown[]): string {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

function due(state: DreamState, now: Date, force = false): boolean {
  if (force || !state.lastRunAt) return true;
  const last = Date.parse(state.lastRunAt);
  return !Number.isFinite(last) || now.getTime() - last >= MIN_INTERVAL_MS;
}

export async function runDreamCycle(options: DreamCycleOptions = {}): Promise<DreamCycleResult> {
  if (process.env.FLYD_DREAM === "0") return { status: "disabled" };
  const flydDir = options.flydDir ?? FLYD_DIR;
  const now = (options.now ?? (() => new Date()))();
  const stateFile = statePath(flydDir);
  if (!due(readState(stateFile), now, options.force)) return { status: "not_due" };

  const lock = lockPath(flydDir);
  if (!acquire(lock)) return { status: "locked" };

  const owned = !options.store;
  const store = options.store ?? new IntelligenceEventStore({ path: join(flydDir, "intelligence.sqlite") });
  try {
    const state = readState(stateFile);
    if (!due(state, now, options.force)) return { status: "not_due" };

    const registry = new SourceContractRegistry({
      path: join(flydDir, "intelligence", "source-consents.json"),
    });
    registry.register(EXPERIENCE_RUNTIME_CONTRACT);
    if (registry.status(EXPERIENCE_RUNTIME_CONTRACT.sourceId) !== "enabled") {
      return { status: "source_disabled" };
    }

    const fromSequence = store.getCheckpoint(DREAM_EXPERIENCE_CHECKPOINT);
    const all = store.readSource(EXPERIENCE_RUNTIME_CONTRACT.sourceId);
    const toSequence = all.at(-1)?.sequence ?? fromSequence;
    const fresh = all.filter((event) => event.sequence > fromSequence && isExperienceInputEvent(event));

    if (!fresh.length) {
      if (toSequence > fromSequence) {
        store.saveCheckpoint(DREAM_EXPERIENCE_CHECKPOINT, toSequence, digest([DREAM_EXPERIENCE_CHECKPOINT, toSequence, 0]));
      }
      writeState(stateFile, {
        ...state,
        lastRunAt: now.toISOString(),
        runs: state.runs + 1,
        lastSequence: toSequence,
        lastInsights: 0,
      });
      return { status: "no_new_experience", fromSequence, toSequence, processed: 0, insights: 0 };
    }

    const eligible = all.filter((event) => event.sequence <= toSequence && !event.erased);
    const insights = consolidateExperience(eligible, now);
    const written = persistDreamInsights(store, insights);
    store.saveCheckpoint(
      DREAM_EXPERIENCE_CHECKPOINT,
      toSequence,
      digest([DREAM_EXPERIENCE_CHECKPOINT, toSequence, fresh.length, written]),
    );
    writeState(stateFile, {
      ...state,
      lastRunAt: now.toISOString(),
      runs: state.runs + 1,
      lastSequence: toSequence,
      lastInsights: written,
    });
    return {
      status: written ? "consolidated" : "no_new_insights",
      fromSequence,
      toSequence,
      processed: fresh.length,
      insights: written,
    };
  } finally {
    if (owned) store.close();
    try { if (existsSync(lock)) unlinkSync(lock); } catch { /* already released */ }
  }
}
