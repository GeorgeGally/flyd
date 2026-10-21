import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { IntelligenceEventStore } from "../../intelligence/event-store.js";
import { processFirstmateChanges } from "../../intelligence/executive/firstmate-decision.js";
import { ArtefactFeed } from "../artefact.js";
import { ConversationViewServer } from "../server.js";
import type { ConversationSource } from "../types.js";

it("routes tool notices through Core before either the column or island can display them", async () => {
  const dir = mkdtempSync(join(tmpdir(), "flyd-notice-decision-"));
  const store = new IntelligenceEventStore({ path: join(dir, "events.sqlite") });
  const feed = new ArtefactFeed({ home: dir, decideChanges: (changes) => processFirstmateChanges(changes, { store,
    complete: async (prompt) => JSON.stringify(prompt.includes("Friday or Monday?") ? {
      kind: "question", summary: "Choose the launch date.", question: "Launch on Friday or Monday?", questionEvidence: "Launch on Friday or Monday?",
      options: ["Friday", "Monday"], recommendation: { option: "Monday", rationale: "That leaves time to prepare.", evidence: "Monday" }, evidenceRefs: [],
    } : { kind: "routine", summary: "Internal tooling state.", evidenceRefs: [] }),
  }) });
  const source: ConversationSource = {
    assistantLabel: "Flyd", canSend: true,
    listSessions: async () => [{ id: "conversation", title: "Flyd", updatedAt: "2026-10-21T00:00:00Z" }],
    read: async () => ({ messages: [], working: false }),
    follow: (_id, onUpdate) => { onUpdate({ messages: [], working: false }); return { close() {} }; },
    send: async () => ({ id: "unused", timestamp: "2026-10-21T00:00:00Z" }), commands: async () => [], image: async () => null,
  };
  const server = new ConversationViewServer(source, undefined, undefined, undefined, feed);
  const port = await server.listen(0);
  const base = `http://127.0.0.1:${port}`;
  const post = (message: string) => fetch(`${base}/api/notice`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ source: "Claude Code", session: "staff", message }) });
  const status = async () => {
    const response = await fetch(`${base}/api/status`);
    const reader = response.body!.getReader();
    const text = new TextDecoder().decode((await reader.read()).value);
    await reader.cancel();
    return JSON.parse(text.split("data: ")[1].split("\n")[0]);
  };
  try {
    expect(await (await post("Paused: driving no-mistakes run 01M56X1VHPRFDXWTHCZVTG38VZ")).json()).toEqual({ backstage: true });
    expect(server.notices.list()).toEqual([]);
    expect(await status()).toEqual({ session: "conversation", working: false });
    const first = await (await post("Launch on Friday or Monday?")).json();
    expect(first).toMatchObject({ kind: "attention", count: 1 });
    const repeated = await (await post("Launch on Friday or Monday?")).json();
    expect(repeated).toMatchObject({ duplicate: true });
    const shown = await status();
    expect(shown.notice.text).toContain("Launch on Friday or Monday?");
    expect(shown.notice.text).toContain("I recommend \"Monday\".");
    expect(server.notices.list()).toHaveLength(1);
    expect(JSON.stringify(shown)).not.toMatch(/Claude|paused|no-mistakes|01M56/);
    expect(store.readSource("executive.cycle")).toHaveLength(2);
  } finally {
    await server.close();
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
