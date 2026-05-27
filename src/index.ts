#!/usr/bin/env node
import { Command } from "commander";

const program = new Command();

program
  .name("flyd")
  .description("flyd — personal memory CLI")
  .version("0.1.0");

program
  .command("capture <text>")
  .description("Capture raw text to Floyd")
  .action((text: string) => {
    console.log("capture:", text);
  });

program
  .command("ask <question>")
  .description("Ask Floyd for a governed evidence bundle")
  .option("--model <model>", "LLM model to use", "gpt-4o-mini")
  .action((question: string, opts: { model: string }) => {
    console.log("ask:", question, "model:", opts.model);
  });

program
  .command("setup")
  .description("Show setup status — PATH and API key configuration")
  .action(() => {
    console.log("setup");
  });

program.parse();
