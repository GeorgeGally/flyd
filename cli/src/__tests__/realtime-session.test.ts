import { describe, expect, it, vi } from "vitest";
import { buildRealtimeInstructions, buildResolveToolOutput, liveManifest } from "../realtime-session.js";
import type { Resolution } from "../resolve-types.js";

function makeResolution(overrides: Partial<Resolution> = {}): Resolution {
  return {
    resolutionId: "res-1",
    invocationId: "inv-1",
    environmentRevision: 1,
    mode: "native",
    rationale: "Insert text.",
    operations: [],
    ...overrides,
  } as Resolution;
}

describe("buildResolveToolOutput", () => {
  it("keeps live evidence routing and context while sharing the reversible judgment policy", () => {
    try {
      vi.stubEnv("FLYD_OPTIMISTIC_DECISIONS", "1");
      const enabled = buildRealtimeInstructions("George's current task is a local art prototype.");
      expect(enabled).toContain("## Judgment");
      expect(enabled).toContain("MUST call flyd_resolve_intent");
      expect(enabled).toContain("George's current task is a local art prototype.");
      vi.stubEnv("FLYD_OPTIMISTIC_DECISIONS", "0");
      const disabled = buildRealtimeInstructions();
      expect(disabled).not.toContain("## Judgment");
      expect(disabled).toContain("MUST call flyd_resolve_intent");
    } finally { vi.unstubAllEnvs(); }
  });
  it("returns augmentation answers so the voice model can speak them", () => {
    const output = buildResolveToolOutput(
      makeResolution({
        mode: "requires_augment",
        operations: [],
        augmentations: [
          { kind: "explanation", content: "George is a creative technologist building flyd.", placement: "cursor" },
        ],
      }),
      null,
    );

    expect(output.mode).toBe("requires_augment");
    expect(output.augmentations).toEqual([
      { kind: "explanation", content: "George is a creative technologist building flyd." },
    ]);
    expect(output.message).toContain("speak the augmentation content");
  });

  it("returns insertion operations with a resolved count message", () => {
    const output = buildResolveToolOutput(
      makeResolution({
        operations: [{ target: "el_01", kind: "insert_text", text: "Thursday works." }],
      }),
      null,
    );

    expect(output.operations).toEqual([{ target: "el_01", kind: "insert_text", text: "Thursday works." }]);
    expect(output.augmentations).toEqual([]);
    expect(output.message).toBe("Resolved: 1 operation(s)");
  });

  it("reports validation failures", () => {
    const output = buildResolveToolOutput(makeResolution(), { error: "bad target" } as never);

    expect(output.mode).toBe("failed");
    expect(output.operations).toEqual([{ success: false, error: "bad target" }]);
    expect(output.message).toBe("Could not resolve: bad target");
  });

  it("passes choice options through to the voice model", () => {
    const output = buildResolveToolOutput(
      makeResolution({
        mode: "requires_augment",
        augmentations: [
          { kind: "choice", content: "Pick a font.", placement: "cursor", options: ["Inter", "Georgia"] },
        ],
      }),
      null,
    );

    expect(output.augmentations[0].options).toEqual(["Inter", "Georgia"]);
  });
});

describe("liveManifest", () => {
  it("marks the intent as the realtime model's words, not George's", () => {
    const manifest = liveManifest("Send WhatsApp draft 12345678-1234-1234-1234-123456789abc", { revision: 3 });
    expect(manifest.intent_author).toBe("model");
    expect(manifest.modality).toBe("voice");
    expect(manifest.environment_revision).toBe(3);
  });
});
