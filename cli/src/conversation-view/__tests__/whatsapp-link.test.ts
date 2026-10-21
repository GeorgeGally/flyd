import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { composeArtefact, WHATSAPP_LINK, type ArtefactInputs } from "../artefact.js";
import { qrSvg } from "../../connectors/whatsapp-pairing.js";
import { ConversationViewServer, SnapshotDiffer } from "../server.js";
import type { WhatsAppPairing } from "../../connectors/whatsapp-pairing.js";
import type { ConversationSnapshot } from "../types.js";

const require = createRequire(import.meta.url);
interface VendorQr { addData(data: string): void; make(): void; getModuleCount(): number; isDark(row: number, col: number): boolean }
const VendorQRCode = require("qrcode-terminal/vendor/QRCode") as new (type: number, level: number) => VendorQr;
const ERROR_LEVEL_L = require("qrcode-terminal/vendor/QRCode/QRErrorCorrectLevel").L as number;

const EMPTY: ArtefactInputs = { memories: [], news: [], taste: [] };
const snapshot = (): ConversationSnapshot => ({ messages: [], working: false } as ConversationSnapshot);

const MODULE = 8;
const QUIET = 4;
const FINDER = ["1111111", "1000001", "1011101", "1011101", "1011101", "1000001", "1111111"];

function darkModules(svg: string): Set<string> {
  const dark = new Set<string>();
  const add = (x: number, y: number, unit: number): void => { dark.add(`${y / unit - QUIET},${x / unit - QUIET}`); };
  for (const m of svg.matchAll(/M(\d+) (\d+)h(\d+)v(\d+)h-\d+z/g)) add(Number(m[1]), Number(m[2]), Number(m[3]));
  for (const m of svg.matchAll(/<rect\b[^>]*>/g)) {
    const tag = m[0]; const x = tag.match(/\bx="(\d+)"/); const y = tag.match(/\by="(\d+)"/); const w = tag.match(/\bwidth="(\d+)"/);
    if (x && y && w && /fill="#000"/.test(tag)) add(Number(x[1]), Number(y[1]), Number(w[1]));
  }
  return dark;
}

describe("the pairing code as an image", () => {
  it("encodes the payload as a scannable QR: square, quiet-zoned, finder-marked, matching the encoder", () => {
    const payload = "2@abc,def,ghi";
    const svg = qrSvg(payload, MODULE);
    const dark = darkModules(svg);
    expect(svg.startsWith("<svg ")).toBe(true);
    const ref = new VendorQRCode(-1, ERROR_LEVEL_L);
    ref.addData(payload);
    ref.make();
    const count = ref.getModuleCount();
    expect(svg).toContain(`width="${(count + QUIET * 2) * MODULE}"`);
    for (const key of dark) {
      const [row, col] = key.split(",").map(Number);
      expect(row).toBeGreaterThanOrEqual(0); expect(row).toBeLessThan(count);
      expect(col).toBeGreaterThanOrEqual(0); expect(col).toBeLessThan(count);
    }
    const corners: Array<[number, number]> = [[0, 0], [0, count - 7], [count - 7, 0]];
    for (const [r0, c0] of corners) {
      for (let r = 0; r < 7; r += 1) for (let c = 0; c < 7; c += 1) {
        expect(dark.has(`${r0 + r},${c0 + c}`)).toBe(FINDER[r][c] === "1");
      }
    }
    for (let r = 0; r < count; r += 1) for (let c = 0; c < count; c += 1) {
      expect(dark.has(`${r},${c}`)).toBe(ref.isDark(r, c));
    }
  });
});

describe("the offer card", () => {
  it("leads the artefact while WhatsApp is unlinked, and is gone once it is", () => {
    const linked = composeArtefact({ ...EMPTY, whatsappLink: true });
    expect(linked[0]).toMatchObject({ id: "news:whatsapp-link", headline: WHATSAPP_LINK.title, links: [{ url: "/whatsapp" }] });
    expect(composeArtefact(EMPTY).some((item) => item.id === "news:whatsapp-link")).toBe(false);
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
    const server = new ConversationViewServer({ assistantLabel: "Flyd", canSend: false } as never, undefined, undefined, undefined, feed as never, undefined, undefined, undefined, undefined, undefined, undefined, undefined, pairing("2@secretcode"));
    try {
      const base = `http://127.0.0.1:${await server.listen(0)}`;
      const token = (await (await fetch(base + "/api/token")).json()).token;
      expect((await fetch(base + "/api/whatsapp-qr")).status).toBe(403);
      const qr = await fetch(base + "/api/whatsapp-qr?token=" + token);
      expect(qr.headers.get("content-type")).toContain("image/svg+xml");
      expect(await qr.text()).not.toContain("2@secretcode");
      const pair = await fetch(base + "/api/whatsapp-pair", { method: "POST", headers: { "x-flyd-view-token": token }, body: JSON.stringify({ action: "start" }) });
      expect(await pair.json()).toMatchObject({ result: { paired: false } });
      expect((await fetch(base + "/api/whatsapp-pair", { method: "POST", body: "{}" })).status).toBe(403);
      // The artefacts column carries the same offer, opening the code.
      const rail = (server as unknown as { rail: (snapshot: ConversationSnapshot) => { artefacts: Array<{ id: string; title: string; url?: string }> } }).rail(snapshot());
      expect(rail.artefacts.find((card) => card.id === "news:whatsapp-link")).toMatchObject({ title: WHATSAPP_LINK.title, url: "/whatsapp" });
    } finally { await server.close(); }
  });

  it("answers with an image before the first code is drawn, so the box is never blank", async () => {
    const feed = { start() {}, stop() {}, current: () => EMPTY, onRefresh: () => () => {} };
    const server = new ConversationViewServer({ assistantLabel: "Flyd", canSend: false } as never, undefined, undefined, undefined, feed as never, undefined, undefined, undefined, undefined, undefined, undefined, undefined, pairing());
    try {
      const base = `http://127.0.0.1:${await server.listen(0)}`;
      const token = (await (await fetch(base + "/api/token")).json()).token;
      const qr = await fetch(base + "/api/whatsapp-qr?token=" + token);
      expect(qr.status).toBe(200);
      expect(qr.headers.get("content-type")).toContain("image/svg+xml");
      expect((await qr.text()).startsWith("<svg")).toBe(true);
    } finally { await server.close(); }
  });
});
