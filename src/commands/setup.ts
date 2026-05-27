import { shellRcPath } from "../lib/config.js";

const KEYS = [
  { env: "OPENAI_API_KEY", label: "OpenAI" },
  { env: "ANTHROPIC_API_KEY", label: "Anthropic" },
] as const;

export function runSetup(): void {
  const rc = shellRcPath();

  console.log("flyd setup\n");

  for (const { env, label } of KEYS) {
    if (process.env[env]) {
      console.log(`  ${env}  ✓  set`);
    } else {
      console.log(`  ${env}  ✗  (${label}) — add to ${rc}:`);
      console.log(`          export ${env}=<your-key>`);
    }
  }

  const anyMissing = KEYS.some(({ env }) => !process.env[env]);
  if (anyMissing) {
    console.log(`\nAfter editing ${rc}: source ${rc}`);
  } else {
    console.log("\nAll set.");
  }
}
