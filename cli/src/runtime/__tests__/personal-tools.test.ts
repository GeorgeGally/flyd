import { afterEach, describe, expect, it, vi } from "vitest";
import { appleScriptError, isMutatingToolCall, runPersonalTool, webSearch } from "../personal-tools.js";
import type { FetchLike } from "../../evidence/adapters/common.js";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("personal tools", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("creates a reminder with a local due time passed as script arguments, not interpolated", async () => {
    const calls: string[][] = [];
    const runOsascript = async (_script: string, args: string[]) => {
      calls.push(args);
      return "Call \"mom\"; do shell script in Reminders";
    };
    const result = await runPersonalTool(
      "reminders",
      { action: "create", title: 'Call "mom"; do shell script', due: "2026-09-27 17:00" },
      { runOsascript },
    );
    expect(result).toContain("Created reminder");
    expect(calls[0]).toEqual(['Call "mom"; do shell script', "", "", "1", "2026", "09", "27", "17", "00"]);
  });

  it("rejects an ambiguous due time instead of guessing", async () => {
    const runOsascript = vi.fn(async () => "");
    const result = await runPersonalTool("reminders", { action: "create", title: "x", due: "tomorrow 5pm" }, { runOsascript });
    expect(result).toMatch(/^Error: due must be local YYYY-MM-DD HH:MM/);
    expect(runOsascript).not.toHaveBeenCalled();
  });

  it("reads the calendar from today's local date by default", async () => {
    const runOsascript = vi.fn(async (_script: string, _args: string[]) => "");
    const result = await runPersonalTool("calendar_events", { days: 3 }, {
      runOsascript,
      now: () => new Date(2026, 8, 26, 23, 30),
    });
    expect(runOsascript.mock.calls[0][1]).toEqual(["2026", "09", "26", "3"]);
    expect(result).toBe("No calendar events from 2026-09-26 for 3 day(s).");
  });

  it("saves and recalls through injected memory seams", async () => {
    const capture = vi.fn(async () => "/raw/x.md");
    expect(await runPersonalTool("remember", { text: "George prefers aisle seats" }, { capture }))
      .toBe("Saved to Flyd memory: George prefers aisle seats");
    expect(capture).toHaveBeenCalledWith("George prefers aisle seats");
    expect(await runPersonalTool("recall", { query: "seats" }, { recall: async (q) => `hit for ${q}` }))
      .toBe("hit for seats");
  });

  it("also writes durable facts about George into his profile", async () => {
    const capture = vi.fn(async () => "/raw/x.md");
    const appendProfileFact = vi.fn(() => true);
    expect(await runPersonalTool("remember", { text: "George is vegetarian", about_george: true }, { capture, appendProfileFact }))
      .toBe("Saved to Flyd memory and George's profile (USER.md): George is vegetarian");
    expect(appendProfileFact).toHaveBeenCalledWith("George is vegetarian", undefined);
    expect(await runPersonalTool("remember", { text: "Project kickoff went well" }, { capture, appendProfileFact }))
      .toBe("Saved to Flyd memory: Project kickoff went well");
    expect(appendProfileFact).toHaveBeenCalledTimes(1);
  });

  it("classifies which calls may not be replayed or parallelized", () => {
    expect(isMutatingToolCall("reminders", { action: "create" })).toBe(true);
    expect(isMutatingToolCall("reminders", { action: "list" })).toBe(false);
    expect(isMutatingToolCall("remember", {})).toBe(true);
    expect(isMutatingToolCall("bash", { command: "ls" })).toBe(true);
    expect(isMutatingToolCall("web_search", { query: "x" })).toBe(false);
    expect(isMutatingToolCall("read_file", { path: "x" })).toBe(false);
  });

  it("falls through a rejected search key to the next provider and stops retrying it", async () => {
    vi.stubEnv("BRAVE_SEARCH_API_KEY", "bad");
    vi.stubEnv("JINA_API_KEY", "");
    vi.stubEnv("OPENAI_API_KEY", "oa");
    const hosts: string[] = [];
    const fetchFn: FetchLike = async (input) => {
      const url = String(input);
      hosts.push(new URL(url).host);
      if (url.includes("brave.com")) return jsonResponse(422, { error: "SUBSCRIPTION_TOKEN_INVALID" });
      return jsonResponse(200, {
        output: [{ type: "message", content: [{ type: "output_text", text: "Antonelli won (formula1.com?utm_source=openai)" }] }],
      });
    };
    const first = await webSearch("latest F1 winner", 5, fetchFn);
    expect(first).toContain("(openai)");
    expect(first).toContain("Antonelli won (formula1.com)");
    hosts.length = 0;
    await webSearch("another query", 5, fetchFn);
    expect(hosts).toEqual(["api.openai.com"]);
  });

  it("extracts the AppleScript error instead of an empty trailing line", () => {
    const error = Object.assign(new Error("Command failed: osascript -e ...\n"), {
      stderr: "31:46: execution error: Calendar got an error: Application isn’t running. (-600)\n",
    });
    expect(appleScriptError(error)).toBe("Calendar got an error: Application isn’t running. (-600)");
  });
});
