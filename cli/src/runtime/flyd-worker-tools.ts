import { execFile as nodeExecFile } from "child_process";
import { lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { delimiter, dirname, isAbsolute, join, relative, resolve, sep } from "path";
import { promisify } from "util";
import { sanitizeWorkerEnvironment } from "./worker-adapter.js";

export interface FlydToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

interface CommandResult {
  stdout: string;
  stderr: string;
  exitStatus: number;
}

type CommandRunner = (
  command: string,
  args: string[],
  options: {
    cwd: string;
    env: NodeJS.ProcessEnv;
    timeout: number;
    repositoryRoots: string[];
    writableRepositoryRoots: string[];
  },
) => Promise<CommandResult>;

const COMMAND_PATTERNS: Record<string, RegExp[]> = {
  inspect: [ /^(pwd|ls|find|rg|grep|sed|cat)\b/, /^git (log|show)\b/ ],
  test: [
    /^(bin\/rails test|bundle exec rails test|bundle exec rake test|npm test|npm run test|pnpm test|yarn test)\b/,
    /^(pytest|python -m pytest|python3 -m pytest|cargo test|go test|mix test|swift test|dotnet test|mvn test|gradle test|\.\/gradlew test)\b/,
  ],
  lint: [
    /^(npm run lint|pnpm lint|yarn lint|bundle exec rubocop|standardrb)\b/,
    /^(ruff|python -m ruff|python3 -m ruff|cargo clippy|golangci-lint|mix format --check-formatted)\b/,
  ],
  build: [
    /^(npm run build|pnpm build|yarn build|bin\/rails assets:precompile|bundle exec rake assets:precompile)\b/,
    /^(cargo build|go build|mix compile|swift build|dotnet build|mvn package|gradle build|\.\/gradlew build)\b/,
  ],
  git_status: [ /^git status\b/ ],
  git_diff: [ /^git diff\b/ ],
};
const MAX_TOOL_RESULT_CHARACTERS = 48 * 1024;

function boundedToolResult(value: string): string {
  if (value.length <= MAX_TOOL_RESULT_CHARACTERS) return value;
  const omitted = value.length - MAX_TOOL_RESULT_CHARACTERS;
  return `${value.slice(0, MAX_TOOL_RESULT_CHARACTERS)}\n...[truncated ${omitted} characters]`;
}

export function buildToolCommandSandboxProfile(input: {
  repositoryRoots: string[];
  writableRepositoryRoots: string[];
  temporaryHome: string;
  runtimeRoots: string[];
  deniedTemporaryRoot?: string;
}): string {
  const systemRoots = [
    "/System", "/Library", "/usr", "/bin", "/sbin", "/dev", "/private/etc",
    "/private/var/db", "/private/var/run", "/opt/homebrew",
  ];
  const readRoots = [ ...new Set([
    ...input.repositoryRoots, input.temporaryHome, ...systemRoots, ...input.runtimeRoots,
  ]) ];
  return [
    "(version 1)",
    "(allow default)",
    "(deny network*)",
    '(deny file-read* (subpath "/Users"))',
    '(deny file-read* (subpath "/Volumes"))',
    `(deny file-read* (subpath ${JSON.stringify(input.deniedTemporaryRoot ?? tmpdir())}))`,
    "(deny file-write*)",
    ...readRoots.map((path) => `(allow file-read* (subpath ${JSON.stringify(path)}))`),
    ...input.writableRepositoryRoots.map((path) => `(allow file-write* (subpath ${JSON.stringify(path)}))`),
    `(allow file-write* (subpath ${JSON.stringify(input.temporaryHome)}))`,
    '(allow file-write* (subpath "/dev"))',
    '(allow file-write* (subpath "/private/var/run"))',
  ].join("\n");
}

async function existingRuntimeRoots(environment: NodeJS.ProcessEnv): Promise<string[]> {
  const home = environment.HOME;
  const candidates = [
    ...(environment.PATH ?? "").split(delimiter).filter(Boolean),
    ...(home ? [
      join(home, ".rbenv"), join(home, ".bundle"), join(home, ".nvm"),
      join(home, ".cargo"), join(home, ".rustup"), join(home, ".gradle"),
      join(home, ".m2"), join(home, "go", "pkg", "mod"),
    ] : []),
  ];
  const roots = await Promise.all(candidates.map((path) => realpath(path).catch(() => null)));
  return roots.filter((path): path is string => Boolean(path));
}

const DEFAULT_RUNNER: CommandRunner = async (command, args, options) => {
  if (process.platform !== "darwin") throw new Error("Flyd command sandbox is unavailable on this platform");
  const execFile = promisify(nodeExecFile);
  const home = await mkdtemp(join(tmpdir(), "flyd-tool-home-"));
  try {
    const roots = await Promise.all(options.repositoryRoots.map((path) => realpath(path)));
    const profile = buildToolCommandSandboxProfile({
      repositoryRoots: roots,
      writableRepositoryRoots: await Promise.all(options.writableRepositoryRoots.map((path) => realpath(path))),
      temporaryHome: await realpath(home),
      runtimeRoots: await existingRuntimeRoots(options.env),
      deniedTemporaryRoot: await realpath(tmpdir()),
    });
    const result = await execFile("/usr/bin/sandbox-exec", [ "-p", profile, command, ...args ], {
      cwd: options.cwd,
      env: { ...options.env, HOME: home, TMPDIR: home },
      timeout: options.timeout,
      maxBuffer: 2 * 1024 * 1024,
      encoding: "utf8",
    });
    return { stdout: result.stdout, stderr: result.stderr, exitStatus: 0 };
  } catch (error) {
    const failure = error as Error & { stdout?: string; stderr?: string; code?: number };
    return {
      stdout: failure.stdout ?? "",
      stderr: failure.stderr ?? failure.message,
      exitStatus: typeof failure.code === "number" ? failure.code : 1,
    };
  } finally {
    await rm(home, { recursive: true, force: true });
  }
};

function stringArgument(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== "string") throw new Error(`${key} must be a string`);
  return value;
}

