import { randomUUID } from "crypto";
import { existsSync } from "fs";
import { mkdir, readFile, readdir, rename, writeFile } from "fs/promises";
import { dirname, join } from "path";
import { FLYD_DIR, PROJECT } from "../lib/config.js";
import { serialize } from "../lib/frontmatter.js";
import { extractKeywords } from "../lib/retrieval.js";
import { interpretAgentInput } from "./input-interpreter.js";
import type { MemoryEvidence, MemoryMatchSummary } from "./types.js";

interface ConversationExchange {
  user: string;
  assistant: string;
  recordedAt: string;
  handoff?: ActionableOutcome;
}

export interface ActionableOutcome {
  outcome: string;
  sourceSessionId: string;
  sourceTurn: number;
  recordedAt: string;
}

interface ConversationRecord {
  version: 1;
  id: string;
  project: string;
  projectPath: string;
  startedAt: string;
  updatedAt: string;
  title: string;
  exchanges: ConversationExchange[];
}

interface ConversationMemorySessionOptions {
  flydDir?: string;
  id?: string;
  now?: () => Date;
  project?: string;
  projectPath?: string;
}

interface ConversationRetrievalOptions {
  flydDir?: string;
  excludeSessionId?: string;
  now?: () => Date;
}

export interface ConversationMemorySession {
  id: string;
  recordTurn(turn: { user: string; assistant: string; handoff?: ActionableOutcome }): Promise<void>;
}

export const CONTINUITY_QUESTION =
  /(?:\b(?:what were we (?:just )?talking about|what did we (?:just )?(?:discuss|talk about)|before this|previous conversation|last conversation|earlier conversation|where did we leave off)\b|^(?:continue|conrtinue|carry on|keep going)(?:\s+(?:with\s+)?(?:that|it|this))?[.!]?$)/i;
const MAX_SCANNED_SESSIONS = 100;
const MAX_MATCHES = 3;
const MAX_EXCERPT_CHARS = 6_000;
const MAX_MERGED_EVIDENCE_CHARS = 12_000;
const MAX_ACTION_AGE_MS = 24 * 60 * 60 * 1_000;
const LOW_INFORMATION_TERMS = new Set([
  "chat", "current", "currently", "hello", "latest", "recent", "thanks", "thank", "today",
]);

export function extractMemoryKeywords(query: string): string[] {
  return extractKeywords(query).filter((keyword) => !LOW_INFORMATION_TERMS.has(keyword));
}

function cleanInline(value: string, maximum = 100): string {
  return value.replace(/\s+/g, " ").trim().slice(0, maximum);
}

function sessionTitle(message: string): string {
  return cleanInline(message, 80) || "Conversation";
}

function safeSessionId(id: string): string {
  if (!/^[A-Za-z0-9._-]+$/.test(id)) throw new Error("Invalid conversation session ID");
  return id;
}

function stateDirectory(flydDir: string): string {
  return join(flydDir, "conversations");
}

function statePath(flydDir: string, id: string): string {
  return join(stateDirectory(flydDir), `${id}.json`);
}

function transcriptPath(flydDir: string, id: string): string {
  return join(flydDir, "raw", `conversation-${id}.md`);
}

function wikiIndexPath(flydDir: string, id: string): string {
  return join(flydDir, "wiki", "conversations", `${id}.md`);
}

async function atomicWrite(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporaryPath = `${path}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`;
  await writeFile(temporaryPath, content, { encoding: "utf8", mode: 0o600 });
  await rename(temporaryPath, path);
}

function transcriptMarkdown(record: ConversationRecord): string {
  const exchanges = record.exchanges.map((exchange) => [
    `## ${exchange.recordedAt}`,
    "",
    "**George**",
    "",
    exchange.user,
    "",
    "**Flyd**",
    "",
    exchange.assistant,
  ].join("\n")).join("\n\n");

  return serialize({
    type: "flyd-conversation-transcript",
    source: "flyd-cli",
    epistemic_status: "source_evidence",
    promoted: false,
    session_id: record.id,
    project: record.project,
    project_path: record.projectPath,
    started_at: record.startedAt,
    updated_at: record.updatedAt,
  }, `# ${record.title}\n\n${exchanges}`);
}

