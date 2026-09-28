import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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

  it("never launches a real crewmate from tests, and needs an outcome", async () => {
    expect(await runAssistantTool("start_coding_task", { outcome: "" })).toBe("Error: start_coding_task needs an outcome");
    expect(await runAssistantTool("start_coding_task", { outcome: "Dark mode, verified" }))
      .toBe("Error: start_coding_task needs done_when: the checkable points that mean it's done");
    const result = await runAssistantTool("start_coding_task", { outcome: "Dark mode, verified", done_when: ["the settings screen has a dark toggle"], repo: "/nonexistent/repo" });
    expect(result).toBe("Error: /nonexistent/repo is not a git repository");
    expect(await runAssistantTool("background_task", { task: "new mixes", done_when: ["three exist"], deliverable: "mixes/new" }))
      .toBe("Error: background_task deliverable must be an absolute or ~/ path");
    expect(await runAssistantTool("crew", { action: "list" })).toBe("No crew tasks yet.");
    expect(await runAssistantTool("crew", { action: "land" })).toBe("Error: crew show/land/discard needs an id");
  });

  it("reports unknown specialists and unreadable work corrections instead of guessing", async () => {
    expect(await runAssistantTool("consult_specialist", { name: "astrologer", question: "?" })).toMatch(/^Error: no specialist "astrologer". Available: .*coach/);
    expect(await runAssistantTool("work_model", { statement: "the weather is nice" })).toMatch(/^Error: could not read that as a work correction/);
  });
});
