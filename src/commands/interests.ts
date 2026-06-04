import { extractInterests, listInterests } from "../lib/interests.js";

export function runInterests(opts: { project?: string; priority?: string; remove?: string; sync?: boolean }): void {
  if (opts.sync) {
    const { extracted, updated } = extractInterests();
    console.log(`extracted ${extracted} new interests, updated ${updated} existing`);
    return;
  }

  listInterests(opts.project, { priority: opts.priority, remove: opts.remove });
}
