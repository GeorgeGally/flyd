import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCareCommand } from "../care.js";
import { meetingPrepConsented } from "../../runtime/proactive-care.js";
import { SourceContractRegistry } from "../../intelligence/sensors/source-contracts.js";

afterEach(() => vi.unstubAllEnvs());

describe("flyd care consent controls", () => {
  it("requires a deliberate enable action and supports pause, disable and re-enable", async () => {
    const dir = mkdtempSync(join(tmpdir(), "flyd-care-cli-"));
    vi.stubEnv("FLYD_DIR", dir);
    const lines: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((...args) => lines.push(args.map(String).join(" ")));
    try {
      const registry = () => new SourceContractRegistry();
      expect(meetingPrepConsented(registry())).toBe(false);
      await runCareCommand("status");
      expect(lines.join(" ")).toContain("disabled");
      await runCareCommand("enable");
      expect(meetingPrepConsented(registry())).toBe(true);
      await runCareCommand("pause");
      expect(meetingPrepConsented(registry())).toBe(false);
      await runCareCommand("enable");
      expect(meetingPrepConsented(registry())).toBe(true);
      await runCareCommand("disable");
      expect(meetingPrepConsented(registry())).toBe(false);
      await expect(runCareCommand("nonsense")).rejects.toThrow("Usage");
    } finally {
      spy.mockRestore();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
