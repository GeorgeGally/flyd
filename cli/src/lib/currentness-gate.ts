import type { ScoredEvidence } from "./librarian.js";
import type { PresentModel } from "./present-model.js";
import type { RecallIntent } from "./recall-intent.js";

const CURRENTNESS_FRESHNESS_FLOOR = 0.4;

/**
 * Currentness requires corroboration by a live Present Model signal, never
 * semantic/topical strength alone — an old, wiki-strong project must not
 * qualify just because it scores well. Returns the set of entry paths that
 * qualify as "current" for this query.
 */
export function gateCurrentness(
  scored: ScoredEvidence[],
  presentModel: PresentModel | null,
  intent: RecallIntent,
): Set<string> {
  const currentPaths = new Set<string>();
  if (intent.kind !== "current_state" && intent.kind !== "task_resume") return currentPaths;
  if (!presentModel) return currentPaths;

  // repository.name is an owner/repo slug when a remote exists (e.g.
  // "GeorgeGally/flyd") — too specific to match natural evidence text, so
  // fall back to its last path segment.
  const liveSignalName = presentModel.activeTask?.projectName ?? presentModel.repository?.name?.split("/").at(-1);
  if (!liveSignalName) return currentPaths;

  const needle = liveSignalName.toLowerCase();
  for (const entry of scored) {
    if (entry.confidenceProfile.freshness < CURRENTNESS_FRESHNESS_FLOOR) continue;
    const haystack = `${entry.path} ${entry.body}`.toLowerCase();
    if (haystack.includes(needle)) currentPaths.add(entry.path);
  }

  return currentPaths;
}
