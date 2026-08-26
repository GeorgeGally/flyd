import { createHash } from "node:crypto";
import { resolveModelConnection } from "../lib/config.js";
import { query } from "../lib/llm.js";
import type { StoredEvent } from "../intelligence/event-store.js";
import { defaultIntelligenceDbPath } from "../intelligence/event-store.js";
import { IntelligenceEventStore } from "../intelligence/event-store.js";
import type { LearningCandidate } from "../work-intelligence/types.js";
import { proposeFromLearningCandidate } from "../work-intelligence/skillify/propose.js";
import type { JudgmentInput } from "./types.js";
import {
  isTransitionCaptureDisabled,
  recordJudgment,
} from "./writer.js";

/**
 * Async outcome judge (transition-log plan U5).
 *
 * Periodic sweep over the intelligence spine: selects unjudged transitions
 * past a grace window, asks the model for ternary verdicts in one batched
 * call, appends judgment events via recordJudgment. Never blocks live
 * requests: no key or kill switch → quiet no-op; model errors leave rows
 * eligible for the next tick.
 */

export interface JudgeSweepDeps {
  modelCall?: (prompt: string) => Promise<string>;
}

export interface JudgeSweepConfig {
  graceMs?: number;
  batchSize?: number;
}

export interface JudgeSweepResult {
  judged: number;
  candidates: number;
  proposals: number;
}

const DEFAULT_GRACE_MS = 2 * 60 * 1000;
const DEFAULT_BATCH_SIZE = 10;
const MAX_PARSE_ATTEMPTS = 2;
const READ_PAGE_SIZE = 1000;
const READ_MAX_EVENTS = 20000;

const JUDGE_SOURCE = "transition.judge";

// Skillify bridge thresholds (transition-log plan U7).
const LESSON_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;
const LESSON_MIN_OCCURRENCES = 3;
const LESSON_MIN_SESSIONS = 2;
const LESSON_DOMAIN = "behaviour";

export interface LessonJudgment {
  transitionSeq: number;
  rationale: string;
  capturedAt: string;
  correlationId: string;
  sessionId: string | null;
  correction: string | null;
}

export interface NegativeLessonGroup {
  key: string;
  occurrences: number;
  distinctSessions: number;
  /** Underlying user correction texts, earliest first. */
  corrections: string[];
}

