import { beforeEach, describe, expect, it } from "vitest";
import {
  overlayMetricsSnapshot,
  recordDelegationCompletion,
  recordDeterministicResolution,
  recordRouteDivergence,
  recordRouteSource,
  resetOverlayMetrics,
} from "../overlay-metrics.js";
import { resolve } from "../resolve.js";

const env = {
  application: { bundle_id: "com.apple.mail", name: "Mail" },
  window: { title: "Inbox", ref: "win_01" },
  focused_element: {
    ref: "el_01",
    role: "AXTextArea",
    description: "Message body",
    value: "",
    placeholder: "",
    selected_text: "",
  },
  selection: "",
  sufficiency: "semantic" as const,
};

beforeEach(() => {
  resetOverlayMetrics();
});

describe("overlay metrics counters", () => {
  it("starts zeroed and snapshots are copies", () => {
    const snap = overlayMetricsSnapshot();
    expect(Object.values(snap).every((v) => v === 0)).toBe(true);
    recordDeterministicResolution();
    expect(snap.deterministic_resolutions).toBe(0);
    expect(overlayMetricsSnapshot().deterministic_resolutions).toBe(1);
  });

  it("buckets route sources", () => {
    recordRouteSource("classifier");
    recordRouteSource("regex_fallback");
    recordRouteSource("regex_unconfigured");
    recordRouteSource("classifier");
    const snap = overlayMetricsSnapshot();
    expect(snap.route_source_classifier).toBe(2);
    expect(snap.route_source_regex_fallback).toBe(1);
    expect(snap.route_source_regex_unconfigured).toBe(1);
  });

  it("buckets delegation completion outcomes", () => {
    recordDelegationCompletion("accepted");
    recordDelegationCompletion("rejected_validation");
    recordDelegationCompletion("rejected_reverification");
    const snap = overlayMetricsSnapshot();
    expect(snap.delegation_completions_accepted).toBe(1);
    expect(snap.delegation_completions_rejected_validation).toBe(1);
    expect(snap.delegation_completions_rejected_reverification).toBe(1);
  });

  it("counts divergence independently of source", () => {
    recordRouteDivergence();
    expect(overlayMetricsSnapshot().route_divergence).toBe(1);
  });

  it("carries no string fields (privacy invariant #9)", () => {
    const snap = overlayMetricsSnapshot();
    for (const value of Object.values(snap)) {
      expect(typeof value).toBe("number");
    }
  });
});

describe("resolve() instrumentation", () => {
  it("counts deterministic resolutions without touching the LLM path", async () => {
    const resolution = await resolve({
      invocation_id: "inv-1",
      environment_revision: 1,
      environment: env,
      intent: "type hello world",
      modality: "text",
      invocation_fingerprint: { app: "Mail", window: "Inbox", element: "el_01" },
    });
    expect(resolution.mode).toBe("native");
    const snap = overlayMetricsSnapshot();
    expect(snap.deterministic_resolutions).toBe(1);
    expect(snap.llm_resolutions).toBe(0);
  });
});
