import { FIXTURE_PROMPTS } from "../evals/chat/fixture-prompts.js";

const normalize = (text: string) => text.trim().replace(/\s+/g, " ").toLowerCase();

export function refuseLeakedLaunch(requests: string[]): string | null {
  if (process.env.FLYD_EVAL === "1") return "Error: test_process (non-retryable): FLYD_EVAL is set";
  for (const request of requests) {
    const normalized = normalize(request);
    const match = FIXTURE_PROMPTS.find(({ prompt }) => {
      const fixture = normalize(prompt);
      return normalized === fixture || normalized === `about the artefact "${fixture}"`;
    });
    if (match) return `Error: fixture_request (non-retryable): ${match.id}`;
  }
  return null;
}
