import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { memoryPaths } from "../memory-store.js";
import { newsInterestsPath, readNewsInterests } from "../news-interests.js";
import { runLibrarian } from "../librarian.js";
import { evolvePrompt, planTopics, rankPrompt, type ScoutFeedback } from "../scout.js";
import { decideExecutiveStep } from "../../intelligence/executive/decision-step.js";

const root = mkdtempSync(join(tmpdir(), "flyd-news-interest-test-"));
afterEach(() => rmSync(root, { recursive: true, force: true }));

it("curates a topic brief and supplies it to all news prompt paths without profile or memory", async () => {
  const paths = memoryPaths(root);
  writeFileSync(paths.memory, "# Flyd memory\n\n## Facts\n- PRIVATE_MEMORY_SENTINEL\n");
  const interest = "Generative art, strange hardware and protocol archaeology, with independent creative coding experiments.";
  let curation = "";
  await runLibrarian({ memoryPaths: paths, statePath: join(root, "state.json"), journalDir: join(root, "journal"), rawDir: join(root, "raw"), projectsPath: join(root, "projects.json"), tastePath: join(root, "taste.json"), scoutDir: join(root, "scout"), readProfile: () => "PRIVATE_PROFILE_SENTINEL", repos: async () => [], complete: async (prompt) => { curation = prompt; return JSON.stringify({ news_interests: interest }); } });
  expect(curation).toContain("PRIVATE_PROFILE_SENTINEL");
  expect(readNewsInterests(newsInterestsPath(paths.memory))).toBe(interest);
  const feedback: ScoutFeedback[] = [];
  const prompts = [rankPrompt([], { taste: interest, feedback, fitnessBySource: {}, today: "2026-11-17", mode: "edition", policy: "on" }), evolvePrompt([], feedback, interest, "2026-11-17")];
  await planTopics(async (prompt) => { prompts.push(prompt); return '{"topics":[]}'; }, new Date(), { taste: interest });
  for (const prompt of prompts) {
    expect(prompt).toContain(interest);
    expect(prompt).not.toContain("PRIVATE_PROFILE_SENTINEL");
    expect(prompt).not.toContain("PRIVATE_MEMORY_SENTINEL");
  }
});

it("keeps news source choices backstage even when judged as a question for George", () => {
  const question = "Should news use personal memory or an interest-only brief as its input?";
  const result = decideExecutiveStep({ sourceId: "firstmate.status", sourceEventId: "news-input", taskId: "news", sourceText: question, proposal: { kind: "question", summary: "Choose news inputs", question, questionEvidence: question, options: ["personal memory", "an interest-only brief"], evidenceRefs: [] }, judgment: { route: "ask_george", confidence: 0.99, notable: true }, authority: [{ grantId: "coordination", capability: "firstmate.message", target: "news" }] });
  expect(result).toMatchObject({ disposition: "handle_internally", show: false, notify: false, action: { target: "news" } });
});
