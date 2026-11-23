import { createHash, randomUUID } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { commandDir, withFileLock, writeJsonFile } from "../store.js";
import type { Objective } from "./types.js";

// Objectives: one JSON file each under ~/.flyd/command/objectives/, written only through the command store's
// lock (the Phase 2 mutation helper), each write bumping `revision`.

/** Whether the Chief of Staff runs delegated work (split plan; off until Phase 5). */
export function cosEnabled(): boolean {
  return process.env.FLYD_COS === "1";
}

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

export function listObjectives(dir = commandDir()): Objective[] {
  const path = join(dir, "objectives");
  if (!existsSync(path)) return [];
  return readdirSync(path)
    .filter((name) => name.endsWith(".json"))
    .flatMap((name) => {
      try { return [JSON.parse(readFileSync(join(path, name), "utf8")) as Objective]; } catch { return []; }
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
export function openObjective(input: Pick<Objective, "words" | "flydNotes" | "origin"> & Partial<Pick<Objective, "contextRefs" | "urgency" | "project" | "general">>, dir = commandDir(), now = new Date()): Objective {
  const id = `obj-${now.getTime().toString(36)}-${randomUUID().slice(0, 8)}`;
  const at = now.toISOString();
  const objective: Objective = {
    id, revision: 0, createdAt: at, updatedAt: at, origin: input.origin, words: input.words, flydNotes: input.flydNotes,
    contextRefs: input.contextRefs ?? [], ...(input.urgency ? { urgency: input.urgency } : {}), ...(input.project ? { project: input.project } : {}),
    ...(input.general ? { general: true } : {}),
    status: "intake", runs: [], reportIds: [],
  };
  return mutateObjective(id, () => objective, dir)!;
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
