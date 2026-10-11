import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseTaste } from "../../council/taste.js";
import { composeMemory, conversationProject, MemoryReader, parseCapture, parseMemoryFile, type Capture, type MemoryInputs } from "../memory.js";
import type { ConversationMessage } from "../types.js";

const PROJECTS = [
  { id: "gnm-good-neighbours-market", name: "GNM (Good Neighbours Market)", repos: ["/Users/me/Documents/good_neighbours"] },
  { id: "flyd", name: "Flyd", repos: ["/Users/me/Documents/flyd"] },
];

const TASTE = `# What Flyd knows about George's taste

## Everywhere

- Animate text TV-style: a clean fade in place. <!--taste:aaaa0001 n=4 first=2026-10-10 last=2026-10-10 skill=interface-->
  - "should be TV style fade in. no pop." — Claude Code, 2026-10-10
- Loading spinners must be strong enough to read. <!--taste:aaaa0002 n=1 first=2026-10-11 last=2026-10-11 skill=interface-->
  - "loading spinner is too light" — Claude Code, 2026-10-11
- Keep logs signal-only. <!--taste:aaaa0003 n=13 first=2026-10-10 last=2026-10-10 skill=none-->
  - "skip routine tool calls" — Claude Code, 2026-10-10

## GNM (Good Neighbours Market) <!--project:gnm-good-neighbours-market-->

- Every screen sits on one left edge. <!--taste:bbbb0001 n=2 seen=gnm-good-neighbours-market first=2026-10-11 last=2026-10-11 skill=spacing-->
  - "line everything up on the left" — Claude Code, GNM (Good Neighbours Market), 2026-10-11

## Not me

- Use pastel gradients. <!--taste:cccc0001 n=1-->
`;

const MEMORY = `# Flyd memory

<!-- Curated by Flyd's Librarian. -->

## Lately
- 11 Oct: GNM shipping day — hero and tickets. <!--p:2026-10-11-->

## Commitments
- George wants Bloom finished and hosted. <!--p:2026-09-29-->
`;

const user = (id: string, text: string, timestamp: string): ConversationMessage => ({ id, role: "user", text, timestamp });

function inputs(overrides: Partial<MemoryInputs> = {}): MemoryInputs {
  return { taste: parseTaste(TASTE), captures: [], entries: parseMemoryFile(MEMORY), ...overrides };
}

describe("conversationProject", () => {
  it("picks the project the newest message names, by name, short name or repo folder", () => {
    expect(conversationProject([user("a", "flyd column", "2026-10-11T10:00:00Z"), user("b", "now the GNM hero", "2026-10-11T10:01:00Z")], PROJECTS)?.name).toBe("GNM (Good Neighbours Market)");
    expect(conversationProject([user("a", "fix good_neighbours/index.html", "2026-10-11T10:00:00Z")], PROJECTS)?.id).toBe("gnm-good-neighbours-market");
    expect(conversationProject([user("a", "hello", "2026-10-11T10:00:00Z")], PROJECTS)).toBeUndefined();
  });
});

describe("composeMemory", () => {
  const capture = (file: string, at: string, text: string, projectPath = "/Users/me/Documents/good_neighbours"): Capture => ({ file, at, text, projectPath, project: projectPath.split("/").pop()! });

  it("remembers this project's taste and captures first, then his strongest everywhere taste, never a vetoed or once-seen rule", () => {
    const memory = composeMemory(
      inputs({ captures: [capture("2026-10-09-08-00-00.md", "2026-10-09T08:00:00.000Z", "Tickets are Rp65k."), capture("2026-10-01-08-00-00.md", "2026-10-01T08:00:00.000Z", "Flyd note", "/Users/me/Documents/flyd")] }),
      [user("q", "tidy the GNM tickets page", "2026-10-11T10:00:00Z")],
      PROJECTS,
    );
    expect(memory.project).toBe("GNM");
    expect(memory.remembers.map((item) => item.title)).toEqual([
      "Every screen sits on one left edge.",
      "Tickets are Rp65k.",
      "11 Oct: GNM shipping day — hero and tickets.",
      "Keep logs signal-only.",
      "Animate text TV-style: a clean fade in place.",
    ]);
    expect(memory.remembers[0]).toMatchObject({ kind: "taste", line: "Taste · GNM · seen 2 times" });
    expect(memory.remembers[0]!.detail).toContain("“line everything up on the left” — 2026-10-11");
    expect(memory.remembers[1]).toMatchObject({ kind: "capture", line: "Capture · GNM" });
    expect(memory.remembering).toEqual([]);
  });

  it("remembers now: a rule learned from his words here, with when he said them, and a capture made since the conversation began", () => {
    const memory = composeMemory(
      inputs({ captures: [capture("2026-10-11-10-05-00.md", "2026-10-11T10:05:00.000Z", "Gallery opens at ten."), capture("2026-10-10-08-00-00.md", "2026-10-10T08:00:00.000Z", "Before we spoke.")] }),
      [user("a", "GNM hero next", "2026-10-11T10:00:00Z"), user("b", "the  loading spinner is too light", "2026-10-11T10:02:00Z")],
      PROJECTS,
    );
    expect(memory.remembering[0]!.line).toBe("Capture · GNM");
    expect(memory.remembering.map((item) => [item.title, item.at])).toEqual([
      ["Gallery opens at ten.", "2026-10-11T10:05:00.000Z"],
      ["Loading spinners must be strong enough to read.", "2026-10-11T10:02:00Z"],
    ]);
    expect(memory.remembers.some((item) => item.id === "taste:aaaa0002")).toBe(false);
  });

  it("remembers now what the reader saw change while it watched, at the time it noticed", () => {
    const memory = composeMemory(
      inputs({ noticed: { "taste:aaaa0003": "2026-10-11T10:09:00.000Z", "memory:george-wants-bloom-finished-and-hosted": "2026-10-11T10:07:00.000Z" } }),
      [user("a", "hello", "2026-10-11T10:00:00Z")],
      PROJECTS,
    );
    expect(memory.remembering.map((item) => [item.kind, item.at])).toEqual([["taste", "2026-10-11T10:09:00.000Z"], ["memory", "2026-10-11T10:07:00.000Z"]]);
    expect(memory.remembering[1]!.line).toBe("Memory · Commitments");
    expect(memory.remembers.map((item) => item.id)).not.toContain("taste:aaaa0003");
  });
});

