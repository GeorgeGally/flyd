import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "fs";
import { join } from "path";
import { FLYD_DIR, RAW_DIR, SYNTHESIS_STATE_PATH, defaultModel } from "./config.js";
import { parse, serialize } from "./frontmatter.js";
import { query } from "./llm.js";

interface CaptureInfo {
  path: string;
  timestamp: string;
  body: string;
}

interface ProjectState {
  lastSynthesizedAt: string | null;
  version: number;
}

interface SynthesisState {
  [project: string]: ProjectState;
}

const MIN_NEW_CAPTURES = 5;

function loadState(): SynthesisState {
  if (!existsSync(SYNTHESIS_STATE_PATH)) return {};
  try {
    return JSON.parse(readFileSync(SYNTHESIS_STATE_PATH, "utf8"));
  } catch {
    return {};
  }
}

function saveState(state: SynthesisState): void {
  mkdirSync(FLYD_DIR, { recursive: true });
  writeFileSync(SYNTHESIS_STATE_PATH, JSON.stringify(state, null, 2), "utf8");
}

function getCapturesByProject(): Map<string, CaptureInfo[]> {
  const captures = new Map<string, CaptureInfo[]>();
  if (!existsSync(RAW_DIR)) return captures;

  const files = readdirSync(RAW_DIR).filter((f) => f.endsWith(".md")).sort();

  for (const file of files) {
    try {
      const fullPath = join(RAW_DIR, file);
      const content = readFileSync(fullPath, "utf8");
      const { metadata, body } = parse(content);
      const project = String(metadata.project ?? "unknown");
      const timestamp = String(metadata.timestamp ?? file.replace(/\.md$/, "").replace(/-/g, " "));
      const source = String(metadata.source ?? "");
      const type = String(metadata.type ?? "");

      // Skip synthesis captures — they're output, not input
      if (type === "synthesis" || source === "synthesis") continue;

      if (!captures.has(project)) captures.set(project, []);
      captures.get(project)!.push({ path: file, timestamp, body });
    } catch {
      // skip unreadable
    }
  }

  return captures;
}

function getNewCaptures(project: string, state: ProjectState, allCaptures: CaptureInfo[]): CaptureInfo[] {
  // Use lastSynthesizedAt as the reference point — not lastCaptureFile
  if (!state.lastSynthesizedAt) {
    // First-time: return all captures
    return allCaptures;
  }

  const lastAt = new Date(state.lastSynthesizedAt).getTime();

  return allCaptures.filter((c) => {
    const captureTs = c.timestamp.replace(" ", "T") + "Z";
    const captureTime = new Date(captureTs).getTime();
    // If timestamp is invalid, include the capture (err on inclusion side)
    if (isNaN(captureTime)) return true;
    return captureTime > lastAt;
  });
}

function buildSynthesisPrompt(
  projectName: string,
  projectPath: string,
  version: number,
  newCaptures: CaptureInfo[],
  previousSynthesis: string | null,
): string {
  const captureList = newCaptures
    .map((c) => `[${c.timestamp}]\n${c.body.trim().slice(0, 1000)}`)
    .join("\n\n---\n\n");

  return `You are synthesizing observations from raw captures about a project. Your output will be stored as a high-signal memory entry that retrievers rank highest.

Project: ${projectName}
Project path: ${projectPath}
Previous synthesis exists: ${previousSynthesis ? "YES (v" + (version - 1) + ")" : "NO"}

New captures to synthesize:

${captureList}

${previousSynthesis ? `\nPrevious synthesis (for context only — incorporate if still accurate):\n${previousSynthesis}` : ""}

Produce a dense, factual markdown document. Structure it as:

# ${projectName} — Project Synthesis (v${version})

## What it is
[1-3 sentence summary of what the project does, its tech stack, its audience]

## Architecture
[High-level components, services, key models — what the code structure looks like]

## Key Decisions
[List of decisions visible in the captures, with context and reasoning]

## Recent Activity
[What's been happening recently — what was built, fixed, changed]

## Current State
[Where things stand — what's built, what's in progress, what's planned]

Rules:
- Only state what the captures support. Never fabricate.
- If previous synthesis exists, incorporate its key claims unless directly contradicted by new captures.
- Be declarative. State facts, not narratives.
- If captures are sparse or unclear, say "insufficient captures to determine" for that section.
- Keep it information-dense but readable. Aim for ~500-1500 words.`;
}

