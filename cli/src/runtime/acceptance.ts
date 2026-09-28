// What "done" means, agreed before the work starts, and an independent
// verdict on each point after it. Shared by background jobs and the crew:
// the worker that built something never grades it.

export interface AcceptanceCheck { criterion: string; met: boolean; note: string }

/** done_when from a tool call: a list, or a single string; blanks dropped. */
export function normalizeCriteria(value: unknown): string[] {
  return (Array.isArray(value) ? value : [value])
    .map((item) => String(item ?? "").replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

export const VERDICT_FORMAT = [
  "Reply with exactly one line per point, in order, and nothing else:",
  "MET <n>: <what you saw that proves it>",
  "UNMET <n>: <what is missing or wrong>",
];

/** Points the checker didn't answer count as unmet: silence is not evidence. */
export function parseVerdicts(criteria: string[], reply: string): AcceptanceCheck[] {
  const verdicts = new Map<number, { met: boolean; note: string }>();
  for (const line of reply.split("\n")) {
    const match = line.trim().match(/^[*_\s-]*(MET|UNMET)\s*(\d+)[*_]*\s*[:.)-]\s*(.*)$/i);
    if (!match) continue;
    const index = Number(match[2]) - 1;
    if (!verdicts.has(index)) verdicts.set(index, { met: match[1].toUpperCase() === "MET", note: match[3].trim() });
  }
  return criteria.map((criterion, index) => ({
    criterion,
    ...(verdicts.get(index) ?? { met: false, note: "the check couldn't confirm it" }),
  }));
}

export function unmetChecks(checks: AcceptanceCheck[]): AcceptanceCheck[] {
  return checks.filter((check) => !check.met);
}

/** "a (why); b (why)" — the shortfall in one plain line. */
export function shortfall(checks: AcceptanceCheck[]): string {
  return unmetChecks(checks).map((check) => `${check.criterion} (${check.note})`).join("; ");
}
