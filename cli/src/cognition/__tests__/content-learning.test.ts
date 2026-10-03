import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { IntelligenceEventStore } from "../../intelligence/event-store.js";
import { ProjectionEngine } from "../../intelligence/projections.js";
import { deriveWorldState, worldModelProjector } from "../../intelligence/world/world-model.js";
import { CognitiveCurator } from "../curator/curator.js";
import { deterministicLessons, parseLessons, runContentLearning } from "../curator/content-learning.js";
import { learningRequest } from "../learning-service.js";

const dirs: string[] = [];
afterEach(() => { vi.unstubAllEnvs(); for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "flyd-content-")); dirs.push(dir); vi.stubEnv("FLYD_DIR", dir);
  const store = new IntelligenceEventStore();
  return { dir, store, curator: new CognitiveCurator(store) };
}

describe("conversation content learning", () => {
  it("learns mundane problems, constraints, and dependencies locally", () => {
    expect(deterministicLessons("The upload still fails on large images. Voice must work across apps. Checkout depends on authentication.").map(l => l.kind))
      .toEqual(["problem", "constraint", "dependency"]);
  });
  it("rejects invented evidence, proposals, questions, code, and quoted statements", () => {
    const candidates = [
      { kind: "decision", subject: "Rails", quote: "Use Rails." },
      { kind: "decision", subject: "React", quote: "We should use React." },
      { kind: "fact", subject: "upload", quote: "Is upload fixed?" },
    ];
    expect(parseLessons(JSON.stringify(candidates), "We should use React.\nIs upload fixed?")).toEqual([]);
    expect(deterministicLessons("> Upload is fixed.\n" + "\x60\x60\x60\nUpload is fixed.\n\x60\x60\x60")).toEqual([]);
  });
  it("keeps assistant success claims out and user outcomes unverified with source evidence", async () => {
    const { store, curator } = fixture();
    try {
      const source = curator.recordConversationTurn({ sessionId: "s", user: "Upload is fixed.", assistant: "Everything is deployed.", projectIds: ["project:flyd"] });
      await runContentLearning({ store });
      const state = deriveWorldState(new ProjectionEngine(store, worldModelProjector).rebuild(0).state);
      const claim = state.current.find(c => c.attribute === "reported_outcome_unverified")!;
      expect(claim.authority).toBe("inferred");
      expect(claim.evidenceRefs).toContain(source);
      expect(claim.parentEntityId).toBe("project:flyd");
      expect(state.current.some(c => /deployed/.test(c.value))).toBe(false);
    } finally { store.close(); }
  });
  it("preserves reversal history, avoids duplicate lessons, and doesn't invent project scope", async () => {
    const { store, curator } = fixture();
    try {
      curator.recordConversationTurn({ sessionId: "s", user: "Upload is broken.", assistant: "", projectIds: ["project:flyd"] });
      await runContentLearning({ store });
      curator.recordConversationTurn({ sessionId: "s", user: "Upload is now healthy.", assistant: "", projectIds: ["project:flyd"] });
      await runContentLearning({ store, extract: async user => [{ kind: "problem", subject: "Upload", quote: user, replaces: true }] });
      const state = deriveWorldState(new ProjectionEngine(store, worldModelProjector).rebuild(0).state);
      expect(state.current.find(c => c.attribute === "problem")?.value).toBe("Upload is now healthy.");
      expect(state.historical.some(c => c.value === "Upload is broken." && c.temporalStatus === "superseded")).toBe(true);
      const count = store.count(); await runContentLearning({ store }); expect(store.count()).toBe(count);
      curator.recordConversationTurn({ sessionId: "mixed", user: "Voice must work across apps.", assistant: "", projectIds: ["project:flyd", "project:other"] });
      await runContentLearning({ store });
      const next = deriveWorldState(new ProjectionEngine(store, worldModelProjector).rebuild(0).state);
      expect(next.current.find(c => c.attribute === "constraint")?.parentEntityId).toBeUndefined();
    } finally { store.close(); }
  });
  it("retries a failed extractor without advancing its source checkpoint", async () => {
    const { store, curator } = fixture();
    try {
      curator.recordConversationTurn({ sessionId: "s", user: "Upload is broken.", assistant: "" });
      await expect(runContentLearning({ store, extract: async () => { throw new Error("unavailable"); } })).rejects.toThrow("unavailable");
      expect(store.getCheckpoint("conversation-content-v1")).toBe(0);
      expect(await runContentLearning({ store })).toBe(1);
    } finally { store.close(); }
  });
  it("skips a turn whose extraction keeps failing so later turns still learn", async () => {
    const { store, curator } = fixture();
    try {
      const poison = curator.recordConversationTurn({ sessionId: "s", user: "Reply only with ok.", assistant: "" });
      curator.recordConversationTurn({ sessionId: "s", user: "Upload is broken.", assistant: "" });
      const extract = async (user: string) => {
        if (user.startsWith("Reply")) throw new Error("Invalid content extraction");
        return deterministicLessons(user);
      };
      await expect(runContentLearning({ store, extract })).rejects.toThrow("Invalid content extraction");
      await expect(runContentLearning({ store, extract })).rejects.toThrow("Invalid content extraction");
      expect(store.getCheckpoint("conversation-content-v1")).toBeLessThan(poison);
      expect(await runContentLearning({ store, extract })).toBe(1);
      expect(await runContentLearning({ store, extract })).toBe(0);
    } finally { store.close(); }
  });
  it("does not block Flyd's own learning when an imported source is paused", async () => {
    const { store, curator } = fixture();
    try {
      await learningRequest("/learning/source", "POST", { sourceId: "conversation.import", action: "enable" });
      await learningRequest("/learning/conversations", "POST", { turns: [{ sessionId: "external", messageId: "m", user: "Import is broken." }] });
      await learningRequest("/learning/source", "POST", { sourceId: "conversation.import", action: "pause" });
      curator.recordConversationTurn({ sessionId: "own", user: "Voice must work across apps.", assistant: "" });
      expect(await runContentLearning({ store })).toBe(1);
    } finally { store.close(); }
  });
  it("can return to an earlier decision without treating it as a duplicate", async () => {
    const { store, curator } = fixture();
    try {
      for (const user of ["Storage now uses SQLite.", "Storage now uses PostgreSQL.", "Storage now uses SQLite."]) {
        curator.recordConversationTurn({ sessionId: "s", user, assistant: "", turnNumber: store.headSequence(), projectIds: ["project:flyd"] });
        await runContentLearning({ store, extract: async () => [{ kind: "fact", subject: "Storage", quote: user, replaces: true }] });
      }
      const state = deriveWorldState(new ProjectionEngine(store, worldModelProjector).rebuild(0).state);
      expect(state.current.find(c => c.attribute === "fact")?.value).toBe("Storage now uses SQLite.");
      expect(state.historical.filter(c => c.attribute === "fact" && c.temporalStatus === "superseded")).toHaveLength(2);
    } finally { store.close(); }
  });
  it("searches attributed original messages, respecting project scope and erasure", () => {
    const { store, curator } = fixture();
    try {
      const first = curator.recordConversationTurn({ sessionId: "s", user: "Upload still fails.", assistant: "", projectIds: ["project:flyd"] });
      curator.recordConversationTurn({ sessionId: "other", user: "Hello.", assistant: "Upload is fixed.", projectIds: ["project:other"] });
      expect(store.searchConversations(["upload"], ["project:flyd"]).map(e => e.sequence)).toEqual([first]);
      expect(store.searchConversations(["upload"], ["project:other"])).toEqual([]);
      store.eraseSource("chat.cognition");
      expect(store.searchConversations(["upload"])).toEqual([]);
    } finally { store.close(); }
  });
  it("imports idempotently, respects pause, and erases raw and derived data together", async () => {
    const { store, dir } = fixture();
    try {
      const body = { turns: [{ sessionId: "external", messageId: "m1", user: "Upload is broken.", assistant: "", projectIds: ["project:flyd"] }] };
      expect((await learningRequest("/learning/conversations", "POST", body)).status).toBe(403);
      await learningRequest("/learning/source", "POST", { sourceId: "conversation.import", action: "enable" });
      const first = await learningRequest("/learning/conversations", "POST", body);
      expect((await learningRequest("/learning/conversations", "POST", body)).body).toEqual(first.body);
      await learningRequest("/learning/source", "POST", { sourceId: "conversation.import", action: "pause" });
      expect(await runContentLearning({ store })).toBe(0);
      await learningRequest("/learning/source", "POST", { sourceId: "conversation.import", action: "enable" });
      expect(await runContentLearning({ store })).toBe(1);
      await learningRequest("/learning/source", "POST", { sourceId: "conversation.import", action: "erase" });
      const state = new ProjectionEngine(store, worldModelProjector).rebuild(0).state;
      expect(state.claims).toEqual([]);
      expect(store.readFrom(0).filter(e => e.sourceId === "conversation.import").every(e => e.payload === undefined)).toBe(true);
      expect(readFileSync(join(dir, "knowledge/NOW.md"), "utf8")).not.toContain("Upload");
    } finally { store.close(); }
  });
});
