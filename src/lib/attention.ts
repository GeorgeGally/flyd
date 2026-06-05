import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { RAW_DIR, WIKI_DIR } from "./config.js";
import { parse } from "./frontmatter.js";
import { getActiveInterests } from "./interests.js";

export interface AttentionSignal {
  topic: string;
  recency: number;
  velocity: number;
  unresolved: number;
  surprise: number;
  importance: number;
  tension: number;
  composite: number;
  details: {
    eventCount: number;
    unresolvedCount: number;
    totalCount: number;
    lastActivity: string | null;
    recentCaptures: number;
    contradictions: string[];
  };
}

const ATTENTION_WEIGHTS = {
  recency: 0.15,
  velocity: 0.20,
  unresolved: 0.20,
  surprise: 0.20,
  importance: 0.15,
  tension: 0.10,
};

function topicFromPath(path: string): string {
  const segments = path.split("/");
  if (segments.length >= 2 && !segments[0].startsWith("2")) {
    return segments[0];
  }
  return "flyd";
}

function extractTopicFromBody(body: string, metadata: Record<string, unknown>): string[] {
  const topics: string[] = [];

  const metaTopics = metadata.topics;
  if (Array.isArray(metaTopics)) {
    topics.push(...metaTopics.map(String).map((t) => t.toLowerCase().trim()));
  }

  const lower = body.slice(0, 1000).toLowerCase();
  const topicKeywords: Record<string, string> = {
    flyd: "\\bflyd\\b",
    koko: "\\bkoko\\b",
    "smart glasses": "\\bsmart.glasses\\b|\\bar.glasses\\b",
    "graffiti machine": "\\bgraffiti.machine|\\bgraf.machine\\b",
    tastemaker: "\\btastemaker\\b",
    postraction: "\\bpostraction\\b|\\bpost.traction\\b",
    bridgestone: "\\bbridgestone\\b",
    sponsorship: "\\bsponsor\\b|\\bfunding\\b|\\brevenue\\b",
    reaktiv: "\\breaktiv\\b|\\breactiv\\b",
    rbvj: "\\brbvj\\b",
    cowsite: "\\bcowsite\\b",
    "good neighbours": "\\bgood.neighbour\\b|\\bgnc\\b",
    ai: "\\bai\\b|\\bartificial.intelligence|\\bllm\\b|\\bopenai\\b|\\bclaude\\b|\\bgpt\\b",
    coding: "\\bcode|\\bprogram\\b|\\bdev\\b|\\bsoftware\\b|\\btypescript\\b|\\bnode\\b|\\bjavascript\\b",
    art: "\\bart\\b|\\bgallery\\b|\\bexhibition\\b|\\bcreative\\b|\\bdesign\\b",
  };

  for (const [topic, pattern] of Object.entries(topicKeywords)) {
    if (new RegExp(pattern, "i").test(lower)) {
      topics.push(topic);
    }
  }

  return [...new Set(topics)];
}

function daysAgo(dateStr: string): number {
  if (!dateStr) return 365;
  const d = new Date(dateStr.replace(" ", "T") + "Z");
  if (isNaN(d.getTime())) return 365;
  return Math.round((Date.now() - d.getTime()) / (1000 * 60 * 60 * 24));
}

export interface CaptureDoc {
  path: string;
  body: string;
  metadata: Record<string, unknown>;
  date: string;
  topics: string[];
  eventType: string;
  outcome: string | null;
  signal: string | null;
}

