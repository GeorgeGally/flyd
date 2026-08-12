import { listRepositories } from "./repository-registry.js";

export interface GitHubPrItem {
  number: number;
  title: string;
  state: "open" | "closed" | "merged";
  url: string;
  branch: string;
  createdAt: string;
}

export interface GitHubIssueItem {
  number: number;
  title: string;
  state: "open" | "closed";
  url: string;
  labels: string[];
  createdAt: string;
}

export interface GitHubSupplement {
  openPrs: GitHubPrItem[];
  recentlyMergedPrs: GitHubPrItem[];
  openIssues: GitHubIssueItem[];
}

// ponytail: defined types + structure, fetch implementation deferred.
// GitHub REST API needs repo owner+name parsed from remote URL.
// Enable when GITHUB_TOKEN is available and network is desired.

export function parseGitHubRepo(remoteUrl: string): { owner: string; name: string } | null {
  const match = remoteUrl.match(/github\.com[:/]([^/]+)\/([^/\s.]+?)(?:\.git)?$/);
  if (!match) return null;
  return { owner: match[1], name: match[2] };
}

export function listReposWithGitHub(): Array<{ repoId: string; root: string; gh: { owner: string; name: string } }> {
  const repos = listRepositories();
  const results: Array<{ repoId: string; root: string; gh: { owner: string; name: string } }> = [];

  for (const repo of repos) {
    if (!repo.remoteUrl) continue;
    const gh = parseGitHubRepo(repo.remoteUrl);
    if (gh) results.push({ repoId: repo.id, root: repo.root, gh });
  }

  return results;
}

export function emptySupplement(): GitHubSupplement {
  return { openPrs: [], recentlyMergedPrs: [], openIssues: [] };
}
