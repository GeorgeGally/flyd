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
