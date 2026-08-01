import type {
  CapabilityAdapter,
  CapabilityProbe,
  EvidenceItem,
  EvidenceReadRequest,
  EvidenceSearchRequest,
} from "../types.js";
import {
  fetchJson,
  fetchWithTimeout,
  makeEvidenceItem,
  type FetchLike,
} from "./common.js";

const API_ROOT = "https://api.github.com";

interface GitHubAdapterOptions {
  fetchFn?: FetchLike;
  token?: string;
  now?: () => Date;
}

interface GitHubRepo {
  id: number;
  full_name: string;
  html_url: string;
  description?: string | null;
  language?: string | null;
  stargazers_count?: number;
  forks_count?: number;
  pushed_at?: string | null;
  updated_at?: string | null;
  owner?: { login?: string };
  default_branch?: string;
  score?: number;
}

interface GitHubIssue {
  id: number;
  number: number;
  title: string;
  body?: string | null;
  html_url: string;
  updated_at?: string;
  created_at?: string;
  user?: { login?: string };
  repository_url?: string;
  pull_request?: unknown;
  score?: number;
}

interface SearchResponse<T> {
  items?: T[];
}

interface ContentResponse {
  content?: string;
  encoding?: string;
  html_url?: string;
  name?: string;
  path?: string;
  sha?: string;
}

