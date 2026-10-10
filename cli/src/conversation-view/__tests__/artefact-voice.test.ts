import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { composeArtefact, parseBearings, withVoice } from "../artefact.js";
import { ArtefactVoice, parseVoice, voiceKey, voicePrompt, type VoiceItem } from "../artefact-voice.js";

const JEV: VoiceItem = {
  kind: "needs you",
  title: "Review Jev decision log: did Jev change or improve firstmate decisions? keep or remove the rule",
  detail: "Review Jev log after ~20 real decisions; captain decides keep or remove",
};

describe("parseVoice", () => {
  it("keeps well-formed rows for the ids asked, in Flyd's voice and without em dashes", () => {
    const raw = 'Here you go:\n[{"id":"a","headline":"Jev has been making firstmate\'s calls — time to judge it.","line":"Captain, keep the rule or drop it."},{"id":"z","headline":"not asked"},{"id":"b","headline":7}]';
    const said = parseVoice(raw, new Set(["a", "b"]));
    expect([...said.keys()]).toEqual(["a"]);
    expect(said.get("a")!.headline).toBe("Jev has been making firstmate's calls, time to judge it.");
    expect(said.get("a")!.line).not.toMatch(/captain/i);
    expect(parseVoice("no json here", new Set(["a"])).size).toBe(0);
  });
});

describe("voicePrompt", () => {
  it("hands over the work as data and asks for a headline and a line", () => {
    const prompt = voicePrompt([{ id: "k1", ...JEV }], "George designs and codes.");
    expect(prompt).toContain('"title": "Review Jev decision log');
    expect(prompt).toContain('"where": "needs you"');
    expect(prompt).toContain("George designs and codes.");
    expect(prompt).toContain("JSON array");
  });

  it("says the crew does the work, never George", () => {
    // "It is under way, and you are working on it now." put a worker's job on him.
    const prompt = voicePrompt([{ id: "k1", kind: "under way", title: "Flyd: TV artefact" }], null);
    expect(prompt).toContain("The work is done by the crew, never by George");
    expect(prompt).toContain("Never say he is doing, building or working on something");
  });
});

describe("ArtefactVoice", () => {
  it("says each row once, keeps it on disk, and does not straight away retry a row the model would not say", async () => {
    const cacheFile = join(mkdtempSync(join(tmpdir(), "artefact-voice-")), "voice.json");
    const prompts: string[] = [];
    const other: VoiceItem = { kind: "under way", title: "Flyd: drag and drop documents into the window" };
    const voice = new ArtefactVoice({
      cacheFile,
      profile: () => null,
      complete: async (prompt) => {
        prompts.push(prompt);
        return JSON.stringify([{ id: voiceKey(JEV), headline: "Jev's trial is up; does it stay?", line: "Keep the rule, or drop it and firstmate decides alone again." }]);
      },
    });
    expect(await voice.request([JEV, other])).toBe(true);
    expect(voice.said(JEV)).toEqual({ headline: "Jev's trial is up; does it stay?", line: "Keep the rule, or drop it and firstmate decides alone again." });
    expect(voice.said(other)).toBeUndefined();
    expect(await voice.request([JEV, other])).toBe(false);
    expect(prompts).toHaveLength(1);
    expect(JSON.parse(readFileSync(cacheFile, "utf8"))[voiceKey(JEV)].headline).toBe("Jev's trial is up; does it stay?");
    const again = new ArtefactVoice({ cacheFile, complete: async () => "[]" });
    expect(again.said(JEV)?.headline).toBe("Jev's trial is up; does it stay?");
  });

  it("asks again for a row the model failed on only after a few minutes", async () => {
    let clock = 0;
    let down = true;
    const calls: string[] = [];
    const voice = new ArtefactVoice({
      cacheFile: join(mkdtempSync(join(tmpdir(), "artefact-voice-")), "v.json"),
      profile: () => null,
      now: () => clock,
      complete: async (prompt) => {
        calls.push(prompt);
        if (down) throw new Error("rate limited");
        return JSON.stringify([{ id: voiceKey(JEV), headline: "Jev's trial is up; does it stay?", line: "Keep the rule or drop it." }]);
      },
    });
    expect(await voice.request([JEV])).toBe(false);
    down = false;
    clock = 60_000;
    expect(await voice.request([JEV])).toBe(false);
    expect(calls).toHaveLength(1);
    clock = 5 * 60_000;
    expect(await voice.request([JEV])).toBe(true);
    expect(calls).toHaveLength(2);
    expect(voice.said(JEV)?.headline).toBe("Jev's trial is up; does it stay?");
  });

  it("fails soft when the model errors", async () => {
    const voice = new ArtefactVoice({ cacheFile: join(mkdtempSync(join(tmpdir(), "artefact-voice-")), "v.json"), profile: () => null, complete: async () => { throw new Error("down"); } });
    expect(await voice.request([JEV])).toBe(false);
    expect(voice.said(JEV)).toBeUndefined();
  });
});

describe("withVoice", () => {
  it("puts Flyd's words on the rows the screen shows and lists the rest as unsaid", () => {
    const fleet = parseBearings({
      decisions_open: [{ id: "jev", summary: JEV.title }],
      in_flight: [{ id: "a", state: "working", repo: "flyd", name: "Flyd: drag and drop documents into the window", doing: "harness busy" }],
    });
    const { fleet: voiced, unsaid } = withVoice(fleet, (item) =>
      item.kind === "needs you" ? { headline: "Jev's trial is up; does it stay?", line: "Keep it or drop it." } : undefined);
    expect(unsaid).toEqual([{ kind: "under way", title: "Flyd: drag and drop documents into the window", detail: "Working on it now", project: "flyd" }]);
    const items = composeArtefact({ fleet: voiced, memories: [], news: [], taste: [] });
    expect(items[0]).toMatchObject({ kind: "call", headline: "Jev's trial is up; does it stay?", detail: "Keep it or drop it." });
    expect(items[1]).toMatchObject({ kind: "live", headline: "Drag and drop documents into the window", detail: "Working on it now" });
  });

  it("shows a task's last words while new ones are asked for, only while it stays in the same section", () => {
    const last = (kind: string, task: string) =>
      kind === "needs you" && task === "jev" ? { headline: "Decide whether the Jev log stays.", line: "Keep it or drop it." } : undefined;
    const asCall = withVoice(parseBearings({ decisions_open: [{ id: "jev", summary: JEV.title }] }), () => undefined, last);
    expect(asCall.fleet.calls[0]!.said?.headline).toBe("Decide whether the Jev log stays.");
    expect(asCall.unsaid).toHaveLength(1);
    const asLanded = withVoice(parseBearings({ landed: [{ id: "jev", what: "Jev decision log reviewed" }] }), () => undefined, last);
    expect(asLanded.fleet.landed[0]).toMatchObject({ task: "jev" });
    expect(asLanded.fleet.landed[0]!.said).toBeUndefined();
    expect(asLanded.unsaid).toHaveLength(1);
  });
});
