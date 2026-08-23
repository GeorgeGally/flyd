import { describe, expect, it } from "vitest";
import { registerSpecialist, lookupSpecialist, listSpecialistNames } from "../specialist-registry.js";
import { specialistsForMessage } from "../capability-resolver.js";

// Composition contract: specialists exist this turn when their own address
// patterns match — the conversation loop never names them.

describe("capability resolver", () => {
  it("composes only the specialists a message addresses", () => {
    const coach = lookupSpecialist("coach");
    expect(coach).toBeTruthy();

    // coach-addressed
    const addressed = specialistsForMessage("hey coach, I'm stuck again");
    expect(addressed.map((r) => r.specialist.name)).toEqual(["coach"]);
    expect(addressed[0]?.matchedBy).toBeTruthy();

    // ordinary sentence containing "coach" must not compose anything
    expect(specialistsForMessage("I coach soccer on weekends")).toEqual([]);
    expect(specialistsForMessage("the head coach said to rest")).toEqual([]);

    // unaddressed message composes an empty set
    expect(specialistsForMessage("what is a monad?")).toEqual([]);
  });

  it("lets newly registered capability join composition without loop changes", () => {
    const name = `test-fixture-${listSpecialistNames().length}`;
    registerSpecialist({
      name,
      domain: "test",
      description: "fixture for composition",
      addresses: [/\bresearch mode\b/i],
      dispatch: async () => "researching",
    });

    const resolved = specialistsForMessage("enter research mode please");
    expect(resolved).toHaveLength(1);
    expect(resolved[0]?.specialist.name).toBe(name);

    // both can match independently; registration order breaks ties
    const both = specialistsForMessage("coach, enter research mode");
    expect(both.map((r) => r.specialist.name)).toContain(name);
  });
});
