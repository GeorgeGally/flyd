import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

export interface RecentCommit {
  hash: string;
  shortHash: string;
  subject: string;
  committedAt: string;
}

export type CommitLogRunner = (root: string, limit: number) => Promise<string>;

const UNIT_SEPARATOR = "\x1f";

const defaultCommitLogRunner: CommitLogRunner = async (root, limit) => {
  const { stdout } = await execFileAsync(
    "git",
    ["-C", root, "log", `-n${limit}`, `--format=%H${UNIT_SEPARATOR}%h${UNIT_SEPARATOR}%ct${UNIT_SEPARATOR}%s`],
    { encoding: "utf8", timeout: 5_000 },
  );
  return stdout;
};

export async function getRecentCommits(
  root: string,
  limit = 5,
  run: CommitLogRunner = defaultCommitLogRunner,
): Promise<RecentCommit[]> {
  const output = await run(root, limit);
  return output
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [hash, shortHash, epochSeconds, subject] = line.split(UNIT_SEPARATOR);
      return {
        hash,
        shortHash,
        subject,
        committedAt: new Date(Number(epochSeconds) * 1000).toISOString(),
      };
    });
}
