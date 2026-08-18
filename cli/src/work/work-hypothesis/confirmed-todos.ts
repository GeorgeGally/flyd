import { randomUUID } from "crypto";
import { existsSync, readdirSync, readFileSync } from "fs";
import { join } from "path";
import { FLYD_DIR } from "../../lib/config.js";
import { getDb } from "../database.js";
import { appendCorrection, activeDemotions, readPresentModel, enforceDemotionConstraints } from "./store.js";

export interface ConfirmedTodo {
  id: string;
  description: string;
  status: "open" | "done";
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  /** ISO date (YYYY-MM-DD) when known — hard deadlines outrank repo activity. */
  dueAt?: string;
}

export interface TodoDraft {
  description: string;
  dueAt?: string;
}

export interface TodoHistoryTurn {
  role: "user" | "assistant";
  content: string;
}

/** Interrogative only — do not match “no i gave u my to do”. */
const TODO_LIST_QUESTION =
  /^(?:what(?:'s|s|\s+is)|whats|show(?:\s+me)?|list)\b[\s\S]{0,80}\b(?:to[- ]?dos?|todos?)(?:\s+list)?\s*\??$/i;

const LIST_CORRECTION_PREFIX =
  /^(?:actually|no)[,:]?\s*(?:it'?s|its|the\s+(?:list|to[- ]?dos?)\s+(?:is|are))?\s*(?:this|these)?\s*:?\s*/i;

const GAVE_ALREADY =
  /^(?:no[,.]?\s+)?i\s+(?:already\s+)?(?:gave|told|showed|sent)\b/i;

/** “add Bridgestone and LinkedIn bio” / “add to my todos: x, y” — not “add to memories”. */
const ADD_TODOS_TO_LIST =
  /^add\s+to\s+(?:my\s+)?(?:to[- ]?dos?|list)\s*:?\s+([\s\S]+)$/i;
const ADD_TODOS_INLINE = /^add\s*:?\s+(.+)$/i;

const COMPLETION_STOPWORDS = new Set([
  "i", "we", "it", "that", "this", "they", "he", "she", "you", "my", "the", "a", "an",
]);

const COMPLETE_PATTERNS = [
  /^(?:i\s+(?:already\s+)?(?:said|told\s+you)(?:\s+that)?\s+)?(.+?)\s+(?:is|are)\s+(?:complete|done|finished)\.?$/i,
  /^(?:mark\s+)?(.+?)\s+as\s+(?:complete|done|finished)\.?$/i,
  /^completed?\s+(.+)$/i,
];

function mapRow(r: Record<string, unknown>): ConfirmedTodo {
  return {
    id: r.id as string,
    description: r.description as string,
    status: r.status as ConfirmedTodo["status"],
    sortOrder: Number(r.sort_order) || 0,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
    completedAt: (r.completed_at as string) || undefined,
    dueAt: (r.due_at as string) || undefined,
  };
}

const MONTHS: Record<string, number> = {
  january: 0, jan: 0, february: 1, feb: 1, march: 2, mar: 2, april: 3, apr: 3,
  may: 4, june: 5, jun: 5, july: 6, jul: 6, august: 7, aug: 7,
  september: 8, sep: 8, sept: 8, october: 9, oct: 9, november: 10, nov: 10,
  december: 11, dec: 11,
};

/** Parse "by 5 September" / "before Sept 5" / "due 2026-09-05" into YYYY-MM-DD. */
export function parseDueDate(text: string, now = new Date()): string | undefined {
  const iso = text.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  const named = text.match(
    /\b(?:by|before|due(?:\s+on)?|deadline)\s+(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+)\b/i,
  ) ?? text.match(
    /\b(?:by|before|due(?:\s+on)?|deadline)\s+([A-Za-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?\b/i,
  );
  if (!named) return undefined;

  let day: number;
  let monthName: string;
  if (/^\d/.test(named[1])) {
    day = Number(named[1]);
    monthName = named[2];
  } else {
    monthName = named[1];
    day = Number(named[2]);
  }
  const month = MONTHS[monthName.toLowerCase()];
  if (month === undefined || !Number.isFinite(day) || day < 1 || day > 31) return undefined;

  let year = now.getFullYear();
  const candidate = new Date(Date.UTC(year, month, day));
  const today = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  if (candidate.getTime() < today.getTime() - 2 * 86400000) year += 1;
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function parseTodoDraft(raw: string, now = new Date()): TodoDraft {
  const dueAt = parseDueDate(raw, now);
  let description = raw.trim();
  if (dueAt) {
    description = description
      .replace(/\b(?:by|before|due(?:\s+on)?|deadline)\s+\d{1,2}(?:st|nd|rd|th)?\s+[A-Za-z]+\b/i, "")
      .replace(/\b(?:by|before|due(?:\s+on)?|deadline)\s+[A-Za-z]+\s+\d{1,2}(?:st|nd|rd|th)?\b/i, "")
      .replace(/\b(20\d{2})-(\d{2})-(\d{2})\b/, "")
      .replace(/\s{2,}/g, " ")
      .replace(/\s+([,.])/g, "$1")
      .trim()
      .replace(/[—,]+$/, "")
      .trim();
  }
  return { description: description || raw.trim(), dueAt };
}

export function listOpenConfirmedTodos(): ConfirmedTodo[] {
  try {
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT * FROM confirmed_todos WHERE status = 'open'
         ORDER BY CASE WHEN due_at IS NULL OR due_at = '' THEN 1 ELSE 0 END ASC,
                  due_at ASC, sort_order ASC, created_at ASC`,
      )
      .all() as Array<Record<string, unknown>>;
    return rows.map(mapRow);
  } catch {
    return [];
  }
}

export function replaceConfirmedTodos(descriptions: string[]): ConfirmedTodo[] {
  const db = getDb();
  const now = new Date().toISOString();
  const drafts = uniqueDescriptions(descriptions).map((d) => parseTodoDraft(d));
  db.prepare(
    `UPDATE confirmed_todos SET status = 'done', updated_at = ?, completed_at = ? WHERE status = 'open'`,
  ).run(now, now);
  const inserted: ConfirmedTodo[] = [];
  const stmt = db.prepare(
    `INSERT INTO confirmed_todos (id, description, status, sort_order, created_at, updated_at, due_at)
     VALUES (?, ?, 'open', ?, ?, ?, ?)`,
  );
  drafts.forEach((draft, i) => {
    const id = `todo-${randomUUID().slice(0, 8)}`;
    stmt.run(id, draft.description, i, now, now, draft.dueAt ?? null);
    inserted.push({
      id,
      description: draft.description,
      status: "open",
      sortOrder: i,
      createdAt: now,
      updatedAt: now,
      dueAt: draft.dueAt,
    });
  });
  return inserted;
}

/** Append items that are not already open (case-insensitive). */
export function appendConfirmedTodos(descriptions: string[]): ConfirmedTodo[] {
  const open = listOpenConfirmedTodos();
  const existing = new Set(open.map((t) => t.description.toLowerCase()));
  const drafts = uniqueDescriptions(descriptions)
    .map((d) => parseTodoDraft(d))
    .filter((d) => !existing.has(d.description.toLowerCase()));
  if (!drafts.length) return open;

  const db = getDb();
  const now = new Date().toISOString();
  let order = open.length ? Math.max(...open.map((t) => t.sortOrder)) + 1 : 0;
  const stmt = db.prepare(
    `INSERT INTO confirmed_todos (id, description, status, sort_order, created_at, updated_at, due_at)
     VALUES (?, ?, 'open', ?, ?, ?, ?)`,
  );
  for (const draft of drafts) {
    stmt.run(`todo-${randomUUID().slice(0, 8)}`, draft.description, order, now, now, draft.dueAt ?? null);
    order += 1;
  }
  return listOpenConfirmedTodos();
}

export function completeConfirmedTodo(query: string): ConfirmedTodo | null {
  const open = listOpenConfirmedTodos();
  if (!open.length) return null;
  const q = query.trim().toLowerCase();
  const match =
    open.find((t) => t.description.toLowerCase() === q) ??
    open.find((t) => t.description.toLowerCase().includes(q) || q.includes(t.description.toLowerCase()));
  if (!match) return null;

  const now = new Date().toISOString();
  getDb()
    .prepare(
      `UPDATE confirmed_todos SET status = 'done', updated_at = ?, completed_at = ? WHERE id = ?`,
    )
    .run(now, now, match.id);
  return { ...match, status: "done", updatedAt: now, completedAt: now };
}

export function formatTodoList(todos: ConfirmedTodo[]): string {
  if (!todos.length) {
    return "No confirmed to-dos yet. Paste the list (one `- item` per line) and I'll record it.";
  }
  const lines = todos.map((t, i) => {
    const due = t.dueAt ? ` (due ${formatDueLabel(t.dueAt)})` : "";
    return `${i + 1}. ${t.description}${due}`;
  });
  return `Confirmed to-dos:\n${lines.join("\n")}`;
}

function formatDueLabel(isoDate: string): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  if (!y || !m || !d) return isoDate;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${d} ${months[m - 1]}`;
}

function uniqueDescriptions(descriptions: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of descriptions) {
    const d = raw.trim();
    if (!d) continue;
    const key = d.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(d);
  }
  return out;
}

export function isListItemLine(line: string): boolean {
  return /^[-*•]\s+\S/.test(line.trim()) || /^\d+[.)]\s+\S/.test(line.trim());
}

/** True when every non-empty line is a bullet/number item. */
export function isBareTodoList(message: string): boolean {
  const lines = message
    .trim()
    .split(/\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (!lines.length) return false;
  return lines.every(isListItemLine);
}

/** Parse bullet / numbered / newline list bodies into descriptions. */
export function parseTodoItems(text: string): string[] {
  const body = text.replace(LIST_CORRECTION_PREFIX, "").trim();

  const lines = body
    .split(/\n|;/)
    .map((l) => l.replace(/^[\s]*[-*•\d.)]+\s*/, "").trim())
    .filter(Boolean);

  if (lines.length >= 1 && isBareTodoList(body)) return uniqueDescriptions(lines);
  if (lines.length >= 2) return uniqueDescriptions(lines);

  if (/^(?:actually|no)\b/i.test(text) && body.includes(",") && !body.includes("\n")) {
    return uniqueDescriptions(body.split(/,\s*/));
  }

  return lines.length === 1 ? lines : [];
}

export function isTodoListQuestion(message: string): boolean {
  return TODO_LIST_QUESTION.test(message.trim());
}

export function isTodoListCorrection(message: string): boolean {
  const t = message.trim();
  if (LIST_CORRECTION_PREFIX.test(t) && (t.includes("\n") || t.includes("- ") || t.includes("* "))) {
    return parseTodoItems(t).length >= 1;
  }
  if (/^(?:actually|no)[,:]?\s+/i.test(t) && (t.includes("\n") || /- /.test(t))) {
    return parseTodoItems(t).length >= 1;
  }
  return false;
}

export function isConfirmedTodoUtterance(message: string): boolean {
  const trimmed = message.trim();
  return (
    isTodoListQuestion(trimmed) ||
    isTodoListCorrection(trimmed) ||
    isBareTodoList(trimmed) ||
    GAVE_ALREADY.test(trimmed) ||
    parseAddTodoItems(trimmed).length > 0
  );
}

/** Parse “add X and Y” / “add X, Y” into item descriptions. */
export function parseAddTodoItems(message: string): string[] {
  const trimmed = message.trim();
  // Memory ingest is a different surface — never treat as to-dos.
  if (/\bmemor(?:y|ies)\b/i.test(trimmed.slice(0, 120))) return [];

  const listMatch = trimmed.match(ADD_TODOS_TO_LIST);
  const inlineMatch = !trimmed.includes("\n") ? trimmed.match(ADD_TODOS_INLINE) : null;
  const body = (listMatch?.[1] ?? inlineMatch?.[1] ?? "").trim();
  if (!body) return [];

  if (isBareTodoList(body) || body.includes("\n")) return parseTodoItems(body);

  const parts = body
    .split(/\s+and\s+|,\s*/i)
    .map((p) => p.trim().replace(/[.!]+$/, ""))
    .filter((p) => p.length >= 2);
  return uniqueDescriptions(parts);
}

export function parseTodoCompletion(message: string): string | null {
  const t = message.trim();
  for (const re of COMPLETE_PATTERNS) {
    const m = t.match(re);
    if (!m?.[1]) continue;
    const name = m[1]
      .trim()
      .replace(/[.!]+$/, "")
      .replace(/^(?:that\s+)/i, "")
      .trim();
    if (name.length < 2 || name.length >= 80) continue;
    if (COMPLETION_STOPWORDS.has(name.toLowerCase())) continue;
    if (/\b(?:is|are|said|told)\b/i.test(name)) continue;
    return name;
  }
  return null;
}

export function demotePresentThread(query: string, sourceText: string): string | null {
  const prior = readPresentModel();
  if (!prior) return null;
  const q = query.trim().toLowerCase();
  const already = new Set(
    [...(prior.demotions ?? []), ...activeDemotions()].map((d) => d.toLowerCase()),
  );
  const threads = [...prior.primaryThreads, ...prior.secondaryThreads];
  const match =
    threads.find((t) => t.name.toLowerCase() === q) ??
    threads.find(
      (t) => t.name.toLowerCase().includes(q) || q.includes(t.name.toLowerCase()),
    );
  if (!match) return null;
  if (already.has(match.name.toLowerCase()) || match.demoted) return null;

  appendCorrection({
    hypothesisId: prior.id,
    kind: "demote",
    projectName: match.name,
    projectRoot: match.root,
    text: sourceText,
  });
  enforceDemotionConstraints(prior);
  return match.name;
}

/** Pull bullet items from in-session history + recent conversation files. */
export function recoverTodoItemsFromHistory(
  history: TodoHistoryTurn[] = [],
  flydDir: string = FLYD_DIR,
): string[] {
  const collected: string[] = [];

  for (const turn of history) {
    if (turn.role !== "user") continue;
    collected.push(...extractTodoLinesFromText(turn.content));
  }

  const dir = join(flydDir, "conversations");
  if (existsSync(dir)) {
    const files = readdirSync(dir)
      .filter((n) => n.endsWith(".json"))
      .sort()
      .slice(-12);
    for (const name of files) {
      try {
        const record = JSON.parse(readFileSync(join(dir, name), "utf8")) as {
          exchanges?: Array<{ user?: string }>;
        };
        for (const exchange of record.exchanges ?? []) {
          if (exchange.user) collected.push(...extractTodoLinesFromText(exchange.user));
        }
      } catch {
        // skip corrupt records
      }
    }
  }

  return uniqueDescriptions(collected);
}

function extractTodoLinesFromText(text: string): string[] {
  const trimmed = text.trim();
  if (isBareTodoList(trimmed) || isTodoListCorrection(trimmed)) {
    return parseTodoItems(trimmed);
  }
  if (isListItemLine(trimmed) && !trimmed.includes("\n")) {
    return [trimmed.replace(/^[-*•\d.)]+\s*/, "").trim()];
  }
  return [];
}

/**
 * Deterministic to-do semantics — never invent commitments from Present Model activity.
 */
export interface TodoUtteranceResult {
  reply: string;
  /** Newly recorded items — caller should retrieve memory for these. */
  recallFor?: string[];
}

export function handleConfirmedTodoUtterance(
  message: string,
  history: TodoHistoryTurn[] = [],
  options: { flydDir?: string } = {},
): TodoUtteranceResult | null {
  const trimmed = message.trim();

  if (isTodoListQuestion(trimmed)) {
    return { reply: formatTodoList(listOpenConfirmedTodos()) };
  }

  if (GAVE_ALREADY.test(trimmed)) {
    const recovered = recoverTodoItemsFromHistory(history, options.flydDir ?? FLYD_DIR);
    if (recovered.length) {
      const saved = replaceConfirmedTodos(recovered);
      return {
        reply: `Found ${saved.length} item${saved.length === 1 ? "" : "s"} you already gave me — recorded and persisted.\n${formatTodoList(saved)}`,
        recallFor: saved.map((t) => t.description),
      };
    }
    return {
      reply: "You're right to call that out — I don't have a persisted list yet. Paste it as bullets (`- item`) and I'll save it.",
    };
  }

  const additions = parseAddTodoItems(trimmed);
  if (additions.length) {
    const before = new Set(listOpenConfirmedTodos().map((t) => t.description.toLowerCase()));
    const saved = appendConfirmedTodos(additions);
    const fresh = additions.filter((d) => !before.has(d.toLowerCase()));
    if (!fresh.length) {
      return { reply: `Already on your list.\n${formatTodoList(saved)}` };
    }
    return {
      reply: `Added ${fresh.length} item${fresh.length === 1 ? "" : "s"} (persisted).\n${formatTodoList(saved)}`,
      recallFor: fresh,
    };
  }

  if (isTodoListCorrection(trimmed)) {
    const items = parseTodoItems(trimmed);
    if (items.length >= 1) {
      const saved = replaceConfirmedTodos(items);
      return {
        reply: `Recorded ${saved.length} confirmed to-do${saved.length === 1 ? "" : "s"} (persisted).\n${formatTodoList(saved)}`,
        recallFor: saved.map((t) => t.description),
      };
    }
  }

  if (isBareTodoList(trimmed)) {
    const items = parseTodoItems(trimmed);
    if (items.length >= 2) {
      const saved = replaceConfirmedTodos(items);
      return {
        reply: `Recorded ${saved.length} confirmed to-do${saved.length === 1 ? "" : "s"} (persisted).\n${formatTodoList(saved)}`,
        recallFor: saved.map((t) => t.description),
      };
    }
    if (items.length === 1) {
      const before = new Set(listOpenConfirmedTodos().map((t) => t.description.toLowerCase()));
      const saved = appendConfirmedTodos(items);
      const fresh = items.filter((d) => !before.has(d.toLowerCase()));
      if (!fresh.length) {
        return { reply: `Already on your list.\n${formatTodoList(saved)}` };
      }
      return {
        reply: `Added “${fresh[0]}” (persisted).\n${formatTodoList(saved)}`,
        recallFor: fresh,
      };
    }
  }

  const completed = parseTodoCompletion(trimmed);
  if (completed) {
    const done = completeConfirmedTodo(completed);
    const demoted = demotePresentThread(completed, trimmed);
    if (!done && !demoted) return null;

    const parts: string[] = [];
    if (done) parts.push(`Marked complete and persisted: ${done.description}.`);
    if (demoted) {
      parts.push(
        done && done.description.toLowerCase() === demoted.toLowerCase()
          ? `Also demoted from Present Model active threads (persisted).`
          : `Demoted “${demoted}” from Present Model active threads (persisted).`,
      );
    }
    parts.push(formatTodoList(listOpenConfirmedTodos()));
    return { reply: parts.join("\n") };
  }

  return null;
}
