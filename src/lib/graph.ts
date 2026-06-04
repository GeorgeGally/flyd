import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { FLYD_DIR, WIKI_DIR } from "./config.js";
import { parse } from "./frontmatter.js";
import { walkWikiFiles } from "./wiki.js";

const GRAPH_DIR = join(FLYD_DIR, "graph");
const GRAPH_JSON = join(GRAPH_DIR, "graph.json");

export interface GraphLink {
  target: string;
  type: string;
  confidence: number;
  extraction: string;
  proposed_by?: string;
  governed_by?: string[];
  source?: string;
}

export interface GraphNode {
  path: string;
  type: string;
  lastUpdated: string;
  links: GraphLink[];
}

interface GraphData {
  version: number;
  built: string;
  entities: Record<string, GraphNode>;
  edges: Array<{ from: string; to: string; rel_type: string; confidence: number; extraction: string }>;
}

function ensureGraphDir(): void {
  mkdirSync(GRAPH_DIR, { recursive: true });
}

function loadGraph(): GraphData {
  if (!existsSync(GRAPH_JSON)) {
    return { version: 1, built: "", entities: {}, edges: [] };
  }
  try {
    return JSON.parse(readFileSync(GRAPH_JSON, "utf8")) as GraphData;
  } catch {
    return { version: 1, built: "", entities: {}, edges: [] };
  }
}

function saveGraph(data: GraphData): void {
  ensureGraphDir();
  writeFileSync(GRAPH_JSON, JSON.stringify(data, null, 2), "utf8");
}

export function rebuildGraph(): void {
  const data: GraphData = {
    version: 1,
    built: new Date().toISOString(),
    entities: {},
    edges: [],
  };

  if (!existsSync(WIKI_DIR)) {
    saveGraph(data);
    return;
  }

  const files = walkWikiFiles();

  for (const file of files) {
    const content = readFileSync(file, "utf8");
    const { metadata } = parse(content);
    const relPath = file.replace(WIKI_DIR + "/", "");

    const node: GraphNode = {
      path: relPath,
      type: String(metadata.type ?? "unknown"),
      lastUpdated: metadata.last_confirmed
        ? String(metadata.last_confirmed)
        : new Date().toISOString().split("T")[0],
      links: [],
    };

    const links = metadata.links;
    if (Array.isArray(links)) {
      for (const link of links) {
        if (typeof link === "object" && link !== null) {
          const l = link as Record<string, unknown>;
          const target = String(l.target ?? "");
          const relType = String(l.type ?? "related");
          const confidence = Number(l.confidence ?? 1.0);
          const extraction = String(l.extraction ?? "unknown");

          if (target) {
            node.links.push({
              target,
              type: relType,
              confidence,
              extraction,
              proposed_by: l.proposed_by as string | undefined,
              governed_by: l.governed_by as string[] | undefined,
              source: l.source as string | undefined,
            });

            data.edges.push({
              from: relPath,
              to: target,
              rel_type: relType,
              confidence,
              extraction,
            });
          }
        }
      }
    }

    data.entities[relPath] = node;
  }

  saveGraph(data);
}

export function queryGraph(opts: {
  fromPath?: string;
  relType?: string;
  toPath?: string;
}): Array<{ from: string; to: string; rel_type: string; confidence: number }> {
  const data = loadGraph();
  return data.edges.filter((e) => {
    if (opts.fromPath && e.from !== opts.fromPath) return false;
    if (opts.toPath && e.to !== opts.toPath) return false;
    if (opts.relType && e.rel_type !== opts.relType) return false;
    return true;
  });
}

export function getGraphStats(): { entities: number; edges: number; byType: Record<string, number> } {
  const data = loadGraph();
  const byType: Record<string, number> = {};
  for (const e of data.edges) {
    byType[e.rel_type] = (byType[e.rel_type] ?? 0) + 1;
  }
  return { entities: Object.keys(data.entities).length, edges: data.edges.length, byType };
}

export function graphExists(): boolean {
  return existsSync(GRAPH_JSON);
}

export function getGraphPath(): string {
  return GRAPH_JSON;
}

export function getGraphData(): GraphData {
  return loadGraph();
}