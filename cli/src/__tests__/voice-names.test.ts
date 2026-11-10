import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
import { correctNames, correctVoiceNames, learnNameEdit, loadNameRules, nameCorrection } from "../dictation/names.js";
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
  vi.stubEnv("FLYD_VOICE_NAME_RULES", join(dir, "voice-name-rules.json"));
  vi.stubEnv("FLYD_DICTATE_MODEL", "");
  vi.stubEnv("OPENAI_API_KEY", "test-key");
  writeFileSync(join(dir, "projects.json"), JSON.stringify({ projects: [
    project("CleanX"), project("Posttraction"), project("Logan"), project("Pierre"),
  ] }));
});
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
    expect(correctNames("the taste maker build", terms)).toBe("the Tastemaker build");
    expect(correctNames("I need the clinics data and a Kleenex", ["Flyd"])).toBe("I need the clinics data and a Kleenex");
    expect(correctNames("Reply to Floyd", ["Flyd", "Floyd"])).toBe("Reply to Floyd");
  });
});

describe("his corrections teach Flyd", () => {
  it("a chat correction creates the rule the first time and it survives a restart", async () => {
    const desk = new FlydDesk({ dir: join(dir, "asks"), answer: async () => "Done." });
    desk.ask("Did Kleenex ship yet?", [], "session");
    desk.ask("I meant CleanX", [], "session");
    expect(JSON.parse(readFileSync(join(dir, "voice-name-rules.json"), "utf8"))).toMatchObject([{ from: "Kleenex", to: "CleanX", source: "chat" }]);

    expect(correctVoiceNames("how is post action doing")).toBe("how is post action doing");
    desk.ask("it's Posttraction not Post action", [], "session");
    expect(correctVoiceNames("how is post action doing")).toBe("how is Posttraction doing");
  });

  it("learns the stated form and refuses a choice between two of his names", () => {
    const terms = ["CleanX", "Logan", "Pierre"];
    expect(nameCorrection("No, it's CleanX not Kleenex", undefined, terms)).toEqual({ from: "Kleenex", to: "CleanX" });
    expect(nameCorrection("not kleenex, CleanX", undefined, terms)).toEqual({ from: "kleenex", to: "CleanX" });
    expect(nameCorrection("Logan, not Pierre", undefined, terms)).toBeNull();
    expect(nameCorrection("I meant CleanX", "clean up the page", terms)).toBeNull();
  });

  it("a LIVE correction teaches every path", () => {
    const previous = learnLiveUtterance("What's new on Logan's room?", undefined);
    learnLiveUtterance("I meant Logan", previous);
    expect(existsSync(join(dir, "voice-name-rules.json"))).toBe(false);

    learnLiveUtterance("it's Posttraction not Post action", "anything");
    expect(loadNameRules()).toMatchObject([{ from: "Post action", to: "Posttraction", source: "live" }]);
  });

  it("a dictation edit of a known name teaches at once; other words wait for three", () => {
    expect(learnNameEdit({ from: "Kleenex", to: "CleanX" })).toMatchObject({ from: "Kleenex", to: "CleanX", source: "dictation" });
    expect(learnNameEdit({ from: "flight", to: "fight" })).toBeNull();
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
