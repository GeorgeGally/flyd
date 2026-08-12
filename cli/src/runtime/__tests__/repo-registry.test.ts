import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, afterEach, beforeEach } from "vitest";
import { refreshRepoRegistry, clearRepoRegistry, crossRepoLine, crossRepoContext, type BriefRepo } from "../repo-registry.js";

const tmpRoot = join(tmpdir(), `flyd-repo-registry-test-${Date.now()}`);

function makeRepo(name: string): string {
  const root = join(tmpRoot, name);
  mkdirSync(root, { recursive: true });
  execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
  execFileSync("git", ["config", "user.email", "test@flyd.io"], { cwd: root, stdio: "ignore" });
  execFileSync("git", ["config", "user.name", "Flyd Test"], { cwd: root, stdio: "ignore" });
  return root;
}

function dirtyFile(root: string, filename: string): void {
  writeFileSync(join(root, filename), "changed");
  execFileSync("git", ["add", filename], { cwd: root, stdio: "ignore" });
}

function commit(root: string, message: string): void {
  execFileSync("git", ["commit", "--allow-empty", "-m", message], { cwd: root, stdio: "ignore" });
}

afterEach(() => {
  clearRepoRegistry();
  try { rmSync(tmpRoot, { recursive: true, force: true }); } catch {}
});

beforeEach(() => {
  clearRepoRegistry();
  try { rmSync(tmpRoot, { recursive: true, force: true }); } catch {}
  mkdirSync(tmpRoot, { recursive: true });
});

describe("refreshRepoRegistry", () => {
  it("returns empty array when no repos exist", async () => {
    mkdirSync(tmpRoot, { recursive: true });
    const prev = process.env.FLYD_WORK_ROOTS;
    process.env.FLYD_WORK_ROOTS = tmpRoot;
    try {
      const repos = await refreshRepoRegistry();
      expect(repos).toEqual([]);
    } finally {
      process.env.FLYD_WORK_ROOTS = prev;
    }
  });

  it("discovers repos in work roots and snapshots them", async () => {
    const a = makeRepo("alpha");
    commit(a, "initial");
    const b = makeRepo("bravo");
    dirtyFile(b, "todo.md");

    const prev = process.env.FLYD_WORK_ROOTS;
    process.env.FLYD_WORK_ROOTS = tmpRoot;
    try {
      const repos = await refreshRepoRegistry();
      expect(repos.length).toBeGreaterThanOrEqual(2);

      const alpha = repos.find((r) => r.name === "alpha");
      expect(alpha).toBeDefined();
      expect(alpha!.dirty).toBe(false);
      expect(alpha!.lastCommitRelative).toBeTruthy();

      const bravo = repos.find((r) => r.name === "bravo");
      expect(bravo).toBeDefined();
      expect(bravo!.dirty).toBe(true);
    } finally {
      process.env.FLYD_WORK_ROOTS = prev;
    }
  });

  it("marks the foreground repo", async () => {
    const a = makeRepo("charlie");
    commit(a, "hello");

    const prev = process.env.FLYD_WORK_ROOTS;
    process.env.FLYD_WORK_ROOTS = tmpRoot;
    try {
      const repos = await refreshRepoRegistry(a);
      const charlie = repos.find((r) => r.name === "charlie");
      expect(charlie).toBeDefined();
      expect(charlie!.isForeground).toBe(true);
    } finally {
      process.env.FLYD_WORK_ROOTS = prev;
    }
  });

  it("ranks foreground first, then dirty repos", async () => {
    const a = makeRepo("alpha");
    commit(a, "a");
    const b = makeRepo("bravo");
    dirtyFile(b, "wip.txt");

    const prev = process.env.FLYD_WORK_ROOTS;
    process.env.FLYD_WORK_ROOTS = tmpRoot;
    try {
      const repos = await refreshRepoRegistry(a);
      expect(repos[0].name).toBe("alpha");
      expect(repos[0].isForeground).toBe(true);
      expect(repos[1].dirty).toBe(true);
    } finally {
      process.env.FLYD_WORK_ROOTS = prev;
    }
  });

  it("caches results within TTL", async () => {
    const a = makeRepo("delta");
    commit(a, "first");

    const prev = process.env.FLYD_WORK_ROOTS;
    process.env.FLYD_WORK_ROOTS = tmpRoot;
    try {
      const first = await refreshRepoRegistry();
      const second = await refreshRepoRegistry();
      expect(second).toStrictEqual(first);
    } finally {
      process.env.FLYD_WORK_ROOTS = prev;
    }
  });
});

describe("crossRepoLine", () => {
  it("returns empty for 0-1 repos", () => {
    expect(crossRepoLine([])).toBe("");
    expect(crossRepoLine([{ root: "/x", name: "x", branch: "main", dirty: false, lastCommitRelative: "1h ago", isForeground: true }])).toBe("");
  });

  it("shows foreground marker and dirty status", () => {
    const repos: BriefRepo[] = [
      { root: "/a", name: "alpha", branch: "main", dirty: false, lastCommitRelative: "2h ago", isForeground: true },
      { root: "/b", name: "bravo", branch: "feat/x", dirty: true, lastCommitRelative: "30m ago", isForeground: false },
    ];
    const line = crossRepoLine(repos);
    expect(line).toContain("alpha ←");
    expect(line).toContain("bravo");
    expect(line).toContain("dirty");
  });

  it("caps at 5 repos", () => {
    const repos: BriefRepo[] = Array.from({ length: 8 }, (_, i) => ({
      root: `/r${i}`, name: `repo${i}`, branch: "main", dirty: false, lastCommitRelative: null, isForeground: false,
    }));
    const line = crossRepoLine(repos);
    expect(line).toContain("+3 more");
    expect(line.split("  ").filter(Boolean).length).toBe(6); // 5 names + "+3 more"
  });
});

describe("crossRepoContext", () => {
  it("returns empty for 0-1 repos", () => {
    expect(crossRepoContext([])).toBe("");
    expect(crossRepoContext([{ root: "/x", name: "x", branch: "main", dirty: false, lastCommitRelative: null, isForeground: true }])).toBe("");
  });

  it("lists all repos with root paths", () => {
    const repos: BriefRepo[] = [
      { root: "/a", name: "flyd", branch: "main", dirty: false, lastCommitRelative: "2h ago", isForeground: true },
      { root: "/b", name: "good-neighbours", branch: "feat/bookings", dirty: true, lastCommitRelative: "3d ago", isForeground: false },
      { root: "/c", name: "cleanx", branch: "main", dirty: false, lastCommitRelative: null, isForeground: false },
    ];
    const ctx = crossRepoContext(repos);
    expect(ctx).toContain("flyd: /a (main)");
    expect(ctx).toContain("← foreground");
    expect(ctx).toContain("good-neighbours: /b (feat/bookings) (dirty)");
    expect(ctx).toContain("last commit 3d ago");
    expect(ctx).toContain("cleanx: /c (main)");
  });
});
