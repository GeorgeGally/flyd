import type { RepositorySnapshot } from "./types.js";

type RepositoryInspector = (path?: string) => Promise<RepositorySnapshot>;

function pathCandidates(outcome: string): string[] {
  const quoted = [ ...outcome.matchAll(/(?:`([^`]+)`|"([^"]+)"|'([^']+)')/g) ]
    .map((match) => match[1] ?? match[2] ?? match[3])
    .filter((value) => value.startsWith("/"));
  const plain = outcome.match(/\/(?:[A-Za-z0-9._~+@%=-]+\/)+[A-Za-z0-9._~+@%=-]+/g) ?? [];
  return [ ...new Set([ ...quoted, ...plain ]) ];
}

export async function resolveRequestedRepositoryRoots(
  outcome: string,
  primaryRoot: string,
  inspectRepository: RepositoryInspector,
): Promise<string[]> {
  const roots = new Set([ primaryRoot ]);
  for (const candidate of pathCandidates(outcome)) {
    try {
      roots.add((await inspectRepository(candidate)).root);
    } catch {
      // Non-repository paths are not eligible for a coding grant.
    }
  }
  return [ ...roots ];
}
