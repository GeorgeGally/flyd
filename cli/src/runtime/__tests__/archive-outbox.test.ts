import { mkdtemp, readFile, stat } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { describe, expect, it, vi } from "vitest";
import { deliverArchiveOutbox } from "../archive-outbox.js";

describe("deliverArchiveOutbox", () => {
  it("exports eligible corrections and outcomes idempotently", async () => {
    const rawDir = await mkdtemp(join(tmpdir(), "flyd-outbox-"));
    const events = [{
      id: "7",
      eventKey: "event-7",
      eventType: "task.completed",
      taskKey: "task-1",
      taskRevision: 8,
      occurredAt: "2026-07-17T04:00:00.000Z",
      payload: { summary: "Continuity works", verification: { user_confirmed: true } },
    }];
    const store = {
      pendingArchiveEvents: vi.fn(async () => events),
      markArchiveDelivered: vi.fn(async () => undefined),
      markArchiveFailed: vi.fn(async () => undefined),
    };

    await deliverArchiveOutbox(store, rawDir, async () => {});
    await deliverArchiveOutbox(store, rawDir, async () => {});

    const path = join(rawDir, "runtime-event-event-7.md");
    expect((await stat(path)).isFile()).toBe(true);
    expect(await readFile(path, "utf8")).toContain("Verified outcome: Continuity works");
    expect(store.markArchiveDelivered).toHaveBeenCalledWith("7");
    expect(store.markArchiveFailed).not.toHaveBeenCalled();
  });

  it("exports a correction as user-authoritative knowledge with the superseded claim", async () => {
    const rawDir = await mkdtemp(join(tmpdir(), "flyd-correction-outbox-"));
    const store = {
      pendingArchiveEvents: vi.fn(async () => [ {
        id: "8",
        eventKey: "event-8",
        eventType: "task.corrected",
        taskKey: "task-1",
        taskRevision: 9,
        occurredAt: "2026-07-19T04:00:00.000Z",
        payload: {
          original_claim: "The user is Aries",
          corrected_value: "Use the configured birth data",
          authority: "user",
        },
      } ]),
      markArchiveDelivered: vi.fn(async () => undefined),
      markArchiveFailed: vi.fn(async () => undefined),
    };

    await deliverArchiveOutbox(store, rawDir, async () => {});

    const output = await readFile(join(rawDir, "runtime-event-event-8.md"), "utf8");
    expect(output).toContain("The user is Aries -> Use the configured birth data");
    expect(output).toContain('"authority": "user"');
  });

  it("does not describe a local project briefing as a verified implementation outcome", async () => {
    const rawDir = await mkdtemp(join(tmpdir(), "flyd-local-outbox-"));
    const store = {
      pendingArchiveEvents: vi.fn(async () => [ {
        id: "10",
        eventKey: "event-10",
        eventType: "task.completed",
        taskKey: "task-1",
        taskRevision: 11,
        occurredAt: "2026-07-20T04:00:00.000Z",
        payload: {
          summary: "Reviewed project status locally. Repository main at abc is clean.",
          verification: { local_project_briefing: true, worker_launched: false },
        },
      } ]),
      markArchiveDelivered: vi.fn(async () => undefined),
      markArchiveFailed: vi.fn(async () => undefined),
    };

    await deliverArchiveOutbox(store, rawDir, async () => {});

    const output = await readFile(join(rawDir, "runtime-event-event-10.md"), "utf8");
    expect(output).toContain("Local project brief: Reviewed project status locally");
    expect(output).not.toContain("Verified outcome:");
  });

  it("does not acknowledge delivery until the retrieval index refreshes", async () => {
    const rawDir = await mkdtemp(join(tmpdir(), "flyd-index-outbox-"));
    const event = {
      id: "9",
      eventKey: "event-9",
      eventType: "task.corrected",
      taskKey: "task-1",
      taskRevision: 10,
      occurredAt: "2026-07-19T05:00:00.000Z",
      payload: {
        original_claim: "Old assumption",
        corrected_value: "User correction",
        authority: "user",
      },
    };
    const store = {
      pendingArchiveEvents: vi.fn(async () => [ event ]),
      markArchiveDelivered: vi.fn(async () => undefined),
      markArchiveFailed: vi.fn(async () => undefined),
    };

    await expect(deliverArchiveOutbox(
      store,
      rawDir,
      async () => { throw new Error("index unavailable"); },
    )).rejects.toThrow("index unavailable");

    expect(store.markArchiveDelivered).not.toHaveBeenCalled();
    expect(store.markArchiveFailed).toHaveBeenCalledWith("9", "index unavailable");
  });
});
