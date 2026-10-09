import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  anthropicProvider,
  authorSummary,
  defaultProviders,
  firstSentence,
  ReplySummarizer,
  SUMMARY_PROMPT,
  xaiProvider,
  type SummaryProvider,
} from "../summaries.js";

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

describe("firstSentence", () => {
  it("reads the first sentence of the prose, without Markdown", () => {
    expect(firstSentence("## Status\n\nCaptain, the **menu bar** now sits `10px` higher. It is committed.")).toBe("Status Captain, the menu bar now sits 10px higher.");
    expect(firstSentence("| a | b |\n|---|---|\nAll [three](https://x.y) pages pass! Next.")).toBe("All three pages pass!");
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
  it("asks xAI first, then Anthropic, from env or the grok CLI's settings; FLYD_VIEW_SUMMARIES=0 turns both off", () => {
    expect(defaultProviders({ env: {}, home: dir })).toEqual([]);
    expect(defaultProviders({ env: { XAI_API_KEY: "x", ANTHROPIC_API_KEY: "a" }, home: dir }).map((p) => p.name))
      .toEqual(["xai:grok-4-fast-non-reasoning", "anthropic:claude-haiku-4-5-20251001"]);
    mkdirSync(join(dir, ".grok"));
    writeFileSync(join(dir, ".grok", "user-settings.json"), JSON.stringify({ apiKey: "from-grok-cli" }));
    expect(defaultProviders({ env: {}, home: dir, anthropicKey: "a" }).map((p) => p.name))
      .toEqual(["xai:grok-4-fast-non-reasoning", "anthropic:claude-haiku-4-5-20251001"]);
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
