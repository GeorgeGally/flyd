import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkSaid, judgeSaid, reviewSaid, screenBeforeDisplay, voiceRules } from "../chief-of-staff.js";
import { readVerdicts, reviewEvidence, runReplyReview, scorecard } from "../reply-review.js";
import { gatherEvidence } from "../../crew/self-improve.js";
import { deliverNotification } from "../../runtime/agenda.js";
import { parseDomainResult } from "../../command/result.js";
import { HANDLE_IT_YOURSELF, notifyRun } from "../../command/scheduler.js";
import { FirstmateDomainTransport, syncFirstmateDomainRuns, type FirstmateExec } from "../../command/firstmate.js";
import { readDomainRun, saveDomainRun } from "../../command/store.js";
import type { DomainRun } from "../../command/types.js";

const GOOD = "Dark mode is live on the GNM site: every page now follows your Mac's setting, and the footer contrast issue is gone.";
const PLACEHOLDER = "Working on it";
const INTERNAL_DECISION = "Firstmate's new turn-end guard needs your call: gate it behind config, or push back.";

/** A Jev reply with the given probabilities, standing in for the TypeSafe API. */
function jev(answers: Record<string, number>, sink: Array<{ state: Record<string, unknown>; questions: Record<string, unknown> }> = []): typeof fetch {
  return (async (_url: unknown, init?: { body?: string }) => {
    const body = JSON.parse(init?.body ?? "{}") as { state: Record<string, unknown>; questions: Record<string, unknown> };
    sink.push(body);
    return {
      ok: true, status: 200,
      json: async () => ({ model: "jev-1.13.0", answers: Object.fromEntries(Object.keys(body.questions).map((id) => [id, { type: "noul", noul: answers[id] ?? 0.05 }])) }),
    };
  }) as unknown as typeof fetch;
}

