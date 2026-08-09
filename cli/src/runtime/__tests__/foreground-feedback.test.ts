import { mkdtemp, readFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it } from "vitest";
import { recordForegroundFeedback } from "../foreground-feedback.js";
import { persistTurnReceipt } from "../turn-receipt.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })
  ));
});

async function createFlydDir(recordedAt = "2026-08-09T01:00:00.000Z") {
  const flydDir = await mkdtemp(join(tmpdir(), "flyd-foreground-feedback-"));
  directories.push(flydDir);
  await persistTurnReceipt({
    sessionId: "chat-1",
    turnNumber: 1,
    route: "conversation",
    message: "how can flyd improve",
    model: "gpt-5.6-luna",
    providerIdentity: "api.openai.com/gpt-5.6-luna",
    memory: { verdict: "partial", matches: [] },
    toolCalls: [{ name: "grep", input: { pattern: "chat" }, succeeded: true }],
    answer: "Here are five generic areas. Which one resonates?",
    status: "succeeded",
  }, {
    flydDir,
    id: () => "turn-1",
    now: () => new Date(recordedAt),
  });
  return flydDir;
}

describe("foreground feedback", () => {
  it("repairs the latest Flyd turn when George rejects it in a ChatGPT input", async () => {
    const flydDir = await createFlydDir();

    const result = await recordForegroundFeedback({
      version: 1,
      capturedAt: "2026-08-09T01:04:00.000Z",
      source: "chatgpt",
      authorship: "direct_input",
      application: { bundleId: "com.openai.chat", name: "ChatGPT" },
      windowTitle: "Flyd review",
      text: "Flyd's last answer was bad, generic, and completely useless.",
    }, {
      flydDir,
      id: () => "observation-1",
      repairId: () => "repair-1",
      now: () => new Date("2026-08-09T01:04:01.000Z"),
    });

    expect(result.status).toBe("repaired");
    expect(result.turnReceiptId).toBe("turn-1");

    const observation = JSON.parse(await readFile(
      join(flydDir, "foreground-feedback", "observations", "observation-1.json"),
      "utf8",
    ));
    expect(observation).toMatchObject({
      status: "repaired",
      source: "chatgpt",
      authorship: "direct_input",
      turnReceiptId: "turn-1",
    });

    const correction = await readFile(
      join(flydDir, "wiki", "corrections", "flyd-fix-repair-1.md"),
      "utf8",
    );
    expect(correction).toContain("source: foreground_feedback");
    expect(correction).toContain("foreground_observation_id: observation-1");
    expect(correction).not.toContain("Which one resonates");
  });

  it("captures an ambiguous complaint without poisoning trusted memory", async () => {
    const flydDir = await createFlydDir();

    const result = await recordForegroundFeedback({
      version: 1,
      capturedAt: "2026-08-09T01:04:00.000Z",
      source: "chatgpt",
      authorship: "direct_input",
      application: { bundleId: "com.openai.chat", name: "ChatGPT" },
      windowTitle: "Product discussion",
      text: "That answer was bad and generic.",
    }, {
      flydDir,
      id: () => "observation-2",
      now: () => new Date("2026-08-09T01:04:01.000Z"),
    });

    expect(result).toMatchObject({ status: "pending", reason: "flyd_turn_not_explicit" });
    await expect(readFile(
      join(flydDir, "wiki", "corrections", "flyd-fix-observation-2.md"),
      "utf8",
    )).rejects.toThrow();
  });

  it("keeps terminal OpenCode text pending because authorship is ambiguous", async () => {
    const flydDir = await createFlydDir();

    const result = await recordForegroundFeedback({
      version: 1,
      capturedAt: "2026-08-09T01:04:00.000Z",
      source: "opencode",
      authorship: "ambiguous_terminal",
      application: { bundleId: "com.apple.Terminal", name: "Terminal" },
      windowTitle: "opencode — flyd",
      text: "Flyd's answer was useless.",
    }, {
      flydDir,
      id: () => "observation-3",
      now: () => new Date("2026-08-09T01:04:01.000Z"),
    });

    expect(result).toMatchObject({ status: "pending", reason: "authorship_ambiguous" });
  });

  it("does not attach a complaint to a stale Flyd turn", async () => {
    const flydDir = await createFlydDir("2026-08-08T01:00:00.000Z");

    const result = await recordForegroundFeedback({
      version: 1,
      capturedAt: "2026-08-09T01:04:00.000Z",
      source: "codex",
      authorship: "direct_input",
      application: { bundleId: "com.openai.codex", name: "Codex" },
      windowTitle: "Flyd",
      text: "Flyd's last response was wrong and unhelpful.",
    }, {
      flydDir,
      id: () => "observation-4",
      now: () => new Date("2026-08-09T01:04:01.000Z"),
    });

    expect(result).toMatchObject({ status: "pending", reason: "flyd_turn_stale" });
  });
});
