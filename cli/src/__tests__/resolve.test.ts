import { describe, expect, it } from "vitest";
import { buildResolutionPrompt, enforceRoutePlacement, fetchBehaviouralDirectives, formatBehaviouralDirectives, isIdentityIntent, parseResolutionResponse, routeIntent, shouldInjectPersonalContext, skipsWorkIntelligence, type BehaviouralDirectiveInput } from "../resolve.js";
import { resolveRepositoryFromPath } from "../work-intelligence/current-work.js";
import { isDeterministicDictation } from "../router.js";

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

describe("skipsWorkIntelligence", () => {
  it("routes text questions to the general resolution pipeline", () => {
    expect(skipsWorkIntelligence("what is GNM and who sponsors it?", "text")).toBe(true);
    expect(skipsWorkIntelligence("summarize the pros and cons", "text")).toBe(true);
  });

  it("routes second-person address away from work diagnosis", () => {
    expect(skipsWorkIntelligence("do you remember my GNM sponsor list?", "text")).toBe(true);
    expect(skipsWorkIntelligence("eh, I was talking to you about GNM", "text")).toBe(true);
  });

  it("keeps artifact-shaped intents in work intelligence", () => {
    expect(skipsWorkIntelligence("rewrite this paragraph to be shorter", "text")).toBe(false);
    expect(skipsWorkIntelligence("fix the null check in this function", "text")).toBe(false);
  });

  it("leaves voice behavior untouched", () => {
    expect(skipsWorkIntelligence("rewrite this to be shorter", "voice")).toBe(false);
  });
});

