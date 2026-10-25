import { beforeEach, describe, expect, it, vi } from "vitest";

// The resolution model is the one network call on this path; capture what it
// is asked and answer with a fixed resolution.
const modelCalls: Array<{ prompt: string; system?: string }> = [];
let modelReply = "";
vi.mock("../lib/llm.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/llm.js")>();
  return {
    ...actual,
    query: vi.fn(async (prompt: string, _model?: string, system?: string) => {
      modelCalls.push({ prompt, system });
      return modelReply;
    }),
  };
});

import { resolve, type ManifestRequest } from "../resolve.js";
import { resetResolutionTurnCounters } from "../runtime/resolution-receipt.js";
import { finishInFlydsVoice, prepareSurfaceTurn, toollessPlanBrief, turnBriefParts, type FastRouteReading, type RouteTurn } from "../runtime/turn-stages.js";
import { planTurn } from "../runtime/turn-plan.js";
import type { Skill } from "../runtime/skills.js";
import type { TurnReceipt } from "../runtime/turn-receipt.js";

const env = {
  application: { bundle_id: "com.apple.Safari", name: "Safari" },
  window: { title: "Docs", ref: "win_01" },
  focused_element: { ref: "el_01", role: "AXTextArea", description: "Message body", value: "Thanks for the update", placeholder: "", selected_text: "" },
  selection: "",
  sufficiency: "semantic" as const,
};

function manifest(intent: string, extra: Partial<ManifestRequest> = {}): ManifestRequest {
  return {
    invocation_id: "inv-1", environment_revision: 3, intent, modality: "text",
    environment: env, invocation_fingerprint: { app: "Safari", window: "win_01", element: "el_01" },
    ...extra,
  };
}

const skill: Skill = { name: "plain-answers", description: "Answer plainly", body: "SKILL-KNOW-HOW-42: lead with the number.", path: "/skills/plain-answers/SKILL.md" } as Skill;
const jevAnswer = (): FastRouteReading => ({ route: "answer", confidence: 0.93, source: "jev", decided: true, skill: "plain-answers", raise: null, needsCode: false });

function receipts() {
  const persist = vi.fn(async (input: Omit<TurnReceipt, "version" | "id" | "recordedAt">) => ({ ...input, version: 1, id: "r", recordedAt: "" }) as TurnReceipt);
  return persist;
}

beforeEach(() => {
  modelCalls.length = 0;
  resetResolutionTurnCounters();
});

describe("overlay general questions go through chat's turn stages", () => {
  it("reads the turn like chat, hands the answer its plan and skill, and records them on the receipt", async () => {
    modelReply = JSON.stringify({ mode: "requires_augment", rationale: "Answer.", augmentations: [{ kind: "explanation", content: "Forty-two.", placement: "cursor" }] });
    const routeTurn = vi.fn<RouteTurn>(async () => jevAnswer());
    const persist = receipts();
    const resolution = await resolve(manifest("What is the answer to everything?"), "test-model", "key", undefined, null, [
      { user: "earlier question", assistant: "earlier answer" } as never,
    ], { persist, routeTurn, skills: () => [skill] });

    expect(resolution).toMatchObject({ mode: "requires_augment", operations: [], augmentations: [{ kind: "explanation", content: "Forty-two." }] });
    // Read the room: the same Jev route reading chat makes, with the conversation as chat sees it.
    expect(routeTurn).toHaveBeenCalledTimes(1);
    expect(routeTurn.mock.calls[0][0]).toBe("What is the answer to everything?");
    expect(routeTurn.mock.calls[0][1]).toEqual([{ role: "user", content: "earlier question" }, { role: "assistant", content: "earlier answer" }]);
    // Plan, skill and SOUL reach the one resolution call; the JSON contract stays.
    expect(modelCalls).toHaveLength(1);
    const prompt = modelCalls[0].prompt;
    expect(prompt).toContain("THIS TURN");
    expect(prompt).toContain("This turn is an answer.");
    expect(prompt).not.toMatch(/with your tools|pass_on_question/);
    expect(prompt).toContain("SKILL-KNOW-HOW-42");
    expect(prompt).toContain("WHO YOU ARE");
    expect(prompt.indexOf("THIS TURN")).toBeLessThan(prompt.indexOf("RESOLUTION RULES"));
    await vi.waitFor(() => expect(persist).toHaveBeenCalledTimes(1));
    expect(persist.mock.calls[0][0]).toMatchObject({
      surface: "overlay",
      plan: { route: "answer", source: "jev", skill: "plain-answers" },
      routing: { observed: { route: "answer" }, source: "jev" },
      resolution: { mode: "requires_augment", path: "model" },
    });
  });

  it("gives LIVE answers the same stages, tagged live", async () => {
    modelReply = JSON.stringify({ mode: "requires_augment", rationale: "Answer.", augmentations: [{ kind: "explanation", content: "Cape Town is two hours ahead.", placement: "cursor" }] });
    const routeTurn = vi.fn(async () => jevAnswer());
    const persist = receipts();
    await resolve(manifest("what time is it in cape town", { modality: "voice", intent_author: "model" }), "test-model", "key", undefined, null, [], { persist, routeTurn, sessionId: "live-1", skills: () => [skill] });
    expect(routeTurn).toHaveBeenCalledTimes(1);
    expect(modelCalls[0].prompt).toContain("SKILL-KNOW-HOW-42");
    await vi.waitFor(() => expect(persist).toHaveBeenCalledTimes(1));
    expect(persist.mock.calls[0][0]).toMatchObject({ surface: "live", sessionId: "live:live-1", plan: { route: "answer", skill: "plain-answers" } });
  });

  it("answers when Jev is unsure without waiting on the slow room reading", async () => {
    modelReply = JSON.stringify({ mode: "requires_augment", rationale: "Answer.", augmentations: [{ kind: "explanation", content: "Yes.", placement: "cursor" }] });
    const routeTurn = vi.fn(async (): Promise<FastRouteReading> => ({ route: "clarify", confidence: 0.2, source: "jev", decided: false }));
    const persist = receipts();
    await resolve(manifest("is it worth it?"), "test-model", "key", undefined, null, [], { persist, routeTurn });
    expect(modelCalls[0].prompt).toContain("This turn is an answer.");
    await vi.waitFor(() => expect(persist).toHaveBeenCalledTimes(1));
    expect(persist.mock.calls[0][0]).toMatchObject({ plan: { route: "answer" }, routing: { source: "answer_after_failure", fallbackReason: "room_reading_off_hot_path" } });
  });

  it("holds what George reads to chat's voice", async () => {
    modelReply = JSON.stringify({ mode: "requires_augment", rationale: "Answer.", augmentations: [{ kind: "explanation", content: "Let me check. Captain, the risotto is the one.", placement: "cursor" }] });
    const resolution = await resolve(manifest("what should I cook tonight?"),"test-model", "key", undefined, null, [], { persist: receipts(), routeTurn: async () => jevAnswer() });
    expect(resolution.augmentations?.[0]?.content).toBe("sir, the risotto is the one.");
  });

  it("never inserts a general answer into the focused element", async () => {
    modelReply = JSON.stringify({ mode: "native", rationale: "Answer.", operations: [{ target: "el_01", kind: "insert_text", text: "A monad wraps computations." }] });
    const resolution = await resolve(manifest("What is a monad?"), "test-model", "key", undefined, null, [], { persist: receipts(), routeTurn: async () => jevAnswer() });
    expect(resolution.mode).toBe("requires_augment");
    expect(resolution.operations).toHaveLength(0);
  });
});

