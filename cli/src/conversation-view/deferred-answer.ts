import { createHash, randomBytes } from "node:crypto";
import { existsSync, linkSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface DeferredAnswer {
  runId: string;
  sessionId: string;
  turnId: string;
  text: string;
  at: string;
}

export function deferredAnswersDir(): string {
  return join(homedir(), ".flyd", "view", "deferred-answers");
}

/** The record is both the delivery and its marker. Linking it is atomic and never replaces an earlier delivery. */
export function deliverDeferredAnswer(answer: DeferredAnswer, dir = deferredAnswersDir()): boolean {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const key = createHash("sha256").update(answer.runId).digest("hex");
  const path = join(dir, `${key}.json`);
  const temporary = join(dir, `.${key}.${randomBytes(8).toString("hex")}.tmp`);
  writeFileSync(temporary, JSON.stringify(answer), { mode: 0o600, flag: "wx" });
  try {
    linkSync(temporary, path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw error;
  } finally {
    unlinkSync(temporary);
  }
}

export function readDeferredAnswers(dir = deferredAnswersDir()): DeferredAnswer[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((name) => name.endsWith(".json")).flatMap((name) => {
    try {
      const value: unknown = JSON.parse(readFileSync(join(dir, name), "utf8"));
      if (!value || typeof value !== "object") return [];
      if (!("runId" in value) || typeof value.runId !== "string" || !("sessionId" in value) || typeof value.sessionId !== "string" || !("turnId" in value) || typeof value.turnId !== "string" || !("text" in value) || typeof value.text !== "string" || !("at" in value) || typeof value.at !== "string") return [];
      return [{ runId: value.runId, sessionId: value.sessionId, turnId: value.turnId, text: value.text, at: value.at }];
    } catch { return []; }
  });
}
