import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EMPTY_ARTEFACT, type ArtefactInputs } from "../artefact.js";
import { imageSize, projectFirstmateWork, readWorkMedia, workCanvasEnabled } from "../work-canvas.js";

/** Deterministic, tiny PNG fixture; the projection does not decode pixels. */
function png(width = 640, height = 480): Buffer {
  const bytes = Buffer.alloc(33);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes);
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
}

function fleet(task = "t-1", shots = ["screen.png"]): ArtefactInputs {
  return {
    ...EMPTY_ARTEFACT,
    fleet: {
      calls: [], ready: [], landed: [], held: [], next: [],
      live: [{ task, label: "Landing page design", repo: "example/site", shots, at: "2026-11-21T12:00:00Z" }],
    },
  };
}

describe("Flyd First Mate work canvas", () => {
  it("requires opt-in and preserves a strictly read-only Rounds index", () => {
    expect(workCanvasEnabled({})).toBe(false);
    expect(workCanvasEnabled({ FLYD_WORK_CANVAS: "true" })).toBe(false);
    expect(workCanvasEnabled({ FLYD_WORK_CANVAS: "1" })).toBe(true);

    const root = mkdtempSync(join(tmpdir(), "flyd-work-canvas-"));
    try {
      mkdirSync(join(root, "data", "t-1"), { recursive: true });
      writeFileSync(join(root, "data", "t-1", "screen.png"), png());
      const shotPath = (task: string, file: string) => join(root, "data", task, file);
      const { index, media } = projectFirstmateWork(fleet(), shotPath, root);
      expect(index.complete).toBe(false);
      expect(index.pages).toEqual([]);
      expect(index.changed).toEqual([]);
      expect(index.comments).toEqual([]);
      expect(index.threads).toHaveLength(1);
      expect(index.threads[0]?.id).toContain("t-1");
      expect(index.projects["example/site"]).toBe("site");
      expect(index.sets).toHaveLength(1);
      expect(index.sets[0]?.shots[0]).toMatchObject({ w: 640, h: 480, name: "screen.png" });
      const hash = index.sets[0]!.shots[0]!.hash;
      expect(media.get(hash)?.mime).toBe("image/png");
      expect(readWorkMedia(media.get(hash)!, root)).toEqual(png());
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it("never exposes a removed or overwritten image under an old immutable ID", () => {
    const root = mkdtempSync(join(tmpdir(), "flyd-work-canvas-"));
    try {
      mkdirSync(join(root, "data", "t-1"), { recursive: true });
      const file = join(root, "data", "t-1", "screen.png");
      writeFileSync(file, png());
      const { media } = projectFirstmateWork(fleet(), () => file, root);
      const entry = [...media.values()][0]!;
      expect(readWorkMedia(entry, root)).not.toBeNull();
      writeFileSync(file, png(320, 240)); // same byte length, different content
      expect(readWorkMedia(entry, root)).toBeNull();
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it("rejects symlink escapes, absent task ownership and malformed files", () => {
    const root = mkdtempSync(join(tmpdir(), "flyd-work-canvas-"));
    const outside = mkdtempSync(join(tmpdir(), "flyd-work-outside-"));
    try {
      mkdirSync(join(root, "data", "t-1"), { recursive: true });
      writeFileSync(join(outside, "other.png"), png());
      symlinkSync(join(outside, "other.png"), join(root, "data", "t-1", "screen.png"));
      const noEscape = projectFirstmateWork(fleet(), () => join(root, "data", "t-1", "screen.png"), root);
      expect(noEscape.index.sets).toEqual([]);
      expect(noEscape.media.size).toBe(0);
      expect(projectFirstmateWork(fleet("../t-1"), () => join(outside, "other.png"), root).index.sets).toEqual([]);
      expect(imageSize(Buffer.from("not a png"), ".png")).toBeNull();
      expect(readFileSync(join(outside, "other.png"))).toHaveLength(33);
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });
});
