import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { addAgendaItem, agendaPaths, formatLocalDateTime, parseLocalDateTime, runDueAgenda, unreadInbox, type AgendaPaths } from "../agenda.js";
import type { Edition, EditionItem } from "../../council/scout.js";
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

  it("puts today's calendar in the briefing, and survives a denied Calendar", async () => {
    const lines = await composeSessionBriefing({
      paths, loadReminders: async () => [], readProfile: () => FULL_PROFILE,
      loadCalendar: async () => ["Monday, 28 September 2026 at 11:00:00 | Call with Sam [Work]"],
    });
    expect(lines).toEqual(["Calendar today: Monday, 28 September 2026 at 11:00:00 | Call with Sam [Work]"]);
    expect(await composeSessionBriefing({
      paths, loadReminders: async () => [], readProfile: () => FULL_PROFILE, loadCalendar: async () => { throw new Error("not authorized"); },
    })).toEqual([]);
  });

  it("can gather ahead of time without marking the inbox read", async () => {
    addAgendaItem({ task: "Check whether the PR merged", when: "2026-09-26 08:00" }, paths, at("2026-09-26 07:00"));
    await runDueAgenda({ paths, now: () => at("2026-09-26 08:01"), runTask: async () => "Merged.", notify: async () => {} });
    const peeked = await composeSessionBriefing({ paths, peek: true, readProfile: () => FULL_PROFILE, loadReminders: async () => [] });
    expect(peeked.join("\n")).toContain("While you were away (1 update)");
    expect(unreadInbox(paths)).toHaveLength(1);
  });

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
      "Later I'll: 08:00 Morning brief",
    ]);
    // Shown once: the inbox is marked read.
    expect(unreadInbox(paths)).toEqual([]);
  });

  it("previews Flyd's next 24 hours and feeds the agenda to the prompt", async () => {
    addAgendaItem({ task: "Morning brief", when: "2026-09-27 08:00", repeat: "weekdays" }, paths, at("2026-09-26 09:00"));
    const lines = await composeSessionBriefing({ paths, now: () => at("2026-09-26 20:00"), loadReminders: async () => [], readProfile: () => FULL_PROFILE });
    expect(lines).toEqual(["Later I'll: 08:00 Morning brief"]);
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

describe("opening news briefing", () => {
  let dir: string;
  let previous: string | undefined;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "flyd-brief-news-"));
    previous = process.env.FLYD_SCOUT_DIR;
    process.env.FLYD_SCOUT_DIR = dir;
  });
  afterEach(() => {
    if (previous === undefined) delete process.env.FLYD_SCOUT_DIR;
    else process.env.FLYD_SCOUT_DIR = previous;
    rmSync(dir, { recursive: true, force: true });
  });

  it("opens with the whole edition, grouped by topic, Hot picks marked ❗ and the one rabbit hole 🐇", async () => {
    const now = new Date("2026-09-28T09:00:00");
    const date = formatLocalDateTime(now).slice(0, 10);
    const items: EditionItem[] = [
      { n: 1, title: "Ordinals auction closes", url: "https://ex.test/1", source: "r/ordinals", topic: "Bitcoin and crypto art", why: "the market finally moves", kind: "relevant" },
      { n: 2, title: "Taproot upgrade lands", url: "https://ex.test/2", source: "r/Bitcoin", topic: "Bitcoin and crypto art", why: "protocol news, not price", kind: "must" },
      { n: 3, title: "CryptoArt drop tonight", url: "https://ex.test/3", source: "r/CryptoArt", topic: "Bitcoin and crypto art", why: "a live generative release", kind: "relevant" },
      { n: 4, title: "ComfyUI workflow", url: "https://ex.test/4", source: "r/comfyui", topic: "Creative tech and AI art", why: "a new node graph technique", kind: "relevant" },
      { n: 5, title: "p5.js 2.0 ships", url: "https://ex.test/5", source: "r/p5js", topic: "Creative tech and AI art", why: "a creative coding milestone", kind: "must" },
      { n: 6, title: "TouchDesigner tutorial", url: "https://ex.test/6", source: "r/touchdesigner", topic: "Creative tech and AI art", why: "a gpu patching walkthrough", kind: "relevant" },
      { n: 7, title: "Diffusion era ends", url: "https://ex.test/7", source: "r/StableDiffusion", topic: "Creative tech and AI art", why: "what replaced it", kind: "relevant" },
      { n: 8, title: "A data hoarder's vault", url: "https://ex.test/8", source: "r/DataHoarder", topic: "Everything else", why: "an archival approach worth copying", kind: "relevant" },
      { n: 9, title: "Hardware hacking weekend", url: "https://ex.test/9", source: "r/hardwarehacking", topic: "Everything else", why: "a teardown that teaches", kind: "relevant" },
      { n: 10, title: "ESP32 project roundup", url: "https://ex.test/10", source: "r/esp32", topic: "Everything else", why: "a dozen buildable ideas", kind: "relevant" },
      { n: 11, title: "Indie SaaS pricing", url: "https://ex.test/11", source: "r/SaaS", topic: "Everything else", why: "how solo founders price", kind: "relevant" },
      { n: 12, title: "A reverse-engineering tale", url: "https://ex.test/12", source: "r/ReverseEngineering", topic: "Everything else", why: "a well-told teardown", kind: "relevant" },
      { n: 13, title: "Why old maps lie", url: "https://ex.test/13", source: "r/AskHistorians", topic: "Everything else", why: "a historian corrects a myth", kind: "relevant" },
      { n: 14, title: "The paper that started it", url: "https://ex.test/14", source: "r/MachineLearning", topic: "Rabbit hole", why: "the origin story worth an hour", kind: "rabbit_hole" },
    ];
    const edition: Edition = { date, generatedAt: now.toISOString(), topics: ["Bitcoin and crypto art", "Creative tech and AI art", "Everything else", "Rabbit hole"], items };
    writeFileSync(join(dir, "edition-latest.json"), JSON.stringify(edition));

    const lines = await composeSessionBriefing({ now: () => now, loadReminders: async () => [], readProfile: () => FULL_PROFILE, loadCalendar: async () => [] });

    expect(lines).toEqual([
      "Today's news, not yet told him (/more N, /less N):",
      "  Bitcoin and crypto art",
      "    1. Ordinals auction closes — the market finally moves",
      "    2. ❗ Taproot upgrade lands — protocol news, not price",
      "    3. CryptoArt drop tonight — a live generative release",
      "  Creative tech and AI art",
      "    4. ComfyUI workflow — a new node graph technique",
      "    5. ❗ p5.js 2.0 ships — a creative coding milestone",
      "    6. TouchDesigner tutorial — a gpu patching walkthrough",
      "    7. Diffusion era ends — what replaced it",
      "  Everything else",
      "    8. A data hoarder's vault — an archival approach worth copying",
      "    9. Hardware hacking weekend — a teardown that teaches",
      "    10. ESP32 project roundup — a dozen buildable ideas",
      "    11. Indie SaaS pricing — how solo founders price",
      "    12. A reverse-engineering tale — a well-told teardown",
      "    13. Why old maps lie — a historian corrects a myth",
      "  Rabbit hole",
      "    14. 🐇 The paper that started it — the origin story worth an hour",
    ]);
  });
});

describe("one voice", () => {
  it("never names Flyd's internal helpers in the briefing", async () => {
    const { composeSessionBriefing } = await import("../session-briefing.js");
    const { appendFileSync, mkdirSync } = await import("node:fs");
    const { dirname } = await import("node:path");
    const path = process.env.FLYD_ADVISORIES_PATH!;
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, `${JSON.stringify({
      id: "v1", advisor: "critic", text: "Sam's deadline moved to Friday.", whyNow: "", evidence: ["j:1"],
      confidence: "high", urgency: "normal", topics: ["sam"], createdAt: new Date().toISOString(),
      expires: "2999-01-01", status: "open",
    })}\n`);
    const lines = await composeSessionBriefing({ loadReminders: async () => [], readProfile: () => "## About me\n- x\n## People\n- x\n## Routines\n- x\n## Goals\n- x\n" });
    expect(lines).toContain("On my mind: Sam's deadline moved to Friday.");
    expect(lines.join("\n")).not.toMatch(/Critic|Strategist|Muse|Scout|Crew|crewmate/);
  });
});
