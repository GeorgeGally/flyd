import { mkdtemp, readFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createConversationMemorySession,
  mergeAgentMemoryEvidence,
  retrieveRecentConversationEvidence,
} from "../conversation-memory.js";

const directories: string[] = [];

async function temporaryFlydDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "flyd-conversation-memory-"));
  directories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })
  ));
});

describe("conversation memory", () => {
  it("rejects session IDs that could escape the memory directories", () => {
    expect(() => createConversationMemorySession({
      flydDir: "/tmp/flyd",
      id: "../outside",
    })).toThrow("Invalid conversation session ID");
  });

  it("persists every completed turn as raw evidence and an unpromoted wiki index", async () => {
    const flydDir = await temporaryFlydDirectory();
    const session = createConversationMemorySession({
      flydDir,
      id: "session-art-release",
      now: () => new Date("2026-07-20T04:00:00.000Z"),
      project: "GeorgeGally/flyd",
      projectPath: "/Users/george/flyd",
    });

    await session.recordTurn({
      user: "I am thinking about releasing my artwork as a numbered collection.",
      assistant: "The release should lead with the work and a clear collecting premise.",
    });

    const transcript = await readFile(
      join(flydDir, "raw", "conversation-session-art-release.md"),
      "utf8",
    );
    const wikiIndex = await readFile(
      join(flydDir, "wiki", "conversations", "session-art-release.md"),
      "utf8",
    );

    expect(transcript).toContain("type: flyd-conversation-transcript");
    expect(transcript).toContain("epistemic_status: source_evidence");
    expect(transcript).toContain("releasing my artwork as a numbered collection");
    expect(transcript).toContain("The release should lead with the work");
    expect(wikiIndex).toContain("type: conversation-index");
    expect(wikiIndex).toContain("promoted: false");
    expect(wikiIndex).toContain("releasing my artwork as a numbered collection");
  });

  it("recalls the previous session for a continuity question without semantic search", async () => {
    const flydDir = await temporaryFlydDirectory();
    const previous = createConversationMemorySession({
      flydDir,
      id: "previous-session",
      now: () => new Date("2026-07-20T04:00:00.000Z"),
      project: "GeorgeGally/flyd",
      projectPath: "/Users/george/flyd",
    });
    await previous.recordTurn({
      user: "I want to release my artwork, but the presentation has to feel like art.",
      assistant: "Then the release format should be designed as part of the work.",
    });

    const evidence = await retrieveRecentConversationEvidence(
      "What were we talking about before this?",
      {
        flydDir,
        excludeSessionId: "new-session",
        now: () => new Date("2026-07-20T04:01:00.000Z"),
      },
    );

    expect(evidence.verdict).toBe("partial");
    expect(evidence.matches).toHaveLength(1);
    expect(evidence.matches[0]).toMatchObject({
      kind: "conversation",
      path: "conversations/previous-session",
      stale: false,
    });
    expect(evidence.matches[0].excerpt).toContain("release my artwork");
  });

  it("finds a relevant recent conversation by topic after restart", async () => {
    const flydDir = await temporaryFlydDirectory();
    const previous = createConversationMemorySession({
      flydDir,
      id: "art-session",
      now: () => new Date("2026-07-20T04:00:00.000Z"),
      project: "personal",
      projectPath: "/Users/george",
    });
    await previous.recordTurn({
      user: "The artwork release needs a better collecting story.",
      assistant: "Build the story around the constraint and provenance of each piece.",
    });

    const evidence = await retrieveRecentConversationEvidence(
      "What do you know about my artwork release?",
      {
        flydDir,
        now: () => new Date("2026-07-20T04:02:00.000Z"),
      },
    );

    expect(evidence.matches[0]?.excerpt).toContain("artwork release");
  });

  it("chooses the newest conversation across CLI and Rails continuity sources", () => {
    const result = mergeAgentMemoryEvidence("Where did we leave off?", [
      {
        verdict: "partial",
        matches: [{
          id: "cli-session",
          path: "conversations/cli",
          excerpt: "An older CLI conversation.",
          stale: false,
          kind: "conversation",
          updatedAt: "2026-07-20T03:00:00.000Z",
        }],
      },
      {
        verdict: "partial",
        matches: [{
          id: "rails-session",
          path: "rails/conversation/2",
          excerpt: "The newest conversation happened in Rails.",
          stale: false,
          kind: "conversation",
          updatedAt: "2026-07-20T04:00:00.000Z",
        }],
      },
    ]);

    expect(result.matches.map((match) => match.id)).toEqual(["rails-session"]);
  });

  it("bounds merged memory before it enters the model prompt", () => {
    const result = mergeAgentMemoryEvidence("Tell me about artwork", [
      {
        verdict: "sufficient",
        matches: Array.from({ length: 6 }, (_, index) => ({
          id: `memory-${index}`,
          path: `memory/${index}`,
          excerpt: "artwork ".repeat(1_000),
          stale: false,
          kind: "archive" as const,
        })),
      },
    ]);

    expect(result.matches.reduce((total, match) => total + match.excerpt.length, 0))
      .toBeLessThanOrEqual(12_000);
  });
});
