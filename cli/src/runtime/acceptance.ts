// What "done" means, agreed before the work starts, and an independent
// verdict on each point after it. Shared by background jobs and the crew:
// the worker that built something never grades it.

export interface AcceptanceCheck {
  criterion: string;
  met: boolean;
  note: string;
  /** The check itself couldn't run: not evidence that the work fell short. */
  unchecked?: boolean;
}

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

const VERDICT_LINE = /^[*_\s-]*(MET|UNMET)\s*(\d+)[*_]*\s*[:.)-]\s*(.*)$/i;

/**
 * Points the checker didn't answer count as unmet: silence is not evidence.
 * A reply with no verdict lines at all is a broken check, not a failed one,
 * so it throws: the caller mustn't pay for a repair round on no feedback.
 */
export function parseVerdicts(criteria: string[], reply: string): AcceptanceCheck[] {
  const verdicts = new Map<number, { met: boolean; note: string }>();
  const lines = reply.split("\n").map((line) => line.trim());
  if (!lines.some((line) => VERDICT_LINE.test(line))) throw new Error("the check gave no verdicts");
  for (const line of lines) {
    const match = line.match(VERDICT_LINE);
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
