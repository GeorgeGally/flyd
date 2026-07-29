import { describe, expect, it } from "vitest";
import { classifyRecallIntent } from "../recall-intent.js";

describe("classifyRecallIntent", () => {
  it("classifies present-tense activity questions as current_state", () => {
    expect(classifyRecallIntent("What am I working on?").kind).toBe("current_state");
    expect(classifyRecallIntent("what are you doing right now").kind).toBe("current_state");
    expect(classifyRecallIntent("what's currently active").kind).toBe("current_state");
  });

  it("classifies resumption phrasing as task_resume", () => {
    expect(classifyRecallIntent("Where were we?").kind).toBe("task_resume");
    expect(classifyRecallIntent("let's resume where we left off").kind).toBe("task_resume");
    expect(classifyRecallIntent("pick up where we left off").kind).toBe("task_resume");
  });

  it("classifies explicit historical markers as historical_recall", () => {
    expect(classifyRecallIntent("What was I building in 2024?").kind).toBe("historical_recall");
    expect(classifyRecallIntent("back in the day, what did we use?").kind).toBe("historical_recall");
  });

  it("falls back to general for queries with no temporal signal", () => {
    expect(classifyRecallIntent("What is my preferred editor?").kind).toBe("general");
    expect(classifyRecallIntent("What did we decide about memory?").kind).toBe("general");
  });

  it("never classifies a historical question as current_state", () => {
    const result = classifyRecallIntent("What was I working on in 2019?");
    expect(result.kind).not.toBe("current_state");
  });
});
