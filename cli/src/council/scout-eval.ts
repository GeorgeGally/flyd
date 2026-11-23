import { appendFileSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

export interface ShadowItem { title: string; url: string; why?: string }
export interface ShadowEdition { date: string; generatedAt: string; baseline: ShadowItem[]; candidate: ShadowItem[] }
type Winner = "A" | "B" | "tie";
const VALID_DATE = /^\d{4}-\d{2}-\d{2}$/;

function readShadow(dir: string, date?: string): ShadowEdition | null {
  if (date && !VALID_DATE.test(date)) return null;
  const name = date ? join(dir, "editorial-shadows", date + ".json") : join(dir, "editorial-shadow.json");
  try {
    const payload = JSON.parse(readFileSync(name, "utf8")) as Partial<ShadowEdition>;
    if (!payload || typeof payload.date !== "string" || !VALID_DATE.test(payload.date)
      || !Array.isArray(payload.baseline) || !Array.isArray(payload.candidate)) return null;
    return payload as ShadowEdition;
  } catch { return null; }
}

function atomic(path: string, data: ShadowEdition): void {
  const temp = path + "." + process.pid + ".tmp";
  writeFileSync(temp, JSON.stringify(data, null, 2) + "\n", { mode: 0o600 });
  renameSync(temp, path);
}

/** Every daily comparison is preserved; the old single latest file still works. */
export function writeEditorialShadow(dir: string, edition: ShadowEdition): void {
  if (!VALID_DATE.test(edition.date)) throw new Error("Invalid editorial comparison date");
  mkdirSync(join(dir, "editorial-shadows"), { recursive: true, mode: 0o700 });
  atomic(join(dir, "editorial-shadows", edition.date + ".json"), edition);
  atomic(join(dir, "editorial-shadow.json"), edition);
}

function candidateFirst(date: string): boolean {
  return Number.parseInt(createHash("sha256").update(date).digest("hex").slice(0, 2), 16) % 2 === 0;
}

/** Deterministic blinded ordering; don't leak old/new to the evaluator. */
export function editorialShadowBrief(dir: string, date?: string): string {
  const shadow = readShadow(dir, date);
  if (!shadow) return "No shadow comparison. Set FLYD_SCOUT_EDITORIAL=shadow and run flyd scout run.";
  const first = candidateFirst(shadow.date) ? shadow.candidate : shadow.baseline;
  const second = candidateFirst(shadow.date) ? shadow.baseline : shadow.candidate;
  const render = (label: string, items: ShadowItem[]) => label + "\n" +
    (items.map((item, index) => String(index + 1) + ". " + item.title + " " + item.url).join("\n") || "(no picks)");
  return ["Blind edition " + shadow.date, render("A", first), render("B", second),
    "Judge: flyd scout judge A | B | tie " + shadow.date].join("\n\n") + "\n";
}

export function recordEditorialJudgment(dir: string, verdict: Winner, date?: string): string {
  const shadow = readShadow(dir, date);
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
    for (const row of rows) if (VALID_DATE.test(row.date) && ["candidate","baseline","tie"].includes(row.result)) byDate.set(row.date, row.result);
    const results = [...byDate.values()];
    const wins = results.filter((value) => value === "candidate").length;
    const losses = results.filter((value) => value === "baseline").length;
    const ties = results.filter((value) => value === "tie").length;
    const decisive = wins + losses;
    const qualified = results.length >= 7 && decisive >= 5 && wins / decisive >= 0.6;
    return "Shadow evaluation: " + results.length + " days (" + wins + " candidate, " + losses + " baseline, " + ties + " ties)." +
      (decisive ? " Non-tied candidate win rate: " + (wins / decisive * 100).toFixed(0) + "%." : "") +
      (qualified ? " Editorial preference gate reached; reliability/cost checks still required." : " Seven-day preference gate not yet reached.");
  } catch { return "No blind editorial judgments yet."; }
}
