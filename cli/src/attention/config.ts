export const ATTENTION_JUDGE_MODEL = process.env.FLYD_ATTENTION_JUDGE_MODEL ?? process.env.FLYD_MODEL ?? "gpt-4o-mini";
export const ATTENTION_JUDGE_TIMEOUT_MS = 3000;

export const DEFAULT_DAILY_INTERRUPTION_LIMIT = 5;
export const DEFAULT_PROTECTED_START_HOUR = 22;
export const DEFAULT_PROTECTED_END_HOUR = 7;

export const DEFAULT_STRATEGIES = {
  maxSceneClaimsPerScene: 3,
  maxSceneClaimAgeMs: 4 * 60 * 60 * 1000,
  defaultCooldownMs: 30 * 60 * 1000,
  shortCooldownMs: 10 * 60 * 1000,
  longCooldownMs: 60 * 60 * 1000,
};
