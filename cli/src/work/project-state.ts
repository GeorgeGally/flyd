import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";

export interface ProjectState {
  purpose: string;
  currentObjective: string;
  currentState: string;
  activeThreads: string[];
  openLoops: string[];
  blockers: string[];
  importantRecentDecisions: string[];
  nextLikelyActions: string[];
  lastMeaningfulUpdate: string;
}

export interface AgentHandoff {
  projectId: string;
  objective: string;
  completed: string[];
  decisions: string[];
  verification: string[];
  openLoops: string[];
  suggestedNextActions: string[];
  evidenceRefs: string[];
}

function emptyState(): ProjectState {
  return {
    purpose: "",
    currentObjective: "",
    currentState: "",
    activeThreads: [],
    openLoops: [],
    blockers: [],
    importantRecentDecisions: [],
    nextLikelyActions: [],
    lastMeaningfulUpdate: "",
  };
}

const SECTION_HEADERS: Record<string, keyof ProjectState> = {
  "purpose": "purpose",
  "current objective": "currentObjective",
  "current state": "currentState",
  "active threads": "activeThreads",
  "open loops": "openLoops",
  "blockers": "blockers",
  "important recent decisions": "importantRecentDecisions",
  "next likely actions": "nextLikelyActions",
  "last meaningful update": "lastMeaningfulUpdate",
};

const LIST_SECTIONS = new Set<keyof ProjectState>([
  "activeThreads", "openLoops", "blockers",
  "importantRecentDecisions", "nextLikelyActions",
]);

export function readProjectState(root: string): ProjectState {
  const path = join(root, "PROJECT.md");
  if (!existsSync(path)) return emptyState();

  const content = readFileSync(path, "utf8");
  return parseProjectMd(content);
}

export function parseProjectMd(content: string): ProjectState {
  const state = emptyState();
  const lines = content.split("\n");
  let currentSection: keyof ProjectState | null = null;
  let currentText = "";

  function flushSection(): void {
    if (!currentSection) return;
    if (LIST_SECTIONS.has(currentSection)) {
      const items = parseBulletList(currentText);
      (state as unknown as Record<string, unknown>)[currentSection] = items;
    } else {
      (state as unknown as Record<string, unknown>)[currentSection] = currentText.trim();
    }
  }

  for (const line of lines) {
    const headerMatch = line.match(/^##\s+(.+)/i);
    if (headerMatch) {
      flushSection();
      const label = headerMatch[1].trim().toLowerCase();
      currentSection = SECTION_HEADERS[label] ?? null;
      currentText = "";
      continue;
    }

    if (line.match(/^#\s+/)) {
      flushSection();
      currentSection = null;
      currentText = "";
      continue;
    }

    if (currentSection) {
      currentText += line + "\n";
    }
  }

  flushSection();
  return state;
}

function parseBulletList(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("-") || line.startsWith("*"))
    .map((line) => line.replace(/^[-*]\s+/, "").trim())
    .filter((item) => item.length > 0);
}

export function writeProjectState(root: string, state: ProjectState): void {
  const lines: string[] = [];
  lines.push("# Project");
  lines.push("");

  const sections: Array<{ key: keyof ProjectState; label: string }> = [
    { key: "purpose", label: "Purpose" },
    { key: "currentObjective", label: "Current objective" },
    { key: "currentState", label: "Current state" },
    { key: "activeThreads", label: "Active threads" },
    { key: "openLoops", label: "Open loops" },
    { key: "blockers", label: "Blockers" },
    { key: "importantRecentDecisions", label: "Important recent decisions" },
    { key: "nextLikelyActions", label: "Next likely actions" },
    { key: "lastMeaningfulUpdate", label: "Last meaningful update" },
  ];

  for (const { key, label } of sections) {
    lines.push(`## ${label}`);
    lines.push("");
    const value = state[key];
    if (Array.isArray(value)) {
      if (value.length === 0) {
        lines.push("");
      } else {
        for (const item of value) {
          lines.push(`- ${item}`);
        }
      }
    } else {
      lines.push(value || "");
    }
    lines.push("");
  }

  writeFileSync(join(root, "PROJECT.md"), lines.join("\n").trimEnd() + "\n", "utf8");
}
