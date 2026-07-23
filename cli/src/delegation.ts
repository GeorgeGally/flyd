export interface DelegationEnvelope {
  intent: string;
  worldState: Record<string, unknown>;
  observationRefs: string[];
  memory: {
    goals: Array<{ content: unknown }>;
    tensions: Array<{ content: unknown }>;
    profile: Array<{ content: unknown }>;
  };
  currentProject: string | null;
  availableCapabilities: string[];
  goal: string;
  grant: {
    repositories: string[];
    maxRuntimeMinutes: number;
    writeAllowed: boolean;
    networkAllowed: boolean;
  };
}

export function buildDelegationEnvelope(
  intent: string,
  worldState: Record<string, unknown>,
  observationRefs: string[],
  project: string | null
): DelegationEnvelope {
  const goals =
    (worldState.goals as Array<{ content: unknown }>)?.slice(0, 3) || [];
  const tensions =
    (worldState.tensions as Array<{ content: unknown }>)?.slice(0, 2) || [];
  const profile =
    (worldState.profile as Array<{ content: unknown }>)?.slice(0, 2) || [];

  return {
    intent,
    worldState,
    observationRefs,
    memory: { goals, tensions, profile },
    currentProject: project,
    availableCapabilities: [
      "code_generation",
      "code_review",
      "debugging",
      "research",
      "verification",
      "integration",
    ],
    goal: `Resolve intent: "${intent.slice(0, 100)}"`,
    grant: {
      repositories: [],
      maxRuntimeMinutes: 10,
      writeAllowed: false,
      networkAllowed: true,
    },
  };
}

export function isDelegationIntent(intent: string): boolean {
  const delegationPatterns = [
    /diagnose\s+(this|the)\s+(crash|error|bug|issue|problem)/i,
    /fix\s+(this|the)\s+(bug|error|issue|crash)/i,
    /review\s+(this|the|my)\s+(code|pr|pull\s+request|diff)/i,
    /implement\s+/i,
    /build\s+(a|an)\s+/i,
    /refactor\s+/i,
    /write\s+(a|an|the)\s+(test|script|function|class|module)/i,
    /investigate\s+/i,
    /research\s+/i,
    /optimize\s+/i,
    /deploy\s+/i,
  ];

  return delegationPatterns.some((p) => p.test(intent));
}
