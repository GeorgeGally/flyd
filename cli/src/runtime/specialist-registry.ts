export interface SpecialistContext {
  presentHypothesis?: string | null;
  situation?: {
    project?: string;
    projectRoot?: string;
  } | null;
  message: string;
}

export interface Specialist {
  name: string;
  domain: string;
  /** Message patterns that bring this specialist into a turn. */
  addresses?: RegExp[];
  /** One-line description of when to hand off (for prompts/debugging). */
  description?: string;
  dispatch(input: SpecialistContext): Promise<string | null>;
}

const registry = new Map<string, Specialist>();

export function registerSpecialist(specialist: Specialist): void {
  registry.set(specialist.name, specialist);
}

export function lookupSpecialist(name: string): Specialist | null {
  return registry.get(name) ?? null;
}

export function listSpecialistNames(): string[] {
  return [...registry.keys()];
}

// Wire the coach specialist so the PA can hand off to it. Dispatch is lazy —
// the model call happens only when a coach-addressed message is received.
// No circular dependency: coach-specialist imports the registry type only.
//
// Address patterns live with the registration, not the conversation loop:
// the same address grammar as before ("coach," / "hey coach" / imperatives
// / "life coach"), minus ordinary sentences that merely contain "coach".
import { coachSpecialist } from "./coach-specialist.js";
registerSpecialist({
  ...coachSpecialist(),
  description: "Grounded coaching on goals, patterns, check-ins and retrospectives",
  addresses: [
    /(?:^|\s)(?:hey|yo|ok|okay|bring in|bring|talk to|ask|use|get|call)(?:\s+the)?\s+coach\b|\bcoach\s*[,:!?]|\blife coach\b/i,
  ],
});

