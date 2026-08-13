import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { FLYD_DIR } from "../lib/config.js";

export interface SpeakingPreference {
  style: "asd-ste100" | "default";
  updatedAt: string;
  source: string;
}

const PREFS_PATH = join(FLYD_DIR, "preferences", "speaking.json");

export function speakingPrefsPath(): string {
  return PREFS_PATH;
}

export function readSpeakingPreference(): SpeakingPreference | null {
  try {
    if (!existsSync(PREFS_PATH)) return null;
    return JSON.parse(readFileSync(PREFS_PATH, "utf8")) as SpeakingPreference;
  } catch {
    return null;
  }
}

export function writeSpeakingPreference(style: SpeakingPreference["style"], source: string): SpeakingPreference {
  const record: SpeakingPreference = {
    style,
    updatedAt: new Date().toISOString(),
    source,
  };
  mkdirSync(dirname(PREFS_PATH), { recursive: true });
  writeFileSync(PREFS_PATH, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  return record;
}

const STE100_SAVE =
  /\b(?:always\s+)?use\s+asd[- ]?ste100\b|\bsimplified technical english\b|\bsave in memory to always use asd/i;

export function handleSpeakingPreferenceUtterance(message: string): string | null {
  if (!STE100_SAVE.test(message)) return null;
  writeSpeakingPreference("asd-ste100", message.trim().slice(0, 240));
  return [
    "Saved. I will speak to you in ASD-STE100 Simplified Technical English.",
    "I will use short sentences, common words, and one clear action at a time.",
  ].join(" ");
}

export function speakingStyleSystemRule(): string {
  const pref = readSpeakingPreference();
  if (pref?.style !== "asd-ste100") return "";
  return [
    "Speaking style (user-confirmed): ASD-STE100 Simplified Technical English.",
    "Use short direct sentences, common words, and one clear action.",
    "Do not explain internal mistakes unless George asks for a fix prompt.",
    "Do not dump dashboards. Name the next action.",
  ].join(" ");
}
