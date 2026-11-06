import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { evaluatePredicates, JEV_PINNED_MODEL, projectJevState } from "../cognition/system-one/jev.js";
import { familyEgress, predicateDefinition, predicateThreshold, questionFor } from "../cognition/system-one/registry.js";
import type { JudgeCase, Slot } from "./project-tags.js";

const QUESTION = "message_project";

export function defaultProjectTagFile(): string {
  return join(homedir(), ".flyd", "view", "project-tags.json");
}

/**
 * Flyd's call on which project a turn that names none is about: one Jev question
 * per turn (`message_project`, benched in the System-1 replay suite), kept on
 * disk so the same history is never asked twice. Only a hash of the turn and the
 * project are kept; a failed call keeps nothing and is asked again later.
 */
export class ProjectJudge {
  private readonly version = predicateDefinition(QUESTION).evaluatorVersion;
  private readonly tags = new Map<string, string | null>();
  private dirty = false;

  constructor(private readonly options: { apiKey: string; model?: string; fetchFn?: typeof fetch; file?: string }) {
    if (!options.file) return;
    try {
      const kept = JSON.parse(readFileSync(options.file, "utf8")) as { version?: unknown; tags?: unknown };
      if (kept.version !== this.version || !kept.tags || typeof kept.tags !== "object") return;
      for (const [key, value] of Object.entries(kept.tags)) if (typeof value === "string" || value === null) this.tags.set(key, value);
    } catch { /* Nothing kept yet, or unreadable: the turns are asked again. */ }
  }

  private key(turn: string): string {
    return createHash("sha256").update(turn).digest("hex").slice(0, 24);
  }

  /** The project this turn was judged to be about, null for none of them, undefined when never asked. */
  known(turn: string): string | null | undefined {
    return this.tags.get(this.key(turn));
  }

  /** Asks once. False when the call failed: nothing was learned, so the caller may stop asking for now. */
  async request(turn: string, asked: JudgeCase): Promise<boolean> {
    const question = questionFor(QUESTION);
    const result = await evaluatePredicates(projectJevState(asked.state), [question], {
      apiKey: this.options.apiKey,
      model: this.options.model ?? JEV_PINNED_MODEL,
      timeoutMs: 4_000,
      ...(this.options.fetchFn ? { fetchFn: this.options.fetchFn } : {}),
    }, familyEgress("presentation"));
    const answer = result.answers[question.id];
    if (!result.ok || !answer) return false;
    const sure = answer.confidence >= predicateThreshold(QUESTION);
    this.tags.set(this.key(turn), sure ? asked.slots[answer.choice as Slot] ?? null : null);
    this.dirty = true;
    return true;
  }

  /** Writes what was learned since the last save. */
  save(): void {
    if (!this.dirty || !this.options.file) return;
    const temporary = `${this.options.file}.${process.pid}.tmp`;
    try {
      mkdirSync(dirname(this.options.file), { recursive: true });
      writeFileSync(temporary, JSON.stringify({ version: this.version, tags: Object.fromEntries(this.tags) }), { mode: 0o600 });
      renameSync(temporary, this.options.file);
      this.dirty = false;
    } catch (error) {
      console.warn(`[view] could not keep project tags: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

/** The judge when TypeSafe is configured; off with FLYD_PROJECT_JUDGE=0. Without it, threads go by names and the talk around them. */
export function projectJudgeFromEnv(): ProjectJudge | undefined {
  const apiKey = process.env.TYPESAFE_API_KEY;
  if (!apiKey || process.env.FLYD_PROJECT_JUDGE === "0") return undefined;
  return new ProjectJudge({ apiKey, file: defaultProjectTagFile(), ...(process.env.FLYD_JEV_MODEL ? { model: process.env.FLYD_JEV_MODEL } : {}) });
}
