import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";

// Chat's read_url fetches whatever the model asks for. Without a guard, a
// prompt-injected page could point it at Flyd Core on loopback, the LAN, or a
// cloud metadata endpoint. Public web only; every redirect hop is re-checked.

export type HostLookup = (hostname: string) => Promise<string[]>;

const defaultLookup: HostLookup = async (hostname) =>
  (await dnsLookup(hostname, { all: true, verbatim: true })).map((entry) => entry.address);

function ipv4Private(address: string): boolean {
  const [a, b] = address.split(".").map(Number);
  return a === 0 || a === 10 || a === 127
    || (a === 100 && b >= 64 && b <= 127) // CGNAT
    || (a === 169 && b === 254) // link-local, cloud metadata
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || (a === 198 && (b === 18 || b === 19)) // benchmarking
    || a >= 224; // multicast + reserved
}

export function isPrivateAddress(address: string): boolean {
  const bare = address.replace(/^\[|\]$/g, "").toLowerCase();
  const mapped = bare.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return ipv4Private(mapped[1]);
  if (isIP(bare) === 4) return ipv4Private(bare);
  if (isIP(bare) === 6) {
    return bare === "::" || bare === "::1"
      || /^f[cd][0-9a-f]{2}:/.test(bare) // unique local
      || /^fe[89ab][0-9a-f]:/.test(bare) // link-local
      || /^ff/.test(bare); // multicast
  }
  return false;
}

const BLOCKED_HOSTNAME = /^(?:localhost|.*\.localhost|.*\.local|.*\.internal|.*\.lan|.*\.home\.arpa|metadata\.google\.internal)$/i;

/** Returns a reason the URL must not be fetched, or null when it is public web. */
export async function publicUrlProblem(raw: string, lookup: HostLookup = defaultLookup): Promise<string | null> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return "not a valid URL";
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return `${url.protocol} URLs are not allowed`;
  if (url.username || url.password) return "URLs with embedded credentials are not allowed";
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (BLOCKED_HOSTNAME.test(host)) return `${host} is a local or private host`;
  if (isIP(host)) return isPrivateAddress(host) ? `${host} is a private or local address` : null;
  let addresses: string[];
  try {
    addresses = await lookup(host);
  } catch {
    return null; // Unresolvable hosts fail at fetch time; nothing private was reached.
  }
  const privateAddress = addresses.find(isPrivateAddress);
  return privateAddress ? `${host} resolves to private address ${privateAddress}` : null;
}

export interface GuardedFetchOptions {
  signal?: AbortSignal;
  headers?: Record<string, string>;
  lookup?: HostLookup;
  maxRedirects?: number;
}

/** GET a public URL, following redirects manually so each hop is checked. */
export async function fetchPublicUrl(
  fetchFn: (input: string, init?: RequestInit) => Promise<Response>,
  raw: string,
  options: GuardedFetchOptions = {},
): Promise<Response> {
  let current = raw;
  for (let hop = 0; hop <= (options.maxRedirects ?? 5); hop += 1) {
    const problem = await publicUrlProblem(current, options.lookup);
    if (problem) throw new Error(`Blocked ${current}: ${problem}. read_url only fetches the public web.`);
    const response = await fetchFn(current, {
      signal: options.signal,
      redirect: "manual",
      credentials: "omit",
      headers: options.headers,
    });
    const location = response.headers.get("location");
    if (response.status >= 300 && response.status < 400 && location) {
      current = new URL(location, current).toString();
      continue;
    }
    return response;
  }
  throw new Error(`Too many redirects starting at ${raw}`);
}
