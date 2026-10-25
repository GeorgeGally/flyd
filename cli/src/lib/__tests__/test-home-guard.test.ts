import { homedir, userInfo } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { assertNotRealFlydHome } from "../test-home-guard.js";
import { defaultIntelligenceDbPath, IntelligenceEventStore } from "../../intelligence/event-store.js";

describe("test home isolation", () => {
  it("points the intelligence store away from the real ~/.flyd", () => {
    expect(defaultIntelligenceDbPath().startsWith(join(homedir(), ".flyd"))).toBe(false);
  });

  it("refuses paths inside the real ~/.flyd while under test", () => {
    expect(() => assertNotRealFlydHome(join(homedir(), ".flyd", "intelligence.sqlite"))).toThrow(/real/);
    expect(() => assertNotRealFlydHome(join(homedir(), ".flyd"))).toThrow(/real/);
    expect(() => assertNotRealFlydHome(join(homedir(), ".flyd-other", "x.sqlite"))).not.toThrow();
  });

  it("still refuses the account's real ~/.flyd when $HOME has been pointed elsewhere", () => {
    const original = process.env.HOME;
    process.env.HOME = "/tmp/elsewhere";
    try {
      expect(() => assertNotRealFlydHome(join(userInfo().homedir, ".flyd", "intelligence.sqlite"))).toThrow(/real/);
    } finally {
      process.env.HOME = original;
    }
  });

  it("refuses to open the real event store", () => {
    expect(() => new IntelligenceEventStore({ path: join(homedir(), ".flyd", "intelligence.sqlite") })).toThrow(/real/);
  });
});
