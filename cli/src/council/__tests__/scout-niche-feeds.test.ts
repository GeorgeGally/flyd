import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readSources } from "../scout.js";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "flyd-scout-niche-feeds-")); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("niche feeds", () => {
  it("are seeded active beside the long list for media art, creative coding and odd hardware", () => {
    const sources = readSources(dir, new Date("2026-11-27T08:00:00Z"));
    for (const name of ["We Make Money Not Art", "Neural", "CLOT Magazine", "Processing Foundation", "Adafruit", "Evil Mad Scientist", "Right Click Save", "Hackaday", "Ars Technica"]) {
      expect(sources.find((source) => source.name === name), name).toMatchObject({ kind: "rss", status: "active" });
    }
  });
});
