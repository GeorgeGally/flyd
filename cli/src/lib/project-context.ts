import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

export interface ProjectContextBlock {
  file: string;
  content: string;
}

const CONTEXT_FILES = [ "AGENTS.md", "SOUL.md", "MEMORY.md", "package.json", "README.md" ];

function fileCap(file: string): number {
  return file === "package.json" || file === "README.md" ? 1500 : 2500;
}

function isWithin(root: string, candidate: string): boolean {
  const path = relative(root, candidate);
  return path === "" || (!path.startsWith(`..${sep}`) && path !== ".." && !isAbsolute(path));
}

function resolveWithinAny(roots: string[], candidate: string): boolean {
  return roots.some((root) => {
    try {
      const resolvedRoot = realpathSync(root);
      const resolvedCandidate = realpathSync(candidate);
      return isWithin(resolvedRoot, resolvedCandidate);
    } catch {
      return isWithin(resolve(root), resolve(candidate));
    }
  });
}

// ponytail: walk up looking for context files, 5 levels, 5-file dedupe, per-file caps
export function collectProjectContext(projectRoot: string, boundaryRoots: string[] = []): ProjectContextBlock[] {
  const blocks: ProjectContextBlock[] = [];
  let dir = projectRoot;
  const found = new Set<string>();
  for (let i = 0; i < 5; i++) {
    for (const file of CONTEXT_FILES) {
      if (found.has(file)) continue;
      const p = join(dir, file);
      try {
        if (!existsSync(p)) continue;
        if (boundaryRoots.length > 0 && !resolveWithinAny(boundaryRoots, realpathSync(p))) continue;
        found.add(file);
        const content = readFileSync(p, "utf8");
        blocks.push({ file, content: content.slice(0, fileCap(file)) });
      } catch {
        // Unreadable or symlinked-outside file; skip it, keep the rest of the walk.
      }
    }
    const parent = dirname(dir);
    if (parent === dir || found.size >= CONTEXT_FILES.length) break;
    if (boundaryRoots.length > 0 && !resolveWithinAny(boundaryRoots, parent)) break;
    dir = parent;
  }
  return blocks;
}