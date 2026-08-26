import { execFile } from "child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "util";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { IntelligenceEventStore } from "../../intelligence/event-store.js";
import { configureTransitionStore } from "../../transitions/writer.js";
import { verifyWorkerResult } from "../result-verifier.js";

const execFileAsync = promisify(execFile);
const rootDir = mkdtempSync(join(tmpdir(), "flyd-transitions-harness-"));
const roots: string[] = [];

afterAll(async () => {
  rmSync(rootDir, { recursive: true, force: true });
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

let dbPath = "";
let registryPath = "";

beforeEach(() => {
  const id = randomUUID();
  dbPath = join(rootDir, `${id}.sqlite`);
  registryPath = join(rootDir, `consents-${id}.json`);
  delete process.env.FLYD_TRANSITIONS_DISABLED;
  configureTransitionStore({ dbPath, registryPath });
});

afterEach(() => {
  delete process.env.FLYD_TRANSITIONS_DISABLED;
});

async function repository(): Promise<{ root: string; head: string }> {
  const root = await mkdtemp(join(tmpdir(), "flyd-harness-test-"));
  roots.push(root);
  await execFileAsync("git", ["init", "-b", "main", root]);
  await writeFile(join(root, "one.txt"), "base\n");
  await execFileAsync("git", ["-C", root, "add", "one.txt"]);
  await execFileAsync("git", ["-C", root, "-c", "user.name=Flyd Test", "-c", "user.email=flyd@example.test", "commit", "-m", "base"]);
  const { stdout } = await execFileAsync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" });
  return { root, head: stdout.trim() };
}

function harnessEvents() {
  const store = new IntelligenceEventStore({ path: dbPath });
  const events = store.readFrom(0).filter((event) => event.sourceId === "transition.harness");
  store.close();
  return events;
}

describe("harness transition capture", () => {
  it("records a failed verdict as a transition.harness verified_outcome", async () => {
    const repo = await repository();
    await writeFile(join(repo.root, "one.txt"), "implemented\n");

    const result = await verifyWorkerResult({
      worktreePath: repo.root,
      baseHead: repo.head,
      commands: ["node -e \"process.exit(7)\""],
    });
    expect(result.passed).toBe(false);

    const events = harnessEvents();
    const verdict = events.find((event) => event.kind === "verified_outcome");
    expect(verdict).toBeDefined();
    expect(verdict!.payload?.nextState).toMatchObject({
      origin: "verifier",
      signal: "failed",
      causalComplete: false,
    });
  });

  it("persists the verdict even though no matching action exists", async () => {
    const repo = await repository();

    const result = await verifyWorkerResult({
      worktreePath: repo.root,
      baseHead: repo.head,
      commands: ["git diff --check"],
      requireChanges: true,
    });
    expect(result.passed).toBe(false);

    const store = new IntelligenceEventStore({ path: dbPath });
    const all = store.readFrom(0);
    store.close();
    expect(all.some((event) => event.sourceId !== "transition.harness" && event.kind === "proposed_action")).toBe(false);

    const events = harnessEvents();
    expect(events.length).toBeGreaterThan(0);
    for (const event of events) {
      expect(event.correlationId).toBeTruthy();
      expect((event.payload?.nextState as Record<string, unknown>).causalComplete).toBe(false);
    }
  });

  it("stores exit-signal only for a failing command — never raw output text", async () => {
    const repo = await repository();

    const result = await verifyWorkerResult({
      worktreePath: repo.root,
      baseHead: repo.head,
      commands: ["node -e \"console.error('HARNESS_SECRET_STDERR_MARKER');process.exit(3)\""],
    });
    expect(result.passed).toBe(false);

    const events = harnessEvents();
    const observation = events.find(
      (event) => event.kind === "observation" && (event.payload?.nextState as Record<string, unknown>)?.signal === "error",
    );
    expect(observation).toBeDefined();
    expect(observation!.sourceId).toBe("transition.harness");

    const serialized = JSON.stringify(events);
    expect(serialized).toContain("\"exitCode\":3");
    expect(serialized).not.toContain("HARNESS_SECRET_STDERR_MARKER");
    expect(serialized).not.toContain("exit(3)");
  });
});
