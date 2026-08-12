import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  classifyIntent,
  answerQuestion,
  deepen,
} from "../work/recall-router.js";
import {
  parseGitHubRepo,
  listReposWithGitHub,
  emptySupplement,
} from "../work/github-supplement.js";
import { parseProjectMd } from "../work/project-state.js";
import { addRepository, removeRepository, listRepositories, listActivities, buildGlobalPresentModel, scanDirectories } from "../work/repository-registry.js";
import { addTask, listOpenTasks, syncProjectTasks, listTasks } from "../work/task-store.js";
import { useWorkIndexPath, resetWorkIndexPath, closeDb } from "../work/database.js";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";


describe("recall router — intent classification", () => {
  it("classifies active projects", () => {
    expect(classifyIntent("what am I working on")).toBe("active_projects");
    expect(classifyIntent("active projects")).toBe("active_projects");
    expect(classifyIntent("what else")).toBe("active_projects");
  });

  it("classifies open tasks", () => {
    expect(classifyIntent("my todo list")).toBe("open_tasks");
    expect(classifyIntent("open tasks")).toBe("open_tasks");
    expect(classifyIntent("what's pending")).toBe("open_tasks");
  });

  it("classifies project status", () => {
    expect(classifyIntent("status of flyd")).toBe("project_status");
  });

  it("classifies recent work", () => {
    expect(classifyIntent("recent activity")).toBe("recent_work");
    expect(classifyIntent("what did I do yesterday")).toBe("recent_work");
    expect(classifyIntent("what changed today")).toBe("recent_work");
  });

  it("classifies what happened", () => {
    expect(classifyIntent("what happened with flyd")).toBe("what_happened");
  });

  it("falls back to general", () => {
    expect(classifyIntent("explain quantum physics")).toBe("general");
  });
});

describe("recall router — answerQuestion (no content)", () => {
  it("returns active projects result", () => {
    const result = answerQuestion("what am I working on");
    expect(result.intent).toBe("active_projects");
    expect(["high", "medium", "low"]).toContain(result.confidence);
    expect(result.answer.length).toBeGreaterThan(0);
  });

  it("returns task result", () => {
    const result = answerQuestion("my todo list");
    expect(result.intent).toBe("open_tasks");
    expect(result.answer.length).toBeGreaterThan(0);
  });
});

describe("PROJECT.md parser", () => {
  it("parses a complete PROJECT.md", () => {
    const md = `# Project

## Purpose
Test project

## Current objective
Ship something

## Current state
active

## Active threads
- thread one
- thread two

## Open loops
- unclosed item

## Blockers
- need approval

## Important recent decisions
- decided to use SQLite

## Next likely actions
- write tests

## Last meaningful update
2026-08-12`;

    const state = parseProjectMd(md);
    expect(state.purpose).toBe("Test project");
    expect(state.currentObjective).toBe("Ship something");
    expect(state.currentState).toBe("active");
    expect(state.activeThreads).toEqual(["thread one", "thread two"]);
    expect(state.openLoops).toEqual(["unclosed item"]);
    expect(state.blockers).toEqual(["need approval"]);
    expect(state.importantRecentDecisions).toEqual(["decided to use SQLite"]);
    expect(state.nextLikelyActions).toEqual(["write tests"]);
    expect(state.lastMeaningfulUpdate).toBe("2026-08-12");
  });

  it("handles empty sections", () => {
    const md = `# Project

## Purpose

## Current objective

## Current state

## Active threads

## Open loops

## Blockers

## Important recent decisions

## Next likely actions

## Last meaningful update`;

    const state = parseProjectMd(md);
    expect(state.purpose).toBe("");
    expect(state.activeThreads).toEqual([]);
    expect(state.blockers).toEqual([]);
  });
});

describe("GitHub supplement", () => {
  it("parses GitHub remote URLs", () => {
    expect(parseGitHubRepo("https://github.com/GeorgeGally/flyd.git")).toEqual({
      owner: "GeorgeGally", name: "flyd",
    });
    expect(parseGitHubRepo("git@github.com:org/repo.git")).toEqual({
      owner: "org", name: "repo",
    });
    expect(parseGitHubRepo("https://gitlab.com/org/repo")).toBeNull();
  });

  it("returns empty supplement", () => {
    const s = emptySupplement();
    expect(s.openPrs).toEqual([]);
    expect(s.recentlyMergedPrs).toEqual([]);
    expect(s.openIssues).toEqual([]);
  });
});

describe("deepen — drill-down", () => {
  it("returns null for empty activities", () => {
    const result = deepen({
      intent: "recent_work",
      answer: "",
      data: { activities: [] },
      confidence: "high",
      freshness: "now",
    });
    expect(result).toBeNull();
  });
});

import { execSync } from "child_process";
import { writeFileSync } from "fs";
import { observeAndRecord } from "../work/git-observer.js";