function formatSynthesisBody(body: string): string {
  // Strip any existing "# Project Name — Synthesis" header if LLM added one
  return body.replace(/^# [^\n]+— Project Synthesis[^\n]*\n+/, "").trim();
}

export async function synthesizeProject(projectName: string): Promise<boolean> {
  const state = loadState();
  const projectState = state[projectName] ?? { lastSynthesizedAt: null, version: 0 };

  const allCaptures = getCapturesByProject().get(projectName) ?? [];
  if (allCaptures.length === 0) return false;

  const newCaptures = getNewCaptures(projectName, projectState, allCaptures);

  if (newCaptures.length < MIN_NEW_CAPTURES) {
    return false;
  }

  // Find previous synthesis body if it exists (read directly from filesystem, bypassing getCapturesByProject filter)
  let previousSynthesis: string | null = null;
  if (projectState.version > 0 && existsSync(RAW_DIR)) {
    const files = readdirSync(RAW_DIR).filter(f => f.endsWith(".md")).sort();
    const synthFiles: CaptureInfo[] = [];
    for (const file of files) {
      try {
        const content = readFileSync(join(RAW_DIR, file), "utf8");
        const { metadata } = parse(content);
        if (String(metadata.type) === "synthesis" && String(metadata.project) === projectName) {
          synthFiles.push({ path: file, timestamp: String(metadata.timestamp ?? ""), body: content });
        }
      } catch { /* skip */ }
    }
    if (synthFiles.length > 0) {
      const latestSynth = synthFiles[synthFiles.length - 1];
      previousSynthesis = parse(readFileSync(join(RAW_DIR, latestSynth.path), "utf8")).body;
    }
  }

  const projectPath = projectName;

  const nextVersion = projectState.version + 1;
  const prompt = buildSynthesisPrompt(projectName, projectPath, nextVersion, newCaptures, previousSynthesis);

  try {
    const result = await query(prompt, defaultModel());
    const cleanBody = formatSynthesisBody(result);

    const ts = new Date().toISOString().replace("T", " ").slice(0, 19);
    const filename = ts.replace(/[ :]/g, "-") + ".md";

    const synthesizedFrom = newCaptures.map((c) => c.path);

    const metadata = {
      source: "synthesis",
      type: "synthesis",
      project: projectName,
      timestamp: ts,
      synthesized_from: synthesizedFrom,
      synthesis_version: nextVersion,
    };

    const output = serialize(metadata, cleanBody);
    writeFileSync(join(RAW_DIR, filename), output, "utf8");

    // Update state
    state[projectName] = {
      lastSynthesizedAt: ts,
      version: nextVersion,
    };
    saveState(state);

    return true;
  } catch {
    return false;
  }
}

export async function runSynthesis(): Promise<{ synthesized: string[]; skipped: string[] }> {
  const capturesByProject = getCapturesByProject();
  const state = loadState();
  const results = { synthesized: [] as string[], skipped: [] as string[] };

  for (const [project, allCaptures] of capturesByProject) {
    const projectState = state[project] ?? { lastSynthesizedAt: null, version: 0 };

    // First-time synthesis: if project has >=5 captures total, synthesize all of them
    if (projectState.version === 0 && allCaptures.length >= MIN_NEW_CAPTURES) {
      const ok = await synthesizeProject(project);
      if (ok) {
        results.synthesized.push(project);
      } else {
        results.skipped.push(project);
      }
      continue;
    }

    // Subsequent syntheses: only if there are new captures since last run
    const newCaptures = getNewCaptures(project, projectState, allCaptures);
    if (newCaptures.length < MIN_NEW_CAPTURES) {
      results.skipped.push(project);
      continue;
    }

    const ok = await synthesizeProject(project);
    if (ok) {
      results.synthesized.push(project);
    } else {
      results.skipped.push(project);
    }
  }

  return results;
}