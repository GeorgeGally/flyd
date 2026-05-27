import { createInterface } from "readline";
import { appendFileSync, existsSync } from "fs";
import { shellRcPath } from "../lib/config.js";

const KEYS = [
  { env: "OPENAI_API_KEY", label: "OpenAI (default)" },
  { env: "ANTHROPIC_API_KEY", label: "Anthropic (optional)" },
] as const;

function prompt(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

export async function runSetup(): Promise<void> {
  const rc = shellRcPath();
  console.log("flyd setup\n");

  let wrote = false;

  for (const { env, label } of KEYS) {
    if (process.env[env]) {
      console.log(`  ${env}  ✓  already set\n`);
      continue;
    }

    const val = await prompt(`  ${label}\n  Paste ${env} (enter to skip): `);
    if (!val) {
      console.log("  skipped\n");
      continue;
    }

    appendFileSync(rc, `\nexport ${env}="${val}"\n`, "utf8");
    console.log(`  ✓  written to ${rc}\n`);
    wrote = true;
  }

  if (wrote) {
    console.log(`Run: source ${rc}`);
    console.log("Then flyd is ready.\n");
  } else {
    console.log("All set.\n");
  }
}
