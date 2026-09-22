import { describe, expect, it } from "vitest";
import { compileConversationState } from "../conversation-state.js";
import { interpretIntent } from "../interpret.js";

describe("conversation cognition", () => {
  it("preserves referents for terse follow-ups", () => {
    const state = compileConversationState([
      { role: "user", content: "The Flyd backend still feels dumb." },
      { role: "assistant", content: "The context compiler is fragmented." },
      { role: "user", content: "We should replace the critical path." },
      { role: "assistant", content: "I can implement that." },
    ], "yeah do that");
    expect(state.entities).toContain("Flyd");
    expect(state.referents.it).toMatch(/replace the critical path/i);
  });

  it("uses deterministic semantic fallback when Jev is unavailable", async () => {
    const intent = await interpretIntent("where were we with Bloom?", { jev: { apiKey: "" } });
    expect(intent.intentKind).toBe("task_resume");
    expect(intent.needsCurrentState).toBe(true);
  });
});
