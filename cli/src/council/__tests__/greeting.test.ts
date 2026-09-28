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

  it("walks in like a PA: morning news first when he hasn't had it, his standing instructions on top", () => {
    const morning = new Date("2026-09-28T08:05:00");
    const prompt = greetingPrompt({
      briefing: ["Today's news, not yet told him (/more N, /less N):", "  1. Art Blocks opens a new drop — on-chain generative"],
      profile: "- Have the news already sitting there when he opens the app in the morning.",
      now: morning,
    });
    expect(prompt).toContain("his standing instructions override the rules below");
    expect(prompt).toContain("Have the news already sitting there");
    expect(prompt).toContain("lead with it");
    expect(prompt).toContain("one concrete offer");
    expect(greetingPrompt({ briefing: ["News he already heard at 08:05 (bring up only if something is new or he asks):"], now: new Date("2026-09-28T10:30:00") }))
      .not.toContain("he hasn't had the news");
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