describe("the chief-of-staff checks", () => {
  let jevSetting: string | undefined;

  beforeEach(() => {
    jevSetting = process.env.FLYD_SELF_REVIEW_JEV;
    process.env.FLYD_SELF_REVIEW_JEV = "1";
  });

  afterEach(() => {
    if (jevSetting === undefined) delete process.env.FLYD_SELF_REVIEW_JEV;
    else process.env.FLYD_SELF_REVIEW_JEV = jevSetting;
  });

  it("passes an outcome-first reply in Flyd's voice", async () => {
    expect(checkSaid({ surface: "chat", text: GOOD, asked: "is dark mode done on GNM?" })).toEqual([]);
    const sink: Array<{ state: Record<string, unknown>; questions: Record<string, unknown> }> = [];
    const shortfalls = await reviewSaid({ surface: "chat", text: GOOD }, { apiKey: "test", fetchFn: jev({ cos_outcome_first: 0.96 }, sink) });
    expect(shortfalls).toEqual([]);
    // One request asks the whole battery, and sends only the declared fields.
    expect(sink).toHaveLength(1);
    expect(Object.keys(sink[0]!.questions).sort()).toEqual(["cos_internal_decision", "cos_off_voice", "cos_outcome_first", "cos_placeholder", "cos_wants_artefact"]);
    expect(Object.keys(sink[0]!.state).sort()).toEqual(["george_said", "surface", "text"]);
  });

  it("fails a \"Working on it\" placeholder wherever George sees it, without asking Jev", async () => {
    for (const surface of ["status", "chat", "notification"] as const) {
      expect(checkSaid({ surface, text: PLACEHOLDER }).map((item) => item.requirement)).toEqual(["real_status"]);
    }
    expect(checkSaid({ surface: "status", text: "Remembering what I know about this" }).map((item) => item.requirement)).toEqual(["real_status"]);
    expect(checkSaid({ surface: "status", text: "Fixing the footer on GNM" })).toEqual([]);
    const sink: Array<{ state: Record<string, unknown>; questions: Record<string, unknown> }> = [];
    await reviewSaid({ surface: "status", text: PLACEHOLDER }, { apiKey: "test", fetchFn: jev({}, sink) });
    expect(sink).toEqual([]);
    expect(screenBeforeDisplay({ surface: "notification", text: "On it, sir." }).hold).toBe(true);
  });

  it("fails a relayed internal decision and the helper it names", () => {
    const shortfalls = checkSaid({ surface: "relay", text: INTERNAL_DECISION });
    expect(shortfalls.map((item) => item.requirement).sort()).toEqual(["backstage_hidden", "decisions_handled"]);
    expect(shortfalls.find((item) => item.requirement === "decisions_handled")?.quote).toBe(INTERNAL_DECISION);
    // Decisions that are his stay his.
    expect(checkSaid({ surface: "relay", text: "The sponsor deck is ready. Should I send it to Nuanu today, or hold it for your edits?" })).toEqual([]);
    // Promising to bring him only his decisions is not asking him one.
    expect(checkSaid({ surface: "relay", text: "The guard is now an opt-in setting, off by default. From here on I'll bring you only what needs your decision." })).toEqual([]);
    // Naming a helper is fine when he asked about it.
    expect(checkSaid({ surface: "chat", text: "Firstmate is reachable again.", asked: "is firstmate back?" })).toEqual([]);
  });

  it("asks Jev only what the checks cannot see, and records its decided answers", async () => {
    const subtle = "There are two ways we could run the nightly check, a cron entry or the Core tick; which would you prefer?";
    expect(checkSaid({ surface: "relay", text: subtle })).toEqual([]);
    const shortfalls = await judgeSaid({ surface: "relay", text: subtle }, { apiKey: "test", fetchFn: jev({ cos_outcome_first: 0.9, cos_internal_decision: 0.93 }) });
    expect(shortfalls).toEqual([expect.objectContaining({ requirement: "decisions_handled", by: "jev", probability: 0.93 })]);
    // An unsure answer is not a shortfall.
    expect(await judgeSaid({ surface: "relay", text: subtle }, { apiKey: "test", fetchFn: jev({ cos_outcome_first: 0.9, cos_internal_decision: 0.6 }) })).toEqual([]);
    // A developer's own key never turns a test into a live Jev call.
    expect(await judgeSaid({ surface: "relay", text: subtle }, { fetchFn: jev({ cos_internal_decision: 0.99 }) })).toEqual([]);
  });

  it("sends nothing to Jev unless opted in, and never anything built from his accounts", async () => {
    const subtle = "There are two ways we could run the nightly check, a cron entry or the Core tick; which would you prefer?";
    const sink: Array<{ state: Record<string, unknown>; questions: Record<string, unknown> }> = [];
    delete process.env.FLYD_SELF_REVIEW_JEV;
    expect(await judgeSaid({ surface: "relay", text: subtle }, { apiKey: "test", fetchFn: jev({ cos_internal_decision: 0.99 }, sink) })).toEqual([]);
    process.env.FLYD_SELF_REVIEW_JEV = "0";
    expect(await judgeSaid({ surface: "relay", text: subtle }, { apiKey: "test", fetchFn: jev({ cos_internal_decision: 0.99 }, sink) })).toEqual([]);
    expect(sink).toEqual([]);

    process.env.FLYD_SELF_REVIEW_JEV = "1";
    const fetchFn = jev({ cos_internal_decision: 0.99 }, sink);
    await reviewSaid({ surface: "chat", text: "Nothing urgent today; two invitations, both declined last week.", tools: ["email_search: 3 results", "email_read: ok"] }, { apiKey: "test", fetchFn });
    await reviewSaid({ surface: "chat", text: "Sarah's email says the venue moved to Thursday." }, { apiKey: "test", fetchFn });
    await reviewSaid({ surface: "relay", text: "Thursday works for the venue.", asked: "what did Sarah say on WhatsApp?" }, { apiKey: "test", fetchFn });
    await reviewSaid({ surface: "chat", text: "The budget sheet in your Drive shows R12,400 left this month." }, { apiKey: "test", fetchFn });
    expect(sink).toEqual([]);
  });

  it("holds George's voice to the phrases his own files rule out", () => {
    const rules = voiceRules(null, [
      "- George's standing rule for Flyd: never narrate internal routing or handoffs. No \"Passing this to Firstmate\", no \"One moment please sir\", no \"Let me check\".",
      "- Never use reflexive self-blame or apology phrasing like 'that's on me' or 'my bad'.",
      "- George avoids rhetorical constructions such as “it’s not X, it’s Y”.",
    ].join("\n"));
    expect(rules.banned).toEqual(expect.arrayContaining(["passing this to firstmate", "one moment please sir", "let me check", "that's on me", "my bad"]));
    expect(rules.banned.some((phrase) => phrase.includes(" x"))).toBe(false);
    expect(checkSaid({ surface: "chat", text: "The invoice went out late, my bad. It's sent now." }, rules).map((item) => item.requirement)).toEqual(["his_voice"]);
    expect(checkSaid({ surface: "relay", text: "Captain, the build is green." }).map((item) => item.requirement)).toEqual(["his_voice"]);
  });
});

