import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync, watch, readdirSync } from "fs";
import { join } from "path";
import { FLYD_DIR, RAW_DIR, WIKI_DIR } from "../lib/config.js";
import { updateRaw, embedRaw } from "../lib/qmd.js";
import { extractInterests } from "../lib/interests.js";
import { suggestLinksForCapture, writeLinksToCapture, findNewCapturesSince } from "../lib/linking.js";
import { appendToGraph } from "../lib/graph.js";
import { wikiExists } from "../lib/wiki.js";
import { parse, serialize } from "../lib/frontmatter.js";
import { enrichCaptureLocal, enrichCaptureWithLLM } from "../lib/entity-extractor.js";
import type { EventMetadata } from "../lib/schema.js";
import { computeAttention, formatAttentionReport, generateNudges, writeNudges, loadCaptureDocs } from "../lib/attention.js";
import { loadGoals, computeTension, formatTensionReport } from "../lib/tension.js";
import { generateQuestions, investigateQuestion, getRelevantDocsForQuestion, writeCuriosityLog, type CuriosityQuestion } from "../lib/curiosity.js";
import { isBudgetExceeded, getDailySpend } from "../lib/budget.js";

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

const ATTN_INTERVAL = 4 * 60 * 60 * 1000;
const TENSION_INTERVAL = 24 * 60 * 60 * 1000;
const CURIOSITY_INTERVAL = 24 * 60 * 60 * 1000;

let lastAttention = 0;
let lastTension = 0;
let lastCuriosity = 0;

async function runProactiveCycle(forceAll = false): Promise<void> {
  const now = Date.now();
  const spend = getDailySpend();
  const budgetOk = !isBudgetExceeded();

  if (forceAll || (now - lastAttention) >= ATTN_INTERVAL) {
    try {
      const docs = loadCaptureDocs();
      const signals = computeAttention(docs);
      const report = formatAttentionReport(signals);
      if (existsSync(WIKI_DIR)) writeFileSync(join(WIKI_DIR, "attention-report.md"), report, "utf8");
      const nudges = generateNudges(signals);
      if (nudges.length) writeNudges(nudges);
      lastAttention = now;
    } catch {}
  }

  if (budgetOk && (forceAll || (now - lastTension) >= TENSION_INTERVAL)) {
    try {
      const goals = loadGoals();
      if (goals.length > 0) {
        const docs = loadCaptureDocs();
        const scores = computeTension(goals, docs);
        if (existsSync(WIKI_DIR)) writeFileSync(join(WIKI_DIR, "tension-report.md"), formatTensionReport(scores), "utf8");
        lastTension = now;
      }
    } catch {}
  }

  if (budgetOk && (forceAll || (now - lastCuriosity) >= CURIOSITY_INTERVAL)) {
    try {
      const docs = loadCaptureDocs();
      const attention = computeAttention(docs);
      const goals = loadGoals();
      const tension = goals.length > 0 ? computeTension(goals, docs) : [];
      const qTexts = await generateQuestions(attention, tension);
      if (qTexts.length > 0) {
        const questions: CuriosityQuestion[] = [];
        const qNow = new Date().toISOString().replace("T", " ").slice(0, 19);
        for (let i = 0; i < qTexts.length; i++) {
          const rd = getRelevantDocsForQuestion(qTexts[i], docs);
          if (rd.length > 0) {
            try {
              const inv = await investigateQuestion(qTexts[i], rd);
              questions.push({
                id: `daemon-q-${Date.now()}-${i}`,
                question: qTexts[i],
                generatedAt: qNow,
                source: "attention",
                investigated: true,
                findings: inv.findings,
                missingEvidence: inv.missingEvidence ?? undefined,
                relevantPages: rd.map((d) => d.path),
              });
            } catch {
              questions.push({ id: `daemon-q-${Date.now()}-${i}`, question: qTexts[i], generatedAt: qNow, source: "attention", investigated: false });
            }
          }
        }
        if (questions.length) writeCuriosityLog(questions);
      }
      lastCuriosity = now;
    } catch {}
  }
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
      await runProactiveCycle();
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

const BACKFILL_STATE_PATH = join(FLYD_DIR, "backfill-state.json");

interface BackfillState {
  processed: number;
  total: number;
  enriched: number;
  skipped: number;
  errors: number;
  lastPath: string;
}

function loadBackfillState(): BackfillState {
  if (!existsSync(BACKFILL_STATE_PATH)) {
    return { processed: 0, total: 0, enriched: 0, skipped: 0, errors: 0, lastPath: "" };
  }
  try {
    return JSON.parse(readFileSync(BACKFILL_STATE_PATH, "utf8"));
  } catch {
    return { processed: 0, total: 0, enriched: 0, skipped: 0, errors: 0, lastPath: "" };
  }
}

function saveBackfillState(state: BackfillState): void {
  mkdirSync(FLYD_DIR, { recursive: true });
  writeFileSync(BACKFILL_STATE_PATH, JSON.stringify(state, null, 2), "utf8");
}

export async function runBackfill(): Promise<void> {
  if (!existsSync(RAW_DIR)) {
    console.log("no raw captures found");
    return;
  }

  const captureFiles: string[] = [];
  const stack = [RAW_DIR];
  while (stack.length) {
    const dir = stack.pop()!;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.isFile() && entry.name.endsWith(".md")) captureFiles.push(full.replace(RAW_DIR + "/", ""));
    }
  }

  if (!captureFiles.length) {
    console.log("no capture files found");
    return;
  }

  const state = loadBackfillState();
  state.total = captureFiles.length;
  console.log(`backfill: ${captureFiles.length} captures`);

  let i = 0;
  for (const relPath of captureFiles) {
    i++;
    if (relPath <= state.lastPath) continue;
    const fullPath = join(RAW_DIR, relPath);
    try {
      const content = readFileSync(fullPath, "utf8");
      const parsed = parse(content);
      if (parsed.metadata.event_type || parsed.metadata.signal) { state.skipped++; state.lastPath = relPath; continue; }
      if (parsed.body.length < 50) { state.skipped++; state.lastPath = relPath; continue; }

      let eventMeta: EventMetadata = enrichCaptureLocal(parsed.body);
      if (parsed.body.length > 200) {
        try { eventMeta = await enrichCaptureWithLLM(parsed.body); } catch {}
      }

      const updatedMeta = { ...parsed.metadata };
      if (eventMeta.event_type) updatedMeta.event_type = eventMeta.event_type;
      if (eventMeta.signal) updatedMeta.signal = eventMeta.signal;
      if (eventMeta.participants?.length) updatedMeta.participants = eventMeta.participants;
      if (eventMeta.outcome) updatedMeta.outcome = eventMeta.outcome;
      if (eventMeta.topics?.length) updatedMeta.topics = eventMeta.topics;

      writeFileSync(fullPath, serialize(updatedMeta, parsed.body), "utf8");
      state.enriched++;
      state.lastPath = relPath;

      if (i % 50 === 0) {
        process.stdout.write(`\r  ${i}/${captureFiles.length} (${state.enriched} enriched, ${state.skipped} skipped)`);
        saveBackfillState(state);
      }
    } catch { state.errors++; state.lastPath = relPath; }
  }

  console.log(`\nbackfill: ${state.enriched} enriched, ${state.skipped} skipped, ${state.errors} errors`);
  saveBackfillState(state);
}
