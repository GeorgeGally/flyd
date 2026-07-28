import { describe, expect, it } from "vitest";
import { buildResolveToolOutput } from "../realtime-session.js";
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
