import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DESIGN_LAB_DONE_WHEN, DESIGN_LAB_SKILL, designLabSkill, dispatchDesignLab, isDesignLabRun, labAwaitingReview } from "../design.js";
import { FirstmateDomainTransport } from "../firstmate.js";
import { listDomainRuns } from "../store.js";
import type { DomainRun } from "../types.js";
import { bundledSkillsDir, loadSkills, seedSkills } from "../../runtime/skills.js";

const run = (id: string, extra: Partial<DomainRun> = {}, request: Partial<DomainRun["request"]> = {}): DomainRun => ({
  id, owner: "FirstMate", status: "completed", createdAt: "2026-10-20T10:00:00.000Z", updatedAt: "2026-10-20T12:00:00.000Z",
  transport: { kind: "firstmate", requestId: id },
  request: { id, domain: "coding", originalMessage: "make a lab", intendedOutcome: "Five landing heroes", doneWhen: ["five versions"], createdAt: "2026-10-20T10:00:00.000Z", skill: { name: DESIGN_LAB_SKILL, body: "…" }, ...request },
  ...extra,
});

describe("design lab path", () => {
  let dir: string | undefined;
  const oldCommandDir = process.env.FLYD_COMMAND_DIR;
  const oldSkillsDir = process.env.FLYD_SKILLS_DIR;
  afterEach(() => {
    for (const [key, value] of [["FLYD_COMMAND_DIR", oldCommandDir], ["FLYD_SKILLS_DIR", oldSkillsDir]] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    vi.unstubAllEnvs();
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it("ships the design-lab skill, and seeding puts it in George's skills", () => {
    dir = mkdtempSync(join(tmpdir(), "flyd-design-skill-"));
    expect(existsSync(join(bundledSkillsDir(), DESIGN_LAB_SKILL, "SKILL.md"))).toBe(true);
    expect(seedSkills(dir)).toContain(DESIGN_LAB_SKILL);
    const seeded = loadSkills(dir).find((skill) => skill.name === DESIGN_LAB_SKILL)!;
    expect(seeded.description).toMatch(/design lab/i);
    expect(seeded.body).toContain("Seed strings");
    expect(seeded.body).toContain("Score it out of 10");
  });

  it("uses George's own edited copy of the skill before the shipped one", () => {
    dir = mkdtempSync(join(tmpdir(), "flyd-design-skill-"));
    expect(designLabSkill(dir)?.body).toContain("critic loop");
    mkdirSync(join(dir, DESIGN_LAB_SKILL));
    writeFileSync(join(dir, DESIGN_LAB_SKILL, "SKILL.md"), "---\nname: design-lab\ndescription: his labs\n---\nThree versions, always.\n");
    expect(designLabSkill(dir)).toEqual({ name: DESIGN_LAB_SKILL, body: "Three versions, always." });
  });

  it("hands a lab to Design Mate with the lab process and the review contract, never to the coding boss", async () => {
    dir = mkdtempSync(join(tmpdir(), "flyd-design-dispatch-"));
    process.env.FLYD_COMMAND_DIR = join(dir, "command");
    process.env.FLYD_SKILLS_DIR = join(dir, "skills");
    process.env.FLYD_LABS_DIR = join(dir, "labs");
    const exec = vi.fn(async () => ({ stdout: "", stderr: "" }));
    try {
      const result = await dispatchDesignLab({
        originalMessage: "make a lab for the landing hero, five versions", intendedOutcome: "Five versions of the landing hero",
        doneWhen: ["five versions"], source: "chat", project: { root: dir }, transport: new FirstmateDomainTransport({ exec }),
      });
      expect(result.status).toBe("accepted");
      const [saved] = listDomainRuns();
      expect(saved!.owner).toBe("Design Mate");
      expect(saved!.request.skill?.name).toBe(DESIGN_LAB_SKILL);
      expect(saved!.request.doneWhen).toEqual(["five versions", ...DESIGN_LAB_DONE_WHEN]);
      expect(isDesignLabRun(saved!)).toBe(true);
      expect(exec).not.toHaveBeenCalled();
    } finally {
      delete process.env.FLYD_LABS_DIR;
    }
  });

  it("waits for his review until he answers the lab with a follow-up", () => {
    const lab = run("domain-lab");
    expect(labAwaitingReview(lab, [lab])).toBe(true);
    expect(labAwaitingReview(run("domain-lab", { status: "working" }), [])).toBe(false);
    expect(labAwaitingReview(run("domain-code", {}, { skill: undefined }), [])).toBe(false);
    const followUp = run("domain-next", {}, { parentRequestId: "domain-lab" });
    expect(labAwaitingReview(lab, [lab, followUp])).toBe(false);
  });
});
