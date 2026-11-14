import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ArtefactFeed, underwayItems } from "../artefact.js";
import { ClaudeCodeTranscriptSource } from "../claude-code-source.js";
import { BoardNames, boardKeyOf, boardTitle, boardUrls, LieselLauncher, lieselCommand, openBoardHref, ProjectBoards, viaOpener, type BoardAnswer } from "../liesel.js";
import { ConversationViewServer } from "../server.js";

/** A Liesel that answers each probe from a script: "down" until it is started, then what `after` says. */
function fakeLiesel(before: BoardAnswer, after: BoardAnswer[] = []) {
  let started = 0;
  const probes: string[] = [];
  const launcher = new LieselLauncher({
    probe: async (key) => {
      probes.push(key);
      if (!started) return before;
      return after.length > 1 ? after.shift()! : after[0] ?? "down";
    },
    start: () => { started += 1; },
    waitMs: 200,
    pollMs: 1,
    sleep: async () => undefined,
  });
  return { launcher, probes, started: () => started };
}

describe("board links", () => {
  it("knows a board on loopback and on the tailnet origin, and nothing else", () => {
    expect(boardKeyOf("http://127.0.0.1:4747/board/e4dc64c8844fac7a")).toBe("e4dc64c8844fac7a");
    expect(boardKeyOf("http://macbook-pro-3.tail46029c.ts.net:4747/board/3aec36de7b63f88b")).toBe("3aec36de7b63f88b");
    expect(boardKeyOf("http://localhost:4747/board/e4dc64c8844fac7a:")).toBe("e4dc64c8844fac7a");
    expect(boardKeyOf("http://127.0.0.1:4387/session/abc123def")).toBeUndefined();
    expect(boardKeyOf("https://github.com/x/y/pull/1")).toBeUndefined();
  });

  it("sends a board button through Flyd's opener and leaves other links alone", () => {
    expect(viaOpener({ label: "Open", url: "http://127.0.0.1:4747/board/e4dc64c8844fac7a" })).toEqual({ label: "Open board", url: "/open-board/e4dc64c8844fac7a" });
    expect(viaOpener({ label: "Open PR", url: "https://github.com/x/y/pull/1" })).toEqual({ label: "Open PR", url: "https://github.com/x/y/pull/1" });
    expect(openBoardHref("abc123")).toBe("/open-board/abc123");
    expect(boardUrls("abc123", "http://m.ts.net:4747")).toEqual({ local: "http://127.0.0.1:4747/board/abc123", public: "http://m.ts.net:4747/board/abc123" });
  });

  it("starts Liesel with George's own command, logging to ~/.easel/server.log", () => {
    const { cwd, args, log } = lieselCommand({ FLYD_LIESEL_DIR: "/x/easel" });
    expect(cwd).toBe("/x/easel");
    expect(args).toEqual(["/x/easel/bin/liesel-server.js", "server", "--port", "4747", "--also-listen", "100.78.155.0"]);
    expect(log).toMatch(/\.easel\/server\.log$/);
  });
});

describe("opening a board", () => {
  it("opens at once when Liesel is up, and never starts a second one", async () => {
    const liesel = fakeLiesel("ready");
    expect(await liesel.launcher.open("e4dc64c8844fac7a")).toEqual({ state: "ready", started: false });
    expect(liesel.started()).toBe(0);
  });

  it("starts Liesel when it is down and waits until it serves the board", async () => {
    const liesel = fakeLiesel("down", ["down", "down", "ready"]);
    expect(await liesel.launcher.open("e4dc64c8844fac7a")).toEqual({ state: "ready", started: true });
    expect(liesel.started()).toBe(1);
  });

  it("starts Liesel once for every page waiting on it", async () => {
    const liesel = fakeLiesel("down", ["ready"]);
    const opened = await Promise.all([liesel.launcher.open("e4dc64c8844fac7a"), liesel.launcher.open("e4dc64c8844fac7a")]);
    expect(opened.map((outcome) => outcome.state)).toEqual(["ready", "ready"]);
    expect(liesel.started()).toBe(1);
  });

  it("says plainly when a board no longer exists, up or after a start", async () => {
    expect(await fakeLiesel("missing").launcher.open("e4dc64c8844fac7a")).toEqual({ state: "missing" });
    const started = fakeLiesel("down", ["missing"]);
    expect(await started.launcher.open("e4dc64c8844fac7a")).toEqual({ state: "missing" });
    expect(started.started()).toBe(1);
    expect(await fakeLiesel("ready").launcher.open("../etc")).toEqual({ state: "missing" });
  });

  it("gives up when Liesel never answers or cannot start", async () => {
    const silent = new LieselLauncher({ probe: async () => "down", start: () => undefined, waitMs: 5, pollMs: 1, sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)) });
    expect((await silent.open("e4dc64c8844fac7a")).state).toBe("failed");
    const broken = new LieselLauncher({ probe: async () => "down", start: () => { throw new Error("Liesel is not at /nowhere"); } });
    expect(await broken.open("e4dc64c8844fac7a")).toEqual({ state: "failed", reason: "Liesel is not at /nowhere" });
  });
});

