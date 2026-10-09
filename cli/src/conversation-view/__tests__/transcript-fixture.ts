// Builders for Claude Code transcript lines, shaped like real entries in
// ~/.claude/projects/<dir>/<session>.jsonl (compact JSON, one per line).

let clock = Date.parse("2026-10-05T17:00:00.000Z");
let counter = 0;

function base(type: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  counter += 1;
  clock += 1000;
  return {
    parentUuid: null,
    isSidechain: false,
    type,
    uuid: `uuid-${counter}`,
    timestamp: new Date(clock).toISOString(),
    sessionId: "session-1",
    ...extra,
  };
}

const line = (entry: Record<string, unknown>): string => JSON.stringify(entry);

export function captain(text: string, extra: Record<string, unknown> = {}): string {
  return line(base("user", { message: { role: "user", content: text }, origin: { kind: "human" }, ...extra }));
}

/** Older Claude Code builds wrote no `origin`. */
export function legacyCaptain(text: string): string {
  return line(base("user", { message: { role: "user", content: text } }));
}

export function captainBlocks(content: unknown[]): string {
  return line(base("user", { message: { role: "user", content }, origin: { kind: "human" } }));
}

export function metaUser(text: string): string {
  return line(base("user", { isMeta: true, message: { role: "user", content: [{ type: "text", text }] } }));
}

export function injection(text: string, kind = "task-notification"): string {
  return line(base("user", { message: { role: "user", content: text }, origin: { kind, producer: "session-task" } }));
}

export function compactSummary(text: string): string {
  return line(base("user", { isCompactSummary: true, message: { role: "user", content: text } }));
}

export function toolResult(output: string): string {
  return line(base("user", {
    message: { role: "user", content: [{ tool_use_id: "toolu_1", type: "tool_result", content: [{ type: "text", text: output }] }] },
    toolUseResult: { stdout: output },
  }));
}

export function assistantText(text: string, stopReason: "end_turn" | "tool_use" | null = "end_turn", extra: Record<string, unknown> = {}): string {
  return line(base("assistant", {
    message: { id: `msg-${counter}`, role: "assistant", model: "claude-opus-5-5", content: [{ type: "text", text }], stop_reason: stopReason },
    ...extra,
  }));
}

export function toolUse(name = "Bash", input: Record<string, unknown> = { command: "ls" }): string {
  return line(base("assistant", {
    message: { id: `msg-${counter}`, role: "assistant", model: "claude-opus-5-5", content: [{ type: "tool_use", id: "toolu_1", name, input }], stop_reason: "tool_use" },
  }));
}

export function thinking(text: string): string {
  return line(base("assistant", {
    message: { id: `msg-${counter}`, role: "assistant", model: "claude-opus-5-5", content: [{ type: "thinking", thinking: text, signature: "sig" }], stop_reason: "tool_use" },
  }));
}

export function apiError(text: string): string {
  return line(base("assistant", {
    isApiErrorMessage: true,
    message: { id: `msg-${counter}`, role: "assistant", model: "<synthetic>", content: [{ type: "text", text }], stop_reason: "stop_sequence" },
  }));
}

export function attachment(attachmentBody: Record<string, unknown>): string {
  return line(base("attachment", { attachment: attachmentBody }));
}

export function queuedCaptain(prompt: string): string {
  return attachment({ type: "queued_command", prompt, source_uuid: `queued-${counter + 1}`, commandMode: "prompt", origin: { kind: "human" } });
}

export function sidechain(text: string): string {
  return line(base("user", { isSidechain: true, message: { role: "user", content: text } }));
}

export function title(aiTitle: string): string {
  return line({ type: "ai-title", aiTitle, sessionId: "session-1" });
}
