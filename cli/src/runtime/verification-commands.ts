import { access, readFile } from "fs/promises";
import { join } from "path";

async function exists(path: string): Promise<boolean> {
  return access(path).then(() => true, () => false);
}

async function packageCommands(root: string, relativePath: string, prefix: string[] = []): Promise<string[]> {
  try {
    const manifest = JSON.parse(await readFile(join(root, relativePath), "utf8")) as {
      scripts?: Record<string, string>;
    };
    const scripts = manifest.scripts ?? {};
    return [ "test", "lint", "build" ].filter((name) => scripts[name]).map((name) => (
      name === "test"
        ? [ "npm", ...prefix, "test" ].join(" ")
        : [ "npm", ...prefix, "run", name ].join(" ")
    ));
  } catch {
    return [];
  }
}

export async function verificationCommandsForRepository(root: string): Promise<string[]> {
  const commands = [ "git diff --check" ];
  if (await exists(join(root, "bin/rails")) && await exists(join(root, "test"))) commands.push("bin/rails test");
  commands.push(...await packageCommands(root, "package.json"));
  if (await exists(join(root, "cli/package.json"))) {
    commands.push(...await packageCommands(root, "cli/package.json", [ "--prefix", "cli" ]));
  }
  if (await exists(join(root, "pyproject.toml"))) commands.push("pytest");
  if (await exists(join(root, "Cargo.toml"))) commands.push("cargo test");
  if (await exists(join(root, "go.mod"))) commands.push("go test ./...");
  return [ ...new Set(commands) ];
}
