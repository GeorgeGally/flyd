import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FirstmateChange } from "../../intelligence/executive/firstmate-decision.js";
import { registerViewCommand, viewFeed, type ViewOptions } from "../view.js";

// 22 Oct to 14 Nov 2026: the overtaken check and the stale-call judge were built
// only when the view was started with --session. Flyd.app starts it with
// `view --no-open --port <n>`, so in the shipped app no staleness check of any
// kind ran, and their own tests never noticed: they handed the checker to the
// feed directly. This test starts from the app's own launch arguments.

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");

/** The arguments Flyd.app passes the CLI, read from its own source (ConversationServer.arguments). */
function appArguments(port: number): string[] {
  const swift = readFileSync(join(REPO, "mac-adapter", "Sources", "Conversation", "ConversationServer.swift"), "utf8");
  const body = /static func arguments\(port: Int\) -> \[String\] \{\s*\[([^\]]*)\]/.exec(swift)?.[1];
  if (!body) throw new Error("ConversationServer.arguments not found");
  const argv = [...body.matchAll(/"([^"]*)"|String\(port\)/g)].map((match) => match[1] ?? String(port));
  return argv.slice(argv.indexOf("src/entry.ts") + 1);
}

async function parsedAsTheAppStartsIt(): Promise<ViewOptions> {
  const argv = appArguments(4818);
  expect(argv[0]).toBe("view");
  const program = new Command().exitOverride();
  let parsed: ViewOptions | undefined;
  registerViewCommand(program, async (options) => { parsed = options; });
  await program.parseAsync(argv, { from: "user" });
  return parsed!;
}

const hold = (text: string) => `fm-hold-v1:${Buffer.from(text).toString("base64")}`;

let saved: Record<string, string | undefined>;
beforeEach(() => {
  saved = { FLYD_COMMAND_DIR: process.env.FLYD_COMMAND_DIR, FLYD_CLOSE_OVERTAKEN: process.env.FLYD_CLOSE_OVERTAKEN, FLYD_STALE_CALLS: process.env.FLYD_STALE_CALLS };
  // Flyd's own runs are settled on every read: never George's real ones.
  process.env.FLYD_COMMAND_DIR = mkdtempSync(join(tmpdir(), "view-wiring-command-"));
  delete process.env.FLYD_CLOSE_OVERTAKEN;
  // No model is asked here: the stale judge is wired, but these calls are settled by the record first.
  process.env.FLYD_STALE_CALLS = "0";
});
afterEach(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("the view as Flyd.app starts it", () => {
  it("is started with no --session", async () => {
    expect(await parsedAsTheAppStartsIt()).toEqual({ open: false, port: 4818 });
  });

  it("builds every staleness check, whatever flags it was started with", async () => {
    await parsedAsTheAppStartsIt();
    const inbox = { available: () => true, home: mkdtempSync(join(tmpdir(), "view-wiring-home-")), sendOwn: async () => ({ replayed: false }) };
    expect(viewFeed(inbox, { decideChanges: async () => [] }).wiring()).toEqual({ overtaken: true, holds: true, settleRuns: true, retired: true, executive: true });
    process.env.FLYD_CLOSE_OVERTAKEN = "0";
    expect(viewFeed(inbox, { decideChanges: async () => [] }).wiring()).toMatchObject({ overtaken: false, holds: true, settleRuns: true });
    // With no firstmate, nothing asks it anything, and retired cards are still kept off.
    expect(viewFeed({ ...inbox, available: () => false }, { decideChanges: async () => [] }).wiring()).toEqual({ overtaken: false, holds: false, settleRuns: false, retired: true, executive: true });
  });

  it("settles an overtaken call and a closed hold before Core decides, and names the open call by its hold's lifecycle", async () => {
    await parsedAsTheAppStartsIt();
    const home = mkdtempSync(join(tmpdir(), "view-wiring-feed-"));
    mkdirSync(join(home, "bin"));
    mkdirSync(join(home, "data"));
    const snapshot = join(home, "bearings.json");
    writeFileSync(join(home, "bin", "fm-bearings-snapshot.sh"), `#!/bin/sh\ncat '${snapshot}'\n`, { mode: 0o755 });
    // Firstmate's open predicate: the closed hold exits 1, the open one prints its lifecycle.
    writeFileSync(join(home, "bin", "fm-captain-hold.sh"), [
      "#!/bin/sh",
      'case "$2" in',
      "  closed-hold) exit 1 ;;",
      "  open-hold) echo '2026-11-14T08:00:00Z#0'; exit 0 ;;",
      "  *) exit 3 ;;",
      "esac",
    ].join("\n"), { mode: 0o755 });
    writeFileSync(snapshot, JSON.stringify({ decisions_open: [
      { id: "finished-call", summary: "Pick a layout for the sell step" },
      { id: "closed-hold", summary: "Which tracklist to build" },
      { id: "open-hold", summary: "Pick the hero photo" },
    ] }));
    const today = new Date().toISOString().slice(0, 10);
    writeFileSync(join(home, "data", "backlog.md"), [
      `- [x] finished-call - Pick a layout for the sell step (repo: gnm) (merged: ${today})`,
      `- [ ] closed-hold - Which tracklist to build (repo: dir) (since ${today}) (hold: ${hold("Which tracklist should be built: 1 Set A, 2 Set B")}) (hold-kind: captain)`,
      `- [ ] open-hold - Pick the hero photo (repo: cap5) (since ${today}) (hold: ${hold("George picks the hero photo: 1 Boardroom, 2 Skyline")}) (hold-kind: captain)`,
      "",
    ].join("\n"));
    const sent: string[] = [];
    const decided: FirstmateChange[][] = [];
    const inbox = { available: () => true, home, sendOwn: async (note: string) => { sent.push(note); return { replayed: false }; } };
    const feed = viewFeed(inbox, { decideChanges: async (changes) => { decided.push(changes.filter((change) => change.kind === "decision")); return []; } });
    await feed.refresh();
    expect(feed.current().fleet!.calls.map((row) => [row.task, row.holdIdentity])).toEqual([["open-hold", "2026-11-14T08:00:00Z#0"]]);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatch(/finished-call/);
    expect(decided.flat().map((change) => [change.taskId, change.questionIdentity])).toEqual([["open-hold", "hold:open-hold#2026-11-14T08:00:00Z#0"]]);
  });
});
