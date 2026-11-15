import { describe, expect, it } from "vitest";
import { routeWorker } from "../worker-router.js";
import type { WorkerHealth } from "../worker-adapter.js";

function health(
  name: string,
  capabilities: WorkerHealth["capabilities"],
  healthy = true,
): WorkerHealth {
  return {
    name,
    executable: `/bin/${name}`,
    version: "1.0.0",
    healthy,
    capabilities,
  };
}

describe("worker router", () => {
  it("selects a healthy worker by required capability and current load", () => {
    const selected = routeWorker({
      requirements: ["implementation", "testing"],
      adapters: [
        health("codex", ["analysis", "implementation", "testing"]),
        health("builder", ["analysis", "implementation", "testing"]),
      ],
      activeCounts: { codex: 1, builder: 0 },
      excludedAdapters: [],
    });

    expect(selected.name).toBe("builder");
  });

  it("excludes unhealthy, incapable, and explicitly replaced adapters", () => {
    const selected = routeWorker({
      requirements: ["review"],
      adapters: [
        health("broken", ["review"], false),
        health("builder", ["implementation"]),
        health("codex", ["review"]),
        health("replacement", ["review"]),
      ],
      activeCounts: {},
      excludedAdapters: ["codex"],
    });

    expect(selected.name).toBe("replacement");
  });

  it("fails explicitly when the task grant has no capable worker", () => {
    expect(() => routeWorker({
      requirements: ["review"],
      adapters: [health("builder", ["implementation"])],
      activeCounts: {},
      excludedAdapters: [],
    })).toThrow("No healthy worker satisfies: review");
  });

  it("uses a stable name tie-breaker for identical capability and load", () => {
    const selected = routeWorker({
      requirements: ["analysis"],
      adapters: [
        health("worker", ["analysis"]),
        health("claude", ["analysis"]),
      ],
      activeCounts: {},
      excludedAdapters: [],
    });

    expect(selected.name).toBe("claude");
  });

});
