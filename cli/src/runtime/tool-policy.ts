// Autonomy policy for chat tool calls. George wants Flyd to act, not ask:
// the default ("trusted") runs everything local and reversible on its own and
// only checks in before actions that cannot be undone or that leave the
// machine (push, publish, send, delete, pipe-to-shell). Web text is evidence,
// never instructions, so once a turn has read the web, arbitrary shell and
// AppleScript also check in — the one place injected text could steer it.
//
//   FLYD_AUTONOMY=full     never ask
//   FLYD_AUTONOMY=trusted  (default) ask only for irreversible/outward actions
//   FLYD_AUTONOMY=ask      ask before any state change

export type ActionCategory = "read" | "local" | "outward" | "destructive";
export type AutonomyLevel = "full" | "trusted" | "ask";

export type ToolDecision =
  | { kind: "allow" }
  | { kind: "confirm"; reason: string; category: ActionCategory }
  | { kind: "deny"; reason: string; category: ActionCategory };

export interface ToolPolicyState {
  /** True once web or other external content has been read this turn. */
  tainted: boolean;
  /** Kinds of action George said no to this turn. A no holds for the turn: no rephrased retry, no second ask. */
  declined?: Set<ActionCategory>;
}

export function autonomyLevel(value = process.env.FLYD_AUTONOMY): AutonomyLevel {
  const level = value?.trim().toLowerCase();
  return level === "full" || level === "ask" ? level : "trusted";
}

// "Always" answers last for the whole session (process), per category.
const sessionAllowed = new Set<ActionCategory>();

export function allowForSession(category: ActionCategory): void {
  sessionAllowed.add(category);
}

/** Test-only. */
export function resetSessionAllowances(): void {
  sessionAllowed.clear();
}

/** Tools whose output is third-party content that could carry injected instructions. */
const UNTRUSTED_OUTPUT_TOOLS = new Set(["read_url", "web_search"]);

export function marksTurnUntrusted(name: string): boolean {
  return UNTRUSTED_OUTPUT_TOOLS.has(name);
}

const DESTRUCTIVE = /\brm\s+-[a-z]*[rf]|\bgit\s+(?:push\s+(?:[^\n]*\s)?(?:--force(?:-with-lease)?|-f)\b|reset\s+--hard|clean\s+-[a-z]*f|checkout\s+--\s|restore\s+(?:--staged\s+)?\.|branch\s+-D\b)|\bsudo\b|\b(?:curl|wget)\b[^|\n]*\|\s*(?:sudo\s+)?(?:ba|z)?sh\b|\bmkfs\b|\bdd\s+if=|\bchmod\s+-R\b|\bkillall\b|\bdiskutil\s+erase/i;

const OUTWARD = /\bgit\s+push\b|\b(?:npm|yarn|pnpm)\s+publish\b|\bgh\s+(?:pr\s+(?:create|merge|close|comment|review|edit)|issue\s+(?:create|close|comment|edit)|release\s+create|repo\s+(?:create|delete)|api\b)|\bcurl\b[^\n]*(?:-X\s*(?:POST|PUT|PATCH|DELETE)\b|\s-d\s|--data\b|-F\s|--form\b|--upload-file\b)|\b(?:fly|vercel|netlify|heroku)\s+deploy\b|\bkamal\s+deploy\b/i;

// Command heads that only read.
const READ_ONLY_HEADS = new Set([
  "ls", "cat", "head", "tail", "wc", "grep", "rg", "egrep", "fgrep", "date", "cal", "echo", "printf", "pwd",
  "which", "whoami", "file", "stat", "du", "df", "sort", "uniq", "cut", "tr", "jq", "diff", "basename",
  "dirname", "realpath", "readlink", "uname", "env", "printenv", "true", "test", "[", "tree", "column", "nl",
  "md5", "shasum", "sw_vers", "uptime", "sleep", "ps", "pgrep", "lsof", "id", "hostname", "groups", "mdfind",
  "mdls", "whereis", "type", "system_profiler", "vm_stat", "top", "netstat", "ifconfig", "scutil", "pmset", "log",
]);

const READ_ONLY_GIT = new Set([
  "status", "log", "diff", "show", "branch", "rev-list", "rev-parse", "blame", "ls-files", "shortlog",
  "describe", "remote", "tag", "stash", "cat-file", "grep", "config", "reflog", "worktree", "merge-base",
  "check-ignore", "ls-tree", "ls-remote", "count-objects", "var", "whatchanged",
]);

