import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";
import { FLYD_DIR } from "../lib/config.js";
import { chooseElement, cropBox, type Locator, type Rect } from "./site-changes.js";

// The picture of a change to a website: the element the change touched, cut
// from the page, not the whole page. Flyd opens the page itself in a headless
// Chrome of its own (a throwaway profile, never his browser), finds the
// element the turn changed, brings it on screen, waits for the site's fades,
// and keeps a crop of it in ~/.flyd/view/element-shots. One page at a time,
// each bounded by a timeout; a crop is made once per change and remembered,
// as is a change whose element could not be found (its full screenshot shows
// instead).

export interface ElementRequest {
  /** Stable for the change: the reply's id. */
  key: string;
  /** Pages to look on, in order. */
  pages: string[];
  locators: Locator[];
}

/** ready: the crop's path; none: no crop (no browser, no element): show the full picture; pending: being made. */
export type ElementShot = { state: "ready"; path: string } | { state: "none" } | { state: "pending" };

const VIEW = { width: 1440, height: 900 };
const TIMEOUT_MS = 30_000;
/** The sites fade their screens in; the crop waits for that. */
const SETTLE_MS = 1_600;
const MAX_QUEUE = 8;
const INDEX_FILE = "index.json";

const CHROMES = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
];

function chromePath(): string | undefined {
  const own = process.env.FLYD_CHROME;
  if (own) return existsSync(own) ? own : undefined;
  return CHROMES.find((path) => existsSync(path));
}

/** The page script: each locator's first drawn element, kept on the page, and its size. */
const FIND = `(locators) => {
  const norm = (s) => String(s || "").replace(/[\\u2018\\u2019]/g, "'").replace(/[\\u201c\\u201d]/g, '"').replace(/\\s+/g, " ").trim().toLowerCase();
  const drawn = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width >= 4 && r.height >= 4 && s.display !== "none" && s.visibility !== "hidden"; };
  const byText = (phrase) => {
    const want = norm(phrase);
    const all = Array.from(document.body ? document.body.querySelectorAll("*") : []).filter((el) => !/^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|svg|path)$/i.test(el.tagName));
    const holding = all.filter((el) => norm(el.textContent).includes(want));
    // The innermost: no child of it holds the words whole.
    return holding.filter((el) => !Array.from(el.children).some((child) => norm(child.textContent).includes(want)));
  };
  window.__flydFound = locators.map((locator) => {
    let els = [];
    try { els = locator.kind === "css" ? Array.from(document.querySelectorAll(locator.value)) : byText(locator.value); } catch (e) { els = []; }
    return els.find(drawn) || null;
  });
  return window.__flydFound.map((el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; });
}`;

/** Brings the chosen element on screen and, once the page settles, says where it is. */
const PLACE = `async (index, settle) => {
  const el = window.__flydFound && window.__flydFound[index];
  if (!el) return null;
  el.scrollIntoView({ block: "center", inline: "center" });
  await new Promise((r) => setTimeout(r, settle));
  el.scrollIntoView({ block: "center", inline: "center" });
  await new Promise((r) => setTimeout(r, 200));
  const r = el.getBoundingClientRect();
  return { rect: { x: r.x, y: r.y, width: r.width, height: r.height }, scrollX: window.scrollX, scrollY: window.scrollY, view: { width: innerWidth, height: innerHeight } };
}`;

class Devtools {
  private next = 1;
  private readonly waiting = new Map<number, { resolve: (value: Record<string, unknown>) => void; reject: (error: Error) => void }>();
  private readonly events = new Map<string, Array<() => void>>();

  private constructor(private readonly socket: WebSocket) {
    socket.on("message", (data) => {
      let message: { id?: number; method?: string; result?: Record<string, unknown>; error?: { message?: string } };
      try {
        message = JSON.parse(String(data));
      } catch {
        return;
      }
      if (message.id !== undefined) {
        const waiter = this.waiting.get(message.id);
        this.waiting.delete(message.id);
        if (message.error) waiter?.reject(new Error(message.error.message ?? "devtools error"));
        else waiter?.resolve(message.result ?? {});
      } else if (message.method) {
        for (const listener of this.events.get(message.method) ?? []) listener();
      }
    });
    socket.on("close", () => {
      for (const waiter of this.waiting.values()) waiter.reject(new Error("devtools closed"));
      this.waiting.clear();
    });
  }