describe("parseCapture and parseMemoryFile", () => {
  it("reads a capture's project, folder and local time", () => {
    const capture = parseCapture("x.md", "---\nsource: cli\nproject: GeorgeGally/flyd\nproject_path: /Users/me/Documents/flyd\ntimestamp: 2026-10-10 17:37:34\n---\n\nRemember the handover.\n");
    expect(capture).toMatchObject({ source: "cli", project: "GeorgeGally/flyd", projectPath: "/Users/me/Documents/flyd", text: "Remember the handover." });
    expect(capture!.at).toBe(new Date("2026-10-10T17:37:34").toISOString());
    const elsewhere = composeMemory(inputs({ captures: [{ file: "z.md", text: "Handover notes.", project: "someone/tooling", projectPath: "/Users/me/Documents/tooling", at: "2026-10-11T10:05:00.000Z" }] }), [user("a", "hi", "2026-10-11T10:00:00Z")], PROJECTS);
    expect(elsewhere.remembering[0]!.line).toBe("Capture");
    expect(parseCapture("y.md", "no frontmatter")).toBeNull();
  });

  it("reads MEMORY.md lines by section, markers gone", () => {
    expect(parseMemoryFile(MEMORY)).toEqual([
      { section: "Lately", text: "11 Oct: GNM shipping day — hero and tickets.", date: "2026-10-11" },
      { section: "Commitments", text: "George wants Bloom finished and hosted.", date: "2026-09-29" },
    ]);
  });
});

describe("MemoryReader", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "flyd-rail-memory-"));
    mkdirSync(join(dir, "raw"));
    writeFileSync(join(dir, "TASTE.md"), TASTE);
    writeFileSync(join(dir, "MEMORY.md"), MEMORY);
    writeFileSync(join(dir, "raw", "2026-10-11-10-05-00.md"), "---\nsource: cli\nproject_path: /Users/me/Documents/good_neighbours\ntimestamp: 2026-10-11 10:05:00\n---\nGallery opens at ten.\n");
    writeFileSync(join(dir, "raw", "2026-10-11-10-06-00.md"), "---\nsource: auto\ntimestamp: 2026-10-11 10:06:00\n---\nAn agent observation.\n");
    writeFileSync(join(dir, "raw", "runtime-event-1.md"), "---\nsource: flyd-runtime\n---\nA task.\n");
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("reads his own captures only, and notices a rule seen again and a new memory line after the first read", () => {
    let now = Date.parse("2026-10-11T10:10:00Z");
    const reader = new MemoryReader({ dir, now: () => now });
    const first = reader.current();
    expect(first.captures.map((capture) => capture.text)).toEqual(["Gallery opens at ten."]);
    expect(first.noticed).toEqual({});
    expect(reader.refresh()).toBe(false);

    now = Date.parse("2026-10-11T10:20:00Z");
    writeFileSync(join(dir, "TASTE.md"), TASTE.replace("aaaa0003 n=13", "aaaa0003 n=14"));
    writeFileSync(join(dir, "MEMORY.md"), `${MEMORY}- George wants the column to show memory. <!--p:2026-10-11-->\n`);
    // mtimes can tie within a test; force a change of stamp.
    (reader as unknown as { stamp: string }).stamp = "";
    expect(reader.refresh()).toBe(true);
    expect(reader.current().noticed).toEqual({
      "taste:aaaa0003": "2026-10-11T10:20:00.000Z",
      "memory:george-wants-the-column-to-show-memory": "2026-10-11T10:20:00.000Z",
    });
  });

  it("reads nothing, without failing, when Flyd has no memory yet", () => {
    const reader = new MemoryReader({ dir: join(dir, "missing") });
    expect(reader.current()).toMatchObject({ captures: [], entries: [], taste: { rules: [] } });
  });
});
