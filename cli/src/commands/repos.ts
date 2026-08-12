import { execSync } from "child_process";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { resolve, basename, join } from "path";
import {
  listRepositories,
  registerDiscoveredRepos,
  addRepository,
  removeRepository,
  refreshRepositoryFileFlags,
} from "../work/repository-registry.js";
import { observeAndRecord } from "../work/git-observer.js";
import type { ManagedRepository } from "../work/repository-registry.js";
import { readProjectState, writeProjectState } from "../work/project-state.js";
import type { ProjectState } from "../work/project-state.js";
import { reconcileProject, detectProjectMdDrift } from "../work/project-reconciler.js";
import { extractTasksFromProject } from "../work/task-extractor.js";
import { observeRepository } from "../work/git-observer.js";

function formatRepoRow(repo: ManagedRepository, detailed = false): string {
  const projectStatus = repo.projectFileExists ? "PROJECT ✓" : "PROJECT !";
  const agentsStatus = repo.agentsFileExists ? "AGENTS ✓" : "AGENTS !";
  const status = repo.enabled ? "active" : "dormant";
  const activity = repo.lastActivityAt ? `last seen ${timeAgo(repo.lastActivityAt)}` : "never seen";

  let line = `${repo.name.padEnd(18)} ${status.padEnd(7)} ${activity.padEnd(16)} ${projectStatus.padEnd(12)} ${agentsStatus}`;

  if (detailed) {
    line += `\n  root: ${repo.root}`;
    if (repo.remoteUrl) line += `\n  remote: ${repo.remoteUrl}`;
    if (repo.lastSeenHead) line += `\n  head: ${repo.lastSeenHead.slice(0, 8)}`;
    if (repo.lastIndexedHead) line += `\n  indexed: ${repo.lastIndexedHead.slice(0, 8)}`;
  }

  return line;
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export async function runReposList(): Promise<void> {
  const repos = listRepositories();
  if (repos.length === 0) {
    console.log("No repositories registered. Run 'flyd repos refresh' to discover them.");
    return;
  }
  for (const repo of repos) {
    console.log(formatRepoRow(repo));
  }
}

export async function runReposAdd(target: string, name?: string): Promise<void> {
  const root = resolve(target);
  if (!existsSync(root)) {
    console.error(`Directory not found: ${root}`);
    process.exitCode = 1;
    return;
  }
  const gitDir = `${root}/.git`;
  if (!existsSync(gitDir)) {
    console.error(`Not a git repository: ${root}`);
    process.exitCode = 1;
    return;
  }

  const repo = addRepository(root, name);
  console.log(`Added: ${repo.name} (${repo.root})`);
}

export async function runReposRemove(id: string): Promise<void> {
  const removed = removeRepository(id);
  if (removed) {
    console.log(`Removed: ${id}`);
  } else {
    console.error(`Repository not found: ${id}`);
    process.exitCode = 1;
  }
}

export async function runReposRefresh(): Promise<void> {
  const { added, existing } = registerDiscoveredRepos();
  console.log(`Discovered: ${added} new, ${existing} existing`);

  const repos = listRepositories();
  for (const repo of repos) {
    if (!repo.enabled) continue;
    try {
      const snapshot = observeAndRecord(repo.id);
      const dirtyMark = snapshot.dirty ? ` [${snapshot.uncommittedFiles} files dirty]` : "";

      // ponytail: sync tasks from PROJECT.md on refresh
      if (repo.projectFileExists) {
        try {
          const extraction = extractTasksFromProject(repo.id, repo.root);
          const taskCount = extraction.extracted.length;
          if (taskCount > 0 || extraction.nowDone.length > 0) {
            const doneInfo = extraction.nowDone.length > 0 ? `, ${extraction.nowDone.length} resolved` : "";
            console.log(`    tasks: ${taskCount} open${doneInfo}`);
          }
        } catch { /* non-fatal */ }
      }

      console.log(
        `  ${snapshot.name.padEnd(18)} ${snapshot.branch ?? "?"} ${(snapshot.head ?? "").slice(0, 8)}${dirtyMark}`,
      );
    } catch {
      console.log(`  ${repo.name.padEnd(18)} (inaccessible)`);
    }
  }
}

export async function runDoctorRepos(): Promise<void> {
  const repos = listRepositories();
  const issues: string[] = [];

  for (const repo of repos) {
    if (!repo.projectFileExists) issues.push(`Missing PROJECT.md in ${repo.name} (${repo.root})`);
    if (!repo.agentsFileExists) issues.push(`Missing AGENTS.md protocol in ${repo.name} (${repo.root})`);
    if (!repo.lastSeenHead) issues.push(`No HEAD observation for ${repo.name}`);
    if (repo.lastIndexedHead && repo.lastSeenHead && repo.lastIndexedHead !== repo.lastSeenHead) {
      issues.push(`Stale index for ${repo.name} (indexed behind HEAD)`);
    }

    // Stale-state: PROJECT.md vs git reality
    if (repo.projectFileExists && repo.lastSeenHead) {
      try {
        const obs = observeRepository(repo.root, repo.id);
        const drift = detectProjectMdDrift(repo.root);
        for (const d of drift) {
          issues.push(`${repo.name}: PROJECT.md ${d}`);
        }

        // ponytail: if git shows recent commits but PROJECT.md hasn't been updated
        if (obs.commitsSinceLastIndex.length > 0 && repo.lastIndexedHead && repo.lastIndexedHead !== repo.lastSeenHead) {
          issues.push(`${repo.name}: ${obs.commitsSinceLastIndex.length} new commits not reflected in PROJECT.md`);
        }
      } catch { /* repo may be inaccessible */ }
    }
  }

  if (issues.length === 0) {
    console.log("All managed repositories are healthy.");
  } else {
    console.log(`Found ${issues.length} issue(s):`);
    for (const issue of issues) {
      console.log(`  - ${issue}`);
    }
  }
}

export async function runReposPrepare(target?: string): Promise<void> {
  const { registerDiscoveredRepos } = await import("../work/repository-registry.js");
  registerDiscoveredRepos();

  const reposList = target
    ? [{ root: resolve(target), name: basename(resolve(target)), id: basename(resolve(target)) }]
    : listRepositories().map((r) => ({ root: r.root, name: r.name, id: r.id }));

  let updated = 0;

  for (const { root, name, id } of reposList) {
    const resolved = resolve(root);
    console.log(`\n${name} (${resolved})`);

    // Add AGENTS.md continuity section
    const agentsPath = join(resolved, "AGENTS.md");
    if (existsSync(agentsPath)) {
      const content = readFileSync(agentsPath, "utf8");
      if (!content.includes("<!-- flyd:continuity:start -->")) {
        const section = `\n<!-- flyd:continuity:start -->\n## Flyd continuity\n\nBefore substantial work:\n- read PROJECT.md\n- inspect AGENTS.md\n- inspect status/branch/recent Git\n- resolve contradictions in favour of live evidence\n\nAfter substantial verified work:\n- verify result\n- reconcile PROJECT.md\n- record durable decisions\n- leave explicit open loops\n- preserve useful next-agent context\n\n<!-- flyd:continuity:end -->\n`;
        writeFileSync(agentsPath, content + section, "utf8");
        refreshRepositoryFileFlags(id);
        console.log("  AGENTS.md: continuity section added");
        updated++;
      } else {
        console.log("  AGENTS.md: continuity section already present");
      }
    } else {
      console.log("  AGENTS.md: not found (skipped)");
    }

    // Create PROJECT.md if missing
    const projectPath = join(resolved, "PROJECT.md");
    if (!existsSync(projectPath)) {
      const state = draftProjectState(resolved, name);
      writeProjectState(resolved, state);
      refreshRepositoryFileFlags(id);
      console.log("  PROJECT.md: created with inferred state");
      updated++;
    } else {
      const drift = (await import("../work/project-reconciler.js")).detectProjectMdDrift(resolved);
      if (drift.length > 0) {
        console.log(`  PROJECT.md: drift detected — ${drift.join(", ")}`);
      } else {
        console.log("  PROJECT.md: looks current");
      }
    }
  }

  console.log(`\nUpdated ${updated} repositor${updated === 1 ? "y" : "ies"}`);
}

function draftProjectState(root: string, name: string): ProjectState {
  const today = new Date().toISOString().slice(0, 10);

  // ponytail: derive draft from README, recent git, and docs
  let purpose = "";
  let currentObjective = "";

  try {
    const readmePath = join(root, "README.md");
    if (existsSync(readmePath)) {
      const readme = readFileSync(readmePath, "utf8");
      const firstLine = readme.split("\n").find((l) => l.trim().length > 5 && !l.startsWith("#"));
      if (firstLine) purpose = firstLine.trim().slice(0, 200);
    }
  } catch { /* skip */ }

  try {
    const recentCommits = execSync(
      'git log --oneline -5 --format="%s"',
      { cwd: root, encoding: "utf8", timeout: 5000 }
    ).trim();
    if (recentCommits) {
      currentObjective = recentCommits.split("\n")[0]?.trim() || "";
    }
  } catch { /* skip */ }

  if (!purpose) purpose = `${name} project`;
  if (!currentObjective) currentObjective = "Continue active development";

  return {
    purpose,
    currentObjective,
    currentState: "active",
    activeThreads: [],
    openLoops: [],
    blockers: [],
    importantRecentDecisions: [],
    nextLikelyActions: [],
    lastMeaningfulUpdate: today,
  };
}

export async function runReposReconcile(target?: string): Promise<void> {
  const reposList = target
    ? [{ root: resolve(target), name: basename(resolve(target)), id: basename(resolve(target)) }]
    : listRepositories().map((r) => ({ root: r.root, name: r.name, id: r.id }));

  for (const { root, name, id } of reposList) {
    const projectPath = join(root, "PROJECT.md");
    if (!existsSync(projectPath)) {
      console.log(`${name}: no PROJECT.md (run 'flyd repos prepare' first)`);
      continue;
    }

    const { listActivities } = await import("../work/repository-registry.js");
    const activities = listActivities(id, 5);

    const result = reconcileProject(root, activities);
    if (result.updated) {
      console.log(`${name}: reconciled (${result.changes.length} changes)`);
      for (const change of result.changes.slice(0, 5)) {
        console.log(`  - ${change}`);
      }
      if (result.changes.length > 5) console.log(`  ... and ${result.changes.length - 5} more`);
    } else {
      console.log(`${name}: no changes needed`);
    }
  }
}
