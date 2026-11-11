import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// How the news writer's last run went, kept beside the editions so Flyd can
// say whether the news is working without being asked. Only the kind of
// trouble is kept, never the provider's own error text (it can carry account
// links).

/** Why the news writer's model calls stopped, in kinds Flyd can say plainly. */
export type ProviderTrouble = "out_of_credit" | "usage_limit" | "refused" | "unreachable" | "failed";

/** One scout run that called the news writer: when, and whether it got through. */
export interface ScoutRun {
  at: string;
  ok: boolean;
  trouble?: ProviderTrouble;
}

/** The kind of trouble a failed run's error names. Pure. */
export function providerTrouble(message: string): ProviderTrouble {
  if (/\b402\b|insufficient (?:account )?(?:funds|balance)|out of credit|credit balance/i.test(message)) return "out_of_credit";
  if (/\b429\b|rate.?limit|usage limit|quota|backed off/i.test(message)) return "usage_limit";
  if (/\b40[13]\b|api key|unauthori[sz]ed|forbidden|invalid.*key/i.test(message)) return "refused";
  if (/ECONNREFUSED|ENOTFOUND|ETIMEDOUT|EAI_AGAIN|socket hang up|fetch failed|network/i.test(message)) return "unreachable";
  return "failed";
}

export function scoutRunPath(dir: string): string {
  return join(dir, "run-state.json");
}

/** Records a run; a write that fails leaves the last record, never the run. */
export function recordScoutRun(dir: string, run: ScoutRun): void {
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const temporary = `${scoutRunPath(dir)}.${process.pid}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(run)}\n`, { encoding: "utf8", mode: 0o600 });
    renameSync(temporary, scoutRunPath(dir));
  } catch {
    // Unrecorded, the front page falls back to the edition and the agenda log.
  }
}

/** The last recorded run, or null when there is none or it is unreadable. */
export function readScoutRun(dir: string): ScoutRun | null {
  try {
    const run = JSON.parse(readFileSync(scoutRunPath(dir), "utf8")) as Partial<ScoutRun>;
    return typeof run.at === "string" && typeof run.ok === "boolean" ? (run as ScoutRun) : null;
  } catch {
    return null;
  }
}
