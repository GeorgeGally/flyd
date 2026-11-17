import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { FLYD_DIR } from "../lib/config.js";

// Where a project runs on this Mac right now ("logan" → http://127.0.0.1:3002), from
// ~/.flyd/project-urls.json: { "logan": "http://127.0.0.1:3002", "imogen": "http://127.0.0.1:5173" }.
// A finished card on a local-only project opens it when the task has no link of its own.
// Keys are project names (a repo's last path part), any case; only http(s) URLs count.

export const PROJECT_URLS_FILE = join(FLYD_DIR, "project-urls.json");

/** The project URLs a config names, by lower-case project name; anything that is not an http(s) URL is left out. Pure. */
export function parseProjectUrls(text: string): Map<string, string> {
  const urls = new Map<string, string>();
  let said: unknown;
  try {
    said = JSON.parse(text);
  } catch {
    return urls;
  }
  if (!said || typeof said !== "object" || Array.isArray(said)) return urls;
  for (const [name, url] of Object.entries(said as Record<string, unknown>)) {
    if (typeof url === "string" && /^https?:\/\/\S+$/.test(url.trim())) urls.set(name.trim().toLowerCase(), url.trim());
  }
  return urls;
}

export class ProjectUrls {
  private cache?: { mtimeMs: number; urls: Map<string, string> };

  constructor(private readonly file = PROJECT_URLS_FILE) {}

  urlFor(repo: string | undefined): string | undefined {
    const name = repo?.trim().split("/").pop()?.toLowerCase();
    return name ? this.urls().get(name) : undefined;
  }

  private urls(): Map<string, string> {
    let mtimeMs: number;
    try {
      mtimeMs = statSync(this.file).mtimeMs;
    } catch {
      return new Map();
    }
    if (this.cache?.mtimeMs !== mtimeMs) {
      let text = "";
      try {
        text = readFileSync(this.file, "utf8");
      } catch {
        // Unreadable reads as none; the next change is read again.
      }
      this.cache = { mtimeMs, urls: parseProjectUrls(text) };
    }
    return this.cache.urls;
  }
}