function wikiIndexMarkdown(record: ConversationRecord): string {
  const userStatements = record.exchanges.map((exchange) =>
    `- ${exchange.recordedAt}: ${cleanInline(exchange.user, 800)}`
  ).join("\n");
  const topics = extractMemoryKeywords(record.exchanges.map((exchange) => exchange.user).join(" "))
    .slice(0, 16);

  return serialize({
    type: "conversation-index",
    source: `raw/conversation-${record.id}.md`,
    epistemic_status: "source_evidence",
    promoted: false,
    session_id: record.id,
    project: record.project,
    started_at: record.startedAt,
    updated_at: record.updatedAt,
    tags: topics,
  }, [
    `# ${record.title}`,
    "",
    "This is an index of what George said in a Flyd conversation. It is source evidence, not promoted long-term truth.",
    "",
    "## George said",
    "",
    userStatements,
  ].join("\n"));
}

async function persistRecord(flydDir: string, record: ConversationRecord): Promise<void> {
  await atomicWrite(statePath(flydDir, record.id), `${JSON.stringify(record, null, 2)}\n`);
  await Promise.all([
    atomicWrite(transcriptPath(flydDir, record.id), transcriptMarkdown(record)),
    atomicWrite(wikiIndexPath(flydDir, record.id), wikiIndexMarkdown(record)),
  ]);
}

export function createConversationMemorySession(
  options: ConversationMemorySessionOptions = {},
): ConversationMemorySession {
  const flydDir = options.flydDir ?? FLYD_DIR;
  const now = options.now ?? (() => new Date());
  const startedAt = now().toISOString();
  const generatedId = `${startedAt.replace(/[^0-9]/g, "").slice(0, 17)}-${randomUUID()}`;
  const id = safeSessionId(options.id ?? generatedId);
  const record: ConversationRecord = {
    version: 1,
    id,
    project: cleanInline(options.project ?? PROJECT.name, 500),
    projectPath: cleanInline(options.projectPath ?? PROJECT.path, 2_000),
    startedAt,
    updatedAt: startedAt,
    title: "Conversation",
    exchanges: [],
  };

  return {
    id,
    async recordTurn(turn) {
      const recordedAt = now().toISOString();
      if (record.exchanges.length === 0) record.title = sessionTitle(turn.user);
      record.updatedAt = recordedAt;
      record.exchanges.push({
        user: turn.user,
        assistant: turn.assistant,
        recordedAt,
        ...(turn.handoff ? { handoff: turn.handoff } : {}),
      });
      await persistRecord(flydDir, record);
    },
  };
}

