// Read-only First Mate → Rounds compatibility projection. No task mutation or agent wake.
import { createHash } from "node:crypto";
import { readFileSync, realpathSync, statSync } from "node:fs";
import { extname, join, sep } from "node:path";
import type { ArtefactInputs, ArtefactRow } from "./artefact.js";

type CanvasShot = { hash: string; ext: string; w: number; h: number; name: string };
type CanvasSet = { id: string; thread: string; project: string; at: number; caption: string; shots: CanvasShot[]; kind: "screens" };
type CanvasThread = {
  id: string; title: string; cwd: string; archived: boolean; at: number; recap: string; project: string;
  days: Record<string, number>;
};
export interface WorkCanvasIndex {
  builtAt: number;
  projects: Record<string, string>;
  threads: CanvasThread[];
  pages: never[];
  sets: CanvasSet[];
  changed: never[];
  topics: Record<string, never[]>;
  comments: never[];
  previews: false;
  /** This projection is a bounded observation, not an exhaustive history. */
  complete: false;
  unavailable?: string;
}
export interface WorkCanvasMedia { path: string; mime: string; hash: string; bytes: number }
export interface WorkCanvasProjection { index: WorkCanvasIndex; media: Map<string, WorkCanvasMedia> }

const MIME: Record<string, string> = {
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".gif": "image/gif", ".webp": "image/webp",
};
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const MAX_SETS = 48;
const MAX_SHOTS_PER_TASK = 6;

export function workCanvasEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.FLYD_WORK_CANVAS === "1";
}

/** Actual dimensions (fallback is only for a corrupt/unidentified image, which is not admitted). */
export function imageSize(bytes: Buffer, ext: string): { w: number; h: number } | null {
  let w = 0;
  let h = 0;
  if (ext === ".png" && bytes.length >= 24 && bytes.subarray(1, 4).toString("ascii") === "PNG") {
    w = bytes.readUInt32BE(16); h = bytes.readUInt32BE(20);
  } else if (ext === ".gif" && bytes.length >= 10 && bytes.subarray(0, 3).toString("ascii") === "GIF") {
    w = bytes.readUInt16LE(6); h = bytes.readUInt16LE(8);
  } else if (ext === ".webp" && bytes.length >= 30 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") {
    const type = bytes.toString("ascii", 12, 16);
    if (type === "VP8X") {
      w = 1 + bytes.readUIntLE(24, 3); h = 1 + bytes.readUIntLE(27, 3);
    } else if (type === "VP8 " && bytes.length >= 30) {
      w = bytes.readUInt16LE(26) & 0x3fff; h = bytes.readUInt16LE(28) & 0x3fff;
    } else if (type === "VP8L" && bytes.length >= 25) {
      w = 1 + (((bytes[22] & 0x3f) << 8) | bytes[21]);
      h = 1 + (((bytes[24] & 0x0f) << 10) | (bytes[23] << 2) | ((bytes[22] & 0xc0) >> 6));
    }
  } else if ((ext === ".jpg" || ext === ".jpeg") && bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    for (let i = 2; i + 9 < bytes.length;) {
      if (bytes[i] !== 0xff) { i++; continue; }
      const marker = bytes[i + 1]!;
      if (marker === 0xff) { i++; continue; }
      if (marker === 0x00 || marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
      const len = bytes.readUInt16BE(i + 2);
      if (len < 2 || i + 2 + len > bytes.length) break;
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        h = bytes.readUInt16BE(i + 5); w = bytes.readUInt16BE(i + 7); break;
      }
      i += 2 + len;
    }
  }
  return w > 0 && h > 0 && w <= 16000 && h <= 16000 ? { w, h } : null;
}

