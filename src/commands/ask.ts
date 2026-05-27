import { execSync } from "child_process";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { hasApiKey, defaultModel, WIKI_DIR, CONTEXT_DIR } from "../lib/config.js";
import { parse } from "../lib/frontmatter.js";
import { query } from "../lib/llm.js";

type RetrievalStatus = "governed" | "context-bundle" | "uncertain" | "none";

interface RetrievedEntry {
  path: string;
  body: string;
  score: number;
  status: RetrievalStatus;
  metadata: Record<string, unknown>;
}

const QMD_WIKI_COLLECTION = "flyd-wiki";
const QMD_CONTEXT_COLLECTION = "flyd-context";
const EXCLUDED_STATUSES = new Set(["rejected", "dormant"]);

function qmdAvailable(): boolean {
  try {
    execSync("which qmd", { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

const STOP_WORDS = new Set([
  "a","an","the","and","or","but","in","on","at","to","for","of","with",
  "is","are","was","were","be","been","have","has","had","do","did","does",
  "i","my","me","you","your","what","where","when","how","why","who","which",
  "about","from","that","this","it","its","not","can","will","would","could",
  "should","there","their","they","them","by","as","so","if","up","out",
]);

function extractKeywords(question: string): string {
  return question
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w))
    .join(" ");
}

function runQmdSearch(question: string, collection: string): string {
  // Phase 2: hybrid query with embeddings + reranking.
  // qmd query exits 134 (SIGABRT) on Metal GPUs at process exit but stdout is valid.
  try {
    return execSync(
      `qmd query ${JSON.stringify(question)} --collection ${collection}`,
      { stdio: "pipe", encoding: "utf8" }
    );
  } catch (err: unknown) {
    const e = err as NodeJS.ErrnoException & { status?: number; stdout?: string };
    if (e.status === 134) {
      const stdout = e.stdout ?? "";
      if (stdout.includes("qmd://")) return stdout;
    }
  }

  // Phase 1 fallback: BM25 keyword search (no models needed)
  const keywords = extractKeywords(question);
  if (!keywords) return "";
  try {
    return execSync(
      `qmd search ${JSON.stringify(keywords)} --collection ${collection}`,
      { stdio: "pipe", encoding: "utf8" }
    );
  } catch {
    return "";
  }
}

function parseQmdResults(raw: string, status: RetrievalStatus): RetrievedEntry[] {
  if (!raw.trim()) return [];

  const entries: RetrievedEntry[] = [];
  const blocks = raw.split(/\n(?=qmd:\/\/)/);

  for (const block of blocks) {
    const pathMatch = block.match(/^qmd:\/\/[^/]+\/(.+?):\d+/);
    if (!pathMatch) continue;
    const relPath = pathMatch[1];
    if (relPath === "rejected.md" || relPath === "index.md") continue;

    const scoreMatch = block.match(/Score:\s+(\d+)%/);
    const score = scoreMatch ? parseInt(scoreMatch[1], 10) : 0;

    // Resolve full path
    const baseDir = status === "context-bundle" ? CONTEXT_DIR : WIKI_DIR;
    const fullPath = join(baseDir, relPath);

    let metadata: Record<string, unknown> = {};
    let body = block;

    if (existsSync(fullPath)) {
      const content = readFileSync(fullPath, "utf8");
      const parsed = parse(content);
      metadata = parsed.metadata;
      body = parsed.body;

      // Read gate: filter out rejected/dormant
      const entryStatus = String(metadata.status ?? "").toLowerCase();
      if (EXCLUDED_STATUSES.has(entryStatus)) continue;
    }

    entries.push({ path: relPath, body, score, status, metadata });
  }

  return entries;
}

function readGate(entries: RetrievedEntry[]): RetrievedEntry[] {
  return entries.filter((e) => {
    const s = String(e.metadata.status ?? "").toLowerCase();
    return !EXCLUDED_STATUSES.has(s);
  });
}

function determineOverallStatus(entries: RetrievedEntry[]): RetrievalStatus {
  if (!entries.length) return "none";
  const statuses = new Set(entries.map((e) => e.status));
  if (statuses.has("governed") && !statuses.has("context-bundle")) return "governed";
  if (statuses.has("context-bundle") && !statuses.has("governed")) return "uncertain";
  return "governed";
}

function buildPrompt(question: string, entries: RetrievedEntry[]): string {
  const evidence = entries
    .map((e) => {
      const label = e.status === "governed" ? "[governed]" : "[context-bundle]";
      const epStatus = e.metadata.status ? ` (${e.metadata.status})` : "";
      return `${label}${epStatus} ${e.path}\n${e.body.trim()}`;
    })
    .join("\n\n---\n\n");

  return `You are a personal knowledge query engine. Answer using only the evidence below.
Be specific. Cite the source path for each claim. Note epistemic status (canon/working/speculative) where relevant.
If evidence is incomplete or uncertain, say so explicitly.

## Evidence
${evidence}

## Question
${question}`;
}

function formatEvidence(entries: RetrievedEntry[]): string {
  return entries
    .map((e) => {
      const label = e.status === "governed" ? "[governed]" : "[context-bundle]";
      const epStatus = e.metadata.status ? ` status=${e.metadata.status}` : "";
      return `${label}${epStatus} ${e.path} (score=${e.score}%)`;
    })
    .join("\n");
}

export async function runAsk(question: string, model?: string): Promise<void> {
  const m = model ?? defaultModel();

  if (!qmdAvailable()) {
    console.error("qmd not found — run: npm install -g @tobilu/qmd && qmd collection add ~/.flyd/wiki --name flyd-wiki");
    process.exit(1);
  }

  // Phase 1: search governed wiki (BM25)
  const wikiRaw = runQmdSearch(question, QMD_WIKI_COLLECTION);
  let entries = readGate(parseQmdResults(wikiRaw, "governed"));

  // Phase 2: if sparse, boost with context bundles
  if (entries.length < 2) {
    const ctxRaw = runQmdSearch(question, QMD_CONTEXT_COLLECTION);
    const ctxEntries = readGate(parseQmdResults(ctxRaw, "context-bundle"));
    entries = [...entries, ...ctxEntries];
  }

  if (!entries.length) {
    console.log("no governed context found");
    return;
  }

  const overallStatus = determineOverallStatus(entries);
  const evidenceSummary = formatEvidence(entries);

  // No API key — return raw evidence bundle
  if (!hasApiKey(m)) {
    console.log(`status: ${overallStatus}\n\nevidence:\n${evidenceSummary}`);
    return;
  }

  const answer = await query(buildPrompt(question, entries), m);

  console.log(answer);
  console.log(`\n---\nstatus: ${overallStatus}`);
  console.log(`evidence:\n${evidenceSummary}`);
}
