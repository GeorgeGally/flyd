import type { Specialist } from "./specialist-registry.js";
import { listSpecialistNames, lookupSpecialist } from "./specialist-registry.js";

// Dynamic capability composition: which specialists exist THIS turn.
// A specialist is present when its own authored address patterns match the
// message — adding intelligence is registering capability, not editing the
// conversation loop.

export interface ResolvedSpecialist {
  specialist: Specialist;
  /** Which address pattern brought this specialist in (for debugging). */
  matchedBy: string;
}

/**
 * Compose the specialist set for one message. Registration order breaks
 * ties; a message that addresses nobody composes an empty set and the turn
 * proceeds as ordinary conversation.
 */
export function specialistsForMessage(message: string): ResolvedSpecialist[] {
  const resolved: ResolvedSpecialist[] = [];
  for (const name of listSpecialistNames()) {
    const specialist = lookupSpecialist(name);
    if (!specialist?.addresses) continue;
    for (const pattern of specialist.addresses) {
      if (pattern.test(message)) {
        resolved.push({ specialist, matchedBy: pattern.source });
        break;
      }
    }
  }
  return resolved;
}