describe("before display", () => {
  let commandDir: string;
  let previous: string | undefined;

  beforeEach(() => {
    commandDir = mkdtempSync(join(tmpdir(), "flyd-cos-command-"));
    previous = process.env.FLYD_COMMAND_DIR;
    process.env.FLYD_COMMAND_DIR = commandDir;
  });

  afterEach(() => {
    if (previous === undefined) delete process.env.FLYD_COMMAND_DIR;
    else process.env.FLYD_COMMAND_DIR = previous;
    rmSync(commandDir, { recursive: true, force: true });
  });

  function decisionRun(brief: string): DomainRun {
    const parsed = parseDomainResult(JSON.stringify({ status: "needs_decision", brief }));
    return {
      id: "domain-cos-1",
      request: { id: "domain-cos-1", domain: "coding", originalMessage: "Add a turn-end guard", intendedOutcome: "Add a turn-end guard", doneWhen: ["it holds"], createdAt: "2026-10-14T00:00:00.000Z" },
      owner: "FirstMate", status: "needs_decision",
      createdAt: "2026-10-14T00:00:00.000Z", updatedAt: "2026-10-14T00:00:00.000Z",
      transport: { kind: "firstmate", requestId: "domain-cos-1" },
      result: parsed.result,
    };
  }

  it("returns a relayed internal decision to the work instead of showing it to George", async () => {
    const shown: string[] = [];
    const sent: Array<{ body: string; from?: string; kind: string }> = [];
    const run = decisionRun(INTERNAL_DECISION);
    await notifyRun(run, async (_title, message) => { shown.push(message); }, async (input) => {
      sent.push({ body: input.body, kind: input.kind, ...(input.from ? { from: input.from } : {}) });
      return { delivered: true, run: { ...input.run, messages: [{ id: "m1", kind: input.kind, body: input.body, at: "2026-10-14T00:01:00.000Z", from: "flyd" }] } };
    });
    expect(shown).toEqual([]);
    expect(sent).toEqual([{ body: HANDLE_IT_YOURSELF, kind: "decision", from: "flyd" }]);
    expect(readDomainRun("domain-cos-1")?.notified).toBeUndefined();
    expect(readVerdicts().find((verdict) => verdict.source === "domain:domain-cos-1")).toMatchObject({ held: true, shortfalls: [{ requirement: "decisions_handled" }] });

    // Asked again after Flyd sent it back: now it is his.
    const again = { ...decisionRun(INTERNAL_DECISION), messages: [{ id: "m1", kind: "decision" as const, body: HANDLE_IT_YOURSELF, at: "2026-10-14T00:01:00.000Z", from: "flyd" as const }] };
    await notifyRun(again, async (_title, message) => { shown.push(message); }, async () => { throw new Error("not again"); });
    expect(shown).toEqual([`I need your decision: ${INTERNAL_DECISION}`]);
  });

  it("brings George the boss's next reply after sending it back, even the same question again", async () => {
    const brief = INTERNAL_DECISION;
    const ask = JSON.stringify({ status: "needs_decision", brief });
    const original = { id: "note-1", request_id: "domain-cos-1", acknowledged: true, reply: { id: "note-1", at: "2026-10-14T01:00:00.000Z", body: ask, cursor: "000000000001" } };
    const handled: unknown[] = [original];
    const sentNotes: string[] = [];
    const exec: FirstmateExec = async (_script, args, options) => {
      if (args[0] === "note") {
        sentNotes.push(String(options.input));
        return { stdout: JSON.stringify({ id: "note-2", saved: true }), stderr: "" };
      }
      return { stdout: JSON.stringify({ pending: [], handled }), stderr: "" };
    };
    const transport = new FirstmateDomainTransport({ script: "/fake/fm-inbox.sh", exec });
    saveDomainRun({ ...decisionRun(brief), status: "accepted", result: undefined, transport: { kind: "firstmate", requestId: "domain-cos-1", externalId: "note-1" } });
    const shown: string[] = [];
    const onChanged = (run: DomainRun) => notifyRun(run, async (_title, message) => { shown.push(message); }, (input) => import("../../command/messages.js").then(({ sendRunMessage }) => sendRunMessage({ ...input, transport })));

    await syncFirstmateDomainRuns({ transport, onChanged });
    expect(shown).toEqual([]);
    expect(sentNotes).toHaveLength(1);
    // Nothing new from the boss: still nothing for George.
    expect(await syncFirstmateDomainRuns({ transport, onChanged })).toEqual([]);
    expect(shown).toEqual([]);

    const flydNote = readDomainRun("domain-cos-1")!.messages!.find((message) => message.from === "flyd")!;
    handled.push({ id: "note-2", request_id: flydNote.id, acknowledged: true, reply: { id: "note-2", at: "2026-10-14T02:00:00.000Z", body: ask, cursor: "000000000002" } });
    await syncFirstmateDomainRuns({ transport, onChanged });
    expect(shown).toEqual([`I need your decision: ${brief}`]);
    expect(sentNotes).toHaveLength(1);
    expect(readDomainRun("domain-cos-1")?.notified).toBe(true);
  });

  it("brings George a decision about his money even when it mentions how the work runs", async () => {
    const shown: string[] = [];
    const brief = "Do you want me to retry the Stripe payment or cancel the subscription?";
    await notifyRun(decisionRun(brief), async (_title, message) => { shown.push(message); }, async () => { throw new Error("should not be returned"); });
    expect(shown).toEqual([`I need your decision: ${brief}`]);
  });

  it("does not send a decision back to a boss that never replies", async () => {
    const shown: string[] = [];
    const run: DomainRun = { ...decisionRun(INTERNAL_DECISION), owner: "Librarian", request: { ...decisionRun(INTERNAL_DECISION).request, domain: "knowledge" }, transport: { kind: "native", requestId: "domain-cos-1" } };
    await notifyRun(run, async (_title, message) => { shown.push(message); }, async () => { throw new Error("should not be returned"); });
    expect(shown).toEqual([`I need your decision: ${INTERNAL_DECISION}`]);
  });

  it("still brings George a decision that is his", async () => {
    const shown: string[] = [];
    await notifyRun(decisionRun("The CapFive privacy page is ready; publish it to the live site now?"), async (_title, message) => { shown.push(message); }, async () => { throw new Error("should not be returned"); });
    expect(shown).toEqual(["I need your decision: The CapFive privacy page is ready; publish it to the live site now?"]);
  });

  it("keeps a placeholder notification from George and records it", async () => {
    expect(await deliverNotification("Flyd", "Working on it")).toBe(false);
    expect(readVerdicts().filter((verdict) => verdict.held && verdict.text === "Working on it")).toHaveLength(1);
  });
});

