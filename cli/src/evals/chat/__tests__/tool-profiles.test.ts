import { describe, expect, it } from "vitest";
import { toolProfile } from "../tool-profiles.js";

const tools = ["read_file", "edit_file", "write_file", "bash", "start_coding_task"].map((name) => ({ name, description: "", input_schema: { type: "object" as const, properties: {} } }));

describe("tool profiles", () => {
  it("current offers every tool and refuses nothing", () => {
    const current = toolProfile("current");
    expect(current.offer(tools).map((tool) => tool.name)).toEqual(tools.map((tool) => tool.name));
    expect(current.refuse?.("bash", { command: "rm -rf build" }) ?? null).toBeNull();
  });

  it("split never changes code: no file writes, and a bash that writes is refused", () => {
    const split = toolProfile("split");
    expect(split.offer(tools).map((tool) => tool.name)).toEqual(["read_file", "bash", "start_coding_task"]);
    expect(split.refuse?.("bash", { command: "git status" })).toBeNull();
    expect(split.refuse?.("bash", { command: "echo hi > notes.txt" })).toMatch(/only reads/);
    expect(split.refuse?.("write_file", { path: "a" })).toMatch(/never changes code/);
  });

  it("names the profiles there are when one is unknown", () => {
    expect(() => toolProfile("nope")).toThrow(/have current, split/);
  });
});
