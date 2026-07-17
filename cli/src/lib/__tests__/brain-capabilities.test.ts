import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { BRAIN_CAPABILITIES } from "../brain-capabilities.js";

describe("brain capability parity", () => {
  it("declares how every top-level CLI command is integrated with Rails", () => {
    const source = readFileSync(join(process.cwd(), "src", "index.ts"), "utf8");
    const commandIds = [...source.matchAll(/(?:^|=\s*)program\s*\n?\s*\.command\("([^" ]+)/gm)]
      .map((match) => match[1])
      .filter((id) => !["setup"].includes(id));
    commandIds.push("capture", "dashboard");

    expect(BRAIN_CAPABILITIES.map((capability) => capability.id).sort()).toEqual(commandIds.sort());
  });

  it("gives Rails a non-empty integration contract for every capability", () => {
    for (const capability of BRAIN_CAPABILITIES) {
      expect(["automatic", "targeted", "maintenance", "interactive", "runtime"]).toContain(capability.integration);
      expect(capability.description.length).toBeGreaterThan(10);
    }
  });
});