export function normalizeLessonKey(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Pure grouping of negative-verdict judgments by lesson (U7). Key is the
 * normalized correction text when the judged transition carried one, else
 * the normalized judgment rationale.
 */
export function groupNegativeLessons(
  judgments: Iterable<LessonJudgment>,
): Map<string, NegativeLessonGroup> {
  const byKey = new Map<
    string,
    { occurrences: number; sessions: Set<string>; corrections: Array<{ text: string; capturedAt: string; seq: number }> }
  >();
  for (const j of judgments) {
    const lessonText = j.correction?.trim() ? j.correction : j.rationale;
    const key = normalizeLessonKey(lessonText ?? "");
    if (!key) continue;
    let group = byKey.get(key);
    if (!group) {
      group = { occurrences: 0, sessions: new Set(), corrections: [] };
      byKey.set(key, group);
    }
    group.occurrences++;
    group.sessions.add(j.sessionId ?? j.correlationId);
    if (j.correction?.trim()) {
      group.corrections.push({ text: j.correction.trim(), capturedAt: j.capturedAt, seq: j.transitionSeq });
    }
  }

  const out = new Map<string, NegativeLessonGroup>();
  for (const [key, group] of byKey) {
    out.set(key, {
      key,
      occurrences: group.occurrences,
      distinctSessions: group.sessions.size,
      corrections: group.corrections
        .sort((a, b) => a.capturedAt.localeCompare(b.capturedAt) || a.seq - b.seq)
        .map((c) => c.text),
    });
  }
  return out;
}

function collectNegativeLessonJudgments(now: number): LessonJudgment[] {
  const windowStartMs = now - LESSON_WINDOW_MS;
  const actionsBySeq = new Map<number, StoredEvent>();
  const outcomesByCorrelation = new Map<string, StoredEvent>();
  const out: LessonJudgment[] = [];
  for (const event of readEvents()) {
    if (event.sourceId === JUDGE_SOURCE) {
      const payload = event.payload ?? {};
      if (payload.verdict !== -1) continue;
      const capturedMs = Date.parse(event.capturedAt);
      if (!Number.isFinite(capturedMs) || capturedMs < windowStartMs) continue;
      const transitionSeq = typeof payload.transitionSeq === "number" ? payload.transitionSeq : -1;
      const action = actionsBySeq.get(transitionSeq);
      // Corrections and session ids ride the correlated next-state event,
      // not the judged action itself.
      const outcome = action?.correlationId
        ? outcomesByCorrelation.get(action.correlationId)
        : undefined;
      const nextState = outcome?.payload?.nextState as Record<string, unknown> | undefined;
      const rawCorrection = nextState?.correction;
      const sessionId = outcome?.payload?.sessionId ?? action?.payload?.sessionId;
      out.push({
        transitionSeq,
        rationale: typeof payload.rationale === "string" ? payload.rationale : "",
        capturedAt: event.capturedAt,
        correlationId: action?.correlationId ?? event.correlationId ?? "",
        sessionId: typeof sessionId === "string" ? sessionId : null,
        correction: typeof rawCorrection === "string" && rawCorrection.trim() ? rawCorrection : null,
      });
      continue;
    }
    if (!event.sourceId.startsWith("transition.")) continue;
    if (event.kind === "proposed_action") actionsBySeq.set(event.sequence, event);
    else if (event.correlationId) outcomesByCorrelation.set(event.correlationId, event);
  }
  return out;
}

/**
 * Recurring judge-observed negative lessons become skillify proposals for
 * human confirmation — never auto-injected prompt content (R7/D6). Proposal
 * bodies quote real user corrections only; rationale-only groups are skipped.
 */
export function bridgeNegativeLessonsToSkillify(): number {
  const groups = groupNegativeLessons(collectNegativeLessonJudgments(Date.now()));
  let created = 0;
  for (const group of groups.values()) {
    if (group.occurrences < LESSON_MIN_OCCURRENCES) continue;
    if (group.distinctSessions < LESSON_MIN_SESSIONS) continue;
    // ponytail: earliest correction only — keeps the proposal body (and thus
    // its derived dedupeKey) stable across sweeps so repeats coalesce instead
    // of stacking; full history lands in the wiki at confirm time.
    const content = group.corrections[0];
    if (!content) continue;

    const candidate: LearningCandidate = {
      id: `judge-lesson-${createHash("sha256").update(group.key).digest("hex").slice(0, 16)}`,
      source: "correction",
      content,
      domain: LESSON_DOMAIN,
      outcomeRef: `judgment:${group.key.slice(0, 120)}`,
      epistemicConfidence: "medium",
      timestamp: new Date().toISOString(),
    };
    const proposal = proposeFromLearningCandidate(candidate, {
      workSessionId: "transition-judge",
      interactionId: `judge-${candidate.id}`,
    });
    if (proposal) created++;
  }
  return created;
}

interface TransitionCandidate {
  seq: number;
  surface: string;
  intent: string;
  signal: string | null;
  origin: string | null;
  hasCorrection: boolean;
}

const parseAttempts = new Map<number, number>();

/** Test seam: clears the bounded per-process malformed-response attempt map. */
export function resetJudgeAttemptsForTests(): void {
  parseAttempts.clear();
}

// ponytail: brace-scan salvage for one malformed item inside a JSON array —
// per-item regex parsing if rationales ever contain unbalanced braces.
function salvageObjects(text: string): unknown[] {
  const out: unknown[] = [];
  let depth = 0;
  let startPos = -1;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === "{") {
      if (depth === 0) startPos = i;
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0 && startPos !== -1) {
        try { out.push(JSON.parse(text.slice(startPos, i + 1))); } catch { /* skip broken item */ }
        startPos = -1;
      }
    }
  }
  return out;
}

