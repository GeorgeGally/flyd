import { execFileSync } from "node:child_process";
import { basename } from "node:path";
import { updatePresentState } from "./present-store.js";

export interface GitProjectDigest {
  projectId: string;
  root: string;
  generatedAt: string;
  branch: string;
  dirty: boolean;
  recentCommits: Array<{ sha: string; at: string; subject: string }>;
  changedAreas: string[];
  summary: string;
  unresolvedSignals: string[];
}

function git(root: string, args: string[]): string {
  return execFileSync("git", ["-C", root, ...args], { encoding: "utf8", timeout: 2500, stdio: ["ignore","pipe","ignore"] }).trim();
}

export function distillGitProject(root: string, commitLimit = 8): GitProjectDigest {
  const branch = git(root, ["rev-parse","--abbrev-ref","HEAD"]);
  const status = git(root, ["status","--short"]);
  const changed = status ? status.split("\n").map((l) => l.slice(3).trim()).filter(Boolean) : [];
  const log = git(root, ["log", `-${commitLimit}`, "--format=%h%x09%cI%x09%s"]);
  const recentCommits = log ? log.split("\n").map((line) => {
    const [sha, at, ...subject] = line.split("\t");
    return { sha, at, subject: subject.join("\t") };
  }) : [];
  const changedAreas = [...new Set(changed.map((p) => p.split("/").slice(0,2).join("/")))].slice(0,12);
  const project = basename(root);
  const summary = recentCommits.slice(0,3).map((c) => c.subject).join("; ") || (changed.length ? `${changed.length} uncommitted changes` : "No recent movement");
  return {
    projectId: `project:${project.toLowerCase().replace(/[^a-z0-9]+/g,"-")}`,
    root, generatedAt: new Date().toISOString(), branch, dirty: changed.length > 0,
    recentCommits, changedAreas, summary, unresolvedSignals: changed.length ? ["uncommitted_changes"] : [],
  };
}

export function materializeGitDigest(root: string): GitProjectDigest {
  const digest = distillGitProject(root);
  updatePresentState({
    foregroundProject: digest.projectId,
    activeProjects: [digest.projectId],
    dirtyRepos: digest.dirty ? [{ root, branch: digest.branch, changed: digest.changedAreas }] : [],
    recentRepoMovement: digest.recentCommits.slice(0,5).map((c) => ({ project: digest.projectId, subject: c.subject, at: c.at })),
    sourceRefs: digest.recentCommits.map((c) => `git:commit:${c.sha}`),
  });
  return digest;
}