function apiHeaders(token?: string): Record<string, string> {
  return {
    Accept: "application/vnd.github+json",
    "User-Agent": "flyd-evidence-engine",
    "X-GitHub-Api-Version": "2022-11-28",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

function decodeContent(response: ContentResponse): string {
  if (!response.content) return "";
  if (response.encoding === "base64") {
    return Buffer.from(response.content.replace(/\n/g, ""), "base64").toString("utf8");
  }
  return response.content;
}

function repoSummary(repo: GitHubRepo): string {
  return [
    repo.description || "",
    repo.language ? `Language: ${repo.language}` : "",
    typeof repo.stargazers_count === "number" ? `Stars: ${repo.stargazers_count}` : "",
    typeof repo.forks_count === "number" ? `Forks: ${repo.forks_count}` : "",
  ].filter(Boolean).join("\n");
}

function issueSummary(issue: GitHubIssue): string {
  return [
    issue.body || "",
    issue.pull_request ? "Type: pull request" : "Type: issue",
  ].filter(Boolean).join("\n");
}

interface ParsedGitHubLocator {
  owner: string;
  repo: string;
  kind: "repo" | "blob" | "issue" | "pull" | "release";
  path?: string;
  ref?: string;
  number?: number;
  tag?: string;
}

function parseLocator(locator: string): ParsedGitHubLocator | null {
  let url: URL;
  try {
    url = new URL(locator);
  } catch {
    return null;
  }
  if (url.hostname !== "github.com" && url.hostname !== "www.github.com") return null;

  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length < 2) return null;
  const [owner, repo] = parts;
  if (!owner || !repo) return null;

  if (parts[2] === "blob" && parts.length >= 5) {
    return { owner, repo, kind: "blob", ref: parts[3], path: parts.slice(4).join("/") };
  }
  if (parts[2] === "issues" && Number(parts[3])) {
    return { owner, repo, kind: "issue", number: Number(parts[3]) };
  }
  if (parts[2] === "pull" && Number(parts[3])) {
    return { owner, repo, kind: "pull", number: Number(parts[3]) };
  }
  if (parts[2] === "releases" && parts[3] === "tag" && parts[4]) {
    return { owner, repo, kind: "release", tag: decodeURIComponent(parts.slice(4).join("/")) };
  }
  return { owner, repo, kind: "repo" };
}

export class GitHubRestAdapter implements CapabilityAdapter {
  readonly id = "github:rest";
  readonly capability = "github" as const;
  readonly priority = 20;
  readonly operations = ["read", "search"] as const;
  readonly signals = ["code", "discussion", "first_party", "reference"] as const;

  private readonly fetchFn: FetchLike;
  private readonly token?: string;
  private readonly now: () => Date;

  constructor(options: GitHubAdapterOptions = {}) {
    this.fetchFn = options.fetchFn ?? fetch;
    this.token = options.token;
    this.now = options.now ?? (() => new Date());
  }

  async probe(): Promise<CapabilityProbe> {
    try {
      const response = await fetchWithTimeout(this.fetchFn, `${API_ROOT}/rate_limit`, {
        headers: apiHeaders(this.token),
      }, 4_000);
      if (response.status === 401) {
        return {
          status: "auth_required",
          reason: "configured GitHub token was rejected",
          fix: "Refresh GITHUB_TOKEN or GH_TOKEN",
        };
      }
      if (response.status === 403 && response.headers.get("x-ratelimit-remaining") === "0") {
        return {
          status: "degraded",
          reason: "GitHub REST rate limit exhausted",
          fix: "Set GITHUB_TOKEN or GH_TOKEN for a higher rate limit",
        };
      }
      if (!response.ok) return { status: "unavailable", reason: `GitHub returned HTTP ${response.status}` };
      return {
        status: this.token ? "ready" : "degraded",
        reason: this.token ? undefined : "public unauthenticated API; low rate limit",
        fix: this.token ? undefined : "Set GITHUB_TOKEN or GH_TOKEN for higher limits",
      };
    } catch (error) {
      return {
        status: "unavailable",
        reason: error instanceof Error ? error.message : "GitHub probe failed",
      };
    }
  }

  async search(request: EvidenceSearchRequest): Promise<EvidenceItem[]> {
    const perType = Math.min(Math.max(request.limit, 1), 10);
    const query = encodeURIComponent(request.query);
    const headers = apiHeaders(this.token);

    const [repoPayload, issuePayload] = await Promise.all([
      fetchJson<SearchResponse<GitHubRepo>>(
        this.fetchFn,
        `${API_ROOT}/search/repositories?q=${query}&sort=updated&order=desc&per_page=${perType}`,
        { headers },
      ).catch(() => ({ items: [] })),
      fetchJson<SearchResponse<GitHubIssue>>(
        this.fetchFn,
        `${API_ROOT}/search/issues?q=${query}&sort=updated&order=desc&per_page=${perType}`,
        { headers },
      ).catch(() => ({ items: [] })),
    ]);

    const candidates = [
      ...(repoPayload.items ?? []).map((repo) => ({ type: "repo" as const, score: repo.score ?? 0, repo })),
      ...(issuePayload.items ?? []).map((issue) => ({ type: "issue" as const, score: issue.score ?? 0, issue })),
    ]
      .sort((left, right) => right.score - left.score)
      .slice(0, request.limit);

    return candidates.map((candidate, index) => {
      const rank = index + 1;
      if (candidate.type === "repo") {
        const repo = candidate.repo;
        return makeEvidenceItem({
          capability: this.capability,
          backend: this.id,
          kind: "code",
          title: repo.full_name,
          content: repoSummary(repo),
          locator: repo.html_url,
          sourceItemId: String(repo.id),
          publishedAt: repo.pushed_at || repo.updated_at || undefined,
          author: repo.owner?.login,
          queryLabel: request.queryLabel,
          nativeRank: rank,
          sourceQuality: 0.96,
          now: this.now(),
          metadata: {
            language: repo.language,
            stars: repo.stargazers_count,
            forks: repo.forks_count,
          },
        });
      }

      const issue = candidate.issue;
      return makeEvidenceItem({
        capability: this.capability,
        backend: this.id,
        kind: issue.pull_request ? "code" : "discussion",
        title: issue.title,
        content: issueSummary(issue),
        locator: issue.html_url,
        sourceItemId: String(issue.id),
        publishedAt: issue.updated_at || issue.created_at,
        author: issue.user?.login,
        queryLabel: request.queryLabel,
        nativeRank: rank,
        sourceQuality: 0.94,
        now: this.now(),
        metadata: { number: issue.number, pullRequest: Boolean(issue.pull_request) },
      });
    });
  }

  async read(request: EvidenceReadRequest): Promise<EvidenceItem[]> {
    const parsed = parseLocator(request.locator);
    if (!parsed) throw new Error("GitHub adapter only reads github.com URLs");
    const headers = apiHeaders(this.token);
    const base = `${API_ROOT}/repos/${encodeURIComponent(parsed.owner)}/${encodeURIComponent(parsed.repo)}`;

    if (parsed.kind === "blob" && parsed.path && parsed.ref) {
      const content = await fetchJson<ContentResponse>(
        this.fetchFn,
        `${base}/contents/${parsed.path.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(parsed.ref)}`,
        { headers },
      );
      const body = decodeContent(content);
      return body ? [makeEvidenceItem({
        capability: this.capability,
        backend: this.id,
        kind: "code",
        title: content.path || content.name,
        content: body,
        locator: content.html_url || request.locator,
        sourceItemId: content.sha || request.locator,
        queryLabel: "direct_read",
        nativeRank: 1,
        sourceQuality: 0.98,
        now: this.now(),
      })] : [];
    }

    if ((parsed.kind === "issue" || parsed.kind === "pull") && parsed.number) {
      const issue = await fetchJson<GitHubIssue>(this.fetchFn, `${base}/issues/${parsed.number}`, { headers });
      return [makeEvidenceItem({
        capability: this.capability,
        backend: this.id,
        kind: parsed.kind === "pull" ? "code" : "discussion",
        title: issue.title,
        content: issueSummary(issue),
        locator: issue.html_url,
        sourceItemId: String(issue.id),
        publishedAt: issue.updated_at || issue.created_at,
        author: issue.user?.login,
        queryLabel: "direct_read",
        nativeRank: 1,
        sourceQuality: 0.96,
        now: this.now(),
      })];
    }

    if (parsed.kind === "release" && parsed.tag) {
      const release = await fetchJson<{
        id: number;
        name?: string;
        tag_name: string;
        body?: string;
        html_url: string;
        published_at?: string;
        author?: { login?: string };
      }>(this.fetchFn, `${base}/releases/tags/${encodeURIComponent(parsed.tag)}`, { headers });
      return [makeEvidenceItem({
        capability: this.capability,
        backend: this.id,
        kind: "release",
        title: release.name || release.tag_name,
        content: release.body || release.tag_name,
        locator: release.html_url,
        sourceItemId: String(release.id),
        publishedAt: release.published_at,
        author: release.author?.login,
        queryLabel: "direct_read",
        nativeRank: 1,
        sourceQuality: 0.98,
        now: this.now(),
      })];
    }

    const repo = await fetchJson<GitHubRepo>(this.fetchFn, base, { headers });
    let readme = "";
    try {
      const readmeResponse = await fetchJson<ContentResponse>(this.fetchFn, `${base}/readme`, { headers });
      readme = decodeContent(readmeResponse);
    } catch {
      // A repository without a README is still valid evidence.
    }

    return [makeEvidenceItem({
      capability: this.capability,
      backend: this.id,
      kind: "code",
      title: repo.full_name,
      content: [repoSummary(repo), readme].filter(Boolean).join("\n\n"),
      locator: repo.html_url,
      sourceItemId: String(repo.id),
      publishedAt: repo.pushed_at || repo.updated_at || undefined,
      author: repo.owner?.login,
      queryLabel: "direct_read",
      nativeRank: 1,
      sourceQuality: 0.98,
      now: this.now(),
      metadata: { defaultBranch: repo.default_branch },
    })];
  }
}
