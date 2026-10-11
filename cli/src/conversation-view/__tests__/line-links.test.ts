import { describe, expect, it } from "vitest";
import { outcomeLine } from "../follow-ups.js";
import { clipKeepingLinks, inlineKeepingLinks, plainLinks } from "../line-links.js";

describe("links in a message's line", () => {
  it("keeps web links while dropping other marks", () => {
    expect(inlineKeepingLinks("**Done** on [christmas.example.com](https://christmas.example.com/) and [docs](./x.md)")).toBe("Done on https://christmas.example.com/ and docs");
    expect(inlineKeepingLinks("See [the board](https://example.com/b)")).toBe("See [the board](https://example.com/b)");
  });

  it("never clips inside a link", () => {
    const text = `Done and live on https://christmas.goodneighboursmarket.com/vendors/apply after the redesign`;
    expect(clipKeepingLinks(text, 40, 10)).toBe("Done and live on…");
    expect(clipKeepingLinks(text, 40, 20)).toBe("Done and live on https://christmas.goodneighboursmarket.com/vendors/apply…");
    expect(clipKeepingLinks("short", 40, 10)).toBe("short");
  });

  it("an outcome line keeps its address whole", () => {
    const line = outcomeLine(`Done and live on https://christmas.goodneighboursmarket.com/${"a".repeat(140)} with the new header.`);
    expect(line).toContain(`https://christmas.goodneighboursmarket.com/${"a".repeat(140)}`);
  });

  it("reads as plain words where links cannot show", () => {
    expect(plainLinks("See [the board](https://example.com/b) or https://x.com")).toBe("See the board or https://x.com");
  });
});
