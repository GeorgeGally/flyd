import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  addCollection: vi.fn(async () => undefined),
  createStore: vi.fn(),
  listCollections: vi.fn(),
  mkdir: vi.fn(async () => undefined),
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
    });
  });

  it("repairs Flyd-owned collection paths before a strict refresh", async () => {
    vi.stubEnv("FLYD_DIR", "/shared/flyd");
    const { updateRawStrict } = await import("../qmd.js");

    await updateRawStrict();

    expect(mocks.addCollection).toHaveBeenCalledWith(
      "flyd-raw",
      { path: "/shared/flyd/raw", pattern: "**/*.md" },
    );
    expect(mocks.addCollection).toHaveBeenCalledWith(
      "flyd-wiki",
      { path: "/shared/flyd/wiki", pattern: "**/*.md" },
    );
    expect(mocks.update).toHaveBeenCalledWith({ collections: [ "flyd-raw" ] });
  });
});
