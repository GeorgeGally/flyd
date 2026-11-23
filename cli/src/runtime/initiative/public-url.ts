/**
 * Conservative public locator guard for background initiative egress.
 * The actual HTTP backend must also reject internal redirects/resolved IPs.
 */
export function safePublicLocator(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.username || url.password || url.port && url.port !== "443") return null;
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    // A public-looking URL may contain an embedded credential or signed token.
    if ([...url.searchParams.keys()].some(key => /(?:token|secret|credential|api[-_]?key|auth|access[-_]?key|signature|session)/i.test(key))) return null;
    if (!host || host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")
      || host.includes(":") || /^\d+\.\d+\.\d+\.\d+$/.test(host)
      || host === "0.0.0.0") return null;
    return url.href;
  } catch { return null; }
}
