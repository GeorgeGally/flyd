import { compileConversationState, type ConversationLikeTurn } from "./conversation-state.js";
import { interpretIntent } from "./interpret.js";
import { materializeGitDigest } from "./git-distiller.js";
import { queryMemory } from "./memory.js";
import { readPresentState } from "./present-store.js";
import { readProjection, readProjectProjection } from "./projections/store.js";
import type { CompiledContext } from "./types.js";
import type { JevOptions } from "./system-one/types.js";

export interface CompileContextInput {
  intent: string;
  conversation?: ConversationLikeTurn[];
  projectHint?: string;
  projectRoot?: string;
  environment?: { app?: string; documentPath?: string };
  capabilities?: string[];
  jev?: JevOptions;
}

export async function compileContext(input: CompileContextInput): Promise<CompiledContext> {
  const started = Date.now();
  const timings: Record<string,number> = {};
  const sources: string[] = [];
  const omissions: string[] = [];

  const tConversation = Date.now();
  const conversation = compileConversationState(input.conversation ?? [], input.intent);
  timings.conversation = Date.now()-tConversation;

  const tInterpret = Date.now();
  const interpretation = await interpretIntent(input.intent, { jev: input.jev, conversationRecap: conversation.recap });
  timings.interpret = Date.now()-tInterpret;

  if (input.projectHint && !interpretation.projectIds.includes(input.projectHint)) interpretation.projectIds.push(input.projectHint);
  for (const e of conversation.entities) {
    const id = `project:${e.toLowerCase().replace(/[^a-z0-9]+/g,"-")}`;
    if (!interpretation.projectIds.includes(id)) interpretation.projectIds.push(id);
  }

  if (input.projectRoot) {
    const tGit=Date.now();
    try { materializeGitDigest(input.projectRoot); sources.push("git"); }
    catch { omissions.push("git_distillation_failed"); }
    timings.git=Date.now()-tGit;
  }

  const tProjection = Date.now();
  const profile = readProjection("profile");
  const nowProjection = readProjection("now");
  sources.push("PROFILE","NOW");
  timings.projections=Date.now()-tProjection;

  const present = readPresentState();
  sources.push("present");

  const tMemory=Date.now();
  const memory = await queryMemory({
    text: input.intent,
    entities: interpretation.entities,
    projectIds: interpretation.projectIds,
    temporalFrame: interpretation.temporalFrame,
    includeHistorical: interpretation.temporalFrame === "past" || interpretation.needsDeepMemory,
    projectRoot: input.projectRoot,
    useJev: true,
    jev: input.jev,
  });
  timings.memory=Date.now()-tMemory;
  sources.push("world-model","memory");

  const projectProjection = interpretation.projectIds.map(readProjectProjection).filter(Boolean).join("\n\n");
  const profileCombined = [profile, projectProjection].filter(Boolean).join("\n\n").slice(0,24000);

  timings.total=Date.now()-started;
  return {
    generatedAt: new Date().toISOString(),
    interpretation,
    user: { profile: profileCombined, autonomy: [], communication: [] },
    present,
    conversation,
    memory,
    environment: {
      app: input.environment?.app,
      documentPath: input.environment?.documentPath,
      projectRoot: input.projectRoot,
      ...(input.projectRoot ? { repository: { root: input.projectRoot, dirty: present.dirtyRepos.some((r) => r.root === input.projectRoot) } } : {}),
    },
    capabilities: input.capabilities ?? [],
    trace: { sources, timings, omissions },
  };
}
