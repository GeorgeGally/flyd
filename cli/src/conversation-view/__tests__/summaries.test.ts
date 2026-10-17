import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  anthropicProvider,
  askedForArtefact,
  authorSummary,
  defaultProviders,
  digestMarkdown,
  digestReply,
  firstSentence,
  isActionable,
  isRoutine,
  isRoutineAnswer,
  replyArtefact,
  ReplySummarizer,
  SUMMARY_PROMPT,
  xaiProvider,
  type SummaryProvider,
} from "../summaries.js";
import { ABOUT_FIXES, KINSTA_RULES, KINSTA_TABLE } from "./fixtures/replies.js";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "flyd-view-summaries-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function counting(name: string, reply: (text: string) => Promise<string>): SummaryProvider & { calls: string[] } {
  const calls: string[] = [];
  return { name, calls, summarize: (text) => (calls.push(text), reply(text)) };
}

describe("authorSummary", () => {
  it("takes every leading » line as the summary and keeps the rest as the reply", () => {
    expect(authorSummary("» The menu bar is fixed.\n» Nothing else changed.\n\n## Details\n- moved 10px")).toEqual({
      summary: "The menu bar is fixed. Nothing else changed.",
      rest: "## Details\n- moved 10px",
    });
    expect(authorSummary("Captain, done.\n» not a summary")).toBeNull();
  });
});

describe("SUMMARY_PROMPT", () => {
  it("asks for every outcome, decision and ask, and for ROUTINE when there is none", () => {
    expect(SUMMARY_PROMPT).toMatch(/every outcome/);
    expect(SUMMARY_PROMPT).toMatch(/none may be dropped/);
    expect(SUMMARY_PROMPT).toContain("reply exactly ROUTINE");
  });
});

describe("firstSentence", () => {
  it("reads the first sentence of the prose, without Markdown", () => {
    expect(firstSentence("## Status\n\nCaptain, the **menu bar** now sits `10px` higher. It is committed.")).toBe("Status Captain, the menu bar now sits 10px higher.");
    expect(firstSentence("| a | b |\n|---|---|\nAll [three](https://x.y) pages pass! Next.")).toBe("All three pages pass!");
  });
});

describe("digestReply", () => {
  it("keeps all three outcomes of the captain's About report, in a fraction of the length", () => {
    const digest = digestReply(ABOUT_FIXES);
    expect(digest.routine).toBe(false);
    expect(digest.lead).toBe("All three About fixes for phones are committed and pushed to GitHub.");
    expect(digest.points.map((point) => point.label)).toEqual(["Why CapFive cards", "Leadership", "Board pop-up on short phones"]);
    expect(digest.points.map((point) => point.text)).toEqual([
      "I reverted the azure.",
      'The eyebrow is in the normal site style: "Leadership from across the network." instead of every word capitalised.',
      "the photo is shorter, full width and framed on the face.",
    ]);
    const summary = digestMarkdown(digest);
    for (const outcome of ["Why CapFive cards", "Leadership", "Board pop-up"]) expect(summary).toContain(outcome);
    expect(summary.length).toBeLessThan(ABOUT_FIXES.length / 2);
  });

  it("keeps the lead of every paragraph when the reply has no list, so the ask is not lost", () => {
    const digest = digestReply(KINSTA_RULES);
    expect(digest.lead).toBe("Kinsta won't accept #.");
    expect(digest.points.map((point) => point.text)).toEqual([
      "The four old service pages need no rules of their own: the same addresses already work on CapFive.",
      "Set each to 301 and All domains:",
      "Put rule 4 into the existing ^(.*)$ rule rather than adding it alongside.",
    ]);
  });

  it("skips a bare acknowledgement to the sentence that says something", () => {
    expect(digestReply("Captain, agreed. Today Flyd's profile of you is a list of general manners.\n\n1. **Watch:** x\n2. **Layers:** y").lead)
      .toBe("Today Flyd's profile of you is a list of general manners.");
  });
});

describe("isRoutineAnswer", () => {
  it("reads ROUTINE however the model dressed it, and nothing else", () => {
    for (const answer of ["ROUTINE", "ROUTINE.", "**Routine**", " routine\n"]) expect(isRoutineAnswer(answer)).toBe(true);
    expect(isRoutineAnswer("Routine check passed; the site is live.")).toBe(false);
  });
});

