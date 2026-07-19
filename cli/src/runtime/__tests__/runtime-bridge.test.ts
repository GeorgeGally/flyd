import { describe, expect, it, vi } from "vitest";
import { runRuntimeBridge } from "../../runtime-bridge.js";

describe("runtime command bridge", () => {
  it("returns one versioned JSON success envelope", async () => {
    const service = {
      execute: vi.fn(async () => ({
        action: "health",
        data: { healthy: true },
      })),
    };

    const response = await runRuntimeBridge(JSON.stringify({
      schemaVersion: 1,
      action: "health",
      actorSurface: "rails",
    }), service);

    expect(response.exitCode).toBe(0);
    expect(JSON.parse(response.output)).toEqual({
      schemaVersion: 1,
      ok: true,
      result: { action: "health", data: { healthy: true } },
    });
    expect(service.execute).toHaveBeenCalledOnce();
  });

  it("fails closed for invalid JSON and oversized requests", async () => {
    const service = { execute: vi.fn() };

    const invalid = await runRuntimeBridge("{", service);
    const oversized = await runRuntimeBridge("x".repeat(65 * 1024), service);

    expect(invalid.exitCode).toBe(1);
    expect(JSON.parse(invalid.output)).toMatchObject({ ok: false, error: { code: "invalid_json" } });
    expect(oversized.exitCode).toBe(1);
    expect(JSON.parse(oversized.output)).toMatchObject({
      ok: false,
      error: { message: expect.stringMatching(/too large/i) },
    });
    expect(service.execute).not.toHaveBeenCalled();
  });
});
