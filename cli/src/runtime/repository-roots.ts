import { stat } from "fs/promises";
import { homedir } from "os";
import { join } from "path";
import type { RepositorySnapshot } from "./types.js";

type RepositoryInspector = (path?: string) => Promise<RepositorySnapshot>;

function pathCandidates(outcome: string): string[] {
  const quoted = [ ...outcome.matchAll(/(?:`([^`]+)`|"([^"]+)"|'([^']+)')/g) ]
    .map((match) => match[1] ?? match[2] ?? match[3])
    .filter((value) => value.startsWith("/") || value.startsWith("~/"));
  const plain = outcome.match(/(?:~)?\/(?:[A-Za-z0-9._~+@%=-]+\/)+[A-Za-z0-9._~+@%=-]+/g) ?? [];
  return [ ...new Set([ ...quoted, ...plain ]) ];
}

function expandHome(path: string): string {
  return path === "~" ? homedir() : path.startsWith("~/") ? join(homedir(), path.slice(2)) : path;
}

export interface RequestedReadRoots {
  repositoryRoots: string[];
  externalRoots: string[];
}

export async function resolveRequestedReadRoots(
  outcome: string,
  primaryRoot: string,
  inspectRepository: RepositoryInspector,
): Promise<RequestedReadRoots> {
  const repositoryRoots = new Set([ primaryRoot ]);
  const externalRoots = new Set<string>();
  for (const rawCandidate of pathCandidates(outcome)) {
    const candidate = expandHome(rawCandidate);
    try {
      repositoryRoots.add((await inspectRepository(candidate)).root);
      continue;
    } catch {
      // Not a repository; may still be an explicitly referenced external file.
    }
    try {
      const info = await stat(candidate);
      if (info.isFile()) externalRoots.add(candidate);
    } catch {
      // Path does not exist; not eligible for a read grant.
    }
  }
  return {
    repositoryRoots: [ ...repositoryRoots ],
    externalRoots: [ ...externalRoots ],
  };
}

export async function resolveRequestedRepositoryRoots(
  outcome: string,
  primaryRoot: string,
  inspectRepository: RepositoryInspector,
): Promise<string[]> {
  return (await resolveRequestedReadRoots(outcome, primaryRoot, inspectRepository)).repositoryRoots;
}