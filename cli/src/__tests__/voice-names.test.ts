import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const fetched = vi.hoisted(() => ({ text: "" }));
vi.mock("../dictation/http.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../dictation/http.js")>()),
  dictationFetch: vi.fn(async () => new Response(JSON.stringify({ text: fetched.text }), { status: 200 })),
  completeText: vi.fn(async () => { throw new Error("no cleanup model in tests"); }),
}));

import { transcribeBufferedAudio } from "../transcription.js";
import { transcriptionPurpose } from "../dictation/request.js";
import { learnLiveUtterance, liveIntent } from "../realtime-session.js";
import { FlydDesk } from "../conversation-view/flyd-desk.js";
import { correctNames, correctVoiceNames, nameCorrection } from "../dictation/names.js";
import { dictationScope, learnedNameRules } from "../dictation/corrections.js";
import { learningRequest } from "../cognition/learning-service.js";
import { projectNames } from "../dictation/vocabulary.js";
import type { Project } from "../council/projects.js";

let dir: string;
const project = (name: string, people: string[] = ["George"]) => ({ id: name.toLowerCase(), name, status: "active", people });

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "flyd-voice-names-"));
  vi.stubEnv("FLYD_DIR", dir);
  vi.stubEnv("FLYD_PROJECTS_PATH", join(dir, "projects.json"));
  vi.stubEnv("FLYD_USER_PROFILE", join(dir, "USER.md"));
  vi.stubEnv("FLYD_DICTATION_RULES", join(dir, "dictation-rules.json"));
  vi.stubEnv("FLYD_DICTATE_MODEL", "");
  vi.stubEnv("OPENAI_API_KEY", "test-key");
  writeFileSync(join(dir, "projects.json"), JSON.stringify({ projects: [
    project("CleanX"), project("Posttraction"), project("Logan"), project("Pierre"), project("Tastemaker"), project("Fonzo"),
  ] }));
  writeFileSync(join(dir, "USER.md"), "# George\n\nWatches YouTube and TikTok, collects CryptoArt.\n");
});

const learning = (action: string) => learningRequest("/learning/source", "POST", { sourceId: "dictation.corrections", action });
afterEach(() => { vi.unstubAllEnvs(); rmSync(dir, { recursive: true, force: true }); });

async function heard(spoken: string, purpose: Record<string, unknown>): Promise<string> {
  fetched.text = spoken;
  const sent: Array<Record<string, unknown>> = [];
  await transcribeBufferedAudio([Buffer.alloc(48_000, 1)], { send: (data: string) => sent.push(JSON.parse(data)) }, transcriptionPurpose(purpose));
  return String(sent.at(-1)?.text ?? "");
}

describe("every voice path spells his names", () => {
  it("conversation voice turns Kleenex into CleanX", async () => {
    expect(await heard("Ask Kleenex about the launch", {})).toBe("Ask CleanX about the launch");
  });

  it("dictation turns Kleenex into CleanX", async () => {
    expect(await heard("ship the kleenex landing page", { purpose: "dictation", app: { bundleId: "com.apple.Notes", windowTitle: "Notes" } }))
      .toBe("Ship the CleanX landing page");
  });

  it("LIVE turns Kleenex into CleanX before the intent reaches Core", () => {
    expect(liveIntent("Open the Clean X dashboard")).toBe("Open the CleanX dashboard");
  });

  it("knows the sound-alikes, keeps the band and never rewrites a name he has", () => {
    const terms = ["Flyd", "CleanX", "Tastemaker"];
    expect(correctNames("Kleenex, Kleenx and clean x. Floyd, ask Pink Floyd", terms)).toBe("CleanX, CleanX and CleanX. Flyd, ask Pink Floyd");
    expect(correctNames("the taste maker build", terms, [], ["Tastemaker"])).toBe("the Tastemaker build");
    expect(correctNames("I need the clinics data and a Kleenex", ["Flyd"])).toBe("I need the clinics data and a Kleenex");
    expect(correctNames("Reply to Floyd", ["Flyd", "Floyd"])).toBe("Reply to Floyd");
  });

  it("joins only his project and people names, never profile terms or the LIVE intent", () => {
    expect(correctVoiceNames("tick tock, you tube and crypto art for the taste maker launch"))
      .toBe("tick tock, you tube and crypto art for the Tastemaker launch");
    expect(liveIntent("open the taste maker board")).toBe("open the taste maker board");
  });
});

