import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runLibrarian } from "../librarian.js";
import { applyProjectOps, projectsPromptBlock, readProjects } from "../projects.js";

let dir: string;
let path: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "flyd-projects-")); path = join(dir, "projects.json"); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const now = new Date("2026-09-29T09:00:00");
const knownRepos = ["/Users/g/Documents/cleanx"];

describe("projects", () => {
  it("keeps a project whether or not it has code, and only links repos Flyd knows", () => {
    const receipt = applyProjectOps([
      { op: "upsert", name: "CleanX", what: "Chrome extension that tidies X follows", kind: "product", status: "launching", now: "Polish is done but unmerged; store submission pending", next: "Paid canary run", due: "2026-10-04", repos: ["/Users/g/Documents/cleanx", "/nowhere"] },
      { op: "upsert", name: "GNM invoice", what: "Money GNM owes for delivered work", kind: "client", status: "waiting", now: "Sponsor Erwin left; nobody owns the budget", people: ["Erwin"] },
    ], { knownRepos, now, path });
    expect(receipt).toEqual({ upserted: 2, archived: 0, rejected: ["CleanX: unknown repo /nowhere"] });
    const [cleanx, gnm] = readProjects(path);
    expect(cleanx).toMatchObject({ id: "cleanx", repos: ["/Users/g/Documents/cleanx"], due: "2026-10-04", updated: "2026-09-29" });
    expect(gnm).toMatchObject({ id: "gnm-invoice", repos: [], kind: "client", status: "waiting" });
  });

  it("updates in place, keeps what an update leaves out, and archives as done", () => {
    applyProjectOps([{ op: "upsert", name: "CleanX", what: "Chrome extension", status: "launching", now: "Unmerged", repos: knownRepos }], { knownRepos, now, path });
    applyProjectOps([{ op: "upsert", id: "cleanx", name: "CleanX", now: "Live on the Chrome store" }], { knownRepos, now, path });
    expect(readProjects(path)[0]).toMatchObject({ what: "Chrome extension", now: "Live on the Chrome store", repos: knownRepos });
    applyProjectOps([{ op: "archive", id: "cleanx", reason: "Launched 2 October" }], { knownRepos, now, path });
    expect(readProjects(path)[0]).toMatchObject({ status: "done", now: "Launched 2 October" });
    expect(projectsPromptBlock(path)).toBe("");
  });

  it("tells chat what it knows about each project, and to open code only for code questions", () => {
    applyProjectOps([{ op: "upsert", name: "DIR", what: "AI radio station", kind: "creative", now: "24 mixes done, nothing released" }], { knownRepos, now, path });
    const block = projectsPromptBlock(path);
    expect(block).toContain("- [dir] DIR (creative, active; no code) — AI radio station Now: 24 mixes done, nothing released");
    expect(block).toContain("Open a project's code only when he asks about the code itself");
  });

  it("is built by the Librarian on its first pass, even with nothing new, and not retried the same day", async () => {
    const complete = vi.fn(async (_prompt: string) => JSON.stringify({
      memory_ops: [], profile_ops: [], observations: [],
      project_ops: [{ op: "upsert", name: "CleanX", what: "Chrome extension", kind: "product", status: "launching", now: "Unmerged polish", repos: knownRepos }],
    }));
    const deps = { complete, projectsPath: path, repos: async () => [{ name: "cleanx", root: knownRepos[0] }], rawDir: join(dir, "none"), now: () => now };
    const result = await runLibrarian(deps);
    expect(result.projects).toEqual({ upserted: 1, archived: 0, rejected: [] });
    expect(complete.mock.calls[0][0]).toContain("He has no project list yet: build it now");
    expect(complete.mock.calls[0][0]).toContain("cleanx: /Users/g/Documents/cleanx");
    expect(readProjects(path).map((project) => project.name)).toEqual(["CleanX"]);
    expect(await runLibrarian({ ...deps, now: () => new Date("2026-09-29T10:00:00") })).toMatchObject({ skipped: "nothing_new" });
  });
});
