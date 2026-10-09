import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { learningRequest } from "../../cognition/learning-service.js";
import { dictationScope, reviewedVocabulary } from "../corrections.js";
import { IntelligenceEventStore } from "../../intelligence/event-store.js";
import { applyRules, finishDictation } from "../cleanup.js";
import { formatLearning } from "../../commands/learning.js";
import { acceptCleanup } from "../cleanup.js";

let dir: string;
const app = "terminal", title = "Flyd";
beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "flyd-three-")); vi.stubEnv("FLYD_DIR", dir);
  await learningRequest("/learning/source", "POST", { sourceId: "dictation.corrections", action: "enable" });
});
afterEach(() => { vi.unstubAllEnvs(); rmSync(dir, { recursive: true, force: true }); });

async function correct(id: string, before = "Ask Floyd about it", after = "Ask Flyd about it", window = title) {
  const result = await learningRequest("/dictation/correction", "POST", {
    before, after, invocationId: id, bundleId: app, scope: dictationScope(app, window),
  });
  expect(result.status).toBe(200);
  return result.body as { sequence: number; status: string; promoted: boolean; evidenceCount: number; recurrences: number; ruleId: string };
}
function vocabulary(window = title, bundleId = app) {
  const store = new IntelligenceEventStore();
  try { return reviewedVocabulary(store, bundleId, window); } finally { store.close(); }
}

