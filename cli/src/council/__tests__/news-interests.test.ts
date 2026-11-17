import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { memoryPaths } from "../memory-store.js";
import { newsInterestsPath, readNewsInterests } from "../news-interests.js";
import { runLibrarian } from "../librarian.js";
import { evolveScout, planInitialTopics, readTaste } from "../scout.js";
import { decideExecutiveStep } from "../../intelligence/executive/decision-step.js";

let root = "";
let previous: string | undefined;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "flyd-news-interest-test-"));
  previous = process.env.FLYD_MEMORY_DIR;
  process.env.FLYD_MEMORY_DIR = root;
  writeFileSync(join(root, "MEMORY.md"), "# Flyd memory\n\n## Facts\n- PRIVATE_MEMORY_SENTINEL\n");
});
afterEach(() => {
  if (previous === undefined) delete process.env.FLYD_MEMORY_DIR; else process.env.FLYD_MEMORY_DIR = previous;
  rmSync(root, { recursive: true, force: true });
});

const scout = () => { const dir = join(root, "scout"); mkdirSync(dir, { recursive: true }); return dir; };
const librarian = (complete: (prompt: string) => Promise<string>) => runLibrarian({
  memoryPaths: memoryPaths(root), statePath: join(root, "state.json"), journalDir: join(root, "journal"), rawDir: join(root, "raw"),
  projectsPath: join(root, "projects.json"), tastePath: join(root, "taste.json"), scoutDir: scout(),
  readProfile: () => "PRIVATE_PROFILE_SENTINEL", repos: async () => [], complete,
});

it("falls back to the scout taste brief, then prefers the curated interests", () => {
  const dir = scout();
  writeFileSync(join(dir, "taste.md"), "TASTE_FILE_SENTINEL generative art and odd hardware, evolved from feedback.\n");
  expect(readNewsInterests(readTaste(dir), newsInterestsPath(memoryPaths(root).memory))).toContain("TASTE_FILE_SENTINEL");
});

it("planInitialTopics and evolveScout prompts use the brief, never profile or memory", async () => {
  const dir = scout();
  writeFileSync(join(dir, "taste.md"), "TASTE_FILE_SENTINEL generative art and odd hardware, evolved from feedback, long enough to count as a profile.\n");
  const prompts: string[] = [];
  const complete = async (prompt: string) => { prompts.push(prompt); return '{"topics":[],"add":[]}'; };
  await planInitialTopics(complete, new Date("2026-11-17T08:00:00Z"), dir);
  await evolveScout({ complete, dir, now: () => new Date("2026-11-17T08:00:00Z"), fetchTopicFn: async () => [] });
  expect(prompts.length).toBeGreaterThanOrEqual(2);
  for (const prompt of prompts) {
    expect(prompt).toContain("TASTE_FILE_SENTINEL");
    expect(prompt).not.toContain("PRIVATE_MEMORY_SENTINEL");
  }
  const curated = "Curated interests: protocol history, creative coding experiments and strange hardware.";
  writeFileSync(newsInterestsPath(memoryPaths(root).memory), `${curated}\n`);
  prompts.length = 0;
  await planInitialTopics(complete, new Date("2026-11-17T08:00:00Z"), dir);
  expect(prompts[0]).toContain(curated);
  expect(prompts[0]).not.toContain("TASTE_FILE_SENTINEL");
});

it("evolve still revises taste.md from the model reply", async () => {
  const dir = scout();
  const revised = `${"Revised taste: generative art, creative coding and odd hardware. ".repeat(3)}`.trim();
  await evolveScout({ complete: async () => JSON.stringify({ add: [], taste: revised, taste_change: "sharpened" }), dir, now: () => new Date("2026-11-17T08:00:00Z"), fetchTopicFn: async () => [] });
  expect(readFileSync(join(dir, "taste.md"), "utf8").trim()).toBe(revised);
});

it("librarian stores valid news_interests, drops too short or too long ones, and skips when nothing changed", async () => {
  const path = newsInterestsPath(memoryPaths(root).memory);
  let calls = 0;
  const reply = (value: string) => async () => { calls++; return JSON.stringify({ news_interests: value }); };
  const good = "Generative art, strange hardware and protocol archaeology, with creative coding experiments.";
  await librarian(reply(good));
  expect(readFileSync(path, "utf8").trim()).toBe(good);
  writeFileSync(join(scout(), "feedback.jsonl"), `${JSON.stringify({ at: "2026-11-17T08:00:00Z", verdict: "more", topic: "plotters" })}\n`);
  await librarian(reply("short"));
  expect(readFileSync(path, "utf8").trim()).toBe(good);
  writeFileSync(join(scout(), "feedback.jsonl"), `${JSON.stringify({ at: "2026-11-18T08:00:00Z", verdict: "less", topic: "x" })}\n`);
  await librarian(reply("x".repeat(2001)));
  expect(readFileSync(path, "utf8").trim()).toBe(good);
  const before = calls;
  const skipped = await librarian(reply(good));
  expect(skipped).toMatchObject({ skipped: "nothing_new" });
  expect(calls).toBe(before);
});

it("librarian curation prompt carries the profile but news prompts do not (profile only feeds curation)", async () => {
  let curation = "";
  await librarian(async (prompt) => { curation = prompt; return "{}"; });
  expect(curation).toContain("PRIVATE_PROFILE_SENTINEL");
});

const ask = (question: string, evidence = question) => decideExecutiveStep({ sourceId: "firstmate.status", sourceEventId: question, taskId: "news", sourceText: question, proposal: { kind: "question", summary: "Choose", question, questionEvidence: evidence, options: ["a", "b"], evidenceRefs: [] }, judgment: { route: "ask_george", confidence: 0.99, notable: true }, authority: [{ grantId: "coordination", capability: "firstmate.message", target: "news" }] });

it("settles news memory/profile input choices backstage but still asks George about paid news subscriptions", () => {
  expect(ask("Should news use personal memory or an interest-only brief as its input?")).toMatchObject({ disposition: "handle_internally", show: false, notify: false, action: { target: "news" } });
  const paid = ask("Which news sources should I subscribe you to (paid)?");
  expect(paid.disposition).not.toBe("handle_internally");
});