describe("isRoutine", () => {
  it("marks acknowledgements and status pings, never outcomes or questions", () => {
    expect(isRoutine("Captain, shipshape.")).toBe(true);
    expect(isRoutine("Captain, still waiting on the crewmate.")).toBe(true);
    expect(isRoutine("Nothing changed since the last check.")).toBe(true);
    expect(isRoutine("Captain, the stats are centred and pushed.")).toBe(false);
    expect(isRoutine("Captain, agreed. Should I push it?")).toBe(false);
    expect(isRoutine(ABOUT_FIXES)).toBe(false);
  });

  it("never mutes a short reply that waits on his word, question mark or not", () => {
    expect(isRoutine("Waiting for your go-ahead to merge the vendor form fix.")).toBe(false);
    expect(isRoutine("Captain, waiting on your call: keep the old hero or ship the new one.")).toBe(false);
    expect(isRoutine("Still waiting on you to approve the copy.")).toBe(false);
    expect(isRoutine("No change; the checkout fix is ready to merge.")).toBe(false);
    expect(isRoutine("Captain, still waiting on the crewmate.")).toBe(true);
  });
});

describe("isActionable", () => {
  it("finds replies that hand the captain something to paste or carry out", () => {
    expect(isActionable(KINSTA_RULES)).toBe(true);
    expect(isActionable(KINSTA_TABLE)).toBe(true);
    expect(isActionable("Add these in the dialog you showed, as 301 on All domains.")).toBe(true);
    expect(isActionable("Captain, the rules are ready.\n\n1. Paste them into Kinsta.\n2. Clear the cache.")).toBe(true);
    expect(isActionable("Captain, run this once in the terminal and tell me what it says.")).toBe(true);
    expect(isActionable(ABOUT_FIXES)).toBe(false);
    expect(isActionable("Captain, the spacing is fixed on About. I'll use this spacing on the other pages next.")).toBe(false);
    expect(isActionable("Captain, the copyright line is now set in the footer, and the old plugin stays in use in production for now.")).toBe(false);
    expect(isActionable("Captain, the `menu` bar is fixed.")).toBe(false);
  });
});

describe("replyArtefact", () => {
  it("makes steps to carry out an artefact, whether a step starts with the place, \"Then\" or the verb", () => {
    const reply = "Captain, here is how to fix the aicanetwork.com redirects.\n\n1. In MyKinsta, delete the ^/$ rule.\n2. Then add ^/(.*)$ → https://capfive.com/$1 as a 301.\n3. Move the specific rules above it.";
    expect(replyArtefact(reply)).toEqual({ clear: true, artefact: {
      title: "Here is how to fix the aicanetwork.com redirects",
      steps: ["In MyKinsta, delete the ^/$ rule.", "Then add ^/(.*)$ → https://capfive.com/$1 as a 301.", "Move the specific rules above it."],
    } });
    expect(isActionable(reply)).toBe(true);
  });

  it("folds each step's sub-bullets and wrapped lines into it, and leaves a closing note to the reply", () => {
    const reply = "1. Add a rule:\n - Source: ^/(.*)$\n - Destination: https://capfive.com/$1\n2. Delete the old catch-all.\n\nNote: order matters, keep specifics above.";
    expect(replyArtefact(reply)).toEqual({ clear: true, artefact: {
      title: "Steps to follow",
      steps: ["Add a rule: Source: ^/(.*)$; Destination: https://capfive.com/$1", "Delete the old catch-all."],
    } });
  });

  it("keeps a step's code block in the step", () => {
    expect(replyArtefact("1. Run:\n```\nnpm run build\n```\n2. Restart Core.")?.artefact.steps).toEqual(["Run: npm run build", "Restart Core."]);
  });

  it("leaves numbered lines inside a code block alone", () => {
    expect(replyArtefact("Captain, the script is ready.\n\n```\n1. add one\n2. add two\n```")).toBeUndefined();
  });

  it("leaves steps that are not all instructions for Flyd to judge", () => {
    const call = replyArtefact("1. Order: the specific rules go first.\n2. Delete the catch-all.");
    expect(call?.clear).toBe(false);
    expect(call?.artefact.steps).toEqual(["Order: the specific rules go first.", "Delete the catch-all."]);
    expect(replyArtefact("1. Fixed the footer.\n2. Merged the hero change.")?.clear).toBe(false);
    expect(replyArtefact("Delete the catch-all rule.")).toBeUndefined();
  });

  it("leaves items that may be a choice to Flyd's judge, and shows them as the kind it names", () => {
    const reply = "Two ways to fix it:\n1. Use a wildcard rule — simpler.\n2. Keep separate rules — more control.";
    expect(replyArtefact(reply)?.clear).toBe(false);
    expect(isActionable(reply)).toBe(false);
    expect(replyArtefact(reply, "options")).toEqual({ clear: false, artefact: {
      title: "Two ways to fix it",
      steps: ["Use a wildcard rule — simpler.", "Keep separate rules — more control."],
      options: true,
    } });
    expect(replyArtefact("1. Pick a wildcard rule.\n2. Pick separate rules.", "options")?.artefact.title).toBe("Options to choose from");
    expect(replyArtefact("1. Keep the specific rules.\n2. Delete the catch-all.")?.clear).toBe(false);
  });

  it("never reads steps that mention a choice as options on its own", () => {
    const kinsta = replyArtefact("Captain, fix the redirects.\n1. In MyKinsta, delete the ^/$ rule.\n2. Add ^/(.*)$ → https://capfive.com/$1 as a 301 or 302.");
    expect(kinsta).toEqual({ clear: false, artefact: { title: "Fix the redirects", steps: ["In MyKinsta, delete the ^/$ rule.", "Add ^/(.*)$ → https://capfive.com/$1 as a 301 or 302."] } });
    const settings = replyArtefact("1. Open Settings → Options.\n2. Click Save.");
    expect(settings).toEqual({ clear: false, artefact: { title: "Steps to follow", steps: ["Open Settings → Options.", "Click Save."] } });
    expect(replyArtefact("1. Delete the old rule.\n2. Add the wildcard or the specific rules.")).toMatchObject({ clear: false, artefact: { title: "Steps to follow" } });
  });

  it("sends a list under a lead-in that signals a choice to Flyd's judge, never the clear-steps path", () => {
    for (const intro of ["Choose one", "Pick one", "Which rule", "Select one", "Pick the ones you want"]) {
      const reply = `${intro}:\n1. Delete the old rule.\n2. Remove the cache.`;
      expect(replyArtefact(reply)?.clear, intro).toBe(false);
      expect(isActionable(reply)).toBe(false);
      expect(replyArtefact(reply, "options")?.artefact).toMatchObject({ title: intro, options: true });
    }
  });

  it("keeps a plain list of unambiguous steps clear", () => {
    expect(replyArtefact("Do this:\n1. Delete X.\n2. Restart Y.")).toEqual({ clear: true, artefact: { title: "Do this", steps: ["Delete X.", "Restart Y."] } });
  });

  it("reads the steps after the reply's own summary lines", () => {
    const reply = "» Fixed the redirects plan.\n» Two steps left for you.\n\nCaptain, finish the redirects.\n\n1. Delete the ^/$ rule.\n2. Add ^/(.*)$ as a 301.";
    expect(replyArtefact(reply)).toEqual({ clear: true, artefact: { title: "Finish the redirects", steps: ["Delete the ^/$ rule.", "Add ^/(.*)$ as a 301."] } });
  });
});

