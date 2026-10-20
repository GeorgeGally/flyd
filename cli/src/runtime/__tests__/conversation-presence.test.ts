import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildConversationPrompt, respondToConversation } from "../conversation-responder.js";
import { projectNamed } from "../../council/projects.js";
import { presenceBrief, understandTurn } from "../conversation-presence.js";
import { buildRoomContext } from "../room-context.js";
import { roomBrief, roomPrompt, type RoomRead } from "../read-the-room.js";
import { applyMemoryOps, memoryEntryIsStale } from "../../council/memory-store.js";
import { FlydDesk } from "../../conversation-view/flyd-desk.js";
import { collectSaid } from "../../council/reply-review.js";
import { buildRealtimeInstructions } from "../../realtime-session.js";
import { PreparationStore } from "../preparation-store.js";

afterEach(() => vi.unstubAllEnvs());

describe("conversational presence", () => {
  it("does not execute a tool when interrupted while approval is pending", async () => {
    vi.stubEnv("FLYD_AUTONOMY", "ask");
    const controller = new AbortController();
    const askUser = vi.fn(async () => { controller.abort(); await Promise.resolve(); return true; });
    await expect(respondToConversation({ message: "Create a reminder for tomorrow", history: [], memory: { verdict: "insufficient", matches: [] }, situation: null, signal: controller.signal,
      askUser, onToken: () => {},
    }, {
      readOnly: true,
      routeTurn: async () => ({ route: "act", source: "jev", confidence: 0.99, decided: true, needsCode: false }),
      runAgentLoop: async (_system, _prompt, _tools, handler) => {
        await expect(handler("reminders", { action: "create", title: "Fixture" })).rejects.toMatchObject({ name: "AbortError" });
        return "<final>Never emitted</final>";
      },
    })).rejects.toMatchObject({ name: "AbortError" });
    expect(askUser).toHaveBeenCalledTimes(1);
  });
  it.each(["fast", "room"])("does not accept preparation after interruption during %s reading", async path => {
    const root = mkdtempSync(join(tmpdir(), "flyd-presence-abort-"));
    const store = new PreparationStore({ path: join(root, "state.sqlite") });
    const controller = new AbortController(), run = vi.fn();
    const message = "Keep preparing sponsor drafts";
    const preparation = { kind: "grant" as const, goal: "Sponsor drafts", sourceSpan: message };
    try {
      await expect(respondToConversation({ message, history: [], memory: { verdict: "insufficient", matches: [] }, situation: null,
        sessionId: "abort-fixture", signal: controller.signal, onToken: () => {},
        source: { turnId: "abort-turn", sessionId: "abort-fixture", surface: "view", text: message, revision: 1, final: true, retention: "local_default", consentRef: "conversation:abort-fixture" },
      }, {
        initiative: { store, run },
        routeTurn: async () => { if (path === "room") return null; controller.abort(); return { route: "act", source: "jev", confidence: 0.99, decided: true, needsCode: false, preparation }; },
        readRoom: async () => { controller.abort(); return { need: "do", mode: "companion", route: "act", stance: "Act", avoid: "", length: "short", use: [], raise: null, act: "Record scope", cover: [], preparation }; },
        runAgentLoop: async () => { throw new Error("Interrupted turn reached model"); },
      })).rejects.toMatchObject({ name: "AbortError" });
      expect(store.listRemits("abort-fixture")).toEqual([]);
      expect(run).not.toHaveBeenCalled();
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
  it("names the registered project George's newest words are about", () => {
    const root = mkdtempSync(join(tmpdir(), "flyd-presence-badge-"));
    const path = join(root, "projects.json");
    writeFileSync(path, JSON.stringify({ projects: [{ id: "gnm-good-neighbours-market", name: "GNM (Good Neighbours Market)" }, { id: "atomise", name: "Atomise" }, { id: "flyd", name: "Flyd" }] }));
    vi.stubEnv("FLYD_PROJECTS_PATH", path);
    try {
      expect(projectNamed(["How is Atomise doing?"])).toBe("Atomise");
      expect(projectNamed(["what about the tests?", "How is Atomise doing?"])).toBe("Atomise");
      expect(projectNamed(["Now GNM", "How is Atomise doing?"])).toBe("GNM (Good Neighbours Market)");
      expect(projectNamed(["back to good neighbours market"])).toBe("GNM (Good Neighbours Market)");
      expect(projectNamed(["How is my-repo doing?"])).toBeNull();
      expect(projectNamed(["Compare Atomise and GNM"])).toBeNull();
      expect(projectNamed(["Compare Flyd and Atomise"])).toBe("Atomise");
      expect(projectNamed(["Flyd, what's the weather?"])).toBeNull();
      expect(projectNamed(["hey Flyd what's the weather"])).toBeNull();
      expect(projectNamed(["Flyd, how's GNM going?"])).toBe("GNM (Good Neighbours Market)");
      expect(projectNamed(["Flyd needs a quieter island"])).toBe("Flyd");
      expect(projectNamed(["Long day. I just want to talk."])).toBeNull();
      expect(projectNamed([])).toBeNull();
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
  it("does not invent an emotional reading on the confident fast path", async () => {
    const readRoom = vi.fn(async () => null);
    const understanding = vi.fn();
    let system = "";
    let changed = "";
    await respondToConversation({
      message: "Long day. I just want to talk.", history: [],
      memory: { verdict: "insufficient", matches: [] }, situation: null,
      onToken: () => {}, onUnderstanding: understanding,
    }, {
      readOnly: true,
      routeTurn: async () => ({ route: "answer", source: "jev", confidence: 0.98, decided: true, needsCode: false }),
      readRoom,
      runAgentLoop: async (instructions, _prompt, _tools, handler) => {
        system = instructions;
        changed = await handler("reminders", { action: "create", title: "Take tomorrow off" });
        return "<final>What part of today is still on your mind?</final>";
      },
    });
    expect(readRoom).not.toHaveBeenCalled();
    expect(understanding).toHaveBeenCalledWith(expect.objectContaining({ source: "fast", route: "answer" }));
    expect(understanding.mock.calls[0][0].need).toBeUndefined();
    expect(understanding.mock.calls[0][0].interactionClass).toBeUndefined();
    expect(system).toContain("Conversation can be the whole useful outcome");
    expect(system).not.toContain("Never just comment");
    expect(system).not.toContain("You shipped the Bloom fix");
    expect(changed).toContain("Skipped (not this turn)");
  });

  it("preserves the richer room reading without another routing decision", () => {
    const turn = understandTurn({ route: "answer", need: "think", source: "room", needsCode: true });
    expect(turn.interactionClass).toBe("conversation");
    expect(presenceBrief(turn)).toContain("Need: think");
    expect(presenceBrief(turn)).toContain("not permission to act");
    expect(understandTurn({ route: "delegate", source: "fast" }).interactionClass).toBe("work_status");
    expect(understandTurn({ route: "answer", need: "decide", source: "room" }).interactionClass).toBe("decision");
  });

  it("has an independent voice rollback without restoring automatic profile writes", () => {
    vi.stubEnv("FLYD_CONVERSATIONAL_PRESENCE", "0");
    const p = buildConversationPrompt({ message: "Long day", history: [], memory: { verdict: "insufficient", matches: [] }, situation: null });
    expect(p.system).toContain("## How you talk (this outranks every operating rule below)");
    expect(p.system).not.toContain("Conversation can be the whole useful outcome");
    expect(buildRealtimeInstructions()).not.toContain("Conversation can be the whole useful outcome");
    vi.stubEnv("FLYD_CONVERSATIONAL_PRESENCE", "1");
    expect(buildRealtimeInstructions()).toContain("Conversation can be the whole useful outcome");
    expect(buildRealtimeInstructions()).toContain("not execution receipts");
  });

  it("keeps dated memory and inferred authority through context selection", () => {
    const context = buildRoomContext({
      profile: null, now: new Date("2026-10-16T08:00:00Z"),
      memory: [
        { id: "old", section: "Lately", text: "Exhausted after launch.", tier: "perishable", date: "2026-09-01" },
        { id: "now", section: "Lately", text: "Making a new record.", tier: "perishable", date: "2026-10-15" },
      ],
      retrieved: [{ excerpt: "Sponsor declined.", authority: "assistant_output" }, { excerpt: "George prefers green.", authority: "inferred", path: "event:42", stale: true }],
    });
    expect(context.core).toContain("Lately: Making a new record.");
    expect(context.core).not.toContain("Exhausted");
    expect(context.knowledge.find(item => item.text.includes("Exhausted"))).toMatchObject({ stale: true, observedAt: "2026-09-01", sourceRef: "MEMORY.md:old" });
    expect(context.knowledge.some(item => item.text.includes("Sponsor declined"))).toBe(false);
    const item = context.knowledge.find(item => item.text.includes("prefers green"))!;
    const brief = roomBrief({ need: "ask", mode: "companion", route: "answer", stance: "Use the relevant preference.", avoid: "", length: "short", use: [item.id], raise: null, act: null, cover: [] }, context.knowledge, []);
    expect(brief).toContain("inferred");
    expect(brief).toContain("possibly stale");
    expect(brief).toContain("event:42");
  });

  it("retains descriptive context through view persistence and review, without another store", async () => {
    const root = mkdtempSync(join(tmpdir(), "flyd-presence-view-"));
    try {
      const dir = join(root, "view", "asks");
      const turn = understandTurn({ need: "vent", route: "answer", source: "room" });
      const desk = new FlydDesk({ dir, answer: async (_question, _history, _step, context) => {
        expect(context?.source.turnId).toBeTruthy();
        context?.onUnderstanding(turn);
        return "That last-minute change sounds frustrating.";
      } });
      desk.ask("I just wanted to talk about today.");
      await vi.waitFor(() => expect(desk.exchanges()[0]?.answer?.text).toContain("last-minute change"));
      const saved = JSON.parse(readFileSync(join(dir, readdirSync(dir).find(name => name.endsWith(".json"))!), "utf8"));
      expect(saved.understanding).toEqual(turn);
      expect(collectSaid({ flydDir: root, dir: join(root, "review"), since: "2000-01-01T00:00:00Z" })).toEqual(expect.arrayContaining([expect.objectContaining({ interactionClass: "conversation", toolsUnknown: true })]));
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it("preserves stale memory on both fast and fallback answer paths", async () => {
    const root = mkdtempSync(join(tmpdir(), "flyd-presence-context-"));
    vi.stubEnv("FLYD_MEMORY_DIR", root);
    try {
      applyMemoryOps([{ op: "add", section: "Lately", text: "Exhausted after launch.", tier: "perishable", sources: ["j:fixture"] }], { now: new Date("2020-01-01T12:00:00Z") });
      for (const fast of [true, false]) {
        let payload = "";
        await respondToConversation({ message: "Long day. Just venting.", history: [], memory: { verdict: "insufficient", matches: [] }, situation: null, onToken: () => {} }, {
          readOnly: true,
          routeTurn: async () => fast ? { route: "answer", source: "jev", confidence: 0.99, decided: true, needsCode: false } : null,
          readRoom: async input => ({ need: "vent", mode: "companion", route: "answer", stance: "Listen", avoid: "Tasks", length: "short", use: input.knowledge.map(k => k.id), raise: null, act: null, cover: [] } as RoomRead),
          runAgentLoop: async (system, prompt) => { payload = system + prompt; return "<final>What happened?</final>"; },
        });
        expect(payload).toContain("Exhausted after launch.");
        expect(payload).toContain("2020-01-01");
        expect(payload).toContain("possibly stale");
        expect(payload).toContain("curated_memory");
        expect(payload).toContain("MEMORY.md:");
      }
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it("keeps failed outcomes and provenance even when long text is clipped", () => {
    const context = buildRoomContext({ profile: null, memory: [], retrieved: [{ excerpt: "A".repeat(1000), path: "event:77", authority: "inferred", outcome: "failed", updatedAt: "2026-10-01", stale: true }] });
    const prompt = roomPrompt({ message: "How did it go?", now: new Date(), history: [], core: "", knowledge: context.knowledge, notes: [] });
    for (const label of ["event:77", "failed", "inferred", "2026-10-01", "possibly stale"]) expect(prompt).toContain(label);
    const boundary = new Date(2026, 9, 16, 0, 1);
    expect(memoryEntryIsStale({ date: "2026-10-09", tier: "perishable" }, boundary)).toBe(true);
    expect(memoryEntryIsStale({ date: "2026-10-10", tier: "perishable" }, boundary)).toBe(false);
    expect(memoryEntryIsStale({ date: "2026-09-16", tier: "aging" }, boundary)).toBe(true);
    expect(memoryEntryIsStale({}, boundary)).toBe(true);
  });

  it("preserves multiple core memories in each personal section", () => {
    const memory = ["Who he is", "People", "Lately"].flatMap(section => ["First complete observation", "Second complete observation"].map((text, i) => ({ id: section + i, section, text: `${section}: ${text}`, date: "2026-10-15", tier: "perishable" as const })));
    const { core } = buildRoomContext({ profile: null, memory, retrieved: [], now: new Date("2026-10-16T12:00:00Z") });
    for (const entry of memory) expect(core).toContain(entry.text);
  });
});
