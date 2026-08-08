---
title: Work Intelligence Execution Loop — Secure Shell, File Ops, and Prompt Hardening
date: 2026-08-09
category: architecture-patterns
module: work-intelligence
problem_type: architecture_pattern
component: service_object
severity: high
applies_when:
  - "building secure command-execution capabilities within an AI assistant"
  - "implementing multi-step task loops with LLM planning"
  - "adding file operations with symlink and path-traversal safety"
  - "designing permission-gated execution for desktop agents"
  - "hardening LLM prompts against injection when user content must coexist with system instructions"
tags:
  - work-intelligence
  - command-execution
  - security-hardening
  - task-loop
  - file-operations
  - prompt-injection
  - foregrond-evidence
  - flyd
related_components:
  - resolve
  - server
  - evidence
---

# Work Intelligence Execution Loop — Secure Shell, File Ops, and Prompt Hardening

## Context

Flyd's work-intelligence loop (Ground → Diagnose → Intervene → Act → Verify → Learn) needed secure execution capabilities: shell commands, file read/write/grep, and multi-step task planning. Each capability was implemented permission-gated (shown to the user, requires explicit approval) but the implementation required careful security design — command validation, path safety, environment isolation, and prompt hardening.

## Guidance

### 1. Document path serialization across the Swift/TypeScript boundary

The `document_path` field bridges the Swift adapter's file-path context into TypeScript Core. The TypeScript `EnvironmentCapture` type reads `document_path` from inside the `environment` JSON object, but the Swift `buildEnvironmentPayload()` was serializing it at the top level of the request body. Result: `document_path` was always `undefined` in Core, and project grounding fell back to app name with low confidence.

**Pattern:** When a field is logically part of the environment, nest it inside the environment object in the JSON body — never at the top level with a different consumer path. Verify end-to-end by tracing the field through serialization, deserialization, and consumption.

```typescript
// Correct: document_path nested inside environment
interface EnvironmentCapture {
  document_path?: string;  // consumed by constructCurrentWork()
}
```

```swift
// Correct: EnvironmentPayload includes documentPath
struct EnvironmentPayload: Codable {
    let documentPath: String?
    enum CodingKeys: String, CodingKey {
        case documentPath = "document_path"
    }
}
```

The `resolveRepositoryFromPath()` function walks up from the document path to find the nearest `.git` directory, then captures branch, HEAD, recent commits, and changed files:

```typescript
export function resolveRepositoryFromPath(documentPath?: string) {
  if (!documentPath) return {};
  const root = findGitRoot(documentPath);
  if (!root) return {};
  const branch = gitOutput(root, 'rev-parse --abbrev-ref HEAD');
  const recentCommits = gitOutput(root, 'log --oneline -5')?.split('\n');
  const changedFiles = gitOutput(root, 'diff --name-only HEAD')?.split('\n');
  return { root, branch, headDigest, statusDigest, recentCommits, changedFiles };
}
```

### 2. Foreground-over-memory prompt architecture

When you have both real-time foreground evidence (what the user is doing *right now*) and stored memory (what they worked on before), foreground must be authoritative. The prompt explicitly tiers the sources and carries an explicit rule:

```
FOREGROUND CONTEXT (authoritative — this is what the user is doing RIGHT NOW):
- Project: CleanX (confidence: high, source: foreground, Document path resolves to Git repository root)
- You are currently in the CleanX repository. This is authoritative foreground evidence — work from this context.
- Repository root: /Users/.../CleanX (branch: main)

GROUND RULES:
- The foreground context is authoritative. If your memory suggests a different project, it is stale — use the foreground.
```

Additional foreground evidence includes: git recent commits (last 5), changed files (dirty working tree), open documents (from AX API window enumeration), artifact kind classification, and work stage inference.

### 3. Command execution safety patterns

`command-execution.ts` implements three-tier validation before any shell process spawns. All patterns are applied at `validateShellCommand()` time — before the command reaches `spawn()`.

**Deny patterns** — catastrophic commands are rejected outright:
```typescript
const DENY_PATTERNS = [
  /^rm\s+-rf\s+\//,        // rm -rf /
  /^rm\s+-rf\s+~/,         // rm -rf ~ (tilde expansion)
  /^dd\s+if=/i,            // dd
  /^mkfs\./i,              // mkfs
  /^diskutil\s+erase/i,    // macOS disk erase
  /^shutdown|^reboot|^halt|^poweroff/,
  /^:\s*\(\)\s*\{/,        // fork bombs
];
```

