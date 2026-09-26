import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closeDb, resetWorkIndexPath, useWorkIndexPath } from "../../work/database.js";
import { runAssistantTool } from "../assistant-tools.js";

describe("assistant tools", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "flyd-assistant-tools-"));
    useWorkIndexPath(join(dir, "work-index.sqlite"));
  });
  afterEach(() => {
    closeDb();
    resetWorkIndexPath();
    rmSync(dir, { recursive: true, force: true });
  });

  it("manages the confirmed to-do list", async () => {
    expect(await runAssistantTool("todos", { action: "list" })).toBe("(no open to-dos)");
    const added = await runAssistantTool("todos", { action: "add", items: "- call the accountant\n- renew passport" });
    expect(added).toContain("- call the accountant");
    expect(added).toContain("- renew passport");
    expect(await runAssistantTool("todos", { action: "done", query: "accountant" })).toBe("Completed: call the accountant");
    expect(await runAssistantTool("todos", { action: "list" })).toBe("- renew passport");
    expect(await runAssistantTool("todos", { action: "done", query: "dentist" })).toMatch(/^Error: no open to-do matches/);
  });

  it("hands coding work to the runtime only when the surface supports it", async () => {
    const onCodingHandoff = vi.fn();
    expect(await runAssistantTool("start_coding_task", { outcome: "Dark mode, verified" }, { onCodingHandoff }))
      .toBe("Queued for the supervised coding runtime: Dark mode, verified. It starts as soon as this reply ends.");
    expect(onCodingHandoff).toHaveBeenCalledWith("Dark mode, verified");
    expect(await runAssistantTool("start_coding_task", { outcome: "x" })).toMatch(/not available from this surface/);
  });

  it("reports unknown specialists and unreadable work corrections instead of guessing", async () => {
    expect(await runAssistantTool("consult_specialist", { name: "astrologer", question: "?" })).toMatch(/^Error: no specialist "astrologer". Available: .*coach/);
    expect(await runAssistantTool("work_model", { statement: "the weather is nice" })).toMatch(/^Error: could not read that as a work correction/);
  });
});
