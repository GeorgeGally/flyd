import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkSaid, isIdleNotice, isPlaceholder, judgeSaid, NOTIFICATION_CHARS, notificationLine, reviewSaid, screenBeforeDisplay, voiceRules } from "../chief-of-staff.js";
import { collectSaid, noteSaid, readVerdicts, reviewEvidence, runReplyReview, scorecard } from "../reply-review.js";
import { gatherEvidence } from "../../crew/self-improve.js";
import { deliverNotification } from "../../runtime/agenda.js";
import { parseDomainResult } from "../../command/result.js";
import { notifyRun } from "../../command/scheduler.js";
import { BACKSTAGE_DENYLIST, BACKSTAGE_TELEMETRY, CHAT_BACKSTAGE, firstMatch, hasBackstage } from "../../lib/backstage.js";
import { relayShortfalls } from "../../runtime/honesty-check.js";
import type { DomainRun } from "../../command/types.js";
import type { ExecutiveDecisionRecord } from "../../intelligence/executive/decision-step.js";

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
  it("shares its backstage vocabulary with the display guards", () => {
    for (const pattern of [...CHAT_BACKSTAGE, ...BACKSTAGE_TELEMETRY]) expect(BACKSTAGE_DENYLIST).toContain(pattern);
    const samples = [
      "FirstMate", "first mate", "System-1", "Scout", "crewmate", "worktree", "the Librarian", "no-mistakes", "jev",
      "run id 9f1a2b3", "fm/sidebar", "job-abc123", "merged at a1b2c3d", "domain-0f8c2d4e-1a2b-4c3d-9e8f-0123456789ab",
      "the crew", "a new branch", "a sales pipeline", "PR #200", "The film critics loved it.", "The sidebar now opens on Artefacts.",
    ];
    for (const text of samples) {
      const chatFlags = checkSaid({ surface: "chat", text }).some((item) => item.requirement === "backstage_hidden");
      expect(chatFlags, text).toBe(firstMatch(text, [...CHAT_BACKSTAGE, ...BACKSTAGE_TELEMETRY]) !== null);
      if (chatFlags) expect(hasBackstage(text), text).toBe(true);
    }
    for (const text of ["the crew", "a new branch", "PR #200"]) expect(hasBackstage(text), text).toBe(true);
  });

  it("holds back the relayed lines Flyd itself reported", () => {
    for (const text of [
      "Closest match is the System-1 replay bench for the routing predicates.",
      "I'm making sure FirstMate's answers land in the conversation view.",
      "Firstmate's answers will now land under your note.",
    ]) {
      expect(relayShortfalls(text).map((item) => item.requirement), text).toContain("backstage_hidden");
    }
  });

  it("leaves ordinary speech alone", () => {
    for (const text of ["The film critics loved it.", "My muse is the sea.", "It is a domain-specific language."]) {
      expect(hasBackstage(text), text).toBe(false);
    }
    for (const text of ["The film critics loved it.", "It is a domain-specific language.", "We built a sales pipeline for the shop."]) {
      expect(checkSaid({ surface: "chat", text }).map((item) => item.requirement), text).not.toContain("backstage_hidden");
    }
  });

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

  it("reviews known personal conversation without demanding a work outcome", async () => {
    const sink: Array<{ state: Record<string, unknown>; questions: Record<string, unknown> }> = [];
    const said = { surface: "chat" as const, interactionClass: "conversation" as const, text: "The uncertainty seems to be bothering you more than the wait itself.", asked: "I just wanted to talk about today." };
    expect(await reviewSaid(said, { apiKey: "test", fetchFn: jev({ cos_outcome_first: 0.01, cos_internal_decision: 0.99 }, sink) })).toEqual([]);
    expect(Object.keys(sink[0].questions).sort()).toEqual(["cos_off_voice"]);
    expect(checkSaid({ ...said, text: PLACEHOLDER }).map(s => s.requirement)).toContain("real_status");
    expect(checkSaid({ ...said, text: "Captain, that sounds frustrating." }).map(s => s.requirement)).toContain("his_voice");
    await judgeSaid({ ...said, toolsUnknown: true }, { apiKey: "test", fetchFn: jev({}, sink) });
    await judgeSaid({ ...said, tools: ["email_read: ok"] }, { apiKey: "test", fetchFn: jev({}, sink) });
    expect(sink).toHaveLength(1);
  });

  it("retains work review when a fast answer has no established interaction class", async () => {
    const sink: Array<{ state: Record<string, unknown>; questions: Record<string, unknown> }> = [];
    await judgeSaid({ surface: "chat", asked: "Recommend a launch date.", text: "Launch on Thursday; it leaves a full day for testing." }, { apiKey: "test", fetchFn: jev({}, sink) });
    expect(Object.keys(sink[0].questions)).toEqual(expect.arrayContaining(["cos_outcome_first", "cos_internal_decision"]));
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

  it("uses the ExecutiveDecision record, not raw domain status, for an island notice", async () => {
    const shown: string[] = [];
    const decision: ExecutiveDecisionRecord = {
      schema: "flyd.executive-decision.v1", decisionId: "d", sourceId: "firstmate.change", sourceEventId: "e",
      taskId: "domain-cos-1", disposition: "ask_george", reason: "George owns it", summary: "Choose a direction.",
      evidenceRefs: ["domain-cos-1"], question: "Publish the page or hold it?", options: ["Publish", "Hold"],
      recommendation: { option: "Hold", rationale: "The live effect needs your approval." },
      verification: { status: "unknown", evidenceRefs: [] }, show: true, notify: true, createdAt: "2026-10-21T00:00:00Z",
    };
    const run = decisionRun("The page has choices.");
    await notifyRun(run, async (_title, message) => { shown.push(message); }, undefined, async () => decision);
    expect(shown).toEqual(["Publish the page or hold it? I recommend \"Hold\". The live effect needs your approval."]);
  });

  it("holds back a whole notification that names backstage and records it", async () => {
    expect(await deliverNotification("Flyd", "FirstMate merged the crew branch. The sidebar opens on Artefacts.")).toBe("backstage");
    expect(readVerdicts().filter((verdict) => verdict.held && verdict.text === "FirstMate merged the crew branch. The sidebar opens on Artefacts.")).toHaveLength(1);
  });

  it("keeps a placeholder notification from George and records it", async () => {
    expect(await deliverNotification("Flyd", "Working on it")).toBe("placeholder");
    expect(readVerdicts().filter((verdict) => verdict.held && verdict.text === "Working on it")).toHaveLength(1);
  });
});

