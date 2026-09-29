import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { batchSources, reprocessSources } from "../librarian.js";
import { readProjects } from "../projects.js";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "flyd-reprocess-")); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("reprocessing old material", () => {
  it("packs sources into batches and splits a long one into parts", () => {
    const batches = batchSources([{ id: "a", text: "x".repeat(6) }, { id: "b", text: "y".repeat(6) }, { id: "cv", text: "z".repeat(25) }], 10);
    expect(batches.map((batch) => batch.map((part) => part.id))).toEqual([["a"], ["b"], ["cv#1"], ["cv#2"], ["cv#3"]]);
  });

  it("runs old material through the Librarian as a backfill, and resumes where it stopped", async () => {
    const prompts: string[] = [];
    const complete = vi.fn(async (prompt: string) => {
      prompts.push(prompt);
      return JSON.stringify({ memory_ops: [], profile_ops: [], observations: [], project_ops: prompts.length === 1 ? [{ op: "upsert", name: "Radarboy", what: "Studio he co-founded", kind: "venture", status: "done" }] : [] });
    });
    const deps = { complete, progressPath: join(dir, "progress.json"), projectsPath: join(dir, "projects.json"), repos: async () => [], addProfileFact: () => false };
    const sources = [{ id: "doc:cv", text: "George co-founded Radarboy in Cape Town." }, { id: "cap:1", text: "Notes about DIR mixes." }];
    const first = await reprocessSources(sources, deps);
    expect(first).toMatchObject({ batches: 1, sources: 2, projects: { upserted: 1 } });
    expect(prompts[0]).toContain("This pass re-reads OLD material about George");
    expect(prompts[0]).toContain("[doc:cv] George co-founded Radarboy");
    expect(readProjects(join(dir, "projects.json"))[0]).toMatchObject({ name: "Radarboy", status: "done" });
    expect(await reprocessSources(sources, deps)).toMatchObject({ batches: 0 });
    expect(complete).toHaveBeenCalledOnce();
  });
});
