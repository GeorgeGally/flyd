import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { advisoriesPath, openAdvisories, parseAdvisories, pruneAdvisories, readAdvisories, runAdvisors, sameIdea, updateAdvisoryStatus, type Advisory } from "../advisors.js";
import { appendJournalTurn, readJournalSince } from "../journal.js";
import { collectNewCaptures, parseLibrarianProposal, readLibrarianState, runLibrarian } from "../librarian.js";
import { applyMemoryOps, entryId, readMemoryEntries } from "../memory-store.js";
import { consultMuse, museCandidates, parseMuseReply } from "../muse.js";
import { readTaste, writeTaste } from "../taste.js";
import { runCouncilPass } from "../council.js";

let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "flyd-council-"));
  process.env.FLYD_JOURNAL_DIR = join(home, "journal");
  process.env.FLYD_MEMORY_DIR = join(home, "mem");
  process.env.FLYD_COUNCIL_DIR = join(home, "council");
  process.env.FLYD_ADVISORIES_PATH = join(home, "council", "advisories.jsonl");
  process.env.FLYD_LIBRARIAN_STATE = join(home, "council", "librarian-state.json");
  process.env.FLYD_USER_PROFILE = join(home, "USER.md");
  process.env.FLYD_TASTE_FILE = join(home, "TASTE.md");
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

const at = (iso: string) => new Date(iso);

describe("journal", () => {
  it("keeps one continuous record across launches and reads from a cursor", () => {
    const first = appendJournalTurn({ user: "hi", assistant: "hello", at: at("2026-09-26T10:00:00Z") });
    appendJournalTurn({ user: "Maya lands Thursday", assistant: "Noted", at: at("2026-09-27T09:00:00Z") });
    expect(readJournalSince(null).map((turn) => turn.user)).toEqual(["hi", "Maya lands Thursday"]);
    expect(readJournalSince(first.at).map((turn) => turn.user)).toEqual(["Maya lands Thursday"]);
  });
});

