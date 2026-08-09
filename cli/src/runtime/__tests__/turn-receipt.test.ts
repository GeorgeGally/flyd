import { mkdtemp, readFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it } from "vitest";
import {
  loadLatestTurnReceipt,
  persistTurnReceipt,
} from "../turn-receipt.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })
  ));
});

describe("turn receipts", () => {
  it("persists the effective model, memory authority, tools, and final answer", async () => {
    const flydDir = await mkdtemp(join(tmpdir(), "flyd-turn-receipt-"));
    directories.push(flydDir);

    const receipt = await persistTurnReceipt({
      sessionId: "session-1",
      turnNumber: 2,
      route: "conversation",
      message: "how can flyd improve",
      model: "gpt-4.6",
      providerIdentity: "models.example.test/gpt-4.6",
      memory: {
        verdict: "partial",
        matches: [{
          id: "observation-1",
          path: "conversations/1",
          excerpt: "George: how can flyd improve",
          stale: false,
          authority: "user_observation",
        }],
      },
      toolCalls: [{ name: "grep", input: { pattern: "conversation-responder" }, succeeded: true }],
      answer: "The primary conversation path is one-shot.",
      status: "succeeded",
    }, {
      flydDir,
      id: () => "receipt-1",
      now: () => new Date("2026-08-09T00:00:00.000Z"),
    });

    expect(receipt.id).toBe("receipt-1");
    expect(receipt.memory.matches[0].authority).toBe("user_observation");
    expect(receipt.toolCalls[0]).toMatchObject({ name: "grep", succeeded: true });
    await expect(loadLatestTurnReceipt({ flydDir })).resolves.toEqual(receipt);

    const stored = JSON.parse(await readFile(
      join(flydDir, "turn-receipts", "session-1", "000002-receipt-1.json"),
      "utf8",
    ));
    expect(stored.providerIdentity).toBe("models.example.test/gpt-4.6");
  });

  it("loads the latest receipt for a specific session instead of another active chat", async () => {
    const flydDir = await mkdtemp(join(tmpdir(), "flyd-turn-session-"));
    directories.push(flydDir);
    const base = {
      turnNumber: 1,
      route: "conversation" as const,
      message: "question",
      model: "gpt-4.6",
      providerIdentity: "models.example.test/gpt-4.6",
      memory: { verdict: "insufficient" as const, matches: [] },
      toolCalls: [],
      answer: "answer",
      status: "succeeded" as const,
    };
    await persistTurnReceipt({ ...base, sessionId: "session-a" }, {
      flydDir, id: () => "receipt-a",
    });
    await persistTurnReceipt({ ...base, sessionId: "session-b" }, {
      flydDir, id: () => "receipt-b",
    });

    await expect(loadLatestTurnReceipt({ flydDir, sessionId: "session-a" }))
      .resolves.toMatchObject({ id: "receipt-a", sessionId: "session-a" });
  });
});
