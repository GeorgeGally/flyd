import { describe, expect, it } from "vitest";
import { opencodeHeaders } from "../opencode-headers.js";

describe("opencodeHeaders", () => {
  it("sends a user agent and a stable session id only to opencode.ai", () => {
    const first = opencodeHeaders("https://opencode.ai/inference/go/v1");
    expect(first["user-agent"]).toBe("flyd/1.0");
    expect(first["x-opencode-session"]).toMatch(/^[0-9a-f-]{36}$/);
    expect(opencodeHeaders("https://opencode.ai/zen/v1")).toEqual(first);
  });

  it("adds nothing for other hosts or no URL", () => {
    expect(opencodeHeaders("https://api.openai.com/v1")).toEqual({});
    expect(opencodeHeaders(undefined)).toEqual({});
    expect(opencodeHeaders("not a url")).toEqual({});
  });
});