**Network deny patterns** — remote access and data exfiltration are blocked:
```typescript
const NETWORK_DENY_PATTERNS = [
  /^ssh\b/, /^scp\b/, /^rsync\b.*@/,
  /^nc\s+(?!-z\b)/,        // nc (except -z port check)
  /\bcurl\b/, /\bwget\b/,  // unanchored — catches piping
  /(?:curl|wget)\s+.*?\|/i // pipe-from-curl/wget
];
```

**Interactive deny patterns** — editors, pagers, sudo (without -n):
```typescript
const INTERACTIVE_PATTERNS = [
  /-i\b|--interactive/,
  /\bless\b|\bmore\b|\bvi\b|\bvim\b|\bnano\b/,
  /\bsudo\b(?!\s+-n\b)/,   // sudo without non-interactive flag
];
```

**Safe environment variable whitelist** — only explicitly allowed vars pass to child processes. Prevents credential leakage (`FLYD_MODEL_API_KEY`, `GITHUB_TOKEN`, `OPENAI_API_KEY`):
```typescript
const SAFE_ENV_VARS = new Set([
  'PATH', 'HOME', 'USER', 'SHELL', 'TERM', 'LANG',
  'NVM_DIR', 'NVM_BIN', 'HOMEBREW_PREFIX', 'HOMEBREW_REPOSITORY',
]);
const env: Record<string, string> = {};
for (const [key, value] of Object.entries(process.env)) {
  if (value && SAFE_ENV_VARS.has(key)) env[key] = value;
}
```

**Output buffer caps** — stdout/stderr truncated to 50KB last bytes, preventing memory exhaustion from verbose commands.

**Execution cleanup** — a 5-minute interval sweeps executions older than 30 minutes, killing orphaned processes with `.unref()`.

### 4. File operations security model

`file-operations.ts` implements multiple overlapping defenses against path traversal:

**Symlink-aware containment** — `resolveSafePath()` uses `realpathSync()` on both `projectRoot` and the resolved absolute path. String-based containment checks (like `relative().startsWith('..')`) are insufficient because symlinks inside the project root can point outside:
```typescript
function resolveSafePath(requestedPath: string, projectRoot: string): string | null {
  const absolute = isAbsolute(normalized) ? normalized : resolve(projectRoot, normalized);
  const relPath = relative(projectRoot, absolute);
  if (relPath.startsWith('..')) return null;          // lexical escape
  if (!existsSync(absolute)) return null;
  const realRoot = realpathSync(projectRoot);          // resolve project root symlinks
  const realAbsolute = realpathSync(absolute);         // resolve file symlinks
  if (!realAbsolute.startsWith(realRoot + '/') && realAbsolute !== realRoot) return null;
  return realAbsolute;
}
```

