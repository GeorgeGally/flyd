import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { addUserProfileFact, appendUserProfileFact, ensureUserProfile, fitProfile, readUserProfile, USER_PROFILE_TEMPLATE } from "../user-profile.js";

describe("user profile (USER.md)", () => {
  let dir: string;
  let path: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "flyd-profile-"));
    path = join(dir, "USER.md");
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("is absent until George writes something real", () => {
    expect(readUserProfile(path)).toBeNull();
    ensureUserProfile(path);
    expect(readFileSync(path, "utf8")).toBe(USER_PROFILE_TEMPLATE);
    expect(readUserProfile(path)).toBeNull();
  });

  it("returns George's facts without template comments or empty bullets", () => {
    writeFileSync(path, "# George\n<!-- note -->\n## About me\n- Lives in Bali\n- \n## People\n- \n");
    expect(readUserProfile(path)).toBe("# George\n\n## About me\n- Lives in Bali\n## People");
  });

  it("appends learned facts once, dated, under their own heading", () => {
    const now = new Date(2026, 8, 26);
    expect(appendUserProfileFact("Prefers aisle seats", now, path)).toBe(true);
    expect(appendUserProfileFact("prefers aisle seats.", now, path)).toBe(false);
    const text = readFileSync(path, "utf8");
    expect(text).toContain("## Learned in conversation\n- Prefers aisle seats (2026-09-26)\n");
    expect(text.match(/aisle/g)).toHaveLength(1);
    expect(readUserProfile(path)).toContain("- Prefers aisle seats (2026-09-26)");
  });

  it("adds the learned heading to a hand-written profile that lacks it", () => {
    writeFileSync(path, "# George\n- Vegetarian\n");
    appendUserProfileFact("Allergic to shellfish", new Date(2026, 0, 2), path);
    expect(readFileSync(path, "utf8")).toBe("# George\n- Vegetarian\n\n## Learned in conversation\n- Allergic to shellfish (2026-01-02)\n");
  });

  it("files facts under their section, replacing the empty placeholder", () => {
    ensureUserProfile(path);
    addUserProfileFact("Partner: Maya", { section: "People", path, dated: false });
    addUserProfileFact("Brother: Leo", { section: "People", path, dated: false });
    addUserProfileFact("Runs at 6am", { section: "Routines", path, dated: false });
    const text = readFileSync(path, "utf8");
    expect(text).toContain("## People\n- Partner: Maya\n- Brother: Leo\n\n## Preferences");
    expect(text).toContain("## Routines\n- Runs at 6am\n\n## Goals");
    expect(readUserProfile(path)).toContain("## People\n- Partner: Maya\n- Brother: Leo");
  });
});

describe("user profile budget", () => {
  const sections = ["About me", "Work", "People", "Preferences", "Routines", "Goals", "Constraints", "Learned in conversation", "How to be with me"];
  const fixture = (perSection: number) => `# George\n\n${sections.map((section) => `## ${section}\n${Array.from({ length: perSection }, (_, index) => `- ${section} fact ${index}: something George actually said about himself and wants kept`).join("\n")}\n`).join("\n")}`;

  it("passes a 19.5k profile through whole, every section included", () => {
    const text = fixture(26);
    expect(text.length).toBeGreaterThan(19_000);
    expect(fitProfile(text)).toBe(text);
  });

  it("over the cap, trims within sections and never drops one; voice rules stay whole", () => {
    const fitted = fitProfile(fixture(60), 12_000);
    expect(fitted.length).toBeLessThanOrEqual(12_000);
    for (const section of sections) expect(fitted).toContain(`## ${section}\n`);
    expect(fitted).not.toContain("…(truncated)");
    for (let index = 0; index < 60; index += 1) {
      expect(fitted).toContain(`- How to be with me fact ${index}:`);
      expect(fitted).toContain(`- Constraints fact ${index}:`);
    }
    expect(fitted).toContain("more lines in USER.md)");
  });
});
