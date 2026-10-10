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
  { id: "code", integration: "runtime", description: "Start or resume a durable repository-aware coding task through the canonical agent runtime.", mutatesArchive: false },
  { id: "task", integration: "runtime", description: "Inspect and advance canonical coding task, grant, worker, correction, and outcome state.", mutatesArchive: false },
  { id: "crew", integration: "runtime", description: "Dispatch, supervise, verify, and land OpenCode crewmates working in isolated worktrees.", mutatesArchive: false },
  { id: "skills", integration: "runtime", description: "How-to skills loaded into a chat turn when it fits; list, or import one of George's Claude/OpenCode skills.", mutatesArchive: false },
  { id: "improve", integration: "runtime", description: "Human-gated self-improvement: gather shortfall evidence, pick one fix, hand it to the crew for a verified branch.", mutatesArchive: false },
  { id: "scout", integration: "runtime", description: "Personal news: ranked editions, pre-emptive must-know alerts, and sources that evolve with feedback.", mutatesArchive: false },
  { id: "council", integration: "runtime", description: "Run and inspect the council: Librarian curation, Critic and Strategist advisories, Muse.", mutatesArchive: false },
  { id: "agenda", integration: "runtime", description: "Schedule, run, and review Flyd's proactive follow-ups and recurring briefings.", mutatesArchive: false },
  { id: "taste", integration: "targeted", description: "George's learned taste (TASTE.md): show it, print the rules for an agent before design or code work on a project, learn from his Claude Code sessions now, curate it now (the Librarian folds near-duplicates, promotes to Everywhere, moves one project's rules to that project, and retires generic rules to the Retired tier), or compile it into the skills every agent loads for UI and design work (`flyd taste skills`).", mutatesArchive: false },
  { id: "profile", integration: "targeted", description: "Show or edit George's own profile (USER.md), the highest-authority personal context.", mutatesArchive: false },
  { id: "ask", integration: "targeted", description: "Retrieve and synthesize personal evidence for a question.", mutatesArchive: false },
  { id: "search", integration: "targeted", description: "Retrieve matching raw and curated evidence without synthesis.", mutatesArchive: false },
  { id: "librarian", integration: "targeted", description: "Evaluate evidence quality, freshness, corroboration, and sufficiency.", mutatesArchive: false },
  { id: "graph", integration: "targeted", description: "Traverse related knowledge and inspect graph coverage.", mutatesArchive: false },
  { id: "work", integration: "targeted", description: "Retrieve active plans and their implementation checkpoints.", mutatesArchive: false },
  { id: "research", integration: "targeted", description: "Research a question and preserve the grounded result as evidence.", mutatesArchive: true },
  { id: "plan", integration: "targeted", description: "Create a durable plan using retrieved personal context.", mutatesArchive: true },
  { id: "compound", integration: "targeted", description: "Turn repeated work into a reusable structured learning.", mutatesArchive: true },
  { id: "correct", integration: "targeted", description: "Supersede incorrect knowledge while preserving correction provenance.", mutatesArchive: true },
  { id: "fix", integration: "interactive", description: "Reject the preceding Flyd response, preserve diagnostic evidence, and create a trusted correction plus regression case.", mutatesArchive: true },
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
  { id: "repos", integration: "maintenance", description: "Manage the cross-repository work index and discovery.", mutatesArchive: true },
  { id: "skillify", integration: "maintenance", description: "Review and confirm pending wiki skill proposals.", mutatesArchive: true },
  { id: "jobs", integration: "runtime", description: "Run bounded overnight work jobs with artifact-first delivery.", mutatesArchive: true },
  { id: "daemon", integration: "runtime", description: "Continuously process new captures and refresh derived memory.", mutatesArchive: true },
  { id: "tasks", integration: "interactive", description: "Manage work tasks from the cross-repository work index.", mutatesArchive: true },
  { id: "view", integration: "interactive", description: "Human-only view of a conversation (firstmate's Claude Code session first, Flyd chat later) served on loopback, with a box that messages firstmate through its inbox.", mutatesArchive: false },
  { id: "transitions", integration: "maintenance", description: "Inspect interaction transitions, judgments, and behavioural directives; export or erase governed transition sources.", mutatesArchive: false },
  { id: "learning", integration: "maintenance", description: "Control conversation learning sources and inspect, review, export or erase grounded vocabulary and work-state evidence.", mutatesArchive: true },
] satisfies BrainCapability[]).sort((a, b) => a.id.localeCompare(b.id));

export function brainCapability(id: string): BrainCapability | undefined {
  return BRAIN_CAPABILITIES.find((capability) => capability.id === id);
}
