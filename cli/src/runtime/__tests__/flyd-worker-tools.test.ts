import { mkdtemp, mkdir, readFile, symlink, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { describe, expect, it, vi } from "vitest";
import { buildToolCommandSandboxProfile, createFlydWorkerTools } from "../flyd-worker-tools.js";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "flyd-worker-tools-"));
  const projectRoot = join(root, "project");
  await mkdir(projectRoot);
  await writeFile(join(projectRoot, "README.md"), "old text\n", "utf8");
  return { root, projectRoot };
}

describe("Flyd worker tools", () => {
  it("builds a no-network command sandbox limited to approved repositories", () => {
    const profile = buildToolCommandSandboxProfile({
      repositoryRoots: [ "/Users/george/code/app", "/Users/george/code/shared" ],
      writableRepositoryRoots: [ "/Users/george/code/app" ],
      temporaryHome: "/private/tmp/flyd-tool-home",
      runtimeRoots: [ "/opt/homebrew/bin" ],
    });

    expect(profile).toContain("(deny network*)");
    expect(profile).toContain('(deny file-read* (subpath "/Users"))');
    expect(profile).toContain('(allow file-read* (subpath "/Users/george/code/app"))');
    expect(profile).toContain('(allow file-write* (subpath "/Users/george/code/app"))');
    expect(profile).not.toContain('(allow file-write* (subpath "/Users/george/code/shared"))');
    expect(profile).not.toContain("FLYD_WORKER_API_KEY");
  });

  it.runIf(process.platform === "darwin")("contains repository scripts that try to read outside the grant", async () => {
    const { root, projectRoot } = await fixture();
    await writeFile(join(root, "private.txt"), "DO_NOT_EXPOSE\n", "utf8");
    await writeFile(join(projectRoot, "package.json"), JSON.stringify({
      scripts: { test: "cat ../private.txt" },
    }), "utf8");
    const tools = createFlydWorkerTools({
      projectRoot,
      fileOperations: [ "read", "write" ],
      commandClasses: [ "test" ],
    });

    const output = await tools.execute("run_command", { command: "npm test" });

    expect(output).toMatch(/exit [1-9]/);
    expect(output).not.toContain("DO_NOT_EXPOSE");
  });

  it.runIf(process.platform === "darwin")("denies mutating inspection commands for a read-only assignment", async () => {
    const { projectRoot } = await fixture();
    const tools = createFlydWorkerTools({
      projectRoot,
      writableRepositoryRoots: [],
      fileOperations: [ "read" ],
      commandClasses: [ "inspect" ],
    });

    const output = await tools.execute("run_command", { command: "find . -name README.md -delete" });

    expect(output).toContain("Operation not permitted");
    await expect(readFile(join(projectRoot, "README.md"), "utf8")).resolves.toBe("old text\n");
  });

  it("reads and edits files inside the assigned repository", async () => {
    const { projectRoot } = await fixture();
    const tools = createFlydWorkerTools({
      projectRoot,
      fileOperations: [ "read", "write" ],
      commandClasses: [],
    });

    await expect(tools.execute("read_file", { path: "README.md" })).resolves.toContain("old text");
    await tools.execute("edit_file", {
      path: "README.md",
      old_text: "old text",
      new_text: "new text",
    });

    await expect(readFile(join(projectRoot, "README.md"), "utf8")).resolves.toBe("new text\n");
  });

  it("bounds model-visible tool results", async () => {
    const { projectRoot } = await fixture();
    await writeFile(join(projectRoot, "large.txt"), "x".repeat(100_000), "utf8");
    const tools = createFlydWorkerTools({
      projectRoot,
      fileOperations: [ "read" ],
      commandClasses: [],
    });

    const output = await tools.execute("read_file", { path: "large.txt" });

    expect(output.length).toBeLessThan(50_000);
    expect(output).toContain("...[truncated");
  });

  it("reads another grant-approved repository without writing outside the isolated assignment", async () => {
    const { root, projectRoot } = await fixture();
    const secondRepository = join(root, "shared-library");
    await mkdir(secondRepository);
    await writeFile(join(secondRepository, "README.md"), "shared code\n", "utf8");
    const tools = createFlydWorkerTools({
      projectRoot,
      repositoryRoots: [ projectRoot, secondRepository ],
      writableRepositoryRoots: [ projectRoot ],
      fileOperations: [ "read", "write" ],
      commandClasses: [],
    });

    await expect(tools.execute("read_file", { path: join(secondRepository, "README.md") }))
      .resolves.toBe("shared code\n");
    await expect(tools.execute("write_file", { path: join(secondRepository, "new.txt"), content: "new\n" }))
      .rejects.toThrow("not a writable assignment root");
  });

  it("rejects traversal and symlinks outside every grant-approved repository", async () => {
    const { root, projectRoot } = await fixture();
    const outside = join(root, "outside.txt");
    await writeFile(outside, "private", "utf8");
    await symlink(outside, join(projectRoot, "outside-link"));
    const tools = createFlydWorkerTools({
      projectRoot,
      fileOperations: [ "read", "write" ],
      commandClasses: [],
    });

    await expect(tools.execute("read_file", { path: "../outside.txt" })).rejects.toThrow("outside the task grant");
    await expect(tools.execute("read_file", { path: "outside-link" })).rejects.toThrow("outside the task grant");
    await expect(tools.execute("write_file", { path: "../created.txt", content: "no" })).rejects.toThrow("outside the task grant");
  });

  it("keeps repository credentials out of model-visible tools", async () => {
    const { projectRoot } = await fixture();
    await writeFile(join(projectRoot, ".env"), "API_KEY=private\n", "utf8");
    await writeFile(join(projectRoot, ".env.example"), "API_KEY=\n", "utf8");
    const tools = createFlydWorkerTools({
      projectRoot,
      fileOperations: [ "read", "write" ],
      commandClasses: [ "inspect" ],
      run: vi.fn(async () => ({ stdout: "private", stderr: "", exitStatus: 0 })),
    });

    await expect(tools.execute("read_file", { path: ".env" })).rejects.toThrow("sensitive credential path");
    await expect(tools.execute("run_command", { command: "cat .env" })).rejects.toThrow("sensitive credential path");
    await expect(tools.execute("read_file", { path: ".env.example" })).resolves.toBe("API_KEY=\n");
  });

  it("runs approved commands with provider credentials removed", async () => {
    const { projectRoot } = await fixture();
    const run = vi.fn(async (_command: string, _args: string[], options: { env: NodeJS.ProcessEnv }) => ({
      stdout: JSON.stringify(options.env),
      stderr: "",
      exitStatus: 0,
    }));
    const tools = createFlydWorkerTools({
      projectRoot,
      fileOperations: [ "read" ],
      commandClasses: [ "git_status" ],
      environment: {
        PATH: "/usr/bin",
        HOME: "/tmp/home",
        FLYD_WORKER_API_KEY: "model-secret",
        OPENROUTER_API_KEY: "other-secret",
      },
      run,
    });

    const output = await tools.execute("run_command", { command: "git status --short" });

    expect(output).not.toContain("model-secret");
    expect(output).not.toContain("other-secret");
    expect(run).toHaveBeenCalledWith("git", [ "status", "--short" ], expect.objectContaining({ cwd: projectRoot }));
  });

  it("rejects shell composition even when a command starts with an approved prefix", async () => {
    const { projectRoot } = await fixture();
    const tools = createFlydWorkerTools({
      projectRoot,
      fileOperations: [ "read" ],
      commandClasses: [ "git_status" ],
    });

    await expect(tools.execute("run_command", { command: "git status; rm -rf ." })).rejects.toThrow("shell operators");
  });

  it("applies repository roots to command path arguments", async () => {
    const { root, projectRoot } = await fixture();
    const outside = join(root, "private.txt");
    await writeFile(outside, "private", "utf8");
    const run = vi.fn(async () => ({ stdout: "private", stderr: "", exitStatus: 0 }));
    const tools = createFlydWorkerTools({
      projectRoot,
      fileOperations: [ "read" ],
      commandClasses: [ "inspect", "test" ],
      run,
    });

    await expect(tools.execute("run_command", { command: `cat ${outside}` }))
      .rejects.toThrow("outside the task grant");
    await expect(tools.execute("run_command", { command: "pytest ../private.txt" }))
      .rejects.toThrow("outside the task grant");
    expect(run).not.toHaveBeenCalled();
  });

  it("supports grant-approved test commands across common repository stacks", async () => {
    const { projectRoot } = await fixture();
    const run = vi.fn(async () => ({ stdout: "passed", stderr: "", exitStatus: 0 }));
    const tools = createFlydWorkerTools({
      projectRoot,
      fileOperations: [ "read" ],
      commandClasses: [ "test" ],
      run,
    });

    await expect(tools.execute("run_command", { command: "pytest tests/test_app.py" })).resolves.toContain("passed");
    await expect(tools.execute("run_command", { command: "cargo test --workspace" })).resolves.toContain("passed");
    await expect(tools.execute("run_command", { command: "go test ./..." })).resolves.toContain("passed");
  });

  it("does not follow an approved URL redirect to an unapproved host", async () => {
    const { projectRoot } = await fixture();
    const fetch = vi.fn(async () => new Response(null, {
      status: 302,
      headers: { location: "https://unapproved.example.test/private" },
    }));
    const tools = createFlydWorkerTools({
      projectRoot,
      fileOperations: [ "read" ],
      commandClasses: [],
      allowedNetworkUrls: [ "https://github.com/example/project" ],
      fetch,
    });

    await expect(tools.execute("fetch_url", { url: "https://github.com/example/project" }))
      .rejects.toThrow("URL is outside the task grant");
  });
});
