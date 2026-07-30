import { describe, expect, it } from "vitest";
import { CapabilityRegistry } from "../capability-registry.js";
import type { CapabilityAdapter, CapabilityProbe } from "../types.js";

function adapter(id: string, priority: number, probe: CapabilityProbe): CapabilityAdapter {
  return {
    id,
    capability: "x",
    priority,
    operations: ["search"],
    signals: ["social"],
    probe: async () => probe,
    search: async () => [],
  };
}

describe("CapabilityRegistry", () => {
  it("prefers a fully ready fallback over an earlier degraded backend", async () => {
    const registry = new CapabilityRegistry([
      adapter("primary", 1, { status: "degraded", reason: "partial results only" }),
      adapter("fallback", 2, { status: "ready" }),
    ], () => new Date("2026-07-30T00:00:00.000Z"));

    const resolved = await registry.resolve("x", "search");

    expect(resolved?.adapter.id).toBe("fallback");
    expect(resolved?.health.status).toBe("ready");
    expect(resolved?.health.activeBackend).toBe("fallback");
  });

  it("uses a degraded backend when no fully ready backend exists", async () => {
    const registry = new CapabilityRegistry([
      adapter("primary", 1, { status: "degraded", reason: "partial results only" }),
      adapter("fallback", 2, { status: "unavailable", reason: "backend down" }),
    ]);

    const resolved = await registry.resolve("x", "search");

    expect(resolved?.adapter.id).toBe("primary");
    expect(resolved?.health.status).toBe("degraded");
  });

  it("preserves auth-required as a distinct health state", async () => {
    const registry = new CapabilityRegistry([
      adapter("twitter", 1, { status: "auth_required", reason: "cookies missing", fix: "configure X credentials" }),
    ]);

    const health = await registry.health("x", "search");

    expect(health.status).toBe("auth_required");
    expect(health.reason).toContain("cookies missing");
    expect(await registry.resolve("x", "search")).toBeNull();
  });

  it("turns probe exceptions into unavailable health instead of throwing", async () => {
    const broken: CapabilityAdapter = {
      id: "broken",
      capability: "web",
      priority: 1,
      operations: ["search"],
      signals: ["reference"],
      probe: async () => { throw new Error("probe exploded"); },
      search: async () => [],
    };
    const registry = new CapabilityRegistry([broken]);

    const health = await registry.health("web", "search");

    expect(health.status).toBe("unavailable");
    expect(health.reason).toBe("probe exploded");
  });
});