describe("native edits keep resolve's own routing", () => {
  it("drafts into the focused element without the chat stages", async () => {
    modelReply = JSON.stringify({ mode: "native", rationale: "Draft.", operations: [{ target: "el_01", kind: "insert_text", text: "Thanks so much. Let me check and come back to you." }] });
    const routeTurn = vi.fn(async () => jevAnswer());
    const resolution = await resolve(manifest("reply saying thanks"), "test-model", "key", undefined, null, [], { persist: receipts(), routeTurn });
    expect(routeTurn).not.toHaveBeenCalled();
    expect(modelCalls[0].prompt).not.toContain("THIS TURN");
    // His own text is typed as written, never scrubbed into Flyd's voice.
    expect(resolution).toMatchObject({ mode: "native", operations: [{ kind: "insert_text", text: "Thanks so much. Let me check and come back to you." }] });
  });

  it("types a deterministic 'type …' without any model or stage call", async () => {
    const routeTurn = vi.fn(async () => jevAnswer());
    const resolution = await resolve(manifest("type see you at six"), undefined, undefined, undefined, null, [], { persist: receipts(), routeTurn });
    expect(resolution).toMatchObject({ mode: "native", operations: [{ kind: "insert_text", text: "see you at six" }] });
    expect(routeTurn).not.toHaveBeenCalled();
    expect(modelCalls).toHaveLength(0);
  });
});

describe("the shared stages", () => {
  it("say the same route without tools on the overlay and LIVE", () => {
    for (const route of ["answer", "clarify", "act", "delegate"] as const) {
      const plan = planTurn({ route, source: "jev" }, ["the date"])!;
      const brief = toollessPlanBrief(plan);
      expect(brief).not.toMatch(/start_coding_task|background_task|pass_on_question|with the tools|with your tools/);
      expect(brief).toContain("- the date");
    }
    const plan = planTurn({ route: "answer", source: "jev" })!;
    expect(turnBriefParts({ plan, skill, fastNote: null, surface: "chat" })[0]).toContain("pass_on_question");
    expect(turnBriefParts({ plan, skill, fastNote: { id: "a1", text: "NOTE-7" }, surface: "overlay" })).toEqual([
      expect.stringContaining("This turn is an answer."),
      expect.stringContaining("SKILL-KNOW-HOW-42"),
      expect.stringContaining("NOTE-7"),
    ]);
  });

  it("prepare a surface turn from Jev's reading alone", async () => {
    const turn = await prepareSurfaceTurn({ surface: "overlay", message: "hi", history: [], sessionId: "overlay:s", routeTurn: async () => jevAnswer(), skills: () => [skill] });
    expect(turn).toMatchObject({ plan: { route: "answer", source: "jev" }, skill: "plain-answers" });
    expect(turn.brief).toContain("SKILL-KNOW-HOW-42");
  });

  it("cut narration and ruled-out phrases the same way chat does", () => {
    expect(finishInFlydsVoice("One moment please sir. It's done.")).toBe("It's done.");
  });
});
