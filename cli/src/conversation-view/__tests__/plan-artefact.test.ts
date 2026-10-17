import { describe, expect, it } from "vitest";
import { composeArtefact, planArtefacts, type ArtefactInputs, type PlanArtefact } from "../artefact.js";
import { boxesOf } from "../boxes.js";
import { showOf } from "../show.js";
import type { ConversationSnapshot } from "../types.js";
import type { Plan } from "../../lib/plans.js";

const NOW = Date.parse("2026-10-17T12:00:00Z");
const planFile = (overrides: Partial<Plan> = {}): Plan => ({
  path: "/x", filename: "f.md", topic: "t", status: "draft", project: "", repoPath: "/x", created: "2026-10-17", outcome: "Big change", files: [], approvalGates: [], body: "",
  phases: [], ...overrides,
});

const plan: PlanArtefact = {
  id: "2026-10-17-auth-plan.md",
  headline: "Add JWT authentication to the API.",
  points: "a test covers a round trip; an expired token is rejected",
  status: "draft",
  at: "2026-10-17",
};

const inputs = (overrides: Partial<ArtefactInputs> = {}): ArtefactInputs => ({ memories: [], news: [], taste: [], plans: [plan], ...overrides });

describe("the plan artefact", () => {
  it("carries the outcome and the done_when points onto the artefact", () => {
    expect(composeArtefact(inputs())).toContainEqual(expect.objectContaining({
      id: "plan:2026-10-17-auth-plan.md",
      kind: "plan",
      headline: "Add JWT authentication to the API.",
      detail: "a test covers a round trip; an expired token is rejected",
      status: "draft",
    }));
  });

  it("shows the plan on Flyd's screen as its own item", () => {
    const screen = showOf({ messages: [] } as unknown as ConversationSnapshot, { artefact: inputs() });
    expect(screen.items.some((item) => item.kind === "plan" && item.headline === "Add JWT authentication to the API.")).toBe(true);
  });

  it("renders the plan through the existing artefact card as a story", () => {
    const screen = showOf({ messages: [] } as unknown as ConversationSnapshot, { artefact: inputs() });
    const boxes = boxesOf(screen);
    const story = boxes.flatMap((box) => box.children ?? []).find((box) => box.tone === "plan");
    expect(story).toMatchObject({ title: "Add JWT authentication to the API.", line: "a test covers a round trip; an expired token is rejected" });
  });

  it("reaches the sidebar through the same items the column maps", () => {
    // The column maps every non-call artefact item to { id, title, line }; a plan survives it.
    const mapped = composeArtefact(inputs())
      .filter((item) => item.kind !== "call")
      .map((item) => ({ id: item.id, title: item.headline, ...(item.detail ? { line: item.detail } : {}) }));
    expect(mapped).toContainEqual({ id: "plan:2026-10-17-auth-plan.md", title: "Add JWT authentication to the API.", line: "a test covers a round trip; an expired token is rejected" });
  });

  it("bounds a plan's line to a few points", () => {
    const many = planArtefacts([planFile({ phases: [{ title: "One", steps: [], doneWhen: ["a", "b", "c", "d", "e", "f"] }] })], NOW);
    expect(many[0]!.points).toBe("a; b; c; d");
  });

  it("shows only open plans made in the last week", () => {
    const shown = planArtefacts([
      planFile({ filename: "fresh.md" }),
      planFile({ filename: "old.md", created: "2026-10-01" }),
      planFile({ filename: "done.md", status: "done" }),
      planFile({ filename: "dropped.md", status: "abandoned" }),
      planFile({ filename: "undated.md", created: "" }),
    ], NOW);
    expect(shown.map((plan) => plan.id)).toEqual(["fresh.md"]);
  });

  it("never hides the nothing-needs-you card behind a plan", () => {
    const screen = showOf({ messages: [] } as unknown as ConversationSnapshot, { artefact: inputs() });
    expect(screen.items.some((item) => item.kind === "clear")).toBe(true);
    expect(screen.items.some((item) => item.kind === "plan")).toBe(true);
  });

  it("shows no plans plainly when there are none", () => {
    expect(composeArtefact(inputs({ plans: [] })).some((item) => item.kind === "plan")).toBe(false);
  });
});
