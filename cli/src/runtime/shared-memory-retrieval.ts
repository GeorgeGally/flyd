import { createHash } from "crypto";
import {
  CONTINUITY_QUESTION,
  extractMemoryKeywords,
} from "./conversation-memory.js";
import type { MemoryEvidence, MemoryMatchSummary } from "./types.js";

interface SharedMemoryRow {
  memory_type: string;
  memory_id: string;
  scope: string | null;
  content: string;
  confidence: number | string | null;
  updated_at: Date | string;
}

interface SharedMemoryRetrievalDependencies {
  query(sql: string): Promise<{ rows: SharedMemoryRow[] }>;
  now(): Date;
}

const MEMORY_OVERVIEW_QUESTION =
  /\b(?:what do you (?:know|remember) about me|what do you have (?:on|about) me|my memories|remember me)\b/i;
const MAX_MATCHES = 5;

const SHARED_MEMORY_QUERY = `
WITH recent_messages AS (
  SELECT
    messages.*,
    row_number() OVER (
      PARTITION BY messages.conversation_id
      ORDER BY messages.created_at DESC
    ) AS recency_rank
  FROM messages
  WHERE COALESCE((messages.metadata->>'context_superseded')::boolean, false) = false
),
conversation_memory AS (
  SELECT
    'conversation'::text AS memory_type,
    conversations.id::text AS memory_id,
    COALESCE(projects.name, contexts.name, 'Personal') AS scope,
    string_agg(
      CASE recent_messages.role
        WHEN 'user' THEN 'George: ' || left(recent_messages.content, 2000)
        WHEN 'assistant' THEN 'Flyd: ' || left(recent_messages.content, 2000)
        ELSE initcap(recent_messages.role) || ': ' || left(recent_messages.content, 2000)
      END,
      E'\\n' ORDER BY recent_messages.created_at
    ) AS content,
    1.0::float AS confidence,
    conversations.updated_at
  FROM conversations
  JOIN recent_messages
    ON recent_messages.conversation_id = conversations.id
   AND recent_messages.recency_rank <= 30
  LEFT JOIN projects ON projects.id = conversations.project_id
  LEFT JOIN contexts ON contexts.id = conversations.context_id
  GROUP BY conversations.id, projects.name, contexts.name, conversations.updated_at
  ORDER BY conversations.updated_at DESC
  LIMIT 20
),
latest_provider_snapshots AS (
  SELECT DISTINCT ON (provider)
    'provider_snapshot'::text AS memory_type,
    id::text AS memory_id,
    provider AS scope,
    left(payload::text, 20000) AS content,
    CASE status WHEN 'fresh' THEN 0.9 ELSE 0.6 END::float AS confidence,
    received_at AS updated_at
  FROM intelligence_snapshots
  WHERE status IN ('fresh', 'stale')
  ORDER BY provider, received_at DESC, created_at DESC
),
shared_memory AS (
  SELECT * FROM conversation_memory
  UNION ALL
  SELECT
    'decision'::text,
    decisions.id::text,
    projects.name,
    decisions.content,
    decisions.confidence,
    decisions.updated_at
  FROM decisions
  JOIN projects ON projects.id = decisions.project_id
  UNION ALL
  SELECT
    'belief'::text,
    beliefs.id::text,
    COALESCE(projects.name, 'Personal'),
    beliefs.statement,
    beliefs.confidence,
    beliefs.updated_at
  FROM beliefs
  LEFT JOIN projects ON projects.id = beliefs.project_id
  WHERE beliefs.status = 'active'
  UNION ALL
  SELECT
    'behaviour'::text,
    behaviours.id::text,
    COALESCE(projects.name, 'Personal'),
    concat_ws(E'\\n', behaviours.name, behaviours.trigger_phrase, behaviours.description, behaviours.steps::text),
    CASE
      WHEN COALESCE(behaviours.success_count, 0) + COALESCE(behaviours.failure_count, 0) = 0 THEN 0.5
      ELSE behaviours.success_count::float /
        (behaviours.success_count + behaviours.failure_count)
    END,
    behaviours.updated_at
  FROM behaviours
  LEFT JOIN projects ON projects.id = behaviours.project_id
  UNION ALL
  SELECT * FROM latest_provider_snapshots
)
SELECT *
FROM shared_memory
ORDER BY updated_at DESC
LIMIT 200
`;

