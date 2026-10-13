import { describe, expect, it } from "vitest";
import { elideToolHistory } from "../tool-history.js";

const output = "diagnostic start\n" + "x".repeat(25_000) + "\nFAIL: exact last diagnostic";
const chat = (): Array<Record<string, unknown>> => [
  { role: "system", content: "Keep George's constraints" },
  { role: "user", content: "Implement the original goal" },
  ...Array.from({ length: 8 }, (_, i) => [
    { role: "assistant", content: null, tool_calls: [{ id: `c${i}`, function: { name: "read_file", arguments: "{}" } }] },
    { role: "tool", tool_call_id: `c${i}`, content: output },
  ]).flat(),
];

describe("request-only tool history elision", () => {
  it("shrinks pressure while preserving instructions, IDs, recent turns and the raw transcript", () => {
    const raw = chat();
    const original = JSON.stringify(raw);
    const result = elideToolHistory(raw);
    expect(result.stats.elided).toBeGreaterThan(0);
    expect(result.stats.after).toBeLessThan(result.stats.before);
    expect(JSON.stringify(raw)).toBe(original);
    expect(result.messages.slice(0, 2)).toEqual(raw.slice(0, 2));
    expect(result.messages.slice(-4)).toEqual(raw.slice(-4));
    expect(result.messages[3]).toMatchObject({ role: "tool", tool_call_id: "c0" });
    expect(result.messages[3].content).toContain("FAIL: exact last diagnostic");
    expect(result.messages[3].content).toContain("elided from this request");
  });

  it("leaves low pressure and disabled requests untouched", () => {
    const small = [{ role: "user", content: "Hi" }];
    expect(elideToolHistory(small).messages).toBe(small);
    const raw = chat();
    expect(elideToolHistory(raw, {}, false).messages).toBe(raw);
  });

  it("reports residual pressure honestly instead of deleting user content", () => {
    const raw = [{ role: "user", content: output.repeat(5) }];
    const result = elideToolHistory(raw, { inputBudget: 1000 });
    expect(result.messages).toEqual(raw);
    expect(result.stats.pressureRemaining).toBe(true);
    expect(result.stats.elided).toBe(0);
  });

  it("handles Anthropic blocks without changing errors, IDs or mixed user text", () => {
    const raw = chat().map((m) => m.role === "tool" ? {
      role: "user", content: [
        { type: "text", text: "George's new instruction" },
        { type: "tool_result", tool_use_id: m.tool_call_id, is_error: true, content: m.content },
      ],
    } : m);
    const result = elideToolHistory(raw);
    const blocks = result.messages[3].content as Array<Record<string, unknown>>;
    expect(blocks[0]).toEqual({ type: "text", text: "George's new instruction" });
    expect(blocks[1]).toMatchObject({ tool_use_id: "c0", is_error: true });
    expect(String(blocks[1].content)).toContain("elided");
    expect(result.messages.slice(-4)).toEqual(raw.slice(-4));
  });

  it("preserves two full Responses rounds including reasoning and sibling calls", () => {
    const raw = [ { role: "user", content: "original" },
      ...Array.from({ length: 8 }, (_, i) => [
        { type: "reasoning", id: `r${i}`, encrypted_content: "opaque" },
        { type: "message", role: "assistant", content: [{ type: "output_text", text: "reading" }] },
        { type: "function_call", call_id: `a${i}`, arguments: "{}" },
        { type: "function_call", call_id: `b${i}`, arguments: "{}" },
        { type: "function_call_output", call_id: `a${i}`, output },
        { type: "function_call_output", call_id: `b${i}`, output },
      ]).flat(),
    ];
    const result = elideToolHistory(raw);
    expect(result.stats.elided).toBeGreaterThan(0);
    expect(result.messages.slice(-12)).toEqual(raw.slice(-12));
    expect(result.messages[1]).toEqual(raw[1]);
    expect(result.messages[5]).toMatchObject({ type: "function_call_output", call_id: "a0" });
  });
});
