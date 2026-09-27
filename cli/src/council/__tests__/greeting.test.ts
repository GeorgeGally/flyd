import { describe, expect, it, vi } from "vitest";
import { fallbackGreeting, greetingPrompt, museGreeting, parseGreeting } from "../greeting.js";

const now = new Date("2026-09-27T15:12:00");
const briefing = [
  "On my mind: Flyd's write path has no dedup and no filter.",
  "Due today: Call Sam 17:00",
  "Worth knowing (/more N, /less N):",
  "  1. A new prayer for the fruit fly connectome — Matt Webb essay",
];

describe("greeting", () => {
  it("asks the Muse for a few warm sentences, not a dashboard", () => {
    const prompt = greetingPrompt({ briefing, hypothesis: "Attention split across 5 workstreams", now });
    expect(prompt).toContain("Sunday 27 September");
    expect(prompt).toContain("- Due today: Call Sam 17:00");
    expect(prompt).toContain("No lists");
    expect(prompt).toContain("Weekends and evenings are lighter");
  });

  it("rejects list-shaped or empty replies", () => {
    expect(parseGreeting("- one\n- two")).toBeNull();
    expect(parseGreeting("   ")).toBeNull();
    expect(parseGreeting("\"You've got Sam at five.\nThe rest can wait.\"")).toBe("You've got Sam at five. The rest can wait.");
  });

  it("falls back to the urgent facts when the model fails", async () => {
    const text = await museGreeting({ briefing, now }, vi.fn(async () => { throw new Error("down"); }));
    expect(text).toBe("Due today: Call Sam 17:00. A few other things are waiting in /brief.");
    expect(fallbackGreeting([])).toBe("Nothing pressing. What's on your mind?");
  });

  it("doesn't call a model when there is nothing to say", async () => {
    const complete = vi.fn();
    expect(await museGreeting({ briefing: [], now }, complete)).toBe("What's on your mind?");
    expect(complete).not.toHaveBeenCalled();
  });
});
