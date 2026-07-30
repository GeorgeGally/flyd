import { CapabilityRegistry } from "./capability-registry.js";
import { GitHubRestAdapter } from "./adapters/github-rest.js";
import { HackerNewsAdapter } from "./adapters/hackernews.js";
import { RedditAdapter } from "./adapters/reddit.js";
import { RssAdapter } from "./adapters/rss.js";
import { JinaReaderAdapter, JinaSearchAdapter } from "./adapters/web-jina.js";
import { XApiAdapter } from "./adapters/x-api.js";
import { YoutubeYtDlpAdapter } from "./adapters/youtube-ytdlp.js";
import type { CommandRunner, FetchLike } from "./adapters/common.js";

export interface DefaultEvidenceRegistryOptions {
  env?: NodeJS.ProcessEnv;
  fetchFn?: FetchLike;
  commandRunner?: CommandRunner;
  now?: () => Date;
  socialMinimumIntervalMs?: number;
}

export function createDefaultEvidenceRegistry(
  options: DefaultEvidenceRegistryOptions = {},
): CapabilityRegistry {
  const env = options.env ?? process.env;
  const now = options.now ?? (() => new Date());
  const sharedHttp = {
    fetchFn: options.fetchFn,
    now,
  };
  const socialMinimumIntervalMs = options.socialMinimumIntervalMs;

  return new CapabilityRegistry([
    new JinaReaderAdapter({
      ...sharedHttp,
      apiKey: env.JINA_API_KEY,
    }),
    new JinaSearchAdapter({
      ...sharedHttp,
      apiKey: env.JINA_API_KEY,
    }),
    new GitHubRestAdapter({
      ...sharedHttp,
      token: env.GITHUB_TOKEN || env.GH_TOKEN,
    }),
    new HackerNewsAdapter({
      ...sharedHttp,
      minimumIntervalMs: socialMinimumIntervalMs,
    }),
    new RedditAdapter({
      ...sharedHttp,
      accessToken: env.REDDIT_ACCESS_TOKEN,
      minimumIntervalMs: socialMinimumIntervalMs,
    }),
    new RssAdapter(sharedHttp),
    new XApiAdapter({
      ...sharedHttp,
      bearerToken: env.X_BEARER_TOKEN || env.TWITTER_BEARER_TOKEN,
      minimumIntervalMs: socialMinimumIntervalMs,
    }),
    new YoutubeYtDlpAdapter({
      commandRunner: options.commandRunner,
      now,
    }),
  ], now);
}
