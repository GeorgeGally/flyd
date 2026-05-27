import { createInterface } from "readline";
import { getKey, saveConfig, CONFIG_PATH } from "../lib/config.js";

const KEYS = [
  { key: "OPENAI_API_KEY" as const, label: "OpenAI (default)" },
  { key: "ANTHROPIC_API_KEY" as const, label: "Anthropic (optional)" },
];

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
  console.log("flyd setup\n");

  let wrote = false;

  for (const { key, label } of KEYS) {
    if (getKey(key)) {
      console.log(`  ${key}  ✓  already set\n`);
      continue;
    }

    const val = await prompt(`  ${label}\n  Paste ${key} (enter to skip): `);
    if (!val) {
      console.log("  skipped\n");
      continue;
    }

    saveConfig({ [key]: val });
    console.log(`  ✓  saved to ${CONFIG_PATH}\n`);
    wrote = true;
  }

  console.log(wrote ? "flyd is ready." : "All set.");
}
