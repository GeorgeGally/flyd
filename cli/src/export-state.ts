#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync, writeFileSync } from "fs";
import { join } from "path";
import { FLYD_DIR, WIKI_DIR, PLANS_DIR } from "./lib/config.js";
import { loadCaptureDocs, computeAttention } from "./lib/attention.js";
import { loadGoals, computeTension } from "./lib/tension.js";

export const INTELLIGENCE_STATE_VERSION = "1.0";
export const INTELLIGENCE_STATE_PATH = join(FLYD_DIR, "intelligence-state.json");

export interface IntelligenceState {
  version: string;
  generatedAt: string;
  source: "flyd-cli";
  goals: ReturnType<typeof loadGoals>;
  tensions: ReturnType<typeof computeTension>;
  signals: ReturnType<typeof computeAttention>;
  curiosity: Array<{
    question: string;
    findings: string | null;
    missingEvidence: string | null;
    generatedAt: string | null;
  }>;
  nudges: Array<{ date: string | null; text: string }>;
  reports: Array<{ path: string; title: string; updatedAt: string | null; excerpt: string }>;
  recentEvents: Array<{
    path: string;
    date: string;
    topics: string[];
    eventType: string;
    outcome: string | null;
    signal: string | null;
    excerpt: string;
  }>;
}

function parseCuriosity(): IntelligenceState["curiosity"] {
  const path = join(WIKI_DIR, "curiosity-log.md");
  if (!existsSync(path)) return [];

  const content = readFileSync(path, "utf8");
  const sections = content.split(/^### Q: /m).slice(1);
  return sections.slice(-20).map((section) => {
    const [questionLine, ...rest] = section.split("\n");
    const body = rest.join("\n");
    return {
      question: questionLine.trim(),
      findings: body.match(/\*\*Findings:\*\*\s*(.+)/)?.[1]?.trim() ?? null,
      missingEvidence: body.match(/\*\*Missing:\*\*\s*(.+)/)?.[1]?.trim() ?? null,
      generatedAt: body.match(/\*\*Generated:\*\*\s*([^\n|]+)/)?.[1]?.trim() ?? null,
    };
  });
}

function parseNudges(): IntelligenceState["nudges"] {
  const path = join(WIKI_DIR, "nudges.md");
  if (!existsSync(path)) return [];

  const content = readFileSync(path, "utf8");
  let currentDate: string | null = null;
  const nudges: IntelligenceState["nudges"] = [];

  for (const line of content.split("\n")) {
    const date = line.match(/^##\s+(\d{4}-\d{2}-\d{2})/);
    if (date) {
      currentDate = date[1];
      continue;
    }
    if (/^-\s+/.test(line)) nudges.push({ date: currentDate, text: line.replace(/^-\s+/, "").trim() });
  }

  return nudges.slice(-30);
}

function loadReports(): IntelligenceState["reports"] {
  const roots = [WIKI_DIR, PLANS_DIR].filter(existsSync);
  const reports: IntelligenceState["reports"] = [];

  for (const root of roots) {
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
      if (!/(report|plan|summary|status|review)/i.test(entry.name)) continue;

      const path = join(root, entry.name);
      const content = readFileSync(path, "utf8");
      reports.push({
        path,
        title: content.match(/^#\s+(.+)/m)?.[1]?.trim() ?? entry.name.replace(/\.md$/, ""),
        updatedAt: content.match(/(?:updated|date|generated):\s*([^\n]+)/i)?.[1]?.trim() ?? null,
        excerpt: content.replace(/^---[\s\S]*?---\s*/m, "").trim().slice(0, 1200),
      });
    }
  }

  return reports.slice(-20);
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
    goals,
    tensions,
    signals: computeAttention(docs, tensionByTopic).slice(0, 30),
    curiosity: parseCuriosity(),
    nudges: parseNudges(),
    reports: loadReports(),
    recentEvents: docs.slice(0, 50).map((doc) => ({
      path: doc.path,
      date: doc.date,
      topics: doc.topics,
      eventType: doc.eventType,
      outcome: doc.outcome,
      signal: doc.signal,
      excerpt: doc.body.trim().slice(0, 1000),
    })),
  };
}

const state = buildIntelligenceState();
const json = JSON.stringify(state, null, 2);

if (process.argv.includes("--stdout")) {
  process.stdout.write(`${json}\n`);
} else {
  writeFileSync(INTELLIGENCE_STATE_PATH, json, "utf8");
  process.stdout.write(`${INTELLIGENCE_STATE_PATH}\n`);
}
