import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { addUserProfileFact, appendUserProfileFact, ensureUserProfile, readUserProfile, USER_PROFILE_TEMPLATE } from "../user-profile.js";

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
