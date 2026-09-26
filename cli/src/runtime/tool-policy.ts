// Approval policy for chat tool calls. Chat tools run on George's machine,
// not in a sandbox, so the default is: inspection runs freely, anything that
// changes state outside a plain repo edit asks first, and once untrusted web
// content has entered the turn every state-changing call asks first — web text
// is evidence, never instructions (AGENTS.md), and this is where that is enforced.

export type ToolDecision =
  | { kind: "allow" }
  | { kind: "confirm"; reason: string };

export interface ToolPolicyState {
  /** True once web or other external content has been read this turn. */
  tainted: boolean;
}

/** Tools whose output is third-party content that could carry injected instructions. */
const UNTRUSTED_OUTPUT_TOOLS = new Set(["read_url", "web_search"]);

export function marksTurnUntrusted(name: string): boolean {
  return UNTRUSTED_OUTPUT_TOOLS.has(name);
}

const DESTRUCTIVE = /\brm\s+-[a-z]*[rf]|\bgit\s+(?:push\b|reset\s+--hard|clean\s+-[a-z]*f|checkout\s+--|restore\s+(?:--staged\s+)?\.)|\bsudo\b|\bcurl\b[^|]*\|\s*(?:ba|z)?sh\b|\bmkfs\b|\bdd\s+if=|\bchmod\s+-R\b|\bkillall\b/i;

// Command heads that only read. Anything not listed needs approval.
const READ_ONLY_HEADS = new Set([
  "ls", "cat", "head", "tail", "wc", "grep", "rg", "egrep", "fgrep", "date", "cal", "echo", "printf", "pwd",
  "which", "whoami", "file", "stat", "du", "df", "sort", "uniq", "cut", "tr", "jq", "diff", "basename",
  "dirname", "realpath", "readlink", "uname", "env", "printenv", "true", "test", "[", "tree", "column", "nl",
  "md5", "shasum", "sw_vers", "uptime", "sleep",
]);

const READ_ONLY_GIT = new Set([
  "status", "log", "diff", "show", "branch", "rev-list", "rev-parse", "blame", "ls-files", "shortlog",
  "describe", "remote", "tag", "stash", "cat-file", "grep", "config", "reflog", "worktree", "merge-base",
]);

/** Verification is how edits get checked; it runs repo code but changes nothing George owns. */
const VERIFY = /^(?:npm\s+(?:test|run\s+(?:test|lint|build|typecheck|check)\b)|npx\s+(?:vitest|tsc\s+--noEmit|eslint)\b|yarn\s+(?:test|lint)\b|pnpm\s+(?:test|lint)\b|bundle\s+exec\s+(?:rspec|rails\s+test)\b|(?:bin\/)?rails\s+test\b|pytest\b|go\s+(?:test|vet)\b|cargo\s+(?:test|check)\b|swift\s+build\b|make\s+(?:test|check|lint)\b|node\s+(?:-v|--version)\b|npm\s+(?:-v|--version|ls|list|view)\b|tsc\s+--noEmit\b)/;

function segmentIsReadOnly(segment: string): boolean {
  let text = segment.trim();
  if (!text) return true;
  // Leading VAR=value assignments (e.g. TZ=America/New_York date) do not change the head.
  while (/^[A-Za-z_][A-Za-z0-9_]*=\S*\s+/.test(text)) text = text.replace(/^[A-Za-z_][A-Za-z0-9_]*=\S*\s+/, "");
  if (VERIFY.test(text)) return true;
  const [head, sub, ...rest] = text.split(/\s+/);
  if (head === "cd") return true;
  // `<tool> --version` only prints (unlike e.g. `npm version`, which bumps).
  if (/^[\w.+-]+\s+(?:--version|-V|-v)$/.test(text)) return true;
  if (head === "xargs") {
    // xargs is as safe as the command it runs.
    const tokens = text.split(/\s+/).slice(1);
    while (tokens.length && tokens[0].startsWith("-")) {
      const flag = tokens.shift()!;
      if (/^-[InPLsE]$/.test(flag)) tokens.shift();
    }
    return tokens.length > 0 && segmentIsReadOnly(tokens.join(" "));
  }
  if (head === "git") {
    const gitSub = sub === "-C" ? rest[1] : sub;
    if (gitSub === "add" && /\s(?:--dry-run|-n)\b/.test(text)) return true;
    if (!READ_ONLY_GIT.has(gitSub ?? "")) return false;
    // Subcommands that are read-only only without write flags.
    if (gitSub === "branch" && /\s-(?:d|D|m|M|c|C)\b|--delete|--move/.test(text)) return false;
    if (gitSub === "stash" && !/\bstash\s+(?:list|show)\b/.test(text)) return false;
    if (gitSub === "tag" && !/\btag\s*(?:$|-l\b|--list\b)/.test(text)) return false;
    if (gitSub === "remote" && /\bremote\s+(?:add|remove|rm|rename|set-url|prune)\b/.test(text)) return false;
    if (gitSub === "config" && !/--(?:get|list|get-all)\b|\s-l\b/.test(text)) return false;
    if (gitSub === "worktree" && !/\bworktree\s+list\b/.test(text)) return false;
    return true;
  }
  if (head === "sed") return !/\s-[a-zA-Z]*i/.test(text);
  if (head === "find") return !/-(?:delete|exec|execdir|ok|fprint)\b/.test(text);
  if (head === "awk") return !/\bsystem\s*\(|>\s*"/.test(text);
  return READ_ONLY_HEADS.has(head ?? "");
}

/** True when every piece of a shell command only reads or verifies. */
export function isReadOnlyCommand(command: string): boolean {
  // Output redirection to a file writes; /dev/null and fd duplication do not.
  const withoutSafeRedirects = command.replace(/\d?>&\d|&?>{1,2}\s*\/dev\/null/g, "");
  if (/>{1,2}/.test(withoutSafeRedirects)) return false;
  if (/`|\$\(/.test(command)) return false;
  return command.split(/&&|\|\||;|\||\n/).every(segmentIsReadOnly);
}

function clip(text: string, max = 160): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

export function decideToolCall(
  name: string,
  input: Record<string, unknown>,
  state: ToolPolicyState,
): ToolDecision {
  const taintNote = "web content was read this turn, so actions need your OK";
  switch (name) {
    case "bash": {
      const command = String(input.command ?? "");
      if (DESTRUCTIVE.test(command)) return { kind: "confirm", reason: `destructive command: ${clip(command)}` };
      if (isReadOnlyCommand(command)) return { kind: "allow" };
      return { kind: "confirm", reason: `run: ${clip(command)}` };
    }
    case "edit_file":
    case "write_file":
      return state.tainted
        ? { kind: "confirm", reason: `${name === "edit_file" ? "edit" : "write"} ${clip(String(input.path ?? ""), 80)} (${taintNote})` }
        : { kind: "allow" };
    case "reminders":
      return input.action === "create" && state.tainted
        ? { kind: "confirm", reason: `create reminder "${clip(String(input.title ?? ""), 60)}" (${taintNote})` }
        : { kind: "allow" };
    case "remember":
      return state.tainted
        ? { kind: "confirm", reason: `save to memory: "${clip(String(input.text ?? ""), 80)}" (${taintNote})` }
        : { kind: "allow" };
    default:
      return { kind: "allow" };
  }
}
