import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
vi.mock("../../lib/brain-retrieval.js", () => ({ retrieveLiveBrainEvidence: vi.fn(async () => ({ matches: [] })) }));
import { IntelligenceEventStore } from "../../intelligence/event-store.js";
import { CognitiveCurator } from "../curator/curator.js";
import { acceptKnowledgeProposal, ingestKnowledgeCorrection, retractKnowledgeRepair, targetRevision, type FactKey } from "../curator/knowledge-repair.js";
import { deriveWorldState } from "../../intelligence/world/world-model.js";
import { replayWorldModel } from "../../intelligence/world/replay-cache.js";
import { queryMemory } from "../memory.js";
import { compileContext } from "../context-compiler.js";
import { formatCompiledContext } from "../context-format.js";
import { applyMemoryOps, memoryPaths, readMemoryEntries } from "../../council/memory-store.js";
import { applyProjectOps, projectsPromptBlock, readProjects, projectsPath } from "../../council/projects.js";
import { migrateKnowledgeSources } from "../curator/knowledge-migration.js";

let dir: string;
let store: IntelligenceEventStore;
const key: FactKey = { entityId: "project:harbor", property: "launch_date", scopeId: "project:harbor" };
const text = (value: string) => `Harbor launch date is ${value}`;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "flyd-knowledge-"));
  vi.stubEnv("FLYD_DIR", dir);
  vi.stubEnv("FLYD_MEMORY_DIR", dir);
  vi.stubEnv("FLYD_PROJECTS_PATH", join(dir, "projects.json"));
  vi.stubEnv("FLYD_KNOWLEDGE_REPAIR", "active");
  store = new IntelligenceEventStore();
});
afterEach(() => { store.close(); rmSync(dir, { recursive: true, force: true }); vi.unstubAllEnvs(); });
const current = () => deriveWorldState(replayWorldModel(store)).current;

