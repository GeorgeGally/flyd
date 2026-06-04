import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync, watch, readdirSync } from "fs";
import { join } from "path";
import { FLYD_DIR, RAW_DIR, WIKI_DIR } from "../lib/config.js";
import { updateRaw, embedRaw } from "../lib/qmd.js";
import { extractInterests } from "../lib/interests.js";
import { suggestLinksForCapture, writeLinksToCapture, findNewCapturesSince } from "../lib/linking.js";
import { appendToGraph } from "../lib/graph.js";
import { wikiExists } from "../lib/wiki.js";

const PID_PATH = join(FLYD_DIR, "daemon.pid");
const STATE_PATH = join(FLYD_DIR, "daemon-state.json");
const DEBOUNCE_MS = 15_000;
const POLL_INTERVAL_MS = 120_000;

interface DaemonState {
  lastProcessedAt: string;
  capturesProcessed: number;
  linksCreated: number;
  startedAt: string;
}

function loadState(): DaemonState {
  if (!existsSync(STATE_PATH)) {
    return { lastProcessedAt: "", capturesProcessed: 0, linksCreated: 0, startedAt: "" };
  }
  try {
    return JSON.parse(readFileSync(STATE_PATH, "utf8"));
  } catch {
    return { lastProcessedAt: "", capturesProcessed: 0, linksCreated: 0, startedAt: "" };
  }
}

function saveState(state: DaemonState): void {
  mkdirSync(FLYD_DIR, { recursive: true });
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2), "utf8");
}

function writePid(): boolean {
  try {
    mkdirSync(FLYD_DIR, { recursive: true });
    writeFileSync(PID_PATH, String(process.pid), "utf8");
    return true;
  } catch {
    return false;
  }
}

function removePid(): void {
  try { rmSync(PID_PATH, { force: true }); } catch {}
}

function isRunning(): boolean {
  if (!existsSync(PID_PATH)) return false;
  try {
    const pid = parseInt(readFileSync(PID_PATH, "utf8").trim(), 10);
    if (isNaN(pid)) return false;
    return process.kill(pid, 0);
  } catch {
    return false;
  }
}

async function runIncremental(state: DaemonState): Promise<DaemonState> {
  const since = state.lastProcessedAt
    ? new Date(state.lastProcessedAt.replace(" ", "T") + "Z").getTime()
    : 0;

  const newCaptures = findNewCapturesSince(since);

  let linksCreated = state.linksCreated;
  let capturesProcessed = state.capturesProcessed;

  if (newCaptures.length > 0) {
    console.log(`  ${newCaptures.length} new capture(s) detected`);

    await updateRaw();
    await embedRaw();
    console.log("  reindexed + re-embedded");

    const { extracted, updated } = extractInterests();
    if (extracted > 0 || updated > 0) {
      console.log(`  ${extracted} new interests, ${updated} updated`);
    }

    if (wikiExists()) {
      for (const capture of newCaptures) {
        const suggestions = suggestLinksForCapture(capture);
        if (suggestions.length > 0) {
          const written = writeLinksToCapture(capture, suggestions);
          if (written) {
            linksCreated++;
            console.log(`  linked ${capture} → ${suggestions.length} wiki entries`);
          }
        }
      }
    }

    capturesProcessed += newCaptures.length;
  } else {
    await updateRaw();
    await embedRaw();
  }

  state.capturesProcessed = capturesProcessed;
  state.linksCreated = linksCreated;
  state.lastProcessedAt = new Date().toISOString().replace("T", " ").replace(/\.\d+Z$/, "");
  saveState(state);

  return state;
}

export async function runDaemon(): Promise<void> {
  if (isRunning()) {
    const pid = readFileSync(PID_PATH, "utf8").trim();
    console.log(`flyd daemon already running (pid ${pid})`);
    return;
  }

  if (!writePid()) {
    console.error("failed to write PID file");
    return;
  }

  const state = loadState();
  const now = new Date().toISOString().replace("T", " ").replace(/\.\d+Z$/, "");
  if (!state.startedAt) state.startedAt = now;
  saveState(state);

  console.log(`flyd daemon started (pid ${process.pid})`);
  console.log(`watching ${RAW_DIR}`);
  console.log("");

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let running = false;

  const trigger = () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(async () => {
      if (running) return;
      running = true;
      try {
        const newState = loadState();
        await runIncremental(newState);
      } catch (err) {
        console.error("daemon error:", err instanceof Error ? err.message : String(err));
      } finally {
        running = false;
      }
    }, DEBOUNCE_MS);
  };

  const pollTimer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      const newState = loadState();
      await runIncremental(newState);
    } catch (err) {
      console.error("daemon poll error:", err instanceof Error ? err.message : String(err));
    } finally {
      running = false;
    }
  }, POLL_INTERVAL_MS);

  if (existsSync(RAW_DIR)) {
    try {
      const watcher = watch(RAW_DIR, { recursive: true }, (eventType, filename) => {
        if (filename && filename.endsWith(".md")) {
          trigger();
        }
      });

      process.on("SIGINT", () => {
        console.log("\nshutting down...");
        watcher.close();
        clearInterval(pollTimer);
        if (debounceTimer) clearTimeout(debounceTimer);
        removePid();
        console.log("daemon stopped");
        process.exit(0);
      });

      process.on("SIGTERM", () => {
        watcher.close();
        clearInterval(pollTimer);
        if (debounceTimer) clearTimeout(debounceTimer);
        removePid();
        process.exit(0);
      });

      // Hold process open
      await new Promise(() => {});
    } catch (err) {
      console.error("watch error:", err instanceof Error ? err.message : String(err));
      removePid();
      clearInterval(pollTimer);
    }
  } else {
    console.log(`RAW_DIR ${RAW_DIR} does not exist yet. Waiting...`);
    const checkInterval = setInterval(() => {
      if (existsSync(RAW_DIR)) {
        clearInterval(checkInterval);
        console.log("RAW_DIR created, watching...");
        // This won't actually re-watch properly, but the poll timer will pick it up
      }
    }, 5000);
    await new Promise(() => {});
  }
}

export function stopDaemon(): void {
  if (!existsSync(PID_PATH)) {
    console.log("daemon not running");
    return;
  }

  try {
    const pid = parseInt(readFileSync(PID_PATH, "utf8").trim(), 10);
    process.kill(pid, "SIGTERM");
    console.log(`sent stop signal to daemon (pid ${pid})`);
  } catch {
    console.log("daemon process not found, removing stale PID file");
    removePid();
  }
}

export function daemonStatus(): void {
  if (isRunning()) {
    const pid = readFileSync(PID_PATH, "utf8").trim();
    const state = loadState();
    console.log(`flyd daemon is running (pid ${pid})`);
    console.log(`  started:      ${state.startedAt || "unknown"}`);
    console.log(`  last cycle:   ${state.lastProcessedAt || "never"}`);
    console.log(`  captures:     ${state.capturesProcessed}`);
    console.log(`  links:        ${state.linksCreated}`);
  } else {
    console.log("flyd daemon is not running");
    if (existsSync(PID_PATH)) {
      console.log("  stale PID file present — run 'flyd daemon stop' to clean up");
    }
  }
}
