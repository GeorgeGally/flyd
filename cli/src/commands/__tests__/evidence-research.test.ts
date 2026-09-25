import { describe, expect, it } from "vitest";
import { explicitLocators } from "../evidence-research.js";

describe("explicitLocators", () => {
  it("routes explicit pages to direct reads without surrounding punctuation", () => {
    expect(explicitLocators("Summarize https://example.com/a?x=1, then compare https://example.org.")).toEqual([
      "https://example.com/a?x=1",
      "https://example.org",
    ]);
  });

  it("ignores text that is not a valid absolute URL", () => {
    expect(explicitLocators("Research example.com and https://")).toEqual([]);
  });
});
