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

export const OPENCODE_ENDPOINTS: Record<string, string> = {
  opencode: "https://opencode.ai/zen/v1",
  "opencode-go": "https://opencode.ai/inference/go/v1",
};

export function opencodeEndpoint(provider: string): string {
  return OPENCODE_ENDPOINTS[provider] ?? OPENCODE_ENDPOINTS.opencode;
}
