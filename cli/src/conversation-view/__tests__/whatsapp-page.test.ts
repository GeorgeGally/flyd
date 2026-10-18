// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderWhatsAppPage } from "../whatsapp-page.js";
const settle = async () => { for (let i = 0; i < 6; i++) await new Promise(r => setTimeout(r, 0)); };
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
describe("People artefact", () => {
  it("renders hostile messages as text, reviews immutable recipient/body, and sends once on a click", async () => {
    let sent = 0;
    vi.stubGlobal("setInterval", vi.fn());
    vi.stubGlobal("fetch", vi.fn(async (_url, options) => {
      const { name, input } = JSON.parse(options.body); let result: unknown;
      if (name === "whatsapp_status") result = { paired: true, state: "connected" };
      if (name === "whatsapp_search") result = { chats: [{ id: "123@s.whatsapp.net", name: "Erica", latest: Date.now() }] };
      if (name === "whatsapp_read") result = { messages: [{ sender: "123@s.whatsapp.net", text: '<img src=x onerror="window.pwned=true">', timestamp: Date.now() }] };
      if (name === "whatsapp_draft") result = { id: "draft-1", recipient: { id: input.chat, name: "Erica" }, body: input.body };
      if (name === "whatsapp_send") { sent++; result = { status: "sent" }; }
      return new Response(JSON.stringify({ result }), { status: 200 });
    }));
    const html = renderWhatsAppPage("test-token");
    document.body.innerHTML = /<body[^>]*>([\s\S]*)<\/body>/.exec(html)![1].replace(/<script>[\s\S]*<\/script>/, "");
    new Function(/<script>([\s\S]*)<\/script>/.exec(html)![1])();
    await settle(); (document.querySelector(".chat") as HTMLButtonElement).click(); await settle();
    expect(document.querySelector(".messages img")).toBe(null);
    expect(document.querySelector(".messages")?.textContent).toContain("<img");
    const body = document.querySelector("textarea")!; body.value = "See you soon"; body.dispatchEvent(new Event("input"));
    (document.getElementById("draft") as HTMLButtonElement).click(); await settle();
    expect(sent).toBe(0); expect(document.getElementById("review")!.hidden).toBe(false);
    expect(document.getElementById("review-to")!.textContent).toContain("123@s.whatsapp.net");
    expect(document.getElementById("review-body")!.textContent).toBe("See you soon");
    const send = document.getElementById("send") as HTMLButtonElement; send.click(); send.click(); await settle();
    expect(sent).toBe(1); expect(document.getElementById("notice")!.textContent).toContain("Sent to Erica");
  });
  it("uses Flyd styles, responsive layout and reduced-motion support without remote assets", () => {
    const html = renderWhatsAppPage("token");
    expect(html).toContain("prefers-reduced-motion"); expect(html).toContain("max-width:520px");
    expect(html).not.toMatch(/<script[^>]+src=|<link[^>]+href=/);
  });
  it("offers the live pairing code in the page while WhatsApp is unlinked", async () => {
    vi.stubGlobal("setInterval", vi.fn());
    vi.stubGlobal("fetch", vi.fn(async (url, options) => {
      if (url === "/api/whatsapp-pair") return new Response(JSON.stringify({ result: { paired: false, linking: true } }), { status: 200 });
      const { name } = JSON.parse(options.body); let result: unknown;
      if (name === "whatsapp_status") result = { paired: false, state: "disconnected" };
      return new Response(JSON.stringify({ result }), { status: 200 });
    }));
    const html = renderWhatsAppPage("test-token");
    document.body.innerHTML = /<body[^>]*>([\s\S]*)<\/body>/.exec(html)![1].replace(/<script>[\s\S]*<\/script>/, "");
    new Function(/<script>([\s\S]*)<\/script>/.exec(html)![1])();
    await settle();
    const qr = document.querySelector(".qr") as HTMLImageElement;
    expect(qr.src).toContain("/api/whatsapp-qr?token=test-token");
    expect(document.getElementById("messages")!.textContent).toContain("Link a device");
    expect(document.body.textContent).not.toContain("flyd whatsapp connect");
  });
});
