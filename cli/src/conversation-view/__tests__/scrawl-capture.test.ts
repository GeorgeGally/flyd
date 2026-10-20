import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
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

  it("routes an expanded Scrawl to Firstmate with the sheet and pointer", async () => {
    const { ClaudeCodeTranscriptSource } = await import("../claude-code-source.js");
    const project = join(root, "project");
    mkdirSync(project);
    writeFileSync(join(project, "s1.jsonl"), "{}\n");
    let note = "";
    let sentImages: Array<{ mediaType: string; data: string }> = [];
    const source = new ClaudeCodeTranscriptSource({
      projectDir: project,
      inbox: {
        send: async (text, images) => {
          sentImages = images ?? [];
          note = `${text}\n${sentImages.map((image) => `[image: contact-sheet ${image.data.slice(0, 24)}]`).join("\n")}`;
          return { id: "note:1", timestamp: new Date().toISOString() };
        },
        notes: () => [],
        image: () => null,
      },
    });
    await source.send("s1", `fix the thing shown in ${bundleDir}`);
    expect(note).toContain(`[scrawl: ${resolve(bundleDir)}]`);
    expect(note).toContain("[image: contact-sheet");
    expect(sentImages[0]).toEqual({ mediaType: "image/png", data: PNG });
  });
});
