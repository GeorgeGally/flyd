import { IntelligenceEventStore } from "../intelligence/event-store.js";
import { deriveWorldState, type DerivedWorldState } from "../intelligence/world/world-model.js";
import { replayWorldModel } from "../intelligence/world/replay-cache.js";
import { groundedProperty, knowledgeVersion } from "./curator/knowledge-repair.js";
import { knowledgeScopeHash, projectFactEntity } from "./knowledge-facts.js";

export interface EffectiveKnowledge { state: DerivedWorldState; version: string }
type LegacyKnowledge = { state: Pick<DerivedWorldState,"current"|"governedScopeHashes">; version: string };
export function readEffectiveKnowledge(store?: IntelligenceEventStore, now = new Date()): EffectiveKnowledge {
  const owned = !store;
  const events = store ?? new IntelligenceEventStore();
  try { return events.readTransaction(() => ({ state: deriveWorldState(replayWorldModel(events), now), version: knowledgeVersion(events,now) })); }
  finally { if (owned) events.close(); }
}

/** Exact supported grammar and entity/property matching, never fuzzy deletion of legacy prose. */
export function effectiveLegacyClaim(text: string, view: LegacyKnowledge) {
  const original = groundedProperty(text);
  if (!original) return undefined;
  const entityId = `project:${original.subject.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  return view.state.current.find((c) => c.repairId && c.entityId === entityId && c.attribute === original.property && c.scopeId === entityId);
}

export function isGovernedLegacyFact(text: string, view: LegacyKnowledge): boolean {
  const fact = groundedProperty(text);
  return !!fact && (view.state.governedScopeHashes ?? []).includes(knowledgeScopeHash(projectFactEntity(fact.subject), fact.property));
}

export function effectiveLegacyText(text: string, view: LegacyKnowledge): string {
  if (typeof text !== "string") return text;
  const canonical = text.match(/^(project:[a-z0-9._-]+)(?:\s*·\s*|\.)(launch_date|deadline|hosting_provider|timezone):\s*(.+)$/);
  if (canonical) {
    const claim = view.state.current.find((claim) => claim.repairId && claim.entityId===canonical[1] && claim.attribute===canonical[2] && claim.scopeId===canonical[1]);
    if (claim) return `${canonical[1]} · ${canonical[2]}: ${claim.value}${claim.disputed ? " (disputed; sources disagree)" : ""}`;
    if (view.state.governedScopeHashes?.includes(knowledgeScopeHash(canonical[1],canonical[2]))) return "";
  }
  const original = groundedProperty(text);
  const claim = effectiveLegacyClaim(text,view);
  if (!original) return text;
  if (!claim) return isGovernedLegacyFact(text, view) ? "" : text;
  return `${original.subject} ${original.property.replace(/_/g, " ")} is ${claim.value}${claim.disputed ? " (disputed; sources disagree)" : ""}`;
}

export function effectiveLegacyBlock(text: string, view: LegacyKnowledge = readEffectiveKnowledge()): string {
  return text.split("\n").map((line) => {
    const prefix = line.match(/^(?:-\s+)?(?:\[[^\]]*\]\s*)*/)?.[0] ?? "";
    const effective = effectiveLegacyText(line.slice(prefix.length), view);
    return effective ? prefix + effective : "";
  }).join("\n");
}
