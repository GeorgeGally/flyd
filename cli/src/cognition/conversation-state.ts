import type { ConversationState } from "./types.js";

export interface ConversationLikeTurn { role: "user" | "assistant"; content: string }

const ENTITY = /\b(Flyd|Bloom|GNM\d*|Good Neighbours(?: Market)?|HFTW|Home for the Woods)\b/gi;

export function compileConversationState(turns: ConversationLikeTurn[], currentMessage = ""): ConversationState {
  const recent = [...turns, ...(currentMessage ? [{ role: "user" as const, content: currentMessage }] : [])].slice(-10);
  const entities = [...new Set(recent.flatMap((t) => [...t.content.matchAll(ENTITY)].map((m) => m[0])))];
  const userTurns = recent.filter((t) => t.role === "user");
  const lastUser = userTurns.at(-1)?.content ?? currentMessage;
  const previousUser = userTurns.at(-2)?.content ?? "";
  const referents: Record<string,string> = {};
  if (/\b(the backend|backend)\b/i.test(lastUser)) referents["the backend"] = entities.includes("Flyd") ? "project:flyd/backend" : "backend";
  if (/\b(it|this|that|do that|do it)\b/i.test(lastUser) && previousUser) referents["it"] = previousUser.slice(0, 240);
  const decisions = userTurns.filter((t) => /\b(ok|yes|do it|go with|decided|we'll|we will)\b/i.test(t.content)).slice(-4).map((t) => t.content);
  const unresolved = userTurns.filter((t) => /\?$/.test(t.content.trim())).slice(-4).map((t) => t.content);
  const recap = recent.map((t) => `${t.role === "user" ? "User" : "Flyd"}: ${t.content}`).join("\n").slice(-5000);
  return {
    topic: entities.at(-1),
    goal: lastUser || undefined,
    entities,
    referents,
    decisions,
    unresolved,
    artifacts: [],
    recap,
  };
}
