import { mkdtempSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  addCollection: vi.fn(async () => undefined),
  createStore: vi.fn(),
  listCollections: vi.fn(),
  mkdir: vi.fn(async () => undefined),
  embed: vi.fn(async () => ({ errors: 0 })),
  update: vi.fn(async () => ({
    collections: 1,
    indexed: 1,
    updated: 0,
    unchanged: 0,
    removed: 0,
    needsEmbedding: 1,
  })),
}));

vi.mock("@tobilu/qmd", () => ({ createStore: mocks.createStore }));
vi.mock("fs/promises", () => ({ mkdir: mocks.mkdir }));

describe("QMD Flyd collections", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.listCollections.mockResolvedValue([
      {
        name: "flyd-raw",
        pwd: "/old/flyd/raw",
        glob_pattern: "**/*.md",
        doc_count: 0,
        active_count: 0,
        last_modified: null,
        includeByDefault: true,
      },
    ]);
    mocks.createStore.mockResolvedValue({
      addCollection: mocks.addCollection,
      listCollections: mocks.listCollections,
      update: mocks.update,
      embed: mocks.embed,
    });
  });

  it("repairs Flyd-owned collection paths before a strict refresh", async () => {
    const root = mkdtempSync(join(tmpdir(), "qmd-collection-"));
    vi.stubEnv("FLYD_DIR", root);
    const { updateRawStrict } = await import("../qmd.js");

    await updateRawStrict();

    expect(mocks.addCollection).toHaveBeenCalledWith(
      "flyd-raw",
      { path: join(root, "raw"), pattern: "**/*.md" },
    );
    expect(mocks.addCollection).toHaveBeenCalledWith(
      "flyd-wiki",
      { path: join(root, "wiki"), pattern: "**/*.md" },
    );
    expect(mocks.update).toHaveBeenCalledWith({ collections: [ "flyd-raw" ] });
    rmSync(root, { recursive: true, force: true });
  });
  it("records partial embedding failures and clears them after a successful retry", async () => {
    const root = mkdtempSync(join(tmpdir(), "qmd-failure-"));
    vi.stubEnv("FLYD_DIR", root);
    const { embedRawStrict } = await import("../qmd.js");
    const marker = join(root, "index-status", "embed-failed");
    try {
      mocks.embed.mockResolvedValueOnce({ errors: 2 });
      await expect(embedRawStrict()).rejects.toThrow("2 chunks");
      expect(existsSync(marker)).toBe(true);
      await embedRawStrict();
      expect(existsSync(marker)).toBe(false);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

});
