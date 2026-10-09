import { existsSync, readdirSync, readFileSync, statSync, type Stats } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";

// The skills and slash commands the captain can run from the Conversation
// window: the same places Claude Code lists them from when "/" is typed in
// its own prompt (user skills and commands, the project's, and installed
// plugins, namespaced "plugin:name").

export interface SlashCommand {
  name: string;
  description: string;
}

const DESCRIPTION_CHARS = 140;

/** `name` and `description` from a SKILL.md / command file's front matter (plain, quoted or folded). */
export function frontMatter(text: string): Record<string, string> {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!match) return {};
  const fields: Record<string, string> = {};
  const lines = match[1]!.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const field = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(lines[i]!);
    if (!field) continue;
    let value = field[2]!.trim();
    if (value === "|" || value === ">" || value === "|-" || value === ">-" || value === "") {
      const block: string[] = [];
      while (i + 1 < lines.length && /^\s+\S/.test(lines[i + 1]!)) block.push(lines[++i]!.trim());
      value = block.join(" ");
    }
    fields[field[1]!] = value.replace(/^(["'])([\s\S]*)\1$/, "$2").trim();
  }
  return fields;
}

function shorten(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > DESCRIPTION_CHARS ? `${flat.slice(0, DESCRIPTION_CHARS - 1).trimEnd()}…` : flat;
}

function entries(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

function statOf(path: string): Stats | undefined {
  try {
    return statSync(path);
  } catch {
    return undefined;
  }
}

function readText(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

/** <dir>/<name>/SKILL.md */
function skillsIn(dir: string, prefix = ""): SlashCommand[] {
  return entries(dir).flatMap((entry) => {
    const file = join(dir, entry, "SKILL.md");
    if (!existsSync(file)) return [];
    const fields = frontMatter(readText(file));
    if (fields["user-invocable"] === "false") return [];
    return [{ name: prefix + (fields.name || entry), description: shorten(fields.description ?? "") }];
  });
}

/** <dir>/**\/*.md; nested folders become "folder:name", as in Claude Code. */
function commandsIn(dir: string, prefix = ""): SlashCommand[] {
  const found: SlashCommand[] = [];
  const walk = (folder: string, namespace: string) => {
    for (const entry of entries(folder)) {
      const path = join(folder, entry);
      const stat = statOf(path);
      if (stat?.isDirectory()) {
        walk(path, `${namespace}${entry}:`);
      } else if (stat?.isFile() && entry.endsWith(".md")) {
        const text = readText(path);
        const fields = frontMatter(text);
        const firstLine = text.replace(/^---[\s\S]*?---/, "").split("\n").find((line) => line.trim()) ?? "";
        found.push({ name: prefix + namespace + basename(entry, ".md"), description: shorten(fields.description ?? firstLine.replace(/^#+\s*/, "")) });
      }
    }
  };
  walk(dir, "");
  return found;
}

/** Installed plugins' skills and commands, from Claude Code's own plugin registry. */
function pluginCommands(claudeHome: string): SlashCommand[] {
  let registry: { plugins?: Record<string, Array<{ installPath?: string }>> };
  try {
    registry = JSON.parse(readText(join(claudeHome, "plugins", "installed_plugins.json"))) as typeof registry;
  } catch {
    return [];
  }
  return Object.entries(registry.plugins ?? {}).flatMap(([key, installs]) => {
    const install = installs.find((entry) => entry.installPath && existsSync(entry.installPath));
    if (!install?.installPath) return [];
    const prefix = `${key.split("@")[0]}:`;
    return [...skillsIn(join(install.installPath, "skills"), prefix), ...commandsIn(join(install.installPath, "commands"), prefix)];
  });
}

export function discoverCommands(options: { claudeHome?: string; projectDir?: string } = {}): SlashCommand[] {
  const claudeHome = options.claudeHome ?? join(homedir(), ".claude");
  const all = [
    ...(options.projectDir ? [...skillsIn(join(options.projectDir, ".claude", "skills")), ...commandsIn(join(options.projectDir, ".claude", "commands"))] : []),
    ...skillsIn(join(claudeHome, "skills")),
    ...commandsIn(join(claudeHome, "commands")),
    ...pluginCommands(claudeHome),
  ];
  const byName = new Map<string, SlashCommand>();
  for (const command of all) if (!byName.has(command.name)) byName.set(command.name, command);
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** "/name args" → the command it names, when that command exists. */
export function matchCommand(text: string, commands: SlashCommand[]): SlashCommand | undefined {
  const name = /^\/([\w:.-]+)(?:\s|$)/.exec(text.trim())?.[1];
  return name ? commands.find((command) => command.name === name) : undefined;
}
