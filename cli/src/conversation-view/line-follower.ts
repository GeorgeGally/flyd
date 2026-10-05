import { closeSync, openSync, readSync, statSync } from "node:fs";
import { StringDecoder } from "node:string_decoder";

const CHUNK_BYTES = 1 << 20;

/**
 * Reads complete lines from an append-only file, remembering its byte offset
 * so each call returns only what was appended since the last one. A trailing
 * partial line is held back until its newline arrives. Opens the file
 * read-only; never writes to it.
 */
export class LineFollower {
  private offset = 0;
  private pending = "";
  private decoder = new StringDecoder("utf8");

  constructor(private readonly path: string) {}

  /** True when the file shrank or was replaced since the last read; state was reset. */
  private resetIfTruncated(size: number): boolean {
    if (size >= this.offset) return false;
    this.offset = 0;
    this.pending = "";
    this.decoder = new StringDecoder("utf8");
    return true;
  }

  /**
   * Hands each new complete line (without newline) to `onLine` as it is
   * read, so a large file is never held in memory at once. `onTruncate` runs
   * first when the file was rewritten, so the caller can rebuild from the
   * lines that follow. Returns the number of lines delivered.
   */
  readNew(onLine: (line: string) => void, onTruncate?: () => void): number {
    const size = statSync(this.path).size;
    if (this.resetIfTruncated(size)) onTruncate?.();
    if (size === this.offset) return 0;

    let count = 0;
    const fd = openSync(this.path, "r");
    try {
      const buffer = Buffer.allocUnsafe(CHUNK_BYTES);
      while (this.offset < size) {
        const read = readSync(fd, buffer, 0, Math.min(CHUNK_BYTES, size - this.offset), this.offset);
        if (read <= 0) break;
        this.offset += read;
        const text = this.pending + this.decoder.write(buffer.subarray(0, read));
        const parts = text.split("\n");
        this.pending = parts.pop() ?? "";
        for (const part of parts) {
          if (part.length === 0) continue;
          count++;
          onLine(part);
        }
      }
    } finally {
      closeSync(fd);
    }
    return count;
  }
}
