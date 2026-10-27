import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
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

/** The design-lab skill: George's edited copy in ~/.flyd/skills, else the one Flyd ships with. */
export function designLabSkill(home = skillsHome(), bundled = bundledSkillsDir()): { name: string; body: string } | null {
  const own = (() => { try { return loadSkills(home).find((skill) => skill.name === DESIGN_LAB_SKILL); } catch { return undefined; } })();
  if (own) return { name: own.name, body: own.body };
  const path = join(bundled, DESIGN_LAB_SKILL, "SKILL.md");
  if (!existsSync(path)) return null;
  const shipped = parseSkill(readFileSync(path, "utf8"), path);
  return shipped ? { name: shipped.name, body: shipped.body } : null;
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
  if (!isDesignLabRun(run) || run.status !== "completed") return false;
  return !runs.some((other) => other.request.parentRequestId === run.id);
}

export type DesignDispatchInput = Omit<CodingDispatchInput, "skill" | "transport"> & { skill?: DomainRequest["skill"]; transport?: unknown };

/** A design lab goes to Design Mate, whichever handoff started it; the review contract rides in done_when. */
export async function dispatchDesignLab(input: DesignDispatchInput): Promise<{ status: "accepted"; run: DomainRun }> {
  const doneWhen = [...input.doneWhen, ...DESIGN_LAB_DONE_WHEN.filter((point) => !input.doneWhen.includes(point))];
  const { dispatchDesignMate } = await import("./design-mate.js");
  return {
    status: "accepted",
    run: dispatchDesignMate({
      originalMessage: input.originalMessage,
      intendedOutcome: input.intendedOutcome,
      doneWhen,
      ...(input.source ? { source: input.source } : {}),
      ...(input.parentRequestId ? { parentRequestId: input.parentRequestId } : {}),
      ...(input.contextRefs ? { contextRefs: input.contextRefs } : {}),
      ...(input.project ? { project: input.project } : {}),
      ...(input.now ? { now: input.now } : {}),
    }),
  };
}
