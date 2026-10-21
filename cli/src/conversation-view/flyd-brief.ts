import { readFileSync } from "node:fs";
import { memoryPaths } from "../council/memory-store.js";
import { describeProject, liveProjects, type Project } from "../council/projects.js";
import { tastePromptText } from "../council/taste.js";
import { readUserProfile } from "../lib/user-profile.js";
import type { Complete } from "./flyd-desk.js";
import type { ConversationMessage } from "./types.js";

// What Flyd adds when it hands George's words to firstmate. Firstmate is one
// of Flyd's staff, not a mailbox: his words go first and whole, and under them
// Flyd's own brief from what it knows of him (USER.md, MEMORY.md, the project
// he named and his taste for it): what bears on the request, what done looks
// like to him, and Flyd's call on what firstmate settles without asking him.
// The note marks the brief as Flyd's (firstmate-inbox.ts briefBlock), so it is
// never read as his wording, and it is never shown back to him as his message.

const TIMEOUT_MS = 6_000;
const MAX_BRIEF_CHARS = 1_200;
const MAX_PROFILE_CHARS = 3_000;
const MAX_MEMORY_CHARS = 4_000;
const RECENT_MESSAGES = 4;

export interface BriefSources {
  profile: string | null;
  memory: string;
  /** The project his message names, with his taste for it. */
  project?: { about: string; taste: string | null };
}

/** The project his words name, by his own name for it or its id. Pure. */
export function projectNamed(text: string, projects: Project[]): Project | undefined {
  return projects.find((project) => [project.name, project.id].some((name) => {
    const trimmed = name.trim();
    return trimmed.length >= 3 && new RegExp(`\\b${trimmed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text);
  }));
}

function read(file: string): string {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

/** What Flyd knows that may bear on his words; each source fails soft to nothing. */
export function briefSources(text: string): BriefSources {
  let profile: string | null = null;
  try {
    profile = readUserProfile();
  } catch {
    profile = null;
  }
  let project: Project | undefined;
  try {
    project = projectNamed(text, liveProjects());
  } catch {
    project = undefined;
  }
  let taste: string | null = null;
  try {
    taste = tastePromptText({ projects: project ? [project.id] : [] });
  } catch {
    taste = null;
  }
  return {
    profile,
    memory: read(memoryPaths().memory),
    ...(project ? { project: { about: describeProject(project), taste } } : {}),
  };
}

export function briefPrompt(text: string, recent: ConversationMessage[], sources: BriefSources): string {
  const said = recent
    .slice(-RECENT_MESSAGES)
    .map((message) => `${message.role === "user" ? "George" : message.aside ? "Firstmate (update)" : "Flyd"}: ${message.text.replace(/\s+/g, " ").slice(0, 300)}`)
    .join("\n");
  return [
    "You are Flyd, George's chief of staff. He has asked for software work, and you are handing it to firstmate, the engineering lead on your staff. His words go to firstmate whole; under them you add your brief, for firstmate, never for George.",
    "Write at most five short lines with what only you can add: what you know that bears on this (what he has said or decided before, where his project stands, his taste for it); what done looks like to him; and your call on how much it matters now and what firstmate settles itself without asking him (implementation choices, routine merges and follow-ups). Only what is truly his (destructive or irreversible, money, his name, a taste or strategy call) comes back to him, through you, with a recommendation.",
    "Use only what is written below; never invent a fact, a preference or a deadline. If you know nothing that adds to his words, reply exactly NONE.",
    sources.profile ? `What you know about George:\n${sources.profile.slice(0, MAX_PROFILE_CHARS)}` : "",
    sources.memory.trim() ? `Your memory:\n${sources.memory.slice(0, MAX_MEMORY_CHARS)}` : "",
    sources.project ? `The project he named:\n${sources.project.about}` : "",
    sources.project?.taste ? `His taste:\n${sources.project.taste}` : "",
    said ? `Recent conversation:\n${said}` : "",
    `George's words: ${text.trim().slice(0, 2_000)}`,
    "Reply with the brief only.",
  ].filter(Boolean).join("\n\n");
}

/**
 * Flyd's brief for one request, or undefined when it has nothing to add, the
 * model fails, or it takes too long: his words are never held up for it.
 */
export async function flydBrief(
  text: string,
  recent: ConversationMessage[],
  complete: Complete,
  options: { sources?: BriefSources; timeoutMs?: number } = {},
): Promise<string | undefined> {
  if (!text.trim()) return undefined;
  const prompt = briefPrompt(text, recent, options.sources ?? briefSources(text));
  let timer: NodeJS.Timeout | undefined;
  try {
    const said = await Promise.race([
      complete(prompt),
      new Promise<string>((resolve) => {
        timer = setTimeout(() => resolve(""), options.timeoutMs ?? TIMEOUT_MS);
      }),
    ]);
    const brief = said.trim().replace(/^```\w*\n?|\n?```$/g, "").trim();
    if (!brief || /^none[.!]?$/i.test(brief)) return undefined;
    return brief.length > MAX_BRIEF_CHARS ? `${brief.slice(0, MAX_BRIEF_CHARS - 1).trimEnd()}…` : brief;
  } catch {
    return undefined;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
