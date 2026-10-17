/** Model selection used by setup diagnostics. Conversation learning belongs to
 * the canonical source-backed curator, never automatic promotion into USER.md. */
export function profileLearnModel(chain: string[]): string | undefined {
  return process.env.FLYD_PROFILE_LEARN_MODEL?.trim() || chain[chain.length - 1];
}
