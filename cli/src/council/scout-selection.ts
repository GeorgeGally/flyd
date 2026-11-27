/** "PostgreSQL 19 Released" / "llm-gemini 0.38.1" — a version line, not a story. */
const BARE_RELEASE = /^(?:[\w.+#-]{2,48}\s+){1,3}v?\d+(?:\.\d+){0,3}\s+released\.?$|^[\w.+#-]{2,48}\s+v?\d+\.\d+(?:\.\d+)?(?:[ab]\d+|-?(?:alpha|beta|rc)\.?\d*)?$/i;

/** A headline that only names a release, which the edition never spends a pick on. */
export function isBareRelease(title: string): boolean {
  return BARE_RELEASE.test(title.trim());
}
