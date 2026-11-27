import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyMemoryOps, correctMemoryEntries, entryId, memoryCorrectionRevision, memoryPaths, readConsistentMemoryText, type MemoryPaths } from "../memory-store.js";

let home: string;
let paths: MemoryPaths;
beforeEach(() => { home = mkdtempSync(join(tmpdir(), "flyd-memory-tx-")); paths = memoryPaths(home); });
afterEach(() => rmSync(home, { recursive: true, force: true }));

describe("memory correction transaction", () => {
  it("changes only explicitly identified lines, retains sources, and does not retire unrelated stale entries", () => {
    const original = "# User-authored heading\n\n## Decisions\nA note kept exactly.\n- Flyd is chief of staff <!--a:2020-01-01-->\n- Unrelated old decision <!--p:2020-01-01-->\n";
    writeFileSync(paths.memory, original);
    const oldId = entryId("Flyd is chief of staff");
    writeFileSync(paths.sources, JSON.stringify({ [oldId]: ["original-evidence"], untouched: ["other"] }));
    writeFileSync(paths.archive, "Earlier archive.\n");
    const revision = memoryCorrectionRevision(paths);
    const result = correctMemoryEntries({ expectedRevision: revision, paths, now: new Date("2026-11-27T12:00:00Z"), source: "user:role-correction", corrections: [{ oldText: "Flyd is chief of staff", newText: "Flyd is the PA; a separate chief of staff coordinates teams" }] });
    expect(result.updated).toBe(1);
    expect(readFileSync(paths.memory, "utf8")).toBe(original.replace("Flyd is chief of staff <!--a:2020-01-01-->", "Flyd is the PA; a separate chief of staff coordinates teams <!--a:2026-11-27-->"));
    const sources = JSON.parse(readFileSync(paths.sources, "utf8"));
    expect(sources[oldId]).toEqual(["original-evidence"]);
    expect(sources[entryId("Flyd is the PA; a separate chief of staff coordinates teams")]).toEqual(["original-evidence", "user:role-correction"]);
    expect(sources.untouched).toEqual(["other"]);
    expect(readFileSync(paths.archive, "utf8")).toContain("Flyd is chief of staff");
    expect(memoryCorrectionRevision(paths)).toBe(result.revision);
  });

  it("refuses stale revisions without changing any target", () => {
    writeFileSync(paths.memory, "# Memory\n\n## Facts\n- Original <!--a:2026-11-20-->\n");
    const revision = memoryCorrectionRevision(paths);
    writeFileSync(paths.memory, "# Memory\n\n## Facts\n- Another edit <!--a:2026-11-20-->\n");
    expect(() => correctMemoryEntries({ expectedRevision: revision, paths, source: "user:turn", corrections: [{ oldText: "Original", newText: "Corrected" }] })).toThrow(/stale/);
    expect(readFileSync(paths.memory, "utf8")).toContain("Another edit");
    expect(existsSync(paths.archive)).toBe(false);
  });

  it("preserves a damaged source index instead of overwriting its attribution", () => {
    const original = "# Memory\n\n## Facts\n- Original <!--a:2026-11-20-->\n";
    writeFileSync(paths.memory, original);
    writeFileSync(paths.sources, "{broken");
    expect(() => applyMemoryOps([{ op: "add", section: "Facts", text: "New" }], { paths })).toThrow();
    expect(readFileSync(paths.memory, "utf8")).toBe(original);
    expect(readFileSync(paths.sources, "utf8")).toBe("{broken");
  });

  it("rolls an interrupted multi-file commit forward before accepting another operation", () => {
    const original = "# Memory\n";
    const updated = "# Memory\n## Facts\n- Changed <!--a:2026-11-27-->\n";
    writeFileSync(paths.memory, updated);
    writeFileSync(join(home, ".memory-transaction.json"), JSON.stringify({ version: 1, writes: [
      { path: paths.memory, before: original, after: updated },
      { path: paths.sources, before: null, after: "{\"changed\":[\"source\"]}\n" },
      { path: paths.archive, before: null, after: "Previous entry\n" },
    ] }));
    expect(readConsistentMemoryText(paths)).toBe(updated);
    expect(readFileSync(paths.sources, "utf8")).toBe("{\"changed\":[\"source\"]}\n");
    expect(readFileSync(paths.archive, "utf8")).toBe("Previous entry\n");
    expect(existsSync(join(home, ".memory-transaction.json"))).toBe(false);
    memoryCorrectionRevision(paths);
    expect(readFileSync(paths.archive, "utf8")).toBe("Previous entry\n");
  });

  it("stops recovery before writing anything when an external edit conflicts", () => {
    writeFileSync(paths.memory, "An independent edit\n");
    writeFileSync(join(home, ".memory-transaction.json"), JSON.stringify({ version: 1, writes: [
      { path: paths.memory, before: "Before\n", after: "After\n" },
      { path: paths.archive, before: null, after: "Archive\n" },
    ] }));
    expect(() => applyMemoryOps([], { paths })).toThrow(/outside edit/);
    expect(readFileSync(paths.memory, "utf8")).toBe("An independent edit\n");
    expect(existsSync(paths.archive)).toBe(false);
    expect(existsSync(join(home, ".memory-transaction.json"))).toBe(true);
  });

  it("serializes concurrent writer processes without losing entries", async () => {
    const code = `import { applyMemoryOps, memoryPaths } from './src/council/memory-store.ts'; applyMemoryOps([{op:'add',section:'Facts',text:process.argv[2]}], {paths:memoryPaths(process.argv[1]),now:new Date('2026-11-27T12:00:00Z')});`;
    await Promise.all(Array.from({ length: 6 }, (_, index) => new Promise<void>((resolve, reject) => {
      const child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "-e", code, home, `Worker ${index}`], { cwd: process.cwd(), env: process.env, stdio: ["ignore", "ignore", "pipe"] });
      let errors = "";
      child.stderr.on("data", (chunk: Buffer) => { errors += chunk.toString(); });
      child.on("error", reject);
      child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`writer failed (${code}): ${errors}`)));
    })));
    const memory = readFileSync(paths.memory, "utf8");
    for (let index = 0; index < 6; index++) expect(memory).toContain(`Worker ${index}`);
  }, 30_000);
});