describe("askedForArtefact", () => {
  it("reads a request that wants its answer as an artefact", () => {
    expect(askedForArtefact("explain the new Flyd commits in an artefact")).toBe(true);
    expect(askedForArtefact("send that as an artefact please")).toBe(true);
    expect(askedForArtefact("give me an artefact of the redirect rules")).toBe(true);
  });

  it("leaves a plain answer, and a mention of an artefact that missed, as text", () => {
    expect(askedForArtefact("so what do i do here?")).toBe(false);
    expect(askedForArtefact("why is the artefact not showing?")).toBe(false);
    expect(askedForArtefact("this should definitely be an artefact in flyd")).toBe(false);
    expect(askedForArtefact("that could've been some neat flyd artefact")).toBe(false);
    expect(askedForArtefact("explain why the artefact page is blank")).toBe(false);
    expect(askedForArtefact("show me where the artefact went")).toBe(false);
    expect(askedForArtefact("can you make a note about the artefact feature")).toBe(false);
    expect(askedForArtefact("write up the artefact problem")).toBe(false);
  });

  it("reads a request for an artefact as the deliverable", () => {
    expect(askedForArtefact("pull and check and then explain in an artefact what they do")).toBe(true);
    expect(askedForArtefact("show me an artefact of the new commits")).toBe(true);
  });
});

