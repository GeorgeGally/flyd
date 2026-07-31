#!/usr/bin/env node
import { runDoctor } from "./commands/doctor.js";
import { runEvidenceResearch } from "./commands/evidence-research.js";

async function main(): Promise<void> {
  if (process.argv[2] === "doctor") {
    const args = process.argv.slice(3);
    const unknown = args.filter((arg) => arg !== "--json");
    if (unknown.length > 0) throw new Error(`Unknown doctor option: ${unknown[0]}`);
    await runDoctor({ json: args.includes("--json") });
    return;
  }

  if (process.argv[2] === "evidence" && process.argv[3] === "research") {
    const args = process.argv.slice(4);
    const flags = new Set(args.filter((arg) => arg.startsWith("--")));
    const unknown = [...flags].filter((arg) => arg !== "--json" && arg !== "--quick" && arg !== "--deep");
    if (unknown.length > 0) throw new Error(`Unknown evidence research option: ${unknown[0]}`);
    const query = args.filter((arg) => !arg.startsWith("--")).join(" ").trim();
    const depth = flags.has("--deep") ? "deep" : flags.has("--quick") ? "quick" : "default";
    await runEvidenceResearch(query, { depth, json: flags.has("--json") });
    return;
  }

  await import("./index.js");
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`flyd: ${message}`);
  process.exitCode = 1;
});