describe("grounded knowledge repair", () => {
  it("survives restart, deduplicates an origin and reverses only its own explicit effects", () => {
    const first = ingestKnowledgeCorrection(text("2030-06-10"), "first", store)!;
    const second = ingestKnowledgeCorrection(`Correction: ${text("2030-06-12")}`, "second", store)!;
    expect(current().find((c) => c.attribute === "launch_date")?.value).toBe("2030-06-12");
    expect(ingestKnowledgeCorrection(`Correction: ${text("2030-06-12")}`, "second", store)?.claimId).toBe(second.claimId);
    const reopened = new IntelligenceEventStore();
    expect(deriveWorldState(replayWorldModel(reopened)).current[0].value).toBe("2030-06-12");
    reopened.close();
    const origin = new CognitiveCurator(store).recordConversationTurn({ sessionId: "undo", user: "Undo my last date correction", assistant: "" });
    retractKnowledgeRepair(store, second, origin);
    expect(current()[0].claimId).toBe(first.claimId);
    expect(current()[0].value).toBe("2030-06-10");
  });

  it("does not collide with another property, project or old imported time", () => {
    ingestKnowledgeCorrection(text("2030-06-12"), "date", store);
    ingestKnowledgeCorrection("Harbor hosting provider is Hetzner", "host", store);
    ingestKnowledgeCorrection("Aurora launch date is 2030-08-01", "other", store);
    expect(current()).toHaveLength(3);
    const source = new CognitiveCurator(store).recordConversationTurn({ sessionId: "old", user: text("2020-01-01"), assistant: "" });
    expect(() => acceptKnowledgeProposal(store, { originId: "old", key, value: "2020-01-01", operation: "correct", expectedRevision: targetRevision(store, key), evidence: [{ sequence: source, quote: text("2020-01-01") }], effectiveAt: "2020-01-01T00:00:00Z" })).toThrow("Historical");
    expect(current().find((c) => c.attribute === "launch_date" && c.entityId === "project:harbor")?.value).toBe("2030-06-12");
  });

  it("accepts an explicit undo through normal intake without retracting another session", () => {
    ingestKnowledgeCorrection(text("2030-06-10"), "normal-undo", store, "1");
    ingestKnowledgeCorrection(text("2030-06-12"), "normal-undo", store, "2");
    ingestKnowledgeCorrection("Undo my last correction", "other-session", store, "1");
    expect(current()[0].value).toBe("2030-06-12");
    ingestKnowledgeCorrection("Undo my last correction", "normal-undo", store, "3");
    expect(current()[0].value).toBe("2030-06-10");
    ingestKnowledgeCorrection("Undo my last correction", "normal-undo", store, "3");
    expect(current()[0].value).toBe("2030-06-10");
  });

  it("retains genuine disagreement and rejects stale, fabricated and revoked evidence", () => {
    ingestKnowledgeCorrection(text("2030-06-10"), "base", store);
    const revision = targetRevision(store, key);
    const source = new CognitiveCurator(store).recordConversationTurn({ sessionId: "dispute", user: text("2030-06-12"), assistant: "" });
    const proposal = { originId: "dispute", key, value: "2030-06-12", operation: "dispute" as const, expectedRevision: revision, evidence: [{ sequence: source, quote: text("2030-06-12") }] };
    acceptKnowledgeProposal(store, proposal);
    expect(deriveWorldState(replayWorldModel(store)).conflicts[0].conflicting).toHaveLength(1);
    expect(() => acceptKnowledgeProposal(store, { ...proposal, originId: "stale", operation: "correct" })).toThrow("revision");
    expect(() => acceptKnowledgeProposal(store, { ...proposal, originId: "fake", evidence: [{ sequence: source, quote: "fabricated 2030-06-12" }] })).toThrow("Evidence");
    expect(() => acceptKnowledgeProposal(store, { ...proposal, originId: "wrong-scope", key: { ...key, entityId: "project:aurora", scopeId: "project:aurora" } })).toThrow("scope");
    store.eraseSource("chat.cognition");
    expect(current()).toHaveLength(0);
    expect(ingestKnowledgeCorrection(text("2030-09-09"), "revoked", store)).toBeNull();
  });

  it("leaves dissatisfaction and quoted suggestions as evidence without inventing a fact", () => {
    expect(ingestKnowledgeCorrection("That answer was wrong", "bad", store)).toBeNull();
    expect(ingestKnowledgeCorrection('Imagine Harbor launch date is 2030-06-10', "hypothesis", store)).toBeNull();
    expect(current()).toHaveLength(0);
  });

  it("retains an independent accepted assertion when corroborating source evidence is erased", () => {
    const source = new CognitiveCurator(store).recordObservation({sourceEvidence:{text:text("2030-06-12")}},"source.original");
    acceptKnowledgeProposal(store,{originId:"original",key,value:"2030-06-12",operation:"dispute",expectedRevision:targetRevision(store,key),evidence:[{sequence:source,quote:text("2030-06-12")}]});
    const assertion=ingestKnowledgeCorrection(text("2030-06-12"),"independent",store)!;
    store.eraseSource("source.original");
    expect(current()[0].claimId).toBe(assertion.claimId);
    expect(current()[0].value).toBe("2030-06-12");
  });

  it("does not revive retired memory/project copies after erasure or allow legacy writers to bypass acceptance", () => {
    applyMemoryOps([{ op: "add", section: "Facts", text: text("2030-06-10") }]);
    applyProjectOps([{ op: "upsert", name: "Harbor", due: "2030-06-10", facts: [text("2030-06-10")] }], { knownRepos: [] });
    new CognitiveCurator(store).addClaim({ entityId: "project:harbor", attribute: "fact:date", value: text("2030-06-10") }, "legacy.original");
    const oldImport = new CognitiveCurator(store).recordObservation({sourceEvidence:{text:text("2030-06-10")}}, "legacy.original");
    const originalMemory = readFileSync(memoryPaths().memory, "utf8");
    const originalProjects = readFileSync(projectsPath(), "utf8");
    ingestKnowledgeCorrection(text("2030-06-12"), "date", store);
    ingestKnowledgeCorrection("Harbor deadline is 2030-06-12", "deadline", store);
    expect(applyMemoryOps([{ op:"add", section:"Facts", text:text("2030-01-01") }]).rejected).toHaveLength(1);
    expect(applyProjectOps([{ op:"upsert", name:"Harbor", due:"2030-01-01", facts:[text("2030-01-01")] }], { knownRepos:[] }).rejected).toHaveLength(2);
    store.eraseSource("chat.cognition");
    const reopened = new IntelligenceEventStore();
    expect(deriveWorldState(replayWorldModel(reopened)).current).toHaveLength(0);
    reopened.close();
    expect(readMemoryEntries()).toHaveLength(0);
    expect(readProjects()[0].due).toBeUndefined();
    expect(migrateKnowledgeSources(store,[oldImport]).applied).toHaveLength(0);
    expect(projectsPromptBlock()).not.toMatch(/2030-06-10|2030-06-12|2030-01-01/);
    expect(readFileSync(memoryPaths().memory,"utf8")).toBe(originalMemory);
    expect(readFileSync(projectsPath(),"utf8")).toBe(originalProjects);
  });

  it("reaches the next real compiler/formatter and independent project prompt after an immediate repeat", async () => {
    applyMemoryOps([{ op: "add", section: "Facts", text: text("2030-06-10") }]);
    applyProjectOps([{ op: "upsert", name: "Harbor", facts: [text("2030-06-10")] }], { knownRepos: [] });
    ingestKnowledgeCorrection(text("2030-06-10"), "initial", store);
    await queryMemory({ text: "Harbor launch date", useJev: false });
    ingestKnowledgeCorrection(`Correction: ${text("2030-06-12")}`, "corrected", store);
    const compiled = await compileContext({ intent: "What is Harbor launch date?", projectHint: "project:harbor" });
    const prompt = formatCompiledContext(compiled) + projectsPromptBlock();
    expect(prompt).toContain("2030-06-12");
    expect(prompt).not.toContain("2030-06-10");
    expect(compiled.user.personal?.memory).toContain("2030-06-12");
    const past = await queryMemory({ text: "Harbor", temporalFrame: "past", includeHistorical: true, useJev: false });
    expect(past.historical.some((c) => c.value === "2030-06-10")).toBe(true);
  });
});
