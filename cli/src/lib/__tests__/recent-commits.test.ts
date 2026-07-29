import { describe, expect, it } from "vitest";
import { getRecentCommits } from "../recent-commits.js";

const SEP = "\x1f";

describe("getRecentCommits", () => {
  it("parses multi-commit git log output", async () => {
    const output = [
      `aaa111${SEP}aaa${SEP}1785283200${SEP}fix(memory): gate currentness`,
      `bbb222${SEP}bbb${SEP}1785196800${SEP}feat(overlay): add reply mode`,
    ].join("\n");

    const commits = await getRecentCommits("/repo", 5, async () => output);

    expect(commits).toHaveLength(2);
    expect(commits[0]).toEqual({
      hash: "aaa111",
      shortHash: "aaa",
      subject: "fix(memory): gate currentness",
      committedAt: new Date(1785283200 * 1000).toISOString(),
    });
    expect(commits[1].subject).toBe("feat(overlay): add reply mode");
  });

  it("handles an empty repo with no commits", async () => {
    const commits = await getRecentCommits("/repo", 5, async () => "");
    expect(commits).toEqual([]);
  });

  it("passes the requested limit through to the runner", async () => {
    let receivedLimit: number | undefined;
    await getRecentCommits("/repo", 15, async (_root, limit) => {
      receivedLimit = limit;
      return "";
    });
    expect(receivedLimit).toBe(15);
  });

  it("tolerates a commit subject containing colons and punctuation", async () => {
    const output = `aaa${SEP}aaa${SEP}1785283200${SEP}fix: use x1f separator, not colons: safe`;
    const commits = await getRecentCommits("/repo", 5, async () => output);
    expect(commits[0].subject).toBe("fix: use x1f separator, not colons: safe");
  });
});