function extractJsonBlock(raw: string): unknown {
  const text = raw.trim();
  if (!text) return null;
  let candidate = text;
  const fence = candidate.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) candidate = fence[1].trim();
  const start = candidate.search(/[{[]/);
  if (start === -1) return null;
  const end = Math.max(candidate.lastIndexOf("}"), candidate.lastIndexOf("]"));
  if (end <= start) return null;
  const block = candidate.slice(start, end + 1);
  try {
    return JSON.parse(block);
  } catch {
    const salvaged = salvageObjects(block);
    return salvaged.length > 0 ? salvaged : null;
  }
}

/**
 * Parse one model response item against a fixed shape. Tolerant of code
 * fences and leading prose; strict on fields — unknown fields reject the
 * whole entry (execution-loop learning). Accepts either a bare judgment
 * object or an array of `{seq, ...}` items, selecting by transitionSeq.
 */
export function parseJudgmentResponse(raw: string, transitionSeq: number): JudgmentInput | null {
  const parsed = extractJsonBlock(raw ?? "");
  let item: unknown = parsed;
  let allowSeqField = false;

  if (Array.isArray(parsed)) {
    if (parsed.length === 0) return null;
    const matches = parsed.filter(
      (el): el is Record<string, unknown> =>
        !!el && typeof el === "object" && !Array.isArray(el) && el.seq === transitionSeq,
    );
    if (matches.length === 1) {
      item = matches[0];
      allowSeqField = true;
    } else if (parsed.length === 1) {
      item = parsed[0];
    } else {
      return null;
    }
  }

  if (!item || typeof item !== "object" || Array.isArray(item)) return null;
  const fields = { ...(item as Record<string, unknown>) };
  if ("seq" in fields) {
    if (!allowSeqField || fields.seq !== transitionSeq) return null;
    delete fields.seq;
  }

  const keys = Object.keys(fields).sort();
  if (keys.length !== 3 || keys.join(",") !== "confidence,rationale,verdict") return null;

  const verdict = fields.verdict;
  if (typeof verdict !== "number" || !Number.isInteger(verdict)) return null;
  if (verdict !== -1 && verdict !== 0 && verdict !== 1) return null;

  const confidence = fields.confidence;
  if (typeof confidence !== "number" || !Number.isFinite(confidence)) return null;
  if (confidence < 0 || confidence > 1) return null;

  const rationale = fields.rationale;
  if (typeof rationale !== "string" || !rationale.trim()) return null;

  return { transitionSeq, verdict, confidence, rationale: rationale.trim() };
}

function readEvents(): StoredEvent[] {
  const store = new IntelligenceEventStore({ path: defaultIntelligenceDbPath() });
  try {
    const events: StoredEvent[] = [];
    let cursor = 0;
    while (events.length < READ_MAX_EVENTS) {
      const page = store.readFrom(cursor, READ_PAGE_SIZE);
      if (page.length === 0) break;
      events.push(...page);
      cursor = page[page.length - 1].sequence;
      if (page.length < READ_PAGE_SIZE) break;
    }
    return events;
  } finally {
    store.close();
  }
}

function selectCandidates(config: JudgeSweepConfig): TransitionCandidate[] {
  const events = readEvents();
  const judgedSeqs = new Set<number>();
  const actionsByCorrelation = new Map<string, StoredEvent>();
  const latestOutcomeByCorrelation = new Map<string, StoredEvent>();

  for (const event of events) {
    if (event.sourceId === JUDGE_SOURCE) {
      const seq = event.payload?.transitionSeq;
      if (typeof seq === "number") judgedSeqs.add(seq);
      continue;
    }
    if (!event.sourceId.startsWith("transition.")) continue;
    if (!event.correlationId) continue;
    if (event.kind === "proposed_action") {
      actionsByCorrelation.set(event.correlationId, event);
    } else {
      latestOutcomeByCorrelation.set(event.correlationId, event);
    }
  }

  const now = Date.now();
  const graceMs = config.graceMs ?? DEFAULT_GRACE_MS;
  const batchSize = config.batchSize ?? DEFAULT_BATCH_SIZE;

  const candidates: TransitionCandidate[] = [];
  for (const [correlationId, action] of actionsByCorrelation) {
    if (judgedSeqs.has(action.sequence)) continue;
    if ((parseAttempts.get(action.sequence) ?? 0) >= MAX_PARSE_ATTEMPTS) continue;
    if (now - Date.parse(action.capturedAt) < graceMs) continue;

    const outcome = latestOutcomeByCorrelation.get(correlationId);
    // ponytail: judge only ambiguous/error signals and outcome-less actions;
    // deterministic-signal bias lands with U7 generalizations if sweep cost shows up.
    const signal =
      outcome && typeof outcome.payload?.nextState === "object"
        ? ((outcome.payload.nextState as Record<string, unknown>).signal as string | undefined) ?? null
        : null;
    if (signal !== null && signal !== "ambiguous" && signal !== "error") continue;

    const nextState = outcome?.payload?.nextState as Record<string, unknown> | undefined;
    const actionPayload = action.payload as Record<string, unknown> | undefined;
    const intent = (actionPayload?.action as Record<string, unknown> | undefined)?.intent;
    candidates.push({
      seq: action.sequence,
      surface: action.sourceId.replace(/^transition\./, ""),
      intent: typeof intent === "string" ? intent.slice(0, 300) : "(unknown intent)",
      signal,
      origin:
        nextState && typeof nextState.origin === "string" ? nextState.origin : null,
      hasCorrection: typeof nextState?.correction === "string" && nextState.correction.length > 0,
    });
  }

  candidates.sort((a, b) => a.seq - b.seq);
  return candidates.slice(0, batchSize);
}

function buildPrompt(candidates: TransitionCandidate[]): string {
  const lines = candidates.map(
    (c) =>
      `seq=${c.seq} surface=${c.surface} intent="${c.intent}" signal=${c.signal ?? "none"} origin=${c.origin ?? "none"} correction=${c.hasCorrection ? "yes" : "no"}`,
  );
  return [
    "You are judging whether an assistant's action led to a good outcome.",
    "For each transition below, decide: did the action produce a good result for the user?",
    'Respond ONLY with a JSON array: [{"seq": <number>, "verdict": <-1|0|1>, "confidence": <0..1>, "rationale": "<one short sentence>"}]',
    "verdict: 1 good outcome, 0 unclear or neutral, -1 poor outcome. No other keys are allowed.",
    "",
    "Transitions:",
    ...lines.map((line, i) => `${i + 1}. ${line}`),
  ].join("\n");
}

async function defaultModelCall(prompt: string): Promise<string> {
  const connection = resolveModelConnection();
  return query(prompt, connection.model);
}

let sweepInFlight = false;

export async function runJudgeSweep(
  deps: JudgeSweepDeps = {},
  config: JudgeSweepConfig = {},
): Promise<JudgeSweepResult> {
  if (isTransitionCaptureDisabled() || sweepInFlight) return { judged: 0, candidates: 0, proposals: 0 };
  try {
    resolveModelConnection();
  } catch {
    return { judged: 0, candidates: 0, proposals: 0 };
  }

  sweepInFlight = true;
  try {
    const candidates = selectCandidates(config);
    if (candidates.length === 0) return { judged: 0, candidates: 0, proposals: 0 };

    let raw: string;
    try {
      raw = await (deps.modelCall ?? defaultModelCall)(buildPrompt(candidates));
    } catch (error) {
      console.warn("[transitions/judge] model call failed:", error instanceof Error ? error.message : error);
      return { judged: 0, candidates: candidates.length, proposals: 0 };
    }

    let judged = 0;
    for (const candidate of candidates) {
      const parsed = parseJudgmentResponse(raw, candidate.seq);
      if (!parsed) {
        parseAttempts.set(candidate.seq, (parseAttempts.get(candidate.seq) ?? 0) + 1);
        console.warn(`[transitions/judge] unparseable judgment for seq ${candidate.seq}, attempt ${parseAttempts.get(candidate.seq)}`);
        continue;
      }
      const written = recordJudgment(parsed);
      if (written.ok) judged++;
      else console.warn(`[transitions/judge] judgment rejected for seq ${candidate.seq}: ${written.rejection}`);
    }

    let proposals = 0;
    try {
      proposals = bridgeNegativeLessonsToSkillify();
    } catch (error) {
      console.warn(
        "[transitions/judge] skillify bridge failed:",
        error instanceof Error ? error.message : error,
      );
    }
    return { judged, candidates: candidates.length, proposals };
  } finally {
    sweepInFlight = false;
  }
}

let intervalHandle: ReturnType<typeof setInterval> | null = null;

/**
 * Start the periodic judge sweep. The interval is unref'd so it never keeps
 * Core alive, and ticks never overlap (in-flight guard inside runJudgeSweep).
 * Deliberately does NOT run immediately on start — the first sweep waits a
 * full interval so server startup and short-lived test runs stay quiet.
 */
export function startTransitionJudge(intervalMs?: number): void {
  if (intervalHandle) stopTransitionJudge();
  intervalHandle = setInterval(() => {
    void runJudgeSweep().catch((error) =>
      console.warn("[transitions/judge] sweep error:", error instanceof Error ? error.message : error),
    );
  }, intervalMs ?? 5 * 60 * 1000);
  intervalHandle.unref();
}

export function stopTransitionJudge(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}
