export interface ParsedMarkdown {
  metadata: Record<string, unknown>;
  body: string;
}

export function serialize(meta: Record<string, unknown>, body: string): string {
  const lines = ["---"];
  for (const [k, v] of Object.entries(meta)) {
    if (Array.isArray(v)) {
      if (v.length > 0 && typeof v[0] === "object" && v[0] !== null) {
        lines.push(`${k}:`);
        for (const item of v) {
          const obj = item as Record<string, unknown>;
          const entries = Object.entries(obj);
          for (let i = 0; i < entries.length; i++) {
            const [ik, iv] = entries[i];
            const prefix = i === 0 ? "  - " : "    ";
            lines.push(`${prefix}${ik}: ${String(iv)}`);
          }
        }
      } else {
        lines.push(`${k}:`);
        for (const item of v) lines.push(`  - ${item}`);
      }
    } else {
      lines.push(`${k}: ${v}`);
    }
  }
  lines.push("---", "", body);
  return lines.join("\n");
}

export function parse(content: string): ParsedMarkdown {
  if (!content.startsWith("---")) return { metadata: {}, body: content };
  const end = content.indexOf("\n---", 3);
  if (end === -1) return { metadata: {}, body: content };

  const frontmatter = content.slice(4, end).trim();
  const body = content.slice(end + 4).replace(/^\n+/, "");
  const metadata: Record<string, unknown> = {};

  const coerceValue = (raw: string): string | number | boolean => {
    const trimmed = raw.trim();
    const num = Number(trimmed);
    if (!isNaN(num) && trimmed !== "") return num;
    if (trimmed === "true") return true;
    if (trimmed === "false") return false;
    return trimmed;
  };

  let currentKey: string | null = null;
  let listMode: "idle" | "string" | "object" = "idle";
  let stringList: string[] = [];
  let currentObject: Record<string, string | number | boolean> = {};
  let objectList: Record<string, string | number | boolean>[] = [];

  const flushList = () => {
    if (listMode === "object") {
      finishObject();
    }
    const combined: unknown[] = [];
    if (objectList.length > 0) combined.push(...objectList);
    if (stringList.length > 0) combined.push(...stringList);
    if (combined.length > 0) {
      metadata[currentKey!] = combined;
    }
    objectList = [];
    stringList = [];
    listMode = "idle";
  };

  const finishObject = () => {
    if (Object.keys(currentObject).length > 0) {
      objectList.push(currentObject);
      currentObject = {};
    }
  };

  for (const line of frontmatter.split("\n")) {
    const itemMatch = line.match(/^  - (.+)$/);
    const continuationMatch = line.match(/^    (\w[\w_-]*):\s*(.*)$/);

    if (itemMatch && currentKey !== null) {
      const item = itemMatch[1];
      const keyValMatch = item.match(/^(\w[\w_-]*):\s*(.*)$/);

      if (keyValMatch) {
        if (listMode !== "idle") {
          finishObject();
        }
        listMode = "object";
        const [, k, v] = keyValMatch;
        currentObject[k] = coerceValue(v);
      } else {
        if (listMode === "object") {
          finishObject();
        }
        listMode = "string";
        stringList.push(String(coerceValue(item)));
      }
      continue;
    }

    if (continuationMatch && currentKey !== null && listMode === "object") {
      const [, k, v] = continuationMatch;
      currentObject[k] = coerceValue(v);
      continue;
    }

    const kv = line.match(/^(\w[\w_-]*):\s*(.*)$/);
    if (!kv) continue;
    const [, key, val] = kv;

    if (listMode !== "idle") {
      flushList();
    }

    if (val.trim() === "") {
      currentKey = key;
      listMode = "idle";
    } else {
      currentKey = null;
      const num = Number(val);
      if (!isNaN(num) && val.trim() !== "") {
        metadata[key] = num;
      } else if (val === "true") {
        metadata[key] = true;
      } else if (val === "false") {
        metadata[key] = false;
      } else {
        metadata[key] = val.trim();
      }
    }
  }

  if (listMode !== "idle") {
    flushList();
  }

  return { metadata, body };
}
