#!/usr/bin/env node
import { Command } from "commander";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
import { runSetup } from "./commands/setup.js";
import { runCapture } from "./commands/capture.js";
import { runAsk } from "./commands/ask.js";
import { runSearch } from "./commands/search.js";
import { runCompileContext } from "./commands/compile-context.js";
import { runDedup } from "./commands/dedup.js";
import { runGraph } from "./commands/graph.js";
import { runConsolidate } from "./commands/consolidate.js";
import { runReview } from "./commands/review.js";
import { runQuiz } from "./commands/quiz.js";
import { runCheck } from "./commands/check.js";
import { runCorrect } from "./commands/correct.js";
import { runDaemon, stopDaemon, daemonStatus, runBackfill } from "./commands/daemon.js";
import { runAttention } from "./commands/attention.js";
import { runGoal, runGoalList, runGoalUpdate, runTension } from "./commands/tension.js";
import { runCuriosity } from "./commands/curiosity.js";
import { runDistill } from "./commands/distill.js";
import { runInterests } from "./commands/interests.js";
import { runResearch } from "./commands/research.js";
import { runOptimizeSkill } from "./commands/optimize-skill.js";
import { runPlan } from "./commands/plan.js";
import { runWork } from "./commands/work.js";
import { runCompound } from "./commands/compound.js";
import { runWikiInit } from "./commands/wiki.js";
import { runIngest } from "./commands/ingest.js";
import { runDashboard, acceptSuggestion, dismissSuggestion, getActiveSuggestions, generateSuggestions } from "./commands/dashboard.js";
import { runAgent, runCode } from "./commands/code.js";
import {
  runTaskComplete,
  runTaskAcceptance,
  runTaskAcceptanceReview,
  runTaskAcceptanceVerification,
  runTaskControl,
  runTaskEscape,
  runTaskList,
  runTaskMetrics,
  runTaskStatus,
  runTaskWorkers,
} from "./commands/task.js";
import { closeStore } from "./lib/qmd.js";

const program = new Command();

program
  .name("flyd")
  .description("flyd — your continuous personal coding agent")
  .version("0.1.0");

program
  .command("setup")
  .description("Show setup status — API key configuration")
  .action(() => runSetup());

program
  .argument("[text]", "capture text to raw store (no args — personal agent)")
  .action(async (text?: string) => {
    if (!text) {
      await runAgent();
      return;
    }
    await runCapture(text);
  });

program
  .command("code")
  .description("Start or resume the continuity coding harness")
  .argument("[outcome]", "intended coding outcome")
  .action((outcome?: string) => runCode(outcome));

program
  .command("dashboard")
  .description("Open the legacy suggestion dashboard")
  .action(async () => {
    generateSuggestions();
    await runDashboard();
  });

const task = program
  .command("task")
  .description("Inspect durable coding task state");

task
  .command("list")
  .description("List coding tasks for the current repository")
  .action(() => runTaskList());

task
  .command("status")
  .description("Show the current task and worker re-entry point")
  .argument("[task-key]", "exact Flyd task key")
  .action((taskKey?: string) => runTaskStatus(taskKey));

task
  .command("resume")
  .description("Resume the current repository task")
  .action(() => runCode());

task
  .command("metrics")
  .description("Show continuity and agent-control evidence for this repository")
  .action(() => runTaskMetrics());

const acceptance = task
  .command("acceptance")
  .description("Report the persisted Release 1 acceptance gate")
  .action(() => runTaskAcceptance());

acceptance
  .command("review <kind> <result> <note>")
  .description("Record a sampled memory or recommendation-rationale review")
  .action((kind: string, result: string, note: string) => {
    if (kind !== "memory" && kind !== "rationale") {
      throw new Error("Review kind must be memory or rationale");
    }
    if (result !== "passed" && result !== "failed") {
      throw new Error("Review result must be passed or failed");
    }
    return runTaskAcceptanceReview(kind, result, note);
  });

acceptance
  .command("verify")
  .description("Run and persist the automated Release 1 acceptance suite")
  .action(() => runTaskAcceptanceVerification());