export function loadCaptureDocs(): CaptureDoc[] {
  const docs: CaptureDoc[] = [];
  if (!existsSync(RAW_DIR)) return docs;

  const stack = [RAW_DIR];
  while (stack.length) {
    const dir = stack.pop()!;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        try {
          const content = readFileSync(full, "utf8");
          const parsed = parse(content);
          const topics = extractTopicFromBody(parsed.body, parsed.metadata);
          const date = String(parsed.metadata.timestamp ?? parsed.metadata.date ?? parsed.metadata.created ?? "");

          docs.push({
            path: entry.name,
            body: parsed.body,
            metadata: parsed.metadata,
            date,
            topics,
            eventType: String(parsed.metadata.event_type ?? parsed.metadata.type ?? "observation"),
            outcome: typeof parsed.metadata.outcome === "string" ? parsed.metadata.outcome : null,
            signal: typeof parsed.metadata.signal === "string" ? parsed.metadata.signal : null,
          });
        } catch {}
      }
    }
  }

  return docs.sort((a, b) => b.date.localeCompare(a.date));
}

export function computeAttention(
  docs: CaptureDoc[],
  tensionScores: Record<string, number> = {},
): AttentionSignal[] {
  const now = Date.now();
  const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;

  const byTopic = new Map<string, CaptureDoc[]>();
  for (const doc of docs) {
    for (const topic of doc.topics) {
      if (!byTopic.has(topic)) byTopic.set(topic, []);
      byTopic.get(topic)!.push(doc);
    }
  }

  const activeInterests = getActiveInterests();

  const signals: AttentionSignal[] = [];

  for (const [topic, topicDocs] of byTopic) {
    const totalCount = topicDocs.length;
    const recentDocs = topicDocs.filter((d) => {
      if (!d.date) return false;
      const ms = new Date(d.date.replace(" ", "T") + "Z").getTime();
      return !isNaN(ms) && ms > thirtyDaysAgo;
    });
    const recentCount = recentDocs.length;

    const firstDoc = topicDocs[0];
    const daysSinceLast = firstDoc?.date ? daysAgo(firstDoc.date) : 365;

    const velocity = Math.min(1, recentCount / 10);
    const recency = Math.max(0, 1 - daysSinceLast / 180);

    const unresolvedDocs = topicDocs.filter((d) =>
      d.outcome === "pending" || d.outcome === "blocked" ||
      d.signal === "blocked" || d.signal === "delayed"
    );
    const unresolved = totalCount > 0 ? Math.min(1, unresolvedDocs.length / Math.max(1, totalCount) * 3) : 0;

    const surprise = Math.min(1, topicDocs.filter((d) =>
      d.signal === "pivoted" || d.signal === "cancelled" ||
      d.signal === "concern_raised" || d.signal === "negative_feedback"
    ).length * 0.25);

    const interestMatch = activeInterests.some((i) =>
      i.topic.toLowerCase() === topic.toLowerCase() ||
      i.keywords.some((k) => topic.includes(k) || k.includes(topic))
    );
    const importance = interestMatch ? 0.8 : 0.3;

    const tensionVal = tensionScores[topic] ?? 0;

    const composite =
      recency * ATTENTION_WEIGHTS.recency +
      velocity * ATTENTION_WEIGHTS.velocity +
      unresolved * ATTENTION_WEIGHTS.unresolved +
      surprise * ATTENTION_WEIGHTS.surprise +
      importance * ATTENTION_WEIGHTS.importance +
      tensionVal * ATTENTION_WEIGHTS.tension;

    signals.push({
      topic,
      recency: Math.round(recency * 100) / 100,
      velocity: Math.round(velocity * 100) / 100,
      unresolved: Math.round(unresolved * 100) / 100,
      surprise: Math.round(surprise * 100) / 100,
      importance: Math.round(importance * 100) / 100,
      tension: Math.round(tensionVal * 100) / 100,
      composite: Math.round(composite * 100) / 100,
      details: {
        eventCount: totalCount,
        unresolvedCount: unresolvedDocs.length,
        totalCount,
        lastActivity: firstDoc?.date || null,
        recentCaptures: recentCount,
        contradictions: topicDocs
          .filter((d) => d.signal === "pivoted" || d.signal === "cancelled" || d.signal === "concern_raised")
          .map((d) => `${d.path}: ${d.signal}`)
          .slice(0, 3),
      },
    });
  }

  return signals.sort((a, b) => b.composite - a.composite);
}

