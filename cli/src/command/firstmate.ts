import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { parseDomainResult } from "./result.js";
import { listDomainRuns, saveDomainRun } from "./store.js";
import type { DomainMessage, DomainRequest, DomainRun } from "./types.js";

const execFileAsync = promisify(execFile);

export const DEFAULT_FIRSTMATE_HOME = join(homedir(), "Documents", "firstmate");

export interface FirstmateExecResult {
  stdout: string;
  stderr: string;
}

export type FirstmateExec = (script: string, args: string[], options: {
  env: NodeJS.ProcessEnv;
  input?: string;
  timeout: number;
}) => Promise<FirstmateExecResult>;

async function defaultExec(script: string, args: string[], options: {
  env: NodeJS.ProcessEnv;
  input?: string;
  timeout: number;
}): Promise<FirstmateExecResult> {
  if (options.input === undefined) {
    const result = await execFileAsync(script, args, {
      env: options.env,
      timeout: options.timeout,
      maxBuffer: 4 * 1024 * 1024,
      encoding: "utf8",
    });
    return { stdout: String(result.stdout), stderr: String(result.stderr) };
  }
  return new Promise((resolve, reject) => {
    const child = execFile(script, args, {
      env: options.env,
      timeout: options.timeout,
      maxBuffer: 4 * 1024 * 1024,
      encoding: "utf8",
    }, (error, stdout, stderr) => {
      if (error) {
        const enriched = new Error(stderr.trim() || error.message) as Error & { stdout?: string };
        enriched.stdout = stdout;
        reject(enriched);
        return;
      }
      resolve({ stdout: String(stdout), stderr: String(stderr) });
    });
    child.stdin?.end(options.input);
  });
}

export interface FirstmateReadiness {
  available: boolean;
  canReceive: boolean | "unknown";
  reason?: string;
}

export class FirstmateDomainTransport {
  readonly home: string;
  readonly script: string;

  constructor(options: { home?: string; script?: string; exec?: FirstmateExec } = {}) {
    this.home = options.home ?? (process.env.FLYD_FIRSTMATE_HOME?.trim() || DEFAULT_FIRSTMATE_HOME);
    this.script = options.script ?? join(this.home, "bin", "fm-inbox.sh");
    this.exec = options.exec ?? defaultExec;
  }

  private readonly exec: FirstmateExec;

  available(): boolean {
    return existsSync(this.script) || this.exec !== defaultExec;
  }

  private env(): NodeJS.ProcessEnv {
    return { ...process.env, FM_HOME: this.home };
  }

  async ready(): Promise<FirstmateReadiness> {
    if (!this.available()) return { available: false, canReceive: false, reason: "FirstMate inbox is not installed" };
    try {
      const { stdout } = await this.exec(this.script, ["ready"], { env: this.env(), timeout: 5_000 });
      const parsed = JSON.parse(stdout) as { can_receive?: boolean | "unknown"; wake_consumer?: { reason?: string } };
      return {
        available: true,
        canReceive: parsed.can_receive === true ? true : parsed.can_receive === false ? false : "unknown",
        ...(parsed.wake_consumer?.reason ? { reason: parsed.wake_consumer.reason } : {}),
      };
    } catch (error) {
      return { available: true, canReceive: "unknown", reason: error instanceof Error ? error.message : String(error) };
    }
  }

  async submit(request: DomainRequest, owner = "FirstMate"): Promise<DomainRun> {
    if (request.domain !== "coding") throw new Error("FirstMate currently owns only the coding domain");
    const readiness = await this.ready();
    if (!readiness.available) throw new Error(readiness.reason ?? "FirstMate is unavailable");
    if (readiness.canReceive === false) throw new Error(`FirstMate cannot receive work right now${readiness.reason ? `: ${readiness.reason}` : ""}`);

    const body = firstmateRequestBody(request);
    let stdout = "";
    try {
      ({ stdout } = await this.exec(this.script, ["note", "--request-id", request.id, "--json", "-"], {
        env: this.env(),
        input: body,
        timeout: 20_000,
      }));
    } catch (error) {
      // A saved request may return a non-zero exit when only the wake failed.
      stdout = error && typeof error === "object" && "stdout" in error ? String((error as { stdout?: string }).stdout ?? "") : "";
      if (!stdout.trim()) throw error;
    }
    const receipt = JSON.parse(stdout) as {
      id?: string;
      saved?: boolean;
      acknowledged?: boolean;
      outcome?: string;
    };
    if (!receipt.id || receipt.saved !== true) throw new Error("FirstMate did not durably accept the request");

    const now = new Date().toISOString();
    const run: DomainRun = {
      id: request.id,
      request,
      owner,
      status: receipt.acknowledged ? "accepted" : "queued",
      createdAt: request.createdAt,
      updatedAt: now,
      transport: { kind: "firstmate", requestId: request.id, externalId: receipt.id },
    };
    saveDomainRun(run);
    return run;
  }

