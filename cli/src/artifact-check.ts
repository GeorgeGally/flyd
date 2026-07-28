import { createHash } from "node:crypto";
import { stat, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, normalize, sep } from "node:path";
import type {
  ArtifactClaim,
  ArtifactCheckFailure,
  ArtifactCheckResult,
} from "./verification-types.js";

const DEFAULT_URL_TIMEOUT_MS = 1500;

const DENIED_PATH_PREFIXES = ["/tmp/", "/private/tmp/", "/private/var/folders/", "/var/folders/"];
const DENIED_PATH_SEGMENTS = ["node_modules", ".flyd-worktrees", "scratch"];

/**
 * A path is user-facing when it is absolute and outside temp, scratch, and
 * dependency directories. Applied at handoff time only — intermediate
 * artifacts may legitimately live in worktrees mid-flight.
 */
export function isUserFacingPath(path: string): boolean {
  if (!isAbsolute(path)) return false;
  const normalized = normalize(path);

  const temp = normalize(tmpdir()) + sep;
  if (normalized.startsWith(temp)) return false;
  for (const prefix of DENIED_PATH_PREFIXES) {
    if (normalized.startsWith(prefix)) return false;
  }

  const segments = normalized.split(sep);
  for (const segment of DENIED_PATH_SEGMENTS) {
    if (segments.includes(segment)) return false;
  }
  if (segments.some((s) => s === ".flyd" && segments.includes("worktrees"))) return false;

  return true;
}

export async function checkUrlResponds(
  url: string,
  timeoutMs = DEFAULT_URL_TIMEOUT_MS
): Promise<{ ok: boolean; status?: number }> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false };
  }

  const attempt = async (method: "HEAD" | "GET"): Promise<{ ok: boolean; status?: number }> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    timer.unref?.();
    try {
      const res = await fetch(url, { method, signal: controller.signal, redirect: "follow" });
      return { ok: res.status < 400, status: res.status };
    } catch {
      return { ok: false };
    } finally {
      clearTimeout(timer);
    }
  };

  const head = await attempt("HEAD");
  // Some servers reject HEAD outright; fall back to GET before concluding dead.
  if (!head.ok && (head.status === 405 || head.status === 501 || head.status === undefined)) {
    return attempt("GET");
  }
  return head;
}

const MAGIC_BYTES: Array<{ mediaType: string; bytes: number[] }> = [
  { mediaType: "application/pdf", bytes: [0x25, 0x50, 0x44, 0x46] },
  { mediaType: "image/png", bytes: [0x89, 0x50, 0x4e, 0x47] },
  { mediaType: "image/jpeg", bytes: [0xff, 0xd8, 0xff] },
  { mediaType: "application/zip", bytes: [0x50, 0x4b] },
  { mediaType: "application/gzip", bytes: [0x1f, 0x8b] },
];

function formatMatches(expectedMediaType: string, content: Buffer): boolean {
  const magic = MAGIC_BYTES.find((m) => m.mediaType === expectedMediaType);
  if (magic) {
    return magic.bytes.every((byte, i) => content[i] === byte);
  }
  if (expectedMediaType === "application/json") {
    try {
      JSON.parse(content.toString("utf-8"));
      return true;
    } catch {
      return false;
    }
  }
  if (expectedMediaType.startsWith("text/")) {
    return content.toString("utf-8").trim().length > 0;
  }
  // Unknown media type — nothing to sniff against; do not fail the artifact.
  return true;
}

export async function checkArtifact(
  claim: ArtifactClaim,
  opts: { urlTimeoutMs?: number } = {}
): Promise<ArtifactCheckResult> {
  const failures: ArtifactCheckFailure[] = [];
  const result: ArtifactCheckResult = {
    claim,
    passed: false,
    failures,
    checkedAt: new Date().toISOString(),
  };

  if (claim.kind === "inline_text") {
    result.passed = true;
    return result;
  }

  if (claim.kind === "url") {
    if (!claim.url) {
      failures.push({ check: "url_responds", detail: "Claim has no url" });
      return result;
    }
    const { ok, status } = await checkUrlResponds(claim.url, opts.urlTimeoutMs);
    result.httpStatus = status;
    if (!ok) {
      failures.push({
        check: "url_responds",
        detail: status ? `URL responded with status ${status}` : "URL did not respond",
      });
      return result;
    }
    result.passed = true;
    return result;
  }

  // kind === "file"
  if (!claim.path) {
    failures.push({ check: "exists", detail: "Claim has no path" });
    return result;
  }

  let size: number;
  try {
    const stats = await stat(claim.path);
    if (!stats.isFile()) {
      failures.push({ check: "exists", detail: `Not a regular file: ${claim.path}` });
      return result;
    }
    size = stats.size;
  } catch {
    failures.push({ check: "exists", detail: `File not found: ${claim.path}` });
    return result;
  }

  result.byteSize = size;
  if (size === 0) {
    failures.push({ check: "nonzero", detail: "File is empty" });
  }

  if (!isUserFacingPath(claim.path)) {
    failures.push({
      check: "user_facing",
      detail: "Path is in a temp, scratch, or dependency directory",
    });
  }

  if (size > 0) {
    try {
      const content = await readFile(claim.path);
      result.sha256 = createHash("sha256").update(content).digest("hex");
      if (claim.expectedMediaType && !formatMatches(claim.expectedMediaType, content)) {
        failures.push({
          check: "format",
          detail: `Content does not match claimed media type ${claim.expectedMediaType}`,
        });
      }
    } catch {
      failures.push({ check: "format", detail: "File could not be read" });
    }
  }

  result.passed = failures.length === 0;
  return result;
}

export async function checkArtifacts(
  claims: ArtifactClaim[],
  opts: { urlTimeoutMs?: number } = {}
): Promise<ArtifactCheckResult[]> {
  return Promise.all(claims.map((claim) => checkArtifact(claim, opts)));
}
