import { describe, expect, it } from "vitest";
import { composeArtefact, WHATSAPP_LINK, type ArtefactInputs } from "../artefact.js";
import { qrSvg } from "../../connectors/whatsapp-pairing.js";
import { ConversationViewServer, SnapshotDiffer } from "../server.js";
import type { WhatsAppPairing } from "../../connectors/whatsapp-pairing.js";
import type { ConversationSnapshot } from "../types.js";

const EMPTY: ArtefactInputs = { memories: [], news: [], taste: [] };
const snapshot = (): ConversationSnapshot => ({ messages: [], working: false } as ConversationSnapshot);

describe("the pairing code as an image", () => {
  it("draws a scannable QR with a quiet zone, as an SVG", () => {
    const svg = qrSvg("2@abc,def,ghi");
    expect(svg.startsWith("<svg ")).toBe(true);
    expect(svg).toContain('fill="#fff"');
    const modules = svg.match(/M\d+ \d+h8v8h-8z/g) ?? [];
    expect(modules.length).toBeGreaterThan(100);
    // 21 modules of 8px plus a 4-module quiet zone on each side.
    expect(svg).toContain('width="232" height="232"');
  });
});

describe("the offer card", () => {
  it("leads the artefact while WhatsApp is unlinked, and is gone once it is", () => {
    const linked = composeArtefact({ ...EMPTY, whatsappLink: true });
    expect(linked[0]).toMatchObject({ id: "news:whatsapp-link", headline: WHATSAPP_LINK.title, links: [{ url: "/whatsapp" }] });
    expect(composeArtefact(EMPTY).some((item) => item.id === "whatsapp-link")).toBe(false);
  });

  it("appears in the timeline last, and disappears the moment WhatsApp is linked", () => {
    const unlinked = new SnapshotDiffer(undefined, { whatsappUnlinked: () => true });
    const first = unlinked.next(snapshot());
    expect(first.order.at(-1)).toBe("whatsapp-link");
    expect(first.messages.find((message) => message.id === "whatsapp-link")?.card).toMatchObject({ line: WHATSAPP_LINK.title, url: "/whatsapp" });
    // Said once: a later update keeps it in place without re-sending it, so the card never flickers.
    const second = unlinked.next(snapshot());
    expect(second.order.at(-1)).toBe("whatsapp-link");
    expect(second.messages.some((message) => message.id === "whatsapp-link")).toBe(false);

    const linked = new SnapshotDiffer(undefined, { whatsappUnlinked: () => false }).next(snapshot());
    expect(linked.order).not.toContain("whatsapp-link");
  });
});

describe("the pairing endpoints", () => {
  const pairing = (code?: string) => ({
    state: () => ({ paired: false, ...(code ? { code } : {}) }),
    start() {},
    stop() {},
    onChange: () => () => {},
  }) as unknown as WhatsAppPairing;

  it("draws the code only for this page's own token, and never as text", async () => {
    const feed = { start() {}, stop() {}, current: () => EMPTY, onRefresh: () => () => {} };
    const server = new ConversationViewServer({ assistantLabel: "Flyd", canSend: false } as never, undefined, undefined, undefined, feed as never, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, pairing("2@secretcode"));
    try {
      const base = `http://127.0.0.1:${await server.listen(0)}`;
      const token = (await (await fetch(base + "/api/token")).json()).token;
      expect((await fetch(base + "/api/whatsapp-qr")).status).toBe(403);
      const qr = await fetch(base + "/api/whatsapp-qr?token=" + token);
      expect(qr.headers.get("content-type")).toContain("image/svg+xml");
      expect(await qr.text()).not.toContain("2@secretcode");
      const pair = await fetch(base + "/api/whatsapp-pair", { method: "POST", headers: { "x-flyd-view-token": token }, body: JSON.stringify({ action: "start" }) });
      expect(await pair.json()).toMatchObject({ result: { paired: false, linking: true } });
      expect((await fetch(base + "/api/whatsapp-pair", { method: "POST", body: "{}" })).status).toBe(403);
      // The artefacts column carries the same offer, opening the code.
      const rail = (server as unknown as { rail: (snapshot: ConversationSnapshot) => { artefacts: Array<{ id: string; title: string; url?: string }> } }).rail(snapshot());
      expect(rail.artefacts.find((card) => card.id === "news:whatsapp-link")).toMatchObject({ title: WHATSAPP_LINK.title, url: "/whatsapp" });
    } finally { await server.close(); }
  });
});
