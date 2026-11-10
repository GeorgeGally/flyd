import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { IntelligenceEventStore } from "../../event-store.js";
import { checkFinished, finishedLine, plainLabel, type FinishedReaders } from "../finished-check.js";
import { processFirstmateChange } from "../firstmate-decision.js";

const PR = "https://github.com/GeorgeGally/flyd/pull/251";
const readers = (pull: Awaited<ReturnType<FinishedReaders["pull"]>>, onDefault: boolean | null = null): FinishedReaders => ({
  pull: async () => pull,
  commitOnDefault: async () => onDefault,
});

let dir: string | undefined;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

describe("finished work, checked by Flyd", () => {
  it("says a merged change in one line, with the change's own title and its link", async () => {
    const check = await checkFinished({ label: "flyd-hide-whatsapp-card", detail: `done: PR ${PR} merged` },
      readers({ merged: true, title: "fix(conversation-view): keep unpaired WhatsApp off the main screen (#251)", mergeCommit: "a".repeat(40) }));
    expect(check).toMatchObject({ checked: true, landed: true, url: PR, line: `Done: keep unpaired WhatsApp off the main screen. ${PR}` });
    expect(check.evidenceRefs).toEqual([PR, `github-merge:${"a".repeat(40)}`]);
  });

  it("says an open change is finished and waiting, and a closed one honestly", async () => {
    expect((await checkFinished({ label: "Liesel: mode words", detail: PR }, readers({ merged: false, state: "open" }))).line)
      .toBe(`Liesel: mode words is finished and waiting to go in. ${PR}`);
    expect((await checkFinished({ label: "Liesel: mode words", detail: PR }, readers({ merged: false, state: "closed" }))).line)
      .toBe(`Liesel: mode words is finished, but its change was closed without going in. ${PR}`);
  });

  it("checks a named commit against the default branch", async () => {
    const commit = "https://github.com/GeorgeGally/dir/commit/3ce3245";
    const check = await checkFinished({ label: "dir-failed-jobs", detail: `landed ${commit}` }, readers(null, true));
    expect(check).toMatchObject({ checked: true, landed: true, line: `Done: dir: failed jobs. ${commit}` });
  });

  it("still says it is done when nothing can be checked, and never says nothing", async () => {
    const check = await checkFinished({ label: "logan-make-transparent", detail: "ready in branch fm/logan-make-transparent" }, readers(null));
    expect(check).toMatchObject({ checked: false, landed: false, line: "Logan: make transparent is finished; I haven't checked it yet." });
    // A name that is itself backstage is said in plain words, then as the bare fact.
    expect(finishedLine("Set up a remote firstmate on the PC", "unchecked")).toBe("Set up a remote the team on the PC is finished; I haven't checked it yet.");
    expect(finishedLine("fm/pc-secondmate", "unchecked")).toBe("A piece of your work is finished; I haven't checked it yet.");
  });

  it("reads a task id as words and leaves a title alone", () => {
    expect(plainLabel("flyd-hide-whatsapp-card")).toBe("Flyd: hide whatsapp card");
    expect(plainLabel("Keep the hero tidy")).toBe("Keep the hero tidy");
  });

  it("decides a finished task once, told whether or not it could be checked, never 'interpretation is unclear'", async () => {
    dir = mkdtempSync(join(tmpdir(), "flyd-finished-"));
    const store = new IntelligenceEventStore({ path: join(dir, "intelligence.sqlite") });
    let asked = 0;
    const options = { store, complete: async () => { asked++; return "{}"; }, finishedReaders: readers({ merged: true, title: "Hide the card", mergeCommit: "b".repeat(40) }) };
    const change = { eventId: "result:flyd-hide-whatsapp-card", taskId: "flyd-hide-whatsapp-card", kind: "fleet_state" as const, state: "done", label: "flyd-hide-whatsapp-card", detail: `PR ${PR} checks green`, evidenceRefs: ["firstmate-task:flyd-hide-whatsapp-card"] };
    const first = await processFirstmateChange(change, options);
    expect(first).toMatchObject({ disposition: "handle_internally", show: true, notify: true, summary: `Done: hide the card. ${PR}`, delivery: { checked: true, url: PR } });
    expect(asked).toBe(0);
    const unchecked = await processFirstmateChange({ ...change, eventId: "result:logan-page-drag", taskId: "logan-page-drag", label: "logan-page-drag", detail: "ready in branch fm/logan-page-drag" }, { ...options, finishedReaders: readers(null) });
    expect(unchecked).toMatchObject({ disposition: "handle_internally", show: true, notify: true, reason: "finished work; its outcome could not be checked", delivery: { line: "Logan: page drag is finished; I haven't checked it yet.", checked: false } });
    // Read back from the store on a restart, the same record stands.
    expect(await processFirstmateChange(change, options)).toEqual(first);
    store.close();
  });
});
