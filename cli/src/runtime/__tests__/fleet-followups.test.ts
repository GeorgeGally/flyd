import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runAgendaCommand } from "../../commands/agenda.js";
import { agendaPaths, readInbox, recordInbox, unreadInbox, type AgendaPaths } from "../agenda.js";
import { buildConversationPrompt } from "../conversation-responder.js";
import { syncFleetFollowups } from "../fleet-followups.js";
import { agendaPromptBlock, composeMorning } from "../session-briefing.js";

const FULL_PROFILE = "## About me\n- Lives in Canggu\n## People\n- Partner: Maya\n## Routines\n- Runs at 6am\n## Goals\n- Ship Flyd";
const STALLED = { id: "job-1", task: "Daily news brief as good as Hermes's", status: "paused" };

describe("fleet followups", () => {
  let dir: string;
  let paths: AgendaPaths;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "flyd-followups-"));
    paths = agendaPaths(dir);
    vi.stubEnv("FLYD_AGENDA_DIR", dir);
    vi.stubEnv("FLYD_ROOM", "0");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(dir, { recursive: true, force: true });
  });

  it("files stalled fleet work once in Flyd's inbox as an internal plain sentence", () => {
    syncFleetFollowups([STALLED], paths);
    syncFleetFollowups([STALLED], paths);
    const filed = readInbox(paths);
    expect(filed).toHaveLength(1);
    expect(filed[0]).toMatchObject({ itemId: "fleet-job-1", internal: true, read: false });
    expect(filed[0]!.result).toBe("Daily news brief as good as Hermes's is paused and needs Flyd and FirstMate to get it moving again.");
    syncFleetFollowups([{ ...STALLED, status: "failed" }], paths);
    expect(readInbox(paths)).toHaveLength(2);
  });

  it("keeps stalled fleet work out of George's `flyd agenda inbox`", async () => {
    recordInbox({ itemId: "brief", task: "Morning brief", status: "ok", result: "All clear." }, paths);
    syncFleetFollowups([STALLED], paths);
    const out = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    try {
      await runAgendaCommand("inbox");
      const printed = out.mock.calls.map(([chunk]) => String(chunk)).join("");
      expect(printed).toContain("All clear.");
      expect(printed).not.toContain("Daily news brief");
    } finally { out.mockRestore(); }
  });

  it("keeps stalled fleet work out of George's briefing and every chat prompt", async () => {
    syncFleetFollowups([STALLED], paths);
    expect(unreadInbox(paths)).toEqual([]);
    expect(await composeMorning({ paths, loadReminders: async () => [], readProfile: () => FULL_PROFILE })).toEqual([]);
    expect(agendaPromptBlock(paths)).toBe("");
    const input = (message: string) => ({ message, history: [], memory: { verdict: "insufficient" as const, matches: [] }, situation: null });
    for (const message of ["How was your day?", "what's on my plate", "Fix the island filter in flyd"]) {
      for (const projectTurn of [true, false]) {
        const { system, prompt } = buildConversationPrompt(input(message), undefined, { projectTurn });
        expect(`${system}\n${prompt}`).not.toContain("Daily news brief");
        expect(`${system}\n${prompt}`).not.toContain("flyd-work-to-sort");
      }
    }
  });
});
