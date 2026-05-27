#!/usr/bin/env node
import { Command } from "commander";
import { runSetup } from "./commands/setup.js";
import { runCapture } from "./commands/capture.js";
import { runAsk } from "./commands/ask.js";

const program = new Command();

program
  .name("flyd")
  .description("flyd — personal memory CLI")
  .version("0.1.0");

program
  .command("setup")
  .description("Show setup status — API key configuration")
  .action(runSetup);

program
  .command("capture <text>")
  .description("Capture raw text to Floyd")
  .action(runCapture);

program
  .command("ask <question>")
  .description("Ask Floyd for a governed evidence bundle")
  .option("--model <model>", "LLM model")
  .action((question: string, opts: { model?: string }) =>
    runAsk(question, opts.model)
  );

program.parse();
