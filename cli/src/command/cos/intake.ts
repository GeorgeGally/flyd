import { existsSync } from "node:fs";
import { TEAMS } from "../../runtime/turn-plan.js";
import type { DomainId } from "../types.js";
import { planProblem } from "./plan.js";
import type { CosBrief, Objective, RunBrief } from "./types.js";

// Intake: one JSON query turns George's words and what Flyd knew into the team, a brief, done-when, the project
// and the decisions field. The routing is the delegate route's own (`TEAMS` in runtime/turn-plan.ts); there is no
// second router. A reading that cannot be used is refused, and the tick reports it as blocked.

export type Complete = (prompt: string) => Promise<string>;

export interface IntakeContext {
  /** USER.md, when there is one. */
  profile?: string | null;
  /** The work model's one-line reading of what he is on. */
  work?: string;
}

export function intakePrompt(objective: Objective, context: IntakeContext = {}): string {
  return [
    "You are Flyd's Chief of Staff. Flyd handed you this piece of George's work. Choose the team, and write the team a brief they can finish unattended.",
    "Work like a brilliant chief of staff: reason from George's profile, goals and constraints, not generic advice, and settle what his known policy settles rather than bringing it back to him.",
    "Teams:",
    ...Object.entries(TEAMS).map(([team, takes]) => `- ${team}: ${takes}`),
    "",
    `George's exact words: ${objective.words}`,
    ...(objective.flydNotes.trim() ? [`What Flyd knew when he asked: ${objective.flydNotes.trim()}`] : []),
    ...(objective.project?.name || objective.project?.root ? [`The project he was in: ${[objective.project.name, objective.project.root].filter(Boolean).join(" — ")}`] : []),
    ...(context.work ? [`What he is working on: ${context.work}`] : []),
    ...(context.profile ? ["What George has said about himself (USER.md):", context.profile.slice(0, 3_000)] : []),
    "",
    "The brief: the outcome as the finished result, stated so it can be built and checked unattended; done_when as checkable points in his terms.",
    "The decisions field: the calls that must come back to George (taste, money, his name, anything outward or irreversible, a choice only he can make), and the calls his known policy settles so the team decides them without asking (routine implementation choices, naming, which library, anything his profile already answers).",
    "Code work needs the project's folder as project.root.",
    "Work that needs more than one team (say research and a design, then a build from both) also gets \"runs\": each run's id, team, outcome, done_when and after (the ids it waits on). Runs that wait on nothing start at once; a run that waits on several gets its brief written from their results when they are in. Plan only what you can brief now. One team: leave runs out.",
    'Return JSON only: {"team":"coding|knowledge|creative|life","outcome":"...","done_when":["..."],"project":{"name":"...","root":"..."},"decisions":{"comes_back":["..."],"settled_by_policy":["..."]},"runs":[{"id":"...","team":"...","outcome":"...","done_when":["..."],"after":["..."]}]}',
  ].join("\n");
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item ?? "").replace(/\s+/g, " ").trim()).filter(Boolean) : [];
}

type Project = { name?: string; root?: string };

/** A team, or why it isn't one; code work also needs a project folder that exists. */
function teamOf(value: unknown, project: Project, exists: (path: string) => boolean): DomainId | { refused: string } {
  const team = String(value ?? "") as DomainId;
  if (!Object.hasOwn(TEAMS, team)) return { refused: `intake named no team it can hand this to (${String(value ?? "none")})` };
  if (team === "coding" && (!project.root || !exists(project.root))) return { refused: "code work needs a project folder that exists" };
  return team;
}

/** One planned run as a model wrote it, or why it can't be run. */
export function readRun(item: Record<string, unknown>, key: string, after: string[], project: Project, exists: (path: string) => boolean = existsSync): RunBrief | { refused: string } {
  const team = teamOf(item.team, project, exists);
  if (typeof team !== "string") return team;
  const outcome = String(item.outcome ?? "").replace(/\s+/g, " ").trim();
  const doneWhen = strings(item.done_when);
  if (!outcome || !doneWhen.length) return { refused: "a planned run has no outcome or done_when" };
  return { key, team, outcome, doneWhen, ...(project.name || project.root ? { project } : {}), after };
}

/** The runs of a plan that needs more than one team, keyed r1, r2, … in plan order; or why they can't be run. */
function parseRuns(value: unknown, project: Project, exists: (path: string) => boolean): RunBrief[] | { refused: string } | null {
  if (!Array.isArray(value) || value.length < 2) return null;
  const given = value.map((item) => (item && typeof item === "object" ? item : {}) as Record<string, unknown>);
  const keys = new Map(given.map((item, index) => [String(item.id ?? `#${index + 1}`), `r${index + 1}`]));
  const runs: RunBrief[] = [];
  for (const [index, item] of given.entries()) {
    // An id the plan doesn't have stays as given, so the check below names it.
    const run = readRun(item, `r${index + 1}`, strings(item.after).map((id) => keys.get(id) ?? id), project, exists);
    if ("refused" in run) return run;
    runs.push(run);
  }
  const problem = planProblem(runs);
  return problem ? { refused: `intake's plan can't be run: ${problem}` } : runs;
}

/** The brief in a model's reply, or why it cannot be used. Pure. */
export function parseIntake(raw: string, objective: Pick<Objective, "project">, exists: (path: string) => boolean = existsSync): CosBrief | { refused: string } {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, "")) as Record<string, unknown>;
  } catch {
    return { refused: "intake did not return a brief" };
  }
  const given = parsed.project && typeof parsed.project === "object" ? parsed.project as Record<string, unknown> : {};
  const name = String(given.name ?? objective.project?.name ?? "").trim();
  const root = String(given.root ?? objective.project?.root ?? "").trim();
  const project: Project = { ...(name ? { name } : {}), ...(root ? { root } : {}) };
  const runs = parseRuns(parsed.runs, project, exists);
  if (runs && "refused" in runs) return runs;
  // With a plan, the top-level team is the final run's; one-team work names its team itself.
  const team = runs ? runs[runs.length - 1]!.team : teamOf(parsed.team, project, exists);
  if (typeof team !== "string") return team;
  const outcome = String(parsed.outcome ?? "").replace(/\s+/g, " ").trim();
  const doneWhen = strings(parsed.done_when);
  if (!outcome || !doneWhen.length) return { refused: "intake wrote no outcome or done_when" };
  const decisions = parsed.decisions && typeof parsed.decisions === "object" ? parsed.decisions as Record<string, unknown> : {};
  return {
    team, outcome, doneWhen,
    ...(name || root ? { project } : {}),
    decisions: { comesBack: strings(decisions.comes_back), settledByPolicy: strings(decisions.settled_by_policy) },
    ...(runs ? { runs } : {}),
  };
}

/** Runs intake for an objective: the brief, or why it was refused. */
export async function intakeObjective(objective: Objective, complete: Complete, context?: IntakeContext): Promise<CosBrief | { refused: string }> {
  let ctx = context;
  if (!ctx) {
    const [{ readUserProfile }, { readPresentModel, projectHypothesisLine }] = await Promise.all([
      import("../../lib/user-profile.js"), import("../../work/work-hypothesis/store.js"),
    ]);
    ctx = { profile: readUserProfile(), work: projectHypothesisLine(readPresentModel()) };
  }
  const raw = await complete(intakePrompt(objective, ctx)).catch((error: unknown) => {
    throw new Error(`intake could not be read: ${error instanceof Error ? error.message : String(error)}`);
  });
  return parseIntake(raw, objective);
}
