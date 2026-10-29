import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStore } from "@tobilu/qmd";
import { expect, it } from "vitest";
import { inspectMemoryIndex } from "../memory-index.js";

it("reconciles a snapshot without modifying the original index and respects QMD exclusions", async () => {
  const root = mkdtempSync(join(tmpdir(), "flyd-index-test-"));
  const raw = join(root, "raw");
  const dbPath = join(root, "index.sqlite");
  mkdirSync(raw);
  writeFileSync(join(raw, "one.md"), "first note");
  const store = await createStore({ dbPath, config: { collections: { "flyd-raw": { path: raw, pattern: "**/*.md", ignore: ["ignored.md"] } } } });
  try { await store.update({ collections: ["flyd-raw"] }); } finally { await store.close(); }
  writeFileSync(join(raw, "one.md"), "changed note");
  writeFileSync(join(raw, "two.md"), "new note");
  writeFileSync(join(raw, "ignored.md"), "ignored note");
  try {
    const first = await inspectMemoryIndex({ dbPath, rawDir: raw });
    expect(first).toMatchObject({ state: "stale", indexed: 1, added: 1, changed: 1, removed: 0 });
    const second = await inspectMemoryIndex({ dbPath, rawDir: raw });
    expect(second).toMatchObject({ indexed: 1, added: 1, changed: 1 });
  } finally { rmSync(root, { recursive: true, force: true }); }
});
