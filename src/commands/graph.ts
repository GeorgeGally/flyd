import { rebuildGraph, queryGraph, getGraphStats, graphExists, getGraphPath } from "../lib/graph.js";
import { join } from "path";
import { WIKI_DIR } from "../lib/config.js";
import { existsSync } from "fs";

export function runGraph(opts: { rebuild?: boolean; query?: string; relType?: string; toPath?: string; stats?: boolean }): void {
  if (opts.rebuild || !graphExists()) {
    rebuildGraph();
    console.log("graph rebuilt");
    return;
  }

  if (opts.stats) {
    const stats = getGraphStats();
    console.log(`entities: ${stats.entities}`);
    console.log(`edges: ${stats.edges}`);
    if (Object.keys(stats.byType).length > 0) {
      console.log("by type:");
      for (const [type, count] of Object.entries(stats.byType)) {
        console.log(`  ${type}: ${count}`);
      }
    }
    return;
  }

  if (opts.query) {
    const fromPath = opts.query.startsWith("wiki/") ? opts.query.slice(5) : opts.query;
    const toPath = opts.toPath?.startsWith("wiki/") ? opts.toPath.slice(5) : opts.toPath;
    const edges = queryGraph({ fromPath, relType: opts.relType, toPath });
    if (!edges.length) {
      console.log("no edges found");
      return;
    }
    for (const e of edges) {
      console.log(`${e.from} --[${e.rel_type}]--> ${e.to} (${e.confidence})`);
    }
    return;
  }

  console.log("graph exists at:", getGraphPath());
  const stats = getGraphStats();
  console.log(`${stats.entities} entities, ${stats.edges} edges.`);
  console.log("Use --rebuild to regenerate, --stats for details, --query <path> to traverse.");
}