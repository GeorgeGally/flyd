import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { CodingDispatchInput, CodingDomainDispatch } from "./coding.js";
import { bundledSkillsDir, loadSkills, parseSkill, skillsHome } from "../runtime/skills.js";
import type { DomainRequest, DomainRun } from "./types.js";

// Design is a real path: a lab, N versions of a page, a redesign of a screen.
// The work is built (HTML, screenshots, a critic loop), so the coding boss owns
// it and its design agents do it; what makes it design is the lab process riding
// the handoff as the design-lab skill, and a finished lab coming back to George
// as something to review rather than a reply to read.

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
export function isDesignLabRun(run: Pick<DomainRun, "request">): boolean {
  return run.request.skill?.name === DESIGN_LAB_SKILL;
}

/**
 * A finished lab waits for George's look until he answers it: a follow-up run
 * on it (his pick, his notes for the next round) means he has reviewed it.
 */
export function labAwaitingReview(run: DomainRun, runs: readonly DomainRun[]): boolean {
  if (!isDesignLabRun(run) || run.status !== "completed") return false;
  return !runs.some((other) => other.request.parentRequestId === run.id);
}

export type DesignDispatchInput = Omit<CodingDispatchInput, "skill"> & { skill?: DomainRequest["skill"] };

/** Hands a design lab to the coding boss with the lab process attached and the review contract in done_when. */
export async function dispatchDesignLab(input: DesignDispatchInput): Promise<CodingDomainDispatch | { status: "refused"; reason: "no_design_skill" }> {
  const skill = input.skill?.name === DESIGN_LAB_SKILL ? input.skill : designLabSkill();
  if (!skill) return { status: "refused", reason: "no_design_skill" };
  const doneWhen = [...input.doneWhen, ...DESIGN_LAB_DONE_WHEN.filter((point) => !input.doneWhen.includes(point))];
  const { dispatchCodingDomain } = await import("./coding.js");
  return dispatchCodingDomain({ ...input, doneWhen, skill });
}