async function readRecords(flydDir: string): Promise<ConversationRecord[]> {
  const directory = stateDirectory(flydDir);
  if (!existsSync(directory)) return [];

  const names = (await readdir(directory))
    .filter((name) => name.endsWith(".json"))
    .sort()
    .slice(-MAX_SCANNED_SESSIONS);
  const records = await Promise.all(names.map(async (name) => {
    try {
      const parsed = JSON.parse(await readFile(join(directory, name), "utf8")) as ConversationRecord;
      if (parsed.version !== 1 || !parsed.id || !Array.isArray(parsed.exchanges)) return null;
      return parsed;
    } catch {
      return null;
    }
  }));

  return records
    .filter((record): record is ConversationRecord => record !== null)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export async function retrieveRecentActionableOutcome(
  options: ConversationRetrievalOptions = {},
): Promise<ActionableOutcome | null> {
  const flydDir = options.flydDir ?? FLYD_DIR;
  const now = options.now?.() ?? new Date();
  const records = (await readRecords(flydDir))
    .filter((record) => record.id !== options.excludeSessionId)
    .filter((record) => now.getTime() - new Date(record.updatedAt).getTime() <= MAX_ACTION_AGE_MS);

  for (const record of records) {
    for (let index = record.exchanges.length - 1; index >= 0; index -= 1) {
      const exchange = record.exchanges[index];
      if (exchange.handoff) return exchange.handoff;
      const input = interpretAgentInput(exchange.user);
      if (input.kind === "coding") {
        return {
          outcome: input.outcome,
          sourceSessionId: record.id,
          sourceTurn: index,
          recordedAt: exchange.recordedAt,
        };
      }
    }
  }
  return null;
}

function countKeywordMatches(record: ConversationRecord, keywords: string[]): number {
  const content = record.exchanges
    .map((exchange) => `${exchange.user}\n${exchange.assistant}`)
    .join("\n")
    .toLowerCase();
  return keywords.reduce((score, keyword) => score + (content.includes(keyword) ? 1 : 0), 0);
}

function selectedExchanges(
  record: ConversationRecord,
  keywords: string[],
  continuityQuestion: boolean,
): ConversationExchange[] {
  if (continuityQuestion) {
    const first = record.exchanges.slice(0, 3);
    const recent = record.exchanges.slice(-7);
    return [ ...new Map([ ...first, ...recent ].map((exchange) => [ exchange.recordedAt, exchange ])).values() ];
  }

  const matched = record.exchanges.filter((exchange) => {
    const content = `${exchange.user}\n${exchange.assistant}`.toLowerCase();
    return keywords.some((keyword) => content.includes(keyword));
  });
  return matched.length > 0 ? matched.slice(-6) : record.exchanges.slice(-4);
}

function evidenceMatch(
  record: ConversationRecord,
  keywords: string[],
  continuityQuestion: boolean,
  now: Date,
): MemoryMatchSummary {
  const exchanges = selectedExchanges(record, keywords, continuityQuestion);
  const transcript = exchanges.map((exchange) =>
    `George: ${cleanInline(exchange.user, 1_000)}\nFlyd: ${cleanInline(exchange.assistant, 1_000)}`
  ).join("\n\n");
  const excerpt = [
    `Previous Flyd conversation: ${record.title}`,
    `Started ${record.startedAt}; last updated ${record.updatedAt}.`,
    transcript,
  ].join("\n").slice(0, MAX_EXCERPT_CHARS);
  const age = now.getTime() - new Date(record.updatedAt).getTime();

  return {
    id: `conversation:${record.id}`,
    path: `conversations/${record.id}`,
    excerpt,
    stale: age > 90 * 24 * 60 * 60 * 1_000,
    kind: "conversation",
    updatedAt: record.updatedAt,
  };
}

export async function retrieveRecentConversationEvidence(
  query: string,
  options: ConversationRetrievalOptions = {},
): Promise<MemoryEvidence> {
  const flydDir = options.flydDir ?? FLYD_DIR;
  const continuityQuestion = CONTINUITY_QUESTION.test(query);
  const keywords = extractMemoryKeywords(query);
  if (!continuityQuestion && keywords.length === 0) {
    return { verdict: "insufficient", matches: [] };
  }
  const records = (await readRecords(flydDir))
    .filter((record) => record.id !== options.excludeSessionId);

  const ranked = continuityQuestion
    ? records
      .filter((record) => record.exchanges.some((exchange) => !CONTINUITY_QUESTION.test(exchange.user.trim())))
      .slice(0, 1)
    : records
      .map((record) => ({ record, score: countKeywordMatches(record, keywords) }))
      .filter(({ score }) => score > 0)
      .sort((left, right) => right.score - left.score || right.record.updatedAt.localeCompare(left.record.updatedAt))
      .slice(0, MAX_MATCHES)
      .map(({ record }) => record);

  const matches = ranked.map((record) =>
    evidenceMatch(record, keywords, continuityQuestion, options.now?.() ?? new Date())
  );
  return {
    verdict: matches.length >= 2 ? "sufficient" : matches.length === 1 ? "partial" : "insufficient",
    matches,
  };
}

export function mergeAgentMemoryEvidence(
  query: string,
  evidence: MemoryEvidence[],
  maximum = 8,
): MemoryEvidence {
  let matches = evidence.flatMap((item) => item.matches);
  if (CONTINUITY_QUESTION.test(query)) {
    matches = matches
      .filter((match) => match.kind === "conversation")
      .sort((left, right) => (right.updatedAt ?? "").localeCompare(left.updatedAt ?? ""))
      .slice(0, 1);
  } else {
    const seen = new Set<string>();
    matches = matches.filter((match) => {
      const key = `${match.kind ?? "archive"}:${match.path}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, maximum);
  }

  let remainingCharacters = MAX_MERGED_EVIDENCE_CHARS;
  matches = matches.flatMap((match) => {
    if (remainingCharacters <= 0) return [];
    const excerpt = match.excerpt.slice(0, remainingCharacters);
    remainingCharacters -= excerpt.length;
    return [{ ...match, excerpt }];
  });

  return {
    verdict: matches.length >= 3 ? "sufficient" : matches.length > 0 ? "partial" : "insufficient",
    matches,
  };
}
