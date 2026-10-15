import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, it } from "vitest";
import { ConversationViewServer } from "../server.js";
import { RoutineArtefacts } from "../routines.js";
import type { ConversationSource } from "../types.js";

it("discovers via send ingress, activates, routes once and preserves uncertain dispatch on retry", async () => {
  const dir = mkdtempSync(join(tmpdir(), "flyd-routine-api-"));
  const routines = new RoutineArtefacts({ path: join(dir, "state.sqlite") });
  let calls = 0;
  let fail = false;
  const source = {
    assistantLabel: "Flyd", canSend: true,
    listSessions: async () => [{ id: "market", title: "Market", updatedAt: "" }],
    send: async (_session: string, _text: string) => {
      calls++;
      if (fail) throw Error("disconnected after dispatch");
      return { id: "note:" + calls, timestamp: new Date().toISOString() };
    },
  } as unknown as ConversationSource;
  const feed = { start() {}, stop() {}, current: () => ({ memories: [], news: [], taste: [] }), onRefresh: () => () => {} };
  const server = new ConversationViewServer(source, undefined, undefined, undefined, feed as never,
    undefined, undefined, undefined, undefined, undefined, undefined, routines);
  try {
    const port = await server.listen(0);
    const base = `http://127.0.0.1:${port}`;
    const token = (await (await fetch(base + "/api/token")).json()).token;
    const post = (body: unknown, route = "/api/routines") => fetch(base + route, {
      method: "POST", headers: { "content-type": "application/json", "x-flyd-view-token": token }, body: JSON.stringify(body),
    });
    expect((await fetch(base + "/api/routines")).status).toBe(403);
    expect((await fetch(base + "/api/routines", {
      method: "POST", headers: { "x-flyd-view-token": token, origin: "https://evil.example" }, body: "{}",
    })).status).toBe(403);
    expect((await fetch(base + "/routines")).status).toBe(200);
    const text = "Review the vendor applications and draft my follow ups";
    for (let i = 0; i < 3; i++) {
      const result = await (await post({ session: "market", text }, "/api/send")).json();
      expect(Boolean(result.routineSuggestion)).toBe(i === 2);
    }
    const suggestion = routines.list().routines[0];
    const active = (await (await post({ action: "save", ...suggestion,
      template: "Review {{topic}} and draft my follow ups" })).json()).routine;
    const request = { action: "run", id: active.id, revision: active.revision, session: "latest",
      requestId: "request-1234567890", inputs: { topic: "vendors" } };
    expect((await (await post(request)).json()).run.status).toBe("submitted");
    expect(calls).toBe(4);
    expect((await (await post(request)).json()).fresh).toBe(false);
    expect(calls).toBe(4);
    fail = true;
    const unknown = { ...request, requestId: "request-0987654321" };
    expect((await (await post(unknown)).json()).run.status).toBe("unknown");
    await post(unknown);
    expect(calls).toBe(5);
    await post({ action: "erase" });
    expect(routines.list()).toEqual({ routines: [], runs: [], enabled: false });
  } finally {
    await server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
