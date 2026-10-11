import { expect, it } from "vitest";
import { ConversationViewServer } from "../server.js";
it("serves the People artefact and rejects cross-origin or tokenless WhatsApp operations", async () => {
  const feed = { start() {}, stop() {}, current: () => ({ memories: [], news: [], taste: [] }), onRefresh: () => () => {} };
  const server = new ConversationViewServer({ assistantLabel: "Flyd", canSend: false } as never, undefined, undefined, undefined, feed as never);
  try {
    const port = await server.listen(0); const base = `http://127.0.0.1:${port}`;
    const page = await fetch(base + "/whatsapp"); expect(page.status).toBe(200);
    expect(page.headers.get("content-security-policy")).toContain("connect-src 'self'");
    expect(await page.text()).toContain("People, closer.");
    const token = (await (await fetch(base + "/api/token")).json()).token;
    const body = JSON.stringify({ name: "whatsapp_send", input: { id: "fake" } });
    expect((await fetch(base + "/api/whatsapp", { method: "POST", body })).status).toBe(403);
    expect((await fetch(base + "/api/whatsapp", { method: "POST", headers: { "x-flyd-view-token": token, origin: "https://evil.example" }, body })).status).toBe(403);
    expect((await fetch(base + "/api/whatsapp", { method: "POST", headers: { "x-flyd-view-token": token }, body: JSON.stringify({ name: "bash", input: {} }) })).status).toBe(400);
  } finally { await server.close(); }
});
