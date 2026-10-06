import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const fetched = vi.hoisted(() => ({ prompts: [] as string[], text: "" }));
vi.mock("../dictation/http.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../dictation/http.js")>()),
  dictationFetch: vi.fn(async (_url: string, init: { body: FormData }) => {
    fetched.prompts.push(String(init.body.get("prompt")));
    return new Response(JSON.stringify({ text: fetched.text }), { status: 200 });
  }),
  completeText: vi.fn(async () => { throw new Error("no cleanup model in tests"); }),
}));

import { transcribeBufferedAudio } from "../transcription.js";
import { transcriptionPurpose } from "../dictation/request.js";
import { dictationScope } from "../dictation/corrections.js";
import { learningRequest } from "../cognition/learning-service.js";
import { CognitiveCurator } from "../cognition/curator/curator.js";
import { applyLessons } from "../cognition/curator/content-learning.js";
import { IntelligenceEventStore } from "../intelligence/event-store.js";

const dirs: string[] = [];
afterEach(() => { vi.unstubAllEnvs(); fetched.prompts.length = 0; for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

function sandbox(): void {
  const dir = mkdtempSync(join(tmpdir(), "flyd-transcription-learning-")); dirs.push(dir);
  vi.stubEnv("FLYD_DIR", dir);
  vi.stubEnv("FLYD_DICTATION_RULES", join(dir, "dictation-rules.json"));
  vi.stubEnv("FLYD_DICTATE_MODEL", "");
  vi.stubEnv("OPENAI_API_KEY", "test-key");
}

/** One dictation, as the adapter sends it, through the buffered upload path. */
async function dictate(spoken: string, app: { bundleId: string; windowTitle: string }): Promise<{ prompt: string; text: string }> {
  fetched.text = spoken;
  const sent: Array<Record<string, unknown>> = [];
  const purpose = transcriptionPurpose({ purpose: "dictation", app });
  await transcribeBufferedAudio([Buffer.alloc(48_000, 1)], { send: (data: string) => sent.push(JSON.parse(data)) }, purpose);
  return { prompt: fetched.prompts.at(-1) ?? "", text: String(sent.at(-1)?.text ?? "") };
}

describe("learning reaches the next transcription request", () => {
  it("an approved correction changes the next request's spelling hints and its text", async () => {
    sandbox();
    const before = await dictate("Deploy to Kinstar tonight", { bundleId: "com.mitchellh.ghostty", windowTitle: "capfive — deploy" });
    expect(before.prompt).not.toContain("Kinsta");
    expect(before.text).toBe("Deploy to Kinstar tonight");

    await learningRequest("/learning/source", "POST", { sourceId: "dictation.corrections", action: "enable" });
    const captured = await learningRequest("/dictation/correction", "POST", {
      before: "Deploy to Kinstar tonight", after: "Deploy to Kinsta tonight", invocationId: "voice-1",
      bundleId: "com.mitchellh.ghostty", scope: dictationScope("com.mitchellh.ghostty", "capfive — deploy"),
    });
    const sequence = (captured.body as { sequence: number }).sequence;

    // A candidate alone changes nothing; only George's approval does.
    expect((await dictate("Deploy to Kinstar tonight", { bundleId: "com.mitchellh.ghostty", windowTitle: "capfive — deploy" })).prompt)
      .not.toContain("Kinsta");
    await learningRequest("/dictation/review", "POST", { sequence, approved: true });

    // The window title changed since the edit; the approved spelling still applies in that app.
    const after = await dictate("Deploy to Kinstar tonight", { bundleId: "com.mitchellh.ghostty", windowTitle: "capfive — logs" });
    expect(after.prompt).toContain("Kinsta");
    expect(after.text).toBe("Deploy to Kinsta tonight");

    // Another app is hinted the spelling but its words are never rewritten.
    const mail = await dictate("Book the Kinstar flight", { bundleId: "com.apple.mail", windowTitle: "New Message" });
    expect(mail.prompt).toContain("Kinsta");
    expect(mail.text).toBe("Book the Kinstar flight");
  });

  it("subjects learned from conversation reach the next request's spelling hints", async () => {
    sandbox();
    expect((await dictate("check the deploy", { bundleId: "com.apple.Terminal", windowTitle: "zsh" })).prompt).not.toContain("WhisperKit");

    const store = new IntelligenceEventStore();
    try {
      const turn = new CognitiveCurator(store).recordConversationTurn({
        sessionId: "s1", turnNumber: 1, user: "WhisperKit is too slow for dictation.", assistant: "",
      });
      applyLessons(store, store.getBySequence(turn)!, [{ kind: "problem", subject: "WhisperKit", quote: "WhisperKit is too slow for dictation." }]);
    } finally { store.close(); }

    expect((await dictate("check the deploy", { bundleId: "com.apple.Terminal", windowTitle: "zsh" })).prompt).toContain("WhisperKit");
    vi.stubEnv("FLYD_CONVERSATION_LEARNING", "0");
    expect((await dictate("check the deploy", { bundleId: "com.apple.Terminal", windowTitle: "zsh" })).prompt).not.toContain("WhisperKit");
  });
});
