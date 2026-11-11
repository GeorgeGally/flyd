import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { digestFromModel, digestHash, readDigests, scheduleDigest, type DigestSource } from "../job-digest.js";

const at = "2026-10-26T12:00:00.000Z";
const usage = { model: "claude-haiku-5-5", inputTokens: 4, outputTokens: 4, usd: 0 };
const source = (text: string): DigestSource => ({ hash: digestHash(text), project: "Cap5", title: "Deck", text });

function pathFor(name: string): string {
  return join(mkdtempSync(join(tmpdir(), "flyd-digest-")), name);
}

afterEach(() => { vi.restoreAllMocks(); });

describe("job digests", () => {
  it("reads a fenced JSON reading and keeps only an http link", () => {
    const parsed = digestFromModel('```json\n{"changed":"Tier three is gone.","means":"One offer.","needed":"Send it.","link":"javascript:alert(1)"}\n```', source("hello"), usage, at);
    expect(parsed).toMatchObject({ changed: "Tier three is gone.", needed: "Send it." });
    expect(parsed).not.toHaveProperty("means");
    expect(parsed!.link).toBeUndefined();
    expect(digestFromModel("not json", source("hello"), usage, at)).toBeNull();
  });

  it("asks once per hash, stores a failure, and logs the estimate", async () => {
    const path = pathFor("job-digests.json");
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    let calls = 0;
    const text = "The deck dropped the third tier. ".repeat(12);
    const item = source(text);
    const ask = vi.fn(async () => {
      calls += 1;
      return JSON.stringify({ changed: "Tier three is gone.", means: "One offer.", needed: "Send it.", link: "https://example.com/deck" });
    });
    await scheduleDigest([item], { path, ask });
    await scheduleDigest([item], { path, ask });
    expect(calls).toBe(1);
    expect(readDigests(path)[0]).toMatchObject({ hash: item.hash, changed: "Tier three is gone.", link: "https://example.com/deck", model: "claude-haiku-5-5" });
    expect(info.mock.calls.some((call) => String(call[0]).includes(`hash=${item.hash}`) && String(call[0]).includes("outcome=ok") && String(call[0]).includes("ledger=job-digest") && String(call[0]).includes("estUsd="))).toBe(true);

    const bad = source(`${text} again`);
    await scheduleDigest([bad], { path, ask: async () => "nope" });
    let retried = false;
    await scheduleDigest([bad], { path, ask: async () => { retried = true; return "again"; } });
    expect(retried).toBe(false);
    expect(readDigests(path).find((digest) => digest.hash === bad.hash)!.failed).toBe(true);
  });

  it("keeps a new reading said to him even when the model writes about him", () => {
    const parsed = digestFromModel(JSON.stringify({ changed: "George's lab has three open questions.", needed: "George needs to pick the Reports heading.", link: "" }), source("cap5"), usage, at);
    expect(parsed).toMatchObject({ changed: "Your lab has three open questions.", needed: "You need to pick the Reports heading." });
  });

  it("asks the model to speak as I, to you, one sentence a line", async () => {
    let prompt = "";
    await scheduleDigest([source("cap5 prompt")], { path: pathFor("p.json"), ask: async (sent) => { prompt = sent; return "{}"; } });
    expect(prompt).toContain('Speak as "I"');
    expect(prompt).toContain('as "you"');
    expect(prompt).not.toContain("what is needed from George");
    expect(prompt).not.toContain('"means"');
  });

  it("does not call a model under tests unless one is passed", () => {
    expect(scheduleDigest([source("stored already")], { path: pathFor("none.json") })).toBeUndefined();
  });
});
