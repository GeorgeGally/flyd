import { describe, expect, it } from "vitest";
import { buildResolutionPrompt, enforceRoutePlacement, isIdentityIntent, parseResolutionResponse, routeIntent, shouldInjectPersonalContext } from "../resolve.js";

const env = {
  application: {
    bundle_id: "com.apple.mail",
    name: "Mail",
  },
  window: {
    title: "Inbox",
    ref: "win_01",
  },
  focused_element: {
    ref: "el_01",
    role: "AXTextArea",
    description: "Message body",
    value: "",
    placeholder: "",
    selected_text: "",
  },
  selection: "",
  sufficiency: "semantic" as const,
};

describe("parseResolutionResponse", () => {
  it("accepts camelCase compose rationale from the model prompt", () => {
    const resolution = parseResolutionResponse(JSON.stringify({
      resolution_id: "res-1",
      mode: "requires_compose",
      rationale: "Needs a surface.",
      composeRationale: "This needs more room.",
    }), "inv-1");

    expect(resolution.composeRationale).toBe("This needs more room.");
  });

  it("normalizes info_card augmentations into the adapter contract", () => {
    const resolution = parseResolutionResponse(JSON.stringify({
      resolution_id: "res-1",
      mode: "requires_augment",
      rationale: "Answer at cursor.",
      augmentations: [{
        type: "info_card",
        title: "Answer",
        content: "Use this reply.",
      }],
    }), "inv-1");

    expect(resolution.augmentations).toEqual([{
      kind: "explanation",
      content: "Use this reply.",
      placement: "cursor",
    }]);
  });

  it("clamps augment options to a max of 4", () => {
    const resolution = parseResolutionResponse(JSON.stringify({
      resolution_id: "res-1",
      mode: "requires_augment",
      rationale: "Offer font choices.",
      augmentations: [{
        kind: "choice",
        content: "Pick a font.",
        options: ["Inter", "Helvetica", "Georgia", "Courier", "Futura", "Garamond"],
      }],
    }), "inv-1");

    expect(resolution.augmentations?.[0]?.options).toEqual(["Inter", "Helvetica", "Georgia", "Courier"]);
  });
});

describe("routeIntent", () => {
  it("routes plain voice dictation to focused-field insertion", () => {
    expect(routeIntent("running five minutes late", env, "voice")).toEqual({
      kind: "dictate_insert",
      placement: "insert_at_cursor",
      scene: "clean_dictation",
    });
  });

  it("routes reply and draft intents to insertion", () => {
    expect(routeIntent("reply saying I can do Thursday", env, "voice")).toMatchObject({
      kind: "draft_insert",
      placement: "insert_at_cursor",
      scene: "email_reply",
    });
  });

  it("routes general questions to an answer panel instead of insertion", () => {
    expect(routeIntent("what is the difference between Flyd and Clicky?", env, "voice")).toEqual({
      kind: "ask_answer",
      placement: "answer_panel",
      scene: "concise_answer",
    });
  });

  it("routes answer-style commands to an answer panel instead of insertion", () => {
    for (const intent of [
      "tell me what this email means",
      "explain this error",
      "show me the main point",
      "search for related notes",
      "find the sender's last request",
      "look up the company",
      "summarize this page",
      "analyze this thread",
      "describe this screen",
    ]) {
      expect(routeIntent(intent, env, "voice")).toMatchObject({
        kind: "ask_answer",
        placement: "answer_panel",
        scene: "concise_answer",
      });
    }
  });

  it("does not expose translate as a special route", () => {
    expect(routeIntent("translate this to Spanish", env, "voice")).toMatchObject({
      kind: "draft_insert",
      placement: "insert_at_cursor",
    });
  });
});

describe("enforceRoutePlacement", () => {
  it("turns accidental native answers into an answer panel", () => {
    const resolution = parseResolutionResponse(JSON.stringify({
      resolution_id: "res-1",
      mode: "native",
      rationale: "Answer question.",
      operations: [{ target: "el_01", kind: "insert_text", text: "Flyd is the overlay." }],
    }), "inv-1");

    const enforced = enforceRoutePlacement(resolution, {
      kind: "ask_answer",
      placement: "answer_panel",
      scene: "concise_answer",
    });

    expect(enforced.mode).toBe("requires_augment");
    expect(enforced.operations).toEqual([]);
    expect(enforced.augmentations).toEqual([{
      kind: "explanation",
      content: "Flyd is the overlay.",
      placement: "cursor",
    }]);
  });

  it("turns accidental augment drafts into focused-field insertion", () => {
    const resolution = parseResolutionResponse(JSON.stringify({
      resolution_id: "res-1",
      mode: "requires_augment",
      rationale: "Draft reply.",
      augmentations: [{ kind: "explanation", content: "Thursday works for me.", placement: "cursor" }],
    }), "inv-1");

    const enforced = enforceRoutePlacement(resolution, {
      kind: "draft_insert",
      placement: "insert_at_cursor",
      scene: "email_reply",
    });

    expect(enforced.mode).toBe("native");
    expect(enforced.augmentations).toEqual([]);
    expect(enforced.operations).toEqual([{
      target: "el_01",
      kind: "insert_text",
      text: "Thursday works for me.",
    }]);
  });
});

