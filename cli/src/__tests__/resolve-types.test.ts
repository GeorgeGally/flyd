import { describe, it, expect } from "vitest";
import { validateResolution } from "../resolve-types.js";
import type { Resolution } from "../resolve-types.js";

describe("validateResolution", () => {
  const base: Resolution = {
    resolutionId: "res-001",
    invocationId: "inv-001",
    environmentRevision: 1,
    mode: "native",
    rationale: "test",
    operations: [{ target: "el_01", kind: "insert_text", text: "hello" }],
  };

  it("accepts valid native resolution", () => {
    expect(validateResolution(base)).toBeNull();
  });

  it("rejects invalid mode", () => {
    const err = validateResolution({ ...base, mode: "invalid" as never });
    expect(err?.code).toBe("invalid_mode");
  });

  it("rejects el_99 target ref", () => {
    const err = validateResolution({
      ...base,
      operations: [{ target: "el_99", kind: "insert_text", text: "hello" }],
    });
    expect(err?.code).toBe("invalid_ref");
  });

  it("rejects non-el_ prefixed ref", () => {
    const err = validateResolution({
      ...base,
      operations: [{ target: "window_01", kind: "insert_text", text: "hello" }],
    });
    expect(err?.code).toBe("invalid_ref");
  });

  it("rejects empty operation text", () => {
    const err = validateResolution({
      ...base,
      operations: [{ target: "el_01", kind: "insert_text", text: "   " }],
    });
    expect(err?.code).toBe("empty_text");
  });

  it("rejects text exceeding 2000 characters", () => {
    const err = validateResolution({
      ...base,
      operations: [{ target: "el_01", kind: "insert_text", text: "x".repeat(2001) }],
    });
    expect(err?.code).toBe("char_limit_exceeded");
  });

  it("accepts text at exactly 2000 characters", () => {
    expect(
      validateResolution({
        ...base,
        operations: [{ target: "el_01", kind: "insert_text", text: "x".repeat(2000) }],
      })
    ).toBeNull();
  });

  it("rejects invalid operation kind", () => {
    const err = validateResolution({
      ...base,
      operations: [{ target: "el_01", kind: "click" as never, text: "hello" }],
    });
    expect(err?.code).toBe("invalid_kind");
  });

  it("accepts replace_text kind", () => {
    expect(
      validateResolution({
        ...base,
        operations: [{ target: "el_01", kind: "replace_text", text: "new" }],
      })
    ).toBeNull();
  });

  it("accepts replace_selection kind", () => {
    expect(
      validateResolution({
        ...base,
        operations: [{ target: "el_01", kind: "replace_selection", text: "new" }],
      })
    ).toBeNull();
  });

  it("rejects native mode with no operations", () => {
    const err = validateResolution({ ...base, operations: [] });
    expect(err?.code).toBe("invalid_kind");
  });

  it("accepts augment mode with augmentations", () => {
    expect(
      validateResolution({
        ...base,
        mode: "requires_augment",
        operations: [],
        augmentations: [{ kind: "choice", content: "Pick one", placement: "cursor" }],
      })
    ).toBeNull();
  });

  it("rejects augment mode without augmentations", () => {
    const err = validateResolution({ ...base, mode: "requires_augment", operations: [] });
    expect(err?.code).toBe("invalid_mode");
  });

  it("requires compose rationale", () => {
    const err = validateResolution({
      ...base,
      mode: "requires_compose",
      operations: [],
      composeRationale: undefined,
    });
    expect(err?.code).toBe("invalid_mode");
  });
});
