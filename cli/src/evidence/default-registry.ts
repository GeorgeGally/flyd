import { CapabilityRegistry } from "./capability-registry.js";
import { GitHubRestAdapter } from "./adapters/github-rest.js";
import { RssAdapter } from "./adapters/rss.js";
import { JinaReaderAdapter, JinaSearchAdapter } from "./adapters/web-jina.js";
import { YoutubeYtDlpAdapter } from "./adapters/youtube-ytdlp.js";
import type { CommandRunner, FetchLike } from "./adapters/common.js";

export interface DefaultEvidenceRegistryOptions {
  env?: NodeJS.ProcessEnv;
  fetchFn?: FetchLike;
  commandRunner?: CommandRunner;
  now?: () => Date;
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
    new RssAdapter(sharedHttp),
    new YoutubeYtDlpAdapter({
      commandRunner: options.commandRunner,
      now,
    }),
  ], now);
}
