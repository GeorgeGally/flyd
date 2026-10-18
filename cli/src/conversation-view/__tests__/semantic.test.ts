import { describe, expect, it } from "vitest";
import {
  SEMANTIC_KINDS,
  semanticEvents,
  semanticIdentityFor,
  semanticObjectFromShow,
  semanticObjectsFromShow,
} from "../semantic.js";
import type { ShowItem } from "../show.js";

const item = (overrides: Partial<ShowItem> = {}): ShowItem => ({
  id: "live:t1",
  kind: "live",
  headline: "Building mobile Flyd",
  why: "firstmate is on it now",
  task: "t1",
  ...overrides,
});

describe("canonical semantic artefacts", () => {
  it("keeps the vocabulary deliberately bounded to seven primitives", () => {
    expect(SEMANTIC_KINDS).toEqual([
      "conversation", "activity", "decision", "investigation", "action", "artifact", "monitor",
    ]);
  });

  it("maps the legacy presentation kinds into semantic meaning", () => {
    expect(semanticObjectFromShow(item()).kind).toBe("activity");
    expect(semanticObjectFromShow(item({ kind: "call", decision: { task: "t1", question: "A or B?", choices: ["A", "B"] } })).kind).toBe("decision");
    expect(semanticObjectFromShow(item({ kind: "ready" })).kind).toBe("action");
    expect(semanticObjectFromShow(item({ kind: "landed" })).kind).toBe("artifact");
    expect(semanticObjectFromShow(item({ kind: "plan" })).kind).toBe("artifact");
    expect(semanticObjectFromShow(item({ kind: "news" })).kind).toBe("conversation");
  });

  it("keeps identity stable when the same task moves through presentation states", () => {
    const live = item({ id: "live:t1", kind: "live", task: "t1" });
    const ready = item({ id: "ready:t1", kind: "ready", task: "t1" });
    const landed = item({ id: "landed:t1", kind: "landed", task: "t1" });
    expect(semanticIdentityFor(live)).toBe("task:t1");
    expect(semanticIdentityFor(ready)).toBe("task:t1");
    expect(semanticIdentityFor(landed)).toBe("task:t1");
  });

  it("carries real work objects and decisions without layout instructions", () => {
    const semantic = semanticObjectFromShow(item({
      kind: "call",
      headline: "Pick the Christmas direction",
      shots: [{ src: "/shot/a.png", label: "A" }, { src: "/shot/b.png", label: "B" }],
      decision: { task: "t1", question: "Which direction?", choices: ["A", "B"], recommended: "B" },
    }));
    expect(semantic.evidence.map((object) => object.kind)).toEqual(["image", "image"]);
    expect(semantic.decision).toEqual({ question: "Which direction?", alternatives: ["A", "B"], recommended: "B" });
    expect(semantic.actions.map((action) => action.kind)).toEqual(["choose", "choose"]);
    expect(JSON.stringify(semantic)).not.toMatch(/grid|card|column|renderer|css/i);
  });

  it("lets Jev override semantic type without changing the underlying ShowItem", () => {
    const legacy = item({ kind: "news", headline: "Why applications dropped" });
    const [semantic] = semanticObjectsFromShow([legacy], () => "investigation");
    expect(legacy.kind).toBe("news");
    expect(semantic.kind).toBe("investigation");
  });

  it("emits lifecycle deltas for one stable object instead of inventing new cards", () => {
    const active = semanticObjectFromShow(item({ kind: "live", status: "working" }));
    const interrupted = semanticObjectFromShow(item({ kind: "waiting", status: "paused" }));
    const resolved = semanticObjectFromShow(item({ kind: "landed", status: "landed" }));

    expect(semanticEvents([], [active])).toMatchObject([{ objectId: "task:t1", kind: "created" }]);
    expect(semanticEvents([active], [interrupted])).toMatchObject([{ objectId: "task:t1", kind: "interrupted" }]);
    expect(semanticEvents([interrupted], [resolved])).toMatchObject([{ objectId: "task:t1", kind: "resolved" }]);
  });
});