describe("persistent voice rule of three", () => {
  it("hints immediately, promotes exactly at three, and applies without a polish model", async () => {
    expect((await correct("s1")).status).toBe("tentative");
    expect(vocabulary().terms).toContain("Flyd");
    expect(vocabulary().rules).toEqual([]);
    expect((await correct("s2")).promoted).toBe(false);
    const third = await correct("s3");
    expect(third).toMatchObject({ status: "active", promoted: true, evidenceCount: 3 });
    expect((await correct("s3")).promoted).toBe(false);
    const learned = vocabulary(); // Fresh store models a restart: no in-memory promotion state.
    const result = await finishDictation("Ask Floyd about it", { target: { bundleId: app, windowTitle: title },
      audioSeconds: 5, ...{ rules: learned.rules, vocabulary: learned.terms }, model: "" });
    expect(result.text).toBe("Ask Flyd about it");
  });
  it("counts one session once, even if a retry has a different pair", async () => {
    const first = await correct("s1");
    expect(await correct("s1")).toMatchObject({ sequence: first.sequence, evidenceCount: 1 });
    expect(await correct("s1", "Ask flight about it")).toMatchObject({ sequence: first.sequence, evidenceCount: 1 });
    expect((await correct("s2")).evidenceCount).toBe(2);
    expect(vocabulary().rules).toEqual([]);
  });
  it("does not pool different scopes or error patterns", async () => {
    await correct("s1"); await correct("s2");
    await correct("s3", undefined, undefined, "Other");
    await correct("s4", "Ask flight about it");
    expect(vocabulary().rules).toEqual([]);
    await correct("s5");
    expect(vocabulary().rules).toHaveLength(1);
    expect(vocabulary("Other").rules).toEqual([]);
    expect(vocabulary(title, "mail").terms).not.toContain("Flyd");
  });
  it("matches neighbouring evidence, not Pink Floyd, quoted text or another app", async () => {
    for (const id of ["s1", "s2", "s3"]) await correct(id);
    const rules = vocabulary().rules;
    expect(applyRules("Ask Floyd about it and play Pink Floyd", rules)).toBe("Ask Flyd about it and play Pink Floyd");
    expect(applyRules('Quote "Ask Floyd about it"', rules)).toBe('Quote "Ask Floyd about it"');
    expect(applyRules('Quote “Ask Floyd about it”', rules)).toBe('Quote “Ask Floyd about it”');
    expect(applyRules("`Ask Floyd about it`", rules)).toBe("`Ask Floyd about it`");
    expect(applyRules("Ask Floyd about it", vocabulary(title, "mail").rules)).toBe("Ask Floyd about it");
  });
  it("does not allow model cleanup to undo contextual exclusion", async () => {
    for (const id of ["s1", "s2", "s3"]) await correct(id);
    const learned = vocabulary();
    const result = await finishDictation("um Ask Floyd about it and play Pink Floyd", {
      target: { bundleId: app, windowTitle: title }, audioSeconds: 5, rules: learned.rules, vocabulary: learned.terms,
      model: "test", complete: async () => "Ask Flyd about it and play Pink Flyd",
    });
    expect(result.text).toBe("Ask Flyd about it and play Pink Floyd");
  });
  it("rejects numeric/negation changes and blocks semantic or context-free repetition", async () => {
    for (const id of ["s1", "s2", "s3"]) {
      expect((await correct(id + "n", "Charge 105", "Charge 115")).status).toBe("ignored");
      expect((await correct(id + "x", "Don't commit", "Commit")).status).toBe("ignored");
      expect((await correct(id + "m", "Meet Sunday", "Meet Monday")).status).toBe("blocked");
      expect((await correct(id + "c", "Floyd", "Flyd")).status).toBe("blocked");
    }
    expect(vocabulary()).toEqual({ rules: [], terms: [] });
  });
  it("never promotes ordinal/number or homophonic intention changes", async () => {
    for (const id of ["s1", "s2", "s3"]) {
      expect((await correct(id + "ordinal", "Move fourth today", "Move forth today")).status).toBe("ignored");
      expect((await correct(id + "number", "Select fifteen records", "Select fiften records")).status).toBe("ignored");
      expect((await correct(id + "intent", "We must cancel", "We must counsel")).status).toBe("blocked");
    }
    expect(vocabulary()).toEqual({ rules: [], terms: [] });
  });
  it("protects the positions of withheld names, not only their count", async () => {
    for (const id of ["s1", "s2", "s3"]) await correct(id);
    expect(acceptCleanup("Ask Flyd about it and play Pink Floyd", "Ask Floyd about it and play Pink Flyd",
      ["Floyd", "Flyd"], vocabulary().rules)).toBeNull();
    expect(acceptCleanup('Please kindly ask Flyd about it and quote "Please kindly ask Floyd about it"',
      'Please kindly ask Floyd about it and quote "Please kindly ask Flyd about it"', ["Floyd", "Flyd"], vocabulary().rules)).toBeNull();
    expect(acceptCleanup('Use WhisperKit today and quote "whisperkit"', 'Use WhisperKit today and quote "WhisperKit"',
      ["WhisperKit"], [{ from: "whisperkit", to: "WhisperKit", contexts: [{ left: ["use"], right: ["today"] }] }])).toBeNull();
  });
  it("discarded delayed captures cannot cross a renewed source consent boundary", async () => {
    const observedAt = new Date(Date.now() - 1000).toISOString();
    await learningRequest("/learning/source", "POST", { sourceId: "dictation.corrections", action: "erase" });
    await learningRequest("/learning/source", "POST", { sourceId: "dictation.corrections", action: "enable" });
    const result = await learningRequest("/dictation/correction", "POST", {
      before: "Ask Floyd about it", after: "Ask Flyd about it", invocationId: "delayed", observedAt,
      bundleId: app, scope: dictationScope(app, title),
    });
    expect((result.body as { status: string }).status).toBe("ignored");
    expect(vocabulary()).toEqual({ rules: [], terms: [] });
  });
  it("the latest explicit rule decision applies across different evidence samples", async () => {
    const first = await correct("s1"); await correct("s2"); const third = await correct("s3");
    await learningRequest("/dictation/review", "POST", { sequence: first.sequence, approved: true });
    await learningRequest("/dictation/review", "POST", { sequence: third.sequence, approved: false });
    expect(vocabulary()).toEqual({ rules: [], terms: [] });
    const disabled = await learningRequest("/learning", "GET");
    const text = formatLearning(disabled.body as Parameters<typeof formatLearning>[0]);
    expect(text).toContain("Disabled"); expect(text).not.toContain("Approved —");
    await learningRequest("/dictation/review", "POST", { sequence: first.sequence, approved: true });
    expect(vocabulary().rules).toEqual([{ from: "Floyd", to: "Flyd" }]);
  });
  it("learns distinctive capitalisation without learning generic sentence capitalisation", async () => {
    for (const id of ["s1", "s2", "s3"]) {
      await correct(id, "Use whisperkit today", "Use WhisperKit today");
      expect((await correct(id + "c", "hello there", "Hello there")).status).toBe("blocked");
    }
    expect(applyRules("Use whisperkit today", vocabulary().rules)).toBe("Use WhisperKit today");
  });
  it("blocks conflicting learned spellings", async () => {
    await correct("conflict", "Ask Floyd about it", "Ask Flight about it");
    for (const id of ["s1", "s2", "s3"]) expect((await correct(id)).status).toBe("blocked");
    expect(vocabulary()).toEqual({ rules: [], terms: [] });
  });
  it("rejection disables the group and future repeats cannot silently revive it", async () => {
    const first = await correct("s1"); await correct("s2"); await correct("s3");
    await learningRequest("/dictation/review", "POST", { sequence: first.sequence, approved: false });
    expect(vocabulary()).toEqual({ rules: [], terms: [] });
    expect((await correct("s4")).status).toBe("disabled");
    await learningRequest("/dictation/review", "POST", { sequence: first.sequence, approved: true });
    expect(vocabulary().rules).toEqual([{ from: "Floyd", to: "Flyd" }]);
  });
  it("pause/erase removes next-session behaviour; recurrence retains identity", async () => {
    for (const id of ["s1", "s2", "s3"]) await correct(id);
    const third = await correct("s3");
    expect(await correct("s4")).toMatchObject({ ruleId: third.ruleId, evidenceCount: 4, recurrences: 1, promoted: false });
    const view = await learningRequest("/learning", "GET");
    expect(formatLearning(view.body as Parameters<typeof formatLearning>[0])).toContain("1 recurrence(s)");
    await learningRequest("/learning/source", "POST", { sourceId: "dictation.corrections", action: "pause" });
    expect(vocabulary()).toEqual({ rules: [], terms: [] });
    await learningRequest("/learning/source", "POST", { sourceId: "dictation.corrections", action: "erase" });
    await learningRequest("/learning/source", "POST", { sourceId: "dictation.corrections", action: "enable" });
    expect(vocabulary()).toEqual({ rules: [], terms: [] });
  });
});
