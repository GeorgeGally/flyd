import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ArtefactFeed } from "../../conversation-view/artefact.js";
import type { FirstmateChange } from "../../intelligence/executive/firstmate-decision.js";
import { readObjective } from "../../command/cos/objectives.js";
import { answerObjectiveRun, registerViewCommand, WAKE_OWNER_UNAVAILABLE, withoutCosWakes, viewFeed, type ViewOptions } from "../view.js";

// 22 Oct to 14 Nov 2026: the overtaken check and the stale-call judge were built
// only when the view was started with --session. Flyd.app starts it with
// `view --no-open --port <n>` (its documented launch contract), so in the shipped
// app no staleness check of any kind ran, and their own tests never noticed: they
// handed the checker to the feed directly. These tests start from the app's
// launch arguments, parsed by the CLI's own command, and build the feed from the
// options that parse yields.

const APP_ARGUMENTS = ["view", "--no-open", "--port", "4818"];

const hold = (text: string) => `fm-hold-v1:${Buffer.from(text).toString("base64")}`;

/** A firstmate home: one call whose task finished, one whose hold firstmate's predicate reports closed, one still open. */
function firstmateHome(): string {
  const home = mkdtempSync(join(tmpdir(), "view-wiring-feed-"));
  mkdirSync(join(home, "bin"));
  mkdirSync(join(home, "data"));
  const snapshot = join(home, "bearings.json");
  writeFileSync(join(home, "bin", "fm-bearings-snapshot.sh"), `#!/bin/sh\ncat '${snapshot}'\n`, { mode: 0o755 });
  // Firstmate's open predicate: the closed hold exits 1, the open one prints its lifecycle, anything else is absent.
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
  return home;
}

/** Parses the app's launch arguments through `flyd view`'s own command, and builds the feed from what it parsed. */
async function startedAsTheAppStartsIt(build: (options: ViewOptions) => ArtefactFeed): Promise<{ options: ViewOptions; feed: ArtefactFeed }> {
  const program = new Command().exitOverride();
  let started: { options: ViewOptions; feed: ArtefactFeed } | undefined;
  registerViewCommand(program, async (options) => { started = { options, feed: build(options) }; });
  await program.parseAsync(APP_ARGUMENTS, { from: "user" });
  return started!;
}

let saved: Record<string, string | undefined>;
beforeEach(() => {
  saved = { FLYD_COMMAND_DIR: process.env.FLYD_COMMAND_DIR, FLYD_CLOSE_OVERTAKEN: process.env.FLYD_CLOSE_OVERTAKEN, FLYD_STALE_CALLS: process.env.FLYD_STALE_CALLS };
  // Flyd's own runs are settled on every read: never George's real ones.
  process.env.FLYD_COMMAND_DIR = mkdtempSync(join(tmpdir(), "view-wiring-command-"));
  delete process.env.FLYD_CLOSE_OVERTAKEN;
  // No model is asked here: these calls are settled by the record first.
  process.env.FLYD_STALE_CALLS = "0";
});
afterEach(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("the view as Flyd.app starts it (no --session)", () => {
  it("settles an overtaken call and a closed hold before Core decides, and names the open call by its hold's lifecycle", async () => {
    const home = firstmateHome();
    const sent: string[] = [];
    const decided: FirstmateChange[][] = [];
    const inbox = { available: () => true, home, sendOwn: async (note: string) => { sent.push(note); return { replayed: false }; } };
    const { options, feed } = await startedAsTheAppStartsIt((parsed) => viewFeed(parsed, inbox, {
      decideChanges: async (changes) => { decided.push(changes.filter((change) => change.kind === "decision")); return []; },
    }));
    expect(options.session).toBeUndefined();
    await feed.refresh();
    expect(feed.current().fleet!.calls.map((row) => [row.task, row.holdIdentity])).toEqual([["open-hold", "2026-11-14T08:00:00Z#0"]]);
    // The overtaken check ran: the staff were told to close the call whose task finished.
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatch(/finished-call/);
    expect(decided.flat().map((change) => [change.taskId, change.questionIdentity])).toEqual([["open-hold", "hold:open-hold#2026-11-14T08:00:00Z#0"]]);
  });

  it("still asks firstmate's predicate with the overtaken note switched off", async () => {
    process.env.FLYD_CLOSE_OVERTAKEN = "0";
    const sent: string[] = [];
    const inbox = { available: () => true, home: firstmateHome(), sendOwn: async (note: string) => { sent.push(note); return { replayed: false }; } };
    const { feed } = await startedAsTheAppStartsIt((parsed) => viewFeed(parsed, inbox, {}));
    await feed.refresh();
    expect(feed.current().fleet!.calls.map((row) => row.task)).not.toContain("closed-hold");
    expect(sent).toEqual([]);
  });
});


it("keeps only wake reports about objective-owned work backstage, and says so when ownership cannot be read", () => {
  const messages = [
    { id: "a", role: "assistant" as const, text: "Captain, gnm-footer landed: PR #12 merged.", wake: true },
    { id: "b", role: "assistant" as const, text: "Captain, obj-77-r1 is ready for review.", wake: true },
    { id: "c", role: "assistant" as const, text: "Here is the answer to your question about obj-77-r1.", answers: "q1" },
    { id: "d", role: "assistant" as const, text: "Captain, obj-77-r10 needs a decision.", wake: true },
  ];
  const owned = new Set(["obj-77-r1"]);
  expect(withoutCosWakes(messages, owned).map((message) => message.id)).toEqual(["a", "c", "d"]);
  expect(withoutCosWakes(messages, new Set()).map((message) => message.id)).toEqual(["a", "b", "c", "d"]);
  const unreadable = withoutCosWakes(messages, null);
  expect(unreadable.map((message) => message.id)).toEqual(["a", "b", "c", "d"]);
  expect(unreadable.filter((message) => message.wake).every((message) => message.text === WAKE_OWNER_UNAVAILABLE)).toBe(true);
  expect(unreadable.find((message) => message.id === "c")!.text).toBe(messages[2]!.text);
});

it("records an answer on a settled objective's work on that objective, as received, without opening new work", async () => {
  const objectives = join(process.env.FLYD_COMMAND_DIR!, "objectives");
  mkdirSync(objectives, { recursive: true });
  const id = "obj-settled-answer";
  writeFileSync(join(objectives, `${id}.json`), JSON.stringify({ id, revision: 1, createdAt: "2026-11-27T00:00:00Z", updatedAt: "2026-11-27T00:00:00Z", origin: "chat", words: "make the header blue", flydNotes: "", contextRefs: [], status: "done", runs: [] }));
  const evidence = await answerObjectiveRun({ id: "domain-settled-answer", request: { objectiveId: id } as never }, "George's answer to: which blue?\n\nnavy");
  expect(evidence).toBe(`objective:${id}`);
  const saved = readObjective(id)!;
  expect(saved.flydNotes).toContain("navy");
  expect(saved.status).toBe("done");
  expect(saved.runs).toEqual([]);
  await expect(answerObjectiveRun({ id: "domain-missing", request: { objectiveId: "obj-missing-answer" } as never }, "navy")).rejects.toThrow();
});
