import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IntelligenceEventStore } from "../../event-store.js";
import { checkFinished, finishedLine, plainLabel, type FinishedReaders } from "../finished-check.js";
import { processFirstmateChange } from "../firstmate-decision.js";

const PR = "https://github.com/GeorgeGally/flyd/pull/251";
const readers = (pull: Awaited<ReturnType<FinishedReaders["pull"]>>, onDefault: boolean | null = null): FinishedReaders => ({
  pull: async () => pull,
  commitOnDefault: async () => onDefault,
});

let dir: string | undefined;
let projectsDir: string;
beforeEach(() => {
  // His own projects, as the registry spells them.
  projectsDir = mkdtempSync(join(tmpdir(), "flyd-projects-"));
  const path = join(projectsDir, "projects.json");
  writeFileSync(path, JSON.stringify({ projects: [{ id: "logan", name: "Logan" }, { id: "gnm", name: "GNM" }, { id: "dir", name: "DIR" }] }));
  vi.stubEnv("FLYD_PROJECTS_PATH", path);
});
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(projectsDir, { recursive: true, force: true });
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

describe("finished work, checked by Flyd", () => {
  it("says a merged change in one line, with the change's own title and its link", async () => {
    const check = await checkFinished({ label: "flyd-hide-whatsapp-card", detail: `done: PR ${PR} merged` },
      readers({ merged: true, title: "fix(conversation-view): keep unpaired WhatsApp off the main screen (#251)", mergeCommit: "a".repeat(40) }));
    expect(check).toMatchObject({ checked: true, landed: true, url: PR, line: `Done: Keep unpaired WhatsApp off the main screen. ${PR}` });
    expect(check.evidenceRefs).toEqual([PR, `github-merge:${"a".repeat(40)}`]);
  });

  it("says an open change is finished and waiting, and a closed one honestly", async () => {
    expect((await checkFinished({ label: "Liesel: mode words", detail: PR }, readers({ merged: false, state: "open", title: "feat: mode words (#251)" }))).line)
      .toBe(`Mode words is finished and waiting to go in. ${PR}`);
    expect((await checkFinished({ label: "Liesel: mode words", detail: PR }, readers({ merged: false, state: "closed" }))).line)
      .toBe(`Liesel: mode words is finished, but its change was closed without going in. ${PR}`);
  });

  it("checks a named commit against the default branch, and says one checked and not in yet is waiting", async () => {
    const commit = "https://github.com/GeorgeGally/dir/commit/3ce3245";
    const check = await checkFinished({ label: "dir-failed-jobs", detail: `landed ${commit}` }, readers(null, true));
    expect(check).toMatchObject({ checked: true, landed: true, line: `Done: DIR: failed jobs. ${commit}` });
    expect(await checkFinished({ label: "dir-failed-jobs", detail: `landed ${commit}` }, readers(null, false)))
      .toMatchObject({ checked: true, landed: false, url: commit, line: `DIR: failed jobs is finished and waiting to go in. ${commit}` });
  });

  it("still says it is done when nothing can be checked, and never says nothing", async () => {
    const check = await checkFinished({ label: "logan-make-transparent", detail: "ready in branch fm/logan-make-transparent" }, readers(null));
    expect(check).toMatchObject({ checked: false, landed: false, line: "Logan: make transparent is finished; I haven't checked it yet." });
    // His words are quoted only as he said them: a request naming backstage is told as the bare fact, never misquoted.
    expect(finishedLine({ request: "Set up a remote firstmate on the PC" }, "unchecked")).toBe("A piece of your work is finished; I haven't checked it yet.");
    expect(finishedLine({ request: "fm/pc-secondmate" }, "unchecked")).toBe("A piece of your work is finished; I haven't checked it yet.");
  });

  it("never says his request itself is done when no title of the change was read", async () => {
    const commit = "https://github.com/GeorgeGally/gnm/commit/3ce3245";
    // His first line is a problem statement: the landed change is named by it, never said to have done it.
    expect((await checkFinished({ label: "the GNM hero is too tall on phones", detail: commit, labelFromGeorge: true }, readers(null, true))).line)
      .toBe(`Your request “the GNM hero is too tall on phones” is done. ${commit}`);
    expect((await checkFinished({ label: "the GNM hero is too tall on phones", detail: "ready", labelFromGeorge: true }, readers(null))).line)
      .toBe("Your request “the GNM hero is too tall on phones” is finished; I haven't checked it yet.");
    // A title read from the change keeps its own capitals.
    expect((await checkFinished({ label: "gnm-hero", detail: PR }, readers({ merged: true, title: "GNM hero fits phones" }))).line)
      .toBe(`Done: GNM hero fits phones. ${PR}`);
  });

  it("reads a task id as words and leaves a title alone", () => {
    expect(plainLabel("gnm-hero-height")).toBe("GNM: hero height");
    expect(plainLabel("logan-page-drag", [{ id: "logan", name: "Logan" }])).toBe("Logan: page drag");
    // A project he has not registered is not given a made-up title.
    expect(plainLabel("acme-new-page")).toBe("acme-new-page");
    expect(plainLabel("Keep the hero tidy")).toBe("Keep the hero tidy");
  });

  it("decides a finished task once, told whether or not it could be checked, never 'interpretation is unclear'", async () => {
    dir = mkdtempSync(join(tmpdir(), "flyd-finished-"));
    const store = new IntelligenceEventStore({ path: join(dir, "intelligence.sqlite") });
    let asked = 0;
    const options = { store, complete: async () => { asked++; return "{}"; }, finishedReaders: readers({ merged: true, title: "Hide the card", mergeCommit: "b".repeat(40) }) };
    const change = { eventId: "result:flyd-hide-whatsapp-card", taskId: "flyd-hide-whatsapp-card", kind: "fleet_state" as const, state: "done", label: "flyd-hide-whatsapp-card", detail: `PR ${PR} checks green`, evidenceRefs: ["firstmate-task:flyd-hide-whatsapp-card"] };
    const first = await processFirstmateChange(change, options);
    expect(first).toMatchObject({ disposition: "handle_internally", show: true, notify: true, summary: `Done: Hide the card. ${PR}`, delivery: { checked: true, url: PR } });
    expect(asked).toBe(0);
    const unchecked = await processFirstmateChange({ ...change, eventId: "result:logan-page-drag", taskId: "logan-page-drag", label: "logan-page-drag", detail: "ready in branch fm/logan-page-drag" }, { ...options, finishedReaders: readers(null) });
    expect(unchecked).toMatchObject({ disposition: "handle_internally", show: true, notify: true, reason: "finished work; its outcome could not be checked", delivery: { line: "Logan: page drag is finished; I haven't checked it yet.", checked: false } });
    // A result that still asks George something keeps the question path rather than a finished line.
    let interpreted = 0;
    const open = await processFirstmateChange({ ...change, eventId: "result:gnm-open", taskId: "gnm-open", label: "gnm-open", detail: "Shipped.\nShould the old hero stay for one release?", unresolved: true },
      { ...options, complete: async () => { interpreted++; return JSON.stringify({ kind: "unclear", summary: "unclear", evidenceRefs: [] }); } });
    expect([interpreted, open.delivery]).toEqual([1, undefined]);
    // A fleet row has no question field: a done report that still asks him goes through the same path, never a finished line.
    const asking = await processFirstmateChange({ ...change, eventId: "result:gnm-deploy", taskId: "gnm-deploy", label: "gnm-deploy", detail: "Done, but should I also deploy it to prod?" },
      { ...options, complete: async () => { interpreted++; return JSON.stringify({ kind: "unclear", summary: "unclear", evidenceRefs: [] }); } });
    expect([interpreted, asking.delivery]).toEqual([2, undefined]);
    // Read back from the store on a restart, the same record stands.
    expect(await processFirstmateChange(change, options)).toEqual(first);
    store.close();
  });
});
