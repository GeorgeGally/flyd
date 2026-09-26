import { mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { chunkPieces, collectGeorgeText, draftProfileFromMemory, parseFacts } from "../profile-bootstrap.js";

describe("profile bootstrap", () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "flyd-bootstrap-")); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const write = (name: string, body: string, ageSeconds: number) => {
    writeFileSync(join(dir, name), `---\nsource: cli\n---\n\n${body}\n`);
    const time = Date.now() / 1000 - ageSeconds;
    utimesSync(join(dir, name), time, time);
  };

  it("collects George's words newest first, skipping runtime events and assistant lines", () => {
    write("2026-05-01-old.md", "I moved to Bali last year and love surfing in Canggu.", 1000);
    write("2026-09-01-new.md", "My partner Maya and I are planning a trip to Lisbon.", 10);
    write("runtime-event-x.md", "worker finished assignment 42 successfully", 5);
    write("conversation-1.md", "## George said\n\n- 2026-09-24T10:00:00.000Z: remind me my brother Leo's birthday is 3 March\n\n## Flyd said\n\nSure thing.", 20);
    const pieces = collectGeorgeText(dir);
    expect(pieces.map((piece) => piece.split("]")[0])).toEqual(["[2026-09-01-new", "[conversation-1", "[2026-05-01-old"]);
    expect(pieces[1]).toContain("- remind me my brother Leo's birthday is 3 March");
    expect(pieces.join("\n")).not.toContain("Sure thing");
    expect(pieces.join("\n")).not.toContain("worker finished");
  });

  it("chunks without splitting a note", () => {
    expect(chunkPieces(["a".repeat(30), "b".repeat(30), "c".repeat(30)], 70).length).toBe(2);
  });

  it("keeps only well-formed facts in known sections", () => {
    expect(parseFacts('{"facts":[{"section":"people","fact":"Partner is Maya."},{"section":"Hobbies","fact":"x"},{"section":"Work","fact":""}]}'))
      .toEqual([{ section: "People", fact: "Partner is Maya." }]);
    expect(parseFacts("not json")).toEqual([]);
  });

  it("extracts per chunk, then consolidates", async () => {
    write("a.md", "My partner is Maya. ".repeat(20), 10);
    write("b.md", "I live in Canggu, Bali. ".repeat(20), 20);
    const prompts: string[] = [];
    const result = await draftProfileFromMemory({
      rawDir: dir,
      chunkChars: 300,
      complete: async (prompt) => {
        prompts.push(prompt);
        if (prompt.startsWith("These facts")) return '{"facts":[{"section":"People","fact":"Partner is Maya."},{"section":"About me","fact":"Lives in Canggu, Bali."}]}';
        return prompt.includes("Maya")
          ? '{"facts":[{"section":"People","fact":"Partner is Maya."}]}'
          : '{"facts":[{"section":"About me","fact":"Lives in Canggu, Bali."}]}';
      },
    });
    expect(prompts).toHaveLength(3);
    expect(result).toEqual({
      sources: 2,
      facts: [{ section: "People", fact: "Partner is Maya." }, { section: "About me", fact: "Lives in Canggu, Bali." }],
    });
  });
});
