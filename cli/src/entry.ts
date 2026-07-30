#!/usr/bin/env node
import { runDoctor } from "./commands/doctor.js";

async function main(): Promise<void> {
  if (process.argv[2] === "doctor") {
    const args = process.argv.slice(3);
    const unknown = args.filter((arg) => arg !== "--json");
    if (unknown.length > 0) {
      throw new Error(`Unknown doctor option: ${unknown[0]}`);
    }
    await runDoctor({ json: args.includes("--json") });
    return;
  }

  await import("./index.js");
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`flyd: ${message}`);
  process.exitCode = 1;
});
