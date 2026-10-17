import Database from "better-sqlite3";
import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { rebuildKnowledgeProjections } from "../cognition/projections/store.js";
import { IntelligenceEventStore } from "../intelligence/event-store.js";

/**
 * One-off cleanup of test-generated rows that older test runs wrote into the
 * real intelligence.sqlite (vitest never pointed FLYD_DIR at a temp dir).
 *
 * Only rows positively identified as test output are removed; anything
 * ambiguous stays and is listed under `review` instead. Re-running is safe:
 * once the rows are gone every rule matches nothing.
 */

const TEST_MODELS = new Set(["gpt-4o-mini", "gpt-4.6"]);

/** Session ids that only tests, evals and simulations ever used. */
const FIXTURE_SESSION = [
  /^(generic|ungrounded)-(regression|chat|approved)$/,
  /^route-(fallback|fast|off)$/,
  /^(self-knowledge|skill-turn|smoke|ctx|voice-dry|dogfood-budget|eval|scenario|agenda-test\d+)$/,
  /^eval-/,
  /^scenario-\d+$/,
  /^eq-?\d+(-\d+)?$/,
  /^sim-[a-z]+-\d+$/,
];

/** Canned assistant replies from the conversation-responder test doubles. */
const FIXTURE_REPLIES = new Set([
  "done",
  "model answer",
  "general answer",
  "inspected",
  "Inspection denied.",
  "Inspected safely.",
  "Inspected the complete runtime.",
  "inspect the GNM site and repo before advising",
]);

/**
 * Prompts that only test suites send, each found literally in the repo's
 * tests. A genuine message can share the wording, so a row only counts when it
 * is also part of a burst (see inBurst).
 */
const FIXTURE_INTENTS = new Set([
  "use the tool", "use the tool on this file", "use the tool on the code in this repo",
  "whats on my plate", "check the GNM website", "who is the head coach", "what is the weather today?",
  "the coach said to try X", "I coach soccer on weekends", "do it", "Implement dark mode for the CLI",
  "what should I work on next?", "What am I working on right now, and what is the one most useful next step?",
  "what skills do i have", "what skills do you have?", "what needs to be done on DIR?", "what needs to be done on cleanx?",
  "what is good neighbours posting", "index now", "hey coach, what should I focus on?", "check the good neighbours instagram",
  "bring in the coach, I need life coaching", "bring in the coach", "coach, how did my week go?", "Explain how this works",
  "what's my horoscope today?", "remember this: I prefer aisle seats", "let's just chat", "add milk to my to-do list",
  "I'm not working on Bridgestone anymore", "can I make my 7:15 flight if I leave at 4:40?",
]);

/** The same fixture prompt from several different sessions inside this window: a test suite, not a person. */
const BURST_WINDOW_MS = 60 * 60_000;
const BURST_MIN_SESSIONS = 3;

const TEST_PROJECT = "project:test-project";

export interface PurgeReport {
  dryRun: boolean;
  dbPath: string;
  backupPath?: string;
  eventsBefore: number;
  reasons: Record<string, number>;
  totalDeleted: number;
  eventsAfter: number;
  review: Array<{ what: string; count: number; sample: string }>;
}

interface Row {
  sequence: number;
  captured_at: string;
  source_id: string;
  kind: string;
  payload_json: string | null;
}

function isFixtureSession(id: unknown): boolean {
  return typeof id === "string" && FIXTURE_SESSION.some((p) => p.test(id));
}

/** Rows whose text recurs from at least BURST_MIN_SESSIONS distinct sessions within BURST_WINDOW_MS. */
function inBurst(items: Array<{ sequence: number; session: string; text: string; at: number }>): Set<number> {
  const byText = new Map<string, typeof items>();
  for (const item of items) {
    const group = byText.get(item.text) ?? [];
    group.push(item);
    byText.set(item.text, group);
  }
  const burst = new Set<number>();
  for (const group of byText.values()) {
    group.sort((a, b) => a.at - b.at);
    for (let i = 0; i < group.length; i++) {
      const window = [];
      for (let j = i; j < group.length && group[j].at - group[i].at <= BURST_WINDOW_MS; j++) window.push(group[j]);
      if (new Set(window.map((item) => item.session)).size >= BURST_MIN_SESSIONS) for (const item of window) burst.add(item.sequence);
    }
  }
  return burst;
}

function parse(row: Row): Record<string, any> {
  try { return row.payload_json ? JSON.parse(row.payload_json) : {}; } catch { return {}; }
}

