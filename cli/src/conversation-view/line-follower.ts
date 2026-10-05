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
   * Returns new complete lines (without newline). `truncated` tells the
   * caller the file was rewritten and it should rebuild from these lines.
   */
  readNew(): { lines: string[]; truncated: boolean } {
    const size = statSync(this.path).size;
    const truncated = this.resetIfTruncated(size);
    if (size === this.offset) return { lines: [], truncated };

    const lines: string[] = [];
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
        for (const part of parts) if (part.length > 0) lines.push(part);
      }
    } finally {
      closeSync(fd);
    }
    return { lines, truncated };
  }
}
