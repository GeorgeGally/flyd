import { describe, expect, it } from "vitest";
import { buildEvidenceDoctorReport } from "../doctor.js";
import { createDefaultEvidenceRegistry } from "../default-registry.js";
import type { CommandRunner, FetchLike } from "../adapters/common.js";

function okResponse(): Response {
  return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
}

describe("E1 default capability registry", () => {
  it("registers web, GitHub, RSS and YouTube with the intended operations", () => {
    const registry = createDefaultEvidenceRegistry({
      env: {},
      fetchFn: async () => okResponse(),
      commandRunner: async () => ({ stdout: "1", stderr: "" }),
    });

    expect(registry.capabilities()).toEqual(["github", "rss", "web", "youtube"]);
    expect(registry.adaptersFor("web").flatMap((adapter) => adapter.operations)).toEqual(["read", "search"]);
    expect(registry.adaptersFor("github")[0].operations).toEqual(["read", "search"]);
    expect(registry.adaptersFor("rss")[0].operations).toEqual(["read"]);
    expect(registry.adaptersFor("youtube")[0].operations).toEqual(["read", "search"]);
  });

  it("reports operation-level health without pretending missing auth is success", async () => {
    const fetchFn: FetchLike = async (input, init) => {
      const url = String(input);
      if (init?.method === "HEAD") return new Response(null, { status: 200 });
      if (url.endsWith("/rate_limit")) return okResponse();
      return okResponse();
    };
    const commandRunner: CommandRunner = async () => ({ stdout: "2026.07.01", stderr: "" });
    const registry = createDefaultEvidenceRegistry({ env: {}, fetchFn, commandRunner });

    const report = await buildEvidenceDoctorReport(
      registry,
      () => new Date("2026-07-30T00:00:00.000Z"),
    );

    const webRead = report.diagnostics.find((entry) => entry.capability === "web" && entry.operation === "read");
    const webSearch = report.diagnostics.find((entry) => entry.capability === "web" && entry.operation === "search");
    const githubSearch = report.diagnostics.find((entry) => entry.capability === "github" && entry.operation === "search");

    expect(webRead?.status).toBe("ready");
    expect(webSearch?.status).toBe("auth_required");
    expect(githubSearch?.status).toBe("degraded");
    expect(report.summary.auth_required).toBe(1);
  });
});
