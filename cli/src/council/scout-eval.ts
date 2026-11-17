import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

interface ShadowItem { title: string; url: string; why?: string }
interface ShadowEdition { date: string; baseline: ShadowItem[]; candidate: ShadowItem[] }
type Winner = "A" | "B" | "tie";

function readShadow(dir: string): ShadowEdition | null {
  try {
    const payload = JSON.parse(readFileSync(join(dir, "editorial-shadow.json"), "utf8")) as Partial<ShadowEdition>;
    if (!payload || typeof payload.date !== "string" || !Array.isArray(payload.baseline) || !Array.isArray(payload.candidate)) return null;
    return payload as ShadowEdition;
  } catch { return null; }
}

function candidateFirst(date: string): boolean {
  return Number.parseInt(createHash("sha256").update(date).digest("hex").slice(0, 2), 16) % 2 === 0;
}

/** Stable blinded ordering: no algorithm labels leak to the evaluator. */
export function editorialShadowBrief(dir: string): string {
  const shadow = readShadow(dir);
  if (!shadow) return "No shadow comparison. Set FLYD_SCOUT_EDITORIAL=shadow and run flyd scout run.";
  const first = candidateFirst(shadow.date) ? shadow.candidate : shadow.baseline;
  const second = candidateFirst(shadow.date) ? shadow.baseline : shadow.candidate;
  const render = (label: string, items: ShadowItem[]) =>
    label + "\n" + (items.map((item, n) => String(n + 1) + ". " + item.title + " " + item.url).join("\n") || "(no picks)");
  return ["Blind edition " + shadow.date, render("A", first), render("B", second), "Judge: flyd scout judge A | B | tie"].join("\n\n") + "\n";
}

export function recordEditorialJudgment(dir: string, verdict: Winner): string {
  const shadow = readShadow(dir);
  if (!shadow) return "No shadow edition to judge.";
  const candidateWon = verdict === "tie" ? null : ((verdict === "A") === candidateFirst(shadow.date));
  const record = { date: shadow.date, at: new Date().toISOString(), result: candidateWon === null ? "tie" : candidateWon ? "candidate" : "baseline" };
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    appendFileSync(join(dir, "editorial-judgments.jsonl"), JSON.stringify(record) + "\n", { mode: 0o600 });
    return "Blind editorial judgment recorded for " + shadow.date + ".";
  } catch { return "Could not save editorial judgment."; }
}

export function editorialEvaluationSummary(dir: string): string {
  try {
    const rows = readFileSync(join(dir, "editorial-judgments.jsonl"), "utf8")
      .split("\n").filter(Boolean).flatMap((line) => {
        try { return [JSON.parse(line) as { date: string; result: string }]; } catch { return []; }
      });
    const byDate = new Map<string, string>();
    for (const row of rows) byDate.set(row.date, row.result);
    const results = [...byDate.values()];
    const wins = results.filter((value) => value === "candidate").length;
    const losses = results.filter((value) => value === "baseline").length;
    const ties = results.filter((value) => value === "tie").length;
    const decisive = wins + losses;
    return "Shadow evaluation: " + results.length + " days (" + wins + " candidate, " + losses + " baseline, " + ties + " ties)." +
      (decisive ? " Non-tied candidate win rate: " + (wins / decisive * 100).toFixed(0) + "%." : "");
  } catch { return "No blind editorial judgments yet."; }
}