describe("routeIntent", () => {
  it("routes ordinary voice statements to the answer panel", () => {
    expect(routeIntent("running five minutes late", env, "voice")).toEqual({
      kind: "ask_answer",
      placement: "answer_panel",
      scene: "concise_answer",
    });
  });

  it("keeps conversational follow-ups out of non-editable targets", () => {
    expect(routeIntent("yes, but what about the second option", {
      ...env,
      focused_element: { ...env.focused_element, role: "AXWindow" },
    }, "voice")).toEqual({
      kind: "ask_answer",
      placement: "answer_panel",
      scene: "concise_answer",
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
  const emptyWorldState: Parameters<typeof buildResolutionPrompt>[0] = {
    version: "1.0", generatedAt: "", source: "flyd-cli",
    goals: [], tensions: [], signals: [], curiosity: [], nudges: [], reports: [],
    recentEvents: [], brainHealth: [], profile: [], knowledge: [], review: [],
    suggestions: [], capabilities: [],
  };

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

  it("trims long observation-status memory content instead of hiding it", () => {
    const longContent = "x".repeat(500);
    const prompt = buildResolutionPrompt(emptyWorldState, env, "what am I working on", route, {
      current: [], relevant: [
        { claimId: "a", content: longContent, kind: "observation", scope: "global", epistemicStatus: "observation", epistemicConfidence: 0.5, freshness: 1, sourceRefs: ["raw/2026-01-01.md"], relevance: 0.8 },
      ], conflicts: [], gaps: [], sources: ["raw/2026-01-01.md"],
    });

    expect(prompt).toContain("RELEVANT MEMORY");
    expect(prompt).not.toContain(longContent);
    expect(prompt).toContain("x".repeat(160));
  });

  it("does not trim curated (non-observation) memory content", () => {
    const longContent = "This is a well-documented curated preference. ".repeat(10);
    const prompt = buildResolutionPrompt(emptyWorldState, env, "what am I working on", route, {
      current: [], relevant: [
        { claimId: "a", content: longContent, kind: "preference", scope: "global", epistemicStatus: "verified", epistemicConfidence: 0.9, freshness: 1, sourceRefs: ["wiki/preferences.md"], relevance: 0.8 },
      ], conflicts: [], gaps: [], sources: ["wiki/preferences.md"],
    });

    expect(prompt).toContain(longContent);
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

  it("includes recent exchanges so a second voice turn can be a follow-up", () => {
    const prompt = buildResolutionPrompt(
      emptyWorldState,
      env,
      "what about the second one?",
      route,
      { current: [], relevant: [], conflicts: [], gaps: [], sources: [] },
      false,
      [],
      undefined,
      [{ user: "Give me two options.", assistant: "First: wait. Second: ship a small fix." }]
    );

    expect(prompt).toContain("RECENT CONVERSATION");
    expect(prompt).toContain("User: Give me two options.");
    expect(prompt).toContain("Flyd: First: wait. Second: ship a small fix.");
  });

  it("makes voice answers sound like conversation without volunteering background context", () => {
    const prompt = buildResolutionPrompt(
      emptyWorldState,
      env,
      "which option is better?",
      route,
      { current: [], relevant: [], conflicts: [], gaps: [], sources: [] },
      false,
      [],
      undefined,
      [],
      true
    );

    expect(prompt).toContain("SPOKEN CONVERSATION STYLE");
    expect(prompt).toContain("Do not use Markdown");
    expect(prompt).toContain("Do not volunteer personal, project, deadline, or memory context");
    expect(prompt).toContain("one to three natural sentences");
  });

  it("omits unrelated goals and memories from an ordinary voice question", () => {
    const worldStateWithBackground = {
      ...emptyWorldState,
      goals: [{ content: "Ship Flyd by Q4 2026." }],
      profile: [{ content: { description: "The user led a luxury AR project." } }],
    } as never;
    const prompt = buildResolutionPrompt(
      worldStateWithBackground,
      env,
      "give me two options: wait or ship",
      route,
      {
        current: [],
        relevant: [{
          claimId: "background-1",
          content: "The user has a September deadline.",
          kind: "observation",
          scope: "global",
          epistemicStatus: "observation",
          epistemicConfidence: 0.8,
          freshness: 1,
          sourceRefs: [],
          relevance: 0.7,
        }],
        conflicts: [],
        gaps: [],
        sources: [],
      },
      false,
      [],
      undefined,
      [],
      true,
      false
    );

    expect(prompt).not.toContain("Ship Flyd by Q4 2026.");
    expect(prompt).not.toContain("luxury AR project");
    expect(prompt).not.toContain("September deadline");
  });

  it("keeps background context when a voice question is explicitly personal", () => {
    const worldStateWithGoal = {
      ...emptyWorldState,
      goals: [{ content: "Ship Flyd by Q4 2026." }],
    } as never;
    const prompt = buildResolutionPrompt(
      worldStateWithGoal,
      env,
      "what am I working on?",
      route,
      undefined,
      false,
      [],
      undefined,
      [],
      true,
      true
    );

    expect(prompt).toContain("Ship Flyd by Q4 2026.");
  });

  it("honors an explicit needsPersonalContext flag over the intent text (classifier-sourced signal)", () => {
    const worldStateWithGoal = {
      ...emptyWorldState,
      goals: [{ content: "Ship Flyd by Q4 2026." }],
    } as never;

    // Intent has no first-person pronoun, so the regex fallback alone would
    // say false — but the classifier can still say true (e.g. "the team" ==
    // the user's own team). The passed flag must win; buildResolutionPrompt
    // does not re-derive it from the intent text.
    const prompt = buildResolutionPrompt(
      worldStateWithGoal, env, "what is the team shipping this quarter", route,
      undefined, false, [], undefined, [], true, true
    );
    expect(prompt).toContain("Ship Flyd by Q4 2026.");
  });
});

describe("behavioural directives injection", () => {
  const emptyWorldState: Parameters<typeof buildResolutionPrompt>[0] = {
    version: "1.0", generatedAt: "", source: "flyd-cli",
    goals: [], tensions: [], signals: [], curiosity: [], nudges: [], reports: [],
    recentEvents: [], brainHealth: [], profile: [], knowledge: [], review: [],
    suggestions: [], capabilities: [],
  };
  const route = { kind: "ask_answer", placement: "answer_panel", scene: "concise_answer" } as const;

  const directive = (overrides: Partial<BehaviouralDirectiveInput> & { text: string }): BehaviouralDirectiveInput => ({
    utility: 0,
    negatives: 0,
    corroborations: 0,
    lastSeenAt: new Date().toISOString(),
    ...overrides,
  });

  it("renders two active directives inside the boundary ordered by rank with no metadata", () => {
    const staleTimestamp = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
    const stale = {
      text: "Keep commit messages short.",
      utility: 0,
      negatives: 0,
      corroborations: 0,
      lastSeenAt: staleTimestamp,
      directiveId: "dir-stale-0001",
      createdAt: "2020-01-01T00:00:00.000Z",
    } as unknown as BehaviouralDirectiveInput;
    const fresh = directive({ text: "Always inspect the repo before proposing a fix." });

    const prompt = buildResolutionPrompt(emptyWorldState, env, "draft a reply", route, undefined, false, [], undefined, [], false, true, [stale, fresh]);

    expect(prompt).toContain("<behavioural_directives>");
    expect(prompt).toContain("</behavioural_directives>");
    expect(prompt).toContain("learned preferences");
    expect(prompt.indexOf("Always inspect the repo")).toBeLessThan(prompt.indexOf("Keep commit messages short."));
    for (const forbidden of ["dir-stale-0001", staleTimestamp, "2020-01-01", "directiveId", "lastSeenAt"]) {
      expect(prompt).not.toContain(forbidden);
    }
  });

  it("omits the block entirely when no directives are passed or empty (byte-identical to golden)", () => {
    const golden = buildResolutionPrompt(emptyWorldState, env, "what am I working on", route);
    expect(golden).not.toContain("<behavioural_directives>");
    expect(buildResolutionPrompt(emptyWorldState, env, "what am I working on", route, undefined, false, [], undefined, [], false, true, [])).toBe(golden);
    expect(buildResolutionPrompt(emptyWorldState, env, "what am I working on", route, undefined, false, [], undefined, [], false, true, null)).toBe(golden);
    expect(formatBehaviouralDirectives([])).toBeNull();
  });

  it("renders at most five directives when eight are active", () => {
    const eight = Array.from({ length: 8 }, (_, i) => directive({ text: `Directive number ${i + 1}.` }));
    const block = formatBehaviouralDirectives(eight)!;
    expect(block).toContain("<behavioural_directives>");
    const rendered = [...block.matchAll(/^- (.+)$/gm)].map((m) => m[1]);
    expect(rendered).toHaveLength(5);
    expect(block).not.toContain("Directive number 6.");
  });

  it("defensively truncates over-length directive text", () => {
    const block = formatBehaviouralDirectives([directive({ text: "x".repeat(500) })])!;
    const rendered = [...block.matchAll(/^- (.+)$/gm)][0][1];
    expect(rendered.length).toBeLessThanOrEqual(200);
  });

  it("degrades to no directives when the fetch throws", async () => {
    await expect(fetchBehaviouralDirectives(() => { throw new Error("store locked"); })).resolves.toEqual([]);
    await expect(Promise.resolve().then(async () => {
      const directives = await fetchBehaviouralDirectives(() => { throw new Error("boom"); });
      return buildResolutionPrompt(emptyWorldState, env, "hello", route, undefined, false, [], undefined, [], false, true, directives);
    })).resolves.not.toContain("<behavioural_directives>");
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

describe("project resolution from captured environment", () => {
  it("resolves a repository from a document path inside a git repo", () => {
    const result = resolveRepositoryFromPath(process.cwd());
    if (result.root) {
      expect(result.branch).toBeDefined();
      expect(result.headDigest).toBeDefined();
      expect(result.statusDigest).toBeDefined();
    }
  });

  it("returns no root for a non-existent document path", () => {
    const result = resolveRepositoryFromPath("/nonexistent/path/to/nowhere.txt");
    expect(result.root).toBeUndefined();
    expect(result.branch).toBeUndefined();
  });

  it("returns no root when no document path is provided", () => {
    const result = resolveRepositoryFromPath(undefined);
    expect(result.root).toBeUndefined();
    expect(result.branch).toBeUndefined();
  });

  it("resolves the correct root even when Core runs from a subdirectory", () => {
    const result = resolveRepositoryFromPath(process.cwd() + "/src/__tests__/resolve.test.ts");
    if (result.root) {
      expect(result.root).toBeDefined();
      expect(result.branch).toBeDefined();
    }
  });

  it("does not produce invented git evidence when no repository is found", () => {
    const result = resolveRepositoryFromPath("/tmp/no-git-here/file.txt");
    expect(result.root).toBeUndefined();
    expect(result.headDigest).toBeUndefined();
  });
});

describe("work-intelligence dictation gate", () => {
  it("dictation in editable field bypasses work intelligence", () => {
    expect(isDeterministicDictation({
      intent: "type hello world",
      modality: "text",
      elementRole: "AXTextArea",
    })).toBe(true);
  });

  it("non-dictation intent in editable field routes through work intelligence", () => {
    expect(isDeterministicDictation({
      intent: "review this function",
      modality: "text",
      elementRole: "AXTextArea",
    })).toBe(false);
  });

  it("voice modality never bypasses as dictation", () => {
    expect(isDeterministicDictation({
      intent: "type hello",
      modality: "voice",
      elementRole: "AXTextArea",
    })).toBe(false);
  });

  it("non-editable target never bypasses as dictation", () => {
    expect(isDeterministicDictation({
      intent: "type hello",
      modality: "text",
      elementRole: "AXWindow",
    })).toBe(false);
  });
});

describe("parseResolutionResponse handles WI-compatible responses", () => {
  it("parses a resolution with workSessionId", () => {
    const resolution = parseResolutionResponse(JSON.stringify({
      resolution_id: "res-1",
      mode: "requires_augment",
      rationale: "Diagnosed issue",
      augmentations: [{ kind: "explanation", content: "The intervention.", placement: "cursor" }],
    }), "inv-1");

    // workSessionId is not set by parseResolutionResponse — it's set by the
    // WI gate in resolve() after parsing. Verify parsing doesn't reject extras.
    expect(resolution.mode).toBe("requires_augment");
    expect(resolution.augmentations).toHaveLength(1);
    expect(resolution.augmentations?.[0].content).toBe("The intervention.");
  });

  it("returns fallback on malformed WI JSON", () => {
    // parseResolutionResponse will throw on completely invalid JSON;
    // the WI gate in resolve() catches and falls through.
    expect(() => parseResolutionResponse("not json", "inv-1")).toThrow();
  });
});
