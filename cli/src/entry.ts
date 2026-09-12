#!/usr/bin/env node
import { runDoctor } from "./commands/doctor.js";
import { runEvidenceResearch } from "./commands/evidence-research.js";
import { runDoctorRepos } from "./commands/repos.js";
import { runPlanningEval } from "./commands/planning-eval.js";
import { runDecisions, runFuture, runTrajectory } from "./commands/planning-inspect.js";

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
  if (process.argv[2] === "doctor") {
    const args = process.argv.slice(3);
    if (args[0] === "repos") {
      await runDoctorRepos();
      return;
    }
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

  if (process.argv[2] === "eval" && process.argv[3] === "planning") {
    const args = process.argv.slice(4);
    const unknown = args.filter((arg) => arg !== "--json");
    if (unknown.length > 0) throw new Error(`Unknown planning eval option: ${unknown[0]}`);
    await runPlanningEval({ json: args.includes("--json") });
    return;
  }

  if (process.argv[2] === "future") {
    const args = process.argv.slice(3);
    const valued = new Set(["--goal"]);
    const unknown = unknownFlags(args, new Set(["--json", "--goal"]), valued);
    if (unknown.length > 0) throw new Error(`Unknown future option: ${unknown[0]}`);
    const explicitGoal = optionValue(args, "--goal");
    const positionalGoal = positionalArgs(args, valued).join(" ").trim();
    await runFuture((explicitGoal ?? positionalGoal) || undefined, { json: args.includes("--json") });
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
    await runTrajectory({
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
    await runDecisions({ json: args.includes("--json"), ...(limit ? { limit } : {}) });
    return;
  }

  await import("./index.js");
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`flyd: ${message}`);
  process.exitCode = 1;
});