import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { gatherEvidence } from "../../crew/self-improve.js";
import { armedTasteChecks, cssSpacingTrips, spacingTrips, tasteCheckPlan, type SpacingMetrics } from "../taste-checks.js";
import { planTasteSkills, renderTasteSkill } from "../taste-skills.js";
import { ruleId, writeTaste, type TasteProfile, type TasteRule } from "../taste.js";

let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "flyd-taste-checks-"));
  process.env.FLYD_PROJECTS_PATH = join(home, "projects.json");
  process.env.FLYD_CREW_DIR = join(home, "crew");
  process.env.FLYD_COMMAND_DIR = join(home, "command");
  process.env.FLYD_JOURNAL_DIR = join(home, "journal");
  process.env.FLYD_ADVISORIES_PATH = join(home, "advisories.jsonl");
});
afterEach(() => {
  delete process.env.FLYD_PROJECTS_PATH;
  rmSync(home, { recursive: true, force: true });
});

const rule = (text: string, count: number, extra: Partial<TasteRule> = {}): TasteRule => ({
  id: ruleId(text), text, scope: "personal", count, projects: [], last: "2026-11-12",
  evidence: [{ quote: `wrong: ${text.toLowerCase()}`, source: "Claude Code", date: "2026-11-12" }], ...extra,
});

const SPACING = rule("Ensure adequate padding above elements so layouts breathe", 3, { skill: "spacing" });
const MEASURABLE = rule("Headline font size must stay at least 48px on desktop", 3, { skill: "interface" });
const JUDGMENT = rule("Copy should sound like a person, never a brochure", 4, { skill: "interface" });
const ONCE_MORE = rule("Keep the gap between cards even", 2, { skill: "spacing" });

const profile = (rules: TasteRule[]): TasteProfile => ({ rules, vetoed: [], names: {} });

const page = (extra: Partial<SpacingMetrics> = {}): SpacingMetrics => ({
  viewport: { width: 1440, height: 900 }, pageHeight: 2400, content: { top: 120, bottom: 2300 },
  text: [{ left: 120, right: 900, top: 140, label: "A headline" }], headingActions: [], ...extra,
});

describe("taste rules climb the fix-layer ladder at the third repeat", () => {
  it("holds a spacing rule by the check, proposes one for a measurable rule, and keeps judgment as text with what wrong looks like", () => {
    const plans = tasteCheckPlan(profile([SPACING, MEASURABLE, JUDGMENT, ONCE_MORE]));
    expect(plans.map((plan) => [plan.rule.id, plan.layer, plan.check ?? null, plan.proposeCheck ?? false])).toEqual([
      [SPACING.id, "check", "spacing", false],
      [MEASURABLE.id, "prompt", null, true],
      [JUDGMENT.id, "prompt", null, false],
    ]);
    expect(plans[2]!.wrong).toBe("wrong: copy should sound like a person, never a brochure");
    expect(armedTasteChecks(profile([SPACING])).map((armed) => armed.check)).toEqual(["spacing"]);
    expect(armedTasteChecks(profile([ONCE_MORE]))).toEqual([]);
  });

  it("says in the skill which rules a check holds and what wrong looks like for the rest", () => {
    const taste = profile([SPACING, JUDGMENT]);
    const skills = planTasteSkills(taste, []);
    const text = skills.map((skill) => renderTasteSkill(skill, taste, "/tmp/TASTE.md")).join("\n");
    expect(text).toContain("Checked automatically: the design team's spacing check");
    expect(text).toContain('What wrong looks like, in his words: "wrong: copy should sound like a person, never a brochure"');
  });

  it("asks self-improvement for a check only for a measurable rule no check holds yet", () => {
    writeTaste(profile([SPACING, MEASURABLE, JUDGMENT]), join(home, "TASTE.md"));
    const taste = gatherEvidence({ flydDir: home, now: new Date("2026-11-16T00:00:00Z") }).filter((item) => item.kind === "taste");
    expect(taste.map((item) => item.id)).toEqual([`taste:${MEASURABLE.id}`]);
    expect(taste[0]!.text).toContain("layer: check");
  });
});

describe("the spacing check", () => {
  it("passes a page that breathes", () => {
    expect(spacingTrips(page({ headingActions: [{ heading: "Hello", fontSize: 48, gap: 40 }] }))).toEqual([]);
  });

  it("trips on text against the edge, a massive headline-to-buttons gap, and a short page clamped to the top", () => {
    const lines = spacingTrips(page({
      pageHeight: 900, content: { top: 20, bottom: 300 },
      text: [{ left: 2, right: 400, top: 20, label: "Cramped words" }],
      headingActions: [{ heading: "Big idea", fontSize: 40, gap: 260 }],
    })).map((trip) => trip.line);
    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatch(/touches the edge.*Cramped words/);
    expect(lines[1]).toMatch(/massive gap \(260px\) between the headline "Big idea"/);
    expect(lines[2]).toMatch(/clamped up at the top/);
  });

  it("reads a build's CSS for massive added gaps only", () => {
    const diff = ["+++ b/src/site.css", "+  margin-top: 240px;", "+  padding: 24px;", "-  gap: 400px;", "+++ b/src/app.ts", "+  margin: 999px"].join("\n");
    const trips = cssSpacingTrips(diff);
    expect(trips).toHaveLength(1);
    expect(trips[0]!.line).toMatch(/src\/site\.css adds a massive 240px gap/);
  });
});
