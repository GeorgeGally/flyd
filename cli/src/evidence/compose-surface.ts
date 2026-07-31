import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import type {
  EvidenceBundle,
  EvidenceComposeSurface,
  EvidenceSurfaceFinding,
  EvidenceSurfaceSynthesis,
} from "./types.js";

const SURFACE_HOST = "127.0.0.1";
const SURFACE_PORT = 3000;
const SURFACE_TTL_MS = 30 * 60 * 1000;
const surfaces = new Map<string, { surface: EvidenceComposeSurface; expiresAt: number }>();
const surfaceAliases = new Map<string, string>();
const readySurfaceIds: string[] = [];
let latestSurfaceId: string | null = null;
let surfaceServer: Server | null = null;
let startPromise: Promise<boolean> | null = null;

export type EvidenceSurfaceRoute =
  | { kind: "handoff" }
  | { kind: "surface"; surfaceId: string };

function normalizeSurfaceAlias(value: string): string | null {
  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 && /^[a-f0-9-]+$/.test(normalized) ? normalized : null;
}

export function parseEvidenceSurfaceRoute(rawUrl: string | undefined): EvidenceSurfaceRoute | null {
  try {
    const url = new URL(rawUrl || "/", `http://${SURFACE_HOST}:${SURFACE_PORT}`);
    if (url.pathname === "/surface" || url.pathname === "/surface/") return { kind: "handoff" };
    const match = url.pathname.match(/^\/surface\/([a-f0-9-]+)$/i);
    const surfaceId = match?.[1] ? normalizeSurfaceAlias(match[1]) : null;
    return surfaceId ? { kind: "surface", surfaceId } : null;
  } catch {
    return null;
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function safeLink(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function trim(value: string, limit: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length <= limit ? normalized : `${normalized.slice(0, limit - 1)}…`;
}

function parseModelJson(raw: string): Record<string, unknown> | null {
  try {
    const match = raw.match(/\{[\s\S]*\}/);
    return JSON.parse(match?.[0] || raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function resolutionAlias(raw: string): string | null {
  const parsed = parseModelJson(raw);
  const candidate = parsed?.resolution_id ?? parsed?.resolutionId;
  return typeof candidate === "string" ? normalizeSurfaceAlias(candidate) : null;
}

function stringArray(value: unknown, limit: number): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0).slice(0, limit)
    : [];
}

function parseSynthesis(raw: string): EvidenceSurfaceSynthesis | undefined {
  const parsed = parseModelJson(raw);
  const candidate = parsed?.surfaceSynthesis;
  if (!candidate || typeof candidate !== "object") return undefined;
  const entry = candidate as Record<string, unknown>;
  const title = typeof entry.title === "string" ? entry.title.trim() : "";
  const executiveSummary = typeof entry.executiveSummary === "string" ? entry.executiveSummary.trim() : "";
  if (!title || !executiveSummary) return undefined;

  const findings: EvidenceSurfaceFinding[] = Array.isArray(entry.findings)
    ? entry.findings.flatMap((finding) => {
        if (!finding || typeof finding !== "object") return [];
        const value = finding as Record<string, unknown>;
        const heading = typeof value.heading === "string" ? value.heading.trim() : "";
        const summary = typeof value.summary === "string" ? value.summary.trim() : "";
        if (!heading || !summary) return [];
        const rawConfidence = value.confidence;
        const confidence: EvidenceSurfaceFinding["confidence"] =
          rawConfidence === "high" || rawConfidence === "low" ? rawConfidence : "medium";
        return [{
          heading,
          summary,
          evidenceIds: stringArray(value.evidenceIds, 10),
          confidence,
        }];
      }).slice(0, 10)
    : [];

  return {
    title,
    executiveSummary,
    findings,
    recommendation: typeof entry.recommendation === "string" ? entry.recommendation.trim() : undefined,
    uncertainties: stringArray(entry.uncertainties, 8),
  };
}

function evidenceCard(surface: EvidenceComposeSurface, evidenceId: string): string {
  const item = surface.evidence.find((candidate) => candidate.id === evidenceId);
  if (!item) return "";
  const link = safeLink(item.locator);
  const source = item.capabilities.join(" + ");
  return `<article class="source-card">
    <div class="source-meta"><span>${escapeHtml(source)}</span><span>${escapeHtml(item.publishedAt || item.retrievedAt)}</span></div>
    <h4>${escapeHtml(item.title || item.author || "Source")}</h4>
    <p>${escapeHtml(trim(item.content, 420))}</p>
    ${link ? `<a href="${escapeHtml(link)}" target="_blank" rel="noopener noreferrer">Open source ↗</a>` : ""}
  </article>`;
}

export function renderEvidenceSurfaceHtml(surface: EvidenceComposeSurface): string {
  const synthesis = surface.synthesis;
  const title = synthesis?.title || `Research dossier: ${surface.query}`;
  const summary = synthesis?.executiveSummary || "Flyd gathered and organised the available evidence. Synthesis is still being finalised.";
  const findingSections = synthesis?.findings.length
    ? synthesis.findings.map((finding, index) => `<section class="poster finding">
        <div class="eyebrow">Finding ${String(index + 1).padStart(2, "0")} · ${escapeHtml(finding.confidence)} confidence</div>
        <h2>${escapeHtml(finding.heading)}</h2>
        <p class="lead">${escapeHtml(finding.summary)}</p>
        <div class="source-grid">${finding.evidenceIds.map((id) => evidenceCard(surface, id)).join("")}</div>
      </section>`).join("")
    : surface.clusters.slice(0, 8).map((cluster, index) => `<section class="poster finding">
        <div class="eyebrow">Evidence cluster ${String(index + 1).padStart(2, "0")} · ${cluster.sourceDiversity} source types</div>
        <h2>${escapeHtml(cluster.label)}</h2>
        <p class="lead">${escapeHtml(cluster.summary)}</p>
        <div class="source-grid">${cluster.evidenceIds.slice(0, 6).map((id) => evidenceCard(surface, id)).join("")}</div>
      </section>`).join("");

  const conflicts = surface.conflicts.length > 0
    ? `<section class="poster warning"><div class="eyebrow">Disagreement</div><h2>Claims that do not reconcile</h2>${surface.conflicts.map((conflict) =>
        `<p><strong>${escapeHtml(conflict.topic)}</strong> — ${escapeHtml(conflict.reason)} <span class="confidence">${Math.round(conflict.confidence * 100)}%</span></p>`
      ).join("")}</section>`
    : "";

  const recommendation = synthesis?.recommendation
    ? `<section class="poster recommendation"><div class="eyebrow">Flyd's judgement</div><h2>Recommended direction</h2><p class="lead">${escapeHtml(synthesis.recommendation)}</p></section>`
    : "";

  const uncertainties = synthesis?.uncertainties.length
    ? `<section class="poster"><div class="eyebrow">Unresolved</div><h2>What remains uncertain</h2><ul>${synthesis.uncertainties.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></section>`
    : "";

  const gaps = surface.gaps.length
    ? `<section class="poster muted"><div class="eyebrow">Coverage gaps</div><h2>Sources Flyd could not reach</h2><ul>${surface.gaps.slice(0, 12).map((gap) => `<li>${escapeHtml(gap.message)}</li>`).join("")}</ul></section>`
    : "";

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'">
  <title>${escapeHtml(title)} · Flyd</title><style>
  :root{color-scheme:dark;--paper:#11110f;--ink:#f3f0e8;--quiet:#aaa79f;--line:#35342f;--acid:#d8ff52;--warm:#ff8b62}*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:16px/1.45 ui-sans-serif,-apple-system,BlinkMacSystemFont,"Helvetica Neue",sans-serif}main{width:min(1440px,100%);margin:auto;padding:28px;display:grid;grid-template-columns:repeat(12,1fr);gap:18px}.hero{grid-column:1/-1;min-height:58vh;display:flex;flex-direction:column;justify-content:flex-end;border:1px solid var(--line);padding:clamp(26px,6vw,86px);background:radial-gradient(circle at 80% 15%,#304015 0,transparent 34%),linear-gradient(145deg,#181914,#0c0c0b)}.mark{font-size:12px;letter-spacing:.18em;text-transform:uppercase;color:var(--acid)}h1{font-size:clamp(48px,8vw,122px);line-height:.88;letter-spacing:-.065em;margin:.18em 0;max-width:12ch}h2{font-size:clamp(30px,4vw,62px);line-height:.95;letter-spacing:-.045em;margin:.2em 0 .5em}h4{font-size:18px;margin:.5em 0}.hero p{max-width:68ch;font-size:clamp(18px,2vw,27px);color:#d7d3c9}.poster{grid-column:span 6;border:1px solid var(--line);padding:34px;min-height:320px;background:#171715}.poster:nth-child(3n){grid-column:span 7}.poster:nth-child(3n+1){grid-column:span 5}.eyebrow,.source-meta{text-transform:uppercase;letter-spacing:.12em;font-size:11px;color:var(--acid)}.lead{font-size:20px;color:#d7d3c9}.source-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:10px;margin-top:26px}.source-card{border-top:1px solid var(--line);padding:16px 0}.source-meta{display:flex;justify-content:space-between;gap:12px;color:var(--quiet)}.source-card p,li{color:#c5c1b8}.source-card a{color:var(--acid);text-decoration:none}.warning{background:#2a1713}.warning .eyebrow{color:var(--warm)}.recommendation{background:var(--acid);color:#111}.recommendation .eyebrow,.recommendation .lead{color:#111}.muted{background:#10100f;color:var(--quiet)}.confidence{color:var(--warm);font-size:12px}footer{grid-column:1/-1;padding:20px 0;color:var(--quiet);font-size:12px}@media(max-width:760px){main{padding:12px}.poster,.poster:nth-child(n){grid-column:1/-1;padding:24px}.hero{padding:28px;min-height:70vh}}
  </style></head><body><main><header class="hero"><div class="mark">FLYD / EVIDENCE DOSSIER / ${escapeHtml(surface.generatedAt)}</div><h1>${escapeHtml(title)}</h1><p>${escapeHtml(summary)}</p></header>${findingSections}${conflicts}${recommendation}${uncertainties}${gaps}<footer>${surface.evidence.length} evidence items · ${surface.clusters.length} clusters · provenance retained · generated locally by Flyd Core</footer></main></body></html>`;
}

function removeReadySurface(surfaceId: string): void {
  const index = readySurfaceIds.indexOf(surfaceId);
  if (index >= 0) readySurfaceIds.splice(index, 1);
}

function cleanup(): void {
  const now = Date.now();
  for (const [id, entry] of surfaces) if (entry.expiresAt <= now) surfaces.delete(id);
  for (const [alias, surfaceId] of surfaceAliases) if (!surfaces.has(surfaceId)) surfaceAliases.delete(alias);
  for (let index = readySurfaceIds.length - 1; index >= 0; index -= 1) {
    if (!surfaces.has(readySurfaceIds[index])) readySurfaceIds.splice(index, 1);
  }
  if (latestSurfaceId && !surfaces.has(latestSurfaceId)) latestSurfaceId = null;
}

export function evidenceSurfaceIdForResolution(resolutionId: string): string | undefined {
  cleanup();
  const alias = normalizeSurfaceAlias(resolutionId);
  return alias ? surfaceAliases.get(alias) : undefined;
}

async function ensureSurfaceServer(): Promise<boolean> {
  if (surfaceServer) return true;
  if (startPromise) return startPromise;
  const pending = new Promise<boolean>((resolve) => {
    const server = createServer((req, res) => {
      cleanup();
      const route = parseEvidenceSurfaceRoute(req.url);
      if (!route) {
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
        res.end("Not found.");
        return;
      }
      if (req.method !== "GET" && req.method !== "HEAD") {
        res.writeHead(405, { Allow: "GET, HEAD", "Cache-Control": "no-store" });
        res.end();
        return;
      }
      const requestedId = route.kind === "surface" ? route.surfaceId : undefined;

      // Core's liveness check uses HEAD. Confirm the renderer without consuming
      // a finalised surface from the handoff queue.
      if (!requestedId && req.method === "HEAD") {
        res.writeHead(surfaces.size > 0 ? 200 : 404, { "Cache-Control": "no-store" });
        res.end();
        return;
      }

      if (!requestedId) {
        const nextId = readySurfaceIds.shift() || latestSurfaceId;
        if (!nextId || !surfaces.has(nextId)) {
          res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
          res.end("Flyd evidence surface not found or expired.");
          return;
        }
        latestSurfaceId = nextId;
        res.writeHead(302, {
          Location: `/surface/${nextId}`,
          "Cache-Control": "no-store",
          "Referrer-Policy": "no-referrer",
        });
        res.end();
        return;
      }

      const canonicalId = surfaces.has(requestedId) ? requestedId : surfaceAliases.get(requestedId);
      const entry = canonicalId ? surfaces.get(canonicalId) : undefined;
      if (!entry) {
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
        res.end("Flyd evidence surface not found or expired.");
        return;
      }
      removeReadySurface(canonicalId);
      const html = renderEvidenceSurfaceHtml(entry.surface);
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
      });
      res.end(req.method === "HEAD" ? undefined : html);
    });
    server.once("error", () => {
      startPromise = null;
      resolve(false);
    });
    server.listen(SURFACE_PORT, SURFACE_HOST, () => {
      surfaceServer = server;
      surfaceServer.unref();
      startPromise = null;
      resolve(true);
    });
  });
  startPromise = pending;
  return pending;
}

export async function publishEvidenceSurface(bundle: EvidenceBundle): Promise<{ ready: boolean; surfaceId?: string }> {
  const ready = await ensureSurfaceServer();
  if (!ready) return { ready: false };
  const id = randomUUID();
  const surface: EvidenceComposeSurface = {
    kind: "evidence_dossier",
    version: "1.0",
    id,
    query: bundle.query,
    generatedAt: bundle.generatedAt,
    clusters: bundle.clusters ?? [],
    conflicts: bundle.conflicts,
    evidence: bundle.evidence,
    gaps: bundle.gaps,
  };
  surfaces.set(id, { surface, expiresAt: Date.now() + SURFACE_TTL_MS });
  return { ready: true, surfaceId: id };
}

export function finalizeEvidenceSurface(surfaceId: string | undefined, rawModelResponse: string): void {
  if (!surfaceId) return;
  const entry = surfaces.get(surfaceId);
  if (!entry) return;
  latestSurfaceId = surfaceId;
  if (!readySurfaceIds.includes(surfaceId)) readySurfaceIds.push(surfaceId);
  const alias = resolutionAlias(rawModelResponse);
  if (alias) surfaceAliases.set(alias, surfaceId);
  const synthesis = parseSynthesis(rawModelResponse);
  if (synthesis) entry.surface.synthesis = synthesis;
  entry.expiresAt = Date.now() + SURFACE_TTL_MS;
}
