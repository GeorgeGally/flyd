import { isReadOnlyCommand } from "../../runtime/tool-policy.js";
import type { ToolProfile } from "../../runtime/conversation-responder.js";

// Tool sets the chat evals compare, so each phase of the Flyd / Chief of Staff
// split is measured against today's Flyd on the same cases
// (docs/plans/2026-10-30-flyd-chief-of-staff-split-plan.md, Phase 0).
//
//   current  every tool Flyd has today
//   split    Flyd after the split, as built so far: it never changes code
//            (no edit_file / write_file, and a bash that writes is refused).
//            The management tools leave as their Chief of Staff
//            replacements (hand_off, tell_work, work_status) arrive.

/** The tools Flyd keeps after the split never include these: specialists change code. */
const CODE_CHANGES = new Set(["edit_file", "write_file"]);

export const TOOL_PROFILES: Record<string, ToolProfile> = {
  current: { offer: (tools) => tools },
  split: {
    offer: (tools) => tools.filter((tool) => !CODE_CHANGES.has(tool.name)),
    refuse: (name, input) => {
      if (CODE_CHANGES.has(name)) return "Not available: Flyd never changes code; hand the change off.";
      if (name === "bash" && !isReadOnlyCommand(String(input.command ?? ""))) return "Not available: Flyd only reads with the shell; hand the change off.";
      return null;
    },
  },
};

/** The named profile, or an error that lists the ones there are. */
export function toolProfile(name: string): ToolProfile {
  const profile = TOOL_PROFILES[name];
  if (!profile) throw new Error(`Unknown tool profile: ${name} (have ${Object.keys(TOOL_PROFILES).join(", ")})`);
  return profile;
}