describe("librarian", () => {
  it("curates new journal turns and captures, then advances its cursors", async () => {
    appendJournalTurn({ user: "I moved the CleanX launch to 3 October", assistant: "Got it", at: at("2026-09-27T09:00:00Z") });
    const raw = join(home, "raw");
    mkdirSync(raw);
    writeFileSync(join(raw, "2026-09-27-note.md"), "---\nsource: cli\n---\n\nMaya's birthday is 12 March, she loves orchids.\n");
    writeFileSync(join(raw, "runtime-event-x.md"), "---\n---\n\nworker finished\n");
    const prompts: string[] = [];
    const complete = vi.fn(async (prompt: string) => {
      prompts.push(prompt);
      return JSON.stringify({
        memory_ops: [
          { op: "add", section: "Commitments", text: "CleanX launch moved to 3 October 2026", tier: "perishable", sources: ["j:x"] },
          { op: "add", section: "People", text: "Maya's birthday is 12 March; she loves orchids", sources: ["cap:2026-09-27-note"] },
        ],
        profile_ops: [{ section: "People", fact: "Partner: Maya" }],
        observations: ["Launch date slipped once already"],
      });
    });
    const result = await runLibrarian({ complete, rawDir: raw, now: () => at("2026-09-27T10:00:00Z") });
    expect(result).toMatchObject({ turns: 1, captures: 1, profileAdded: 1, observations: ["Launch date slipped once already"] });
    expect(prompts[0]).toContain("George: I moved the CleanX launch to 3 October");
    expect(prompts[0]).toContain("[cap:2026-09-27-note] Maya's birthday");
    expect(prompts[0]).not.toContain("worker finished");
    expect(readMemoryEntries().map((entry) => entry.text)).toEqual(["CleanX launch moved to 3 October 2026", "Maya's birthday is 12 March; she loves orchids"]);
    expect(readFileSync(process.env.FLYD_USER_PROFILE!, "utf8")).toContain("Partner: Maya");
    // Nothing new → no second model call.
    expect(await runLibrarian({ complete, rawDir: raw, now: () => at("2026-09-27T11:00:00Z") })).toMatchObject({ skipped: "nothing_new" });
    expect(complete).toHaveBeenCalledTimes(1);
    expect(readLibrarianState().runs).toBe(1);
  });

  it("closes a commitment that finished work proves done, even when nothing else is new", async () => {
    const now = at("2026-09-28T10:00:00Z");
    applyMemoryOps([
      { op: "add", section: "Commitments", text: "Flyd still needs to switch the purple text in its terminal to green.", tier: "perishable" },
      { op: "add", section: "Commitments", text: "Send the GNM invoice chase to whoever holds the budget.", tier: "perishable" },
    ], { now });
    const [purple, gnm] = readMemoryEntries();
    const finishedWork = vi.fn(async () => [
      { id: "done:flyd@5e2748b", at: "2026-09-28T02:10:00Z", source: "commit" as const, text: "flyd: feat(flyd): a PA's opening, one green voice, honest delegation" },
    ]);
    const prompts: string[] = [];
    const complete = vi.fn(async (prompt: string) => {
      prompts.push(prompt);
      return JSON.stringify({ memory_ops: [{ op: "archive", id: purple.id, reason: "done: [done:flyd@5e2748b]" }], profile_ops: [], observations: [] });
    });
    const result = await runLibrarian({ complete, finishedWork, rawDir: join(home, "none"), now: () => now });
    expect(result.memory).toMatchObject({ archived: 1 });
    expect(prompts[0]).toContain("[done:flyd@5e2748b] 2026-09-28 flyd: feat(flyd): a PA's opening, one green voice");
    expect(prompts[0]).toContain("For every Commitments entry, stale or not");
    expect(readMemoryEntries().map((entry) => entry.id)).toEqual([gnm.id]);
    expect(readFileSync(join(home, "mem", "memory-archive.md"), "utf8")).toContain("done: [done:flyd@5e2748b]");
    // The next pass only looks at work finished after this one.
    await runLibrarian({ complete, finishedWork, rawDir: join(home, "none"), now: () => at("2026-09-28T12:00:00Z") });
    expect(finishedWork.mock.calls[1]).toEqual([now]);
  });

  it("keeps its cursors when the model returns no proposal, so the slice is retried", async () => {
    appendJournalTurn({ user: "remember I switched to the standing desk", assistant: "ok", at: at("2026-09-27T09:00:00Z") });
    await expect(runLibrarian({ complete: async () => "", rawDir: join(home, "none") })).rejects.toThrow("cursors kept for retry");
    expect(readLibrarianState().journalCursor).toBeNull();
  });

  it("ignores malformed proposals and skips tiny captures", () => {
    expect(parseLibrarianProposal("no json")).toEqual({ memoryOps: [], profileOps: [], observations: [], projectOps: [], tasteOps: [] });
    expect(parseLibrarianProposal('{"memory_ops":[{"op":"add","text":"x"},"junk"],"profile_ops":[{"fact":""}]}').memoryOps).toHaveLength(1);
    const raw = join(home, "raw2");
    mkdirSync(raw);
    writeFileSync(join(raw, "a.md"), "---\n---\n\nok\n");
    utimesSync(join(raw, "a.md"), new Date(), new Date());
    expect(collectNewCaptures(0, raw)).toEqual([]);
  });

  it("curates his taste on the same pass: folds a near-duplicate and retires a generic rule", async () => {
    writeTaste({
      rules: [
        { id: "keep0001", text: "Reuse the pattern from other pages.", scope: "personal", count: 2, projects: [], evidence: [] },
        { id: "drop0001", text: "Use the existing page style.", scope: "personal", count: 1, projects: [], evidence: [] },
        { id: "gen00001", text: "Never hard-code an API key.", scope: "personal", count: 1, projects: [], evidence: [] },
      ],
      vetoed: [], names: {},
    });
    appendJournalTurn({ user: "hi", assistant: "hello", at: at("2026-09-27T09:00:00Z") });
    const complete = vi.fn(async () => {
      return JSON.stringify({ taste_ops: [
        { op: "fold", id: "keep0001", merge: "drop0001", reason: "same point" },
        { op: "retire", id: "gen00001", reason: "generic truism" },
      ] });
    });
    const result = await runLibrarian({ complete, rawDir: join(home, "none"), now: () => at("2026-09-27T10:00:00Z") });
    expect(result.taste).toMatchObject({ folded: 1, retired: 1 });
    const after = readTaste();
    expect(after.rules.map((rule) => rule.text)).toEqual(["Reuse the pattern from other pages."]);
    expect(after.retired?.map((rule) => rule.text)).toEqual(["Never hard-code an API key."]);
  });
});

