import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { firstmateHome } from "../lib/firstmate-home.js";
import { readMeta } from "./stale-calls.js";

const ID_CHARS = "a-z0-9/._-";

/**
 * The repo a message's firstmate task id runs in, with no model: an exact
 * known task id (one of firstmate's `state/<id>.meta` records) named in the
 * text, read to its `project=` repo. A word that only starts like one names
 * nothing. Undefined when the text names no known task, or tasks in more
 * than one repo. Re-reads the records only when firstmate's state changes.
 */
export function taskRepoReader(home: string = firstmateHome()): (text: string | undefined) => string | undefined {
  const state = join(home, "state");
  let seen: number | undefined;
  let repos = new Map<string, string>();
  const known = (): Map<string, string> => {
    try {
      const mtimeMs = statSync(state).mtimeMs;
      if (mtimeMs === seen) return repos;
      repos = new Map(readdirSync(state).filter((name) => name.endsWith(".meta")).flatMap((name): Array<[string, string]> => {
        const id = name.slice(0, -".meta".length);
        const repo = readMeta(home, id).project;
        return repo ? [[id, repo]] : [];
      }));
      seen = mtimeMs;
    } catch { /* no firstmate here: no task ids to know */ }
    return repos;
  };
  return (text) => {
    if (!text) return undefined;
    const tasks = known();
    if (!tasks.size) return undefined;
    const named = new Set<string>();
    for (const token of text.toLowerCase().split(new RegExp(`[^${ID_CHARS}]+`))) {
      const repo = tasks.get(token.replace(/[._/-]+$/, ""));
      if (repo) named.add(repo);
    }
    return named.size === 1 ? [...named][0] : undefined;
  };
}
