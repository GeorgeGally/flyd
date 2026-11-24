import { createHash } from "node:crypto";
import { IntelligenceEventStore } from "../intelligence/event-store.js";
import { knowledgeSourceAllowed } from "./curator/knowledge-source-policy.js";

export const procedureSignature = (scope: string, instructions: string) => createHash("sha256").update(JSON.stringify([scope, instructions.trim()])).digest("hex");

export function findProcedureOutcomes(scope: string, instructions: string): number[] {
  const store = new IntelligenceEventStore();
  try {
    const seen = new Set<string>();
    return store.readProcedureOutcomes(procedureSignature(scope,instructions)).filter((event) => {
      const id = (event.payload?.outcome as { interventionId?: string })?.interventionId;
      if (!id || seen.has(id)) return false;
      seen.add(id); return true;
    }).slice(0,12).map((event) => event.sequence);
  } finally { store.close(); }
}

/** Success labels and memory-readback checks cannot stand in for independent outcome evidence. */
export function verifiedProcedureEvidence(sequences: number[], scope: string, instructions: string): boolean {
  if (sequences.length < 3 || sequences.length > 12 || new Set(sequences).size !== sequences.length) return false;
  const store = new IntelligenceEventStore();
  try {
    const interventions = new Set<string>();
    const origins = new Set<number>();
    const signature = procedureSignature(scope, instructions);
    if (store.readProcedureOutcomes(signature).some((event) => {
      const outcome = event.payload?.outcome as { attribution?: string; review?: { verdict?: string } } | undefined;
      return knowledgeSourceAllowed(store,event) && (["user_rejected","not_helpful"].includes(outcome?.attribution ?? "") || outcome?.review?.verdict === "not_helpful");
    })) return false;
    for (const sequence of sequences) {
      const event = store.getBySequence(sequence);
      const procedure = event?.payload?.procedure as { signature?: string; instructions?: string } | undefined;
      const outcome = event?.payload?.outcome as { attribution?: string; interventionId?: string } | undefined;
      if (!event?.payload || event.kind !== "verified_outcome" || !knowledgeSourceAllowed(store,event) || procedure?.signature !== signature || procedure.instructions !== instructions.trim() ||
          !["direct_verified", "observed_impact"].includes(outcome?.attribution ?? "") || !outcome?.interventionId || interventions.has(outcome.interventionId) ||
          !event.evidenceRefs.length || event.evidenceRefs.some((ref) => {
            if (!/^event:\d+$/.test(ref)) return true;
            const sequence = Number(ref.slice(6)), original = store.getBySequence(sequence);
            if (!original || origins.has(sequence) || !knowledgeSourceAllowed(store,original)) return true;
            origins.add(sequence);
            return false;
          })) return false;
      interventions.add(outcome.interventionId);
    }
    return interventions.size >= 3;
  } finally { store.close(); }
}