describe("advisors", () => {
  it("keeps only evidenced advisories, bounds expiry, and never repeats one", async () => {
    const now = at("2026-09-27T10:00:00Z");
    const reply = JSON.stringify({ advisories: [
      { text: "The CleanX launch has slipped twice; the store review takes up to 7 days.", why_now: "3 Oct is 6 days away", evidence: ["j:a1"], confidence: "high", urgency: "high", topics: ["cleanx", "launch"], expires: "2026-10-03" },
      { text: "Unevidenced worry", evidence: [] },
    ] });
    const parsed = parseAdvisories("critic", reply, now);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({ advisor: "critic", urgency: "high", topics: ["cleanx", "launch"], expires: "2026-10-03", status: "open" });
    expect(parseAdvisories("critic", JSON.stringify({ advisories: [{ text: "x", evidence: ["j:1"], expires: "2027-12-01" }] }), now)[0].expires).toBe("2026-10-27");

    const complete = vi.fn(async (prompt: string) => prompt.includes("Critic") ? reply : '{"advisories": []}');
    const first = await runAdvisors({ profile: null, memory: null, recentTurns: [], observations: [] }, { complete, now: () => now });
    expect(first).toHaveLength(1);
    expect(complete).toHaveBeenCalledTimes(2);
    expect(await runAdvisors({ profile: null, memory: null, recentTurns: [], observations: [] }, { complete, now: () => now })).toEqual([]);
    expect(complete.mock.calls[2][0]).toContain("Already open (do not repeat)");
    updateAdvisoryStatus(first[0].id, "dismissed", now);
    expect(openAdvisories(now)).toEqual([]);
    expect(readAdvisories(advisoriesPath())[0].status).toBe("dismissed");
  });
});

describe("advisory pruning", () => {
  const make = (id: string, advisor: "critic" | "strategist", topics: string[], urgency: Advisory["urgency"] = "normal"): Advisory => ({
    id, advisor, text: id, whyNow: "", evidence: ["j:1"], confidence: "medium", urgency, topics,
    createdAt: "2026-09-27T00:00:00Z", expires: "2026-10-27", status: "open",
  });

  it("keeps one advisory per idea and caps each advisor's open list", () => {
    expect(sameIdea(make("a", "strategist", ["posttraction", "little organic baby", "tiktok"]), make("b", "strategist", ["little organic baby", "tiktok", "koko"]))).toBe(true);
    expect(sameIdea(make("a", "critic", ["cleanx", "launch"]), make("b", "critic", ["koko", "investor"]))).toBe(false);
    const pool = [
      make("dup-low", "strategist", ["little organic baby", "tiktok"], "low"),
      make("dup-high", "strategist", ["little organic baby", "tiktok"], "high"),
      ...["one", "two", "three", "four", "five"].map((word) => make(`c-${word}`, "critic", [word])),
    ];
    const { kept, retired } = pruneAdvisories(pool);
    const open = kept.filter((advisory) => advisory.status === "open").map((advisory) => advisory.id);
    expect(open).toContain("dup-high");
    expect(open).not.toContain("dup-low");
    expect(open.filter((id) => id.startsWith("c-"))).toHaveLength(4);
    expect(retired).toBe(2);
  });
});

