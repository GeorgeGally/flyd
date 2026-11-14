import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BoardWatcher, putLabOnBoard, readBoardFeedback, type BoardFeedback, type PollAnswer } from "../design-board.js";

// Every lab lands on a Liesel board George reviews from; what he sends there comes back to the lab.

let lab: string;

beforeEach(() => {
  lab = mkdtempSync(join(tmpdir(), "flyd-design-board-"));
  for (const n of [1, 2, 3]) writeFileSync(join(lab, `v${n}.html`), `<!doctype html><html><body>V${n}<img src="img/1-hero.png"></body></html>`);
  mkdirSync(join(lab, "img"));
  writeFileSync(join(lab, "img", "1-hero.png"), "png");
});

afterEach(() => rmSync(lab, { recursive: true, force: true }));

const versions = [{ n: 1, name: "Title card" }, { n: 2, name: "Wall label" }, { n: 3, name: "Departure board" }];

describe("the lab's board", () => {
  it("puts each version on the board as its own labelled frame, with its pictures, and posts the Creative Director's words", async () => {
    const calls: string[][] = [];
    const cli = async (args: string[]) => {
      calls.push(args);
      if (args[0] === "board" && args[1] === "add") {
        const board = existsSync(join(args[2]!, "board.json")) ? JSON.parse(readFileSync(join(args[2]!, "board.json"), "utf8")) as { items: Array<{ file: string }> } : { items: [] };
        board.items.push({ file: args[3]!.split("/").pop()! });
        writeFileSync(join(args[2]!, "board.json"), JSON.stringify(board));
      }
      return args[1] === "open" ? "board:\n  url: http://127.0.0.1:4747/board/a1b2c3d4e5f6\n  status: opened" : "";
    };
    const board = await putLabOnBoard({ labDir: lab, name: "Right column lab", versions, note: "V2 is the one." }, cli, async () => undefined);
    expect(board).toEqual({ url: "http://127.0.0.1:4747/board/a1b2c3d4e5f6", key: "a1b2c3d4e5f6", dir: join(lab, "board") });
    expect(calls.filter((args) => args[1] === "add").map((args) => args[args.indexOf("--label") + 1])).toEqual(["V1 · Title card", "V2 · Wall label", "V3 · Departure board"]);
    expect(calls.find((args) => args[1] === "open")).toContain("--no-open");
    expect(calls.find((args) => args[0] === "reply")).toEqual(["reply", join(lab, "board"), "--agent-reply", "V2 is the one."]);
    expect(existsSync(join(lab, "board", "v2.html"))).toBe(true);
    expect(existsSync(join(lab, "board", "img", "1-hero.png"))).toBe(true);

    // Again: nothing is added twice.
    calls.length = 0;
    await putLabOnBoard({ labDir: lab, name: "Right column lab", versions }, cli, async () => undefined);
    expect(calls.filter((args) => args[1] === "add")).toEqual([]);
  });

  it("refuses to call a board made when Liesel never said where it is", async () => {
    await expect(putLabOnBoard({ labDir: lab, name: "Lab", versions }, async () => "", async () => undefined)).rejects.toThrow(/did not say where/);
  });

  it("reads a version marked final, and pinned notes with the frame and spot they are on", () => {
    expect(readBoardFeedback([
      { prompt: "make the headline smaller", prompt_id: "p1", item: { id: "v2", label: "V2 · Wall label" }, pin: { number: 3, excerpt: "Flyd" } },
      { prompt: "Build the final design into the real site: V3 · Departure board (item v3, v3.html) is chosen as final", prompt_id: "p2" },
      { prompt: "  ", prompt_id: "p3" },
    ])).toEqual({ final: 3, notes: ["V2 · Wall label on \"Flyd\": make the headline smaller"], ids: ["p1", "p2", "p3"] });
  });

  it("keeps what arrives, hands it to the lab, posts the answer on the board, and stops when he ends the board", async () => {
    const answers: PollAnswer[] = [
      { status: "feedback", prompts: [{ prompt: "warmer", prompt_id: "p1", item: { id: "v1", label: "V1 · Title card" } }] },
      { status: "feedback", prompts: [{ prompt: "Build the final design into the real site: V2 · Wall label (item v2, v2.html) is chosen as final", prompt_id: "p2" }], session_ended: true },
    ];
    const got: BoardFeedback[] = [];
    const replies: string[][] = [];
    let ended!: () => void;
    const over = new Promise<void>((resolve) => { ended = resolve; });
    const watcher = new BoardWatcher({ poll: async () => answers.shift() ?? new Promise<PollAnswer>(() => undefined), cli: async (args) => { replies.push(args); return ""; }, retryMs: 1 });
    watcher.sync([{
      runId: "lab-1", labDir: lab, board: { url: "http://127.0.0.1:4747/board/a1b2c3d4e5f6", key: "a1b2c3d4e5f6", dir: join(lab, "board") },
      onFeedback: async (feedback) => { got.push(feedback); return feedback.final ? "Building V2 now." : "Another round with your notes."; },
      onEnded: () => ended(),
    }]);
    await over;
    expect(got.map((feedback) => feedback.final ?? feedback.notes[0])).toEqual(["V1 · Title card: warmer", 2]);
    expect(replies.map((args) => args[3])).toEqual(["Another round with your notes.", "Building V2 now."]);
    expect(readFileSync(join(lab, "board-feedback.jsonl"), "utf8").trim().split("\n")).toHaveLength(2);
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(watcher.watching()).toEqual([]);
  });

  it("watches each listed board once, and lets go of one no longer listed", () => {
    const watcher = new BoardWatcher({ poll: () => new Promise<PollAnswer>(() => undefined), cli: async () => "" });
    const watch = { runId: "lab-1", labDir: lab, board: { url: "u", key: "a1b2c3d4e5f6", dir: lab }, onFeedback: async () => "" };
    watcher.sync([watch, watch]);
    expect(watcher.watching()).toEqual(["lab-1"]);
    watcher.sync([]);
    expect(watcher.watching()).toEqual([]);
    watcher.stop();
  });
});