export function formatAttentionReport(signals: AttentionSignal[]): string {
  const now = new Date().toISOString().split("T")[0];
  const lines = [`# Attention Report — ${now}`, ""];

  if (!signals.length) {
    lines.push("No topics detected with attention signals.");
    return lines.join("\n");
  }

  const top = signals.slice(0, 10);
  const highAttention = top.filter((s) => s.composite >= 0.5);
  const lowAttention = top.filter((s) => s.composite < 0.5 && s.composite >= 0.2);

  lines.push("## Top 10 Active Topics");
  lines.push("");
  lines.push("| # | Topic | Attention | Signals |");
  lines.push("|---|-------|-----------|---------|");
  for (const s of top) {
    const signalTags: string[] = [];
    if (s.velocity >= 0.5) signalTags.push("velocity ↑");
    else if (s.velocity <= 0.1) signalTags.push("velocity ↓");
    if (s.unresolved >= 0.3) signalTags.push("unresolved ↑");
    if (s.surprise >= 0.2) signalTags.push("surprise ↑");
    if (s.importance >= 0.7) signalTags.push("importance ↑");
    if (s.recency <= 0.2) signalTags.push("recency ↓");
    if (s.tension >= 0.4) signalTags.push("tension ↑");

    const sigStr = signalTags.length ? signalTags.join(", ") : "—";
    lines.push(
      `| ${s.composite >= 0.5 ? "⚠" : " "} | ${s.topic} | ${(s.composite * 100).toFixed(0)}% | ${sigStr} |`,
    );
  }
  lines.push("");

  if (highAttention.length > 0) {
    lines.push("## High Attention ⚠");
    lines.push("");
    for (const s of highAttention) {
      lines.push(`### ${s.topic} (${(s.composite * 100).toFixed(0)}%)`);
      lines.push(`- ${s.details.recentCaptures} recent captures (${s.details.eventCount} total)`);
      if (s.details.unresolvedCount > 0) lines.push(`- ${s.details.unresolvedCount} unresolved events`);
      if (s.details.contradictions.length > 0) {
        lines.push("- Contradictions detected:");
        for (const c of s.details.contradictions) lines.push(`  - ${c}`);
      }
      lines.push("");
    }
  }

  if (lowAttention.length > 0) {
    lines.push("## Declining ⬇");
    lines.push("");
    for (const s of lowAttention) {
      lines.push(`- **${s.topic}** (${(s.composite * 100).toFixed(0)}%): ${s.details.recentCaptures} recent captures, last activity: ${s.details.lastActivity?.slice(0, 10) || "unknown"}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

export function generateNudges(signals: AttentionSignal[], threshold = 0.5): string[] {
  const nudges: string[] = [];

  for (const s of signals) {
    if (s.composite >= threshold) {
      const reasons: string[] = [];
      if (s.unresolved >= 0.3) reasons.push(`${s.details.unresolvedCount} unresolved events`);
      if (s.surprise >= 0.2) reasons.push("contradictions detected");
      if (s.tension >= 0.4) reasons.push("high tension");
      if (s.recency <= 0.1 && s.importance >= 0.7) reasons.push("important but stale");

      if (reasons.length > 0) {
        nudges.push(`- **[${s.topic}]** ${reasons.join(", ")}`);
      }
    }
  }

  return nudges;
}

export function writeNudges(nudges: string[]): void {
  if (!existsSync(WIKI_DIR)) return;
  const nudgePath = join(WIKI_DIR, "nudges.md");

  if (!nudges.length) return;

  const today = new Date().toISOString().split("T")[0];
  let content = "";
  if (existsSync(nudgePath)) {
    content = readFileSync(nudgePath, "utf8");
  }

  const header = `## ${today}`;
  if (content.includes(header)) return;

  content += `\n${header}\n\n${nudges.join("\n")}\n`;
  mkdirSync(WIKI_DIR, { recursive: true });
  writeFileSync(nudgePath, content, "utf8");
}
