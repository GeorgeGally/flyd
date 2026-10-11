import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { FLYD_DIR } from "../lib/config.js";
import { sniffImage } from "./firstmate-inbox.js";

// The screenshot firstmate looked at before answering one of his notes, kept
// in Flyd's own storage. Firstmate's screenshots live in its scratchpad, which
// is cleared, and it often reuses one file name for every shot; what it saw is
// the image its Read returned, so that is what is copied, from the transcript,
// once, when the answer is first recorded.

/** Claude Code shows the model an image no larger than this on its long side. */
const SHOWN_SIDE = 2000;

/** An image's pixel size from its header (PNG, JPEG, GIF, WebP), or null. */
export function imageSize(bytes: Buffer): { width: number; height: number } | null {
  const type = sniffImage(bytes);
  if (!type || bytes.length < 30) return null;
  if (type.ext === "png") return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  if (type.ext === "gif") return { width: bytes.readUInt16LE(6), height: bytes.readUInt16LE(8) };
  if (type.ext === "webp") {
    const chunk = bytes.subarray(12, 16).toString("latin1");
    if (chunk === "VP8X") return { width: 1 + bytes.readUIntLE(24, 3), height: 1 + bytes.readUIntLE(27, 3) };
    if (chunk === "VP8L") {
      const bits = bytes.readUInt32LE(21);
      return { width: 1 + (bits & 0x3fff), height: 1 + ((bits >> 14) & 0x3fff) };
    }
    return { width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff };
  }
  // JPEG: the frame header (SOFn, not DHT/JPG/DAC) carries the size.
  let at = 2;
  while (at + 9 < bytes.length) {
    if (bytes[at] !== 0xff) return null;
    const marker = bytes[at + 1]!;
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { width: bytes.readUInt16BE(at + 7), height: bytes.readUInt16BE(at + 5) };
    }
    at += 2 + bytes.readUInt16BE(at + 2);
  }
  return null;
}

/**
 * Whether a screenshot the assistant read is one of his own images over again
 * (copied or converted first, so its path does not say): the same size, or
 * the size Claude Code scales his down to.
 */
export function isHisImage(shot: Buffer, his: Buffer[]): boolean {
  const seen = imageSize(shot);
  if (!seen) return false;
  return his.some((image) => {
    const size = imageSize(image);
    if (!size) return false;
    const scale = Math.min(1, SHOWN_SIDE / Math.max(size.width, size.height));
    const shown = { width: Math.round(size.width * scale), height: Math.round(size.height * scale) };
    const near = (a: { width: number; height: number }) => Math.abs(a.width - seen.width) <= 1 && Math.abs(a.height - seen.height) <= 1;
    return near(size) || near(shown);
  });
}

/** A shot's file stem: the session and the transcript image id it came from. */
const STEM = /^[A-Za-z0-9_-]+-t\d+\.\d+$/;

export class ReplyShots {
  readonly root: string;
  /** Kept shots by stem, and stems already found unreadable, so neither is read again. */
  private readonly kept = new Map<string, string | null>();

  constructor(options: { root?: string } = {}) {
    this.root = options.root ?? join(FLYD_DIR, "view", "reply-shots");
  }

  /**
   * The absolute path of Flyd's copy of a transcript image, copying it on
   * first sight; null when the bytes cannot be read back or are no image.
   */
  keep(sessionId: string, imageId: string, read: () => { mediaType: string; data: Buffer } | null): string | null {
    const stem = `${sessionId}-${imageId}`;
    if (!STEM.test(stem)) return null;
    const known = this.kept.get(stem);
    if (known !== undefined) return known;
    const existing = this.existing(stem);
    if (existing) {
      this.kept.set(stem, existing);
      return existing;
    }
    let image: { mediaType: string; data: Buffer } | null = null;
    try {
      image = read();
    } catch {
      image = null;
    }
    const type = image ? sniffImage(image.data) : null;
    if (!image || !type) {
      this.kept.set(stem, null);
      return null;
    }
    mkdirSync(this.root, { recursive: true, mode: 0o700 });
    const path = join(this.root, `${stem}.${type.ext}`);
    try {
      writeFileSync(path, image.data, { mode: 0o600, flag: "wx" });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    this.kept.set(stem, path);
    return path;
  }

  private existing(stem: string): string | null {
    if (!existsSync(this.root)) return null;
    const name = readdirSync(this.root).find((entry) => entry.startsWith(`${stem}.`));
    return name ? join(this.root, name) : null;
  }
}
