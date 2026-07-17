export type BrainIntegration = "automatic" | "targeted" | "maintenance" | "interactive" | "runtime";

export interface BrainCapability {
  id: string;
  integration: BrainIntegration;
  description: string;
  mutatesArchive: boolean;
}

export const BRAIN_CAPABILITIES = ([
  { id: "capture", integration: "automatic", description: "Persist new observations and outcomes in the shared raw archive.", mutatesArchive: true },
  { id: "dashboard", integration: "automatic", description: "Summarize archive health, coverage, and pending memory work.", mutatesArchive: false },
  { id: "ask", integration: "targeted", description: "Retrieve and synthesize personal evidence for a question.", mutatesArchive: false },
  { id: "search", integration: "targeted", description: "Retrieve matching raw and curated evidence without synthesis.", mutatesArchive: false },
  { id: "librarian", integration: "targeted", description: "Evaluate evidence quality, freshness, corroboration, and sufficiency.", mutatesArchive: false },
  { id: "graph", integration: "targeted", description: "Traverse related knowledge and inspect graph coverage.", mutatesArchive: false },
  { id: "work", integration: "targeted", description: "Retrieve active plans and their implementation checkpoints.", mutatesArchive: false },
  { id: "research", integration: "targeted", description: "Research a question and preserve the grounded result as evidence.", mutatesArchive: true },
  { id: "plan", integration: "targeted", description: "Create a durable plan using retrieved personal context.", mutatesArchive: true },
  { id: "compound", integration: "targeted", description: "Turn repeated work into a reusable structured learning.", mutatesArchive: true },
  { id: "correct", integration: "targeted", description: "Supersede incorrect knowledge while preserving correction provenance.", mutatesArchive: true },
  { id: "goal", integration: "interactive", description: "Create, inspect, and update durable user-confirmed goals.", mutatesArchive: true },
  { id: "review", integration: "interactive", description: "Run spaced review against durable knowledge and record recall outcomes.", mutatesArchive: true },
  { id: "quiz", integration: "interactive", description: "Test active recall using the shared review store.", mutatesArchive: true },
  { id: "accept", integration: "interactive", description: "Accept a pending memory-maintenance suggestion.", mutatesArchive: true },
  { id: "dismiss", integration: "interactive", description: "Dismiss a pending memory-maintenance suggestion.", mutatesArchive: true },
  { id: "suggestions", integration: "automatic", description: "Expose pending maintenance suggestions to Flyd as evidence.", mutatesArchive: false },
  { id: "attention", integration: "automatic", description: "Detect changing, unresolved, surprising, and important topics.", mutatesArchive: true },
  { id: "tension", integration: "automatic", description: "Compare active goals with progress, blockers, and deadline pressure.", mutatesArchive: true },
  { id: "curiosity", integration: "automatic", description: "Generate grounded questions where evidence is incomplete or contradictory.", mutatesArchive: true },
  { id: "interests", integration: "automatic", description: "Maintain the user's evolving interest and taste profile.", mutatesArchive: true },
  { id: "check", integration: "automatic", description: "Measure archive freshness, pollution, gaps, and thin coverage.", mutatesArchive: false },
  { id: "compile-context", integration: "maintenance", description: "Compile durable knowledge into bounded context bundles.", mutatesArchive: true },
  { id: "dedup", integration: "maintenance", description: "Detect and reconcile duplicate knowledge without silent loss.", mutatesArchive: true },
  { id: "consolidate", integration: "maintenance", description: "Run the archive health, synthesis, interest, graph, and contradiction loop.", mutatesArchive: true },
  { id: "distill", integration: "maintenance", description: "Distill project captures into structured durable memory.", mutatesArchive: true },
  { id: "optimize-skill", integration: "maintenance", description: "Improve reusable agent skills from observed execution history.", mutatesArchive: true },
  { id: "wiki", integration: "maintenance", description: "Initialize and maintain the curated local knowledge store.", mutatesArchive: true },
  { id: "ingest", integration: "maintenance", description: "Promote raw captures into governed curated knowledge.", mutatesArchive: true },
  { id: "daemon", integration: "runtime", description: "Continuously process new captures and refresh derived memory.", mutatesArchive: true },
] satisfies BrainCapability[]).sort((a, b) => a.id.localeCompare(b.id));

export function brainCapability(id: string): BrainCapability | undefined {
  return BRAIN_CAPABILITIES.find((capability) => capability.id === id);
}
