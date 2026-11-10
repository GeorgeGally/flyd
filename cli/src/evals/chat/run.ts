// Live chat evals: replay real personal-agent asks against the configured
// model chain and score task completion, tool choice, latency, and restraint.
// Read-only by construction: state-changing tools are recorded, never run.
//
//   npm run evals:chat                 all cases
//   npm run evals:chat -- --only weather,math-percent
//   npm run evals:chat -- --model commandcode:claude-sonnet-5
//   npm run evals:chat -- --suite delivery    how finished work reaches George (sandboxed)
//   npm run evals:chat -- --tools split --soul path/to/SOUL.md   (split-plan Phase 0: compare tool sets and voices)
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildJudgePrompt, evalJudgeModel, median, parseJudgeVerdict, percentile, scoreChatEval,
  type ChatEvalCase, type ChatEvalObservation, type Placeholders,
} from "./scoring.js";

interface CaseResult {
  id: string;
  category: string;
  passed: boolean;
  failures: string[];
  seconds: number;
  toolCalls: number;
  approvalsAsked: number;
  judgeScore?: number;
  judgeReason?: string;
  policy?: string;
  model?: string;
  providerIdentity?: string;
  attempts?: ChatEvalObservation["toolCalls"];
  answer: string;
  /** What Flyd tried, for diagnosing failures. */
  calls: string[];
}

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function placeholders(flydRoot: string): Placeholders {
  const now = new Date();
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const iso = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  let headSubject = "";
  try {
    headSubject = execFileSync("git", ["-C", flydRoot, "log", "-1", "--pretty=%s"], { encoding: "utf8" }).trim();
  } catch { /* scored as missing */ }
  const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return {
    weekday: now.toLocaleDateString("en-GB", { weekday: "long" }),
    day: String(now.getDate()),
    today: iso(now),
    tomorrow: iso(tomorrow),
    // Match on the first few words so paraphrased subjects still pass.
    flyd_head_subject: escape(headSubject.split(/\s+/).slice(0, 4).join(" ")),
  };
}

