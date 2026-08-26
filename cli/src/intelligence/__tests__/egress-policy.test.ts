import { describe, expect, it } from "vitest";
import { EgressPolicyGateway } from "../egress-policy-gateway.js";
import type { ContextEnvelope } from "../context-envelope.js";

function envelope(scopes: string[] = ["calendar.metadata"]): ContextEnvelope {
  return {
    pathKind: "interface",
    kind: "observation",
    sourceId: "calendar.metadata",
    consent: { grantedAt: "2026-08-22T00:00:00.000Z", scopes },
    retentionClass: "local_default",
    payloadClassification: "personal",
    provenance: "test",
    idempotencyKey: `eg-${Math.random().toString(36).slice(2)}`,
    payload: { title_hash: "h1", starts_at: "t" },
  };
}

const schema = {
  allowedFields: ["title_hash", "starts_at"],
  maxPayloadBytes: 1024,
};

describe("EgressPolicyGateway", () => {
  it("allows consented fields through and emits a receipt", () => {
    const gateway = new EgressPolicyGateway({ isRevoked: () => false });
    const receipt = gateway.check(envelope(), {
      destination: "model:openai",
      purpose: "summarize-day",
      fields: ["title_hash"],
      payload: { title_hash: "h1" },
      schema,
    });
    expect(receipt.allowed).toBe(true);
    expect(receipt.outboundPayload).toEqual({ title_hash: "h1" });
    expect(receipt.receiptId).toBeTruthy();
  });

  it("strips non-authorized raw fields before a provider sees them", () => {
    const gateway = new EgressPolicyGateway({ isRevoked: () => false });
    const receipt = gateway.check(envelope(), {
      destination: "model:openai",
      purpose: "summarize-day",
      fields: ["title_hash"],
      // raw sensitive material smuggled into the payload
      payload: { title_hash: "h1", screen_text: "entire screen contents", location: "51.5,-0.1" },
      schema,
    });
    expect(receipt.allowed).toBe(false);
    expect(receipt.outboundPayload).toBeUndefined();
    expect(receipt.deniedFields).toEqual(expect.arrayContaining(["screen_text", "location"]));
    expect(JSON.stringify(receipt)).not.toContain("entire screen contents");
  });

  it("redaction holds on retry paths — the gateway owns policy, not the caller", () => {
    const gateway = new EgressPolicyGateway({ isRevoked: () => false });
    const request = {
      destination: "model:openai",
      purpose: "summarize-day",
      fields: ["title_hash"],
      payload: { title_hash: "h1" },
      schema,
    };
    const first = gateway.check(envelope(), request);
    // caller retries with extra smuggled fields — same treatment
    const retry = gateway.check(envelope(), { ...request, payload: { ...request.payload, communications: "dm text" } });
    expect(first.allowed).toBe(true);
    expect(retry.allowed).toBe(false);
    expect(retry.deniedFields).toContain("communications");
  });

  it("denies everything once the source is revoked, even previously-allowed fields", () => {
    const gateway = new EgressPolicyGateway({ isRevoked: () => true });
    const receipt = gateway.check(envelope(), {
      destination: "evidence:jina",
      purpose: "research",
      fields: ["title_hash"],
      payload: { title_hash: "h1" },
      schema,
    });
    expect(receipt.allowed).toBe(false);
    expect(receipt.reason).toContain("revoked");
    expect(receipt.outboundPayload).toBeUndefined();
  });

  it("enforces payload size limits for the destination", () => {
    const gateway = new EgressPolicyGateway({ isRevoked: () => false });
    const receipt = gateway.check(envelope(), {
      destination: "model:openai",
      purpose: "summarize-day",
      fields: ["title_hash"],
      payload: { title_hash: "x".repeat(2000) },
      schema,
    });
    expect(receipt.allowed).toBe(false);
    expect(receipt.reason).toContain("bytes");
  });

  it("queues nothing silently — every decision is durable enough to record", () => {
    const gateway = new EgressPolicyGateway({ isRevoked: () => false });
    const receipts = [
      gateway.check(envelope(), { destination: "d", purpose: "p", fields: ["title_hash"], payload: { title_hash: "1" }, schema }),
      gateway.check(envelope(), { destination: "d", purpose: "p", fields: ["nope"], schema }),
    ];
    for (const receipt of receipts) {
      expect(receipt.receiptId).toBeTruthy();
      expect(receipt.decidedAt).toBeTruthy();
    }
  });
});
