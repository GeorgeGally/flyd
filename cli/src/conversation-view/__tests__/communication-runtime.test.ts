import { request } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Window } from "happy-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { respondToConversation, type ToolProfile } from "../../runtime/conversation-responder.js";
import { answerWithCommunication, type CommunicationContent } from "../communication.js";
import { FlydDesk } from "../flyd-desk.js";
import { FlydConversationSource } from "../flyd-source.js";
import { ConversationViewServer } from "../server.js";
import { COMMUNICATION_CORPUS, COMMUNICATION_QUESTION, comparisonFacts, diagnosticFacts } from "./fixtures/communication.js";

beforeEach(() => { vi.stubEnv("FLYD_ROOM", "0"); });
afterEach(() => { vi.unstubAllEnvs(); });

async function answer(question: string, facts: Record<string, unknown>, onAnswerContent?: (content: CommunicationContent) => void, toolProfile?: ToolProfile) {
  return respondToConversation({ message: question, sessionId: "communication-regression", turnNumber: 1,
    history: [], memory: { verdict: "insufficient", matches: [] }, situation: null,
    attached: COMMUNICATION_CORPUS, onToken: () => undefined, onAnswerContent,
  }, {
    readOnly: true,
    routeTurn: async () => ({ route: "answer", source: "jev", confidence: 1, decided: true, needsCode: false }),
    runAgentLoop: async (_system, _prompt, tools, onToolCall) => {
      if (!toolProfile) expect(tools.some((tool) => tool.name === "describe_answer")).toBe(Boolean(onAnswerContent));
      const result = await onToolCall("describe_answer", facts);
      if (!toolProfile && onAnswerContent && question === COMMUNICATION_QUESTION) expect(result).toContain("accepted");
      return "<final>The patch changed spacing.</final>";
    },
    persistReceipt: async (input) => input as never,
    ...(toolProfile ? { toolProfile } : {}),
  });
}

function streamUpdate(port: number, token: string, session: string): Promise<{ messages: Array<{ role: string; html: string }> }> {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, path: `/api/stream?session=${session}&token=${token}` }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk: string) => {
        body += chunk;
        const match = /event: update\ndata: ([^\n]+)\n\n/.exec(body);
        if (!match) return;
        req.destroy(); resolve(JSON.parse(match[1]!));
      });
    });
    req.on("error", reject); req.end();
  });
}

describe("grounded answer production through the real conversation surface", () => {
  it("carries the original failure question through facts, intent, persistence, HTTP/SSE and the rendered interface", async () => {
    const dir = mkdtempSync(join(tmpdir(), "flyd-communication-path-"));
    const desk = new FlydDesk({ dir, answer: (question) => answerWithCommunication(question,
      (onContent) => answer(question, question.includes("Which") ? comparisonFacts() : diagnosticFacts(), onContent), { calibrated: async () => false }) });
    const source = new FlydConversationSource({ desk });
    const server = new ConversationViewServer(source);
    const window = new Window();
    try {
      const port = await server.listen(0);
      const url = `http://127.0.0.1:${port}`;
      const { token } = await (await fetch(`${url}/api/token`)).json() as { token: string };
      for (const [index, question] of [COMMUNICATION_QUESTION, "Which fix should we choose?"].entries()) {
        const session = `window:regression-${index}`;
        const sent = await fetch(`${url}/api/send`, { method: "POST", headers: { "content-type": "application/json", "x-flyd-view-token": token }, body: JSON.stringify({ session, text: question }) });
        expect(sent.status).toBe(200);
        await vi.waitFor(() => expect(desk.exchanges(session)[0]?.answer).toBeDefined(), { timeout: 10_000 });
        expect(desk.exchanges(session)[0]).toMatchObject({ answer: { form: { form: "communication" } } });
        const wire = await streamUpdate(port, token, session);
        const rendered = wire.messages.find((message) => message.role === "assistant")!;
        window.document.body.innerHTML = rendered.html;
        const root = window.document.querySelector(".communication")!;
        expect(root.getAttribute("data-semantic-kind")).toBe("investigation");
        expect(root.getAttribute("data-communication")).toBe(index ? "compare_options" : "explain_cause");
        expect(root.querySelector('a[data-action-id="inspect:review"]')?.getAttribute("href")).toBe("https://example.test/review/200");
        expect(root.querySelector(index ? "table" : ".comm-contrast")).not.toBeNull();
        expect(root.textContent).toContain(index ? "Intent planner" : "The answer has no communication intent");
        // Restarting the desk must keep the plan, sources and all factual text.
        const restarted = new FlydDesk({ dir, answer: async () => "unused" });
        expect(restarted.exchanges(session)[0]?.answer?.form).toEqual(desk.exchanges(session)[0]?.answer?.form);
      }
    } finally { await server.close(); await window.happyDOM.close(); rmSync(dir, { recursive: true, force: true }); }
  }, 25_000);

  it("does not let the model's own presentation assertion become its evidence", async () => {
    const onContent = vi.fn();
    await answer("Why?", { ...diagnosticFacts(), evidence: [{ id: "review", label: "Invented", quote: "The missing claim was never retrieved." }] }, onContent);
    expect(onContent).not.toHaveBeenCalled();
  });

  it("honors tool-set filtering and refusal on the presentation channel", async () => {
    const onContent = vi.fn();
    await answer("Why?", diagnosticFacts(), onContent, { offer: (tools) => tools.filter((tool) => tool.name !== "describe_answer") });
    await answer("Why?", diagnosticFacts(), onContent, { offer: (tools) => tools, refuse: () => "Error: blocked by this tool profile" });
    expect(onContent).not.toHaveBeenCalled();
  }, 15_000);
});
