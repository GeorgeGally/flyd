import { createHash, randomUUID } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { commandDir, withFileLock, writeJsonFile } from "../store.js";
import type { Objective } from "./types.js";

// Objectives: one JSON file each under ~/.flyd/command/objectives/, written only through the command store's
// lock (the Phase 2 mutation helper), each write bumping `revision`.

export { cosEnabled } from "./enabled.js";

function objectivePath(id: string, dir = commandDir()): string {
  if (!/^obj-[a-zA-Z0-9-]{1,80}$/.test(id)) throw new Error("Invalid objective id");
  return join(dir, "objectives", `${id}.json`);
}

export function readObjective(id: string, dir = commandDir()): Objective | null {
  try {
    return JSON.parse(readFileSync(objectivePath(id, dir), "utf8")) as Objective;
  } catch {
    return null;
  }
}

export function listObjectives(dir = commandDir(), strict = false): Objective[] {
  const path = join(dir, "objectives");
  if (!existsSync(path)) return [];
  return readdirSync(path)
    .filter((name) => name.endsWith(".json"))
    .flatMap((name) => {
      try {
        const objective = JSON.parse(readFileSync(join(path, name), "utf8")) as Objective;
        if (strict && (!objective || typeof objective.id !== "string" || `${objective.id}.json` !== name || typeof objective.createdAt !== "string" || !Array.isArray(objective.runs) || !Array.isArray(objective.reportIds) || (objective.plan !== undefined && !Array.isArray(objective.plan)))) throw new Error(`Invalid objective ${name}`);
        return [objective];
      } catch (error) { if (strict) throw error; return []; }
    })
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/** Under the objective's lock: reads it as it is now, applies the change, bumps revision, replaces the file. Null writes nothing. */
export function mutateObjective(id: string, change: (current: Objective | null) => Objective | null, dir = commandDir()): Objective | null {
  const path = objectivePath(id, dir);
  return withFileLock(path, () => {
    const current = readObjective(id, dir);
    const next = change(current);
    if (!next) return current;
    const saved: Objective = { ...next, id, revision: (current?.revision ?? 0) + 1, updatedAt: new Date().toISOString() };
    writeJsonFile(path, saved);
    return saved;
  });
}

/** Opens an objective in intake, durably, and returns it. George's words are kept exactly as given. */
export function openObjective(input: Pick<Objective, "words" | "flydNotes" | "origin"> & Partial<Pick<Objective, "contextRefs" | "urgency" | "project" | "general" | "answerTurn">>, dir = commandDir(), now = new Date()): Objective {
  const id = `obj-${now.getTime().toString(36)}-${randomUUID().slice(0, 8)}`;
  const at = now.toISOString();
  const objective: Objective = {
    id, revision: 0, createdAt: at, updatedAt: at, origin: input.origin, ...(input.answerTurn ? { answerTurn: true } : {}), words: input.words, flydNotes: input.flydNotes,
    contextRefs: input.contextRefs ?? [], ...(input.urgency ? { urgency: input.urgency } : {}), ...(input.project ? { project: input.project } : {}),
    ...(input.general ? { general: true } : {}),
    status: "intake", runs: [], reportIds: [],
  };
  return mutateObjective(id, () => objective, dir)!;
}

/** The objective a team's own follow-up run is adopted into: one per follow-up request, so a replay finds it. */
export function followupObjectiveId(requestId: string): string {
  return `obj-followup-${createHash("sha256").update(requestId).digest("hex").slice(0, 24)}`;
}

/**
 * George answered objective work on its team's own surface (a design board), and the team started the follow-up run
 * itself. That run is adopted by an objective of its own, already working, so the Chief of Staff reviews it and
 * reports once instead of the run reaching George around it. The earlier objective is left as it was; the new one
 * points back at it and at the run it follows. Idempotent: the same follow-up adopts once.
 */
export function adoptFollowupRun(input: {
  objectiveId: string;
  parentObjectiveId: string;
  parentRunId: string;
  runId: string;
  words: string;
  brief: Objective["brief"] & object;
  project?: Objective["project"];
}, dir = commandDir(), now = new Date()): Objective {
  const saved = mutateObjective(input.objectiveId, (existing) => {
    if (existing) return null;
    const at = now.toISOString();
    return {
      id: input.objectiveId, revision: 0, createdAt: at, updatedAt: at, origin: { surface: "view" },
      words: input.words, flydNotes: `George's follow-up on the team's own surface to earlier work (objective ${input.parentObjectiveId}).`,
      contextRefs: [`objective:${input.parentObjectiveId}`, `domain-run:${input.parentRunId}`],
      ...(input.project ? { project: input.project } : {}),
      brief: input.brief, status: "working", runs: [input.runId], reportIds: [], progressAt: at,
    };
  }, dir);
  if (!saved) throw new Error("Could not adopt the follow-up run into an objective");
  return saved;
}

/**
 * CoS records an already-performed, independently sourced READ-ONLY research
 * follow-up under a real, user-created mandate. This creates no worker,
 * FirstMate task, network call or privileged effect. Workers require a
 * separate runtime-enforced execution capability, not a model-suggested task.
 */
export function openVerifiedInitiativeResearch(input: {
  candidateId: string;
  sourceRevision: string;
  acceptedMandateEventId: string;
  researchEventId: string;
  projectName: string;
  publicEvidenceRefs: string[];
}, dir = commandDir(), now = new Date()): { objective: Objective; created: boolean } {
  if (!input.acceptedMandateEventId || !input.researchEventId || !input.publicEvidenceRefs.length) {
    throw new Error("Refusing ungrounded or unaccepted initiative work");
  }
  const digest = createHash("sha256").update(JSON.stringify([
    input.candidateId, input.sourceRevision, input.acceptedMandateEventId,
  ])).digest("hex").slice(0, 24);
  const id = "obj-initiative-" + digest;
  let created = false;
  const saved = mutateObjective(id, (existing) => {
    if (existing) return null;
    created = true;
    const at = now.toISOString();
    return {
      id, revision: 0, createdAt: at, updatedAt: at,
      origin: { surface: "initiative" },
      words: "Flyd-initiated read-only evidence review for " + input.projectName,
      flydNotes: "Source-checked public evidence, no implementation claim and no new authority.",
      contextRefs: [...input.publicEvidenceRefs, "event:" + input.researchEventId],
      urgency: "whenever",
      project: { name: input.projectName },
      initiative: {
        candidateId: input.candidateId, sourceRevision: input.sourceRevision,
        mandateEventId: input.acceptedMandateEventId,
        researchEventId: input.researchEventId, readOnly: true,
      },
      status: "done",
      runs: [], reportIds: [id + ":research"],
    };
  }, dir);
  if (!saved) throw new Error("Could not persist initiative research in CoS");
  return { objective: saved, created };
}


/** Revocation removes readable generated work text from CoS's separate JSON
 * store. Opaque objective IDs remain only for once-only audit and replay.
 */
export function purgeInitiativeObjectives(dir = commandDir(), shouldPurge: (objective: Objective) => boolean = () => true): number {
  let count = 0;
  for (const objective of listObjectives(dir)) {
    if (objective.origin.surface !== "initiative" || !shouldPurge(objective)) continue;
    const changed = mutateObjective(objective.id, (current) => {
      if (!current || current.origin.surface !== "initiative" || !shouldPurge(current)
        || (current.words === "(revoked)" && !current.initiative)) return null;
      count++;
      return {
        ...current, status: "cancelled", words: "(revoked)",
        flydNotes: "", contextRefs: [], project: undefined,
        initiative: undefined, brief: undefined, plan: undefined,
        after: undefined, reportIds: [], pendingReport: undefined,
      };
    }, dir);
    void changed;
  }
  return count;
}