task
  .command("workers")
  .description("List worker assignments and control identities")
  .action(() => runTaskWorkers());

task
  .command("stop <worker-key>")
  .description("Stop a live worker inside the current task grant")
  .action((workerKey: string) => runTaskControl("stop", workerKey));

task
  .command("retry <worker-key>")
  .description("Queue a failed or interrupted assignment for retry")
  .action((workerKey: string) => runTaskControl("retry", workerKey));

task
  .command("redirect <worker-key> <instruction>")
  .description("Stop a worker and revise its assignment with focused instructions")
  .action((workerKey: string, instruction: string) => runTaskControl("redirect", workerKey, instruction));

task
  .command("replace <worker-key>")
  .description("Stop a worker and route its assignment to another adapter")
  .action((workerKey: string) => runTaskControl("replace", workerKey));

task
  .command("complete")
  .description("Record a separately verified task outcome")
  .action(() => runTaskComplete());

task
  .command("escape")
  .description("Record that work continued in another coding tool")
  .argument("[reason]", "why Flyd was not used")
  .action((reason?: string) => runTaskEscape(reason));

program
  .command("ask <question>")
  .description("Ask Floyd — synthesis from raw captures")
  .option("--model <model>", "LLM model")
  .option("--librarian", "Run librarian evidence evaluation before synthesis")
  .action((question: string, opts: { model?: string; librarian?: boolean }) =>
    runAsk(question, opts.model, opts)
  );

program
  .command("search <query>")
  .description("Raw QMD retrieval — returns top matching entries without synthesis")
  .action((query: string) => runSearch(query));

program
  .command("compile-context")
  .description("Compile governed wiki into context bundles")
  .action(() => runCompileContext());

const graph = program
  .command("graph")
  .description("Query the knowledge graph extracted from wiki links")
  .option("--rebuild", "Rebuild graph from current wiki")
  .option("--stats", "Show detailed graph statistics")
  .option("--query <path>", "Query graph from a specific wiki path (e.g. wiki/skills/react)")
  .option("--rel-type <type>", "Filter edges by relationship type")
  .option("--to-path <path>", "Target node path for edge query")
  .action((opts: { rebuild?: boolean; stats?: boolean; query?: string; relType?: string; toPath?: string }) => runGraph(opts));

graph
  .command("rebuild")
  .description("Rebuild graph from current wiki")
  .action(() => runGraph({ rebuild: true }));

graph
  .command("stats")
  .description("Show graph statistics")
  .action(() => runGraph({ stats: true }));

program
  .command("dedup")
  .description("Scan wiki for duplicate entries and optionally remove shorter copies")
  .option("--fix", "auto-delete the shorter entry in each duplicate pair")
  .action((opts: { fix?: boolean }) => runDedup(opts));

program
  .command("consolidate")
  .description("Run self-healing: dedup, staleness check, contradiction detection")
  .option("--fix", "apply fixes for dedup (same as dedup --fix)")
  .option("--contradictions", "run contradiction detection (LLM)")
  .option("--evolve-graph", "extract entities and triples from capture body text to enrich knowledge graph")
  .option("--evolve", "autonomous wiki crystallization — extract durable knowledge from recent captures")
  .option("--dry-run", "show proposed actions without executing (use with --evolve)")
  .action((opts: { fix?: boolean; contradictions?: boolean; evolveGraph?: boolean; evolve?: boolean; dryRun?: boolean }) => runConsolidate(opts));

program
  .command("review")
  .description("Spaced repetition review — recall and rate knowledge items")
  .option("-g, --generate", "generate review items from captures")
  .option("-l, --limit <n>", "max items to review", parseInt)
  .action((opts: { generate?: boolean; limit?: number }) => runReview(opts));

program
  .command("quiz")
  .description("Active recall quiz — test knowledge from review items")
  .option("-l, --limit <n>", "number of questions", parseInt)
  .option("-m, --mode <mode>", "qa or cloze (default: qa)")
  .action((opts: { limit?: number; mode?: string }) => runQuiz({ limit: opts.limit, mode: opts.mode as "qa" | "cloze" | undefined }));

