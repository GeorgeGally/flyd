import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildResolutionPrompt, resolve, RESOLUTION_SOUL_BUDGET_CHARS, type ManifestRequest } from "../resolve.js";
import { DEFAULT_SOUL } from "../lib/soul.js";
import { recordResolutionReceipt, resetResolutionTurnCounters, resolutionAnswerText } from "../runtime/resolution-receipt.js";
import type { CompiledContext } from "../cognition/types.js";
import type { TurnReceipt } from "../runtime/turn-receipt.js";

const env = {
  application: { bundle_id: "com.apple.mail", name: "Mail" },
  window: { title: "Inbox", ref: "win_01" },
  focused_element: { ref: "el_01", role: "AXTextArea", description: "Message body", value: "", placeholder: "", selected_text: "" },
  selection: "",
  sufficiency: "semantic" as const,
};
const worldState: Parameters<typeof buildResolutionPrompt>[0] = {
  version: "1.0", generatedAt: "", source: "flyd-cli",
  goals: [], tensions: [], signals: [], curiosity: [], nudges: [], reports: [],
  recentEvents: [], brainHealth: [], profile: [], knowledge: [], review: [],
  suggestions: [], capabilities: [],
};
const route = { kind: "ask_answer", placement: "answer_panel", scene: "concise_answer" } as const;
const compiled = {
  interpretation: { intentKind: "general", projectIds: [] },
  user: { profile: "## George's profile (USER.md)\nLives in Cape Town and hates em dashes.\n## Flyd memory\nPrefers flat whites.", autonomy: [], communication: [] },
  present: { projection: "", activeProjects: [], gaps: [] },
  projects: [],
  conversation: { recap: "", referents: {} },
  memory: { current: [], relevant: [], historical: [], conflicts: [], gaps: [] },
} as unknown as CompiledContext;

function prompt(soul?: string): string {
  return buildResolutionPrompt(worldState, env, "draft a reply", route, undefined, false, [], undefined, [], false, true, null, compiled, soul);
}

describe("the overlay and LIVE resolution prompt shares chat's understanding of George", () => {
  it("carries his SOUL voice by default, the same file chat reads", () => {
    const text = prompt();
    expect(text).toContain("WHO YOU ARE");
    expect(text).toContain(DEFAULT_SOUL.split("\n")[0]);
  });

  it("follows George's own SOUL.md when he has written one", () => {
    const dir = mkdtempSync(join(tmpdir(), "flyd-soul-"));
    const path = join(dir, "SOUL.md");
    writeFileSync(path, "You are Flyd. Talk like a dry Capetonian friend. SOUL-MARKER-7.");
    const previous = process.env.FLYD_SOUL_PATH;
    process.env.FLYD_SOUL_PATH = path;
    try {
      expect(prompt()).toContain("SOUL-MARKER-7");
    } finally {
      process.env.FLYD_SOUL_PATH = previous;
    }
  });

  it("carries his profile and curated memory from the compiled context", () => {
    const text = prompt("Voice.");
    expect(text).toContain("Lives in Cape Town and hates em dashes.");
    expect(text).toContain("Prefers flat whites.");
  });

  it("bounds a very long SOUL.md and keeps every response-shape rule after it", () => {
    const text = prompt(`Voice line.\n${"x".repeat(RESOLUTION_SOUL_BUDGET_CHARS * 3)}`);
    expect(text.length).toBeLessThan(prompt("").length + RESOLUTION_SOUL_BUDGET_CHARS + 600);
    expect(text).toContain("…(trimmed)");
    expect(text).toContain("ROUTE DECISION:");
    expect(text).toContain(`USER INTENT: "draft a reply"`);
    expect(text.indexOf("WHO YOU ARE")).toBeLessThan(text.indexOf("ROUTE DECISION:"));
  });

  it("adds nothing when the soul is empty", () => {
    expect(prompt("")).not.toContain("WHO YOU ARE");
  });
});

describe("resolution turn receipts", () => {
  beforeEach(() => resetResolutionTurnCounters());

  it("persists an overlay receipt with the same mechanism chat uses", async () => {
    const flydDir = mkdtempSync(join(tmpdir(), "flyd-receipts-"));
    const receipt = await recordResolutionReceipt({
      surface: "overlay",
      sessionId: "conv-1",
      message: "what's on today",
      path: "model",
      model: "gpt-x",
      baseURL: "https://api.example.com/v1",
      resolution: { mode: "requires_augment", augmentations: [{ content: "Two calls and the dentist." }] },
    }, { flydDir });
    expect(receipt).not.toBeNull();
    const latest = JSON.parse(readFileSync(join(flydDir, "turn-receipts", "latest.json"), "utf8")) as TurnReceipt;
    expect(latest).toMatchObject({
      version: 1,
      surface: "overlay",
      route: "resolution",
      sessionId: "overlay:conv-1",
      turnNumber: 1,
      message: "what's on today",
      answer: "Two calls and the dentist.",
      status: "succeeded",
      providerIdentity: "api.example.com",
      resolution: { mode: "requires_augment", path: "model" },
    });
    expect(readdirSync(join(flydDir, "turn-receipts", "overlay%3aconv-1")).some((name) => name.startsWith("000001-"))).toBe(true);
  });

  it("marks a failed resolution as failed", async () => {
    const persist = vi.fn(async (input: Omit<TurnReceipt, "version" | "id" | "recordedAt">) => ({ ...input, version: 1, id: "r", recordedAt: "" }) as TurnReceipt);
    await recordResolutionReceipt({
      surface: "live",
      message: "check the thing",
      path: "model",
      resolution: { mode: "requires_compose", rationale: "Resolution failed.", composeRationale: "timeout" },
    }, { persist });
    expect(persist.mock.calls[0][0]).toMatchObject({ surface: "live", status: "failed", error: "timeout", sessionId: "live:invocations" });
  });

  it("uses what George was shown, or what would be typed for him, as the answer", () => {
    expect(resolutionAnswerText({ mode: "native", operations: [{ kind: "insert_text", text: "Hello! " }] })).toBe("Hello! ");
    expect(resolutionAnswerText({ mode: "requires_compose", composeRationale: "Needs a dossier." })).toBe("Needs a dossier.");
  });

  it("writes one from resolve() for the overlay and for LIVE, leaving the response untouched", async () => {
    const persist = vi.fn(async (input: Omit<TurnReceipt, "version" | "id" | "recordedAt">) => ({ ...input, version: 1, id: "r", recordedAt: "" }) as TurnReceipt);
    const manifest: ManifestRequest = {
      invocation_id: "inv-1", environment_revision: 4, intent: "type see you at six", modality: "text",
      environment: env, invocation_fingerprint: { app: "Mail", window: "win_01", element: "el_01" },
    };
    const overlay = await resolve(manifest, undefined, undefined, undefined, null, [], { persist });
    expect(overlay).toMatchObject({ mode: "native", environmentRevision: 4, operations: [{ kind: "insert_text", text: "see you at six" }] });
    await resolve({ ...manifest, intent_author: "model" }, undefined, undefined, undefined, null, [], { persist, sessionId: "live-session" });
    await vi.waitFor(() => expect(persist).toHaveBeenCalledTimes(2));
    expect(persist.mock.calls[0][0]).toMatchObject({ surface: "overlay", route: "resolution", answer: "see you at six", resolution: { mode: "native", path: "deterministic" } });
    expect(persist.mock.calls[1][0]).toMatchObject({ surface: "live", sessionId: "live:live-session" });
  });
});