  async sendMessage(run: DomainRun, message: DomainMessage): Promise<{ externalId: string }> {
    if (!this.available()) throw new Error("FirstMate inbox is not installed");
    const body = [
      `FLYD ${message.kind.toUpperCase()} FOR ACTIVE DOMAIN RUN ${run.id}`,
      "This is George's wording. Treat it as new authority for the active coding outcome and route it to the work that needs it. Do not paraphrase away constraints.",
      "",
      message.body,
      "",
      `Original outcome: ${run.request.intendedOutcome}`,
    ].join("\n");
    let stdout = "";
    try {
      ({ stdout } = await this.exec(this.script, ["note", "--request-id", message.id, "--json", "-"], {
        env: this.env(), input: body, timeout: 20_000,
      }));
    } catch (error) {
      stdout = error && typeof error === "object" && "stdout" in error ? String((error as { stdout?: string }).stdout ?? "") : "";
      if (!stdout.trim()) throw error;
    }
    const receipt = JSON.parse(stdout) as { id?: string; saved?: boolean };
    if (!receipt.id || receipt.saved !== true) throw new Error("FirstMate did not durably accept the domain message");
    return { externalId: receipt.id };
  }

  async receipts(): Promise<FirstmateReceipts> {
    const { stdout } = await this.exec(this.script, ["receipts", "--all-pending", "--all-handled", "--all-replies"], {
      env: this.env(),
      timeout: 10_000,
    });
    return JSON.parse(stdout) as FirstmateReceipts;
  }
}

interface FirstmateReply {
  id: string;
  at?: string;
  body?: string;
  cursor?: string;
}

interface FirstmateNote {
  id: string;
  request_id?: string | null;
  acknowledged?: boolean;
  reply?: FirstmateReply | null;
}

export interface FirstmateReceipts {
  pending?: FirstmateNote[];
  handled?: FirstmateNote[];
  replies?: FirstmateReply[];
  reply_cursor?: string;
}

export function firstmateRequestBody(request: DomainRequest): string {
  const project = request.project?.root
    ? `\nFlyd project hint: ${request.project?.name ? `${request.project.name} — ` : ""}${request.project.root}. Resolve the canonical FirstMate project yourself; this is context, not permission or a binding.`
    : "";
  return [
    "FLYD DOMAIN REQUEST",
    "Flyd is mediating this coding request for George. Own the coding outcome as the domain boss: route it to the right project/workers, supervise it, verify it, and escalate only real decisions.",
    "",
    "ORIGINAL REQUEST — preserve this wording as authority:",
    request.originalMessage,
    "",
    "FLYD INTERPRETATION:",
    request.intendedOutcome,
    request.parentRequestId ? `Follow-up to prior Flyd domain run: ${request.parentRequestId}` : "",
    request.contextRefs?.length ? `Context refs: ${request.contextRefs.join(", ")}` : "",
    project,
    "",
    "DONE WHEN:",
    ...request.doneWhen.map((point, index) => `${index + 1}. ${point}`),
    "",
    "RETURN CONTRACT:",
    "When this request reaches a stable outcome or needs a real decision, publish a durable reply to this inbox note using fm-inbox.sh reply.",
    "If implementation is verified but merge, publication, deployment, or another captain-authority step remains, return status=needs_decision rather than completed.",
    "Return JSON when practical with: status (completed|needs_decision|failed), brief, recommendation {action,reasoning,confidence}, detailed_report, decisions_made, unresolved_questions, risks, evidence, artifacts, specialist_outputs, information_loss_risk.",
    "The detailed_report should retain material technical detail. Do not collapse specialist findings into only a short summary. Evidence/artifact pointers should survive so Flyd can inspect or ask follow-ups.",
  ].filter(Boolean).join("\n");
}

export async function syncFirstmateDomainRuns(options: {
  transport?: FirstmateDomainTransport;
  now?: () => Date;
  onChanged?: (run: DomainRun) => Promise<void> | void;
} = {}): Promise<DomainRun[]> {
  const transport = options.transport ?? new FirstmateDomainTransport();
  if (!transport.available()) return [];
  const runs = listDomainRuns().filter((run) => run.transport.kind === "firstmate" && !["completed", "failed", "cancelled"].includes(run.status));
  if (!runs.length) return [];

  let receipts: FirstmateReceipts;
  try {
    receipts = await transport.receipts();
  } catch {
    return [];
  }
  const notes = [...(receipts.pending ?? []), ...(receipts.handled ?? [])];
  const changed: DomainRun[] = [];
  for (const run of runs) {
    const note = notes.find((item) => item.request_id === run.transport.requestId || item.id === run.transport.externalId);
    if (!note) continue;
    let next: DomainRun = run;
    if (note.acknowledged && run.status === "queued") {
      next = { ...next, status: "accepted", updatedAt: (options.now ?? (() => new Date()))().toISOString() };
    }
    if (note.reply?.body?.trim()) {
      const parsed = parseDomainResult(note.reply.body);
      next = {
        ...next,
        status: parsed.status ?? "completed",
        result: parsed.result,
        updatedAt: note.reply.at ?? (options.now ?? (() => new Date()))().toISOString(),
        transport: { ...next.transport, replyCursor: note.reply.cursor },
        ...(parsed.status === "failed" ? { failure: parsed.result.brief } : {}),
      };
    }
    if (JSON.stringify(next) === JSON.stringify(run)) continue;
    saveDomainRun(next);
    changed.push(next);
    await options.onChanged?.(next);
  }
  return changed;
}
