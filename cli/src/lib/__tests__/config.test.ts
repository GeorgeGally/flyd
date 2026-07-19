import { afterEach, describe, expect, it, vi } from "vitest";
import { resolve } from "path";

describe("Flyd directory configuration", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("honors FLYD_DIR for shared Rails and CLI state", async () => {
    vi.stubEnv("FLYD_DIR", "/tmp/flyd-shared-state");
    vi.resetModules();

    const config = await import("../config.js");

    expect(config.FLYD_DIR).toBe(resolve("/tmp/flyd-shared-state"));
    expect(config.RAW_DIR).toBe(resolve("/tmp/flyd-shared-state/raw"));
  });
});
