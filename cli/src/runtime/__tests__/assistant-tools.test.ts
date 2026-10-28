import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

  it("refuses leaked fixture launches before dispatch or notice while allowing real work", async () => {
    const librarian = await import("../../command/librarian.js");
    const notice = await import("../../command/notice.js");
    const dispatch = vi.spyOn(librarian, "dispatchKnowledgeDomain").mockReturnValue({ id: "test-run" } as ReturnType<typeof librarian.dispatchKnowledgeDomain>);
    const noticeSpy = vi.spyOn(notice, "captainNotice");
    const originalCommandDir = process.env.FLYD_COMMAND_DIR;
    process.env.FLYD_COMMAND_DIR = join(dir, "command");
    const fixtures = ["fix the GNM checkout bug", "tidy the hero spacing", "the good neighbours market hero is too tall", "Christmas Nuanu map", 'He prefers "calm" UI', 'About the artefact "Map"', 'About the artefact "Christmas Nuanu map"', "look at this", "Read what George attached and act on it"];
    try {
      for (const fixture of fixtures) {
        const result = await runAssistantTool("start_knowledge_task", { outcome: fixture, done_when: ["done"] }, { userMessage: fixture });
        expect(result).toContain("fixture_request");
        expect(result).toContain("non-retryable");
      }
      for (const [name, input] of [
        ["start_coding_task", { outcome: " LOOK  AT THIS ", done_when: ["done"] }],
        ["start_design_task", { outcome: "look at this", done_when: ["done"] }],
        ["pass_on_question", { question: "look at this" }],
        ["background_task", { task: "look at this", done_when: ["done"] }],
        ["domain_work", { action: "ask", question: "look at this" }],
      ] as const) expect(await runAssistantTool(name, input)).toContain("fixture_request");
      process.env.FLYD_EVAL = "1";
      expect(await runAssistantTool("start_knowledge_task", { outcome: "send the GNM vendor email", done_when: ["done"] })).toContain("test_process (non-retryable): FLYD_EVAL");
      delete process.env.FLYD_EVAL;
      const cases = JSON.parse(readFileSync(new URL("../../evals/chat/cases.json", import.meta.url), "utf8")) as Array<{ id: string; ask: string }>;
      for (const item of cases) {
        const result = await runAssistantTool("start_knowledge_task", { outcome: item.ask, done_when: ["done"] });
        expect(result).toContain(`fixture_request (non-retryable): ${item.id}`);
      }
      expect(dispatch).not.toHaveBeenCalled();
      expect(existsSync(join(dir, "command"))).toBe(false);
      expect(noticeSpy).not.toHaveBeenCalled();
      expect(await runAssistantTool("start_knowledge_task", { outcome: "send the GNM vendor email", done_when: ["done"] })).toContain("Knowledge work accepted");
      expect(dispatch).toHaveBeenCalledTimes(1);
      process.env.FLYD_EVAL = "0";
      expect(await runAssistantTool("start_knowledge_task", { outcome: "send the GNM vendor email", done_when: ["done"] })).toContain("Knowledge work accepted");
      delete process.env.FLYD_EVAL;
      expect(await runAssistantTool("start_knowledge_task", { outcome: "Shorten the Acme pitch summary to three sentences", done_when: ["done"] }, { userMessage: "make it shorter" })).toContain("Knowledge work accepted");
      expect(dispatch).toHaveBeenCalledTimes(3);
      expect(dispatch).toHaveBeenLastCalledWith(expect.objectContaining({ originalMessage: "make it shorter" }));
    } finally {
      delete process.env.FLYD_EVAL;
      if (originalCommandDir === undefined) delete process.env.FLYD_COMMAND_DIR;
      else process.env.FLYD_COMMAND_DIR = originalCommandDir;
      vi.restoreAllMocks();
    }
  });

  it("tells chat what the coding staff is doing, read live from a fake staff home", async () => {
    const home = join(dir, "firstmate");
    mkdirSync(join(home, "bin"), { recursive: true });
    mkdirSync(join(home, "state"), { recursive: true });
    writeFileSync(join(home, "bin", "fm-inbox.sh"), "#!/bin/sh\nprintf '%s' '{\"lock\":{\"state\":\"held\",\"pid\":1,\"live_harness\":true},\"wake_consumer\":{\"state\":\"healthy\"},\"can_receive\":true}'\n", { mode: 0o755 });
    writeFileSync(join(home, "state", "home-summary.json"), JSON.stringify({
      active_children: [{ id: "footer-link", state: "working", name: "Fix the footer link" }],
      decisions_open: [{ id: "visuals", summary: "Pick a Christmas look" }],
      counts: { queued: 2 },
    }));
    const saved = { home: process.env.FLYD_FIRSTMATE_HOME, command: process.env.FLYD_COMMAND_DIR };
    process.env.FLYD_FIRSTMATE_HOME = home;
    process.env.FLYD_COMMAND_DIR = join(dir, "command");
    try {
      const said = await runAssistantTool("domain_work", { action: "staff" });
      expect(said).toContain("Coding staff: on duty.");
      expect(said).toContain("Under way (1):\n- Fix the footer link");
      expect(said).toContain("Held for George (1):\n- Pick a Christmas look");
      expect(said).toContain("Queued next: 2.");
    } finally {
      for (const [key, value] of [["FLYD_FIRSTMATE_HOME", saved.home], ["FLYD_COMMAND_DIR", saved.command]] as const) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  it("routes design work to Design Mate, never a note to the coding boss", async () => {
    const home = join(dir, "firstmate");
    mkdirSync(join(home, "bin"), { recursive: true });
    const calls = join(dir, "calls.log");
    writeFileSync(join(home, "bin", "fm-inbox.sh"), `#!/bin/sh\necho "$1" >> '${calls}'\nprintf '%s' '{"can_receive":true}'\n`, { mode: 0o755 });
    const saved = { home: process.env.FLYD_FIRSTMATE_HOME, command: process.env.FLYD_COMMAND_DIR, labs: process.env.FLYD_LABS_DIR };
    process.env.FLYD_FIRSTMATE_HOME = home;
    process.env.FLYD_COMMAND_DIR = join(dir, "command");
    process.env.FLYD_LABS_DIR = join(dir, "labs");
    try {
      expect(await runAssistantTool("start_design_task", { outcome: "Five landing heroes", done_when: ["five versions"], repo: dir }))
        .toMatch(/^Design lab started \(run lab-/);
      expect(existsSync(calls) ? readFileSync(calls, "utf8") : "").not.toContain("note");
    } finally {
      for (const [key, value] of [["FLYD_FIRSTMATE_HOME", saved.home], ["FLYD_COMMAND_DIR", saved.command], ["FLYD_LABS_DIR", saved.labs]] as const) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
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

  it("lists a passed obligation after live ones, as history with its date", async () => {
    await runAssistantTool("todos", { action: "add", items: "- chase the printer 2020-01-01\n- renew passport\n- file the return 2099-12-31" });
    expect(await runAssistantTool("todos", { action: "list" })).toBe(
      "- file the return (due 31 Dec 2099)\n- renew passport\nPast (date passed, still on record):\n- chase the printer (was due 1 Jan 2020)",
    );
    expect(await runAssistantTool("todos", { action: "done", query: "printer" })).toBe("Completed: chase the printer");
  });

  it("never launches a real crewmate from tests, and needs an outcome", async () => {
    expect(await runAssistantTool("start_coding_task", { outcome: "" })).toBe("Error: start_coding_task needs an outcome");
    expect(await runAssistantTool("start_coding_task", { outcome: "Dark mode, verified" }))
      .toBe("Error: start_coding_task needs done_when: the checkable points that mean it's done");
    const result = await runAssistantTool("start_coding_task", { outcome: "Dark mode, verified", done_when: ["the settings screen has a dark toggle"], repo: "/nonexistent/repo" });
    expect(result).toBe("Error: /nonexistent/repo is not a git repository");
    expect(await runAssistantTool("background_task", { task: "new mixes", done_when: ["three exist"], deliverable: "mixes/new" }))
      .toBe("Error: background_task deliverable must be an absolute or ~/ path");
    expect(await runAssistantTool("start_knowledge_task", { outcome: "" }))
      .toBe("Error: start_knowledge_task needs an outcome");
    expect(await runAssistantTool("start_knowledge_task", { outcome: "Research Jev" }))
      .toBe("Error: start_knowledge_task needs done_when: the checkable points that mean it's done");
    expect(await runAssistantTool("start_design_task", { outcome: "" })).toBe("Error: start_design_task needs an outcome");
    expect(await runAssistantTool("start_design_task", { outcome: "Five landing heroes" }))
      .toBe("Error: start_design_task needs done_when: the checkable points that mean the lab is ready");
    expect(await runAssistantTool("crew", { action: "list" })).toBe("No crew tasks yet.");
    expect(await runAssistantTool("crew", { action: "land" })).toBe("Error: crew show/land/discard needs an id");
  });

  it("reports unknown specialists and unreadable work corrections instead of guessing", async () => {
    expect(await runAssistantTool("consult_specialist", { name: "astrologer", question: "?" })).toMatch(/^Error: no specialist "astrologer". Available: .*coach/);
    expect(await runAssistantTool("work_model", { statement: "the weather is nice" })).toMatch(/^Error: could not read that as a work correction/);
  });
});