describe("his corrections teach Flyd", () => {
  it("a chat correction creates the rule the first time, on every path", async () => {
    await learning("enable");
    const desk = new FlydDesk({ dir: join(dir, "asks"), answer: async () => "Done." });
    desk.ask("Did Kleenex ship yet?", [], "session");
    desk.ask("I meant CleanX", [], "session");
    expect(learnedNameRules()).toEqual([{ from: "Kleenex", to: "CleanX" }]);

    expect(correctVoiceNames("how is fonso doing")).toBe("how is fonso doing");
    desk.ask("it's Fonzo not Fonso", [], "session");
    expect(correctVoiceNames("how is fonso doing")).toBe("how is Fonzo doing");
    expect(liveIntent("how is fonso doing")).toBe("how is Fonzo doing");
  });

  it("learns nothing while correction learning is off", () => {
    const desk = new FlydDesk({ dir: join(dir, "asks"), answer: async () => "Done." });
    desk.ask("it's Fonzo not Fonso", [], "session");
    expect(learnedNameRules()).toEqual([]);
    expect(correctVoiceNames("how is fonso doing")).toBe("how is fonso doing");
  });

  it("rejection turns a name off everywhere and a repeat does not revive it; erasure removes it", async () => {
    await learning("enable");
    const previous = learnLiveUtterance("how is fonso doing", undefined);
    learnLiveUtterance("I meant Fonzo", previous);
    expect(correctVoiceNames("how is fonso doing")).toBe("how is Fonzo doing");
    const listed = (await learningRequest("/learning", "GET")).body as { corrections: Array<{ sequence: number; from: string; to: string }> };
    const lesson = listed.corrections.find(c => c.to === "Fonzo")!;
    expect(lesson).toMatchObject({ from: "fonso" });

    await learningRequest("/dictation/review", "POST", { sequence: lesson.sequence, approved: false });
    expect(correctVoiceNames("how is fonso doing")).toBe("how is fonso doing");
    learnLiveUtterance("it's Fonzo not fonso", "anything");
    expect(correctVoiceNames("how is fonso doing")).toBe("how is fonso doing");

    learnLiveUtterance("Fonzo, not Fonsso", "anything");
    expect(learnedNameRules()).toEqual([{ from: "Fonsso", to: "Fonzo" }]);
    await learning("erase");
    expect(learnedNameRules()).toEqual([]);
    expect(correctVoiceNames("how is fonsso doing")).toBe("how is fonsso doing");
  });

  it("learns the stated form and refuses a choice between two of his names, a prefix or an inflection", () => {
    const terms = ["CleanX", "Logan", "Pierre"];
    expect(nameCorrection("No, it's CleanX not Kleenex", undefined, terms)).toEqual({ from: "Kleenex", to: "CleanX" });
    expect(nameCorrection("not kleenex, CleanX", undefined, terms)).toEqual({ from: "kleenex", to: "CleanX" });
    expect(nameCorrection("Logan, not Pierre", undefined, terms)).toBeNull();
    expect(nameCorrection("CleanX, not Clean", undefined, terms)).toBeNull();
    expect(nameCorrection("Logan, not Logan's", undefined, terms)).toBeNull();
    expect(nameCorrection("I meant CleanX", "clean up the page", terms)).toBeNull();
  });

  it("a LIVE correction of an inflection teaches nothing", async () => {
    await learning("enable");
    const previous = learnLiveUtterance("What's new on Logan's room?", undefined);
    learnLiveUtterance("I meant Logan", previous);
    expect(learnedNameRules()).toEqual([]);
  });

  it("a dictation edit of a known name teaches every path at once; other words wait for three", async () => {
    await learning("enable");
    const edit = (before: string, after: string, invocationId: string) => learningRequest("/dictation/correction", "POST",
      { before, after, invocationId, bundleId: "com.apple.Notes", scope: dictationScope("com.apple.Notes", "Notes") });
    await edit("how is fonso doing", "how is Fonzo doing", "d1");
    await edit("book a flight today", "book a fight today", "d2");
    expect(learnedNameRules()).toEqual([{ from: "fonso", to: "Fonzo" }]);
    expect(correctVoiceNames("is fonso live")).toBe("is Fonzo live");
  });
});

describe("vocabulary names", () => {
  it("keeps his project names and drops decision titles filed as projects", () => {
    const named = (name: string, people: string[] = []) => projectNames({ name, people } as Pick<Project, "name" | "people">);
    expect(named("Guido (browser ruler tool)", ["George"])).toEqual(["Guido"]);
    expect(named("DIR (Dead Internet Radio)", ["George"])).toEqual(["DIR", "Dead Internet Radio"]);
    expect(named("CapFive is missing GDPR cookie consent, and I need your pick")).toEqual([]);
    expect(named("Doory: run locally for you to try")).toEqual([]);
    expect(named("DIR")).toEqual(["DIR"]);
  });
});
