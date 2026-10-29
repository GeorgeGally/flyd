#!/usr/bin/env node

// Tells index.ts it is being loaded as entry.ts's fallback, not as the binary.
(globalThis as { __flydEntry?: boolean }).__flydEntry = true;

function optionValue(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`);
  return value;
}

function unknownFlags(args: string[], allowed: Set<string>, valued: Set<string> = new Set()): string[] {
  return args.filter((arg, index) => {
    if (!arg.startsWith("--")) return false;
    if (index > 0 && valued.has(args[index - 1] ?? "")) return false;
    return !allowed.has(arg);
  });
}

function positionalArgs(args: string[], valued: Set<string>): string[] {
  return args.filter((arg, index) => {
    if (arg.startsWith("--")) return false;
    if (index > 0 && valued.has(args[index - 1] ?? "")) return false;
    return true;
  });
}

async function main(): Promise<void> {
  if (process.argv[2] === "mobile") {
    const { runMobile } = await import("./mobile/entry.js");
    await runMobile(process.argv.slice(3));
    return;
  }
  if (process.argv[2] === "whatsapp") {
    const { runWhatsApp } = await import("./commands/whatsapp.js");
    await runWhatsApp(process.argv.slice(3));
    return;
  }
  if (process.argv[2] === "accounts") {
    const { runAccounts } = await import("./commands/accounts.js");
    await runAccounts(process.argv.slice(3));
    return;
  }
  if (process.argv[2] === "memory-index") {
    const action = process.argv[3] ?? "status";
    if (!["status", "repair"].includes(action) || process.argv.length > 4) throw new Error("Usage: flyd memory-index [status|repair]");
    if (action === "repair") {
      const { updateRawStrict, embedRawStrict, closeStore } = await import("./lib/qmd.js");
      try { await updateRawStrict(); await embedRawStrict(); } finally { await closeStore(); }
    }
    const report = await (await import("./lib/memory-index.js")).inspectMemoryIndex();
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (report.state !== "ready") process.exitCode = 1;
    return;
  }
  if (process.argv[2] === "doctor") {
    const args = process.argv.slice(3);
    if (args[0] === "repos") {
      await (await import("./commands/repos.js")).runDoctorRepos();
      return;
    }
    const unknown = args.filter((arg) => arg !== "--json");
    if (unknown.length > 0) throw new Error(`Unknown doctor option: ${unknown[0]}`);
    await (await import("./commands/doctor.js")).runDoctor({ json: args.includes("--json") });
    return;
  }

  if (process.argv[2] === "evidence" && process.argv[3] === "research") {
    const args = process.argv.slice(4);
    const flags = new Set(args.filter((arg) => arg.startsWith("--")));
    const unknown = [...flags].filter((arg) => arg !== "--json" && arg !== "--quick" && arg !== "--deep");
    if (unknown.length > 0) throw new Error(`Unknown evidence research option: ${unknown[0]}`);
    const query = args.filter((arg) => !arg.startsWith("--")).join(" ").trim();
    const depth = flags.has("--deep") ? "deep" : flags.has("--quick") ? "quick" : "default";
    await (await import("./commands/evidence-research.js")).runEvidenceResearch(query, { depth, json: flags.has("--json") });
    return;
  }

  if (process.argv[2] === "eval" && process.argv[3] === "planning") {
    const args = process.argv.slice(4);
    const unknown = args.filter((arg) => arg !== "--json");
    if (unknown.length > 0) throw new Error(`Unknown planning eval option: ${unknown[0]}`);
    await (await import("./commands/planning-eval.js")).runPlanningEval({ json: args.includes("--json") });
    return;
  }

  if (process.argv[2] === "future") {
    const args = process.argv.slice(3);
    const valued = new Set(["--goal"]);
    const unknown = unknownFlags(args, new Set(["--json", "--goal"]), valued);
    if (unknown.length > 0) throw new Error(`Unknown future option: ${unknown[0]}`);
    const explicitGoal = optionValue(args, "--goal");
    const positionalGoal = positionalArgs(args, valued).join(" ").trim();
    await (await import("./commands/planning-inspect.js")).runFuture((explicitGoal ?? positionalGoal) || undefined, { json: args.includes("--json") });
    return;
  }

  if (process.argv[2] === "trajectory") {
    const args = process.argv.slice(3);
    const valued = new Set(["--limit", "--repo"]);
    const unknown = unknownFlags(args, new Set(["--json", "--limit", "--repo"]), valued);
    if (unknown.length > 0) throw new Error(`Unknown trajectory option: ${unknown[0]}`);
    const limitValue = optionValue(args, "--limit");
    const limit = limitValue ? Number.parseInt(limitValue, 10) : undefined;
    if (limitValue && (!Number.isInteger(limit) || (limit ?? 0) <= 0)) throw new Error("--limit must be a positive integer");
    const repositoryRoot = optionValue(args, "--repo");
    await (await import("./commands/planning-inspect.js")).runTrajectory({
      json: args.includes("--json"),
      ...(limit ? { limit } : {}),
      ...(repositoryRoot ? { repositoryRoot } : {}),
    });
    return;
  }

  if (process.argv[2] === "decisions") {
    const args = process.argv.slice(3);
    const valued = new Set(["--limit"]);
    const unknown = unknownFlags(args, new Set(["--json", "--limit"]), valued);
    if (unknown.length > 0) throw new Error(`Unknown decisions option: ${unknown[0]}`);
    const limitValue = optionValue(args, "--limit");
    const limit = limitValue ? Number.parseInt(limitValue, 10) : undefined;
    if (limitValue && (!Number.isInteger(limit) || (limit ?? 0) <= 0)) throw new Error("--limit must be a positive integer");
    await (await import("./commands/planning-inspect.js")).runDecisions({ json: args.includes("--json"), ...(limit ? { limit } : {}) });
    return;
  }

  await import("./index.js");
}

// Some provider clients use unref'd sockets/timers. Keep the CLI alive until
// its own command promise settles, otherwise a short-lived command such as
// `flyd doctor` can exit successfully before it writes its async result.
const commandLiveness = setInterval(() => {}, 1_000);
main()
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`flyd: ${message}`);
    process.exitCode = 1;
  })
  .finally(() => clearInterval(commandLiveness));
