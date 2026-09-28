import { describe, expect, it } from "vitest";
import { parseDispatchArgs } from "../crew.js";

describe("flyd crew dispatch", () => {
  it("splits --done points from the outcome words", () => {
    expect(parseDispatchArgs(["Add", "dark", "mode", "--done", "toggle in settings", "--done", "a test covers it"]))
      .toEqual({ outcome: "Add dark mode", doneWhen: ["toggle in settings", "a test covers it"] });
    expect(parseDispatchArgs(["Fix", "--done", "x", "the", "bug"])).toEqual({ outcome: "Fix the bug", doneWhen: ["x"] });
  });

  it("keeps a trailing bare --done in the outcome", () => {
    expect(parseDispatchArgs(["Ship", "--done"])).toEqual({ outcome: "Ship --done", doneWhen: [] });
  });
});
