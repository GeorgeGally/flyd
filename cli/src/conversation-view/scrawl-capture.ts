import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { runCapture } from "../commands/capture.js";
import { FLYD_DIR } from "../lib/config.js";
import type { ImageUpload } from "./types.js";

const SUMMARY_LIMIT = 4_000;
const capturesDir = join(homedir(), "Library", "Application Support", "scrawl", "captures");
const filedDir = join(FLYD_DIR, "scrawl-filed");

export interface ScrawlBundle {
  dir: string;
  sheet: string;
  summary: string;
  manifest: Record<string, unknown>;
}

export function findScrawl(text: string): { path: string } | null {
  const paths = [...text.matchAll(/(?<=^|[\s'"(])(?=(\/[^\n]*?\.scrawl)(?=[\s'"\])]|$))/g)].map((match) => match[1]!);
  for (const candidate of paths) {
    if (existsSync(candidate) && statSync(candidate).isDirectory()) return { path: resolve(candidate) };
  }
  if (/\b(?:latest\s+scrawl|scrawl\s+latest)\b/i.test(text)) return { path: "latest" };
  return null;
}

export function resolveBundle(path: string, sourceDir = capturesDir): ScrawlBundle {
  let dir = path === "latest"
    ? readdirSync(sourceDir).filter((name) => name.endsWith(".scrawl") && statSync(join(sourceDir, name)).isDirectory())
      .map((name) => join(sourceDir, name)).sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0]
    : resolve(path);
  if (!dir) throw new Error("No Scrawl captures found");
  dir = resolve(dir);
  const summaryPath = join(dir, "summary.md");
  const sheet = join(dir, "contact-sheet.png");
  if (!existsSync(summaryPath) || !existsSync(sheet)) throw new Error(`Incomplete Scrawl bundle: ${dir}`);
  let manifest: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(readFileSync(join(dir, "scrawl.json"), "utf8"));
    manifest = typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    manifest = {};
  }
  return { dir, sheet, summary: readFileSync(summaryPath, "utf8").slice(0, SUMMARY_LIMIT), manifest };
}

export async function fileScrawl(bundle: ScrawlBundle): Promise<void> {
  mkdirSync(filedDir, { recursive: true });
  const marker = join(filedDir, `${createHash("sha256").update(bundle.dir).digest("hex")}.filed`);
  try {
    writeFileSync(marker, "", { flag: "wx" });
  } catch (error) {
    if (existsSync(marker)) return;
    throw error;
  }
  const target = bundle.manifest.target;
  const app = typeof target === "object" && target !== null && typeof (target as Record<string, unknown>).app === "string"
    ? (target as Record<string, unknown>).app : "Unknown app";
  const window = typeof target === "object" && target !== null && typeof ((target as Record<string, unknown>).windowTitle ?? (target as Record<string, unknown>).window_title) === "string"
    ? ((target as Record<string, unknown>).windowTitle ?? (target as Record<string, unknown>).window_title) : "Unknown window";
  const durationMs = bundle.manifest.durationMs ?? bundle.manifest.duration_ms;
  const duration = typeof durationMs === "number" ? `${Math.round(durationMs / 1000)}s` : "unknown duration";
  try {
    await runCapture(`[scrawl ${app} · ${window} · ${duration} · ${bundle.dir}]\n\n${bundle.summary}`, { deferIndex: true, quiet: true });
  } catch (error) {
    unlinkSync(marker);
    throw error;
  }
}

export async function expandScrawl({ text, images }: { text: string; images?: ImageUpload[] }): Promise<{ text: string; images?: ImageUpload[]; bundle?: ScrawlBundle }> {
  const unchanged = { text, ...(images ? { images } : {}) };
  const found = findScrawl(text);
  if (!found) return unchanged;
  let bundle: ScrawlBundle;
  try {
    bundle = resolveBundle(found.path);
  } catch (error) {
    if (found.path === "latest") return unchanged;
    throw error;
  }
  const pointer = `[scrawl: ${bundle.dir}]`;
  const expandedText = `${text}${text.includes(pointer) ? "" : `\n\n${pointer}`}`;
  const encoded = readFileSync(bundle.sheet).toString("base64");
  const sheetImage: ImageUpload = { mediaType: "image/png", data: encoded };
  const attached = images ?? [];
  const alreadyAttached = attached.some((image) => image.mediaType === sheetImage.mediaType && image.data === encoded);
  return {
    text: expandedText.includes(bundle.summary) ? expandedText : `${expandedText}\n\n${bundle.summary}`,
    images: alreadyAttached ? attached : [...attached, sheetImage],
    bundle,
  };
}
