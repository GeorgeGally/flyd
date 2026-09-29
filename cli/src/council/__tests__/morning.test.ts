import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { morningPromptBlock, prepareMorning, readMorning } from "../morning.js";

let dir: string;
let path: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "flyd-morning-")); path = join(dir, "morning.json"); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const local = (hhmm: string, day = "2026-09-29") => new Date(`${day}T${hhmm}:00`);
const briefing = ["Today's news, not yet told him (/more N, /less N):", "  1. Art Blocks 500 renders fully on-chain — your kind of preservation"];

describe("the morning, ready before he is up", () => {
  it("prepares once, after the news is in, and not before 5am", async () => {
    const compose = vi.fn(async () => "Art Blocks made its first 500 fully on-chain. Nothing on the calendar till 2.");
    const deps = { briefing: async () => briefing, compose, path };
    expect(await prepareMorning({ ...deps, now: () => local("04:30"), newsReady: () => true })).toBeNull();
    expect(await prepareMorning({ ...deps, now: () => local("05:30"), newsReady: () => false })).toBeNull();
    const note = await prepareMorning({ ...deps, now: () => local("05:45"), newsReady: () => true });
    expect(note).toMatchObject({ day: "2026-09-29", briefing, greeting: "Art Blocks made its first 500 fully on-chain. Nothing on the calendar till 2." });
    expect(await prepareMorning({ ...deps, now: () => local("06:00"), newsReady: () => true })).toBeNull();
    expect(compose).toHaveBeenCalledOnce();
  });

  it("goes ahead without the news from 7am, so a late edition never costs him the morning", async () => {
    const note = await prepareMorning({ briefing: async () => [], compose: async () => "Clear day.", newsReady: () => false, now: () => local("07:05"), path });
    expect(note?.greeting).toBe("Clear day.");
  });

  it("is only the morning's: gone at noon and on the next day", async () => {
    await prepareMorning({ briefing: async () => briefing, compose: async () => "Morning.", newsReady: () => true, now: () => local("06:00"), path });
    expect(readMorning(local("11:59"), path)?.greeting).toBe("Morning.");
    expect(readMorning(local("12:00"), path)).toBeNull();
    expect(readMorning(local("08:00", "2026-09-30"), path)).toBeNull();
  });

  it("hands the chat what it prepared, so a greeting doesn't look it all up again", async () => {
    await prepareMorning({ briefing: async () => briefing, compose: async () => "Art Blocks went fully on-chain.", newsReady: () => true, now: () => local("06:10"), path });
    const block = morningPromptBlock(local("08:30"), path);
    expect(block).toContain("## What you prepared for him this morning");
    expect(block).toContain("Art Blocks went fully on-chain.");
    expect(block).toContain("- 1. Art Blocks 500 renders fully on-chain");
    expect(morningPromptBlock(local("14:00"), path)).toBe("");
  });
});