describe("notifications", () => {
  it("never pass on a coding session idle at its prompt", async () => {
    expect(isIdleNotice("Claude", "Claude is waiting for your input")).toBe(true);
    expect(isIdleNotice("Claude: waiting on your input", "flyd-cos-voice")).toBe(true);
    expect(isIdleNotice("Claude", "Claude needs your permission to use Bash")).toBe(false);
    expect(isIdleNotice("Flyd", "The CapFive redirects are live.")).toBe(false);
    expect(isIdleNotice("Flyd", "The DreamHost invoice needs your attention")).toBe(false);
    expect(isIdleNotice("Agenda", "The crew is waiting for your input on the logo")).toBe(false);
    expect(isIdleNotice("Codex", "Codex needs your attention")).toBe(true);
    expect(await deliverNotification("Claude", "Claude is waiting for your input")).toBe("idle");
  });


  it("are one line, outcome first", () => {
    expect(notificationLine("Sir, done. The redirects are live on capfive.com. I also checked every old address and cleared the cache.")).toBe("The redirects are live on capfive.com. I also checked every old address and cleared the cache.");
    expect(notificationLine("Your 3pm with Sam moved. It is now 4:30 at the studio.")).toBe("Your 3pm with Sam moved. It is now 4:30 at the studio.");
    expect(notificationLine("Sir, done. The redirects are live on capfive.com. I also checked every old address on the member area, the login page and the deals pages, and cleared the cache twice.")).toBe("The redirects are live on capfive.com.");
    const long = notificationLine(`The Good Neighbours deploy is blocked because ${"the hosting provider keeps rejecting the key ".repeat(5)}and nothing else.`);
    expect(long.length).toBeLessThanOrEqual(NOTIFICATION_CHARS);
    expect(long.endsWith("…")).toBe(true);
    expect(long).not.toContain("\n");
    expect(notificationLine("- **Island fix** merged: https://github.com/GeorgeGally/flyd/pull/162")).toBe("Island fix merged: https://github.com/GeorgeGally/flyd/pull/162");
  });

  it("skip a placeholder opening for the sentence that says something", () => {
    expect(notificationLine("Looking into it. Your flight to Joburg moved to 14:20.")).toBe("Your flight to Joburg moved to 14:20.");
    expect(notificationLine("Sir, you're right. The CapFive redirects are live.")).toBe("The CapFive redirects are live.");
    expect(isPlaceholder(notificationLine("Looking into it. Still working on it."))).toBe(true);
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

  it("includes FirstMate launch attempts in the self-improvement evidence", () => {
    mkdirSync(reviewDir, { recursive: true });
    writeFileSync(join(reviewDir, "firstmate-session.jsonl"), `${JSON.stringify({ at: "2026-10-14T08:30:00.000Z", runtime: "claude", outcome: "usage_limited" })}\n`);
    expect(reviewEvidence("2026-10-01T00:00:00.000Z", reviewDir)).toContainEqual({
      id: "firstmate-session:2026-10-14T08:30:00.000Z:claude:usage_limited",
      kind: "domain",
      at: "2026-10-14T08:30:00.000Z",
      text: "FirstMate session launch via claude: usage_limited.",
    });
  });

  it("drops successful launches and collapses repeated launch failures", () => {
    mkdirSync(reviewDir, { recursive: true });
    writeFileSync(join(reviewDir, "firstmate-session.jsonl"), [
      { at: "2026-10-14T08:00:00.000Z", runtime: "claude", outcome: "started" },
      { at: "2026-10-14T08:10:00.000Z", runtime: "claude", outcome: "usage_limited" },
      { at: "2026-10-14T08:20:00.000Z", runtime: "claude", outcome: "usage_limited" },
    ].map((entry) => JSON.stringify(entry)).join("\n") + "\n");
    const launched = reviewEvidence("2026-10-01T00:00:00.000Z", reviewDir).filter((item) => item.id.startsWith("firstmate-session:"));
    expect(launched).toEqual([{
      id: "firstmate-session:2026-10-14T08:20:00.000Z:claude:usage_limited",
      kind: "domain",
      at: "2026-10-14T08:20:00.000Z",
      text: "FirstMate session launch via claude: usage_limited (2 attempts).",
    }]);
  });

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

  it("never sends window answers, agenda results or notifications to Jev, whose tools are not recorded", async () => {
    const briefing = "Nothing urgent: Sarah confirmed Thursday at 7; the R4,000 venue deposit is due Friday.";
    writeFileSync(join(flydDir, "view", "asks", "a1.json"), JSON.stringify({ id: "a1", at: "2026-10-14T08:10:00.000Z", text: "anything I should know?", answer: briefing, answeredAt: "2026-10-14T08:10:05.000Z" }));
    writeFileSync(join(flydDir, "inbox.jsonl"), `${JSON.stringify({ id: "r1", itemId: "i1", at: "2026-10-14T08:30:00.000Z", task: "Morning briefing", status: "ok", result: `${briefing} Enjoy the day.` })}\n`);
    mkdirSync(reviewDir, { recursive: true });
    writeFileSync(join(reviewDir, "said.jsonl"), `${JSON.stringify({ at: "2026-10-14T08:40:00.000Z", surface: "notification", source: "notification", text: "Sarah confirmed Thursday at 7." })}\n`);
    writeFileSync(join(flydDir, "view", "interpretations.json"), "{}");
    const sink: Array<{ state: Record<string, unknown>; questions: Record<string, unknown> }> = [];
    const previous = process.env.FLYD_SELF_REVIEW_JEV;
    process.env.FLYD_SELF_REVIEW_JEV = "1";
    try {
      const review = (said: Parameters<typeof checkSaid>[0], rules: { banned: string[] }) => reviewSaid(said, { rules, apiKey: "test", fetchFn: jev({ cos_outcome_first: 0.96 }, sink) });
      const result = await runReplyReview({ flydDir, dir: reviewDir, now: () => new Date("2026-10-14T09:00:00.000Z"), review, rules: { banned: [] } });
      expect(result.reviewed).toBe(4);
    } finally {
      if (previous === undefined) delete process.env.FLYD_SELF_REVIEW_JEV;
      else process.env.FLYD_SELF_REVIEW_JEV = previous;
    }
    expect(sink.map((request) => request.state.text)).toEqual([GOOD]);
  });
});


it("lets ordinary conversation acknowledge a feeling without turning it into a work outcome", async () => {
  expect(checkSaid({ surface: "chat", interactionClass: "conversation", text: "Of course you're exhausted. That was a rough evening.", asked: "I'm exhausted tonight." })).toEqual([]);
});

it("keeps conversation local when source provenance is unknown", async () => {
  const sink: Array<{ state: Record<string, unknown>; questions: Record<string, unknown> }> = [];
  expect(await reviewSaid({ surface: "chat", interactionClass: "conversation", text: "That sounds exhausting.", toolsUnknown: true }, { apiKey: "test", fetchFn: jev({}, sink) })).toEqual([]);
  expect(sink).toEqual([]);
  expect(checkSaid({ surface: "chat", interactionClass: "conversation", text: "I asked the Council whether you should rest." }).map((item) => item.requirement)).toContain("backstage_hidden");
});

it("uses only existing voice judgment for conversation, without transmitting evidence references", async () => {
  const before = process.env.FLYD_SELF_REVIEW_JEV;
  process.env.FLYD_SELF_REVIEW_JEV = "1";
  try {
    const sink: Array<{ state: Record<string, unknown>; questions: Record<string, unknown> }> = [];
    expect(await reviewSaid({ surface: "chat", interactionClass: "conversation", text: "That sounds exhausting.", evidenceRefs: ["private:source"], taskState: "none" }, { apiKey: "test", fetchFn: jev({}, sink) })).toEqual([]);
    expect(sink).toHaveLength(1);
    expect(Object.keys(sink[0]!.questions)).toEqual(["cos_off_voice"]);
    expect(sink[0]!.state).toEqual({ text: "That sounds exhausting.", surface: "chat", george_said: "" });
  } finally {
    if (before === undefined) delete process.env.FLYD_SELF_REVIEW_JEV;
    else process.env.FLYD_SELF_REVIEW_JEV = before;
  }
});


it("retains interaction and unknown-source restrictions through the existing review store", async () => {
  const dir = mkdtempSync(join(tmpdir(), "flyd-review-context-"));
  try {
    const said = { surface: "chat", interactionClass: "conversation", text: "Some evenings take more out of you than others.", toolsUnknown: true, taskState: "none", evidenceRefs: ["source:test"] } as const;
    noteSaid({ ...said, evidenceRefs: [...said.evidenceRefs] }, dir);
    const collected = collectSaid({ flydDir: dir, dir, since: "2000-01-01T00:00:00.000Z" });
    expect(collected).toHaveLength(1);
    expect(collected[0]).toMatchObject(said);
    await runReplyReview({ flydDir: dir, dir, rules: { banned: [] }, review: async (input) => {
      expect(input).toMatchObject(said);
      return [];
    } });
    expect(readVerdicts(dir)[0]).toMatchObject({ interactionClass: "conversation", taskState: "none", evidenceRefs: ["source:test"] });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
