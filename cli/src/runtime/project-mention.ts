import { basename } from "node:path";
import { execFileSync } from "node:child_process";
import { displayAliasesFor, displayName } from "../work/work-hypothesis/candidates.js";
import type { BriefRepo } from "./repo-registry.js";

/** Only explicit project-status asks — not meta questions that name Flyd in passing. */
const NEEDS_QUESTION =
  /\b(?:what\s+needs\s+to\s+be\s+done|where\s+(?:are\s+we|do\s+(?:i|we)\s+stand)|(?:status|next\s+(?:move|step|action))\s+(?:of|on|for)|what\s+should\s+(?:i|we)\s+(?:do|work\s+on)\s+(?:on|for|with|in))\b/i;

const META_QUESTION =
  /\bwhat does (?:this|that|it)\b|\bwhat does .{0,120} mean\b|^["'].{10,}["']\s*$/i;

const PROJECT_FOCUS =
  /\b(?:on|for|about|in|with)\s+([A-Za-z0-9][\w .()-]{0,40}[A-Za-z0-9)])\s*\??\s*$/i;

export interface MentionedProject {
  repo: BriefRepo;
  label: string;
}

export function isProjectNeedsQuestion(message: string): boolean {
  const trimmed = message.trim();
  if (!trimmed || META_QUESTION.test(trimmed)) return false;
  if (!NEEDS_QUESTION.test(trimmed)) return false;
  return Boolean(PROJECT_FOCUS.test(trimmed) || /\bon\s+[A-Za-z]/i.test(trimmed));
}

/** Resolve a named project in the message against scanned Documents/git repos. */
export function resolveMentionedProject(
  message: string,
  repos: BriefRepo[],
): MentionedProject | null {
  if (!repos.length) return null;
  const text = message.toLowerCase();
  const focus = message.match(PROJECT_FOCUS)?.[1]?.toLowerCase().trim();

  let best: MentionedProject | null = null;
  let bestScore = 0;

  for (const repo of repos) {
    const label = displayName(repo.name);
    const aliases = [
      ...displayAliasesFor(repo.name),
      basename(repo.root).toLowerCase(),
      ...displayAliasesFor(basename(repo.root)),
    ];
    for (const alias of aliases) {
      if (alias.length < 2) continue;
      if (focus) {
        const focusKey = focus.replace(/[()]/g, "").trim();
        if (!focusKey.includes(alias) && !alias.includes(focusKey) && focusKey !== alias) {
          continue;
        }
      }
      const re = new RegExp(`(?:^|[^a-z0-9])${escapeRegExp(alias)}(?:[^a-z0-9]|$)`, "i");
      if (!re.test(text)) continue;
      const score = alias.length + (focus ? 100 : 0);
      if (score > bestScore) {
        bestScore = score;
        best = { repo, label };
      }
    }
  }

  return best;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export interface ProjectGitSnapshot {
  lastSubject: string | null;
  lastRelative: string | null;
  dirtyCount: number;
  dirtyPaths: string[];
}

export function snapshotProjectGit(root: string): ProjectGitSnapshot {
  let lastSubject: string | null = null;
  let lastRelative: string | null = null;
  let dirtyPaths: string[] = [];
  try {
    lastSubject = execFileSync(
      "git",
      ["-C", root, "log", "-1", "--pretty=%s"],
      { encoding: "utf8", timeout: 3000, stdio: ["ignore", "pipe", "ignore"] },
    ).trim() || null;
  } catch {
    // ignore
  }
  try {
    lastRelative = execFileSync(
      "git",
      ["-C", root, "log", "-1", "--pretty=%cr"],
      { encoding: "utf8", timeout: 3000, stdio: ["ignore", "pipe", "ignore"] },
    ).trim() || null;
  } catch {
    // ignore
  }
  try {
    const status = execFileSync(
      "git",
      ["-C", root, "status", "--porcelain"],
      { encoding: "utf8", timeout: 3000, stdio: ["ignore", "pipe", "ignore"] },
    ).trim();
    if (status) {
      dirtyPaths = status
        .split("\n")
        .map((line) => line.slice(3).trim())
        .filter(Boolean);
    }
  } catch {
    // ignore
  }
  return {
    lastSubject,
    lastRelative,
    dirtyCount: dirtyPaths.length,
    dirtyPaths,
  };
}

function summarizeAreas(paths: string[]): string {
  const areas = new Set<string>();
  for (const path of paths.slice(0, 40)) {
    const top = path.split("/")[0]?.replace(/\s+\(.*\)$/, "") ?? path;
    if (top) areas.add(top);
  }
  const list = [...areas].slice(0, 4);
  if (!list.length) return "several files";
  if (list.length === 1) return list[0];
  if (list.length === 2) return `${list[0]} and ${list[1]}`;
  return `${list.slice(0, -1).join(", ")}, and ${list[list.length - 1]}`;
}

function stripConventional(subject: string): string {
  return subject.replace(
    /^(?:feat|fix|docs|chore|refactor|test|style|perf)(?:\([^)]+\))?:\s*/i,
    "",
  ).trim();
}

/** Spoken PA answer from live git — not from the to-do list alone. */
export function formatProjectNeedsReply(
  mention: MentionedProject,
  snap: ProjectGitSnapshot = snapshotProjectGit(mention.repo.root),
): string {
  const name = mention.label.replace(/\s*\([^)]+\)\s*$/, "").trim() || mention.label;
  const parts: string[] = [];

  if (snap.lastSubject && snap.lastRelative) {
    parts.push(
      `${name} last moved ${snap.lastRelative} — ${stripConventional(snap.lastSubject)}.`,
    );
  } else if (snap.lastRelative) {
    parts.push(`${name} last moved ${snap.lastRelative}.`);
  } else {
    parts.push(`${name} is at ${mention.repo.root}.`);
  }

  if (snap.dirtyCount > 0) {
    parts.push(
      `Working tree still has uncommitted work across ${summarizeAreas(snap.dirtyPaths)}.`,
    );
    parts.push("Next move: finish or park that dirty tree before starting something new.");
  } else if (snap.lastSubject) {
    parts.push(`Working tree is clean. Next move: continue from “${stripConventional(snap.lastSubject)},” or say what you want next.`);
  } else {
    parts.push("I can see the repo, but there isn't enough git history yet to name a next move.");
  }

  return parts.join(" ");
}
