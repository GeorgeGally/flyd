import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from "fs";
import { join } from "path";
import { FLYD_DIR, WIKI_DIR, RAW_DIR } from "./config.js";
import { parse } from "./frontmatter.js";
import { walkWikiFiles } from "./wiki.js";
import { extractEntitiesBatch, type EntityTriple } from "./entity-extractor.js";

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

export interface BodyEdge {
  from: string;
  to: string;
  rel_type: string;
  confidence: number;
  extraction?: string;
  source: "frontmatter" | "body-extraction";
}

interface GraphData {
  version: number;
  built: string;
  entities: Record<string, GraphNode>;
  edges: BodyEdge[];
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

export async function enrichGraph(): Promise<{ triplesAdded: number; entitiesFound: number }> {
  const data = loadGraph();
  const existingEdges = new Set(data.edges.map(e => `${e.from}|${e.to}|${e.rel_type}`));
  let triplesAdded = 0;
  let entitiesFound = 0;

  const toProcess: Array<{ path: string; body: string }> = [];

  // Collect raw captures
  if (existsSync(RAW_DIR)) {
    const rawFiles = readdirSync(RAW_DIR).filter(f => f.endsWith(".md")).sort().slice(-100);
    for (const f of rawFiles) {
      const fullPath = join(RAW_DIR, f);
      try {
        const content = readFileSync(fullPath, "utf8");
        const { body } = parse(content);
        if (body.trim().length >= 100) {
          toProcess.push({ path: `raw/${f}`, body: body.slice(0, 2000) });
        }
      } catch { /* skip unreadable */ }
    }
  }

  // Collect wiki pages
  if (existsSync(WIKI_DIR)) {
    const wikiFiles = walkWikiFiles();
    for (const f of wikiFiles) {
      try {
        const content = readFileSync(f, "utf8");
        const { body } = parse(content);
        if (body.trim().length >= 100) {
          const rel = f.replace(WIKI_DIR + "/", "");
          toProcess.push({ path: rel, body: body.slice(0, 2000) });
        }
      } catch { /* skip unreadable */ }
    }
  }

  if (toProcess.length === 0) return { triplesAdded: 0, entitiesFound: 0 };

  const results = await extractEntitiesBatch(toProcess);

  for (const [path, extracted] of results) {
    entitiesFound += extracted.entities.length;

    for (const triple of extracted.triples) {
      const fromSlug = path.replace(/\.md$/, "").toLowerCase();
      const toSlug = triple.object.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 60);

      const edgeKey = `${fromSlug}|${toSlug}|${triple.predicate}`;
      if (existingEdges.has(edgeKey)) continue;

      data.edges.push({
        from: fromSlug,
        to: toSlug,
        rel_type: triple.predicate,
        confidence: triple.confidence,
        source: "body-extraction",
      });
      existingEdges.add(edgeKey);
      triplesAdded++;
    }
  }

  // Ensure node entries exist for all edge references
  for (const edge of data.edges) {
    if (edge.source === "body-extraction") {
      if (!data.entities[edge.from]) {
        data.entities[edge.from] = {
          path: edge.from,
          type: "body-derived",
          lastUpdated: new Date().toISOString().split("T")[0],
          links: [],
        };
      }
      if (!data.entities[edge.to]) {
        data.entities[edge.to] = {
          path: edge.to,
          type: "body-derived",
          lastUpdated: new Date().toISOString().split("T")[0],
          links: [],
        };
      }
    }
  }

  data.built = new Date().toISOString();
  data.version = 2;
  saveGraph(data);

  return { triplesAdded, entitiesFound };
}

export function searchGraph(
  query: string,
  maxHops = 2,
): Array<{ from: string; to: string; rel_type: string; confidence: number; source: string }> {
  const data = loadGraph();
  const queryLower = query.toLowerCase();
  const queryTerms = queryLower.split(/\s+/).filter(w => w.length > 3);

  // Find matching start nodes
  const startNodes = new Set<string>();
  for (const [path] of Object.entries(data.entities)) {
    const pathLower = path.toLowerCase();
    if (queryTerms.some(t => pathLower.includes(t))) {
      startNodes.add(path);
    }
  }
  for (const edge of data.edges) {
    if (queryTerms.some(t => edge.rel_type.toLowerCase().includes(t))) {
      startNodes.add(edge.from);
      startNodes.add(edge.to);
    }
  }

  if (startNodes.size === 0) return [];

  // BFS traversal
  const visited = new Set<string>();
  const results: Array<{ from: string; to: string; rel_type: string; confidence: number; source: string }> = [];
  let frontier = [...startNodes];

  for (let hop = 0; hop < maxHops && frontier.length > 0; hop++) {
    const nextFrontier: string[] = [];
    for (const node of frontier) {
      if (visited.has(node)) continue;
      visited.add(node);

      for (const edge of data.edges) {
        if (edge.from === node && !visited.has(edge.to)) {
          results.push(edge);
          if (hop < maxHops - 1) nextFrontier.push(edge.to);
        }
        if (edge.to === node && !visited.has(edge.from)) {
          results.push(edge);
          if (hop < maxHops - 1) nextFrontier.push(edge.from);
        }
      }
    }
    frontier = nextFrontier;
  }

  return results;
}

export function getRelatedNodes(path: string): Array<{ node: string; rel_type: string; confidence: number }> {
  const data = loadGraph();
  const results: Array<{ node: string; rel_type: string; confidence: number }> = [];

  for (const edge of data.edges) {
    if (edge.from === path) {
      results.push({ node: edge.to, rel_type: edge.rel_type, confidence: edge.confidence });
    }
    if (edge.to === path) {
      results.push({ node: edge.from, rel_type: edge.rel_type, confidence: edge.confidence });
    }
  }

  return results.sort((a, b) => b.confidence - a.confidence);
}

export function appendToGraph(file: string): void {
  const data = loadGraph();
  const relPath = file.replace(WIKI_DIR + "/", "");

  const content = readFileSync(file, "utf8");
  const { metadata } = parse(content);

  const node: GraphNode = {
    path: relPath,
    type: String(metadata.type ?? "unknown"),
    lastUpdated: metadata.last_confirmed
      ? String(metadata.last_confirmed)
      : new Date().toISOString().split("T")[0],
    links: [],
  };

  // Remove stale edges for this file before appending fresh ones
  data.edges = data.edges.filter((e) => e.from !== relPath);

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
            source: "frontmatter",
          });
        }
      }
    }
  }

  data.entities[relPath] = node;
  data.built = new Date().toISOString();
  saveGraph(data);
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
              source: "frontmatter",
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

export function getGraphStats(): { entities: number; edges: number; bodyEdges: number; frontmatterEdges: number; byType: Record<string, number> } {
  const data = loadGraph();
  const byType: Record<string, number> = {};
  let bodyEdges = 0;
  let frontmatterEdges = 0;
  for (const e of data.edges) {
    byType[e.rel_type] = (byType[e.rel_type] ?? 0) + 1;
    if (e.source === "body-extraction") bodyEdges++;
    else frontmatterEdges++;
  }
  return { entities: Object.keys(data.entities).length, edges: data.edges.length, bodyEdges, frontmatterEdges, byType };
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

export function pushGraphEdge(edge: BodyEdge): void {
  const data = loadGraph();
  data.edges.push(edge);
  data.built = new Date().toISOString();
  saveGraph(data);
}