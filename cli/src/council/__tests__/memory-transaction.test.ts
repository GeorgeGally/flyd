import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyMemoryOps, memoryPaths, readMemoryEntries, searchDailyNotes, type MemoryPaths } from "../memory-store.js";

let home: string;
let paths: MemoryPaths;
beforeEach(() => { home = mkdtempSync(join(tmpdir(), "flyd-memory-tx-")); paths = memoryPaths(home); });
afterEach(() => rmSync(home, { recursive: true, force: true }));

describe("memory writer transaction", () => {
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
    applyMemoryOps([], { paths });
    expect(JSON.parse(readFileSync(paths.sources, "utf8"))).toEqual({ changed: ["source"] });
    expect(readFileSync(paths.memory, "utf8")).toContain("Changed");
    expect(readFileSync(paths.archive, "utf8")).toBe("Previous entry\n");
    expect(existsSync(join(home, ".memory-transaction.json"))).toBe(false);
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

  it("reads memory and daily notes as plain files, even while a writer's journal is stuck on an outside edit", () => {
    writeFileSync(paths.memory, "# Memory\n\n## Facts\n- Hand edited fact <!--a:2026-11-20-->\n");
    mkdirSync(paths.dailyDir, { recursive: true });
    writeFileSync(join(paths.dailyDir, "2026-11-26.md"), "- talked about the gallery header\n");
    writeFileSync(join(home, ".memory-transaction.json"), JSON.stringify({ version: 1, writes: [{ path: paths.memory, before: "Before\n", after: "After\n" }] }));
    expect(readMemoryEntries(paths, false).map((entry) => entry.text)).toEqual(["Hand edited fact"]);
    expect(searchDailyNotes("gallery header", paths)).toEqual([expect.stringContaining("gallery header")]);
    expect(existsSync(join(home, ".memory-writer-lock.sqlite3"))).toBe(false);
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
