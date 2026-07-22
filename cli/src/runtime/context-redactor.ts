const PRIVATE_KEY_BLOCK = /-----BEGIN [^-\r\n]*PRIVATE KEY-----[\s\S]*?-----END [^-\r\n]*PRIVATE KEY-----/g;
const SECRET_ASSIGNMENT = /\b([A-Za-z0-9_]*(?:api[_-]?key|token|secret|password|credential)[A-Za-z0-9_]*)(\s*[:=]\s*)(["']?)([^\s,"'}]+)/gi;
const BEARER_TOKEN = /\b(Bearer\s+)[A-Za-z0-9._~-]{8,}/gi;
const KNOWN_TOKEN = /\b(?:sk-(?:or-v1-)?|gh[pousr]_|xox[baprs]-)[A-Za-z0-9_-]{8,}\b/g;

export function redactSensitiveText(value: string): string {
  return value
    .replace(PRIVATE_KEY_BLOCK, "[REDACTED PRIVATE KEY]")
    .replace(SECRET_ASSIGNMENT, (_match, key: string, separator: string, quote: string) => (
      `${key}${separator}${quote}[REDACTED]`
    ))
    .replace(BEARER_TOKEN, "$1[REDACTED]")
    .replace(KNOWN_TOKEN, "[REDACTED]");
}