describe("muse", () => {
  it("finds candidates locally and stays silent without them", async () => {
    const now = at("2026-09-27T10:00:00Z");
    applyMemoryOps([{ op: "add", section: "People", text: "Maya lands Thursday on the Qatar flight from Lisbon" }], { now });
    expect(museCandidates("what should I cook tonight?", "", { advisories: [], memory: readMemoryEntries(), notes: [] })).toEqual([]);
    const candidates = museCandidates("I need to plan Thursday, maybe the Lisbon trip too", "", { advisories: [], memory: readMemoryEntries(), notes: [] });
    expect(candidates[0]).toMatchObject({ kind: "memory", id: entryId("Maya lands Thursday on the Qatar flight from Lisbon") });

    const complete = vi.fn(async () => "NONE");
    expect(await consultMuse("what should I cook tonight?", "Pasta.", { complete, now: () => now })).toBeNull();
    expect(complete).not.toHaveBeenCalled();
  });

  it("speaks once, marks the advisory shown, respects the daily cap, and never repeats", async () => {
    const now = at("2026-09-27T10:00:00Z");
    const [advisory] = parseAdvisories("critic", JSON.stringify({ advisories: [
      { text: "CleanX launch is at risk: store review can take 7 days", why_now: "launch is 3 Oct", evidence: ["j:1"], urgency: "normal", topics: ["cleanx", "launch"], expires: "2026-10-03" },
    ] }), now);
    mkdirSync(join(home, "council"), { recursive: true });
    writeFileSync(advisoriesPath(), `${JSON.stringify(advisory)}\n`);
    const said = new Set<string>();
    const complete = vi.fn(async () => `Heads up: the store review can take a week, so submitting CleanX today keeps 3 Oct safe. [advisory:${advisory.id}]`);
    const note = await consultMuse("what's next for the cleanx launch?", "Finish the copy.", { complete, now: () => now, alreadySaid: said });
    expect(note).toMatchObject({ note: "Heads up: the store review can take a week, so submitting CleanX today keeps 3 Oct safe.", advisory: { id: advisory.id } });
    expect(readAdvisories()[0].status).toBe("shown");
    expect(await consultMuse("cleanx launch again", "ok", { complete, now: () => now, alreadySaid: said })).toBeNull();
  });

  it("does not raise a point George already saw this week, even reworded", async () => {
    const now = at("2026-09-27T10:00:00Z");
    const base = { whyNow: "", evidence: ["j:1"], confidence: "high", urgency: "normal", createdAt: now.toISOString(), expires: "2026-10-20" };
    mkdirSync(join(home, "council"), { recursive: true });
    writeFileSync(advisoriesPath(), [
      { ...base, id: "seen", advisor: "strategist", text: "Share the first-wave gate with Little Organic Baby", topics: ["tiktok", "little organic baby"], status: "shown", shownAt: "2026-09-26T10:00:00Z" },
      { ...base, id: "reworded", advisor: "strategist", text: "Little Organic Baby TikTok clips could use the PostTraction gate", topics: ["little organic baby", "tiktok", "posttraction"], status: "open" },
    ].map((row) => JSON.stringify(row)).join("\n") + "\n");
    const complete = vi.fn(async () => "should not be called");
    expect(await consultMuse("plan the little organic baby tiktok videos", "Here's a plan.", { complete, now: () => now })).toBeNull();
    expect(complete).not.toHaveBeenCalled();
  });

  it("parses replies defensively", () => {
    expect(parseMuseReply("NONE")).toBeNull();
    expect(parseMuseReply("none — nothing to add")).toBeNull();
    expect(parseMuseReply("Remember Maya lands Thursday. [memory:ab12cd]")).toEqual({ note: "Remember Maya lands Thursday.", ref: "memory:ab12cd" });
  });
});

describe("council pass", () => {
  it("runs the Librarian then both advisors, and notifies urgent advisories within the daily cap", async () => {
    appendJournalTurn({ user: "cleanx launch is 3 October, store review not submitted yet", assistant: "ok", at: at("2026-09-27T09:00:00Z") });
    const notify = vi.fn(async () => {});
    const complete = vi.fn(async (prompt: string) => {
      if (prompt.startsWith("You are Flyd's Librarian")) {
        return JSON.stringify({ memory_ops: [{ op: "add", section: "Commitments", text: "CleanX launch on 3 October 2026", tier: "perishable" }], observations: ["Store review not submitted"] });
      }
      if (prompt.includes("George's Critic")) {
        return JSON.stringify({ advisories: [{ text: "Submit CleanX for store review today or 3 Oct slips", why_now: "review takes up to 7 days", evidence: ["j:x"], urgency: "high", topics: ["cleanx"], expires: "2026-10-03" }] });
      }
      return '{"advisories": []}';
    });
    const result = await runCouncilPass({ complete, notify, force: true, now: () => at("2026-09-27T10:00:00Z") });
    expect(result.librarian?.turns).toBe(1);
    expect(result.advisories.map((advisory) => advisory.advisor)).toEqual(["critic"]);
    expect(notify).toHaveBeenCalledWith("Flyd", "Submit CleanX for store review today or 3 Oct slips");
    expect(await runCouncilPass({ complete, notify, now: () => at("2026-09-27T10:05:00Z") })).toMatchObject({ skipped: "not_due" });
  });
});
