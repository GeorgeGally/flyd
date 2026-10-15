import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, expect, it } from "vitest";
import { RoutineArtefacts, eligibleRoutineText, routineSlots } from "../routines.js";
import { IntelligenceEventStore } from "../../intelligence/event-store.js";
import { renderRoutinesPage } from "../routines-page.js";
import { Window, type HTMLInputElement as HappyInput } from "happy-dom";

const dirs: string[] = [];
const text = "Review the vendor applications and draft my follow ups";
function fresh(): string {
  const dir = mkdtempSync(join(tmpdir(), "flyd-routine-"));
  dirs.push(dir);
  return join(dir, "events.sqlite");
}
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { force: true, recursive: true }); });

it("suggests after three independent deliveries; preserves provenance and dismissal across restart", () => {
  const path = fresh();
  const routines = new RoutineArtefacts({ path });
  expect(routines.observe("market", "one", text)).toBeNull();
  expect(routines.observe("market", "one", text)).toBeNull();
  expect(routines.observe("market", "two", text)).toBeNull();
  expect(new RoutineArtefacts({ path }).observe("other", "three", text)).toBeNull();
  const proposed = new RoutineArtefacts({ path }).observe("market", "three", text)!;
  expect(proposed.status).toBe("suggested");
  routines.dismiss(proposed.id);
  expect(routines.observe("market", "four", text)).toBeNull();
  expect(routines.list().routines).toEqual([]);
  const db = new IntelligenceEventStore({ path });
  try {
    const events = db.readSource("view.routines");
    expect(events.some(event => event.kind === "proposed_action")).toBe(true);
    expect(events.filter(event => event.kind === "observation").every(event => !JSON.stringify(event.payload).includes(text))).toBe(true);
  } finally { db.close(); }
});

it("keeps permissions separate and refuses unactivated, stale or incomplete runs", () => {
  const routines = new RoutineArtefacts({ path: fresh() });
  routines.observe("s", "1", text); routines.observe("s", "2", text);
  const proposed = routines.observe("s", "3", text)!;
  expect(() => routines.claim(proposed.id, 1, "s", "request-1234567890", {})).toThrow("Activate");
  const active = routines.save({ ...proposed, template: "Review {{topic}} and draft my follow ups" });
  expect(() => routines.claim(active.id, active.revision, "s", "request-1234567890", {})).toThrow("topic");
  expect(() => routines.save({ ...active, revision: 1 })).toThrow("changed");
  const claimed = routines.claim(active.id, active.revision, "s", "request-1234567890", { topic: "the market" });
  expect(claimed.run.text).toBe("Review the market and draft my follow ups");
  const changed = routines.save({ ...active, template: "Different request" });
  expect(routines.claim(changed.id, changed.revision, "s", claimed.run.id, { topic: "another market" }).run).toEqual(claimed.run);
  expect(() => routines.claim(changed.id, changed.revision, "another", claimed.run.id, {})).toThrow("already used");
});

it("never redispatches uncertain runs across restart and distinguishes submission from success", () => {
  const path = fresh();
  const routines = new RoutineArtefacts({ path });
  const active = routines.save({ title: "Vendors", purpose: "Follow up", template: text });
  const claimed = routines.claim(active.id, active.revision, "s", "request-1234567890", {});
  expect(new RoutineArtefacts({ path }).claim(active.id, active.revision, "s", claimed.run.id, {}).fresh).toBe(false);
  routines.settle(claimed.run);
  expect(routines.list().runs[0].status).toBe("unknown");
  expect(new RoutineArtefacts({ path }).claim(active.id, active.revision, "s", claimed.run.id, {}).fresh).toBe(false);
  const next = routines.claim(active.id, active.revision, "s", "request-0987654321", {});
  routines.settle(next.run, "note:42");
  expect(routines.list().runs[0].status).toBe("submitted");
  expect(routines.settle(next.run).status).toBe("submitted");
});

it("supports pause and erasure; excludes credentials from discovery", () => {
  const path = fresh();
  const routines = new RoutineArtefacts({ path });
  routines.enable(false);
  expect(routines.observe("s", "1", text)).toBeNull();
  routines.enable(true); routines.observe("s", "2", text);
  routines.save({ title: "Vendors", purpose: "Follow up", template: text });
  routines.erase();
  expect(routines.list()).toEqual({ routines: [], runs: [], enabled: false });
  const db = new IntelligenceEventStore({ path });
  try {
    const events = db.readSource("view.routines");
    expect(events.filter(event => !event.erased).map(event => event.payload)).toEqual([{ action: "enabled", enabled: false }]);
    expect(events.filter(event => event.erased).every(event => !event.payload)).toBe(true);
  } finally { db.close(); }
  expect(eligibleRoutineText("Please use my password abc to check this service")).toBe(false);
  expect(eligibleRoutineText("Review https://example.com and tell me what it says")).toBe(false);
  expect(() => routineSlots("Review {{bad-name}}" )).toThrow("inputs");
});

it("does not resurrect an in-flight request after erasure", () => {
  const routines = new RoutineArtefacts({ path: fresh() });
  const active = routines.save({ title: "Vendors", purpose: "Follow up", template: text });
  const claimed = routines.claim(active.id, active.revision, "s", "request-1234567890", {});
  routines.erase();
  expect(() => routines.settle(claimed.run, "note:42")).toThrow("forgotten");
  expect(routines.list().runs).toEqual([]);
});

it("renders executable text-only controls and live input previews without interpreting request HTML", async () => {
  const window = new Window({ url: "http://127.0.0.1:4818/routines" });
  window.fetch = async () => ({ ok: true, json: async () => ({ enabled: true, runs: [], routines: [{
    id: "r", title: "<img src=x onerror=alert(1)>", purpose: "Review", template: "Review {{topic}}",
    status: "active", revision: 1,
  }] }) }) as never;
  const html = renderRoutinesPage("test-token");
  window.document.write(html.replace(/<script>[\s\S]*?<\/script>/, ""));
  window.eval(html.match(/<script>([\s\S]*?)<\/script>/)![1]);
  await window.happyDOM.waitUntilComplete();
  expect(window.document.querySelectorAll("#cards article")).toHaveLength(1);
  expect(window.document.querySelector("#cards img")).toBeNull();
  const input = window.document.querySelector<HappyInput>("#cards input")!;
  expect(input).not.toBeNull();
  input.value = "vendors"; input.dispatchEvent(new window.Event("input"));
  expect(window.document.querySelector("#cards pre")?.textContent).toBe("Review vendors");
  await window.happyDOM.abort();
});
