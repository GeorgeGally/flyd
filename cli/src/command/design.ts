import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { CodingDispatchInput } from "./coding.js";
import { bundledSkillsDir, loadSkills, parseSkill, skillsHome } from "../runtime/skills.js";
import type { DomainRequest, DomainRun } from "./types.js";

// Design is a real path: a lab, N versions of a page, a redesign of a screen.
// Design Mate owns it (design-mate.ts), beside the coding boss rather than
// through it; a finished lab comes back to George as something to review
// rather than a reply to read.

export const DESIGN_LAB_SKILL = "design-lab";

/** What every lab hands back, so Flyd can put it in front of George for review. */
export const DESIGN_LAB_DONE_WHEN = [
  "every version is genuinely distinct and has been through the critic loop",
  "the lab's URL (or file path) and a screenshot of every version are listed in artifacts",
];

/** The ux-psychology skill: behavioural principles and dark-pattern guardrails every design applies and every review checks. */
export const UX_PSYCHOLOGY_SKILL = "ux-psychology";

/** The design-lab skill: George's edited copy in ~/.flyd/skills, else the one Flyd ships with. */
export function designLabSkill(home = skillsHome(), bundled = bundledSkillsDir()): { name: string; body: string } | null {
  const own = (() => { try { return loadSkills(home).find((skill) => skill.name === DESIGN_LAB_SKILL); } catch { return undefined; } })();
  if (own) return { name: own.name, body: own.body };
  const path = join(bundled, DESIGN_LAB_SKILL, "SKILL.md");
  if (!existsSync(path)) return null;
  const shipped = parseSkill(readFileSync(path, "utf8"), path);
  return shipped ? { name: shipped.name, body: shipped.body } : null;
}

export function designTeamSkills(bundled = join(dirname(bundledSkillsDir()), "design-skills")): Array<{ name: string; body: string }> {
  const ownPath = join(skillsHome(), UX_PSYCHOLOGY_SKILL, "SKILL.md");
  try {
    const own = parseSkill(readFileSync(ownPath, "utf8"), ownPath, Infinity);
    if (own?.name === UX_PSYCHOLOGY_SKILL && own.body) return [{ name: own.name, body: own.body }];
  } catch { /* Fall back to the shipped skill. */ }
  const path = join(bundled, UX_PSYCHOLOGY_SKILL, "SKILL.md");
  if (!existsSync(path)) return [];
  const skill = parseSkill(readFileSync(path, "utf8"), path, Infinity);
  return skill ? [{ name: skill.name, body: skill.body }] : [];
}

/** A run that is a design lab: it carries the lab process, whichever handoff started it. */
export function isDesignLabRun(run: Pick<DomainRun, "request"> & { owner?: string }): boolean {
  return run.owner === "Design Mate" || run.request.skill?.name === DESIGN_LAB_SKILL;
}

/**
 * A finished lab waits for George's look until he answers it: a follow-up run
 * on it (his pick, his notes for the next round) means he has reviewed it.
 */
export function labAwaitingReview(run: DomainRun, runs: readonly DomainRun[]): boolean {
  // A lab George said is old (command/run-closure.ts) is not waiting on him, whatever its status.
  if (!isDesignLabRun(run) || run.status !== "completed" || run.closedBy) return false;
  return !runs.some((other) => other.request.parentRequestId === run.id);
}

export type DesignDispatchInput = Omit<CodingDispatchInput, "skill" | "transport"> & { skill?: DomainRequest["skill"]; transport?: unknown };

export type DesignDispatch = { status: "accepted"; run: DomainRun } | { status: "refused"; reason: string };

/**
 * A design lab goes to Design Mate, whichever handoff started it; the review contract rides in done_when.
 * It never throws: a hand-off that cannot be taken comes back refused with the reason in plain words, so
 * the caller tells George instead of retrying into its tool limit (a 10-27 request died that way).
 */
export async function dispatchDesignLab(input: DesignDispatchInput): Promise<DesignDispatch> {
  const doneWhen = [...input.doneWhen, ...DESIGN_LAB_DONE_WHEN.filter((point) => !input.doneWhen.includes(point))];
  try {
    const { dispatchDesignMate } = await import("./design-mate.js");
    return { status: "accepted", run: dispatchDesignMate({
      originalMessage: input.originalMessage,
      intendedOutcome: input.intendedOutcome,
      doneWhen,
      ...(input.source ? { source: input.source } : {}),
      ...(input.parentRequestId ? { parentRequestId: input.parentRequestId } : {}),
      ...(input.contextRefs ? { contextRefs: input.contextRefs } : {}),
      ...(input.requestId ? { requestId: input.requestId } : {}),
      ...(input.objectiveId ? { objectiveId: input.objectiveId } : {}),
      ...(input.decisions ? { decisions: input.decisions } : {}),
      ...(input.project ? { project: input.project } : {}),
      ...(input.now ? { now: input.now } : {}),
    }) };
  } catch (error) {
    return { status: "refused", reason: `the design team could not take it (${error instanceof Error ? error.message : String(error)})` };
  }
}

/** What Flyd may say after handing a lab over: what really happened, in its own words for the chat. Pure. */
export function designStartLine(start: { state: "started" | "failed" | "waiting"; run: DomainRun; failure?: string }): string {
  if (start.state === "failed") {
    return `Error: the design lab did not start. ${start.failure ?? ""} Tell George that in one plain line: it has not started, and why. Do not retry it this turn.`.replace(/\s+/g, " ").trim();
  }
  if (start.state === "waiting") {
    return `Design lab queued (run ${start.run.id}); it has not confirmed it started yet. Tell George it is queued, not that it has started; if it fails he hears why. Do not say who builds it or the id.`;
  }
  return `Design lab started (run ${start.run.id}). When it is ready it lands on a board he can pin notes on, and shows in his column. Tell George only what you started, not who builds it or the id.`;
}
