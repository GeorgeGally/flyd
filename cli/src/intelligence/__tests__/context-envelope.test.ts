import { describe, expect, it } from "vitest";
import {
  decideEgress,
  envelopeDigest,
  validateEnvelope,
  type ContextEnvelope,
} from "../context-envelope.js";

function sensorEnvelope(overrides: Partial<ContextEnvelope> = {}): ContextEnvelope {
  return {
    pathKind: "sensor",
    kind: "observation",
    sourceId: "calendar.metadata",
    consent: { grantedAt: "2026-08-22T00:00:00.000Z", scopes: ["calendar.metadata"] },
    retentionClass: "local_default",
    payloadClassification: "personal",
    provenance: "sensor:test",
    idempotencyKey: "cal-001",
    payload: { event_title_hash: "abc", starts_at: "2026-08-23T09:00:00Z" },
    ...overrides,
  };
}

describe("ContextEnvelope", () => {
  it("validates fixture envelopes for every path kind under one contract", () => {
    const fixtures: Array<Pick<ContextEnvelope, "pathKind" | "kind">> = [
      { pathKind: "sensor", kind: "observation" },
      { pathKind: "interface", kind: "user_confirmed_intention" },
      { pathKind: "executive", kind: "executive_decision" },
      { pathKind: "capability", kind: "proposed_action" },
    ];
    for (const fix of fixtures) {
      const envelope = sensorEnvelope({
        ...fix,
        authorityGrantId: fix.pathKind === "capability" ? "grant-1" : undefined,
        authorityExpiresAt: fix.pathKind === "capability" ? "2099-01-01T00:00:00.000Z" : undefined,
      });
      expect(validateEnvelope(envelope), `${fix.pathKind} should validate`).toEqual({ ok: true });
    }
  });

  it("rejects envelopes without a consent snapshot", () => {
    const result = validateEnvelope(sensorEnvelope({ consent: undefined as never }));
    expect(result).toMatchObject({ ok: false, rejection: "invalid" });
  });

  it("rejects revoked sources", () => {
    const result = validateEnvelope(sensorEnvelope(), {
      consentLookup: { isRevoked: (id) => id === "calendar.metadata" },
    });
    expect(result).toMatchObject({ ok: false, rejection: "consent_revoked" });
  });

  it("rejects capability paths with an expired grant before execution", () => {
    const result = validateEnvelope(
      sensorEnvelope({
        pathKind: "capability",
        kind: "proposed_action",
        authorityGrantId: "grant-1",
        authorityExpiresAt: "2020-01-01T00:00:00.000Z",
      }),
    );
    expect(result).toMatchObject({ ok: false, rejection: "authority_expired" });
  });

  it("requires an authority grant on capability paths", () => {
    const result = validateEnvelope(sensorEnvelope({ pathKind: "capability", kind: "proposed_action" }));
    expect(result).toMatchObject({ ok: false, rejection: "authority_missing" });
  });

  it("fails redaction when a sensitive field arrives without its scope", () => {
    const result = validateEnvelope(
      sensorEnvelope({ payload: { screen_text: "raw contents of the screen" } }),
    );
    expect(result).toMatchObject({ ok: false, rejection: "redaction_failed" });
  });

  it("allows sensitive fields only with explicit classification and matching scope", () => {
    const result = validateEnvelope(
      sensorEnvelope({
        payloadClassification: "sensitive",
        consent: { grantedAt: "2026-08-22T00:00:00.000Z", scopes: ["screen.raw_text"] },
        payload: { screen_text: "explicitly consented content" },
      }),
    );
    expect(result).toEqual({ ok: true });
  });

  it("detects sensitive fields nested in payload objects", () => {
    const result = validateEnvelope(
      sensorEnvelope({ payload: { context: { location: "51.5,-0.1" } } }),
    );
    expect(result).toMatchObject({ ok: false, rejection: "redaction_failed", detail: expect.stringContaining("context.location") });
  });

  // -- egress: every egress produces a receipt or a recorded denial ---------

  it("records a denial decision for fields outside consent scope", () => {
    const decision = decideEgress(sensorEnvelope(), {
      destination: "model:openai",
      purpose: "summarize",
      fields: ["event_title_hash", "location"],
    });
    expect(decision.allowed).toBe(false);
    expect(decision.deniedFields).toEqual(["location"]);
    expect(decision.reason).toContain("consent scope");
    expect(decision.decisionId).toBeTruthy();
  });

  it("records a full denial once the source is revoked", () => {
    const decision = decideEgress(
      sensorEnvelope(),
      { destination: "model:openai", purpose: "summarize", fields: ["event_title_hash"] },
      { isRevoked: () => true },
    );
    expect(decision.allowed).toBe(false);
    expect(decision.deniedFields).toEqual(["event_title_hash"]);
    expect(decision.reason).toContain("revoked");
  });

  it("allows covered fields through and records the receipt", () => {
    const decision = decideEgress(sensorEnvelope(), {
      destination: "model:openai",
      purpose: "summarize",
      fields: ["event_title_hash"],
    });
    expect(decision.allowed).toBe(true);
    expect(decision.deniedFields).toEqual([]);
  });

  it("produces a stable digest for receipts", () => {
    expect(envelopeDigest(sensorEnvelope())).toBe(envelopeDigest(sensorEnvelope()));
    expect(envelopeDigest(sensorEnvelope())).not.toBe(envelopeDigest(sensorEnvelope({ idempotencyKey: "other" })));
  });
});
