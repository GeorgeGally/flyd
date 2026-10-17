import { afterEach, expect, it, vi } from "vitest";
import * as learning from "../profile-learning.js";
afterEach(() => vi.unstubAllEnvs());
it("exposes diagnostics without an automatic profile writer or duplicate extractor", () => {
  expect(Object.keys(learning)).toEqual(["profileLearnModel"]);
});
it("preserves configured model selection for setup diagnostics", () => {
  vi.stubEnv("FLYD_PROFILE_LEARN_MODEL", " test:learner ");
  expect(learning.profileLearnModel(["test:primary", "test:cheap"])).toBe("test:learner");
  vi.stubEnv("FLYD_PROFILE_LEARN_MODEL", "");
  expect(learning.profileLearnModel(["test:primary", "test:cheap"])).toBe("test:cheap");
  expect(learning.profileLearnModel([])).toBeUndefined();
});
