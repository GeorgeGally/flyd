import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sent = vi.hoisted(() => [] as Array<Record<string, unknown>>);
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = {
      create: (params: Record<string, unknown>) => {
        sent.push(params);
        return { stop_reason: "end_turn", content: [{ type: "text", text: "{\"suffix\":\" the island filter\",\"confidence\":0.9}" }], usage: { input_tokens: 20, output_tokens: 12, cache_read_input_tokens: 800 } };
      },
    };
  },
}));

import { ComposerPredictions, completePrediction, predictionModel, predictionPrompt, type PredictionInput } from "../composer-predictions.js";
import type { ConversationMessage } from "../types.js";

const conversation: ConversationMessage[] = [
  { id: "1", role: "user", text: "the island keeps showing routine pings" },
  { id: "2", role: "assistant", text: "I can filter routine replies out of the island." },
];
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "flyd-predict-claude-"));
  vi.stubEnv("FLYD_CLAUDE_SPEND_FILE", join(dir, "spend.json"));
  vi.stubEnv("FLYD_CLAUDE", "1");
  vi.stubEnv("CLAUDE_API_KEY", "claude-key");
  vi.stubEnv("FLYD_PREDICTION_MODEL", "");
  sent.length = 0;
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

describe("typing prediction on Claude", () => {
  it("predicts with Claude Haiku while Claude is on, the open model otherwise", () => {
    expect(predictionModel()).toBe("anthropic:claude-haiku-5-5");
    vi.stubEnv("FLYD_CLAUDE", "0");
    expect(predictionModel()).toBe("openrouter:inception/mercury-2.5");
  });

  it("sends the conversation and his projects as a cached block and only the draft as new text", async () => {
    const input: PredictionInput = { session: "s", draft: "yes, fix", messages: conversation, work: "- Flyd: the Mac presence" };
    const output = await completePrediction(predictionPrompt(input), "anthropic:claude-haiku-5-5", new AbortController().signal, input);
    expect(output).toMatchObject({ text: " the island filter", confidence: 0.9 });
    const [request] = sent;
    expect(request.model).toBe("claude-haiku-5-5");
    expect(request.thinking).toEqual({ type: "disabled" });
    const system = request.system as Array<{ text: string; cache_control?: unknown }>;
    expect(system[1].cache_control).toEqual({ type: "ephemeral" });
    expect(system[1].text).toContain("filter routine replies");
    expect(system[1].text).toContain("Flyd: the Mac presence");
    expect(system[1].text).not.toContain("yes, fix");
    expect(JSON.stringify(request.messages)).toContain("yes, fix");
  });

  it("shows nothing when the model is unsure", async () => {
    const root = join(dir, "composer");
    const unsure = new ComposerPredictions({ root, work: () => "", provider: async () => ({ text: " maybe this", confidence: 0.3 }) });
    expect(await unsure.predict({ session: "s", draft: "can you", messages: conversation })).toBeNull();
    const sure = new ComposerPredictions({ root, work: () => "", provider: async () => ({ text: " check the island", confidence: 0.8 }) });
    expect((await sure.predict({ session: "s2", draft: "can you", messages: conversation }))?.suffix).toBe(" check the island");
  });

  it("gives the model what he is working on alongside the conversation", async () => {
    let seen: PredictionInput | undefined;
    const predictions = new ComposerPredictions({ root: join(dir, "c"), work: () => "- Bloom: gallery show", provider: async (_p, _s, input) => { seen = input; return { text: "" }; } });
    await predictions.predict({ session: "s", draft: "send the", messages: conversation });
    expect(seen?.work).toBe("- Bloom: gallery show");
    expect(seen?.messages).toHaveLength(2);
  });
});
