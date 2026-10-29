import { readFileSync } from "node:fs";
import { isAbsolute, resolve, sep } from "node:path";

export interface RecallCase {
  id: string;
  query: string;
  split: "development" | "held-out";
  category: "exact" | "alias" | "temporal" | "no-answer";
  answers: Array<{ path: string; contains: string }>;
  stale: string[];
}

export function loadRecallCases(path: string, rawDir: string): RecallCase[] {
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (!Array.isArray(parsed) || parsed.length === 0) throw new Error("Benchmark must be a nonempty array");
  const ids = new Set<string>();
  return parsed.map((value: unknown): RecallCase => {
    if (!value || typeof value !== "object") throw new Error("Invalid case");
    const row = value as Record<string, unknown>;
    if (typeof row.id !== "string" || !row.id || ids.has(row.id) || typeof row.query !== "string" || !row.query.trim()
      || (row.split !== "development" && row.split !== "held-out")
      || (row.category !== "exact" && row.category !== "alias" && row.category !== "temporal" && row.category !== "no-answer")
      || !Array.isArray(row.answers) || !Array.isArray(row.stale) || !row.stale.every((x: unknown) => typeof x === "string")) throw new Error("Invalid benchmark case");
    ids.add(row.id);
    const answers = row.answers.map((answer: unknown) => {
      if (!answer || typeof answer !== "object") throw new Error("Invalid answer");
      const item = answer as Record<string, unknown>;
      if (typeof item.path !== "string" || isAbsolute(item.path) || typeof item.contains !== "string" || !item.contains) throw new Error("Invalid answer target");
      const root = resolve(rawDir);
      const target = resolve(root, item.path);
      if (!target.startsWith(root + sep) || !readFileSync(target, "utf8").includes(item.contains)) throw new Error(`Answer target does not contain label for ${row.id}`);
      return { path: item.path, contains: item.contains };
    });
    if ((row.category === "no-answer") !== (answers.length === 0)) throw new Error("No-answer cases must have no targets; other cases need a target");
    return { id: row.id, query: row.query, split: row.split, category: row.category, answers, stale: row.stale };
  });
}
