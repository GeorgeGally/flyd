import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { meetingPrepConsented, commitmentCards, commitmentCard, creativeCard, prepareCreativeForConversation, matchingPeople, meetingCard, runProactiveCare, type CareEvent } from "../proactive-care.js";
import { parseCalendarMetadata } from "../proactive-calendar.js";
import { CALENDAR_METADATA_CONTRACT, MEETING_PREP_CONTRACT, SourceContractRegistry } from "../../intelligence/sensors/source-contracts.js";
import type { MemoryEntry } from "../../council/memory-store.js";
import type { Project } from "../../council/projects.js";
import type { Edition } from "../../council/scout.js";
import { activityFromRecords, visibleCareRecords, type ActivityRecord } from "../../conversation-view/activity.js";

const now = new Date("2026-11-15T10:00:00");
const meeting: CareEvent = { id: "event-123", title: "Call with Chris Jones", start: "2026-11-15T10:45:00" };
const memory: MemoryEntry[] = [
  { id: "m1", section: "People", text: "Chris Jones has two children.", date: "2026-11-14", tier: "aging" },
  { id: "m2", section: "People", text: "Chris Jones likes editorial design.", date: "2026-11-14", tier: "aging" },
  { id: "m3", section: "People", text: "Chris Smith is planning a trip.", date: "2026-11-14", tier: "aging" },
];
const project: Project = {
  id: "typo", name: "Generative Typography", kind: "creative", status: "active",
  what: "Visual generative typography branding", now: "Exploring experimental typography",
  people: [], repos: [], updated: "2026-11-15",
};
const edition: Edition = {
  date: "2026-11-15", generatedAt: now.toISOString(), topics: ["design"],
  items: [
    { n: 1, title: "Generative Typography design archive", topic: "visual design", why: "Generative typography work", kind: "relevant", url: "https://studio.example.org/generative-typography", source: "Studio A" },
    { n: 2, title: "Visual Generative Typography experiments", topic: "visual design", why: "Visual lettering and typography", kind: "relevant", url: "https://archive.example.org/typography", source: "Studio B" },
    { n: 3, title: "Unrelated travel story", topic: "travel", why: "A place to visit", kind: "relevant", url: "https://news.example.org/travel", source: "News" },
  ],
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("proactive local personal care", () => {
  it("parses minimal macOS Calendar metadata, no notes or addresses", () => {
    const events = parseCalendarMetadata(
      "event-123\tCall with Chris Jones\t2026-11-15T10:45:00\n" +
      "event-123\tCall with Chris Jones\t2026-11-15T10:45:00\n" +
      "bad\tmalformed\t2026-11-15\n",
    );
    expect(events).toEqual([meeting]);
  });

  it("prioritizes the nearest valid meeting regardless of Calendar enumeration order", () => {
    const entries = parseCalendarMetadata(
      "z\\tCall with Chris Jones\\t2026-11-15T11:45:00\\n"
      + "bad\\tImpossible date\\t2026-02-31T10:00:00\\n"
      + "a\\tCall with Chris Jones\\t2026-11-15T10:30:00\\n",
    );
    expect(entries.map((event) => event.id)).toEqual(["a", "z"]);
    expect(entries.some((event) => event.id === "bad")).toBe(false);
  });

  it("requires fresh, unambiguous full-name evidence before a relationship card", () => {
    expect(matchingPeople(meeting, memory, now).map((x) => x.id)).toEqual(["m1", "m2"]);
    const card = meetingCard(meeting, memory, now);
    expect(card?.line).toContain("Chris Jones has two children");
    expect(card?.line).toContain("confirmed 2026-11-14");
    expect(card?.title).toBe("Before Call with Chris Jones");
    expect(meetingCard({ ...meeting, title: "Call with Chris" }, memory, now)).toBeNull();
    expect(matchingPeople({ ...meeting, title: "Call with Chris" }, memory.slice(0, 2), now).map((x) => x.id)).toEqual(["m1", "m2"]);
    expect(meetingCard({ ...meeting, start: "2026-11-15T12:15:00" }, memory, now)).toBeNull();
    expect(meetingCard({ ...meeting, title: "Birthday with Chris Jones" }, memory, now)).toBeNull();
    const stale = memory.map((x) => ({ ...x, date: "2026-01-01" }));
    expect(meetingCard(meeting, stale, now)).toBeNull();
  });

  it("curates only directly related, actual Scout references", () => {
    const card = creativeCard([project], edition, now);
    expect(card?.title).toBe("For Generative Typography");
    expect(card?.stories?.map((story) => story.url).sort()).toEqual([
      "https://studio.example.org/generative-typography",
      "https://archive.example.org/typography",
    ].sort());
    expect(creativeCard([project], { ...edition, date: "2026-11-14" }, now)).toBeNull();
    expect(creativeCard([project], { ...edition, items: edition.items.slice(0, 1) }, now)).toBeNull();
    expect(creativeCard([{ ...project, status: "done" }], edition, now)).toBeNull();
  });

  it("does not read Calendar before explicit source consent and honors its kill switch", async () => {
    vi.stubEnv("FLYD_PERSONAL_BRIEFING", "0");
    let calendarReads = 0;
    const made: ActivityRecord[] = [];
    const deps = {
      now: () => now, projects: () => [project], edition: () => edition,
      record: (record: ActivityRecord) => made.push(record),
      alreadyRecorded: () => false,
      events: async () => { calendarReads++; return [meeting]; },
      memory: () => memory,
      calendarConsent: () => true,
    };
    const out = await runProactiveCare(deps);
    expect(out).toEqual({ meetings: 0, inspiration: 1, commitments: 0, skipped: ["personal_briefing_disabled"] });
    expect(calendarReads).toBe(0);
    expect(made).toHaveLength(1);
    vi.stubEnv("FLYD_PERSONAL_BRIEFING", "1");
    expect((await runProactiveCare({ ...deps, calendarConsent: () => false })).skipped)
      .toContain("calendar_metadata_not_consented");
    expect(calendarReads).toBe(0);
  });

  it("prepares quiet cards once and never pushes notifications", async () => {
    vi.stubEnv("FLYD_PERSONAL_BRIEFING", "1");
    const keys = new Set<string>();
    const made: ActivityRecord[] = [];
    const deps = {
      now: () => now, projects: () => [project], edition: () => edition,
      events: async () => [meeting], memory: () => memory, calendarConsent: () => true,
      record: (record: ActivityRecord) => { made.push(record); keys.add(record.key!); },
      alreadyRecorded: (key: string) => keys.has(key),
    };
    expect(await runProactiveCare(deps)).toMatchObject({ meetings: 1, inspiration: 1 });
    expect(await runProactiveCare(deps)).toMatchObject({ meetings: 0, inspiration: 0 });
    expect(made.map((x) => x.kind)).toEqual(["news", "noted"]);
    expect(made.every((x) => x.state === "done")).toBe(true);
  });

  it("silently attaches sourced inspiration to a live design conversation once per day", () => {
    const made: ActivityRecord[] = [];
    const keys = new Set<string>();
    const deps = {
      now: () => now, edition: () => edition,
      record: (record: ActivityRecord) => { made.push(record); keys.add(record.key!); },
      alreadyRecorded: (key: string) => keys.has(key),
    };
    expect(prepareCreativeForConversation("I'm exploring generative visual typography and design", deps)).toBe(true);
    expect(prepareCreativeForConversation("I'm exploring generative visual typography and design", deps)).toBe(false);
    expect(made).toHaveLength(1);
    expect(made[0]?.title).toBe("References for this direction");
    expect(made[0]?.stories?.length).toBeGreaterThanOrEqual(2);
    expect(prepareCreativeForConversation("Just checking in", deps)).toBe(false);
  });

  it("does not expose a previously prepared meeting when permission is disabled or revoked", () => {
    const meetingNote = meetingCard(meeting, memory, now)!;
    const visual = creativeCard([project], edition, now)!;
    const records: unknown[] = [meetingNote, visual, { key: "ordinary", kind: "noted", title: "Other work", at: now.toISOString() }];
    const allowed = visibleCareRecords(records, { careEnabled: true, meetingEnabled: true });
    expect(allowed).toHaveLength(3);
    const revoked = visibleCareRecords(records, { careEnabled: true, meetingEnabled: false });
    expect(activityFromRecords(revoked, now.getTime()).done.map((item) => item.title))
      .toEqual(["For Generative Typography", "Other work"]);
    const disabled = visibleCareRecords(records, { careEnabled: false, meetingEnabled: false });
    expect(activityFromRecords(disabled, now.getTime()).done.map((item) => item.title))
      .toEqual(["Other work"]);
  });

  it("allows another relevant design direction but caps conversation inspiration at two cards a day", () => {
    const made: ActivityRecord[] = [];
    const keys = new Set<string>();
    const deps = {
      now: () => now, edition: () => edition,
      record: (record: ActivityRecord) => { made.push(record); keys.add(record.key!); },
      alreadyRecorded: (key: string) => keys.has(key),
      countConversationCards: () => keys.size,
    };
    expect(prepareCreativeForConversation("Exploring generative visual typography and design", deps)).toBe(true);
    expect(prepareCreativeForConversation("  Exploring generative visual typography and design!!! ", deps)).toBe(false);
    expect(prepareCreativeForConversation("Visual generative typography and lettering experiments", deps)).toBe(true);
    expect(prepareCreativeForConversation("Exploring a new visual generative typography direction", deps)).toBe(false);
    expect(made).toHaveLength(2);
    expect(made[0]?.key).not.toBe(made[1]?.key);
  });

  it("surfaces a dated, confirmed commitment without inventing an action or deadline", () => {
    const entries: MemoryEntry[] = [
      { id: "promise", section: "Commitments", text: "Send the revised proposal by 2026-11-16.", date: "2026-11-14", tier: "aging" },
      { id: "vague", section: "Commitments", text: "Remember to check with a colleague soon.", date: "2026-11-14", tier: "aging" },
    ];
    const card = commitmentCard(entries, now);
    expect(card).toMatchObject({ kind: "noted", state: "done", title: "Tomorrow: something you committed to" });
    expect(card?.line).toContain("Send the revised proposal");
    expect(commitmentCard(entries.map((entry) => ({ ...entry, date: "2026-01-01" })), now)).toBeNull();
    expect(commitmentCard(entries, new Date("2026-11-20T10:00:00"))).toBeNull();
  });

  it("shows at most three distinct upcoming commitments, closest dates first, and never invents deadlines", async () => {
    const entries: MemoryEntry[] = [
      { id: "a", section: "Commitments", text: "Send proposal by 2026-11-16", date: "2026-11-14", tier: "aging" },
      { id: "b", section: "Commitments", text: "Review budget by 2026-11-15", date: "2026-11-14", tier: "aging" },
      { id: "c", section: "Commitments", text: "Call designer by 2026-11-17", date: "2026-11-14", tier: "aging" },
      { id: "d", section: "Commitments", text: "Finish gallery by 2026-11-17", date: "2026-11-14", tier: "aging" },
      { id: "vague", section: "Commitments", text: "Follow up with someone soon", date: "2026-11-14", tier: "aging" },
    ];
    const cards = commitmentCards(entries, now);
    expect(cards).toHaveLength(3);
    expect(cards[0]?.title).toContain("Today");
    expect(cards[1]?.title).toContain("Tomorrow");
    expect(cards.every((card) => card.line?.includes("(noted 2026-11-14)"))).toBe(true);
    const made: ActivityRecord[] = [];
    const result = await runProactiveCare({
      now: () => now, projects: () => [], edition: () => null,
      memory: () => entries, calendarConsent: () => false,
      record: (item) => made.push(item), alreadyRecorded: () => false,
    });
    expect(result.commitments).toBe(3);
    expect(made).toHaveLength(3);
    expect(made.every((card) => card.key?.startsWith("care:commitment:"))).toBe(true);
  });

  it("drops ambient cards as soon as their context expires", () => {
    const meetingNote = meetingCard(meeting, memory, now);
    const creative = creativeCard([project], edition, now);
    expect(meetingNote).not.toBeNull();
    expect(creative).not.toBeNull();
    expect(activityFromRecords([meetingNote!, creative!], new Date("2026-11-15T10:15:00").getTime()).done).toHaveLength(2);
    expect(activityFromRecords([meetingNote!, creative!], new Date("2026-11-15T10:46:00").getTime()).done).toHaveLength(1);
    expect(activityFromRecords([meetingNote!, creative!], new Date("2026-11-16T01:00:00").getTime()).done).toHaveLength(0);
  });

  it("honors a revoked or disabled calendar metadata source contract", () => {
    const folder = mkdtempSync(join(tmpdir(), "flyd-care-consent-"));
    try {
      const registry = new SourceContractRegistry({ path: join(folder, "source-consents.json") });
      expect(meetingPrepConsented(registry)).toBe(false);
      registry.register(CALENDAR_METADATA_CONTRACT);
      registry.setStatus(CALENDAR_METADATA_CONTRACT.sourceId, "enabled");
      // A prior time-only Calendar grant cannot silently authorize reading event titles.
      expect(meetingPrepConsented(registry)).toBe(false);
      registry.setStatus(MEETING_PREP_CONTRACT.sourceId, "enabled");
      expect(meetingPrepConsented(registry)).toBe(true);
      registry.setStatus(MEETING_PREP_CONTRACT.sourceId, "revoked");
      expect(meetingPrepConsented(registry)).toBe(false);
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  });

  it("disables all proactive work with one switch", async () => {
    vi.stubEnv("FLYD_PROACTIVE_CARE", "0");
    expect(await runProactiveCare({ now: () => now, projects: () => { throw new Error("must not read"); } }))
      .toEqual({ meetings: 0, inspiration: 0, commitments: 0, skipped: ["disabled"] });
  });
});