function commandArguments(command: string): string[] {
  if (/[;&|<>`$()\r\n]/.test(command)) {
    throw new Error("Commands containing shell operators are not allowed");
  }
  const args: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
  let escaped = false;
  for (const character of command.trim()) {
    if (escaped) {
      current += character;
      escaped = false;
    } else if (character === "\\" && quote !== "'") {
      escaped = true;
    } else if (quote) {
      if (character === quote) quote = null;
      else current += character;
    } else if (character === "'" || character === '"') {
      quote = character;
    } else if (/\s/.test(character)) {
      if (current) {
        args.push(current);
        current = "";
      }
    } else {
      current += character;
    }
  }
  if (quote || escaped) throw new Error("Command contains an incomplete quote or escape");
  if (current) args.push(current);
  return args;
}

function pathLikeCommandArgument(argument: string): string | null {
  const value = argument.startsWith("-") && argument.includes("=")
    ? argument.slice(argument.indexOf("=") + 1)
    : argument;
  const withoutLine = value.replace(/:\d+(?::\d+)?$/, "");
  return isAbsolute(withoutLine) || withoutLine.startsWith(".") || withoutLine.includes("/")
    ? withoutLine
    : null;
}

function isWithin(root: string, candidate: string): boolean {
  const path = relative(root, candidate);
  return path === "" || (!path.startsWith(`..${sep}`) && path !== ".." && !isAbsolute(path));
}

function isSensitiveCredentialPath(path: string): boolean {
  const segments = path.split(sep);
  const name = segments.at(-1)?.toLowerCase() ?? "";
  if (segments.includes(".git")) return true;
  if (name === ".env" || (name.startsWith(".env.") && ![ ".env.example", ".env.sample", ".env.template" ].includes(name))) return true;
  return [
    ".npmrc", ".netrc", "master.key", "id_rsa", "id_ed25519", "credentials.json",
  ].includes(name);
}

async function nearestExistingPath(path: string): Promise<string> {
  let candidate = path;
  for (;;) {
    try {
      await lstat(candidate);
      return candidate;
    } catch {
      const parent = dirname(candidate);
      if (parent === candidate) throw new Error(`No existing ancestor for ${path}`);
      candidate = parent;
    }
  }
}

async function approvedRoots(projectRoot: string, repositoryRoots: string[]): Promise<string[]> {
  return Promise.all([ ...new Set([ projectRoot, ...repositoryRoots ]) ].map((root) => realpath(root)));
}

async function safeProjectPath(
  projectRoot: string,
  repositoryRoots: string[],
  writableRepositoryRoots: string[],
  rawPath: string,
  allowMissing = false,
  requireWritable = false,
): Promise<string> {
  const roots = await approvedRoots(projectRoot, repositoryRoots);
  const lexicalRoots = [ ...new Set([ projectRoot, ...repositoryRoots ]) ].map((root) => resolve(root));
  const writableRoots = await Promise.all(writableRepositoryRoots.map((root) => realpath(root)));
  const lexicalWritableRoots = writableRepositoryRoots.map((root) => resolve(root));
  const primaryRoot = await realpath(projectRoot);
  const candidate = isAbsolute(rawPath) ? resolve(rawPath) : resolve(primaryRoot, rawPath || ".");
  if (isSensitiveCredentialPath(candidate)) throw new Error("Path is a sensitive credential path");
  if (![ ...roots, ...lexicalRoots ].some((root) => isWithin(root, candidate))) {
    throw new Error("Path is outside the task grant");
  }
  if (requireWritable && ![ ...writableRoots, ...lexicalWritableRoots ].some((root) => isWithin(root, candidate))) {
    throw new Error("Path is not a writable assignment root");
  }
  const existing = await nearestExistingPath(candidate);
  const resolvedExisting = await realpath(existing);
  if (!roots.some((root) => isWithin(root, resolvedExisting))) throw new Error("Path resolves outside the task grant");
  if (requireWritable && !writableRoots.some((root) => isWithin(root, resolvedExisting))) {
    throw new Error("Path resolves outside a writable assignment root");
  }
  if (!allowMissing) {
    const resolvedCandidate = await realpath(candidate);
    if (!roots.some((root) => isWithin(root, resolvedCandidate))) throw new Error("Path resolves outside the task grant");
    return resolvedCandidate;
  }
  return candidate;
}

async function listProjectFiles(
  root: string,
  repositoryRoots: string[],
  writableRepositoryRoots: string[],
  rawPath: string,
): Promise<string> {
  const start = await safeProjectPath(root, repositoryRoots, writableRepositoryRoots, rawPath);
  const rootPath = await realpath(root);
  const pending = [ start ];
  const files: string[] = [];
  while (pending.length > 0 && files.length < 500) {
    const directory = pending.shift()!;
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if ([ ".git", "node_modules", "dist", "tmp", "log" ].includes(entry.name)) continue;
      const path = resolve(directory, entry.name);
      if (isSensitiveCredentialPath(path)) continue;
      if (entry.isDirectory()) pending.push(path);
      else if (entry.isFile()) files.push(relative(rootPath, path));
      if (files.length >= 500) break;
    }
  }
  return files.sort().join("\n");
}

function permittedHosts(urls: string[]): Set<string> {
  const hosts = new Set<string>();
  for (const value of urls) {
    try {
      const host = new URL(value).host;
      hosts.add(host);
      if (host === "github.com") {
        hosts.add("api.github.com");
        hosts.add("raw.githubusercontent.com");
      }
    } catch {
      // Invalid URLs never become network authority.
    }
  }
  return hosts;
}

export function createFlydWorkerTools(input: {
  projectRoot: string;
  repositoryRoots?: string[];
  writableRepositoryRoots?: string[];
  fileOperations: string[];
  commandClasses: string[];
  environment?: NodeJS.ProcessEnv;
  allowedNetworkUrls?: string[];
  run?: CommandRunner;
  fetch?: typeof fetch;
}): {
  definitions: FlydToolDefinition[];
  execute(name: string, args: Record<string, unknown>): Promise<string>;
} {
  const canRead = input.fileOperations.includes("read");
  const canWrite = input.fileOperations.includes("write");
  const repositoryRoots = input.repositoryRoots ?? [ input.projectRoot ];
  const writableRepositoryRoots = input.writableRepositoryRoots ?? [ input.projectRoot ];
  const run = input.run ?? DEFAULT_RUNNER;
  const environment = sanitizeWorkerEnvironment(input.environment ?? process.env);
  const allowedPatterns = input.commandClasses.flatMap((name) => COMMAND_PATTERNS[name] ?? []);
  const hosts = permittedHosts(input.allowedNetworkUrls ?? []);
  const definitions: FlydToolDefinition[] = [
    { type: "function", function: { name: "list_files", description: "List files in the assigned repository.", parameters: { type: "object", properties: { path: { type: "string" } }, required: [ "path" ], additionalProperties: false } } },
    { type: "function", function: { name: "read_file", description: "Read a UTF-8 file in the assigned repository.", parameters: { type: "object", properties: { path: { type: "string" } }, required: [ "path" ], additionalProperties: false } } },
    { type: "function", function: { name: "search", description: "Search repository text with ripgrep.", parameters: { type: "object", properties: { pattern: { type: "string" }, path: { type: "string" } }, required: [ "pattern" ], additionalProperties: false } } },
    { type: "function", function: { name: "run_command", description: "Run one grant-approved test, lint, build, inspection, or Git evidence command without a shell.", parameters: { type: "object", properties: { command: { type: "string" } }, required: [ "command" ], additionalProperties: false } } },
  ];
  if (canWrite) {
    definitions.push(
      { type: "function", function: { name: "write_file", description: "Create or replace a UTF-8 file in the assigned repository.", parameters: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: [ "path", "content" ], additionalProperties: false } } },
      { type: "function", function: { name: "edit_file", description: "Replace one exact text block in a repository file. Fails unless the old text occurs exactly once.", parameters: { type: "object", properties: { path: { type: "string" }, old_text: { type: "string" }, new_text: { type: "string" } }, required: [ "path", "old_text", "new_text" ], additionalProperties: false } } },
    );
  }
  if (hosts.size > 0) {
    definitions.push({ type: "function", function: { name: "fetch_url", description: "Fetch an HTTPS URL from a host explicitly referenced by the assignment.", parameters: { type: "object", properties: { url: { type: "string" } }, required: [ "url" ], additionalProperties: false } } });
  }

  return {
    definitions,
    async execute(name, args) {
      if (name === "list_files") {
        if (!canRead) throw new Error("The task grant does not allow reads");
        return listProjectFiles(input.projectRoot, repositoryRoots, writableRepositoryRoots, stringArgument(args, "path"));
      }
      if (name === "read_file") {
        if (!canRead) throw new Error("The task grant does not allow reads");
        const content = await readFile(await safeProjectPath(
          input.projectRoot, repositoryRoots, writableRepositoryRoots, stringArgument(args, "path"),
        ), "utf8");
        return boundedToolResult(content);
      }
      if (name === "search") {
        if (!canRead) throw new Error("The task grant does not allow reads");
        const pattern = stringArgument(args, "pattern");
        const path = await safeProjectPath(
          input.projectRoot, repositoryRoots, writableRepositoryRoots, typeof args.path === "string" ? args.path : ".",
        );
        const result = await run("rg", [ "--line-number", "--no-heading", "--color", "never", pattern, path ], {
          cwd: input.projectRoot, env: environment, timeout: 30_000,
          repositoryRoots: [ input.projectRoot, ...repositoryRoots ],
          writableRepositoryRoots,
        });
        if (result.exitStatus > 1) throw new Error(result.stderr || `Search exited ${result.exitStatus}`);
        return boundedToolResult(result.stdout) || "No matches";
      }
      if (name === "write_file") {
        if (!canWrite) throw new Error("The task grant does not allow writes");
        const path = await safeProjectPath(
          input.projectRoot, repositoryRoots, writableRepositoryRoots, stringArgument(args, "path"), true, true,
        );
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, stringArgument(args, "content"), { encoding: "utf8", mode: 0o600 });
        return `Wrote ${relative(input.projectRoot, path)}`;
      }
      if (name === "edit_file") {
        if (!canWrite) throw new Error("The task grant does not allow writes");
        const path = await safeProjectPath(
          input.projectRoot, repositoryRoots, writableRepositoryRoots, stringArgument(args, "path"), true, true,
        );
        const oldText = stringArgument(args, "old_text");
        const newText = stringArgument(args, "new_text");
        const content = await readFile(path, "utf8");
        const first = content.indexOf(oldText);
        if (first < 0 || content.indexOf(oldText, first + oldText.length) >= 0) {
          throw new Error("old_text must occur exactly once");
        }
        await writeFile(path, `${content.slice(0, first)}${newText}${content.slice(first + oldText.length)}`, "utf8");
        return `Edited ${relative(input.projectRoot, path)}`;
      }
      if (name === "run_command") {
        const command = stringArgument(args, "command").trim();
        if (!allowedPatterns.some((pattern) => pattern.test(command))) {
          throw new Error("Command is outside the task grant");
        }
        const [ executable, ...commandArgs ] = commandArguments(command);
        if (!executable) throw new Error("Command is empty");
        for (const argument of [ executable, ...commandArgs ]) {
          const path = pathLikeCommandArgument(argument);
          if (path) await safeProjectPath(
            input.projectRoot, repositoryRoots, writableRepositoryRoots, path, true,
          );
        }
        const result = await run(executable, commandArgs, {
          cwd: input.projectRoot, env: environment, timeout: 10 * 60_000,
          repositoryRoots: [ input.projectRoot, ...repositoryRoots ],
          writableRepositoryRoots,
        });
        return boundedToolResult([ `exit ${result.exitStatus}`, result.stdout, result.stderr ].filter(Boolean).join("\n"));
      }
      if (name === "fetch_url") {
        let url = new URL(stringArgument(args, "url"));
        let response: Response | null = null;
        for (let redirects = 0; redirects <= 5; redirects += 1) {
          if (url.protocol !== "https:" || !hosts.has(url.host)) throw new Error("URL is outside the task grant");
          response = await (input.fetch ?? fetch)(url, { redirect: "manual" });
          if (response.status < 300 || response.status >= 400) break;
          const location = response.headers.get("location");
          if (!location) throw new Error(`Fetch redirect ${response.status} omitted a location`);
          url = new URL(location, url);
        }
        if (!response || (response.status >= 300 && response.status < 400)) throw new Error("Fetch exceeded the redirect limit");
        if (!response.ok) throw new Error(`Fetch failed with HTTP ${response.status}`);
        const body = await response.text();
        return boundedToolResult(body);
      }
      throw new Error(`Unknown Flyd tool: ${name}`);
    },
  };
}
