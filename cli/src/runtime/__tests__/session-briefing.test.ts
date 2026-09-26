import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { addAgendaItem, agendaPaths, parseLocalDateTime, runDueAgenda, unreadInbox, type AgendaPaths } from "../agenda.js";
import { agendaPromptBlock, composeSessionBriefing, profileGaps } from "../session-briefing.js";

const FULL_PROFILE = "## About me\n- Lives in Canggu\n## People\n- Partner: Maya\n## Routines\n- Runs at 6am\n## Goals\n- Ship Flyd";

describe("composeSessionBriefing", () => {
  let dir: string;
  let paths: AgendaPaths;
  const at = (text: string) => parseLocalDateTime(text)!;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "flyd-briefing-"));
    paths = agendaPaths(dir);
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("says nothing when there is nothing to say", async () => {
    expect(await composeSessionBriefing({ paths, loadReminders: async () => [], readProfile: () => FULL_PROFILE })).toEqual([]);
  });

  it("leads with what happened while George was away, then due items, then Flyd's plans", async () => {
    addAgendaItem({ task: "Check whether the PR merged", when: "2026-09-26 08:00" }, paths, at("2026-09-26 07:00"));
    await runDueAgenda({ paths, now: () => at("2026-09-26 08:01"), runTask: async () => "- Merged at 07:45 by Sam.", notify: async () => {} });
    addAgendaItem({ task: "Morning brief", when: "2026-09-27 08:00", repeat: "weekdays" }, paths, at("2026-09-26 07:00"));
    const lines = await composeSessionBriefing({
      paths,
      readProfile: () => FULL_PROFILE,
      now: () => at("2026-09-26 09:00"),
      loadReminders: async () => [
        { title: "Pay rent", due: at("2026-09-24 09:00") },
        { title: "Call mom", due: at("2026-09-26 17:00") },
      ],
    });
    expect(lines).toEqual([
      "While you were away (1 update):",
      "  • Check whether the PR merged → Merged at 07:45 by Sam.",
      "Overdue: Pay rent",
      "Due today: Call mom 17:00",
      "Flyd will: 08:00 Morning brief",
    ]);
    // Shown once: the inbox is marked read.
    expect(unreadInbox(paths)).toEqual([]);
  });

  it("previews Flyd's next 24 hours and feeds the agenda to the prompt", async () => {
    addAgendaItem({ task: "Morning brief", when: "2026-09-27 08:00", repeat: "weekdays" }, paths, at("2026-09-26 09:00"));
    const lines = await composeSessionBriefing({ paths, now: () => at("2026-09-26 20:00"), loadReminders: async () => [], readProfile: () => FULL_PROFILE });
    expect(lines).toEqual(["Flyd will: 08:00 Morning brief"]);
    expect(agendaPromptBlock(paths)).toContain("(weekdays)");
  });

  it("survives Reminders being unavailable", async () => {
    expect(await composeSessionBriefing({ paths, loadReminders: async () => { throw new Error("denied"); }, readProfile: () => FULL_PROFILE })).toEqual([]);
  });

  it("nudges George to /onboard for the profile gaps that matter", async () => {
    expect(profileGaps(FULL_PROFILE)).toEqual([]);
    expect(profileGaps("## About me\n- Lives in Canggu\n## People\n- \n## Goals\n- Ship")).toEqual(["People", "Routines"]);
    const lines = await composeSessionBriefing({ paths, loadReminders: async () => [], readProfile: () => null });
    expect(lines).toEqual(["I don't know much about you yet — type /onboard and I'll ask a few questions."]);
    const partial = await composeSessionBriefing({ paths, loadReminders: async () => [], readProfile: () => "## About me\n- x\n## Routines\n- y\n## Goals\n- z" });
    expect(partial).toEqual(["I don't know the people in your life yet — type /onboard and I'll ask a few questions."]);
  });
});
