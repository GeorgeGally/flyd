import { describe, expect, it } from "vitest";
import {
  buildConversationPrompt,
  immediateConversationReply,
  missingPersonalFactReply,
} from "../conversation-responder.js";

describe("buildConversationPrompt", () => {
  it("handles an explicit chat opener without a generic model round trip", () => {
    expect(immediateConversationReply("let's just chat", [])).toBe(
      "What are you thinking about that does not belong in a task yet?",
    );
    expect(immediateConversationReply("let's just chat", [
      { role: "user", content: "Earlier" },
      { role: "assistant", content: "Response" },
    ])).toBeNull();
  });

  it("refuses to invent a horoscope when no personal evidence exists", () => {
    expect(missingPersonalFactReply("What is my current horoscope?", {
      verdict: "insufficient",
      matches: [],
    })).toBe("I do not have your zodiac sign or a current horoscope in Flyd yet, so I will not invent one.");
    expect(missingPersonalFactReply("What is my current horoscope?", {
      verdict: "partial",
      matches: [{
        id: "horoscope",
        path: "personal/horoscope.md",
        excerpt: "Your current horoscope.",
        stale: false,
        kind: "horoscope",
      }],
    })).toBeNull();
    expect(missingPersonalFactReply("What is my zodiac sign?", {
      verdict: "partial",
      matches: [{
        id: "unrelated",
        path: "posttraction/profile.md",
        excerpt: "A generic note that happens to mention zodiac signs.",
        stale: false,
        kind: "archive",
      }],
    })).toBe("I do not have your zodiac sign or a current horoscope in Flyd yet, so I will not invent one.");
    expect(missingPersonalFactReply("What star sign am I?", {
      verdict: "insufficient",
      matches: [],
    })).toBe("I do not have your zodiac sign or a current horoscope in Flyd yet, so I will not invent one.");
    expect(missingPersonalFactReply("Am I a Taurus?", {
      verdict: "insufficient",
      matches: [],
    })).toBe("I do not have your zodiac sign or a current horoscope in Flyd yet, so I will not invent one.");
  });

  it("treats memory as personal evidence rather than a refusal boundary", () => {
    const prompt = buildConversationPrompt({
      message: "What should I work on next?",
      history: [{ role: "user", content: "I am trying to make Flyd useful." }],
      memory: {
        verdict: "partial",
        matches: [{
          id: "memory-1",
          path: "flyd/product.md",
          excerpt: "The first proof is that George chooses Flyd for real work.",
          stale: false,
        }],
      },
      situation: {
        project: "GeorgeGally/flyd",
        branch: "main",
        head: "abc123",
        dirty: true,
        changedFiles: 4,
        latestCommit: "fix(runtime): settle local reviews and timestamps",
        outcome: "Repair the daily-driver loop",
        status: "ready",
        nextAction: "Fix conversational startup",
      },
    });

    expect(prompt.system).toContain("capable personal agent");
    expect(prompt.system).toContain("general knowledge");
    expect(prompt.system).toContain("Never reply with generic availability");
    expect(prompt.system).toContain("Never tell George to wait");
    expect(prompt.system).toContain("cannot fetch, inspect, implement, run tools, or continue after this reply");
    expect(prompt.system).toContain("does not belong in a task yet");
    expect(prompt.prompt).toContain("The first proof is that George chooses Flyd");
    expect(prompt.prompt).toContain("Repair the daily-driver loop");
    expect(prompt.prompt).toContain("fix(runtime): settle local reviews and timestamps");
    expect(prompt.system).toContain("Current repository and task evidence outranks older memory");
    expect(prompt.system).toContain("untrusted personal evidence");
    expect(prompt.prompt).toContain("What should I work on next?");
  });

  it("does not expose an empty evidence section as the answer", () => {
    const prompt = buildConversationPrompt({
      message: "Let's just chat",
      history: [],
      memory: { verdict: "insufficient", matches: [] },
      situation: null,
    });

    expect(prompt.prompt).toContain("Let's just chat");
    expect(prompt.prompt).not.toContain("No evidence found");
  });

  it("does not let archival memory define current repository state", () => {
    const prompt = buildConversationPrompt({
      message: "What is the latest code change?",
      history: [],
      memory: {
        verdict: "partial",
        matches: [{
          id: "old-memory",
          path: "old-capture.md",
          excerpt: "An old exploration of the capture command.",
          stale: false,
        }],
      },
      situation: {
        project: "GeorgeGally/flyd",
        branch: "main",
        head: "bcb0399",
        dirty: true,
        changedFiles: 19,
        latestCommit: "fix(runtime): settle local reviews and timestamps",
        outcome: "Review current project status",
        status: "completed",
        nextAction: "Start a concrete outcome",
      },
    });

    expect(prompt.system).toContain("For this temporal question");
    expect(prompt.prompt).toContain("fix(runtime): settle local reviews and timestamps");
    expect(prompt.prompt).not.toContain("old exploration of the capture command");
  });

  it("uses recent conversation memory when asking what George was last working on", () => {
    const prompt = buildConversationPrompt({
      message: "What was I last working on?",
      history: [],
      memory: {
        verdict: "partial",
        matches: [{
          id: "recent-conversation",
          path: "conversations/art-release",
          excerpt: "George was working through how to release his artwork.",
          stale: false,
          kind: "conversation",
        }],
      },
      situation: {
        project: "GeorgeGally/flyd",
        branch: "main",
        head: "bcb0399",
        dirty: false,
        changedFiles: 0,
        latestCommit: "fix(runtime): settle local reviews and timestamps",
        outcome: null,
        status: null,
        nextAction: null,
      },
    });

    expect(prompt.prompt).toContain("release his artwork");
    expect(prompt.prompt).toContain("fix(runtime): settle local reviews and timestamps");
  });

  it("keeps personal memory for recency questions that are not about repository work", () => {
    const prompt = buildConversationPrompt({
      message: "What is my current horoscope?",
      history: [],
      memory: {
        verdict: "partial",
        matches: [{
          id: "horoscope",
          path: "personal/horoscope.md",
          excerpt: "Today's horoscope is available here.",
          stale: false,
        }],
      },
      situation: null,
    });

    expect(prompt.prompt).toContain("Today's horoscope");
  });

  it("does not inject Git state into an unrelated personal conversation", () => {
    const prompt = buildConversationPrompt({
      message: "How should I release my artwork?",
      history: [],
      memory: {
        verdict: "partial",
        matches: [{
          id: "art-memory",
          path: "conversations/artwork",
          excerpt: "George wants the artwork release to feel like art.",
          stale: false,
          kind: "conversation",
        }],
      },
      situation: {
        project: "GeorgeGally/flyd",
        branch: "main",
        head: "abc123",
        dirty: true,
        changedFiles: 32,
        latestCommit: "A code commit",
        outcome: "A coding task",
        status: "ready",
        nextAction: "Run tests",
      },
    });

    expect(prompt.prompt).toContain("artwork release");
    expect(prompt.prompt).not.toContain("GeorgeGally/flyd");
    expect(prompt.prompt).not.toContain("32 uncommitted");
  });
});
