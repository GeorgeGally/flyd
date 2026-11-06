import { closeSync, createReadStream, openSync, readSync, statSync } from "node:fs";
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
  /** Byte offset in the file where `pending` starts. */
  private pendingStart = 0;
  private decoder = new StringDecoder("utf8");

  constructor(private readonly path: string) {}

  /** True when the file shrank or was replaced since the last read; state was reset. */
  private resetIfTruncated(size: number): boolean {
    if (size >= this.offset) return false;
    this.offset = 0;
    this.pending = "";
    this.pendingStart = 0;
    this.decoder = new StringDecoder("utf8");
    return true;
  }

  /**
   * Hands each new complete line (without newline) to `onLine` as it is
   * read, so a large file is never held in memory at once. `onTruncate` runs
   * first when the file was rewritten, so the caller can rebuild from the
   * lines that follow. `offset` is the line's starting byte in the file, so a
   * caller can come back for it later. Returns the number of lines delivered.
   */
  readNew(onLine: (line: string, offset: number) => void, onTruncate?: () => void): number {
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
        let cursor = this.pendingStart;
        for (const part of parts) {
          const start = cursor;
          cursor += Buffer.byteLength(part) + 1;
          if (part.length === 0) continue;
          count++;
          onLine(part, start);
        }
        this.pendingStart = cursor;
      }
    } finally {
      closeSync(fd);
    }
    return count;
  }
}

/**
 * Hands each complete line from byte `start` to `onLine` without holding the
 * event loop for the whole file, and returns the offset to carry on from: the
 * byte after the last newline. For a long transcript read in the background.
 */
export async function readLinesFrom(path: string, start: number, onLine: (line: string, offset: number) => void): Promise<number> {
  let held: Buffer = Buffer.alloc(0);
  let cursor = start;
  for await (const chunk of createReadStream(path, { start })) {
    const data = held.length ? Buffer.concat([held, chunk as Buffer]) : chunk as Buffer;
    let from = 0;
    for (let newline = data.indexOf(10, from); newline !== -1; newline = data.indexOf(10, from)) {
      if (newline > from) onLine(data.toString("utf8", from, newline), cursor + from);
      from = newline + 1;
    }
    cursor += from;
    held = data.subarray(from);
  }
  return cursor;
}