  static open(url: string): Promise<Devtools> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(url, { perMessageDeflate: false, maxPayload: 64 * 1024 * 1024 });
      socket.once("open", () => resolve(new Devtools(socket)));
      socket.once("error", reject);
    });
  }

  send(method: string, params: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    const id = this.next++;
    return new Promise((resolve, reject) => {
      this.waiting.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  once(method: string, timeoutMs: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, timeoutMs);
      this.events.set(method, [...(this.events.get(method) ?? []), () => {
        clearTimeout(timer);
        resolve();
      }]);
    });
  }

  async evaluate<T>(fn: string, args: unknown[]): Promise<T | null> {
    const result = await this.send("Runtime.evaluate", {
      expression: `(${fn})(...${JSON.stringify(args)})`,
      awaitPromise: true,
      returnByValue: true,
    });
    const value = result.result as { value?: T } | undefined;
    return value?.value ?? null;
  }

  close(): void {
    this.socket.close();
  }
}

/** Starts a headless Chrome on a throwaway profile; its DevTools address once it is up. */
async function launch(chrome: string): Promise<{ child: ChildProcess; profile: string; endpoint: string }> {
  const profile = mkdtempSync(join(tmpdir(), "flyd-element-"));
  const child = spawn(chrome, [
    "--headless=new",
    "--remote-debugging-port=0",
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-extensions",
    "--hide-scrollbars",
    "--mute-audio",
    `--window-size=${VIEW.width},${VIEW.height}`,
    "about:blank",
  ], { stdio: ["ignore", "ignore", "pipe"] });
  const endpoint = await new Promise<string>((resolve, reject) => {
    let said = "";
    const timer = setTimeout(() => reject(new Error("chrome did not start")), 15_000);
    child.stderr?.on("data", (chunk: Buffer) => {
      said += chunk.toString();
      const found = /DevTools listening on (ws:\/\/\S+)/.exec(said);
      if (found) {
        clearTimeout(timer);
        resolve(found[1]!);
      }
    });
    child.once("exit", () => {
      clearTimeout(timer);
      reject(new Error("chrome exited"));
    });
  });
  return { child, profile, endpoint };
}

