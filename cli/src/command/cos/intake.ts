import { existsSync } from "node:fs";
import { TEAMS } from "../../runtime/turn-plan.js";
import type { DomainId } from "../types.js";
import type { CosBrief, Objective } from "./types.js";

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
    'Return JSON only: {"team":"coding|knowledge|creative|life","outcome":"...","done_when":["..."],"project":{"name":"...","root":"..."},"decisions":{"comes_back":["..."],"settled_by_policy":["..."]}}',
  ].join("\n");
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item ?? "").replace(/\s+/g, " ").trim()).filter(Boolean) : [];
}

/** The brief in a model's reply, or why it cannot be used. Pure. */
export function parseIntake(raw: string, objective: Pick<Objective, "project">, exists: (path: string) => boolean = existsSync): CosBrief | { refused: string } {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, "")) as Record<string, unknown>;
  } catch {
    return { refused: "intake did not return a brief" };
  }
  const team = String(parsed.team ?? "") as DomainId;
  if (!(team in TEAMS)) return { refused: `intake named no team it can hand this to (${String(parsed.team ?? "none")})` };
  const outcome = String(parsed.outcome ?? "").replace(/\s+/g, " ").trim();
  const doneWhen = strings(parsed.done_when);
  if (!outcome || !doneWhen.length) return { refused: "intake wrote no outcome or done_when" };
  const given = parsed.project && typeof parsed.project === "object" ? parsed.project as Record<string, unknown> : {};
  const name = String(given.name ?? objective.project?.name ?? "").trim();
  const root = String(given.root ?? objective.project?.root ?? "").trim();
  if (team === "coding" && (!root || !exists(root))) return { refused: "code work needs a project folder that exists" };
  const decisions = parsed.decisions && typeof parsed.decisions === "object" ? parsed.decisions as Record<string, unknown> : {};
  return {
    team, outcome, doneWhen,
    ...(name || root ? { project: { ...(name ? { name } : {}), ...(root ? { root } : {}) } } : {}),
    decisions: { comesBack: strings(decisions.comes_back), settledByPolicy: strings(decisions.settled_by_policy) },
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