/** Pure classification: sequence -> reason, for every row that is positively test output. */
export function classifyTestRecords(db: Database.Database): { doomed: Map<number, string>; review: PurgeReport["review"] } {
  const doomed = new Map<number, string>();
  const mark = (seq: number, reason: string) => { if (!doomed.has(seq)) doomed.set(seq, reason); };
  const rows = (sql: string, ...args: unknown[]) => db.prepare(sql).all(...args) as Row[];

  // 1. CLI chat transitions: fixture sessions, test model ids, and every
  // outcome/observation that shares an invocation with such a proposal.
  const chat = rows(`SELECT sequence, captured_at, source_id, kind, payload_json FROM personal_events WHERE source_id = 'transition.cli-chat'`);
  const testInvocations = new Set<string>();
  const burstSessions = new Set<string>();
  const chatBurst = inBurst(chat.flatMap((row) => {
    const p = parse(row);
    const intent = row.kind === "proposed_action" ? p.action?.intent : undefined;
    return FIXTURE_INTENTS.has(intent) ? [{ sequence: row.sequence, session: String(p.sessionId), text: intent as string, at: Date.parse(row.captured_at) }] : [];
  }));
  for (const row of chat) {
    const p = parse(row);
    if (chatBurst.has(row.sequence)) burstSessions.add(String(p.sessionId));
    if (row.kind === "proposed_action" && TEST_MODELS.has(p.action?.model)) testInvocations.add(p.invocationId);
    if (isFixtureSession(p.sessionId) || chatBurst.has(row.sequence)) testInvocations.add(p.invocationId);
  }
  for (const row of chat) {
    const p = parse(row);
    if (isFixtureSession(p.sessionId)) mark(row.sequence, "chat transitions in fixture sessions");
    else if (chatBurst.has(row.sequence) || burstSessions.has(String(p.sessionId))) mark(row.sequence, "chat transitions of fixture prompts sent in bursts");
    else if (TEST_MODELS.has(p.action?.model)) mark(row.sequence, "chat transitions with a test model id");
    else if (testInvocations.has(p.invocationId)) mark(row.sequence, "chat outcomes of test invocations");
  }

  // 2. Conversation memory: fixture sessions, the test project, canned replies.
  const cognition = rows(`SELECT sequence, captured_at, source_id, kind, payload_json FROM personal_events WHERE source_id = 'chat.cognition'`);
  const doomedUsers = new Set<string>();
  const keptUsers = new Set<string>();
  const testTopics = new Set<string>();
  const norm = (s: unknown) => String(s ?? "").trim().toLowerCase();
  const conversationBurst = inBurst(cognition.flatMap((row) => {
    const c = row.kind === "observation" ? parse(row).conversation : undefined;
    return c && FIXTURE_INTENTS.has(c.user) ? [{ sequence: row.sequence, session: String(c.sessionId), text: c.user as string, at: Date.parse(row.captured_at) }] : [];
  }));
  for (const row of cognition) {
    const p = parse(row);
    if (row.kind === "observation" && p.conversation) {
      const c = p.conversation;
      const test = isFixtureSession(c.sessionId)
        || conversationBurst.has(row.sequence)
        || (Array.isArray(c.projectIds) && c.projectIds.includes(TEST_PROJECT))
        || FIXTURE_REPLIES.has(String(c.assistant ?? ""));
      if (test) { mark(row.sequence, "fixture conversations"); doomedUsers.add(norm(c.user)); }
      else keptUsers.add(norm(c.user));
    } else if (row.kind === "observation" && p.relation?.to === TEST_PROJECT && String(p.relation.from).startsWith("topic:")) {
      testTopics.add(p.relation.from);
      mark(row.sequence, "topic relations to the test project");
    }
  }
  // A phrase only counts as test-derived when no genuine conversation says it too.
  const fixturePhrases = new Set([...doomedUsers].filter((u) => u && !keptUsers.has(u)));
  // Or a fixture prompt that tests re-learned over and over as the same belief.
  const factCounts = new Map<string, number>();
  for (const row of cognition) {
    if (row.kind !== "inferred_belief") continue;
    const p = parse(row);
    if (p.attribute === "fact") factCounts.set(norm(p.value), (factCounts.get(norm(p.value)) ?? 0) + 1);
  }
  const fixtureIntentsLower = new Set([...FIXTURE_INTENTS].map(norm));
  for (const [value, count] of factCounts) if (count >= 10 && fixtureIntentsLower.has(value)) fixturePhrases.add(value);
  for (const row of cognition) {
    if (row.kind !== "inferred_belief") continue;
    const p = parse(row);
    const entity = String(p.entity?.id ?? "");
    if (entity === TEST_PROJECT) mark(row.sequence, "beliefs about the test project");
    else if (entity.startsWith("topic:") && p.attribute === "fact" && fixturePhrases.has(norm(p.value))) testTopics.add(entity);
  }
  for (const row of cognition) {
    const p = parse(row);
    if (row.kind === "inferred_belief" && testTopics.has(String(p.entity?.id ?? ""))) mark(row.sequence, "beliefs from fixture topics");
    if (row.kind === "observation" && p.relation && (testTopics.has(p.relation.from) || testTopics.has(p.relation.to))) mark(row.sequence, "topic relations from fixture topics");
  }

  // 3. Derived rows pointing at something already condemned.
  for (const row of rows(`SELECT sequence, captured_at, source_id, kind, payload_json FROM personal_events WHERE source_id IN ('transition.judge','cognition.system-one')`)) {
    const p = parse(row);
    const target = row.source_id === "transition.judge" ? p.transitionSeq : p.sourceEvent;
    if (typeof target === "number" && doomed.has(target)) mark(row.sequence, row.source_id === "transition.judge" ? "judgments of test transitions" : "system-one passes over test events");
  }

  // Not purged: repeated canned-looking replies the rules above do not name.
  const review: PurgeReport["review"] = [];
  const repeats = new Map<string, { count: number; sample: string }>();
  for (const row of cognition) {
    if (doomed.has(row.sequence) || row.kind !== "observation") continue;
    const c = parse(row).conversation;
    if (!c?.assistant) continue;
    const key = String(c.assistant).slice(0, 80);
    const entry = repeats.get(key) ?? { count: 0, sample: String(c.user ?? "").slice(0, 60) };
    entry.count++;
    repeats.set(key, entry);
  }
  for (const [reply, { count, sample }] of repeats) {
    if (count >= 25) review.push({ what: `assistant reply repeated ${count}×: ${reply}`, count, sample });
  }
  return { doomed, review: review.sort((a, b) => b.count - a.count).slice(0, 15) };
}

