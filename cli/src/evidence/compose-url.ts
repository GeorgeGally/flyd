const EVIDENCE_SURFACE_ORIGIN = "http://127.0.0.1:3000";
const SURFACE_PATH = /^\/surface(?:\/[a-f0-9-]+)?$/;

export function evidenceSurfaceUrl(surfaceId?: string): string {
  return surfaceId
    ? `${EVIDENCE_SURFACE_ORIGIN}/surface/${encodeURIComponent(surfaceId)}`
    : `${EVIDENCE_SURFACE_ORIGIN}/surface`;
}

/**
 * Only Core-owned loopback evidence dossier URLs may cross the model boundary.
 * A malformed, credentialed, query-bearing, or external URL falls back to the
 * generic local surface route rather than being opened by the Mac adapter.
 */
export function normalizeEvidenceSurfaceUrl(value: string | undefined): string {
  if (!value) return evidenceSurfaceUrl();
  try {
    const url = new URL(value);
    if (
      url.protocol !== "http:" ||
      url.hostname !== "127.0.0.1" ||
      url.port !== "3000" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !SURFACE_PATH.test(url.pathname)
    ) {
      return evidenceSurfaceUrl();
    }
    return url.toString();
  } catch {
    return evidenceSurfaceUrl();
  }
}
