/**
 * Conservative public locator guard for background initiative egress.
 * The actual HTTP backend must also reject internal redirects/resolved IPs.
 */
export function safePublicLocator(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.username || url.password || url.port && url.port !== "443") return null;
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    if (!host || host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")
      || host.includes(":") || /^\d+\.\d+\.\d+\.\d+$/.test(host)
      || host === "0.0.0.0") return null;
    return url.href;
  } catch { return null; }
}
