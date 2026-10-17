// A status line George is shown must name the concrete thing being done. A
// placeholder ("Working on it", "Looking into it", "Remembering what I know
// about this") says nothing; the prompt rule alone does not hold it out, so it
// is checked here, at the boundary every relayed status update crosses. This
// module is deliberately dependency-free: the page and the living line import
// it, so it must pull nothing (no config, no fs) into their bundles.

// ponytail: the denylist is the fixed set of bare activity phrases. A general
// "no concrete object" judge would be a model call; add one only if bare
// phrases outside this list keep reaching George.
const PLACEHOLDER_STATUS = /^(?:(?:ok(?:ay)?|sure|right|alright|sir|george)[,!:.]?\s+)?(?:(?:i'?m|i am|we'?re|still|just|now)\s+)?(?:remembering what i know(?: about (?:this|that|it))?|looking this up|looking (?:this|that|it) up|looking into (?:it|this|that)|working on (?:it|this|that)|working|on it|thinking(?: it through)?|checking(?: on)? (?:it|this|that)|one moment(?: please)?|one sec(?:ond)?|hang on|bear with me|processing|in progress|getting (?:on|to) it)(?:[,\s]+(?:now|for you|sir|please))*[\s.!…,]*$/i;

/** Whether a status update only says that work is happening, naming nothing concrete George can tie it to. */
export function isPlaceholderStatus(text: string): boolean {
  const line = text.replace(/\s+/g, " ").trim();
  return !line || PLACEHOLDER_STATUS.test(line);
}

/** The tool call under way: its name and its primary argument, e.g. { tool: "Searching memory for", argument: "Canva" }. */
export interface InFlightTool {
  tool: string;
  argument?: string;
}

/** A concrete status built from the tool call under way: the tool and the thing it is about, e.g. "Searching memory for Canva"; `""` when it names no thing. */
export function statusFromTool(inFlight: InFlightTool): string {
  const tool = inFlight.tool.replace(/\s+/g, " ").trim();
  const argument = inFlight.argument?.replace(/\s+/g, " ").trim() ?? "";
  if (!argument) return "";
  if (new RegExp(argument.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i").test(tool)) return tool;
  const clipped = argument.length > 60 ? `${argument.slice(0, 59).trimEnd()}…` : argument;
  return `${tool} ${clipped}`;
}

/**
 * What George is shown for a relayed status update: its own line when it names something concrete, else a status
 * built from the tool call under way. A placeholder is never passed on, built or relayed; `""` when the tool call
 * names nothing concrete either, so the caller can keep the line it had.
 */
export function relayStatus(text: string, inFlight?: InFlightTool): string {
  const line = text.replace(/\s+/g, " ").trim();
  if (line && !isPlaceholderStatus(line)) return line;
  const built = inFlight ? statusFromTool(inFlight) : "";
  return built && !isPlaceholderStatus(built) ? built : "";
}
