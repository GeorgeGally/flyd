#!/usr/bin/env node
import { createHash } from "crypto";
import { existsSync, readFileSync, readdirSync, renameSync, writeFileSync } from "fs";
import { basename, join, relative } from "path";
import { pathToFileURL } from "url";
import { FLYD_DIR, WIKI_DIR, PLANS_DIR } from "./lib/config.js";
import { loadCaptureDocs, computeAttention } from "./lib/attention.js";
import { loadGoals, computeTension } from "./lib/tension.js";

export const INTELLIGENCE_STATE_VERSION = "1.0";
export const INTELLIGENCE_STATE_PATH = join(FLYD_DIR, "intelligence-state.json");

export type EpistemicStatus =
  | "observation"
  | "user_confirmed"
  | "inferred"
  | "heuristic"
  | "llm_generated"
  | "contradicted"
  | "superseded";

export interface Evidence<T extends Record<string, unknown> = Record<string, unknown>> {
  id: string;
  type: string;
  source: string;
  epistemicStatus: EpistemicStatus;
  confidence: number;
  generatedAt: string | null;
  updatedAt?: string | null;
  evidenceRefs: string[];
  content: T;
}

export interface IntelligenceState {
  version: "1.0";
  generatedAt: string;
  source: "flyd-cli";
  goals: Evidence[];
  tensions: Evidence[];
  signals: Evidence[];
  curiosity: Evidence[];
  nudges: Evidence[];
  reports: Evidence[];
  recentEvents: Evidence[];
}

function stableId(type: string, value: unknown): string {
  const digest = createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16);
  return `${type}:${digest}`;
}

function evidence<T extends Record<string, unknown>>(
  type: string,
  source: string,
  epistemicStatus: EpistemicStatus,
  confidence: number,
  content: T,
  generatedAt: string | null = null,
  evidenceRefs: string[] = []
): Evidence<T> {
  return {
    id: stableId(type, content),
    type,
    source,
    epistemicStatus,
    confidence,
    generatedAt,
    evidenceRefs,
    content,
  };
}

function parseCuriosity(): Evidence[] {
  const path = join(WIKI_DIR, "curiosity-log.md");
  if (!existsSync(path)) return [];

  const content = readFileSync(path, "utf8");
  return content.split(/^### Q: /m).slice(1).slice(-20).map((section) => {
    const [questionLine, ...rest] = section.split("\n");
    const body = rest.join("\n");
    const generatedAt = body.match(/\*\*Generated:\*\*\s*([^\n|]+)/)?.[1]?.trim() ?? null;
    return evidence(
      "curiosity",
      "cli.curiosity",
      "llm_generated",
      0.5,
      {
        question: questionLine.trim(),
        findings: body.match(/\*\*Findings:\*\*\s*(.+)/)?.[1]?.trim() ?? null,
        missingEvidence: body.match(/\*\*Missing:\*\*\s*(.+)/)?.[1]?.trim() ?? null,
      },
      generatedAt
    );
  });
}

function parseNudges(): Evidence[] {
  const path = join(WIKI_DIR, "nudges.md");
  if (!existsSync(path)) return [];

  let currentDate: string | null = null;
  const nudges: Evidence[] = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const date = line.match(/^##\s+(\d{4}-\d{2}-\d{2})/);
    if (date) {
      currentDate = date[1];
      continue;
    }
    if (/^-\s+/.test(line)) {
      nudges.push(evidence("nudge", "cli.nudges", "llm_generated", 0.45, {
        date: currentDate,
        text: line.replace(/^-\s+/, "").trim(),
      }, currentDate));
    }
  }
  return nudges.slice(-30);
}

function markdownFiles(root: string): string[] {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    return entry.isDirectory() ? markdownFiles(path) : entry.isFile() && entry.name.endsWith(".md") ? [path] : [];
  });
}

function portablePath(path: string): string {
  return relative(FLYD_DIR, path).replaceAll("\\", "/");
}

function loadReports(): Evidence[] {
  const paths = [WIKI_DIR, PLANS_DIR]
    .flatMap(markdownFiles)
    .filter((path) => /(report|plan|summary|status|review)/i.test(basename(path)));

  return paths.slice(-20).map((path) => {
    const content = readFileSync(path, "utf8");
    const updatedAt = content.match(/(?:updated|date|generated):\s*([^\n]+)/i)?.[1]?.trim() ?? null;
    return evidence("report", "cli.reports", "observation", 0.8, {
      path: portablePath(path),
      title: content.match(/^#\s+(.+)/m)?.[1]?.trim() ?? basename(path).replace(/\.md$/, ""),
      excerpt: content.replace(/^---[\s\S]*?---\s*/m, "").trim().slice(0, 1200),
    }, updatedAt);
  });
}

export function buildIntelligenceState(): IntelligenceState {
  const docs = loadCaptureDocs();
  const goals = loadGoals();
  const tensions = computeTension(goals, docs);
  const tensionByTopic = Object.fromEntries(
    tensions.flatMap((entry) => entry.goal.topics.map((topic) => [topic, entry.tension]))
  );

  return {
    version: INTELLIGENCE_STATE_VERSION,
    generatedAt: new Date().toISOString(),
    source: "flyd-cli",
    goals: goals.map((goal) => evidence("goal", "cli.goals", "user_confirmed", 0.9, goal as unknown as Record<string, unknown>)),
    tensions: tensions.map((tension) => evidence("tension", "cli.tension", "heuristic", 0.65, tension as unknown as Record<string, unknown>)),
    signals: computeAttention(docs, tensionByTopic).slice(0, 30).map((signal) =>
      evidence("signal", "cli.attention", "heuristic", 0.55, signal as unknown as Record<string, unknown>)
    ),
    curiosity: parseCuriosity(),
    nudges: parseNudges(),
    reports: loadReports(),
    recentEvents: docs.slice(0, 50).map((doc) => evidence("event", "cli.capture", "observation", 0.8, {
      path: portablePath(doc.path),
      date: doc.date,
      topics: doc.topics,
      eventType: doc.eventType,
      outcome: doc.outcome,
      signal: doc.signal,
      excerpt: doc.body.trim().slice(0, 1000),
    }, doc.date)),
  };
}

export function serializeIntelligenceState(state: IntelligenceState): string {
  return JSON.stringify(state, null, 2);
}

export function writeIntelligenceState(state: IntelligenceState, outputPath = INTELLIGENCE_STATE_PATH): void {
  const temporaryPath = `${outputPath}.tmp`;
  writeFileSync(temporaryPath, serializeIntelligenceState(state), "utf8");
  renameSync(temporaryPath, outputPath);
}

export function runExport(args = process.argv): void {
  const state = buildIntelligenceState();
  const json = serializeIntelligenceState(state);

  if (args.includes("--stdout")) {
    process.stdout.write(`${json}\n`);
    return;
  }

  writeIntelligenceState(state);
  process.stdout.write(`${INTELLIGENCE_STATE_PATH}\n`);
}

const invokedPath = process.argv[1];
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
  runExport();
}
