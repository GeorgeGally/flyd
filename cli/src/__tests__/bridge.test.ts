import { describe, expect, it, vi } from "vitest";
import { runBridge } from "../bridge.js";

describe("CLI brain bridge", () => {
  it("writes only structured JSON for targeted retrieval", async () => {
    const write = vi.fn();
    const retrieve = vi.fn(async (query: string) => ({ version: "1.0", query, matches: [] }));

    const exitCode = await runBridge(["retrieve", "--query", "What was I working on?"], retrieve, write);

    expect(exitCode).toBe(0);
    expect(retrieve).toHaveBeenCalledWith("What was I working on?");
    expect(JSON.parse(write.mock.calls[0][0])).toMatchObject({ version: "1.0", query: "What was I working on?" });
    expect(write).toHaveBeenCalledTimes(1);
  });

  it("returns a structured usage error when the query is missing", async () => {
    const write = vi.fn();
    const exitCode = await runBridge(["retrieve"], vi.fn(), write);

    expect(exitCode).toBe(2);
    expect(JSON.parse(write.mock.calls[0][0])).toMatchObject({ error: "missing_query" });
  });
});