describe("the review pass", () => {
  let flydDir: string;
  let reviewDir: string;

  beforeEach(() => {
    flydDir = mkdtempSync(join(tmpdir(), "flyd-cos-home-"));
    reviewDir = join(flydDir, "self-review");
    mkdirSync(join(flydDir, "journal"), { recursive: true });
    mkdirSync(join(flydDir, "view", "asks"), { recursive: true });
    writeFileSync(join(flydDir, "journal", "2026-10-14.jsonl"), `${JSON.stringify({ id: "t1", at: "2026-10-14T08:00:00.000Z", user: "is dark mode done?", assistant: GOOD })}\n`);
    writeFileSync(join(flydDir, "view", "asks", "a1.json"), JSON.stringify({ id: "a1", at: "2026-10-14T08:10:00.000Z", text: "[Captain is replying from Flyd to ask:x]\n\nhow's the guard going?", answer: PLACEHOLDER, answeredAt: "2026-10-14T08:10:05.000Z" }));
    writeFileSync(join(flydDir, "view", "interpretations.json"), JSON.stringify({ k1: { text: INTERNAL_DECISION, at: "2026-10-14T08:20:00.000Z" } }));
  });

  afterEach(() => rmSync(flydDir, { recursive: true, force: true }));

  it("reviews each thing George was shown once and feeds the improver", async () => {
    const now = () => new Date("2026-10-14T09:00:00.000Z");
    const review = async (said: Parameters<typeof checkSaid>[0]) => checkSaid(said);
    const first = await runReplyReview({ flydDir, dir: reviewDir, now, review, rules: { banned: [] } });
    expect(first).toEqual({ status: "reviewed", reviewed: 3, shortfalls: 2 });
    const verdicts = readVerdicts(reviewDir);
    expect(verdicts.find((verdict) => verdict.source === "journal:t1")?.shortfalls).toEqual([]);
    expect(verdicts.find((verdict) => verdict.source === "ask:a1")).toMatchObject({ asked: "how's the guard going?", shortfalls: [{ requirement: "real_status", quote: PLACEHOLDER }] });
    expect(await runReplyReview({ flydDir, dir: reviewDir, now, review, rules: { banned: [] } })).toEqual({ status: "reviewed", reviewed: 0, shortfalls: 0 });

    const evidence = reviewEvidence("2026-10-01T00:00:00.000Z", reviewDir);
    expect(evidence.map((item) => item.id.split(":")[1]).sort()).toEqual(["backstage_hidden", "decisions_handled", "real_status"]);
    expect(evidence.find((item) => item.id.startsWith("review:decisions_handled:"))?.text).toContain(INTERNAL_DECISION);
    const gathered = gatherEvidence({ flydDir, now: now() });
    expect(gathered.filter((item) => item.kind === "review")).toHaveLength(3);

    const card = scorecard({ dir: reviewDir, now: now() });
    expect(card).toContain("1 of 3 things you were shown met the standard (33%)");
    expect(card).toContain("Real status, never a placeholder · 1");
    expect(card.split("\n").length).toBeLessThan(16);
  });
});