async function pageTarget(endpoint: string): Promise<string> {
  const http = endpoint.replace(/^ws:\/\//, "http://").replace(/\/devtools\/browser\/.*$/, "");
  const targets = (await (await fetch(`${http}/json/list`)).json()) as Array<{ type: string; webSocketDebuggerUrl?: string }>;
  const page = targets.find((target) => target.type === "page" && target.webSocketDebuggerUrl);
  if (!page?.webSocketDebuggerUrl) throw new Error("no page");
  return page.webSocketDebuggerUrl;
}

/** The changed element of the first page that has it, as PNG bytes; null when no page shows it. */
export async function renderElement(request: Pick<ElementRequest, "pages" | "locators">, chrome = chromePath()): Promise<Buffer | null> {
  if (!chrome || request.locators.length === 0 || request.pages.length === 0) return null;
  const { child, profile, endpoint } = await launch(chrome);
  // Past the deadline the browser goes, and with it every call still waiting on it.
  const deadline = setTimeout(() => child.kill("SIGKILL"), TIMEOUT_MS);
  // Flyd stopping mid-crop takes its browser with it.
  const onExit = () => {
    child.kill("SIGKILL");
    rmSync(profile, { recursive: true, force: true });
  };
  process.once("exit", onExit);
  let devtools: Devtools | undefined;
  try {
    devtools = await Devtools.open(await pageTarget(endpoint));
    await devtools.send("Page.enable");
    await devtools.send("Emulation.setDeviceMetricsOverride", { width: VIEW.width, height: VIEW.height, deviceScaleFactor: 2, mobile: false });
    for (const page of request.pages) {
      const loaded = devtools.once("Page.loadEventFired", 12_000);
      const navigated = await devtools.send("Page.navigate", { url: page }).catch(() => ({ errorText: "failed" }));
      if (navigated.errorText) continue;
      await loaded;
      await devtools.evaluate("() => document.fonts && document.fonts.ready.then(() => true)", []);
      const found = (await devtools.evaluate<Array<Rect | null>>(FIND, [request.locators])) ?? [];
      const index = chooseElement(found, VIEW);
      if (index < 0) continue;
      const placed = await devtools.evaluate<{ rect: Rect; scrollX: number; scrollY: number; view: { width: number; height: number } }>(PLACE, [index, SETTLE_MS]);
      if (!placed) continue;
      const clip = cropBox(placed.rect, placed.view);
      const shot = await devtools.send("Page.captureScreenshot", {
        format: "png",
        clip: { x: clip.x + placed.scrollX, y: clip.y + placed.scrollY, width: clip.width, height: clip.height, scale: 1 },
      });
      if (typeof shot.data === "string") return Buffer.from(shot.data, "base64");
    }
    return null;
  } finally {
    clearTimeout(deadline);
    process.off("exit", onExit);
    devtools?.close();
    child.kill("SIGKILL");
    rmSync(profile, { recursive: true, force: true });
  }
}

/** Crops of changed elements, made once each in the background and remembered on disk. */
export class ElementShots {
  readonly root: string;
  private readonly known = new Map<string, string | null>();
  private readonly queue: Array<ElementRequest & { id: string }> = [];
  private readonly queued = new Set<string>();
  private running = false;
  private readonly listeners = new Set<() => void>();
  private readonly render: (request: ElementRequest) => Promise<Buffer | null>;

  constructor(options: { root?: string; render?: (request: ElementRequest) => Promise<Buffer | null> } = {}) {
    this.root = options.root ?? join(FLYD_DIR, "view", "element-shots");
    this.render = options.render ?? ((request) => renderElement(request));
    try {
      const index = JSON.parse(readFileSync(join(this.root, INDEX_FILE), "utf8")) as Record<string, string | null>;
      for (const [id, path] of Object.entries(index)) if (path === null || existsSync(path)) this.known.set(id, path);
    } catch {
      // No crops made yet.
    }
  }

  /** Called when a crop is made or given up on, so the views can show it. */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** The crop for a change: made now in the background if it is new. */
  shot(request: ElementRequest): ElementShot {
    const id = createHash("sha256").update(JSON.stringify([request.key, request.pages, request.locators])).digest("hex").slice(0, 24);
    const known = this.known.get(id);
    if (known !== undefined) return known ? { state: "ready", path: known } : { state: "none" };
    if (request.locators.length === 0 || request.pages.length === 0) return { state: "none" };
    if (!this.queued.has(id)) {
      // The newest changes come first: a full queue lets its oldest go, to be asked for again on a later look.
      if (this.queue.length >= MAX_QUEUE) this.queued.delete(this.queue.shift()!.id);
      this.queued.add(id);
      this.queue.push({ ...request, id });
      void this.drain();
    }
    return { state: "pending" };
  }

  private async drain(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      // Newest first: views ask oldest to newest.
      for (let job = this.queue.pop(); job; job = this.queue.pop()) {
        let bytes: Buffer | null = null;
        try {
          bytes = await Promise.race([
            this.render(job),
            new Promise<null>((resolve) => setTimeout(() => resolve(null), TIMEOUT_MS + 20_000).unref?.()),
          ]);
        } catch {
          bytes = null;
        }
        let path: string | null = null;
        if (bytes?.length) {
          mkdirSync(this.root, { recursive: true, mode: 0o700 });
          path = join(this.root, `element-${job.id}.png`);
          writeFileSync(path, bytes, { mode: 0o600 });
        }
        this.known.set(job.id, path);
        this.queued.delete(job.id);
        this.save();
        for (const listener of this.listeners) listener();
      }
    } finally {
      this.running = false;
    }
  }

  private save(): void {
    try {
      mkdirSync(this.root, { recursive: true, mode: 0o700 });
      // The newest few hundred are plenty: a crop is only shown while its change is recent.
      const entries = [...this.known].slice(-400);
      writeFileSync(join(this.root, INDEX_FILE), JSON.stringify(Object.fromEntries(entries)), { mode: 0o600 });
    } catch {
      // Unsaved, the crops are made again after a restart.
    }
  }
}
