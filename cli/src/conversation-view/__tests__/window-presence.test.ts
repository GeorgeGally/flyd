import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { markWindowClosed, markWindowOpen, WINDOW_STALE_MS, windowOpen } from "../window-presence.js";

let dir: string | undefined;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

describe("window presence", () => {
  it("is open while a stream refreshes, and closed when it ends or goes quiet", () => {
    dir = mkdtempSync(join(tmpdir(), "flyd-window-"));
    const path = join(dir, "window.json");
    expect(windowOpen("session-a", path)).toBe(false);
    markWindowOpen("s1", "session-a", path, 1_000);
    expect(windowOpen("session-a", path, 1_000)).toBe(true);
    // Another conversation open is not this one.
    expect(windowOpen("session-b", path, 1_000)).toBe(false);
    expect(windowOpen("session-a", path, 1_000 + WINDOW_STALE_MS)).toBe(false);
    markWindowClosed("s1", path);
    expect(windowOpen("session-a", path, 1_000)).toBe(false);
  });
});