function previousRun(directory: string): Map<string, CaseResult> | null {
  try {
    const files = readdirSync(directory).filter((file) => file.endsWith(".jsonl")).sort();
    const last = files.at(-1);
    if (!last) return null;
    const rows = readFileSync(join(directory, last), "utf8").trim().split("\n").map((line) => JSON.parse(line) as CaseResult);
    return new Map(rows.map((row) => [row.id, row]));
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  const model = argValue("--model");
  if (model) {
    process.env.FLYD_CHAT_MODEL = model;
    // The model under test leads the chain even while Flyd's own Claude is on.
    process.env.FLYD_CLAUDE_CHAT_MODEL = model;
  }
  // The judge stays fixed across runs so model comparisons are apples to apples.
  process.env.FLYD_EVAL = "1";
  const judgeModel = evalJudgeModel();
  const only = argValue("--only")?.split(",").map((id) => id.trim()).filter(Boolean);
  const suite = argValue("--suite") ?? "chat";
  if (!["chat", "decisions", "decisions-heldout", "delivery"].includes(suite)) throw new Error(`Unknown eval suite: ${suite}`);
  const outputRoot = resolve(argValue("--output-dir") ?? join(process.cwd(), ".flyd", "evals", "chat"));
  let decisionSandbox: string | undefined;
  // Fictional decision cases must not inherit or alter George's personal
  // data. Configure the sandbox BEFORE importing any context/store modules.
  if (suite !== "chat") {
    const sandbox = mkdtempSync(join(tmpdir(), "flyd-decision-eval-"));
    decisionSandbox = sandbox;
    process.env.FLYD_DIR = sandbox;
    process.env.XDG_CACHE_HOME = join(sandbox, "cache");
    for (const key of ["FLYD_MEMORY_DIR", "FLYD_JOURNAL_DIR", "FLYD_COUNCIL_DIR", "FLYD_AGENDA_DIR", "FLYD_SCOUT_DIR", "FLYD_CREW_DIR", "FLYD_CREW_WORKTREES", "FLYD_SELF_IMPROVE_DIR", "FLYD_INVESTIGATOR_DIR", "FLYD_SKILLS_DIR", "FLYD_BACKGROUND_JOBS_DIR", "FLYD_CLAUDE_PROJECTS", "FLYD_CONNECTOR_DIR", "FLYD_FIRSTMATE_HOME"]) process.env[key] = join(sandbox, key);
    for (const key of ["FLYD_USER_PROFILE", "FLYD_SOUL_PATH", "FLYD_TASTE_FILE", "FLYD_TASTE_STATE", "FLYD_ADVISORIES_PATH", "FLYD_LIBRARIAN_STATE", "FLYD_MORNING_PATH", "FLYD_PROJECTS_PATH"]) process.env[key] = join(sandbox, `${key}.json`);
    for (const key of ["FLYD_INVESTIGATOR", "FLYD_SELF_IMPROVE", "FLYD_PROFILE_AUTOLEARN", "FLYD_ROUTING_LEARNING", "FLYD_TASTE_LEARNING"]) process.env[key] = "0";
    process.stdout.write(`Isolated evaluation: ${sandbox}\n`);
    process.chdir(sandbox);
  }
  // A voice under test replaces Flyd's, sandbox or not; set before any module reads it.
  const soul = argValue("--soul");
  if (soul) process.env.FLYD_SOUL_PATH = resolve(soul);
  const { FLYD_DIR } = await import("../../lib/config.js");
  if (decisionSandbox) {
    const { useWorkIndexPath } = await import("../../work/database.js");
    useWorkIndexPath(join(decisionSandbox, "work-index.sqlite"));
  }

  if (suite === "delivery") return runDeliverySuite({ only, judgeModel, sandbox: decisionSandbox!, directory: join(outputRoot, "delivery") });

  const { respondToConversation } = await import("../../runtime/conversation-responder.js");
  const { retrieveAgentMemory, loadAgentSituation } = await import("../../commands/code.js");
  const { refreshRepoRegistry } = await import("../../runtime/repo-registry.js");
  const { interpretAgentInput } = await import("../../runtime/input-interpreter.js");
  const { toolProfile } = await import("./tool-profiles.js");
  const tools = toolProfile(argValue("--tools") ?? "current");

  const caseFile = suite === "chat" ? "cases.json" : `${suite}.json`;
  const cases = JSON.parse(readFileSync(fileURLToPath(new URL(`./${caseFile}`, import.meta.url)), "utf8")) as ChatEvalCase[];
  const selected = only ? cases.filter((item) => only.includes(item.id)) : cases;
  if (selected.length === 0) throw new Error(`No eval cases match ${only?.join(",")}`);

  const situation = suite === "chat" ? await loadAgentSituation().catch(() => null) : null;
  const crossRepo = suite === "chat" ? await refreshRepoRegistry(situation?.projectRoot).catch(() => []) : [];
  const flydRoot = fileURLToPath(new URL("../../../../", import.meta.url));
  const values = placeholders(flydRoot);
  const results: CaseResult[] = [];

  for (const testCase of selected) {
    const route = interpretAgentInput(testCase.ask).kind;
    const observed: ChatEvalObservation = { route, answer: "", seconds: 0, toolCalls: [] };
    let approvalsAsked = 0;
    let actualModel = process.env.FLYD_CHAT_MODEL ?? "configured";
    let providerIdentity: string | undefined;
    const started = Date.now();
    if (route === "conversation") {
      try {
        const memory = suite === "chat" ? await retrieveAgentMemory(testCase.ask) : { verdict: "insufficient" as const, matches: [] };
        observed.answer = await respondToConversation({
          sessionId: `eval-${testCase.id}`,
          turnNumber: (testCase.history?.length ?? 0) / 2 + 1,
          message: testCase.ask,
          history: testCase.history ?? [],
          ...(suite !== "chat" ? { now: () => new Date("2026-10-12T05:00:00Z") } : {}),
          memory,
          situation,
          crossRepo,
          onToken: () => {},
          onArtefact: () => {},
          askUser: async () => { approvalsAsked += 1; return false; },
          // A stalled provider must fail the case, not hang the run.
          signal: AbortSignal.timeout(Math.max(60, (testCase.expect.maxSeconds ?? 60) * 3) * 1000),
        }, {
          readOnly: true,
          toolProfile: tools,
          persistReceipt: async (receipt) => {
            actualModel = receipt.model;
            providerIdentity = receipt.providerIdentity;
            observed.toolCalls = receipt.toolCalls.map((call) => ({
              name: call.name, input: call.input, succeeded: call.succeeded, ...(call.error ? { error: call.error } : {}),
            }));
            return receipt as never;
          },
        });
      } catch (error) {
        observed.error = error instanceof Error ? error.message : String(error);
      }
    }
    observed.seconds = (Date.now() - started) / 1000;
    observed.approvalsAsked = approvalsAsked;
    if (testCase.expect.judge && observed.answer) {
      try {
        const { query } = await import("../../lib/llm.js");
        const today = new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
        const verdict = parseJudgeVerdict(await query(buildJudgePrompt(testCase, observed.answer, today), judgeModel));
        if (verdict) {
          observed.judgeScore = verdict.score;
          observed.judgeReason = verdict.reason;
        }
      } catch (error) {
        observed.judgeReason = `judge failed: ${error instanceof Error ? error.message : String(error)}`;
      }
    }
    const score = scoreChatEval(testCase, observed, values);
    const result: CaseResult = {
      id: testCase.id,
      category: testCase.category,
      passed: score.passed,
      failures: score.failures,
      seconds: Number(observed.seconds.toFixed(1)),
      toolCalls: observed.toolCalls.length,
      approvalsAsked,
      ...(suite !== "chat" ? { policy: process.env.FLYD_OPTIMISTIC_DECISIONS === "0" ? "baseline" : "optimistic-decisions.v1", model: actualModel, providerIdentity, attempts: observed.toolCalls } : {}),
      ...(observed.judgeScore !== undefined ? { judgeScore: observed.judgeScore } : {}),
      ...(observed.judgeReason ? { judgeReason: observed.judgeReason } : {}),
      answer: suite === "chat" ? observed.answer.slice(0, 600) : observed.answer,
      calls: observed.toolCalls.map((call) => `${call.succeeded ? "" : "✗ "}${call.name} ${JSON.stringify(call.input).slice(0, 160)}`),
    };
    results.push(result);
    process.stdout.write(`${result.passed ? "PASS" : "FAIL"}  ${testCase.id.padEnd(24)} ${String(result.seconds).padStart(6)}s  tools=${result.toolCalls}${result.judgeScore !== undefined ? `  judge=${result.judgeScore}/10` : ""}${result.passed ? "" : `\n      ${result.failures.join("\n      ")}`}\n`);
  }

  const policy = process.env.FLYD_OPTIMISTIC_DECISIONS === "0" ? "baseline" : "optimistic-v1";
  // Keep frozen suites and rollback comparisons separate from ordinary chat runs.
  const directory = suite === "chat" ? join(FLYD_DIR, "evals", "chat") : join(outputRoot, suite, policy);
  const previous = previousRun(directory);
  mkdirSync(directory, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  writeFileSync(join(directory, `${stamp}.jsonl`), `${results.map((row) => JSON.stringify(row)).join("\n")}\n`);
  if (suite !== "chat") process.stdout.write(`Decision review results: ${directory}\n`);

  const passed = results.filter((row) => row.passed).length;
  const judged = results.filter((row) => row.judgeScore !== undefined);
  const judgedMean = judged.length ? judged.reduce((sum, row) => sum + (row.judgeScore ?? 0), 0) / judged.length : null;
  const medianSeconds = median(results.map((row) => row.seconds));
  const lines = [
    "",
    `Model: ${process.env.FLYD_CHAT_MODEL ?? "(configured)"} · tools: ${argValue("--tools") ?? "current"}${soul ? ` · soul: ${soul}` : ""} · judge: ${judgeModel}${judgedMean !== null ? ` · judged quality ${judgedMean.toFixed(1)}/10 over ${judged.length}` : ""}`,
    `Chat evals: ${passed}/${results.length} passed (${Math.round((passed / results.length) * 100)}%) · median ${medianSeconds.toFixed(1)}s · ${results.reduce((sum, row) => sum + row.toolCalls, 0)} tool calls`,
  ];
  const byCategory = new Map<string, CaseResult[]>();
  for (const row of results) byCategory.set(row.category, [...(byCategory.get(row.category) ?? []), row]);
  lines.push(`By category: ${[...byCategory].map(([category, rows]) => `${category} ${rows.filter((row) => row.passed).length}/${rows.length}`).join(" · ")}`);
  const delegated = (byCategory.get("delegate") ?? []).map((row) => row.seconds);
  if (delegated.length) lines.push(`Delegate turns: p50 ${percentile(delegated, 50).toFixed(1)}s · p95 ${percentile(delegated, 95).toFixed(1)}s`);
  if (previous) {
    const changed = results.filter((row) => previous.has(row.id) && previous.get(row.id)!.passed !== row.passed);
    if (changed.length) lines.push(`Changed since last run: ${changed.map((row) => `${row.id} ${row.passed ? "now passes" : "REGRESSED"}`).join(", ")}`);
  }
  lines.push(`Results: ${join(directory, `${stamp}.jsonl`)}`);
  process.stdout.write(`${lines.join("\n")}\n`);
  process.exit(passed === results.length ? 0 : 1);
}

interface DeliveryResult {
  id: string;
  origin: string;
  surface: string;
  passed: boolean;
  failures: string[];
  seconds: number;
  shape: string;
  judgeScore?: number;
  judgeReason?: string;
  text: string | null;
}

/** How finished work reaches George, through today's paths in the sandbox (split-plan Phase 0). */
async function runDeliverySuite(options: { only?: string[]; judgeModel: string; sandbox: string; directory: string }): Promise<void> {
  const [{ produceDelivery }, { buildDeliveryJudgePrompt, scoreDelivery }, { query, quickQuery }] = await Promise.all([
    import("./delivery-run.js"), import("./delivery-scoring.js"), import("../../lib/llm.js"),
  ]);
  type Case = import("./delivery-scoring.js").DeliveryCase;
  const cases = JSON.parse(readFileSync(fileURLToPath(new URL("./delivery.json", import.meta.url)), "utf8")) as Case[];
  const selected = options.only ? cases.filter((item) => options.only!.includes(item.id)) : cases;
  if (selected.length === 0) throw new Error(`No delivery cases match ${options.only?.join(",")}`);
  const results: DeliveryResult[] = [];
  for (const testCase of selected) {
    const started = Date.now();
    const observed: import("./delivery-scoring.js").DeliveryObservation = { text: null, shape: "words", seconds: 0 };
    try {
      Object.assign(observed, await produceDelivery(testCase, (prompt) => quickQuery(prompt), options.sandbox));
    } catch (error) {
      observed.error = error instanceof Error ? error.message : String(error);
    }
    observed.seconds = (Date.now() - started) / 1000;
    if (testCase.expect.judge && observed.text) {
      try {
        const verdict = parseJudgeVerdict(await query(buildDeliveryJudgePrompt(testCase, observed.text), options.judgeModel));
        if (verdict) { observed.judgeScore = verdict.score; observed.judgeReason = verdict.reason; }
      } catch (error) {
        observed.judgeReason = `judge failed: ${error instanceof Error ? error.message : String(error)}`;
      }
    }
    const score = scoreDelivery(testCase, observed);
    const result: DeliveryResult = {
      id: testCase.id, origin: testCase.origin, surface: testCase.surface, passed: score.passed, failures: score.failures,
      seconds: Number(observed.seconds.toFixed(1)), shape: observed.shape, text: observed.text,
      ...(observed.judgeScore !== undefined ? { judgeScore: observed.judgeScore } : {}),
      ...(observed.judgeReason ? { judgeReason: observed.judgeReason } : {}),
    };
    results.push(result);
    process.stdout.write(`${result.passed ? "PASS" : "FAIL"}  ${testCase.id.padEnd(30)} ${result.shape.padEnd(9)}${result.judgeScore !== undefined ? `  judge=${result.judgeScore}/10` : ""}${result.passed ? "" : `\n      ${result.failures.join("\n      ")}`}\n`);
  }
  mkdirSync(options.directory, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = join(options.directory, `${stamp}.jsonl`);
  writeFileSync(file, `${results.map((row) => JSON.stringify(row)).join("\n")}\n`);
  const passed = results.filter((row) => row.passed).length;
  const real = results.filter((row) => row.origin === "real");
  const judged = results.filter((row) => row.judgeScore !== undefined);
  const clarity = judged.length ? judged.reduce((sum, row) => sum + (row.judgeScore ?? 0), 0) / judged.length : null;
  process.stdout.write([
    "",
    `Judge: ${options.judgeModel}`,
    `Delivery: ${passed}/${results.length} passed (${Math.round((passed / results.length) * 100)}%) · real examples ${real.filter((row) => row.passed).length}/${real.length}${clarity !== null ? ` · judged clarity ${clarity.toFixed(1)}/10 over ${judged.length}` : ""}`,
    `Results: ${file}`,
    "",
  ].join("\n"));
  process.exit(passed === results.length ? 0 : 1);
}

main().catch((error) => {
  process.stderr.write(`chat evals failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exit(2);
});
