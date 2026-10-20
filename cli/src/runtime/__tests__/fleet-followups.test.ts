import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { fleetFollowupsBlock, syncFleetFollowups } from "../fleet-followups.js";

const dirs: string[] = [];
const directory = () => {
  const dir = mkdtempSync(join(tmpdir(), "flyd-followups-"));
  dirs.push(dir);
  return dir;
};

afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

describe("fleet followups", () => {
  it("keeps paused fleet work in Flyd's private prompt context", () => {
    const dir = directory();
    syncFleetFollowups([{ id: "job-1", task: "Daily news brief", status: "paused", detail: "Waiting for its work to resume." }], dir);
    expect(fleetFollowupsBlock(dir)).toContain("Daily news brief: paused. Waiting for its work to resume.");
  });
});
