import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { CONTEXT_DIR } from "./config.js";
import { parse } from "./frontmatter.js";

// Read-priority order: identity first so it survives the char budget.
export const BUNDLE_NAMES = [
  "current_identity",
  "current_constraints",
  "active_projects",
  "recent_history",
  "dormant_context",
] as const;

export type BundleName = typeof BUNDLE_NAMES[number];

export interface ContextBundle {
  name: BundleName;
  body: string;
}

export const EMPTY_BUNDLE_MARKER = "No compiled context.";
export const BUNDLE_BOILERPLATE = "Machine-generated context bundle. Do not edit by hand.";
export const BUNDLE_MAX_CHARS = 1800;
export const BUNDLE_CHAR_BUDGET = 4000;

export function readContextBundles(dir: string = CONTEXT_DIR): ContextBundle[] {
  if (!existsSync(dir)) return [];

  const bundles: ContextBundle[] = [];
  let total = 0;

  for (const name of BUNDLE_NAMES) {
    if (total >= BUNDLE_CHAR_BUDGET) break;
    try {
      const raw = readFileSync(join(dir, `${name}.md`), "utf8");
      const { body } = parse(raw);
      if (body.includes(EMPTY_BUNDLE_MARKER)) continue;
      const cleaned = body
        .split("\n")
        .filter((line) => line.trim() !== BUNDLE_BOILERPLATE)
        .join("\n")
        .trim();
      if (!cleaned) continue;
      const capped = cleaned.slice(0, Math.min(BUNDLE_MAX_CHARS, BUNDLE_CHAR_BUDGET - total));
      bundles.push({ name, body: capped });
      total += capped.length;
    } catch {
      // missing or unreadable bundle — skip
    }
  }

  return bundles;
}
