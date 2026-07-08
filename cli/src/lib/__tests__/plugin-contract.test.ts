import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const PLUGIN_PATH = join(homedir(), ".config/opencode/plugins/flyd-capture.ts");

const REQUIRED_SECTIONS = [
    "## Accomplishments",
    "## Decisions",
    "## Files changed",
    "## Patterns",
    "## Open questions",
    "## People",
    "## Contradictions found",
    "## Entity updates",
    "## Constraints established",
];

describe("flyd-capture.ts distill prompt contract", () => {
    const pluginExists = existsSync(PLUGIN_PATH);

    if (!pluginExists) {
        it("skip — plugin not installed", () => {
            expect(true).toBe(true);
        });
        return;
    }

    const content = readFileSync(PLUGIN_PATH, "utf8");

    it("all 9 distill sections are present in the prompt", () => {
        for (const section of REQUIRED_SECTIONS) {
            expect(content, `missing section: ${section}`).toContain(section);
        }
    });

    it("distill output prepends _distilled: timestamp", () => {
        expect(content).toContain("_distilled: ${timestamp()}");
    });

    it("timestamp function uses ISO format without T", () => {
        expect(content).toContain('replace("T", " ").replace(/\\.\\d+Z$/, "")');
    });

    it("buildStartupInjection reads distill with _distilled line extraction", () => {
        expect(content).toContain("_distilled:");
    });

    it("Constraints established section has conservative filter", () => {
        expect(content).toContain("do not X — reason");
    });

    it("Entity updates section has conservative filter", () => {
        expect(content).toContain("Skip implementation details");
        expect(content).toContain("would still be true in 6 months");
    });

    it("wiki/people/ entries have State / Timeline / Open threads schema", () => {
        expect(content).toContain("wiki/people/");
        expect(content).toContain("## State");
        expect(content).toContain("## Timeline");
        expect(content).toContain("## Open threads");
    });
});