import { expect, it } from "vitest";
import { budgetPersonalContext } from "../context-budget.js";

it("retains instructions over the budget and selects topic-relevant facts", () => {
  const profile = ['# George', '## About me', '- George builds software.', '## Constraints', '- Never send email without approval.', '## Preferences', '- Always use plain language.', '- George likes blue bicycles.', '- George likes red kites.'].join('\n');
  const memory = ['## Facts', '- [curated; MEMORY.md:1] The bicycle is blue.', '- [curated; MEMORY.md:2] Kites are red.'].join('\n');
  const selected = budgetPersonalContext({ profile, memory, query: 'What color is the bicycle?', route: 'companion' });
  expect(selected).toContain('Never send email without approval.');
  expect(selected).toContain('Always use plain language.');
  expect(selected).toContain('bicycle is blue');
  expect(selected).not.toContain('Kites are red');
});

it("preserves every line of protected sections even when they exceed the ordinary cap", () => {
  const safety = 'Never disclose secrets. '.repeat(1000);
  const selected = budgetPersonalContext({ profile: `# George\n## Constraints\n- ${safety}`, memory: '', query: 'hello', route: 'companion' });
  expect(selected).toContain(safety.trim());
});

it("keeps older user instructions even if recent history fills the cap", async () => {
  const { budgetHistory } = await import("../context-budget.js");
  const history = [{ role: "user", content: "Speak plainly." }, { role: "assistant", content: "x".repeat(7000) }];
  expect(budgetHistory(history, "companion")).toEqual([history[0]]);
});

it("keeps one copy of recalled evidence and omits the recap when its turns are present", async () => {
  const { buildConversationPrompt } = await import("../conversation-responder.js");
  const { compileContext } = await import("../../cognition/context-compiler.js");
  const context = await compileContext({ intent: "Tell me about my bicycle", jev: { apiKey: "" } });
  context.user.personal = { profile: "# George\n## Constraints\n- Never send without permission.\n## Work\n- A bicycle is blue.\n- A kite is red.", memory: "", projection: "" };
  context.memory.relevant = [{ id: "1", content: "The bicycle is blue.", source: "note.md", relevance: 0.9, epistemicStatus: "observation", freshness: 1, temporalStatus: "background" }];
  context.conversation.recap = "duplicated recap";
  const result = buildConversationPrompt({ message: "Tell me about my bicycle", history: [{ role: "user", content: "I like cycling." }], memory: { verdict: "partial", matches: [{ id: "1", path: "note.md", excerpt: "The bicycle is blue.", stale: false }] }, situation: null }, context, { projectTurn: false });
  expect(result.prompt.match(/The bicycle is blue\./g)).toHaveLength(1);
  expect(result.prompt).not.toContain("duplicated recap");
  expect(result.prompt).toContain("Never send without permission.");
  expect(result.prompt).not.toContain("kite is red");
});

it("retains explicit profile constraints on a room-selected companion turn", async () => {
  const { buildConversationPrompt } = await import("../conversation-responder.js");
  const { compileContext } = await import("../../cognition/context-compiler.js");
  const context = await compileContext({ intent: "hello", jev: { apiKey: "" } });
  context.user.personal = { profile: "# George\n## Constraints\n- Never send without permission.", memory: "", projection: "" };
  const result = buildConversationPrompt({ message: "hello", history: [], memory: { verdict: "insufficient", matches: [] }, situation: null }, context, { projectTurn: false, room: { core: "George", facts: "George", brief: "" } });
  expect(result.system).toContain("Never send without permission.");
});

it("states each room profile instruction once when the budgeted profile is present", async () => {
  const { buildConversationPrompt } = await import("../conversation-responder.js");
  const { buildRoomContext } = await import("../room-context.js");
  const { compileContext } = await import("../../cognition/context-compiler.js");
  const context = await compileContext({ intent: "hello", jev: { apiKey: "" } });
  const profile = "# George\n## Safety\n- Never share passwords\n## Instructions\n- Keep replies short\n## People\n- Always ask before calling Theo\n- Theo is my brother";
  context.user.personal = { profile, memory: "", projection: "" };
  const room = buildRoomContext({ profile, memory: [], retrieved: [] });
  const result = buildConversationPrompt({ message: "how is Theo doing", history: [], memory: { verdict: "insufficient", matches: [] }, situation: null }, context, { projectTurn: false, room: { core: room.core, facts: room.facts, brief: "" } });
  expect(result.system.match(/Never share passwords/g)).toHaveLength(1);
  expect(result.system.match(/Keep replies short/g)).toHaveLength(1);
  expect(result.system.match(/Always ask before calling Theo/g)).toHaveLength(1);
  expect(result.system.match(/Theo is my brother/g)).toHaveLength(1);
});

it("keeps imperatives to Flyd and protected sections mandatory, but budgets life facts", async () => {
  const { isProfileInstruction } = await import("../context-budget.js");
  const imperatives = ["- Never call me Georgie", "- Don't feed me platitudes", "- Avoid em dashes", "- Keep answers short", "- Use British spelling", "- Stop hedging", "- Never need to apologise", "- Always proceed without asking for local edits", "- Be prepared to push back"];
  const facts = ["- Only child, grew up in Durban", "- Never owned a car", "- Always loved my grandmother's cooking", "- Never learned to swim, my dad tried"];
  for (const line of imperatives) expect(isProfileInstruction(line)).toBe(true);
  for (const line of facts) expect(isProfileInstruction(line)).toBe(false);
  const profile = ["# George", "## About me", "- George", "- Artist", ...facts, ...imperatives, "## Safety", "- My address stays private"].join("\n");
  const selected = budgetPersonalContext({ profile, memory: "", query: "hello", route: "companion" });
  for (const line of imperatives) expect(selected).toContain(line.slice(2));
  expect(selected).toContain("My address stays private");
  for (const line of facts) expect(selected).not.toContain(line.slice(2));
  const relevant = budgetPersonalContext({ profile, memory: "", query: "where did I grow up in Durban", route: "companion" });
  expect(relevant).toContain("Only child, grew up in Durban");
});

it("gives explicit recall questions the recall budget but not save requests", async () => {
  const { buildConversationPrompt } = await import("../conversation-responder.js");
  const route = (message: string) => buildConversationPrompt({ message, history: [], memory: { verdict: "insufficient", matches: [] }, situation: null }, undefined, { projectTurn: false }).route;
  expect(route("remember to buy milk")).toBe("companion");
  expect(route("remember this: I prefer aisle seats")).toBe("companion");
  expect(route("do you remember what I said about Sam?")).toBe("recall");
  expect(route("what have I said about the kitchen tiles?")).toBe("recall");
});
