// How a news story names where it came from.

/** Where a searched story came from, as he'd name it: "r/vjing", "GitHub · owner/repo", the site, not a bare "reddit" or "github". Pure. */
export function sourceLabel(source: string, url: string): string {
  if (!/^(?:web|github|reddit|youtube|hackernews|x|rss)$/i.test(source.trim())) return source;
  try {
    const { hostname, pathname } = new URL(url);
    const host = hostname.replace(/^(?:www|old|m)\./, "");
    const parts = pathname.split("/").filter(Boolean);
    if (host === "reddit.com" && parts[0] === "r" && parts[1]) return `r/${parts[1]}`;
    if (host === "github.com" && parts[1]) return `GitHub · ${parts[0]}/${parts[1]}`;
    if (host === "news.ycombinator.com") return "Hacker News";
    if (host === "youtube.com" || host === "youtu.be") return "YouTube";
    return host || source;
  } catch {
    return source;
  }
}
