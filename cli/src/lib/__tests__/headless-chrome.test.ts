import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const spawned = vi.hoisted(() => [] as Array<{ binary: string; args: string[] }>);
const FAKE_CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    spawn: vi.fn((binary: string, args: string[]) => {
      spawned.push({ binary, args });
      const child = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter(), kill: vi.fn() });
      setImmediate(() => child.emit("exit", 1));
      return child;
    }),
  };
});

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, existsSync: (path: string) => path === FAKE_CHROME || actual.existsSync(path) };
});

const { shootWithChrome, DESKTOP, PHONE } = await import("../../command/design-mate.js");
const { captureBoard } = await import("../../conversation-view/board-shots.js");
const { renderElement } = await import("../../conversation-view/element-shots.js");

// Chrome's documented switches: --use-mock-keychain keeps it off the macOS keychain and
// --password-store=basic stops it asking for one, so no launch raises "Keychain Not Found".
const KEYCHAIN_FREE = ["--use-mock-keychain", "--password-store=basic"];

describe("every headless Chrome Flyd starts stays off the macOS keychain", () => {
  let dir: string;
  beforeEach(() => {
    spawned.length = 0;
    dir = mkdtempSync(join(tmpdir(), "flyd-chrome-test-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  function chromeLaunches(): string[][] {
    const launches = spawned.filter((call) => call.binary === FAKE_CHROME).map((call) => call.args);
    expect(launches.length).toBeGreaterThan(0);
    return launches;
  }

  it("a lab screenshot, measured and shot, desktop and phone", async () => {
    const page = join(dir, "v1.html");
    writeFileSync(page, "<!doctype html><p>hi</p>");
    await expect(shootWithChrome(page, join(dir, "d.png"), DESKTOP)).rejects.toThrow();
    await expect(shootWithChrome(page, join(dir, "p.png"), PHONE)).rejects.toThrow();
    const launches = chromeLaunches();
    expect(launches).toHaveLength(4);
    for (const args of launches) expect(args).toEqual(expect.arrayContaining(KEYCHAIN_FREE));
  });

  it("a board picture", async () => {
    expect(await captureBoard("board-1", join(dir, "b.png"), FAKE_CHROME)).toBe(false);
    for (const args of chromeLaunches()) expect(args).toEqual(expect.arrayContaining(KEYCHAIN_FREE));
  });

  it("a website element picture", async () => {
    await expect(renderElement({ pages: ["https://example.com"], locators: [{ kind: "css", value: "h1" }] }, FAKE_CHROME)).rejects.toThrow();
    for (const args of chromeLaunches()) expect(args).toEqual(expect.arrayContaining(KEYCHAIN_FREE));
  });
});