describe("ReplySummarizer", () => {
  const cacheFile = () => join(dir, "view", "summaries.json");
  it("asks once per reply, keeps the answer on disk, and reuses it after a restart", async () => {
    const provider = counting("fake", async () => "The menu bar is higher now.");
    const summarizer = new ReplySummarizer({ providers: [provider], cacheFile: cacheFile() });
    const reply = "Captain, the menu bar now sits 10px higher on every page. ".repeat(6);
    expect(summarizer.wants(reply)).toBe(true);
    const [a, b] = await Promise.all([summarizer.request(reply), summarizer.request(reply)]);
    expect([a, b]).toEqual(["The menu bar is higher now.", "The menu bar is higher now."]);
    expect(provider.calls).toHaveLength(1);
    expect(summarizer.wants(reply)).toBe(false);

    const restarted = new ReplySummarizer({ providers: [provider], cacheFile: cacheFile() });
    expect(restarted.cached(reply)).toBe("The menu bar is higher now.");
    await restarted.request(reply);
    expect(provider.calls).toHaveLength(1);
    expect(JSON.parse(readFileSync(cacheFile(), "utf8"))).toEqual({
      [ReplySummarizer.key(reply)]: { summary: "The menu bar is higher now.", provider: "fake", at: expect.any(String) },
    });
  });

  it("falls back to the next provider, and gives up on a reply quietly when all fail", async () => {
    const broken = counting("grok", async () => { throw new Error("503"); });
    const haiku = counting("haiku", async () => "Done.");
    const summarizer = new ReplySummarizer({ providers: [broken, haiku], cacheFile: cacheFile() });
    expect(await summarizer.request("reply one")).toBe("Done.");

    const down = new ReplySummarizer({ providers: [counting("grok", async () => { throw new Error("down"); })], cacheFile: join(dir, "other.json") });
    expect(await down.request("reply two")).toBeUndefined();
    expect(down.wants("reply two")).toBe(false);
  });

  it("does nothing without a provider", async () => {
    const summarizer = new ReplySummarizer({ providers: [], cacheFile: cacheFile() });
    expect(summarizer.enabled).toBe(false);
    expect(summarizer.wants("x")).toBe(false);
    expect(await summarizer.request("x")).toBeUndefined();
  });
});

describe("providers", () => {
  it("asks Claude Haiku first, then xAI, from env, the grok CLI's settings or Flyd's config; FLYD_VIEW_SUMMARIES=0 turns them off", () => {
    expect(defaultProviders({ env: { OPENAI_API_KEY: "o" }, home: dir })).toEqual([]);
    expect(defaultProviders({ env: {}, home: dir })).toEqual([]);
    expect(defaultProviders({ env: { XAI_API_KEY: "x", ANTHROPIC_API_KEY: "a" }, home: dir }).map((p) => p.name))
      .toEqual(["anthropic:claude-haiku-5-5", "xai:grok-4-fast-non-reasoning"]);
    expect(defaultProviders({ env: { CLAUDE_API_KEY: "c" }, home: dir }).map((p) => p.name)).toEqual(["anthropic:claude-haiku-5-5"]);
    expect(defaultProviders({ env: { CLAUDE_API_KEY: "c", FLYD_CLAUDE: "0" }, home: dir })).toEqual([]);
    mkdirSync(join(dir, ".grok"));
    writeFileSync(join(dir, ".grok", "user-settings.json"), JSON.stringify({ apiKey: "from-grok-cli" }));
    expect(defaultProviders({ env: {}, home: dir, anthropicKey: "a" }).map((p) => p.name))
      .toEqual(["anthropic:claude-haiku-5-5", "xai:grok-4-fast-non-reasoning"]);
    expect(defaultProviders({ env: { FLYD_VIEW_SUMMARIES: "0", XAI_API_KEY: "x" }, home: dir })).toEqual([]);
  });

  it("sends the reply with the plain-English prompt and reads the answer back", async () => {
    const requests: Array<{ url: string; init: RequestInit }> = [];
    const fake = (body: unknown) => (async (url: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(url), init: init! });
      return new Response(JSON.stringify(body), { status: 200 });
    }) as typeof fetch;
    const signal = new AbortController().signal;

    expect(await xaiProvider("xk", "grok-fast", fake({ choices: [{ message: { content: " The site is live.\n" } }] })).summarize("long reply", signal)).toBe("The site is live.");
    expect(requests[0]!.url).toBe("https://api.x.ai/v1/chat/completions");
    expect((requests[0]!.init.headers as Record<string, string>).authorization).toBe("Bearer xk");
    expect(JSON.parse(String(requests[0]!.init.body))).toMatchObject({
      model: "grok-fast",
      messages: [{ role: "system", content: SUMMARY_PROMPT }, { role: "user", content: "long reply" }],
    });

    expect(await anthropicProvider("ak", "claude-haiku-4-5-20251001", fake({ content: [{ type: "text", text: "Pushed." }] })).summarize("reply", signal)).toBe("Pushed.");
    expect(requests[1]!.url).toBe("https://api.anthropic.com/v1/messages");
    expect((requests[1]!.init.headers as Record<string, string>)["x-api-key"]).toBe("ak");
    expect(JSON.parse(String(requests[1]!.init.body))).toMatchObject({ model: "claude-haiku-4-5-20251001", system: SUMMARY_PROMPT });
  });
});
