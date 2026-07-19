import { query } from "../lib/llm.js";
import type { AgentTask, MemoryEvidence, RepositorySnapshot, TaskAssignment } from "./types.js";
import type { WorkerCapability } from "./worker-adapter.js";

const ALLOWED_CAPABILITIES = new Set<WorkerCapability>([
  "analysis", "implementation", "review", "testing", "resume",
]);
const PLAN_KEYS = [ "successCriteria", "verificationCriteria", "assignments" ];
const ASSIGNMENT_KEYS = [
  "key", "title", "instructions", "capabilityRequirements", "dependencyKeys", "declaredFileScope",
];

export interface PlannedAssignment {
  key: string;
  title: string;
  instructions: string;
  capabilityRequirements: WorkerCapability[];
  dependencyKeys: string[];
  declaredFileScope: string[];
}

export interface AssignmentPlan {
  successCriteria: string[];
  verificationCriteria: string[];
  assignments: PlannedAssignment[];
  source: "model" | "fallback";
}

function strings(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0 &&
    value.every((item) => typeof item === "string" && item.trim().length > 0);
}

function safeFileScope(scope: string): boolean {
  if (scope === ".") return true;
  if (scope !== scope.trim() || scope.startsWith("/") || scope.includes("\\")) return false;
  return scope.split("/").every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}

function exactKeys(value: Record<string, unknown>, expected: string[]): boolean {
  return Object.keys(value).sort().join("|") === [...expected].sort().join("|");
}

function scopesOverlap(first: string[], second: string[]): boolean {
  return first.some((left) => second.some((right) => (
    left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`)
  )));
}

function hasDependencyCycle(assignments: PlannedAssignment[]): boolean {
  const dependencies = new Map(assignments.map((assignment) => [assignment.key, assignment.dependencyKeys]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (key: string): boolean => {
    if (visiting.has(key)) return true;
    if (visited.has(key)) return false;
    visiting.add(key);
    for (const dependency of dependencies.get(key) ?? []) {
      if (!dependencies.has(dependency) || visit(dependency)) return true;
    }
    visiting.delete(key);
    visited.add(key);
    return false;
  };
  return assignments.some((assignment) => visit(assignment.key));
}

function parsePlan(raw: string): AssignmentPlan | null {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object" || !exactKeys(parsed, PLAN_KEYS)) return null;
    if (!strings(parsed.successCriteria) || !strings(parsed.verificationCriteria)) return null;
    if (!Array.isArray(parsed.assignments) || parsed.assignments.length < 1 || parsed.assignments.length > 2) return null;
    const assignments: PlannedAssignment[] = [];
    for (const value of parsed.assignments) {
      if (!value || typeof value !== "object") return null;
      const assignment = value as Record<string, unknown>;
      if (!exactKeys(assignment, ASSIGNMENT_KEYS)) return null;
      if (![assignment.key, assignment.title, assignment.instructions].every((item) => typeof item === "string" && item.trim())) return null;
      if (!strings(assignment.capabilityRequirements) ||
          !assignment.capabilityRequirements.every((capability) => ALLOWED_CAPABILITIES.has(capability as WorkerCapability))) return null;
      if (!Array.isArray(assignment.dependencyKeys) ||
          !assignment.dependencyKeys.every((key) => typeof key === "string" && key.trim())) return null;
      if (!strings(assignment.declaredFileScope) ||
          !assignment.declaredFileScope.every(safeFileScope)) return null;
      assignments.push({
        key: assignment.key as string,
        title: assignment.title as string,
        instructions: assignment.instructions as string,
        capabilityRequirements: assignment.capabilityRequirements as WorkerCapability[],
        dependencyKeys: assignment.dependencyKeys as string[],
        declaredFileScope: assignment.declaredFileScope as string[],
      });
    }
    if (new Set(assignments.map((assignment) => assignment.key)).size !== assignments.length) return null;
    if (hasDependencyCycle(assignments)) return null;
    for (let index = 0; index < assignments.length; index += 1) {
      for (let other = index + 1; other < assignments.length; other += 1) {
        if (scopesOverlap(assignments[index].declaredFileScope, assignments[other].declaredFileScope)) return null;
      }
    }
    return {
      successCriteria: parsed.successCriteria,
      verificationCriteria: parsed.verificationCriteria,
      assignments,
      source: "model",
    };
  } catch {
    return null;
  }
}

function fallbackPlan(outcome: string): AssignmentPlan {
  const requestsChanges = /\b(add|build|change|create|delete|fix|implement|make|migrate|modify|move|refactor|remove|repair|replace|resolve|update|write)\b/i
    .test(outcome);
  const requestsAssessment = /\b(analy[sz]e|assess|audit|explain|inspect|investigate|look at|review|status|summari[sz]e)\b/i
    .test(outcome);
  const readOnly = requestsAssessment && !requestsChanges;

  return {
    successCriteria: [readOnly
      ? "The requested assessment is grounded in repository evidence and returns a concrete conclusion"
      : "The intended outcome is implemented and independently verified"],
    verificationCriteria: [readOnly
      ? "The worker exits successfully without modifying the repository"
      : "The repository verification commands pass"],
    assignments: [{
      key: "primary",
      title: outcome,
      instructions: outcome,
      capabilityRequirements: readOnly ? [ "analysis", "review" ] : [ "implementation", "testing" ],
      dependencyKeys: [],
      declaredFileScope: [ "." ],
    }],
    source: "fallback",
  };
}

const RUNNABLE_ASSIGNMENT_STATUSES = new Set([ "pending", "running", "verified" ]);

export function currentPlanAssignments(
  task: Pick<AgentTask, "plan">,
  assignments: TaskAssignment[],
): TaskAssignment[] {
  const keys = Array.isArray(task.plan.assignment_keys)
    ? task.plan.assignment_keys.filter((key): key is string => typeof key === "string")
    : [];
  const current = keys.length > 0
    ? assignments.filter((assignment) => keys.includes(assignment.assignmentKey))
    : assignments;
  return current.filter((assignment) => RUNNABLE_ASSIGNMENT_STATUSES.has(assignment.status));
}

export async function planAssignments(input: {
  outcome: string;
  repository: RepositorySnapshot;
  memory: MemoryEvidence;
  generate?: (prompt: string) => Promise<string>;
}): Promise<AssignmentPlan> {
  const generate = input.generate ?? ((prompt) => query(prompt));
  const evidence = input.memory.matches.slice(0, 5).map((match) => `${match.path}: ${match.excerpt}`);
  const prompt = [
    "Return strict JSON only with keys successCriteria, verificationCriteria, assignments.",
    "Create one assignment unless two assignments are genuinely independent with non-overlapping file scopes.",
    "At most two assignments. Capabilities: analysis, implementation, review, testing, resume.",
    "Status, assessment, explanation, and review-only outcomes must not request implementation unless edits are explicitly requested.",
    "Each assignment must contain exactly: key, title, instructions, capabilityRequirements, dependencyKeys, declaredFileScope.",
    `Outcome: ${input.outcome}`,
    `Repository: ${input.repository.name} at ${input.repository.head}`,
    `Relevant evidence:\n${evidence.join("\n") || "none"}`,
  ].join("\n");

  try {
    return parsePlan(await generate(prompt)) ?? fallbackPlan(input.outcome);
  } catch {
    return fallbackPlan(input.outcome);
  }
}