program
  .command("check")
  .description("Quick memory health check — staleness, gaps, coverage")
  .action(() => runCheck());

program
  .command("correct <topic> <correction>")
  .description("Write a correction to the knowledge base — updates wiki entry or creates new one")
  .option("--model <model>", "LLM model")
  .action((topic: string, correction: string, opts: { model?: string }) =>
    runCorrect(topic, correction, opts.model)
  );

program
  .command("distill")
  .description("Backwards-distill raw captures into structured cache/notes/ for all projects")
  .option("--project <project>", "Distill only this project")
  .option("--limit <n>", "Max projects to process", parseInt)
  .option("--model <model>", "LLM model")
  .action((opts: { project?: string; limit?: number; model?: string }) =>
    runDistill(opts)
  );

program
  .command("interests")
  .description("Manage user interests — extracted from capture history")
  .option("--project <name>", "Filter by project")
  .option("--priority <topic:level>", "Set priority for a topic (e.g. 'react:high')")
  .option("--remove <topic>", "Delete an interest")
  .option("--sync", "Force re-extraction from captures")
  .action((opts: { project?: string; priority?: string; remove?: string; sync?: boolean }) =>
    runInterests(opts)
  );

program
  .command("research <topic>")
  .description("Research a topic using LLM, store results as a capture")
  .option("--model <model>", "LLM model")
  .action((topic: string, opts: { model?: string }) =>
    runResearch(topic, opts.model)
  );

program
  .command("plan <topic>")
  .description("Create a structured implementation plan from memory context")
  .option("--model <model>", "LLM model")
  .action((topic: string, opts: { model?: string }) =>
    runPlan(topic, opts.model)
  );

program
  .command("work")
  .description("List plans or show a plan as a checklist")
  .argument("[query]", "plan topic to show (omit for latest)")
  .option("--list", "list all plans")
  .action((query: string | undefined, opts: { list?: boolean }) => {
    if (opts.list) return runWork("--list");
    return runWork(query);
  });

program
  .command("compound <topic>")
  .description("Synthesize captures about a topic into a structured learning document")
  .option("--model <model>", "LLM model")
  .action((topic: string, opts: { model?: string }) =>
    runCompound(topic, opts.model)
  );

program
  .command("daemon")
  .description("Background consolidation daemon — watches for changes and auto-processes")
  .argument("[action]", "start (default), stop, status, or backfill")
  .action(async (action?: string) => {
    const a = action ?? "start";
    if (a === "stop") {
      stopDaemon();
    } else if (a === "status") {
      daemonStatus();
    } else if (a === "backfill") {
      await runBackfill();
    } else {
      await runDaemon();
    }
  });

program
  .command("attention")
  .description("Scan captures for attention signals and generate report")
  .action(async () => {
    await runAttention();
  });

program
  .command("goal <title>")
  .description("Create or list goals (without args, lists all goals)")
  .argument("[action]", "list or update")
  .argument("[slug]", "goal slug for update")
  .argument("[status]", "new status (active, paused, achieved, abandoned)")
  .option("--deadline <date>", "deadline date (YYYY-MM-DD)")
  .action(async (title: string, action?: string, slug?: string, status?: string, opts?: { deadline?: string }) => {
    if (title === "list" || title === "ls") {
      await runGoalList();
    } else if (title === "update" && slug && status) {
      await runGoalUpdate(slug, status);
    } else {
      await runGoal(title, opts?.deadline);
    }
  });

program
  .command("tension")
  .description("Compute tension scores for all tracked goals")
  .action(async () => {
    await runTension();
  });

program
  .command("curiosity")
  .description("Generate questions and investigate patterns in captured data")
  .action(async () => {
    await runCuriosity();
  });

program
  .command("librarian <question>")
  .description("Evaluate evidence coverage for a question without synthesis")
  .action(async (question: string) => {
    const { retrieveRankedBrainEvidence } = await import("./lib/brain-retrieval.js");
    const { formatLibrarianSummary } = await import("./lib/librarian.js");
    const result = await retrieveRankedBrainEvidence(question);

    if (!result.entries.length) {
      console.log("no captures found");
      return;
    }

    console.log(formatLibrarianSummary(result.entries, result.sufficiency));
  });

