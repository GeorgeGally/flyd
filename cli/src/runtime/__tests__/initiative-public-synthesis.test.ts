import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { EvidenceItem } from "../../evidence/types.js";
import {
  INITIATIVE_PUBLIC_SYNTHESIS_CONTRACT, INITIATIVE_PUBLIC_RESEARCH_CONTRACT,
  INITIATIVE_CURATED_CONTRACT, SourceContractRegistry,
} from "../../intelligence/sensors/source-contracts.js";
import { synthesizePublicEvidence } from "../initiative/public-synthesis.js";

const now = new Date();
const dir = mkdtempSync(join(tmpdir(), "flyd-public-synth-"));
afterEach(() => vi.unstubAllEnvs());
function registry() {
  const r = new SourceContractRegistry({ path: join(dir, "consent-" + Math.random() + ".json") });
  r.register(INITIATIVE_PUBLIC_SYNTHESIS_CONTRACT);
  r.register(INITIATIVE_CURATED_CONTRACT);
  r.register(INITIATIVE_PUBLIC_RESEARCH_CONTRACT);
  r.setStatus(INITIATIVE_CURATED_CONTRACT.sourceId, "enabled");
  r.setStatus(INITIATIVE_PUBLIC_RESEARCH_CONTRACT.sourceId, "enabled");
  return r;
}
const evidence: EvidenceItem[] = [{
  id: "public-1", capability: "web", backend: "test", kind: "reference",
  title: "Particle shader typography", content: "Particle arrays deform letters using shader programs.",
  locator: "https://docs.example.org/particles", sourceItemId: "1", retrievedAt: now.toISOString(),
  queryLabel: "public", nativeRank: 1, localRelevance: 1, freshness: 1, sourceQuality: 1, provenance: [],
}];
const reply = JSON.stringify({
  hypothesis: "Particle deformation offers an interesting public rendering technique.",
  counterargument: "The technique may be unnecessary where simpler SVG transforms already work.",
  caveat: "No private implementation or actual project benefit was checked.",
});
describe("separately consented public-only model critique", () => {
  it("makes no model call without explicit consent", async () => {
    const r = registry();
    const complete = vi.fn(async (_prompt: string) => reply);
    const result = await synthesizePublicEvidence("Particle shader typography", evidence,
      { registry: r, now: () => now, complete, modelAllowed: () => true });
    expect(result).toMatchObject({ interpretation: null, modelCalls: 0, stopReason: "synthesis_not_consented" });
    expect(complete).not.toHaveBeenCalled();
  });

  it("sends only public material, never project labels or local repo context", async () => {
    const r = registry();
    r.setStatus(INITIATIVE_PUBLIC_SYNTHESIS_CONTRACT.sourceId, "enabled");
    const complete = vi.fn(async (_prompt: string) => reply);
    const result = await synthesizePublicEvidence("Particle shader typography", evidence,
      { registry: r, now: () => now, complete, modelAllowed: () => true });
    expect(result.modelCalls).toBe(1);
    expect(result.interpretation).toMatchObject({ epistemicStatus: "unverified_model_interpretation" });
    const prompt = complete.mock.calls[0]![0];
    expect(prompt).toContain("Particle arrays deform letters");
    expect(prompt).toContain("PUBLIC EVIDENCE");
    expect(prompt).not.toContain("George");
    expect(prompt).not.toContain("Private Client Brand");
    expect(prompt).not.toContain("USER.md");
  });

  it("a provider failure, bad JSON or model backoff cannot turn into verified research", async () => {
    const r = registry();
    r.setStatus(INITIATIVE_PUBLIC_SYNTHESIS_CONTRACT.sourceId, "enabled");
    const disabled = await synthesizePublicEvidence("Particle shader typography", evidence,
      { registry: r, now: () => now, complete: async () => reply, modelAllowed: () => false });
    expect(disabled.stopReason).toBe("model_backoff");
    const malformed = await synthesizePublicEvidence("Particle shader typography", evidence,
      { registry: r, now: () => now, complete: async () => "{not json}", modelAllowed: () => true });
    expect(malformed).toMatchObject({ interpretation: null, modelCalls: 1, stopReason: "invalid_model_json" });
  });

  it("removes an in-flight hypothesis if model consent is revoked before delivery", async () => {
    const r = registry();
    r.setStatus(INITIATIVE_PUBLIC_SYNTHESIS_CONTRACT.sourceId, "enabled");
    const done = await synthesizePublicEvidence("Particle shader typography", evidence, {
      registry: r, now: () => now, modelAllowed: () => true,
      complete: async () => { r.setStatus(INITIATIVE_PUBLIC_SYNTHESIS_CONTRACT.sourceId, "revoked"); return reply; },
    });
    expect(done).toMatchObject({ interpretation: null, modelCalls: 1, stopReason: "consent_revoked_after_model" });
  });
});
