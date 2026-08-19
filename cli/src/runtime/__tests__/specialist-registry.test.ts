import { describe, expect, it, vi } from "vitest";
import {
  registerSpecialist,
  lookupSpecialist,
  listSpecialistNames,
} from "../specialist-registry.js";

describe("specialist registry", () => {
  it("registers and looks up a specialist by name", () => {
    registerSpecialist({ name: "coach", domain: "coaching", dispatch: vi.fn(async () => "coached") });
    const coach = lookupSpecialist("coach");
    expect(coach?.name).toBe("coach");
    expect(coach?.domain).toBe("coaching");
  });

  it("returns null for unknown specialist names", () => {
    expect(lookupSpecialist("coach-to-the-moon")).toBeNull();
  });

  it("lists registered specialist names", () => {
    registerSpecialist({ name: "coach", domain: "coaching", dispatch: vi.fn(async () => "") });
    expect(listSpecialistNames()).toContain("coach");
  });
});
