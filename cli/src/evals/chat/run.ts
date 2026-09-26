// Live chat evals: replay real personal-agent asks against the configured
// model chain and score task completion, tool choice, latency, and restraint.
// Read-only by construction: state-changing tools are recorded, never run.
//
//   npm run evals:chat                 all cases
//   npm run evals:chat -- --only weather,math-percent
//   npm run evals:chat -- --model commandcode:claude-sonnet-5
import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { FLYD_DIR } from "../../lib/config.js";
import { median, scoreChatEval, type ChatEvalCase, type ChatEvalObservation, type Placeholders } from "./scoring.js";

interface CaseResult {
  id: string;
  category: string;
  passed: boolean;
  failures: string[];
  seconds: number;
  toolCalls: number;
  approvalsAsked: number;
  answer: string;
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
  if (model) process.env.FLYD_CHAT_MODEL = model;
  const only = argValue("--only")?.split(",").map((id) => id.trim()).filter(Boolean);

  const { respondToConversation } = await import("../../runtime/conversation-responder.js");
  const { retrieveAgentMemory, loadAgentSituation } = await import("../../commands/code.js");
  const { refreshRepoRegistry } = await import("../../runtime/repo-registry.js");
  const { interpretAgentInput } = await import("../../runtime/input-interpreter.js");

  const cases = JSON.parse(readFileSync(fileURLToPath(new URL("./cases.json", import.meta.url)), "utf8")) as ChatEvalCase[];
  const selected = only ? cases.filter((item) => only.includes(item.id)) : cases;
  if (selected.length === 0) throw new Error(`No eval cases match ${only?.join(",")}`);

  const situation = await loadAgentSituation().catch(() => null);
  const crossRepo = await refreshRepoRegistry(situation?.projectRoot).catch(() => []);
  const flydRoot = fileURLToPath(new URL("../../../../", import.meta.url));
  const values = placeholders(flydRoot);
  const results: CaseResult[] = [];

  for (const testCase of selected) {
    const route = interpretAgentInput(testCase.ask).kind;
    const observed: ChatEvalObservation = { route, answer: "", seconds: 0, toolCalls: [] };
    let approvalsAsked = 0;
    const started = Date.now();
    if (route === "conversation") {
      try {
        const memory = await retrieveAgentMemory(testCase.ask);
        observed.answer = await respondToConversation({
          sessionId: `eval-${testCase.id}`,
          turnNumber: (testCase.history?.length ?? 0) / 2 + 1,
          message: testCase.ask,
          history: testCase.history ?? [],
          memory,
          situation,
          crossRepo,
          onToken: () => {},
          askUser: async () => { approvalsAsked += 1; return false; },
        }, {
          readOnly: true,
          persistReceipt: async (receipt) => {
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
    const score = scoreChatEval(testCase, observed, values);
    const result: CaseResult = {
      id: testCase.id,
      category: testCase.category,
      passed: score.passed,
      failures: score.failures,
      seconds: Number(observed.seconds.toFixed(1)),
      toolCalls: observed.toolCalls.length,
      approvalsAsked,
      answer: observed.answer.slice(0, 600),
    };
    results.push(result);
    process.stdout.write(`${result.passed ? "PASS" : "FAIL"}  ${testCase.id.padEnd(24)} ${String(result.seconds).padStart(6)}s  tools=${result.toolCalls}${result.passed ? "" : `\n      ${result.failures.join("\n      ")}`}\n`);
  }

  const directory = join(FLYD_DIR, "evals", "chat");
  const previous = previousRun(directory);
  mkdirSync(directory, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  writeFileSync(join(directory, `${stamp}.jsonl`), `${results.map((row) => JSON.stringify(row)).join("\n")}\n`);

  const passed = results.filter((row) => row.passed).length;
  const medianSeconds = median(results.map((row) => row.seconds));
  const lines = [
    "",
    `Chat evals: ${passed}/${results.length} passed (${Math.round((passed / results.length) * 100)}%) · median ${medianSeconds.toFixed(1)}s · ${results.reduce((sum, row) => sum + row.toolCalls, 0)} tool calls`,
  ];
  const byCategory = new Map<string, CaseResult[]>();
  for (const row of results) byCategory.set(row.category, [...(byCategory.get(row.category) ?? []), row]);
  lines.push(`By category: ${[...byCategory].map(([category, rows]) => `${category} ${rows.filter((row) => row.passed).length}/${rows.length}`).join(" · ")}`);
  if (previous) {
    const changed = results.filter((row) => previous.has(row.id) && previous.get(row.id)!.passed !== row.passed);
    if (changed.length) lines.push(`Changed since last run: ${changed.map((row) => `${row.id} ${row.passed ? "now passes" : "REGRESSED"}`).join(", ")}`);
  }
  lines.push(`Results: ${join(directory, `${stamp}.jsonl`)}`);
  process.stdout.write(`${lines.join("\n")}\n`);
  process.exit(passed === results.length ? 0 : 1);
}

main().catch((error) => {
  process.stderr.write(`chat evals failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exit(2);
});