describe("a project's own board", () => {
  const stateWith = (sessions: Record<string, unknown>) => {
    const dir = mkdtempSync(join(tmpdir(), "liesel-state-"));
    writeFileSync(join(dir, "state.json"), JSON.stringify({ sessions }));
    return join(dir, "state.json");
  };

  it("reads each board's own name from its board file, and none for a board it cannot read", () => {
    const dir = mkdtempSync(join(tmpdir(), "liesel-names-"));
    writeFileSync(join(dir, "start.json"), JSON.stringify({ format: 1, name: "DIR start control" }));
    writeFileSync(join(dir, "blank.json"), JSON.stringify({ format: 1 }));
    const names = new BoardNames(stateWith({
      "2f91aa58f2222856": { key: "2f91aa58f2222856", file: join(dir, "start.json"), status: "open" },
      e9a23aab1684b277: { key: "e9a23aab1684b277", file: join(dir, "blank.json"), status: "open" },
      "97933d40aea87c36": { key: "97933d40aea87c36", file: join(dir, "gone.json"), status: "open" },
    }));
    expect(names.nameOf("2f91aa58f2222856")).toBe("DIR start control");
    expect(names.nameOf("e9a23aab1684b277")).toBeUndefined();
    expect(names.nameOf("97933d40aea87c36")).toBeUndefined();
    expect(names.nameOf("unknown0")).toBeUndefined();
    expect(boardTitle("DIR start control")).toBe("DIR start control board");
    expect(boardTitle("Hero board")).toBe("Hero board");
  });

  it("finds the board a project keeps in .liesel, never an ended one", () => {
    const boards = new ProjectBoards(stateWith({
      "4a40bbcfafd89a95": { key: "4a40bbcfafd89a95", file: "/Users/g/Documents/cap5/.liesel/board.json", status: "open" },
      c4b290539864acf3: { key: "c4b290539864acf3", file: "/Users/g/Documents/atomise/.liesel/board.json", status: "ended" },
      e166d8804520c2d7: { key: "e166d8804520c2d7", file: "/Users/g/firstmate/data/atomise-board/board.json", status: "open" },
    }));
    expect(boards.keyFor("cap5")).toBe("4a40bbcfafd89a95");
    expect(boards.keyFor("GeorgeGally/cap5")).toBe("4a40bbcfafd89a95");
    expect(boards.keyFor("atomise")).toBeUndefined();
    expect(boards.keyFor(undefined)).toBeUndefined();
    expect(new ProjectBoards("/nowhere/state.json").keyFor("cap5")).toBeUndefined();
  });

  it("links a project card to its board through the opener, keeping its Lavish review", async () => {
    const home = mkdtempSync(join(tmpdir(), "artefact-project-board-"));
    mkdirSync(join(home, "bin"));
    mkdirSync(join(home, "state"));
    const row = { id: "cap5-hero", state: "working", name: "Cap5 hero", doing: "harness busy", repo: "cap5" };
    const snapshot = { in_flight: [row, { ...row, id: "other", name: "Other", repo: "flyd" }], recorded_prs: [{ id: "cap5-hero", url: "http://127.0.0.1:4387/session/abcdef123" }] };
    writeFileSync(join(home, "bin", "fm-bearings-snapshot.sh"), `#!/bin/sh\necho '${JSON.stringify(snapshot)}'\n`, { mode: 0o755 });
    const projectBoards = new ProjectBoards(stateWith({ "4a40bbcfafd89a95": { file: "/Users/g/Documents/cap5/.liesel/board.json", status: "open" } }));
    const feed = new ArtefactFeed({ home, memoryFile: join(home, "none"), newsFile: join(home, "none"), tasteFile: join(home, "none"), projectBoards });
    await feed.refresh();
    const items = underwayItems(feed.current().fleet!);
    const cap5 = items.find((item) => item.task === "cap5-hero")!;
    expect(cap5.links).toEqual([
      { label: "Open design review", url: "http://127.0.0.1:4387/session/abcdef123" },
      { label: "Open board", url: "/open-board/4a40bbcfafd89a95" },
    ]);
    const other = items.find((item) => item.task === "other")!;
    expect(JSON.stringify(other.links ?? [])).not.toContain("open-board");
  });
});

describe("the open-board page", () => {
  let server: ConversationViewServer | undefined;
  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  async function serve(launcher: LieselLauncher): Promise<{ port: number; token: string }> {
    const dir = mkdtempSync(join(tmpdir(), "flyd-open-board-"));
    writeFileSync(join(dir, "s1.jsonl"), "");
    server = new ConversationViewServer(new ClaudeCodeTranscriptSource({ projectDir: dir }));
    server.lieselBoards = launcher;
    const port = await server.listen(0);
    const token = ((await (await fetch(`http://127.0.0.1:${port}/api/token`)).json()) as { token: string }).token;
    return { port, token };
  }

  it("shows the loader for a board, and nothing for a bad key", async () => {
    const { port } = await serve(fakeLiesel("ready").launcher);
    const page = await fetch(`http://127.0.0.1:${port}/open-board/e4dc64c8844fac7a`);
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain("One moment, opening the board");
    expect(html).toContain('"key":"e4dc64c8844fac7a"');
    expect(html).not.toContain(":4387");
    expect((await fetch(`http://127.0.0.1:${port}/open-board/..%2Fetc`)).status).toBe(404);
  });

  it("answers with the board once Liesel serves it, starting Liesel when it is down", async () => {
    const liesel = fakeLiesel("down", ["ready"]);
    const { port, token } = await serve(liesel.launcher);
    expect((await fetch(`http://127.0.0.1:${port}/api/open-board?board=e4dc64c8844fac7a`)).status).toBe(403);
    const answer = await (await fetch(`http://127.0.0.1:${port}/api/open-board?board=e4dc64c8844fac7a&token=${token}`)).json();
    expect(answer).toMatchObject({ state: "ready", started: true, local: "http://127.0.0.1:4747/board/e4dc64c8844fac7a" });
    expect(liesel.started()).toBe(1);
  });

  it("says when the board is gone", async () => {
    const { port, token } = await serve(fakeLiesel("missing").launcher);
    const answer = await (await fetch(`http://127.0.0.1:${port}/api/open-board?board=e4dc64c8844fac7a&token=${token}`)).json();
    expect(answer).toEqual({ state: "missing" });
  });
});