function imageFile(path: string, dataRoot: string): { id: string; media: WorkCanvasMedia; shot: CanvasShot; at: number } | null {
  try {
    const ext = extname(path).toLowerCase();
    const mime = MIME[ext];
    if (!mime) return null;
    const real = realpathSync(path);
    if (!real.startsWith(dataRoot + sep)) return null;
    const stat = statSync(real);
    if (!stat.isFile() || stat.size < 10 || stat.size > MAX_IMAGE_BYTES) return null;
    const bytes = readFileSync(real);
    const size = imageSize(bytes, ext);
    if (!size) return null;
    const hash = createHash("sha256").update(bytes).digest("hex");
    return {
      id: hash,
      media: { path: real, mime, hash, bytes: stat.size },
      shot: { hash, ext: ext.slice(1), ...size, name: real.split(sep).at(-1) ?? "Screen" },
      at: stat.mtimeMs,
    };
  } catch {
    // Missing, unreadable, overwritten, oversized or outside First Mate data.
    return null;
  }
}

/** Never infer the authoring task from a project title or the screenshot name. */
export function projectFirstmateWork(
  inputs: ArtefactInputs,
  shotPath: (task: string, file: string) => string | null,
  home: string,
  now = Date.now(),
): WorkCanvasProjection {
  const projects: Record<string, string> = {};
  const threads: CanvasThread[] = [];
  const sets: CanvasSet[] = [];
  const media = new Map<string, WorkCanvasMedia>();
  let dataRoot = "";
  try { dataRoot = realpathSync(join(home, "data")); } catch { /* No First Mate data. */ }
  const rows: ArtefactRow[] = [
    ...(inputs.fleet?.calls ?? []), ...(inputs.fleet?.live ?? []),
    ...(inputs.fleet?.ready ?? []), ...(inputs.fleet?.landed ?? []),
    ...(inputs.fleet?.held ?? []), ...(inputs.fleet?.next ?? []),
  ];
  const seen = new Set<string>();
  const homeKey = createHash("sha256").update(home).digest("hex").slice(0, 12);

  for (const row of rows) {
    const task = row.task;
    if (!dataRoot || !task || !/^[\\w.-]+$/.test(task) || task.startsWith(".") || seen.has(task) || !row.shots?.length) continue;
    seen.add(task);
    const pictures: CanvasShot[] = [];
    let latest = 0;
    for (const file of row.shots.slice(0, MAX_SHOTS_PER_TASK)) {
      const path = shotPath(task, file);
      if (!path) continue; // Use ArtefactFeed's own allow-list, never a client path.
      const found = imageFile(path, dataRoot);
      if (!found || pictures.some((p) => p.hash === found.id)) continue;
      media.set(found.id, found.media);
      pictures.push(found.shot);
      latest = Math.max(latest, found.at);
    }
    if (!pictures.length) continue;
    const project = row.repo || "First Mate";
    projects[project] = project.split("/").at(-1) || project;
    const thread = `fm-${homeKey}-${task}`;
    const at = latest || (row.at ? Date.parse(row.at) : now) || now;
    const day = new Date(at).toLocaleDateString("en-CA");
    threads.push({ id: thread, title: row.label || task, cwd: project, archived: false,
      at, recap: row.detail ?? row.status ?? "", project, days: { [day]: pictures.length } });
    sets.push({ id: `screens-${thread}`, thread, project, at, caption: row.label || task, shots: pictures, kind: "screens" });
    if (sets.length >= MAX_SETS) break;
  }

  return {
    index: {
      builtAt: now, projects, threads, pages: [], sets, changed: [], topics: {},
      comments: [], previews: false, complete: false,
      ...(inputs.fleet?.unavailable ? { unavailable: inputs.fleet.unavailable } : {}),
    },
    media,
  };
}

/** Immutable media IDs must match bytes at response time, including after a file is replaced. */
export function readWorkMedia(media: WorkCanvasMedia, home: string): Buffer | null {
  try {
    const root = realpathSync(join(home, "data"));
    const real = realpathSync(media.path);
    if (!real.startsWith(root + sep)) return null;
    const stat = statSync(real);
    if (!stat.isFile() || stat.size > MAX_IMAGE_BYTES || stat.size !== media.bytes) return null;
    const bytes = readFileSync(real);
    return createHash("sha256").update(bytes).digest("hex") === media.hash ? bytes : null;
  } catch { return null; }
}
