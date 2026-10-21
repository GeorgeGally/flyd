import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { IntelligenceEventStore } from "../../intelligence/event-store.js";
import { processFirstmateChanges } from "../../intelligence/executive/firstmate-decision.js";
import { executiveConversationSource } from "../executive-source.js";
import { SnapshotDiffer } from "../server.js";
import { islandStatusOf, statusOf } from "../status.js";
import type { ConversationSource } from "../types.js";

let dir: string;
afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

it("runs the cancelled review, paused worker and quoted Yes through the decision owner before any display", async () => {
  dir = mkdtempSync(join(tmpdir(), "flyd-executive-surfaces-"));
  const store = new IntelligenceEventStore({ path: join(dir, "events.sqlite") });
  const raw = [
    "The review was cancelled during recovery. I'll decide whether to restart it.",
    "Paused [at=1792311581]: driving no-mistakes run 01M56X1VHPRFDXWTHCZVTG38VZ",
    '"Yes" was the wrong answer to the either/or question. The worker is paused.',
  ];
  const source: ConversationSource = {
    assistantLabel: "firstmate", canSend: true,
    listSessions: async () => [{ id: "staff", title: "Staff", updatedAt: "2026-10-21T00:00:00Z" }],
    read: async () => ({ messages: raw.map((text, i) => ({ id: `staff-${i}`, role: "assistant", text })), working: true, activity: "worker paused" }),
    follow: () => ({ close() {} }), send: async () => ({ id: "sent", timestamp: "2026-10-21T00:00:00Z" }),
    commands: async () => [], image: async () => null,
  };
  const complete = vi.fn(async () => JSON.stringify({ kind: "routine", summary: "Operational information.", evidenceRefs: [] }));
  const decided = executiveConversationSource(source, (changes) => processFirstmateChanges(changes, { store, complete }));
  const snapshot = await decided.read("staff");
  const rendered = new SnapshotDiffer().next(snapshot);
  expect(snapshot.messages).toEqual([]);
  expect(rendered.messages).toEqual([]);
  expect(islandStatusOf(statusOf(snapshot))).toEqual({ working: false });
  expect(store.readSource("executive.cycle")).toHaveLength(3);
  expect(complete).toHaveBeenCalledTimes(3);
  store.close();
});

it("keeps the real either/or alternatives instead of creating an automatic Yes", async () => {
  dir = mkdtempSync(join(tmpdir(), "flyd-executive-choice-"));
  const store = new IntelligenceEventStore({ path: join(dir, "events.sqlite") });
  const detail = "Review https://github.com/example/project/pull/5: close it, or add the missing tools?";
  const decide = (changes: Parameters<typeof processFirstmateChanges>[0]) => processFirstmateChanges(changes, { store,
    complete: async () => JSON.stringify({ kind: "question", summary: "Choose the remaining scope.", question: "Close the review or finish the tools?", questionEvidence: "close it, or add the missing tools?", options: ["close it", "add the missing tools"], recommendation: { option: "add the missing tools", rationale: "That completes the remaining scope.", evidence: "missing tools" }, evidenceRefs: ["firstmate-reply:staff-reply"] }),
  });
  const send = vi.fn();
  const source: ConversationSource = {
    assistantLabel: "firstmate", canSend: true, listSessions: async () => [],
    read: async () => ({ messages: [{ id: "staff-reply", role: "assistant", text: detail }], working: false }),
    follow: () => ({ close() {} }), send, commands: async () => [], image: async () => null,
  };
  const projected = executiveConversationSource(source, decide);
  const snapshot = await projected.read("staff");
  expect(snapshot.messages[0].text).toContain("- close it\n- add the missing tools");
  expect(snapshot.messages[0].text).toContain("I recommend \"add the missing tools\".");
  expect(send).not.toHaveBeenCalled();
  expect(store.readSource("executive.cycle")[0].payload?.decision).toMatchObject({ disposition: "ask_george", show: true });
  store.close();
});

it("carries an answer to a Core-owned decision through the decision record, not as a bare staff note", async () => {
  const sendDecision = vi.fn(async () => ({ id: "staff-note", timestamp: "2026-10-21T00:00:00Z" }));
  const resolveDecision = vi.fn(async () => undefined);
  const source: ConversationSource = {
    assistantLabel: "firstmate", canSend: true, listSessions: async () => [],
    read: async () => ({ messages: [], working: false }),
    follow: () => ({ close() {} }), send: vi.fn(), sendDecision, commands: async () => [], image: async () => null,
  };
  const projected = executiveConversationSource(source, async () => [], resolveDecision);

  await projected.sendDecision!("close it", [], { decisionId: "decision-1", taskId: "review" });
  expect(resolveDecision).toHaveBeenCalledWith("decision-1", "review", "close it");
  expect(sendDecision).not.toHaveBeenCalled();

  await projected.sendDecision!("Answer to pending decision review", []);
  expect(sendDecision).toHaveBeenCalledWith("Answer to pending decision review", [], undefined);
});