program
  .command("optimize-skill <name>")
  .description("Optimize a skill — propose improvements via executor/judge/optimizer loop")
  .option("--iterations <n>", "Max optimization iterations", parseInt)
  .option("--model <model>", "Optimizer LLM model")
  .option("--executor <model>", "Executor model for scoring")
  .option("--judge <model>", "Judge model for scoring (different from executor)")
  .option("--dry-run", "Show proposed rewrite without writing to disk")
  .option("--no-cache", "Regenerate task set from scratch")
  .option("--history", "Show optimization history for a skill")
  .action((name: string, opts: {
    iterations?: number;
    model?: string;
    executor?: string;
    judge?: string;
    dryRun?: boolean;
    noCache?: boolean;
    history?: boolean;
  }) => runOptimizeSkill(name, opts));

const wiki = program
  .command("wiki")
  .description("Manage the wiki");

wiki
  .command("init")
  .description("Initialize wiki directory structure with schema, index, and log")
  .option("--git", "Initialize git repo in wiki directory")
  .option("--open", "Launch Obsidian after init")
  .option("--force", "Re-create schema and Obsidian config (preserves wiki pages)")
  .action((opts: { git?: boolean; open?: boolean; force?: boolean }) => runWikiInit(opts));

program
  .command("ingest [source]")
  .description("Ingest captures into wiki (auto: batch from queue; manual: file or --topic; --all: retroactive)")
  .option("--topic", "Search raw captures for topic and ingest matches")
  .option("--all", "Retroactively process all raw captures into the wiki")
  .option("--write", "Execute (default: dry-run preview)")
  .option("--model <model>", "LLM model")
  .option("--limit <n>", "Max pages to create or update", parseInt)
  .action((source: string | undefined, opts: { topic?: boolean; write?: boolean; model?: string; limit?: number; all?: boolean }) => {
    if (!source && !opts.all) return runIngest("", { write: opts.write, model: opts.model, all: opts.all });
    return runIngest(source ?? "", opts);
  });

program
  .command("accept <id>")
  .description("Accept a dashboard suggestion")
  .action((id: string) => {
    const num = parseInt(id, 10);
    if (!isNaN(num)) {
      const suggestions = getActiveSuggestions();
      if (num >= 1 && num <= suggestions.length) {
        const s = acceptSuggestion(suggestions[num - 1].id);
        if (s) {
          console.log(`accepted: ${s.message}`);
          console.log(`action: ${s.action}`);
        }
        return;
      }
    }
    const s = acceptSuggestion(id);
    if (s) {
      console.log(`accepted: ${s.message}`);
      console.log(`action: ${s.action}`);
    } else {
      console.log(`suggestion "${id}" not found`);
    }
  });

program
  .command("dismiss <id>")
  .description("Dismiss a dashboard suggestion")
  .action((id: string) => {
    const num = parseInt(id, 10);
    if (!isNaN(num)) {
      const suggestions = getActiveSuggestions();
      if (num >= 1 && num <= suggestions.length) {
        const s = dismissSuggestion(suggestions[num - 1].id);
        if (s) console.log(`dismissed: ${s.message}`);
        return;
      }
    }
    const s = dismissSuggestion(id);
    if (s) console.log(`dismissed: ${s.message}`);
    else console.log(`suggestion "${id}" not found`);
  });

program
  .command("suggestions")
  .description("List pending suggestions")
  .action(() => {
    const suggestions = getActiveSuggestions();
    if (!suggestions.length) {
      console.log("no pending suggestions");
      return;
    }
    for (let i = 0; i < suggestions.length; i++) {
      console.log(`[${i + 1}] ${suggestions[i].message} → ${suggestions[i].action}`);
    }
  });

program.parseAsync()
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`flyd: ${message}`);
    process.exitCode = 1;
  })
  .finally(() => closeStore());
