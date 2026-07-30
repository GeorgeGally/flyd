import { describe, expect, it } from "vitest";
import { buildEvidenceDoctorReport } from "../doctor.js";
import { createDefaultEvidenceRegistry } from "../default-registry.js";
import type { CommandRunner, FetchLike } from "../adapters/common.js";

function okResponse(): Response {
  return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
}

describe("default evidence capability registry", () => {
  it("registers E1 and E3 capabilities with their intended operations", () => {
    const registry = createDefaultEvidenceRegistry({
      env: {},
      fetchFn: async () => okResponse(),
      commandRunner: async () => ({ stdout: "1", stderr: "" }),
      socialMinimumIntervalMs: 0,
    });

    expect(registry.capabilities()).toEqual([
      "github",
      "hackernews",
      "reddit",
      "rss",
      "web",
      "x",
      "youtube",
    ]);
    expect(registry.adaptersFor("web").flatMap((adapter) => adapter.operations)).toEqual(["read", "search"]);
    expect(registry.adaptersFor("github")[0].operations).toEqual(["read", "search"]);
    expect(registry.adaptersFor("hackernews")[0].operations).toEqual(["read", "search"]);
    expect(registry.adaptersFor("reddit")[0].operations).toEqual(["read", "search"]);
    expect(registry.adaptersFor("rss")[0].operations).toEqual(["read"]);
    expect(registry.adaptersFor("x")[0].operations).toEqual(["read", "search"]);
    expect(registry.adaptersFor("youtube")[0].operations).toEqual(["read", "search"]);
  });

  it("reports each source's operation-level health without pretending missing auth is success", async () => {
    const fetchFn: FetchLike = async (input, init) => {
      const url = String(input);
      if (init?.method === "HEAD") return new Response(null, { status: 200 });
      if (url.endsWith("/rate_limit")) return okResponse();
      return okResponse();
    };
    const commandRunner: CommandRunner = async () => ({ stdout: "2026.07.01", stderr: "" });
    const registry = createDefaultEvidenceRegistry({
      env: {},
      fetchFn,
      commandRunner,
      socialMinimumIntervalMs: 0,
    });

    const report = await buildEvidenceDoctorReport(
      registry,
      () => new Date("2026-07-30T00:00:00.000Z"),
    );

    const status = (capability: string, operation: string) => report.diagnostics.find(
      (entry) => entry.capability === capability && entry.operation === operation,
    )?.status;

    expect(status("web", "read")).toBe("ready");
    expect(status("web", "search")).toBe("auth_required");
    expect(status("github", "search")).toBe("degraded");
    expect(status("hackernews", "search")).toBe("ready");
    expect(status("reddit", "search")).toBe("degraded");
    expect(status("x", "read")).toBe("auth_required");
    expect(status("x", "search")).toBe("auth_required");
    expect(report.summary.auth_required).toBe(3);
  });
});
