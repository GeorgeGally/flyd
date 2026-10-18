import { createRequire } from "node:module";
import { whatsappClient, type WhatsAppClient } from "./whatsapp.js";

// Linking WhatsApp without a terminal. The pairing code is a secret: it is drawn
// as an image for a page to scan, and is never logged, stored, or handed to a
// page as text. Only the process that owns the socket ever holds it.

const require = createRequire(import.meta.url);
interface Encoder { addData(data: string): void; make(): void; getModuleCount(): number; isDark(row: number, col: number): boolean }
// qrcode-terminal already ships the encoder the terminal command draws with; we only draw our own SVG from it.
const QRCode = require("qrcode-terminal/vendor/QRCode") as new (type: number, level: number) => Encoder;
const ERROR_LEVEL_L = require("qrcode-terminal/vendor/QRCode/QRErrorCorrectLevel").L as number;

/** How long the pairing socket stays after a link, to receive the first history, before Core takes it over. */
const PAIRING_SYNC_MS = 60_000;

/** A pairing code as a scannable SVG, quiet zone included. Pure. */
export function qrSvg(code: string, module = 8): string {
  const qr = new QRCode(-1, ERROR_LEVEL_L);
  qr.addData(code);
  qr.make();
  const count = qr.getModuleCount();
  const quiet = 4;
  const size = (count + quiet * 2) * module;
  let path = "";
  for (let row = 0; row < count; row += 1) {
    for (let col = 0; col < count; col += 1) {
      if (qr.isDark(row, col)) path += `M${(col + quiet) * module} ${(row + quiet) * module}h${module}v${module}h-${module}z`;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges"><rect width="${size}" height="${size}" fill="#fff"/><path d="${path}" fill="#000"/></svg>`;
}

/** Drawn where the code will be, until the first code arrives, so the box is never blank. Never the code. */
export const PAIRING_PLACEHOLDER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="230" height="230" viewBox="0 0 230 230" shape-rendering="crispEdges"><rect width="230" height="230" fill="#fff"/><text x="115" y="118" text-anchor="middle" font-family="system-ui,sans-serif" font-size="13" fill="#8a8a8a">Drawing your code…</text></svg>`;

/**
 * A live pairing session: the code to scan while WhatsApp is unlinked, and
 * whether it has linked. One per process; it holds the same socket the
 * `flyd whatsapp connect` terminal command used to.
 */
export class WhatsAppPairing {
  private client?: WhatsAppClient;
  private code: string | undefined;
  private linked = false;
  private running: Promise<void> | undefined;
  private release?: NodeJS.Timeout;
  private readonly listeners = new Set<() => void>();
  /** Built on first use; the view reads state() on every update, so its store is created the moment the conversation view opens. */
  private readonly whatsapp = (): WhatsAppClient => (this.client ??= whatsappClient());

  /** Whether WhatsApp is linked, and the code to scan while it is not. */
  state(): { paired: boolean; code?: string } {
    const paired = this.linked || this.whatsapp().paired();
    return paired ? { paired } : { paired, ...(this.code ? { code: this.code } : {}) };
  }

  /** Listen for a code; safe to call on every poll. A no-op while one session runs. */
  start(): void {
    const client = this.whatsapp();
    if (this.running || client.paired()) return;
    this.code = undefined;
    this.running = client.connect((code) => { this.code = code; this.emit(); })
      .then(() => {
        this.linked = true;
        this.code = undefined;
        this.emit();
        // Let the first history sync land, then hand the socket back: Core is the
        // process that owns the linked device once it is paired.
        // ponytail: a fixed window; nothing here confirms that Core picked it up.
        this.release = setTimeout(() => this.stop(), PAIRING_SYNC_MS);
        this.release.unref?.();
      })
      .catch(() => this.stop())
      .finally(() => { this.running = undefined; });
  }

  /** Drop the pairing socket and any code: the offer is not being shown any more. */
  stop(): void {
    if (this.release) clearTimeout(this.release);
    this.release = undefined;
    this.client?.stop();
    this.linked = false;
    this.code = undefined;
    this.emit();
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void { for (const listener of this.listeners) listener(); }
}