/** Verification is how edits get checked; it runs repo code but changes nothing George owns. */
const VERIFY = /^(?:npm\s+(?:test|run\s+(?:test|lint|build|typecheck|check)\b)|npx\s+(?:vitest|tsc\s+--noEmit|eslint)\b|yarn\s+(?:test|lint)\b|pnpm\s+(?:test|lint)\b|bundle\s+exec\s+(?:rspec|rails\s+test)\b|(?:bin\/)?rails\s+test\b|pytest\b|go\s+(?:test|vet)\b|cargo\s+(?:test|check)\b|swift\s+build\b|make\s+(?:test|check|lint)\b|node\s+(?:-v|--version)\b|npm\s+(?:-v|--version|ls|list|view)\b|tsc\s+--noEmit\b)/;

function segmentIsReadOnly(segment: string): boolean {
  // Subshell grouping "( … )" does not change what the command does.
  let text = segment.trim().replace(/^[({]\s*/, "").replace(/\s*[)}]$/, "").trim();
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
  if (head === "gh") {
    // GitHub CLI reads: viewing PRs, issues, runs, and repos changes nothing.
    if (/^gh\s+(?:pr|issue)\s+(?:view|list|status|checks|diff)\b/.test(text)) return true;
    if (/^gh\s+(?:run|workflow|release)\s+(?:list|view)\b/.test(text)) return true;
    if (/^gh\s+repo\s+view\b/.test(text)) return true;
    return false;
  }
  if (head === "pmset" || head === "scutil") return /\s-g\b|--get\b|--dns\b|--proxy\b/.test(text);
  if (head === "log") return /^log\s+(?:show|stream)\b/.test(text);
  if (head === "top") return /\s-l\s*\d/.test(text);
  if (head === "sed") return !/\s-[a-zA-Z]*i/.test(text);
  if (head === "find") return !/-(?:delete|exec|execdir|ok|fprint)\b/.test(text);
  if (head === "awk") return !/\bsystem\s*\(|>\s*"/.test(text);
  return READ_ONLY_HEADS.has(head ?? "");
}

/** Split on shell operators (&&, ||, ;, |, newline) that sit outside quotes. */
export function splitShellSegments(command: string): string[] {
  const segments: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
  for (let index = 0; index < command.length; index += 1) {
    const char = command[index];
    if (quote) {
      if (char === "\\" && quote === '"') { current += char + (command[index + 1] ?? ""); index += 1; continue; }
      if (char === quote) quote = null;
      current += char;
      continue;
    }
    if (char === "'" || char === '"') { quote = char; current += char; continue; }
    if (char === "\\") { current += char + (command[index + 1] ?? ""); index += 1; continue; }
    const pair = command.slice(index, index + 2);
    if (pair === "&&" || pair === "||") { segments.push(current); current = ""; index += 1; continue; }
    if (char === ";" || char === "|" || char === "\n") { segments.push(current); current = ""; continue; }
    current += char;
  }
  segments.push(current);
  return segments;
}

/** Text with quoted literals removed, for operator checks that quotes neutralize. */
function unquoted(command: string, keepDouble = false): string {
  return keepDouble
    ? command.replace(/'[^']*'/g, "''")
    : command.replace(/'[^']*'|"(?:\\.|[^"\\])*"/g, "''");
}

/** True when every piece of a shell command only reads or verifies. */
export function isReadOnlyCommand(command: string): boolean {
  // Output redirection to a file writes; /dev/null and fd duplication do not.
  const withoutSafeRedirects = unquoted(command).replace(/\d?>&\d|&?>{1,2}\s*\/dev\/null/g, "");
  if (/>{1,2}/.test(withoutSafeRedirects)) return false;
  // Substitution runs inside double quotes too; only single quotes neutralize it.
  if (/`|\$\(/.test(unquoted(command, true))) return false;
  return splitShellSegments(command).every(segmentIsReadOnly);
}

/** AppleScript that sends, deletes, buys, or posts leaves the machine or cannot be undone. */
export function classifyAppleScript(script: string): ActionCategory {
  if (/\b(?:delete|empty\s+(?:the\s+)?trash|erase)\b/i.test(script)) return "destructive";
  if (/\bsend\b|\bpost\b|\bpurchase\b|\bbuy\b|\bsubmit\b|\breply\b|\bforward\b|do\s+shell\s+script/i.test(script)) return "outward";
  return "local";
}

export function classifyCommand(command: string): ActionCategory {
  if (DESTRUCTIVE.test(command)) return "destructive";
  if (isReadOnlyCommand(command)) return "read";
  // osascript from the shell is judged by what its script does.
  if (/\bosascript\b/.test(command)) return classifyAppleScript(command);
  if (OUTWARD.test(command)) return "outward";
  return "local";
}

export function classifyToolCall(name: string, input: Record<string, unknown>): ActionCategory {
  switch (name) {
    case "bash": return classifyCommand(String(input.command ?? ""));
    case "edit_file":
    case "write_file":
    case "remember":
      return "local";
    case "schedule": return input.action === "list" ? "read" : "local";
    case "todos": return input.action === "list" ? "read" : "local";
    case "domain_work": return input.action === "ask" ? "local" : "read";
    // Building on its own branch is local; approving a push or deploy for when he lands it is not.
    case "start_coding_task": return Array.isArray(input.after_land) && input.after_land.length ? "outward" : "local";
    case "work_model":
    case "speaking_style":
    case "background_task":
    case "start_knowledge_task":
      return "local";
    // Merging into George's branch or deleting a crew branch is his call, every time.
    case "crew": return input.action === "land" || input.action === "discard" ? "destructive" : "read";
    case "flyd": return input.action === "run_briefing" || input.action === "skillify" || input.action === "improve" ? "local" : "read";
    case "reminders": return input.action === "list" ? "read" : input.action === "delete" ? "destructive" : "local";
    case "mac":
      if (input.action === "applescript") return classifyAppleScript(String(input.script ?? ""));
      return input.action === "clipboard_read" ? "read" : "local";
    default: return "read";
  }
}

function clip(text: string, max = 160): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

function describe(name: string, input: Record<string, unknown>): string {
  switch (name) {
    case "bash": return `run: ${clip(String(input.command ?? ""))}`;
    case "edit_file": return `edit ${clip(String(input.path ?? ""), 80)}`;
    case "write_file": return `write ${clip(String(input.path ?? ""), 80)}`;
    case "remember": return `save to memory: "${clip(String(input.text ?? ""), 80)}"`;
    case "reminders": return input.action === "create"
      ? `create reminder "${clip(String(input.title ?? ""), 60)}"`
      : `${String(input.action)} reminder "${clip(String(input.match ?? ""), 60)}"`;
    case "schedule": return `${String(input.action)} scheduled task "${clip(String(input.task ?? input.id ?? ""), 80)}"`;
    case "mac": return input.action === "applescript"
      ? `run AppleScript: ${clip(String(input.script ?? ""), 120)}`
      : `${String(input.action)} ${clip(String(input.target ?? input.text ?? ""), 80)}`;
    case "start_coding_task": {
      const after = Array.isArray(input.after_land) ? input.after_land.map(String) : [];
      return `build "${clip(String(input.outcome ?? ""), 80)}"${after.length ? `, then ${after.join(" and ")} once you land it` : ""}`;
    }
    case "start_knowledge_task":
      return `research "${clip(String(input.outcome ?? ""), 80)}"`;
    case "domain_work":
      return input.action === "ask" ? `ask a domain boss: "${clip(String(input.question ?? ""), 80)}"` : `inspect domain work ${clip(String(input.id ?? ""), 40)}`;
    default: return `use ${name}`;
  }
}

export function decideToolCall(
  name: string,
  input: Record<string, unknown>,
  state: ToolPolicyState,
  level: AutonomyLevel = autonomyLevel(),
): ToolDecision {
  const category = classifyToolCall(name, input);
  if (category === "read" || level === "full" || sessionAllowed.has(category)) return { kind: "allow" };
  const decision = confirmOrAllow(name, input, category, state, level);
  // A no holds for the turn, but only for what would have been asked again:
  // declining one tainted bash never blocks an edit that needed no approval.
  // A no to sending something out also covers the harder-to-undo version (push → force push).
  if (decision.kind !== "confirm") return decision;
  const declined = state.declined?.has(category) || (category === "destructive" && state.declined?.has("outward"));
  return declined ? { kind: "deny", category, reason: `${describe(name, input)} (George already said no to this kind of action this turn)` } : decision;
}

function confirmOrAllow(
  name: string,
  input: Record<string, unknown>,
  category: ActionCategory,
  state: ToolPolicyState,
  level: AutonomyLevel,
): ToolDecision {
  const action = describe(name, input);
  if (category === "destructive") return { kind: "confirm", category, reason: `${action} (can't be undone)` };
  if (category === "outward") return { kind: "confirm", category, reason: `${action} (leaves this machine)` };
  // Local, reversible work runs on its own unless George chose "ask".
  if (level === "ask") return { kind: "confirm", category, reason: action };
  const steerable = name === "bash" || (name === "mac" && input.action === "applescript") || name === "schedule";
  if (state.tainted && steerable) {
    return { kind: "confirm", category, reason: `${action} (web content was read this turn)` };
  }
  return { kind: "allow" };
}