describe("buildResolutionPrompt", () => {
  const emptyWorldState = {
    version: "1.0", generatedAt: "", source: "flyd-cli",
    goals: [], tensions: [], signals: [], curiosity: [], nudges: [], reports: [],
    recentEvents: [], brainHealth: [], profile: [], knowledge: [], review: [],
    suggestions: [], capabilities: [],
  } as never;

  const route = { kind: "ask_answer", placement: "answer_panel", scene: "concise_answer" } as const;

  it("injects retrieved memories as a MEMORIES block", () => {
    const prompt = buildResolutionPrompt(emptyWorldState, env, "what am I working on", route, {
      current: [], relevant: [
        { claimId: "a", content: "User is building flyd, a personal memory overlay.", kind: "observation", scope: "global", epistemicStatus: "observation", epistemicConfidence: 0.5, freshness: 1, sourceRefs: ["raw/2026-01-01.md"], relevance: 0.8 },
      ], conflicts: [], gaps: [], sources: ["raw/2026-01-01.md"],
    });

    expect(prompt).toContain("RELEVANT MEMORY");
    expect(prompt).toContain("User is building flyd, a personal memory overlay.");
    expect(prompt).not.toContain("raw/2026-01-01.md");
  });

  it("omits the memories block when nothing was retrieved", () => {
    const prompt = buildResolutionPrompt(emptyWorldState, env, "what am I working on", route);
    expect(prompt).not.toContain("RELEVANT MEMORY");
  });

  it("describes the screen image and forbids blindness narration when a screenshot is attached", () => {
    const prompt = buildResolutionPrompt(emptyWorldState, env, "what am I working on", route, { current: [], relevant: [], conflicts: [], gaps: [], sources: [] }, true);
    expect(prompt).toContain("SCREEN:");
    expect(prompt).toContain("NEVER narrate your own context visibility");
  });

  it("still forbids blindness narration without a screenshot", () => {
    const prompt = buildResolutionPrompt(emptyWorldState, env, "what am I working on", route);
    expect(prompt).not.toContain("SCREEN:");
    expect(prompt).toContain("NEVER narrate your own context visibility");
  });

  it("injects compiled personal context bundles for identity questions", () => {
    const prompt = buildResolutionPrompt(emptyWorldState, env, "what do you know about me", route, { current: [], relevant: [], conflicts: [], gaps: [], sources: [] }, false, [
      { name: "current_identity", body: "George is a creative technologist." },
    ]);

    expect(prompt).toContain("PERSONAL CONTEXT");
    expect(prompt).toContain("George is a creative technologist.");
    expect(prompt).not.toContain("current_identity");
  });

  it("tells the model memory exists but matched nothing when retrieval and bundles are both empty", () => {
    const prompt = buildResolutionPrompt(emptyWorldState, env, "what do you know about me", route);
    expect(prompt).toContain("MEMORY STATUS");
    expect(prompt).toContain("NEVER claim you lack access");
  });

  it("omits the memory status block when a memory was retrieved", () => {
    const prompt = buildResolutionPrompt(emptyWorldState, env, "what am I working on", route, {
      current: [], relevant: [
        { claimId: "a", content: "User is building flyd.", kind: "observation", scope: "global", epistemicStatus: "observation", epistemicConfidence: 0.5, freshness: 1, sourceRefs: ["raw/2026-01-01.md"], relevance: 0.8 },
      ], conflicts: [], gaps: [], sources: ["raw/2026-01-01.md"],
    });
    expect(prompt).not.toContain("MEMORY STATUS");
  });

  it("omits the memory status block when personal context bundles are present", () => {
    const prompt = buildResolutionPrompt(emptyWorldState, env, "who am I", route, { current: [], relevant: [], conflicts: [], gaps: [], sources: [] }, false, [
      { name: "current_identity", body: "George." },
    ]);
    expect(prompt).not.toContain("MEMORY STATUS");
  });
});

describe("isIdentityIntent", () => {
  it("detects questions about the user themselves", () => {
    for (const intent of [
      "who am I",
      "what do you know about me",
      "tell me about myself",
      "what's my background",
      "what do you remember about me",
      "do you know me",
      "tell me something about me",
      "what's in my memories",
    ]) {
      expect(isIdentityIntent(intent), intent).toBe(true);
    }
  });

  it("ignores intents that merely mention people or topics", () => {
    for (const intent of [
      "tell me about deno",
      "reply saying I can do Thursday",
      "what is the difference between Flyd and Clicky?",
      "summarize this thread",
      "translate this to Spanish",
    ]) {
      expect(isIdentityIntent(intent), intent).toBe(false);
    }
  });
});

describe("shouldInjectPersonalContext", () => {
  const askRoute = { kind: "ask_answer", placement: "answer_panel", scene: "concise_answer" } as const;
  const draftRoute = { kind: "draft_insert", placement: "insert_at_cursor", scene: "email_reply" } as const;

  it("injects for recall questions referencing the user's own life", () => {
    for (const intent of [
      "what am I doing on wednesday?",
      "what is that project I was working on last year?",
      "when is my next deadline",
      "what did we decide about the overlay?",
    ]) {
      expect(shouldInjectPersonalContext(intent, askRoute), intent).toBe(true);
    }
  });

  it("skips impersonal questions", () => {
    for (const intent of [
      "what is the difference between Flyd and Clicky?",
      "explain this error",
      "how does ring attention work",
    ]) {
      expect(shouldInjectPersonalContext(intent, askRoute), intent).toBe(false);
    }
  });

  it("skips drafts even when they mention the user", () => {
    expect(shouldInjectPersonalContext("reply saying I can do Thursday", draftRoute)).toBe(false);
  });

  it("still injects for identity intents on any route", () => {
    expect(shouldInjectPersonalContext("write my bio", draftRoute)).toBe(true);
  });
});