describe("Git observer baseline", () => {
  let dbDir: string;

  beforeEach(() => {
    dbDir = mkdtempSync(join(tmpdir(), "flyd-wi-db-"));
    useWorkIndexPath(join(dbDir, "work-index.sqlite"));
  });

  afterEach(() => {
    closeDb();
    resetWorkIndexPath();
    rmSync(dbDir, { recursive: true, force: true });
  });

  it("establishes initial baseline without creating activity", () => {
    const tmp = mkdtempSync(join(tmpdir(), "flyd-test-"));
    execSync("git init -b main", { cwd: tmp });
    execSync('git config user.email "test@example.com"', { cwd: tmp });
    execSync('git config user.name "Test"', { cwd: tmp });
    writeFileSync(join(tmp, "README.md"), "hello");
    execSync("git add README.md", { cwd: tmp });
    execSync('git commit -m "Initial commit"', { cwd: tmp });

    addRepository(tmp);
    const repos = listRepositories();
    const repo = repos.find((r) => r.root === tmp)!;

    // First observation should just set the baseline
    const snapshot1 = observeAndRecord(repo.id);
    expect(snapshot1.head).toBeDefined();

    const storedRepo = listRepositories().find((r) => r.id === repo.id)!;
    expect(storedRepo.lastIndexedHead).toBe(snapshot1.head);

    // Should NOT have created activity for the baseline
    const activities1 = listActivities(repo.id);
    expect(activities1.length).toBe(0);

    // Second commit should create activity
    writeFileSync(join(tmp, "README.md"), "hello world");
    execSync("git add README.md", { cwd: tmp });
    execSync('git commit -m "Second commit"', { cwd: tmp });

    const snapshot2 = observeAndRecord(repo.id);
    const storedRepo2 = listRepositories().find((r) => r.id === repo.id)!;
    expect(storedRepo2.lastIndexedHead).toBe(snapshot2.head);
    
    const activities2 = listActivities(repo.id);
    expect(activities2.length).toBe(1);
    expect(activities2[0].summary).toBe("Second commit");
  });

  it("prevents repository ID collisions for same basenames", () => {
    const parent1 = mkdtempSync(join(tmpdir(), "flyd-test-p1-"));
    const parent2 = mkdtempSync(join(tmpdir(), "flyd-test-p2-"));
    const tmp1 = join(parent1, "same-name");
    const tmp2 = join(parent2, "same-name");
    
    // Create first repo
    execSync(`mkdir -p ${tmp1}`);
    execSync("git init -b main", { cwd: tmp1 });
    const repo1 = addRepository(tmp1);
    
    // Create second repo with same basename
    execSync(`mkdir -p ${tmp2}`);
    execSync("git init -b main", { cwd: tmp2 });
    const repo2 = addRepository(tmp2);
    
    expect(repo1.id).not.toBe(repo2.id);
    expect(repo1.name).toBe("same-name");
    expect(repo2.name).toBe("same-name");

    // Re-registering should return existing
    const repo1_again = addRepository(tmp1);
    expect(repo1_again.id).toBe(repo1.id);
  });

  it("reports actual dirty repository state in global present model", () => {
    const tmp = mkdtempSync(join(tmpdir(), "flyd-test-dirty-"));
    execSync("git init -b main", { cwd: tmp });
    execSync('git config user.email "test@example.com"', { cwd: tmp });
    execSync('git config user.name "Test"', { cwd: tmp });
    const repo = addRepository(tmp);

    let model = buildGlobalPresentModel();
    let r = model.activeProjects.find((p: any) => p.repositoryId === repo.id);
    expect(r).toBeDefined();
    expect(r!.dirty).toBe(false);
    expect(r!.uncommittedFiles).toBe(0);

    // Make it dirty
    writeFileSync(join(tmp, "untracked.txt"), "hello");
    
    model = buildGlobalPresentModel();
    r = model.activeProjects.find((p: any) => p.repositoryId === repo.id);
    expect(r).toBeDefined();
    expect(r!.dirty).toBe(true);
    expect(r!.uncommittedFiles).toBe(1);
  });

  it("respects FLYD_WORK_ROOTS for discovery", () => {
    const tmp = mkdtempSync(join(tmpdir(), "flyd-test-roots-"));
    const repoDir = join(tmp, "my-repo");
    execSync(`mkdir -p ${repoDir}`);
    execSync("git init -b main", { cwd: repoDir });

    process.env.FLYD_WORK_ROOTS = tmp;
    const discovered = scanDirectories();
    expect(discovered.find((d: any) => d.name === "my-repo")).toBeDefined();
    delete process.env.FLYD_WORK_ROOTS;
  });
});

describe("Task synchronization", () => {
  let dbDir: string;

  beforeEach(() => {
    dbDir = mkdtempSync(join(tmpdir(), "flyd-wi-db-"));
    useWorkIndexPath(join(dbDir, "work-index.sqlite"));
  });

  afterEach(() => {
    closeDb();
    resetWorkIndexPath();
    rmSync(dbDir, { recursive: true, force: true });
  });

  it("resolves project_md tasks removed from source without affecting manual tasks", () => {
    const tmp = mkdtempSync(join(tmpdir(), "flyd-test-tasks-"));
    execSync("git init -b main", { cwd: tmp });
    const repo = addRepository(tmp);
    const projectId = repo.id;

    // 1. manual task
    addTask({ projectId, description: "Manual task", sourceType: "manual" });
    // 2. retained project task
    addTask({ projectId, description: "Retained task", sourceType: "project_md" });
    // 3. removed project task
    addTask({ projectId, description: "Removed task", sourceType: "project_md" });

    // Ensure all 3 are open
    let openTasks = listOpenTasks(projectId);
    expect(openTasks.length).toBe(3);

    // Sync with ONLY the retained task
    const { nowDone } = syncProjectTasks(projectId, ["Retained task"]);
    expect(nowDone).toEqual(["Removed task"]);

    openTasks = listOpenTasks(projectId);
    expect(openTasks.length).toBe(2);
    const openDescs = openTasks.map((t: any) => t.description).sort();
    expect(openDescs).toEqual(["Manual task", "Retained task"]);

    // The removed task should be "done"
    const allTasks = listTasks({ projectId });
    const removedTask = allTasks.find((t: any) => t.description === "Removed task");
    expect(removedTask).toBeDefined();
    expect(removedTask?.status).toBe("done");
  });
});
