import { describe, expect, it } from "vitest";
import { isHoroscopeQuestion, verifiedHoroscopeEvidence } from "../personal-context-memory.js";

describe("personal context memory", () => {
  it("recognizes personal zodiac questions without requiring the word my", () => {
    expect(isHoroscopeQuestion("What star sign am I?")).toBe(true);
    expect(isHoroscopeQuestion("Am I a Taurus?")).toBe(true);
    expect(isHoroscopeQuestion("What is my current horoscope?")).toBe(true);
  });

  it("accepts only a fresh current snapshot matching the configured sign", () => {
    const now = new Date(2026, 6, 20, 12, 0, 0);
    const evidence = verifiedHoroscopeEvidence({
      status: "fresh",
      fresh_until: new Date(now.getTime() + 60_000),
      payload: {
        horoscopes: [{
          content: {
            title: "Taurus",
            date: "2026-07-20",
            description: "Verified reading",
            url: "https://example.com/taurus",
          },
        }],
      },
    }, "taurus", now);

    expect(evidence).toEqual([expect.objectContaining({
      kind: "horoscope",
      stale: false,
      excerpt: expect.stringContaining("Verified reading"),
    })]);
    expect(verifiedHoroscopeEvidence({
      status: "stale",
      fresh_until: new Date(now.getTime() + 60_000),
      payload: { horoscopes: [] },
    }, "taurus", now)).toEqual([]);
  });
});
