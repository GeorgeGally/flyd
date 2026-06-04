import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { existsSync, readFileSync, readdirSync, rmSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";

const testDir = join(tmpdir(), `flyd-test-skillopt-${randomUUID()}`);
const testSkillsDir = join(testDir, "skills");
const testRawDir = join(testDir, "raw");

vi.mock("../../lib/config.js", async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return {
    ...actual,
    SKILLS_DIR: testSkillsDir,
    RAW_DIR: testRawDir,
    PROJECT: { name: "test", path: testDir },
  };
});

vi.mock("../../lib/llm.js", () => ({
  query: vi.fn(),
}));

const fakeSkillContent = `---
name: test-skill
description: A test skill for optimization
---
# Test Skill

Always start by checking memory.

## Instructions
- Answer questions clearly
- Cite sources when possible
- Provide examples`;

function setupSkill(name = "test-skill"): void {
  const dir = join(testSkillsDir, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), fakeSkillContent, "utf8");
}

beforeEach(() => {
  mkdirSync(testSkillsDir, { recursive: true });
  mkdirSync(testRawDir, { recursive: true });
  vi.clearAllMocks();
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

describe("loadSkill", () => {
  it("loads a skill from disk", async () => {
    setupSkill();
    const { loadSkill } = await import("../skill-optimizer.js");
    const skill = loadSkill("test-skill");
    expect(skill.name).toBe("test-skill");
    expect(skill.content).toContain("Test Skill");
    expect(skill.frontmatter.name).toBe("test-skill");
    expect(skill.frontmatter.description).toBe("A test skill for optimization");
  });

  it("throws on missing skill", async () => {
    const { loadSkill } = await import("../skill-optimizer.js");
    expect(() => loadSkill("nope")).toThrow('Skill "nope" not found');
  });
});

describe("listSkills", () => {
  it("returns empty when no skills dir", async () => {
    const { listSkills } = await import("../skill-optimizer.js");
    expect(listSkills()).toEqual([]);
  });

  it("lists available skills", async () => {
    setupSkill("alpha");
    setupSkill("beta");
    const { listSkills } = await import("../skill-optimizer.js");
    expect(listSkills().sort()).toEqual(["alpha", "beta"]);
  });

  it("skips directories without SKILL.md", async () => {
    setupSkill("valid");
    mkdirSync(join(testSkillsDir, "empty-dir"));
    const { listSkills } = await import("../skill-optimizer.js");
    expect(listSkills()).toEqual(["valid"]);
  });
});

describe("generateTaskSet", () => {
  it("generates tasks from skill content", async () => {
    setupSkill();
    const llm = await import("../../lib/llm.js");
    vi.mocked(llm.query).mockResolvedValue(
      JSON.stringify({
        queries: ["What is this skill?", "How do I use it?", "Show me an example", "What are the limits?", "Compare with alternatives", "When should I use this?", "What are the prerequisites?", "How do I debug issues?", "Any best practices?", "Where is the documentation?"],
        rubric: "A good response follows the skill instructions.",
      })
    );
    const { loadSkill, generateTaskSet } = await import("../skill-optimizer.js");
    const skill = loadSkill("test-skill");
    const result = await generateTaskSet(skill, "gpt-4o-mini");
    expect(result.training.length).toBeGreaterThanOrEqual(4);
    expect(result.heldOut.length).toBe(2);
    expect(result.rubric).toBe("A good response follows the skill instructions.");
    expect(result.generatedAt).toBeTruthy();
  });

  it("fails with too few queries", async () => {
    setupSkill();
    const llm = await import("../../lib/llm.js");
    vi.mocked(llm.query).mockResolvedValue(
      JSON.stringify({ queries: ["only one"], rubric: "test" })
    );
    const { loadSkill, generateTaskSet } = await import("../skill-optimizer.js");
    const skill = loadSkill("test-skill");
    await expect(generateTaskSet(skill, "gpt-4o-mini")).rejects.toThrow("need at least 4");
  });
});

describe("cachedTaskSet", () => {
  it("uses cache when available", async () => {
    setupSkill();
    const tasks = {
      training: [{ query: "cached q?" }],
      heldOut: [{ query: "held q?" }],
      rubric: "cached rubric",
      generatedAt: new Date().toISOString(),
    };
    const taskPath = join(testSkillsDir, "test-skill", "tasks.json");
    mkdirSync(join(testSkillsDir, "test-skill"), { recursive: true });
    writeFileSync(taskPath, JSON.stringify(tasks), "utf8");
    const { loadSkill, cachedTaskSet } = await import("../skill-optimizer.js");
    const skill = loadSkill("test-skill");
    const result = await cachedTaskSet(skill, "gpt-4o-mini", false);
    expect(result.training).toEqual([{ query: "cached q?" }]);
    expect(result.rubric).toBe("cached rubric");
  });

  it("skips cache when noCache=true", async () => {
    setupSkill();
    const llm = await import("../../lib/llm.js");
    vi.mocked(llm.query).mockResolvedValue(
      JSON.stringify({ queries: ["fresh q1", "fresh q2", "fresh q3", "fresh q4", "fresh q5"], rubric: "fresh" })
    );
    const { loadSkill, cachedTaskSet } = await import("../skill-optimizer.js");
    const skill = loadSkill("test-skill");
    const result = await cachedTaskSet(skill, "gpt-4o-mini", true);
    expect(result.rubric).toBe("fresh");
  });
});

describe("averageScore", () => {
  it("averages multiple scores", async () => {
    const { averageScore } = await import("../skill-optimizer.js");
    const scores = [
      { taskCompletion: 0.5, skillAdherence: 0.6, outputQuality: 0.7, overall: 0.6 },
      { taskCompletion: 0.7, skillAdherence: 0.8, outputQuality: 0.9, overall: 0.8 },
      { taskCompletion: 0.9, skillAdherence: 1.0, outputQuality: 0.8, overall: 0.9 },
    ];
    const result = averageScore(scores);
    expect(result.taskCompletion).toBeCloseTo(0.7);
    expect(result.skillAdherence).toBeCloseTo(0.8);
    expect(result.outputQuality).toBeCloseTo(0.8);
    expect(result.overall).toBeCloseTo(0.7667, 3);
  });

  it("returns zeros for empty array", async () => {
    const { averageScore } = await import("../skill-optimizer.js");
    const result = averageScore([]);
    expect(result.taskCompletion).toBe(0);
    expect(result.overall).toBe(0);
  });
});

describe("evaluateSkill", () => {
  it("executes tasks and judges responses", async () => {
    setupSkill();
    const llm = await import("../../lib/llm.js");
    vi.mocked(llm.query)
      .mockResolvedValueOnce("A detailed answer about X.")
      .mockResolvedValueOnce(JSON.stringify({
        taskCompletion: 0.8, skillAdherence: 0.7, outputQuality: 0.9,
      }))
      .mockResolvedValueOnce("Another response about Y.")
      .mockResolvedValueOnce(JSON.stringify({
        taskCompletion: 0.6, skillAdherence: 0.5, outputQuality: 0.7,
      }));

    const { loadSkill, evaluateSkill } = await import("../skill-optimizer.js");
    const skill = loadSkill("test-skill");
    const tasks = [{ query: "What is X?" }, { query: "Explain Y" }];
    const result = await evaluateSkill(skill, tasks, "test rubric", "gpt-4o-mini", "claude-3-haiku");

    expect(result.perTask).toHaveLength(2);
    expect(result.perTask[0].scores.taskCompletion).toBe(0.8);
    expect(result.perTask[0].response).toBe("A detailed answer about X.");
    expect(result.aggregate.overall).toBeCloseTo(0.7, 2);
    expect(result.cost).toBeGreaterThan(0);
  });

  it("handles malformed judge responses", async () => {
    setupSkill();
    const llm = await import("../../lib/llm.js");
    vi.mocked(llm.query)
      .mockResolvedValueOnce("Some answer.")
      .mockResolvedValueOnce("not valid json at all");

    const { loadSkill, evaluateSkill } = await import("../skill-optimizer.js");
    const skill = loadSkill("test-skill");
    const tasks = [{ query: "What?" }];
    const result = await evaluateSkill(skill, tasks, "rubric", "gpt-4o-mini", "claude-3-haiku");

    expect(result.perTask[0].scores.overall).toBe(0);
    expect(result.aggregate.overall).toBe(0);
  });
});

describe("proposeRewrite", () => {
  it("proposes an improved skill", async () => {
    setupSkill();
    const llm = await import("../../lib/llm.js");
    vi.mocked(llm.query).mockResolvedValue(`---
name: test-skill
description: An optimized test skill
---
# Optimized Skill

Better instructions here.`);

    const { loadSkill, proposeRewrite } = await import("../skill-optimizer.js");
    const skill = loadSkill("test-skill");
    const evaluation = {
      perTask: [
        { task: { query: "What is X?" }, response: "Answer", scores: { taskCompletion: 0.5, skillAdherence: 0.5, outputQuality: 0.5, overall: 0.5 } },
      ],
      aggregate: { taskCompletion: 0.5, skillAdherence: 0.5, outputQuality: 0.5, overall: 0.5 },
      cost: 0.02,
    };
    const result = await proposeRewrite(skill, evaluation, "gpt-4o-mini");
    expect(result.content).toContain("name: test-skill");
    expect(result.content).toContain("Optimized Skill");
    expect(result.cost).toBeGreaterThan(0);
  });
});

describe("validateRewrite", () => {
  it("validates rewrite improves held-out scores", async () => {
    setupSkill();
    const llm = await import("../../lib/llm.js");
    vi.mocked(llm.query)
      .mockResolvedValueOnce("Old answer 1")
      .mockResolvedValueOnce(JSON.stringify({ taskCompletion: 0.3, skillAdherence: 0.3, outputQuality: 0.3 }))
      .mockResolvedValueOnce("Old answer 2")
      .mockResolvedValueOnce(JSON.stringify({ taskCompletion: 0.3, skillAdherence: 0.3, outputQuality: 0.3 }))
      .mockResolvedValueOnce("New answer 1")
      .mockResolvedValueOnce(JSON.stringify({ taskCompletion: 0.9, skillAdherence: 0.9, outputQuality: 0.9 }))
      .mockResolvedValueOnce("New answer 2")
      .mockResolvedValueOnce(JSON.stringify({ taskCompletion: 0.9, skillAdherence: 0.9, outputQuality: 0.9 }));

    const { loadSkill, validateRewrite } = await import("../skill-optimizer.js");
    const skill = loadSkill("test-skill");
    const proposed = `---
name: test-skill
description: Optimized
---
# Better Skill

New instructions.`;
    const heldOut = [{ query: "Test Q1" }, { query: "Test Q2" }];
    const result = await validateRewrite(skill, proposed, heldOut, "rubric", "gpt-4o-mini", "claude-3-haiku");

    expect(result.accepted).toBe(true);
    expect(result.preScore).toBeLessThan(result.postScore);
    expect(result.delta).toBeGreaterThan(0.01);
  });

  it("rejects when scores don't improve", async () => {
    setupSkill();
    const llm = await import("../../lib/llm.js");
    vi.mocked(llm.query)
      .mockResolvedValueOnce("Old answer")
      .mockResolvedValueOnce(JSON.stringify({ taskCompletion: 0.5, skillAdherence: 0.5, outputQuality: 0.5 }))
      .mockResolvedValueOnce("New answer")
      .mockResolvedValueOnce(JSON.stringify({ taskCompletion: 0.5, skillAdherence: 0.5, outputQuality: 0.5 }));

    const { loadSkill, validateRewrite } = await import("../skill-optimizer.js");
    const skill = loadSkill("test-skill");
    const proposed = "---\nname: test-skill\ndescription: no change\n---\n# Same";
    const result = await validateRewrite(skill, proposed, [{ query: "Q" }], "rubric", "gpt-4o-mini", "claude-3-haiku");

    expect(result.accepted).toBe(false);
  });
});

describe("history", () => {
  it("saveHistory writes versioned files", async () => {
    setupSkill();
    const { saveHistory, getNextVersion } = await import("../skill-optimizer.js");
    const version = getNextVersion("test-skill");
    expect(version).toBe(0);
    saveHistory("test-skill", version, {
      skillContent: "---\nname: test\n---\n# Body",
      preScores: {
        perTask: [{ task: { query: "q" }, response: "r", scores: { taskCompletion: 0.5, skillAdherence: 0.5, outputQuality: 0.5, overall: 0.5 } }],
        aggregate: { taskCompletion: 0.5, skillAdherence: 0.5, outputQuality: 0.5, overall: 0.5 },
        cost: 0.01,
      },
      postScores: null,
      validation: { accepted: true, preScore: 0.5, postScore: 0.8, delta: 0.3, cost: 0.02 },
      cost: 0.03,
      accepted: true,
    });
    const dir = join(testSkillsDir, "test-skill", "history", "v0");
    expect(existsSync(join(dir, "skill.md"))).toBe(true);
    expect(existsSync(join(dir, "pre-scores.json"))).toBe(true);
    expect(existsSync(join(dir, "report.json"))).toBe(true);
    const report = JSON.parse(readFileSync(join(dir, "report.json"), "utf8"));
    expect(report.accepted).toBe(true);
    expect(report.preScore).toBe(0.5);
    expect(report.postScore).toBe(0.8);
  });

  it("getNextVersion auto-increments", async () => {
    setupSkill();
    const { saveHistory, getNextVersion } = await import("../skill-optimizer.js");
    saveHistory("test-skill", 0, {
      skillContent: "# v0", preScores: { perTask: [], aggregate: { taskCompletion: 0, skillAdherence: 0, outputQuality: 0, overall: 0 }, cost: 0 },
      postScores: null, validation: { accepted: false, preScore: 0, postScore: 0, delta: 0, cost: 0 }, cost: 0, accepted: false,
    });
    saveHistory("test-skill", 1, {
      skillContent: "# v1", preScores: { perTask: [], aggregate: { taskCompletion: 0, skillAdherence: 0, outputQuality: 0, overall: 0 }, cost: 0 },
      postScores: null, validation: { accepted: true, preScore: 0.5, postScore: 0.8, delta: 0.3, cost: 0 }, cost: 0, accepted: true,
    });
    const next = getNextVersion("test-skill");
    expect(next).toBe(2);
  });

  it("loadHistory reads versioned reports", async () => {
    setupSkill();
    const { saveHistory, loadHistory } = await import("../skill-optimizer.js");
    saveHistory("test-skill", 0, {
      skillContent: "# v0", preScores: { perTask: [], aggregate: { taskCompletion: 0, skillAdherence: 0, outputQuality: 0, overall: 0 }, cost: 0 },
      postScores: null, validation: { accepted: false, preScore: 0.3, postScore: 0.3, delta: 0, cost: 0 }, cost: 0, accepted: false,
    });
    saveHistory("test-skill", 1, {
      skillContent: "# v1", preScores: { perTask: [], aggregate: { taskCompletion: 0, skillAdherence: 0, outputQuality: 0, overall: 0 }, cost: 0 },
      postScores: null, validation: { accepted: true, preScore: 0.4, postScore: 0.9, delta: 0.5, cost: 0 }, cost: 0, accepted: true,
    });
    const entries = loadHistory("test-skill");
    expect(entries).toHaveLength(2);
    expect(entries[0].accepted).toBe(false);
    expect(entries[1].accepted).toBe(true);
    expect(entries[1].preScore).toBe(0.4);
    expect(entries[1].postScore).toBe(0.9);
  });
});

describe("runSkillOptimization", () => {
  it("runs the full optimization pipeline", async () => {
    setupSkill("research-skill");
    const llm = await import("../../lib/llm.js");
    // generateTaskSet: 1 call
    vi.mocked(llm.query).mockResolvedValueOnce(JSON.stringify({
      queries: [
        "What is Rust?", "Explain ownership", "How does borrowing work?",
        "What is async Rust?", "Rust vs Go", "When to use traits",
        "How to handle errors", "What are lifetimes",
        "Best practices", "Project structure tips",
      ],
      rubric: "Give detailed, accurate answers.",
    }));
    // Pre-evaluation (1st iteration): 8 training × 2 calls = 16
    for (let i = 0; i < 16; i++) {
      vi.mocked(llm.query).mockResolvedValueOnce(
        i % 2 === 0 ? "A detailed response about the topic." : JSON.stringify({ taskCompletion: 0.6, skillAdherence: 0.5, outputQuality: 0.7 })
      );
    }
    // Propose rewrite: 1 call
    vi.mocked(llm.query).mockResolvedValueOnce(`---
name: research-skill
description: An optimized research skill
---
# Better Research Skill

Improved instructions here.`);
    // Validate (pre): 2 held-out × 2 calls = 4
    for (let i = 0; i < 4; i++) {
      vi.mocked(llm.query).mockResolvedValueOnce(
        i % 2 === 0 ? "Held-out answer." : JSON.stringify({ taskCompletion: 0.4, skillAdherence: 0.4, outputQuality: 0.4 })
      );
    }
    // Validate (post): 2 held-out × 2 calls = 4
    for (let i = 0; i < 4; i++) {
      vi.mocked(llm.query).mockResolvedValueOnce(
        i % 2 === 0 ? "Improved held-out answer." : JSON.stringify({ taskCompletion: 0.8, skillAdherence: 0.8, outputQuality: 0.8 })
      );
    }
    // Post-evaluation (for saveHistory): 2 held-out × 2 = 4
    for (let i = 0; i < 4; i++) {
      vi.mocked(llm.query).mockResolvedValueOnce(
        i % 2 === 0 ? "Post-eval answer." : JSON.stringify({ taskCompletion: 0.8, skillAdherence: 0.8, outputQuality: 0.8 })
      );
    }

    const { runSkillOptimization } = await import("../skill-optimizer.js");
    const result = await runSkillOptimization("research-skill", {
      iterations: 1,
      executorModel: "gpt-4o-mini",
      judgeModel: "claude-3-haiku",
      optimizerModel: "gpt-4o-mini",
      dryRun: true,
      noCache: true,
    });

    expect(result.skill).toBe("research-skill");
    expect(result.accepted).toBe(true);
    expect(result.postScore).toBeGreaterThan(result.preScore);
    expect(result.cost).toBeGreaterThan(0);
    expect(result.iterations).toBe(1);
    expect(result.timestamp).toBeTruthy();
  });

  it("rejects when held-out scores don't improve", async () => {
    setupSkill("weak-skill");
    const llm = await import("../../lib/llm.js");
    // generateTaskSet: 1 call
    vi.mocked(llm.query).mockResolvedValueOnce(JSON.stringify({
      queries: ["Q1", "Q2", "Q3", "Q4", "Q5", "Q6", "Q7", "Q8", "Q9", "Q10"],
      rubric: "test",
    }));
    // Pre-evaluation: 8 × 2 = 16 calls
    for (let i = 0; i < 16; i++) {
      vi.mocked(llm.query).mockResolvedValueOnce(
        i % 2 === 0 ? "Response." : JSON.stringify({ taskCompletion: 0.5, skillAdherence: 0.5, outputQuality: 0.5 })
      );
    }
    // Propose rewrite: 1 call
    vi.mocked(llm.query).mockResolvedValueOnce(`---
name: weak-skill
description: No change
---
# Same skill`);
    // Validate: pre (2 × 2 = 4) + post (2 × 2 = 4) = 8
    for (let i = 0; i < 8; i++) {
      vi.mocked(llm.query).mockResolvedValueOnce(
        i % 2 === 0 ? "Answer." : JSON.stringify({ taskCompletion: 0.5, skillAdherence: 0.5, outputQuality: 0.5 })
      );
    }

    const { runSkillOptimization } = await import("../skill-optimizer.js");
    const result = await runSkillOptimization("weak-skill", {
      iterations: 1,
      executorModel: "gpt-4o-mini",
      judgeModel: "claude-3-haiku",
      optimizerModel: "gpt-4o-mini",
      dryRun: true,
      noCache: true,
    });

    expect(result.accepted).toBe(false);
    expect(Math.abs(result.postScore - result.preScore)).toBeLessThan(0.02);
  });
});
