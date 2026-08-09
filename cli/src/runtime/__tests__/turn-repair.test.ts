import { mkdtemp, readFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it } from "vitest";
import { persistTurnReceipt } from "../turn-receipt.js";
import { repairLatestTurn } from "../turn-repair.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })
  ));
});

describe("repairLatestTurn", () => {
  it("turns explicit negative feedback into a trusted correction and regression case", async () => {
    const flydDir = await mkdtemp(join(tmpdir(), "flyd-turn-repair-"));
    directories.push(flydDir);
    await persistTurnReceipt({
      sessionId: "failed-session",
      turnNumber: 1,
      route: "conversation",
      message: "how can flyd improve",
      model: "gpt-4o-mini",
      providerIdentity: "api.openai.com/gpt-4o-mini",
      memory: {
        verdict: "sufficient",
        matches: Array.from({ length: 3 }, (_, index) => ({
          id: `bad-${index}`,
          path: `conversations/${index}`,
          excerpt: "George: how can flyd improve",
          stale: false,
          authority: "user_observation" as const,
        })),
      },
      toolCalls: [],
      answer: "Focus on enhanced contextual understanding. Which area resonates?",
      status: "succeeded",
    }, {
      flydDir,
      id: () => "turn-1",
      now: () => new Date("2026-08-09T01:00:00.000Z"),
    });

    const repair = await repairLatestTurn(
      "This was generic, ignored trusted memory, and used the wrong model.",
      {
        flydDir,
        id: () => "fix-1",
        now: () => new Date("2026-08-09T01:01:00.000Z"),
      },
    );

    expect(repair.turnReceiptId).toBe("turn-1");
    expect(repair.failureClasses).toEqual(expect.arrayContaining([
      "model_configuration",
      "memory_authority",
      "missing_tool_use",
      "answer_quality",
    ]));

    const correction = await readFile(
      join(flydDir, "wiki", "corrections", "flyd-fix-fix-1.md"),
      "utf8",
    );
    expect(correction).toContain("type: correction");
    expect(correction).toContain("promoted: true");
    expect(correction).toContain("how can flyd improve");
    expect(correction).toContain("This was generic");
    expect(correction).not.toContain("Which area resonates");

    const regression = JSON.parse(await readFile(
      join(flydDir, "evals", "incidents", "fix-1.json"),
      "utf8",
    ));
    expect(regression).toMatchObject({
      prompt: "how can flyd improve",
      rejectedAnswer: "Focus on enhanced contextual understanding. Which area resonates?",
      expected: { feedback: "This was generic, ignored trusted memory, and used the wrong model." },
    });
  });

  it("fails clearly when there is no preceding turn to repair", async () => {
    const flydDir = await mkdtemp(join(tmpdir(), "flyd-turn-repair-empty-"));
    directories.push(flydDir);

    await expect(repairLatestTurn("bad answer", { flydDir })).rejects.toThrow(
      "No Flyd turn receipt is available to repair",
    );
  });
});
