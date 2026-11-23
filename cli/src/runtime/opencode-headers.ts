import { randomUUID } from "crypto";

const SESSION_ID = randomUUID();

export function opencodeHeaders(baseURL: string | undefined): Record<string, string> {
  if (!baseURL) return {};
  try {
    if (new URL(baseURL).host !== "opencode.ai") return {};
  } catch {
    return {};
  }
  return { "user-agent": "flyd/1.0", "x-opencode-session": SESSION_ID };
}
