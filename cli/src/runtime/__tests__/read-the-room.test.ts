import { describe, expect, it, vi } from "vitest";
import { parseRoom, readTheRoom, roomBrief, roomPrompt } from "../read-the-room.js";
import { buildRoomContext } from "../room-context.js";
import { buildConversationPrompt } from "../conversation-responder.js";

const profile = [
  "## About me", "- George is an artist and creative technologist in Cape Town.",
  "## How to be with me", "- Talk like a friend, not a project manager.",
  "## Work", "- Senior Creative Technologist at Cartier's innovation lab, 2018-2020.", "- Webby winner and first digital Loerie Grand Prix winner.",
  "## Goals", "- Get DIR heard by real listeners.",
].join("\n");

describe("room context", () => {
  it("carries who George is always, and his CV only as selectable knowledge", () => {
    const { core, knowledge } = buildRoomContext({
      profile,
      now: new Date("2026-10-16T08:00:00Z"),
      memory: [{ id: "x", section: "Lately", text: "Tired after a rough launch week.", date: "2026-10-15", tier: "perishable" }, { id: "y", section: "Projects", text: "DIR is an AI radio station." }],
      retrieved: [{ excerpt: "DIR sets live in mixes/." }],
    });
    expect(core).toContain("Talk like a friend");
    expect(core).toContain("Lately: Tired after a rough launch week.");
    expect(core).not.toContain("Cartier");
    expect(knowledge.map((item) => item.text)).toEqual([
      "Senior Creative Technologist at Cartier's innovation lab, 2018-2020.",
      "Webby winner and first digital Loerie Grand Prix winner.",
      "Get DIR heard by real listeners.",
      "DIR is an AI radio station. (projects)",
      "DIR sets live in mixes/.",
    ]);
  });
});

describe("reading the room", () => {
  const knowledge = [{ id: "u1", text: "Webby winner." }, { id: "u3", text: "Get DIR heard by real listeners." }];
  const notes = [{ id: "a1", text: "PostTraction scoping risk." }];

  it("keeps only ids it was shown and defaults to silence on notes", () => {
    const room = parseRoom('{"need":"vent","mode":"companion","stance":"Hear him out.","avoid":"reciting awards","length":"short","use":["u3","u9"],"raise":"zz"}', { knowledge, notes });
    expect(room).toEqual({ need: "vent", mode: "companion", stance: "Hear him out.", avoid: "reciting awards", length: "short", use: ["u3"], raise: null, act: null, route: "answer", cover: [] });
  });

  it("commits to a route and what the reply must cover, clarifying an invalid action route", () => {
    const planned = parseRoom('{"need":"ask","mode":"companion","route":"answer","cover":["tomorrow\'s calendar","the GNM loose end",""],"stance":"Brief him."}', { knowledge, notes });
    expect(planned).toMatchObject({ route: "answer", cover: ["tomorrow's calendar", "the GNM loose end"] });
    expect(parseRoom('{"need":"do","stance":"Do it."}', { knowledge, notes })!.route).toBe("clarify");
    expect(parseRoom('{"need":"do","route":"yolo","stance":"Do it."}', { knowledge, notes })!.route).toBe("clarify");
    expect(parseRoom('{"need":"vent","stance":"Listen."}', { knowledge, notes })!.route).toBe("answer");
  });

  it("returns null rather than guessing when the reply is unusable or slow", async () => {
    expect(parseRoom("no idea", { knowledge, notes })).toBeNull();
    const never = vi.fn(() => new Promise<string>(() => undefined));
    expect(await readTheRoom({ message: "hi", history: [], now: new Date(), core: "", knowledge, notes }, never, 10)).toBeNull();
  });

  it("asks what he needs, not just what he said", () => {
    const prompt = roomPrompt({ message: "DIR feels dead", history: [], now: new Date(), core: "Artist.", knowledge, notes });
    expect(prompt).toContain("vent (wants to be heard)");
    expect(prompt).toContain("Knowing is not a reason to mention");
  });

  it("keeps uncertainty distinct from unclear intent, with a rollback to the old rubric", () => {
    const input = { message: "make a draft", history: [], now: new Date(), core: "Artist.", knowledge, notes };
    try {
      vi.stubEnv("FLYD_OPTIMISTIC_DECISIONS", "1");
      expect(roomPrompt(input)).toContain("Missing optional details alone do not make a clear request ambiguous");
      expect(roomPrompt(input)).not.toContain("When in doubt between answer and act");
      vi.stubEnv("FLYD_OPTIMISTIC_DECISIONS", "0");
      expect(roomPrompt(input)).toContain("When in doubt between answer and act");
      expect(roomPrompt(input)).not.toContain("## Judgment");
    } finally { vi.unstubAllEnvs(); }
  });

  it("adds choice guidance only to think/decide without changing the route or authority", () => {
    const make = (need: string) => parseRoom(JSON.stringify({ need, route: "answer", stance: "Choose a direction." }), { knowledge, notes })!;
    const room = make("decide");
    expect(roomBrief(room, knowledge, notes)).toContain("For this choice:");
    expect(room.route).toBe("answer");
    expect(roomBrief(make("vent"), knowledge, notes)).not.toContain("For this choice:");
  });

  it("puts only selected knowledge in front of the answer", () => {
    const room = parseRoom('{"need":"vent","mode":"companion","stance":"Hear him out.","avoid":"reciting awards","length":"short","use":["u3"],"raise":null}', { knowledge, notes })!;
    const brief = roomBrief(room, knowledge, notes);
    const { system, prompt } = buildConversationPrompt({
      message: "DIR feels dead", history: [], memory: { verdict: "sufficient", matches: [{ excerpt: "Webby winner.", path: "x", authority: "user_confirmed" } as never] },
      situation: null, crossRepo: [],
    }, undefined, { projectTurn: false, room: { core: "Artist in Cape Town.", brief } });
    expect(system).toContain("Get DIR heard by real listeners.");
    expect(system).toContain("Avoid: reciting awards");
    expect(`${system}\n${prompt}`).not.toContain("Webby");
  });
});

it("does not cut explicit constraints when profile context is large", () => {
  const constraint = "Never share this private information without asking.";
  const { core } = buildRoomContext({ profile: `## About me\n- ${"Long identity. ".repeat(400)}\n## Constraints\n- ${constraint}`, memory: [], retrieved: [] });
  expect(core).toContain(constraint);
});


it("retains identity even when protected instructions exceed the core budget", () => {
  const { core } = buildRoomContext({ profile: `## About me\n- George is an artist.\n## Constraints\n- ${"Never share. ".repeat(400)}`, memory: [], retrieved: [] });
  expect(core).toContain("George is an artist.");
  expect(core).toContain("Never share.");
});
