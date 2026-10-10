import { existsSync, mkdtempSync, readdirSync, rmSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ComposerDrafts, draftKey } from "../drafts.js";

const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
let root: string | null = null;
const fresh = () => (root = mkdtempSync(join(tmpdir(), "flyd-drafts-")));

afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
  root = null;
});

describe("ComposerDrafts", () => {
  it("gives back the words, caret and attachments from a new instance, as after a restart", () => {
    const dir = fresh();
    const drafts = new ComposerDrafts({ root: dir });
    const image = drafts.attach({ mediaType: "image/png", data: PNG })!;
    const doc = drafts.attach({ name: "brief.pdf", data: btoa("%PDF") })!;
    expect(drafts.save("latest", { text: "make the hero", selectionStart: 5, selectionEnd: 8, savedAt: 7, attachments: [image, doc] })).toBe(true);

    expect(new ComposerDrafts({ root: dir }).load("latest")).toEqual({
      text: "make the hero", selectionStart: 5, selectionEnd: 8, savedAt: 7,
      attachments: [{ ...image, data: PNG }, { ...doc, data: btoa("%PDF") }],
    });
    expect(new ComposerDrafts({ root: dir }).load("older")).toBeNull();
  });

  it("forgets the draft once the box is empty, and the attachments no draft names once they are old", () => {
    const dir = fresh();
    const drafts = new ComposerDrafts({ root: dir });
    const image = drafts.attach({ mediaType: "image/png", data: PNG })!;
    drafts.save("latest", { text: "", selectionStart: 0, selectionEnd: 0, attachments: [image] });
    drafts.save("latest", { text: "", selectionStart: 0, selectionEnd: 0, attachments: [] });
    expect(drafts.load("latest")).toBeNull();
    // Just added and not yet named by the page's next save: kept a while.
    const file = join(dir, "attachments", image.id);
    expect(existsSync(file)).toBe(true);
    const old = new Date(Date.now() - 60 * 60_000);
    utimesSync(file, old, old);
    drafts.save("latest", { text: "", selectionStart: 0, selectionEnd: 0, attachments: [] });
    expect(readdirSync(join(dir, "attachments"))).toEqual([]);
  });

  it("refuses what is not a draft or an attachment it can pass on", () => {
    const drafts = new ComposerDrafts({ root: fresh() });
    expect(drafts.save("latest", { text: 3, attachments: [] })).toBe(false);
    expect(drafts.save("latest", { text: "x", attachments: [{ id: "../../etc/passwd", name: "x" }] })).toBe(false);
    expect(drafts.attach({ mediaType: "text/html", data: PNG })).toBeNull();
    expect(drafts.attach({ name: "", data: PNG })).toBeNull();
    expect(drafts.attach({ mediaType: "image/png", data: "" })).toBeNull();
    expect(draftKey("../x")).toBe("latest");
    expect(draftKey("abc-123")).toBe("abc-123");
  });
});
