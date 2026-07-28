import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { checkArtifact, isUserFacingPath } from "../artifact-check.js";

let tempDir: string;

beforeAll(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "flyd-artifact-test-"));
});

afterAll(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("isUserFacingPath", () => {
  it("rejects relative paths", () => {
    expect(isUserFacingPath("output/report.pdf")).toBe(false);
  });

  it("rejects temp directories", () => {
    expect(isUserFacingPath("/tmp/report.pdf")).toBe(false);
    expect(isUserFacingPath(join(tmpdir(), "report.pdf"))).toBe(false);
  });

  it("rejects node_modules and scratch segments", () => {
    expect(isUserFacingPath("/Users/x/project/node_modules/pkg/file.js")).toBe(false);
    expect(isUserFacingPath("/Users/x/scratch/out.pdf")).toBe(false);
  });

  it("accepts ordinary absolute user paths", () => {
    expect(isUserFacingPath("/Users/x/Documents/report.pdf")).toBe(true);
  });
});

describe("checkArtifact — files", () => {
  it("fails when the file does not exist", async () => {
    const result = await checkArtifact({
      kind: "file",
      path: join(tempDir, "missing.pdf"),
      description: "missing file",
    });
    expect(result.passed).toBe(false);
    expect(result.failures.map((f) => f.check)).toContain("exists");
  });

  it("fails on empty files", async () => {
    const path = join(tempDir, "empty.txt");
    await writeFile(path, "");
    const result = await checkArtifact({ kind: "file", path, description: "empty" });
    expect(result.passed).toBe(false);
    expect(result.failures.map((f) => f.check)).toContain("nonzero");
  });

  it("flags temp paths as not user-facing even when content is valid", async () => {
    const path = join(tempDir, "report.json");
    await writeFile(path, JSON.stringify({ ok: true }));
    const result = await checkArtifact({
      kind: "file",
      path,
      expectedMediaType: "application/json",
      description: "temp json",
    });
    expect(result.passed).toBe(false);
    expect(result.failures.map((f) => f.check)).toEqual(["user_facing"]);
    expect(result.byteSize).toBeGreaterThan(0);
    expect(result.sha256).toBeTruthy();
  });

  it("fails format check when content does not match the claimed type", async () => {
    const path = join(tempDir, "fake.pdf");
    await writeFile(path, "this is not a pdf");
    const result = await checkArtifact({
      kind: "file",
      path,
      expectedMediaType: "application/pdf",
      description: "fake pdf",
    });
    expect(result.failures.map((f) => f.check)).toContain("format");
  });

  it("passes a real user-facing file with matching format", async () => {
    // package.json: absolute path outside temp, exists, nonzero, valid JSON.
    const path = resolve(process.cwd(), "package.json");
    const result = await checkArtifact({
      kind: "file",
      path,
      expectedMediaType: "application/json",
      description: "project manifest",
    });
    expect(result.failures).toEqual([]);
    expect(result.passed).toBe(true);
  });
});

describe("checkArtifact — urls and inline text", () => {
  it("passes inline_text without touching disk or network", async () => {
    const result = await checkArtifact({ kind: "inline_text", description: "answer text" });
    expect(result.passed).toBe(true);
  });

  it("fails url claims with no url", async () => {
    const result = await checkArtifact({ kind: "url", description: "no url" });
    expect(result.passed).toBe(false);
  });

  it("fails unreachable urls", async () => {
    const result = await checkArtifact(
      { kind: "url", url: "http://127.0.0.1:59999/nope", description: "dead url" },
      { urlTimeoutMs: 300 }
    );
    expect(result.passed).toBe(false);
    expect(result.failures.map((f) => f.check)).toContain("url_responds");
  });

  it("rejects non-http protocols", async () => {
    const result = await checkArtifact({
      kind: "url",
      url: "file:///etc/passwd",
      description: "file url",
    });
    expect(result.passed).toBe(false);
  });
});
