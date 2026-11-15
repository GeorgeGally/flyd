import { describe, expect, it } from "vitest";
import { routeWorker } from "../worker-router.js";
import type { WorkerHealth } from "../worker-adapter.js";
import { crewBackupModels, crewModel, DEFAULT_CREW_MODEL, launchCrewmate, type CrewTask } from "../../crew/crew.js";

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
        health("opencode", ["analysis", "implementation", "testing"]),
      ],
      activeCounts: { codex: 1, opencode: 0 },
      excludedAdapters: [],
    });

    expect(selected.name).toBe("opencode");
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
      adapters: [health("opencode", ["implementation"])],
      activeCounts: {},
      excludedAdapters: [],
    })).toThrow("No healthy worker satisfies: review");
  });

  it("uses a stable name tie-breaker for identical capability and load", () => {
    const selected = routeWorker({
      requirements: ["analysis"],
      adapters: [
        health("opencode", ["analysis"]),
        health("claude", ["analysis"]),
      ],
      activeCounts: {},
      excludedAdapters: [],
    });

    expect(selected.name).toBe("claude");
  });

  it("never routes text, code or review work to the ChatGPT/Codex allowance, which is kept for images", () => {
    const allowance = [health("codex", ["analysis", "implementation", "review", "testing"]), health("openai/gpt-5.6-luna", ["analysis", "implementation", "review", "testing"])];
    for (const requirements of [["implementation"], ["review"], ["analysis"]] as const) {
      expect(routeWorker({ requirements: [...requirements], adapters: [...allowance, health("claude", ["analysis", "implementation", "review", "testing"])], activeCounts: { claude: 5 }, excludedAdapters: [] }).name).toBe("claude");
      expect(() => routeWorker({ requirements: [...requirements], adapters: allowance, activeCounts: {}, excludedAdapters: [] })).toThrow("No healthy worker satisfies");
    }
    const saved = { FLYD_CREW_MODEL: process.env.FLYD_CREW_MODEL, FLYD_CREW_BACKUP_MODELS: process.env.FLYD_CREW_BACKUP_MODELS };
    process.env.FLYD_CREW_MODEL = "openai/gpt-6.1-sol";
    process.env.FLYD_CREW_BACKUP_MODELS = "codex,openai/gpt-5.6-luna,cursor/auto";
    try {
      expect(crewModel()).toBe(DEFAULT_CREW_MODEL);
      expect(crewBackupModels()).toEqual(["cursor/auto"]);
      expect(() => launchCrewmate({ model: "openai/gpt-6.1-sol" } as CrewTask, "brief")).toThrow("kept for images only");
    } finally {
      for (const [name, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
  });
});
