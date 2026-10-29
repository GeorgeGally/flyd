import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { writeContextTrace } from "../context-trace.js";

it("writes bounded metadata without prompt or memory text", () => {
  const root = mkdtempSync(join(tmpdir(), "flyd-context-trace-"));
  try {
    for (let i = 0; i < 4; i++) writeContextTrace({ root, limit: 2, route: "answer", system: "private system text", prompt: "private prompt text", profile: "private profile", recalled: "private note", history: "private history", tools: "private tool", memoryMs: 42, matches: 3 });
    const files = readdirSync(root);
    expect(files).toHaveLength(2);
    const data = files.map((file) => readFileSync(join(root, file), "utf8")).join("\n");
    expect(data).not.toContain("private");
    expect(JSON.parse(data.split("\n")[0])).toMatchObject({ route: "answer", retrieval: { durationMs: 42, matches: 3 }, tokens: { system: 5, prompt: 5 } });
  } finally { rmSync(root, { recursive: true, force: true }); }
});

it("records the metadata for a real conversation turn", async () => {
  const { respondToConversation } = await import("../conversation-responder.js");
  const root = join(process.env.FLYD_DIR!, "context-traces");
  await respondToConversation({ message: "private turn example", history: [], memory: { verdict: "insufficient", matches: [] }, situation: null, onToken: () => undefined }, {
    routeTurn: async () => ({ route: "answer", source: "jev", confidence: 1, decided: true, needsCode: false }),
    readRoom: async () => null,
    runAgentLoop: async () => "<final>All right.</final>",
    persistReceipt: async (input) => input as never,
  });
  const files = readdirSync(root);
  expect(files).toHaveLength(1);
  const raw = readFileSync(join(root, files[0]!), "utf8");
  expect(raw).not.toContain("private turn example");
  expect(JSON.parse(raw)).toMatchObject({ route: "answer", tokens: { system: expect.any(Number), prompt: expect.any(Number), tools: expect.any(Number) }, retrieval: { durationMs: expect.any(Number) } });
});

it("records the direct account route without persisting the user's text", async () => {
  const { respondToConversation } = await import("../conversation-responder.js");
  const root = join(process.env.FLYD_DIR!, "context-traces");
  const before = new Set(readdirSync(root));
  await respondToConversation({ surface: "mobile", mobileAccounts: false, message: "search my email for a private subject", history: [], memory: { verdict: "insufficient", matches: [] }, situation: null, onToken: () => undefined });
  const created = readdirSync(root).filter((name) => !before.has(name));
  expect(created).toHaveLength(1);
  const raw = readFileSync(join(root, created[0]!), "utf8");
  expect(raw).not.toContain("private subject");
  expect(JSON.parse(raw)).toMatchObject({ route: "account", retrieval: { route: "none", matches: 0 } });
});
