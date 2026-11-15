import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { HEADLESS_CHROME_ARGS } from "../headless-chrome.js";

const SRC = fileURLToPath(new URL("../../", import.meta.url));

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "__tests__" ? [] : sources(path);
    return path.endsWith(".ts") ? [path] : [];
  });
}

describe("headless Chrome launches", () => {
  it("keep Chrome away from the macOS keychain", () => {
    expect(HEADLESS_CHROME_ARGS).toEqual(expect.arrayContaining(["--headless=new", "--use-mock-keychain", "--password-store=basic"]));
  });

  it("every Chrome Flyd starts takes the shared arguments", () => {
    const launchers = sources(SRC).filter((path) => /--user-data-dir=/.test(readFileSync(path, "utf8")));
    expect(launchers.length).toBeGreaterThan(0);
    for (const path of launchers) {
      const text = readFileSync(path, "utf8");
      const name = relative(SRC, path);
      expect(text.match(/--user-data-dir=/g)!.length, name).toBe(text.match(/\.\.\.HEADLESS_CHROME_ARGS/g)?.length ?? 0);
      expect(text, name).not.toMatch(/"--headless/);
    }
  });
});
