import { randomUUID } from "node:crypto";
import type { ConsentLookup, ContextEnvelope } from "./context-envelope.js";
import { decideEgress } from "./context-envelope.js";

/**
 * Egress policy gateway (flyd-personal-intelligence-prd.md §4, plan U4).
 *
 * Every provider/model/evidence call routes through here. The gateway
 * validates source, purpose, data classification, destination, payload
 * schema and size against current egress consent, then emits a redacted
 * allow/deny receipt. Fail-closed: any field without consent scope is
 * stripped before a provider ever sees it — including on retry paths,
 * because the gateway owns redaction, not the caller.
 */

export interface PayloadSchema {
  /** Fields a provider may receive; everything else is stripped. */
  allowedFields: string[];
  maxPayloadBytes: number;
}

export interface EgressRequest {
  destination: string;
  purpose: string;
  fields: string[];
  payload?: Record<string, unknown>;
  schema?: PayloadSchema;
}

export interface EgressReceipt {
  receiptId: string;
  allowed: boolean;
  destination: string;
  purpose: string;
  /** What the provider would actually receive after redaction. */
  outboundFields: string[];
  outboundPayload?: Record<string, unknown>;
  deniedFields: string[];
  reason?: string;
  decidedAt: string;
}

const DEFAULT_MAX_PAYLOAD_BYTES = 64 * 1024;

export class EgressPolicyGateway {
  constructor(private readonly consentLookup: ConsentLookup) {}

  /**
   * Decide + redact in one pass. Callers must send `receipt.outboundPayload`
   * to the provider — never their original payload. Idempotent per call
   * inputs, so retrying through the gateway re-applies the same policy.
   */
  check(envelope: ContextEnvelope, request: EgressRequest, now = new Date()): EgressReceipt {
    const decision = decideEgress(envelope, request, this.consentLookup, now);

    const schema: PayloadSchema = request.schema ?? {
      allowedFields: request.fields,
      maxPayloadBytes: DEFAULT_MAX_PAYLOAD_BYTES,
    };

    const redacted = redactPayload(request.payload ?? {}, schema);
    const sizeExceeded = byteSize(JSON.stringify(redacted)) > schema.maxPayloadBytes;
    const allowed = decision.allowed && !sizeExceeded && redacted.dropped.length === 0;

    return {
      receiptId: randomUUID(),
      allowed,
      destination: request.destination,
      purpose: request.purpose,
      outboundFields: decision.deniedFields.includes("*")
        ? []
        : request.fields.filter((f) => !decision.deniedFields.includes(f)),
      ...(allowed ? { outboundPayload: redacted.payload } : {}),
      deniedFields: [...decision.deniedFields, ...redacted.dropped],
      reason: !decision.allowed
        ? decision.reason
        : sizeExceeded
          ? `payload exceeds ${schema.maxPayloadBytes} bytes for ${request.destination}`
          : redacted.dropped.length > 0
            ? `payload fields outside declared schema dropped: ${redacted.dropped.join(", ")}`
            : undefined,
      decidedAt: now.toISOString(),
    };
  }
}

interface RedactionResult {
  payload: Record<string, unknown>;
  dropped: string[];
}

function redactPayload(payload: Record<string, unknown>, schema: PayloadSchema): RedactionResult {
  const out: Record<string, unknown> = {};
  const dropped: string[] = [];
  for (const [key, value] of Object.entries(payload)) {
    if (!schema.allowedFields.includes(key)) {
      dropped.push(key);
      continue;
    }
    out[key] = value;
  }
  return { payload: out, dropped };
}

function byteSize(text: string): number {
  return Buffer.byteLength(text, "utf8");
}
