import type { ScoredEvidence } from "./librarian.js";
import type { PresentModel } from "./present-model.js";
import type { RecallIntent } from "./recall-intent.js";

const CURRENTNESS_FRESHNESS_FLOOR = 0.4;

// git status --porcelain=v1 lines look like "XY path" or "XY path -> newpath"
// for renames — strip the 2-char status code and take the final path segment.
function extractChangedFileBasenames(statusLines: string[]): string[] {
  const names = statusLines
    .map((line) => line.slice(3).split(" -> ").pop()?.trim())
    .map((path) => path?.split("/").pop())
    .filter((name): name is string => Boolean(name));
  return [...new Set(names)];
}

// Matches memoryEpistemicStatus() in brain-retrieval.ts's own check for
// "user_confirmed" — an explicit user correction. Highest authority in the
// system (explicit_user > everything else); it doesn't need git
// corroboration to count as current, unlike general wiki/conversation
// content, which is exactly what the original regression fixture guards
// against (an old, confident wiki page must NOT get to skip corroboration).
function isExplicitUserCorrection(entry: ScoredEvidence): boolean {
  return entry.metadata.type === "flyd-runtime-task-corrected";
}

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

  for (const entry of scored) {
    if (isExplicitUserCorrection(entry)) currentPaths.add(entry.path);
  }

  if (!presentModel) return currentPaths;

  // repository.name is an owner/repo slug when a remote exists (e.g.
  // "GeorgeGally/flyd") — too specific to match natural evidence text, so
  // fall back to its last path segment.
  const projectNameNeedle = presentModel.activeTask?.projectName ?? presentModel.repository?.name?.split("/").at(-1);
  const changedFileNeedles = extractChangedFileBasenames(presentModel.repository?.statusLines ?? []);
  const strongNeedles = changedFileNeedles.map((n) => n.toLowerCase());
  const weakNeedle = projectNameNeedle?.toLowerCase();
  if (!weakNeedle && strongNeedles.length === 0) return currentPaths;

  for (const entry of scored) {
    if (currentPaths.has(entry.path)) continue;
    if (entry.confidenceProfile.freshness < CURRENTNESS_FRESHNESS_FLOOR) continue;
    const haystack = `${entry.path} ${entry.body}`.toLowerCase();
    const matchesStrong = strongNeedles.some((needle) => haystack.includes(needle));
    if (matchesStrong) {
      currentPaths.add(entry.path);
      continue;
    }
    // A past conversation transcript will almost always mention the project
    // by name just by being about it — that's too weak a bar to call it
    // "current." Only non-conversation evidence (raw notes, wiki pages) gets
    // to corroborate via the project name alone; conversation transcripts
    // need a specific changed-file match.
    const isConversationTranscript = entry.metadata.type === "conversation-index";
    if (!isConversationTranscript && weakNeedle && haystack.includes(weakNeedle)) {
      currentPaths.add(entry.path);
    }
  }

  return currentPaths;
}
