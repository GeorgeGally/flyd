import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { FLYD_DIR } from "../lib/config.js";
import { MAX_FILE_BYTES, MAX_IMAGE_BYTES } from "./firstmate-inbox.js";

// The message box's unsent words and attachments, kept on disk as he types so
// a restarted view (an update, a reinstall, a crash) gives them back. The page
// also keeps a copy in its own storage, but that is tied to the port it was
// served on; this one is not. Cleared only when the message is sent or he
// empties the box himself.

export interface DraftAttachment {
  id: string;
  /** A document's own name; absent for a pasted picture. */
  name?: string;
  /** A picture's media type. */
  mediaType?: string;
}

export interface Draft {
  text: string;
  selectionStart: number;
  selectionEnd: number;
  attachments: DraftAttachment[];
  savedAt: number;
}

const MAX_TEXT = 200_000;
const MAX_ATTACHMENTS = 4;
const MAX_KEYS = 20;
const ID = /^[0-9a-f]{24}$/;
/** An attachment no draft names yet may be one the page is about to name. */
const UNCLAIMED_GRACE_MS = 10 * 60_000;
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];

/** One draft per window: the latest conversation, or a session opened by its id. */
export function draftKey(value: unknown): string {
  return typeof value === "string" && /^[\w.:-]{1,128}$/.test(value) ? value : "latest";
}

export class ComposerDrafts {
  private readonly root: string;

  constructor(options: { root?: string } = {}) {
    this.root = options.root ?? join(FLYD_DIR, "view", "drafts");
  }

  /** The draft and each attachment's bytes (base64), or null when the box was empty. */
  load(key: string): (Draft & { attachments: Array<DraftAttachment & { data: string }> }) | null {
    const draft = this.all()[key];
    if (!draft) return null;
    const attachments = draft.attachments.flatMap((attachment) => {
      try { return [{ ...attachment, data: readFileSync(this.file(attachment.id)).toString("base64") }]; } catch { return []; }
    });
    return { ...draft, attachments };
  }

  /** Keeps the box as it is now; an empty box removes the draft. Returns false for a malformed one. */
  save(key: string, value: unknown): boolean {
    const draft = parseDraft(value);
    if (!draft) return false;
    const all = this.all();
    if (!draft.text && draft.attachments.length === 0) delete all[key];
    else {
      delete all[key];
      all[key] = { ...draft, attachments: draft.attachments.filter((attachment) => this.has(attachment.id)) };
    }
    // Only the windows touched last keep a draft.
    for (const old of Object.keys(all).slice(0, -MAX_KEYS)) delete all[old];
    this.write(all);
    this.prune(all);
    return true;
  }

  /** Stores one attachment's bytes as it is added to the box; the draft names it by the returned id. */
  attach(value: unknown): DraftAttachment | null {
    if (typeof value !== "object" || value === null) return null;
    const { name, mediaType, data } = value as Record<string, unknown>;
    if (typeof data !== "string" || !data) return null;
    const isFile = typeof name === "string";
    if (isFile ? !name.trim() || name.length > 255 : typeof mediaType !== "string" || !IMAGE_TYPES.includes(mediaType)) return null;
    const bytes = Buffer.from(data, "base64");
    if (bytes.length === 0 || bytes.length > (isFile ? MAX_FILE_BYTES : MAX_IMAGE_BYTES)) return null;
    const id = randomBytes(12).toString("hex");
    mkdirSync(join(this.root, "attachments"), { recursive: true });
    writeFileSync(this.file(id), bytes, { mode: 0o600 });
    return isFile ? { id, name } : { id, mediaType: mediaType as string };
  }

  private all(): Record<string, Draft> {
    try {
      const saved = JSON.parse(readFileSync(join(this.root, "drafts.json"), "utf8")) as Record<string, unknown>;
      const all: Record<string, Draft> = {};
      for (const [key, value] of Object.entries(saved)) {
        const draft = parseDraft(value);
        if (draft) all[key] = draft;
      }
      return all;
    } catch {
      return {};
    }
  }

  private write(all: Record<string, Draft>): void {
    mkdirSync(this.root, { recursive: true });
    const path = join(this.root, "drafts.json");
    const temp = `${path}.${process.pid}.tmp`;
    writeFileSync(temp, JSON.stringify(all), { mode: 0o600 });
    renameSync(temp, path);
  }

  /** Attachments no draft names any more are removed, once they are old enough not to be on their way into one. */
  private prune(all: Record<string, Draft>): void {
    const kept = new Set(Object.values(all).flatMap((draft) => draft.attachments.map((attachment) => attachment.id)));
    let stored: string[] = [];
    try { stored = readdirSync(join(this.root, "attachments")); } catch { return; }
    const now = Date.now();
    for (const id of stored) {
      if (kept.has(id)) continue;
      try { if (now - statSync(this.file(id)).mtimeMs > UNCLAIMED_GRACE_MS) rmSync(this.file(id), { force: true }); } catch { /* already gone */ }
    }
  }

  private has(id: string): boolean {
    return existsSync(this.file(id));
  }

  private file(id: string): string {
    return join(this.root, "attachments", id);
  }
}

function parseDraft(value: unknown): Draft | null {
  if (typeof value !== "object" || value === null) return null;
  const { text, selectionStart, selectionEnd, attachments, savedAt } = value as Record<string, unknown>;
  if (typeof text !== "string" || text.length > MAX_TEXT || !Array.isArray(attachments) || attachments.length > MAX_ATTACHMENTS) return null;
  const parsed: DraftAttachment[] = [];
  for (const attachment of attachments) {
    if (typeof attachment !== "object" || attachment === null) return null;
    const { id, name, mediaType } = attachment as Record<string, unknown>;
    if (typeof id !== "string" || !ID.test(id)) return null;
    if (typeof name === "string") parsed.push({ id, name });
    else if (typeof mediaType === "string" && IMAGE_TYPES.includes(mediaType)) parsed.push({ id, mediaType });
    else return null;
  }
  const at = (n: unknown) => (typeof n === "number" && Number.isInteger(n) ? Math.max(0, Math.min(n, text.length)) : text.length);
  return {
    text,
    selectionStart: at(selectionStart),
    selectionEnd: at(selectionEnd),
    attachments: parsed,
    savedAt: typeof savedAt === "number" && Number.isFinite(savedAt) ? savedAt : Date.now(),
  };
}
