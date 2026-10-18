import { describe, expect, it } from "vitest";
import {
  SEMANTIC_KINDS,
  activityObjectsFromShow,
  semanticEvents,
  semanticIdentityFor,
  semanticObjectFromShow,
  semanticObjectsFromShow,
} from "../semantic.js";
import type { ShowItem } from "../show.js";
import { SemanticJudge } from "../semantic-judge.js";

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
    expect(semanticObjectFromShow(item({ kind: "call", decision: { task: "t1", question: "A or B?", choices: ["A", "B"] } })).kind).toBe("activity");
    expect(semanticObjectFromShow(item({ kind: "ready" })).kind).toBe("activity");
    expect(semanticObjectFromShow(item({ kind: "landed" })).kind).toBe("activity");
    expect(semanticObjectFromShow(item({ kind: "plan" })).kind).toBe("artifact");
    expect(semanticObjectFromShow({ id: "news:1", kind: "news", headline: "A useful update", why: "Worth seeing" }).kind).toBe("conversation");
  });

  it("keeps one task an Activity while its phase moves through work, George, and finished", () => {
    const working = semanticObjectFromShow(item({ kind: "live", started: "2026-10-18T09:00:00Z" }));
    const needsYou = semanticObjectFromShow(item({
      kind: "call",
      decision: { task: "t1", question: "Ship it?", choices: ["Ship", "Hold"], replyTo: "reply:1" },
    }));
    const finished = semanticObjectFromShow(item({ kind: "landed", at: "2026-10-18T10:00:00Z" }));
    expect([working.kind, needsYou.kind, finished.kind]).toEqual(["activity", "activity", "activity"]);
    expect([working.activity?.phase, needsYou.activity?.phase, finished.activity?.phase]).toEqual(["working", "needs_you", "finished"]);
    expect(needsYou.decision?.replyTo).toBe("reply:1");
  });

  it("projects a task exactly once when legacy lists describe several phases", () => {
    const activities = activityObjectsFromShow({
      calls: [item({ id: "call:t1", kind: "call", decision: { task: "t1", question: "A or B?", choices: ["A", "B"] } })],
      underway: [item({ id: "live:t1", kind: "live" })],
      done: [item({ id: "landed:t1", kind: "landed" })],
    });
    expect(activities).toHaveLength(1);
    expect(activities[0]).toMatchObject({ id: "task:t1", kind: "activity", activity: { phase: "needs_you" } });
  });

  it("does not let a Jev override split a known task out of Activity", () => {
    expect(semanticObjectFromShow(item({ kind: "news" }), "investigation").kind).toBe("activity");
    const standalone: ShowItem = { id: "news:1", kind: "news", headline: "Why applications dropped", why: "Worth understanding" };
    expect(semanticObjectFromShow(standalone, "investigation").kind).toBe("investigation");
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
    const legacy: ShowItem = { id: "news:1", kind: "news", headline: "Why applications dropped", why: "Worth understanding" };
    const [semantic] = semanticObjectsFromShow([legacy], () => "investigation");
    expect(legacy.kind).toBe("news");
    expect(semantic.kind).toBe("investigation");
  });


  it("lets Jev choose the semantic primitive without choosing layout", async () => {
    const fetchFn = (async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { questions: Record<string, { criteria?: Record<string, string> }> };
      expect(Object.keys(body.questions.semantic_object_kind.criteria ?? {})).toEqual([
        "conversation", "activity", "decision", "investigation", "action", "artifact", "monitor",
      ]);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          model: "jev-1.13.0",
          answers: { semantic_object_kind: { type: "choice", choice: "investigation", confidence: 0.94, probabilities: { investigation: 0.94 } } },
          usage: { input_tokens: 10, output_tokens: 1 },
        }),
      };
    }) as unknown as typeof fetch;
    const judge = new SemanticJudge({ apiKey: "test", fetchFn });
    const candidate = item({ kind: "news", headline: "Why applications dropped" });
    await judge.request(candidate);
    expect(judge.cached(candidate)).toEqual({ kind: "investigation", confidence: 0.94 });
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