**Write-path symlink detection** — `validateFileWrite()` walks parent directories checking for symlinks via `lstatSync` before allowing writes into new directories (prevents write-through-symlink attacks when the parent directory doesn't yet exist).

**Binary file blocklist** — a `Set` of binary extensions (`.png`, `.pdf`, `.zip`, `.exe`, `.dylib`, `.sqlite`, etc.) blocks both reads and writes.

**`.git` protection** — direct writes to `.git/` paths or `.gitignore`/`.gitmodules`/`.gitattributes` are denied.

**Shell-free grep** — `grepCodebase()` uses `execFileSync('rg', args)` with the pattern passed as an array element, not string-interpolated into a shell command:
```typescript
const args = ['--no-heading', '-n', '--max-count=1'];
if (filePattern) args.push('--glob', filePattern);
args.push('-e', pattern, '--', projectRoot);
const raw = execFileSync('rg', args, { timeout: 15000, ... });
```

**Shell-free mkdir** — uses `mkdirSync(dir, { recursive: true })` instead of `execSync('mkdir -p')`.

**Validation-then-execute with shared resolved path** — `readFile()` and `writeFile()` accept a pre-validated `resolved: string` parameter. The server validates once via `validateFileRead()`/`validateFileWrite()`, then passes `validation.resolved` directly to the execution function. No re-resolution, no TOCTOU gap:
```typescript
const validation = validateFileRead(path, projectRoot);
if (!validation.ok) return error;
const result = readFile({ resolved: validation.resolved, startLine, endLine });
```

### 5. Prompt injection hardening via XML tags

All user-supplied content in prompts is wrapped in XML tags, creating a structural boundary between system instructions and injected data:

```
<user_intent>
${params.intent}
</user_intent>

<project_root>${params.projectRoot}</project_root>

<current_work>
${params.currentWork}
</current_work>
```

This replaces string interpolation like `USER INTENT: "${intent}"` which allows an intent containing `"` to break quoting and inject instructions. The verify prompt uses non-colliding placeholders (`__INTENT__`, `__STEPS_SUMMARY__`) instead of template tokens (`{intent}`, `{steps_summary}`) that could appear in user input and cause `String.replace()` to target user data instead of the template.

### 6. Task loop tool vocabulary validation

`task-loop.ts` defines a fixed 5-tool vocabulary. Step parsing validates each step's `kind` against the known set and rejects the entire plan if any step uses an unknown tool:

```typescript
const VALID_STEP_KINDS = new Set(['read_file', 'grep', 'write_file', 'shell_command', 'verify']);

function parseTaskPlan(raw: string) {
  for (const s of steps) {
    const kind = s.kind as string;
    if (!kind || !VALID_STEP_KINDS.has(kind)) return null;  // reject whole plan
  }
}
```

The planning prompt enforces: "Only use the five tools listed above. Never invent new tool names." Each step has a typed result field (`FileReadResult | FileGrepResult | FileWriteResult | ShellExecutionResult`), preventing the model from fabricating results.

The verify step receives all step statuses including pending/skipped — not just completed/failed — so the LLM verifier can account for intentionally skipped steps.

## Why This Matters

This architecture establishes repeatable patterns for any LLM-driven agent loop operating on local context:

- **Foreground-first evidence** prevents stale-memory hallucination in multi-project workflows
- **XML-tag prompt boundaries** are a zero-dependency prompt-injection defense
- **`realpathSync` + `relative()` checks** handle all known path-traversal vectors (lexical `..`, symlinks, absolute paths)
- **Env var whitelist** prevents the entire class of credential-leak-through-child-process bugs
- **Explicit tool vocabulary validation** prevents models from inventing capabilities they don't have

## When to Apply

- Building any local agent that reasons about a user's current work context
- Adding shell execution or file I/O capabilities to an LLM-powered desktop assistant
- Designing prompts where user content must coexist with system instructions
- Implementing path traversal defenses for file read/write in a local server process
- Adding multi-step task execution with LLM planning

## Examples

### Secure shell execution flow
```
User: "run the tests"
→ Core validates command against deny/network/interactive patterns
→ Swift shows command card: "$ npm test" with approve/reject buttons
→ User approves
→ Core spawns with whitelisted env vars, 30s timeout, output buffer cap
→ Swift polls every 500ms, streams stdout to execution card
→ Result shows exit code + output summary
```

### Prompt with foreground authority
```
FOREGROUND CONTEXT (authoritative — this is what the user is doing RIGHT NOW):
- Project: CleanX (confidence: high, source: foreground)
- You are currently in the CleanX repository. This is authoritative foreground evidence.
- Repository root: /Users/.../CleanX (branch: feat/auth-refactor)

RECENT ACTIVITY:
  abc1234 Add OAuth token validation
  def5678 Wire up login endpoint
  ghi9012 Fix session expiry check

GROUND RULES:
- The foreground context is authoritative. If your memory suggests a different project, it is stale.
```

### Multi-step task plan
```
User: "find all places where we use the deprecated AuthService and replace with OAuthService"
→ Core plans: grep("AuthService") → read_file(affected files) → write_file(replacements) → shell("npm test") → verify
→ Swift shows task plan card with step list + "Execute Plan" / "Reject" buttons
→ User approves → steps execute sequentially, stopping on failure
→ Verify step checks that tests pass and no AuthService references remain
```

## Related

- `docs/solutions/architecture-patterns/flyd-overlay-thin-adapter-typescript-core-2026-07-23.md` — adapter/Core split and execution safety
- `docs/solutions/architecture-patterns/flyd-work-intelligence-pipeline-2026-08-05.md` — pipeline Ground/Diagnose/Intervene architecture
- `docs/solutions/security-issues/overlay-deep-review-auth-bypass-orphaned-tasks-2026-07-23.md` — auth bypass and task safety review
- `docs/solutions/architecture-patterns/decouple-confidence-from-freshness-2026-07-28.md` — confidence/freshness separation in memory retrieval
