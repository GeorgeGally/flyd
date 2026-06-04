#!/usr/bin/env node
import { Command } from "commander";
import { runSetup } from "./commands/setup.js";
import { runCapture } from "./commands/capture.js";
import { runAsk } from "./commands/ask.js";
import { runSearch } from "./commands/search.js";
import { runCompileContext } from "./commands/compile-context.js";
import { runDedup } from "./commands/dedup.js";
import { runGraph } from "./commands/graph.js";
import { runConsolidate } from "./commands/consolidate.js";
import { runCheck } from "./commands/check.js";
import { runCorrect } from "./commands/correct.js";
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
import { closeStore } from "./lib/qmd.js";

const program = new Command();

program
  .name("flyd")
  .description("flyd — personal memory CLI")
  .version("0.1.0");

program
  .command("setup")
  .description("Show setup status — API key configuration")
  .action(() => runSetup());

program
  .argument("[text]", "capture text to raw store (no args — dashboard)")
  .action(async (text?: string) => {
    if (!text) {
      generateSuggestions();
      await runDashboard();
      return;
    }
    await runCapture(text);
  });

program
  .command("ask <question>")
  .description("Ask Floyd — synthesis from raw captures")
  .option("--model <model>", "LLM model")
  .action((question: string, opts: { model?: string }) =>
    runAsk(question, opts.model)
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
  .action((opts: { fix?: boolean; contradictions?: boolean }) => runConsolidate(opts));

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

program.parseAsync().finally(() => closeStore()).catch(() => {});