function keywordScore(row: SharedMemoryRow, keywords: string[]): number {
  const content = `${row.scope ?? ""}\n${row.content}`.toLowerCase();
  return keywords.reduce((score, keyword) => score + (content.includes(keyword) ? 1 : 0), 0);
}

function updatedAt(row: SharedMemoryRow): Date {
  return row.updated_at instanceof Date ? row.updated_at : new Date(row.updated_at);
}

function relevantExcerpt(content: string, keywords: string[]): string {
  const normalized = content.toLowerCase();
  const positions = keywords
    .map((keyword) => normalized.indexOf(keyword))
    .filter((position) => position >= 0);
  const firstMatch = positions.length > 0 ? Math.min(...positions) : 0;
  const start = Math.max(0, firstMatch - 500);
  const prefix = start > 0 ? "..." : "";
  const suffix = start + 4_000 < content.length ? "..." : "";
  return `${prefix}${content.slice(start, start + 4_000).trim()}${suffix}`;
}

function memoryMatch(row: SharedMemoryRow, now: Date, keywords: string[]): MemoryMatchSummary {
  const updated = updatedAt(row);
  const digest = createHash("sha256")
    .update(`${row.memory_type}:${row.memory_id}:${row.content}`)
    .digest("hex")
    .slice(0, 16);
  const label = row.memory_type === "conversation"
    ? `Rails conversation in ${row.scope ?? "Personal"}`
    : `${row.memory_type.replace("_", " ")} in ${row.scope ?? "Personal"}`;

  return {
    id: `shared-memory:${digest}`,
    path: `rails/${row.memory_type}/${row.memory_id}`,
    excerpt: `${label}:\n${relevantExcerpt(row.content, keywords)}`,
    stale: now.getTime() - updated.getTime() > 90 * 24 * 60 * 60 * 1_000,
    kind: row.memory_type === "conversation" ? "conversation" : "archive",
    updatedAt: updated.toISOString(),
  };
}

export async function retrieveSharedMemoryEvidence(
  query: string,
  dependencies: SharedMemoryRetrievalDependencies,
): Promise<MemoryEvidence> {
  const continuityQuestion = CONTINUITY_QUESTION.test(query);
  const memoryOverviewQuestion = MEMORY_OVERVIEW_QUESTION.test(query);
  const personalQuestion = /\b(?:i|me|my|mine)\b/i.test(query);
  const keywords = extractMemoryKeywords(query);
  if (!continuityQuestion && !memoryOverviewQuestion && keywords.length === 0) {
    return { verdict: "insufficient", matches: [] };
  }
  const rows = (await dependencies.query(SHARED_MEMORY_QUERY)).rows;

  const selected = continuityQuestion
    ? rows
      .filter((row) => row.memory_type === "conversation")
      .sort((left, right) => updatedAt(right).getTime() - updatedAt(left).getTime())
      .slice(0, 1)
    : rows
      .filter((row) => !personalQuestion || row.memory_type !== "provider_snapshot")
      .map((row) => ({
        row,
        score: memoryOverviewQuestion
          ? (row.memory_type === "belief" ? 3 : row.memory_type === "decision" ? 2 : 1)
          : keywordScore(row, keywords),
      }))
      .filter(({ score }) => score > 0)
      .sort((left, right) =>
        right.score - left.score ||
        updatedAt(right.row).getTime() - updatedAt(left.row).getTime()
      )
      .slice(0, MAX_MATCHES)
      .map(({ row }) => row);

  const matches = selected.map((row) => memoryMatch(row, dependencies.now(), keywords));
  return {
    verdict: matches.length >= 3 ? "sufficient" : matches.length > 0 ? "partial" : "insufficient",
    matches,
  };
}
