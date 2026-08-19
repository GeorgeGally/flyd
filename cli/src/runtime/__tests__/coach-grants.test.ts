import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import {
  configureCoachGrantsPath,
  listCoachGrants,
  hasCoachGrant,
  grantCoachScope,
  revokeCoachScope,
  resetCoachGrantsToDefault,
} from "../coach-grants.js";

describe("coach grants", () => {
  let root: string;
  let prevFlydDir: string | undefined;

  beforeEach(() => {
    root = join(tmpdir(), `flyd-coach-grants-${randomUUID()}`);
    prevFlydDir = process.env.FLYD_DIR;
    process.env.FLYD_DIR = root;
    mkdirSync(root, { recursive: true });
    configureCoachGrantsPath(join(root, "coach", "grants.json"));
  });

  afterEach(() => {
    if (prevFlydDir === undefined) delete process.env.FLYD_DIR;
    else process.env.FLYD_DIR = prevFlydDir;
    if (existsSync(root)) rmSync(root, { recursive: true, force: true });
  });

  it("defaults to existing_signals only; browsing/extended off", () => {
    resetCoachGrantsToDefault();
    expect(hasCoachGrant("existing_signals")).toBe(true);
    expect(hasCoachGrant("browsing")).toBe(false);
    expect(hasCoachGrant("extended")).toBe(false);
  });

  it("granting and revoking a scope toggles access and persists", () => {
    grantCoachScope("browsing");
    expect(hasCoachGrant("browsing")).toBe(true);
    revokeCoachScope("browsing");
    expect(hasCoachGrant("browsing")).toBe(false);
  });

  it("persists grant state across reads", () => {
    grantCoachScope("extended");
    const grants = listCoachGrants();
    expect(grants).toContain("extended");
  });

  it("cannot revoke the default existing_signals grant", () => {
    revokeCoachScope("existing_signals");
    expect(hasCoachGrant("existing_signals")).toBe(true);
  });
});
