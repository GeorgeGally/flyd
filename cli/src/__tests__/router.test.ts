import { describe, expect, it } from "vitest";
import { classifyRoute, parseClassifierResponse, isDeterministicDictation } from "../router.js";

const env = { appName: "Mail", elementRole: "AXTextArea" };
const config = { model: "flash-test", apiKey: "key", baseURL: "https://example.test/v1" };

const validResponse = JSON.stringify({
  kind: "ask_answer",
  placement: "answer_panel",
  scene: "concise_answer",
  consequential: false,
  verbs: [],
  target: "text_in_focus",
  reason: "General question",
});

describe("parseClassifierResponse", () => {
  it("parses a valid classification", () => {
    const result = parseClassifierResponse(validResponse);
    expect(result).not.toBeNull();
    expect(result?.route).toEqual({
      kind: "ask_answer",
      placement: "answer_panel",
      scene: "concise_answer",
    });
    expect(result?.consequence.class).toBe("benign");
    expect(result?.consequence.source).toBe("classifier");
  });

  it("extracts JSON embedded in prose", () => {
    const result = parseClassifierResponse(`Here you go:\n${validResponse}\nDone.`);
    expect(result?.route.kind).toBe("ask_answer");
  });

  it("rejects unknown kind/placement/scene", () => {
    expect(parseClassifierResponse(JSON.stringify({ kind: "banana", placement: "answer_panel", scene: "concise_answer" }))).toBeNull();
    expect(parseClassifierResponse(JSON.stringify({ kind: "ask_answer", placement: "sideways", scene: "concise_answer" }))).toBeNull();
    expect(parseClassifierResponse(JSON.stringify({ kind: "ask_answer", placement: "answer_panel", scene: "opera" }))).toBeNull();
  });

  it("rejects malformed JSON", () => {
    expect(parseClassifierResponse("not json at all")).toBeNull();
  });

  it("maps consequential classifications with filtered verbs", () => {
    const result = parseClassifierResponse(JSON.stringify({
      kind: "draft_insert",
      placement: "insert_at_cursor",
      scene: "email_reply",
      consequential: true,
      verbs: ["send", "explode"],
      target: "external_system",
      reason: "Sends an email",
    }));
    expect(result?.consequence.class).toBe("consequential");
    expect(result?.consequence.verbs).toEqual(["send"]);
    expect(result?.consequence.target).toBe("external_system");
  });

  it("drops verbs when classifier says benign", () => {
    const result = parseClassifierResponse(JSON.stringify({
      kind: "draft_insert",
      placement: "insert_at_cursor",
      scene: "email_reply",
      consequential: false,
      verbs: ["send"],
      target: "text_in_focus",
    }));
    expect(result?.consequence.verbs).toEqual([]);
  });
});

describe("classifyRoute", () => {
  it("returns null without config", async () => {
    const result = await classifyRoute("send the email", env, "text", null);
    expect(result).toBeNull();
  });

  it("returns parsed route from the model", async () => {
    const result = await classifyRoute("what is this", env, "text", config, async () => validResponse);
    expect(result?.route.placement).toBe("answer_panel");
  });

  it("returns null when the model times out", async () => {
    const slow = () => new Promise<string>((res) => setTimeout(() => res(validResponse), 5000));
    const result = await classifyRoute("what is this", env, "text", config, slow, 50);
    expect(result).toBeNull();
  });

  it("returns null when the model throws", async () => {
    const result = await classifyRoute("what is this", env, "text", config, async () => {
      throw new Error("api down");
    });
    expect(result).toBeNull();
  });

  it("returns null on malformed model output", async () => {
    const result = await classifyRoute("what is this", env, "text", config, async () => "garbage");
    expect(result).toBeNull();
  });
});

describe("isDeterministicDictation", () => {
  it("detects type prefix in editable text field", () => {
    expect(isDeterministicDictation({
      intent: "type hello world",
      modality: "text",
      elementRole: "AXTextArea",
    })).toBe(true);
  });

  it("detects write prefix in text field", () => {
    expect(isDeterministicDictation({
      intent: "write this sentence for me",
      modality: "text",
      elementRole: "AXTextField",
    })).toBe(true);
  });

  it("detects dictate prefix", () => {
    expect(isDeterministicDictation({
      intent: "dictate meeting notes",
      modality: "text",
      elementRole: "AXTextArea",
    })).toBe(true);
  });

  it("detects insert prefix", () => {
    expect(isDeterministicDictation({
      intent: "insert a link here",
      modality: "text",
      elementRole: "AXTextArea",
    })).toBe(true);
  });

  it("rejects dictation in non-editable element", () => {
    expect(isDeterministicDictation({
      intent: "type hello world",
      modality: "text",
      elementRole: "AXWindow",
    })).toBe(false);
  });

  it("rejects non-dictation intent even in editable field", () => {
    expect(isDeterministicDictation({
      intent: "what is this code doing",
      modality: "text",
      elementRole: "AXTextArea",
    })).toBe(false);
  });

  it("rejects voice modality for dictation", () => {
    expect(isDeterministicDictation({
      intent: "type hello world",
      modality: "voice",
      elementRole: "AXTextArea",
    })).toBe(false);
  });

  it("rejects empty role", () => {
    expect(isDeterministicDictation({
      intent: "type hello",
      modality: "text",
      elementRole: "",
    })).toBe(false);
  });

  it("requires exact prefix match not substring", () => {
    expect(isDeterministicDictation({
      intent: "prototype the login flow",
      modality: "text",
      elementRole: "AXTextArea",
    })).toBe(false);
  });
});
