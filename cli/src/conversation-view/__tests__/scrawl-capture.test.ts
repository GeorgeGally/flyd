import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const root = mkdtempSync(join(tmpdir(), "flyd-scrawl-test-"));
const rawDir = join(root, "raw");
const flydDir = join(root, "flyd");
const captures = join(root, "captures");
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

vi.mock("../../lib/config.js", async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return { ...actual, RAW_DIR: rawDir, FLYD_DIR: flydDir };
});

vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return { ...actual, homedir: () => root };
});

let bundleDir: string;
let summary: string;

beforeEach(() => {
  mkdirSync(rawDir, { recursive: true });
  mkdirSync(flydDir, { recursive: true });
  mkdirSync(captures, { recursive: true });
  bundleDir = join(captures, "sample.scrawl");
  mkdirSync(bundleDir);
  summary = `[scrawl 0:12 · App “Window” · ${bundleDir}]\n#1 (0:03) “first frame”\n#2 (0:09) [clicked “Save”] “second frame”`;
  writeFileSync(join(bundleDir, "contact-sheet.png"), Buffer.from(PNG, "base64"));
  writeFileSync(join(bundleDir, "summary.md"), summary);
  writeFileSync(join(bundleDir, "scrawl.json"), JSON.stringify({ duration_ms: 12_000, target: { app: "App", window_title: "Window" } }));
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("Scrawl capture", () => {
  it("recognises summary paths, typed paths and latest, not ordinary text", async () => {
    const { findScrawl } = await import("../scrawl-capture.js");
    expect(findScrawl(summary)).toEqual({ path: resolve(bundleDir) });
    expect(findScrawl(bundleDir)).toEqual({ path: resolve(bundleDir) });
    expect(findScrawl("latest scrawl")).toEqual({ path: "latest" });
    expect(findScrawl("scrawl latest")).toEqual({ path: "latest" });
    expect(findScrawl("README.md" )).toBeNull();
    expect(findScrawl("ordinary words")).toBeNull();
    expect(findScrawl(`compare https://x.com/y and/or see ${bundleDir} please`)).toEqual({ path: resolve(bundleDir) });
    expect(findScrawl(`'${bundleDir}'`)).toEqual({ path: resolve(bundleDir) });
  });

  it("resolves newest latest bundle and rejects incomplete bundles", async () => {
    const { resolveBundle } = await import("../scrawl-capture.js");
    const older = join(captures, "older.scrawl");
    mkdirSync(older);
    writeFileSync(join(older, "summary.md"), summary);
    writeFileSync(join(older, "contact-sheet.png"), Buffer.from(PNG, "base64"));
    const old = new Date(Date.now() - 10_000);
    utimesSync(older, old, old);
    expect(resolveBundle("latest", captures).dir).toBe(resolve(bundleDir));
    const missingSheet = join(captures, "missing.scrawl");
    mkdirSync(missingSheet);
    writeFileSync(join(missingSheet, "summary.md"), summary);
    expect(() => resolveBundle(missingSheet)).toThrow("Incomplete Scrawl bundle");
  });

  it("adds the sheet once, the pointer once, and caps inlined summary", async () => {
    const { expandScrawl } = await import("../scrawl-capture.js");
    const result = await expandScrawl({ text: `fix this\n\n${summary}` });
    expect(result.text.match(/\[scrawl: /g)).toHaveLength(1);
    expect(result.text.match(/#1 \(0:03\)/g)).toHaveLength(1);
    expect(result.images).toEqual([{ mediaType: "image/png", data: PNG }]);
    const attached = await expandScrawl({ text: `fix ${bundleDir}`, images: result.images });
    expect(attached.images).toHaveLength(1);
    writeFileSync(join(bundleDir, "summary.md"), "x".repeat(5_000));
    const capped = (await expandScrawl({ text: bundleDir })).text;
    expect(capped).toContain("x".repeat(4_000));
    expect(capped).not.toContain("x".repeat(4_001));
  });

  it("files a bundle only once", async () => {
    const { fileScrawl, resolveBundle } = await import("../scrawl-capture.js");
    const bundle = resolveBundle(bundleDir);
    await fileScrawl(bundle);
    await fileScrawl(bundle);
    const files = readdirSync(rawDir).filter((name) => name.endsWith(".md"));
    expect(files).toHaveLength(1);
    expect(readFileSync(join(rawDir, files[0]!), "utf8")).toContain(`[scrawl App · Window · 12s · ${resolve(bundleDir)}]`);
    expect(readFileSync(join(rawDir, files[0]!), "utf8")).toContain("first frame");
  });

  it.skipIf(process.platform !== "darwin")("imports an actual Swift-generated native bundle and attaches its contact sheet", async () => {
    const native = fileURLToPath(new URL("../../../../mac-adapter/", import.meta.url));
    const binary = join(root, "scrawl-sample");
    execFileSync("swiftc", [join(native, "Sources/Scrawl/ScrawlBundle.swift"), join(native, "Sources/Scrawl/ScrawlOverlay.swift"), join(native, "Tools/ScrawlSample.swift"), "-o", binary], { timeout: 60_000 });
    execFileSync(binary, [captures], { timeout: 20_000 });
    const generated = join(captures, "flyd-native-sample.scrawl");
    const { expandScrawl, fileScrawl, resolveBundle } = await import("../scrawl-capture.js");
    const sheet = readFileSync(join(generated, "contact-sheet.png")).toString("base64");
    const imported = await expandScrawl({ text: `[scrawl: ${generated}]`, images: [{ mediaType: "image/png", data: sheet }] });
    expect(imported.images).toEqual([{ mediaType: "image/png", data: sheet }]);
    expect(imported.text).toContain("[0:00–0:04] Mark this line, then click here.");
    expect(imported.text).toContain("[0:03] left click");
    expect(imported.text).toContain("Mark m1");
    expect(readdirSync(rawDir)).toHaveLength(0);
    await fileScrawl(resolveBundle(generated));
    expect(readFileSync(join(rawDir, readdirSync(rawDir)[0]!), "utf8")).toContain("4s");
  }, 90_000);

  it("leaves a message unchanged when latest scrawl finds no captures", async () => {
    const { expandScrawl } = await import("../scrawl-capture.js");
    expect(await expandScrawl({ text: "is the latest scrawl thing done?" })).toEqual({ text: "is the latest scrawl thing done?" });
  });

  it("sends the sheet and pointer from the message box and files only after delivery", async () => {
    const { ConversationViewServer } = await import("../server.js");
    const sent: Array<{ text: string; images?: Array<{ mediaType: string; data: string }> }> = [];
    let fail = true;
    const source = {
      assistantLabel: "Flyd", canSend: true,
      listSessions: async () => [{ id: "s1", title: "S1", updatedAt: "" }],
      send: async (_session: string, text: string, images?: Array<{ mediaType: string; data: string }>) => {
        if (fail) throw new Error("Flyd couldn't pass this on just now; send it again");
        sent.push({ text, ...(images ? { images } : {}) });
        return { id: `note:${sent.length}`, timestamp: new Date().toISOString() };
      },
    };
    const feed = { start() {}, stop() {}, current: () => ({ memories: [], news: [], taste: [] }), onRefresh: () => () => {} };
    const server = new ConversationViewServer(source as never, undefined, undefined, undefined, feed as never);
    try {
      const base = `http://127.0.0.1:${await server.listen(0)}`;
      const token = (await (await fetch(`${base}/api/token`)).json()).token;
      const post = (text: string) => fetch(`${base}/api/send`, {
        method: "POST", headers: { "content-type": "application/json", "x-flyd-view-token": token }, body: JSON.stringify({ session: "s1", text }),
      });
      const captured = () => existsSync(rawDir) ? readdirSync(rawDir).filter((name) => name.endsWith(".md")) : [];
      expect((await post(`fix the thing shown in ${bundleDir}`)).status).toBe(502);
      expect(captured()).toHaveLength(0);
      fail = false;
      expect((await post(`fix the thing shown in ${bundleDir}`)).status).toBe(200);
      expect(sent[0]!.text).toContain(`[scrawl: ${resolve(bundleDir)}]`);
      expect(sent[0]!.text).toContain("first frame");
      expect(sent[0]!.images).toEqual([{ mediaType: "image/png", data: PNG }]);
      expect(captured()).toHaveLength(1);
    } finally {
      await server.close();
    }
  });
});