export function defaultPurgeDbPath(): string {
  return join(process.env.FLYD_DIR?.trim() || join(homedir(), ".flyd"), "intelligence.sqlite");
}

function timestamp(): string {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\..*/, "").replace("T", "-");
}

export async function purgeTestRecords(options: { dbPath?: string; dryRun?: boolean; backupDir?: string; rebuild?: boolean } = {}): Promise<PurgeReport> {
  const dbPath = options.dbPath ?? defaultPurgeDbPath();
  const dryRun = options.dryRun ?? false;
  if (!existsSync(dbPath)) throw new Error(`No intelligence store at ${dbPath}`);
  const db = new Database(dbPath, dryRun ? { readonly: true } : {});
  let report: PurgeReport;
  try {
    db.pragma("busy_timeout = 30000");
    const count = () => (db.prepare("SELECT COUNT(*) n FROM personal_events").get() as { n: number }).n;
    const eventsBefore = count();
    const { doomed, review } = classifyTestRecords(db);
    const reasons: Record<string, number> = {};
    for (const reason of doomed.values()) reasons[reason] = (reasons[reason] ?? 0) + 1;
    report = { dryRun, dbPath, eventsBefore, reasons, totalDeleted: doomed.size, eventsAfter: eventsBefore - doomed.size, review };
    if (dryRun || doomed.size === 0) return report;

    const backupDir = options.backupDir ?? join(dirname(dbPath), "backups");
    mkdirSync(backupDir, { recursive: true, mode: 0o700 });
    const backupPath = join(backupDir, `intelligence-${timestamp()}.sqlite`);
    await db.backup(backupPath);
    report.backupPath = backupPath;

    const remove = db.prepare("DELETE FROM personal_events WHERE sequence = ?");
    db.transaction(() => { for (const seq of doomed.keys()) remove.run(seq); })();
    report.eventsAfter = count();
  } finally {
    db.close();
  }
  // The knowledge files are projections of the events: rebuild them without the junk.
  if (options.rebuild !== false) {
    const store = new IntelligenceEventStore({ path: dbPath });
    try { rebuildKnowledgeProjections(store); } finally { store.close(); }
  }
  return report;
}

export async function runPurgeTestRecords(opts: { dryRun?: boolean; json?: boolean; db?: string }): Promise<void> {
  const report = await purgeTestRecords({ dryRun: opts.dryRun, dbPath: opts.db });
  if (opts.json) { console.log(JSON.stringify(report, null, 2)); return; }
  console.log(`${report.dryRun ? "[dry run] would delete" : "deleted"} ${report.totalDeleted} of ${report.eventsBefore} events in ${report.dbPath}`);
  for (const [reason, n] of Object.entries(report.reasons).sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(6)}  ${reason}`);
  if (report.backupPath) console.log(`backup: ${report.backupPath}`);
  if (!report.dryRun) console.log(`events now: ${report.eventsAfter}; knowledge projections rebuilt`);
  if (report.review.length) {
    console.log("kept, worth a look (not purged):");
    for (const r of report.review) console.log(`  ${r.what}  (e.g. "${r.sample}")`);
  }
}
