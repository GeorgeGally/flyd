export type WorkDomain = 'design' | 'writing' | 'strategy' | 'code' | 'research';

export interface DomainStandard {
  domain: WorkDomain;
  evaluationDimensions: string[];
  focusPrompt: string;
  avoidances: string[];
}

export const DOMAIN_STANDARDS: Record<WorkDomain, DomainStandard> = {
  design: {
    domain: 'design',
    evaluationDimensions: [
      'hierarchy — what does the eye see first, second, third?',
      'clarity — can the viewer understand the message without explanation?',
      'composition — are elements placed with visual weight and balance?',
      'typography — are type choices consistent and readable?',
      'information density — is every element earning its space?',
      'narrative sequence — does the layout guide the viewer through the content?',
      'audience appropriateness — does this work for who will see it?',
      'aesthetic coherence — do the parts feel like one intentional design?',
      'originality vs convention — is this distinctive where it matters?',
    ],
    focusPrompt: `Evaluate the design artifact against the most relevant dimensions above. Identify the ONE causal issue that most weakens the design's effectiveness. Point to the specific visual region or element causing the problem. Propose ONE stronger arrangement.`,
    avoidances: [
      'Do not evaluate like a generic critic — point to a visual cause.',
      'Do not praise first — lead with the issue.',
      'Do not list every improvement — select the one with highest leverage.',
      'Preserve the user\'s aesthetic intent — work within their direction.',
    ],
  },

  writing: {
    domain: 'writing',
    evaluationDimensions: [
      'desired outcome — will the reader do what the writer intends?',
      'recipient context — does this match the reader\'s situation and knowledge?',
      'clarity of ask — is the request or message specific and actionable?',
      'structure — does the flow build a case, guide, or persuade?',
      'specificity — are claims concrete or abstract?',
      'credibility — does the writing signal competence and trustworthiness?',
      'tone — does the voice fit the relationship and channel?',
      'reason to respond — what makes the reader care enough to act?',
    ],
    focusPrompt: `Evaluate the writing against the outcome the writer intends. Identify the ONE structural or tonal issue most likely to prevent the desired response. Propose a specific rewrite that addresses that issue while preserving the writer's voice.`,
    avoidances: [
      'Do not rewrite in your own voice — preserve the user\'s voice.',
      'Do not over-explain your edit — show the result, state the issue in one line.',
      'Do not recommend generic improvements ("be more specific").',
      'Do not praise unless the praise itself is diagnostic.',
    ],
  },

  strategy: {
    domain: 'strategy',
    evaluationDimensions: [
      'user problem — is there a real, specific problem someone has?',
      'wedge — is there a defensible entry point or is this a feature list?',
      'value creation — does the solution create disproportionate value for effort?',
      'differentiation — why wouldn\'t the obvious alternative work as well?',
      'assumptions — which beliefs, if wrong, collapse the strategy?',
      'evidence — what has proven this direction vs what is inferred?',
      'adoption barriers — what must change in the user\'s world for this to work?',
      'incentive alignment — do all parties benefit from this succeeding?',
      'feasibility — can this be built with available resources in reasonable time?',
      'sequencing — is the order of work correct or does a dependency risk the whole?',
      'smallest decisive test — what is the cheapest way to change the decision?',
    ],
    focusPrompt: `Evaluate the strategic artifact against the dimensions above. Identify the ONE weakest untested assumption, missing piece of evidence, or misalignment that most threatens the strategy. Propose the smallest test or reframe that would either validate or revise it.`,
    avoidances: [
      'Do not recommend adding features as the default fix.',
      'Do not substitute enthusiasm for evidence.',
      'Do not evaluate business ideas that are not yours — stay within the presented artifact.',
      'Do not offer generic startup advice.',
    ],
  },

  code: {
    domain: 'code',
    evaluationDimensions: [
      'correctness — does it do what it claims, including edge cases?',
      'user-facing behaviour — does the change match the intended product outcome?',
      'maintainability — will the next person understand this?',
      'security — are inputs validated, secrets handled, permissions checked?',
      'failure handling — does it degrade gracefully or crash silently?',
      'tests — do existing tests still pass and cover the new paths?',
      'observability — can errors be diagnosed from logs or metrics?',
      'architectural fit — does this belong in this layer or does it cross-cut badly?',
      'complexity vs value — is the complexity added worth the user value created?',
    ],
    focusPrompt: `Evaluate the code artifact against the dimensions above. Identify the ONE issue that most threatens correctness, maintainability, or product value. Propose a specific change with the exact location. A technically correct feature that does not increase user value should be called out.`,
    avoidances: [
      'Do not review code you cannot see in the capture.',
      'Do not suggest rewrites unless you can point to the affected lines.',
      'Do not evaluate architectural decisions without repository evidence.',
      'Do not propose changes that are purely stylistic unless style creates confusion.',
    ],
  },

  research: {
    domain: 'research',
    evaluationDimensions: [
      'question definition — is the research question specific and falsifiable?',
      'source quality — are sources credible, recent, and primary where possible?',
      'recency — does the evidence reflect the current state of knowledge?',
      'contrary evidence — is there credible disagreement not yet addressed?',
      'duplicated claims — are the same findings restated without synthesis?',
      'missing actors or incentives — who benefits from the status quo?',
      'inference quality — do conclusions follow from the assembled evidence?',
      'confidence — are uncertainty and gaps named honestly?',
      'implications — does the synthesis change a concrete decision?',
    ],
    focusPrompt: `Evaluate the research against the dimensions above. Identify the ONE gap, missing source, or inference leap that most weakens the synthesis. Propose a specific question, source direction, or evidence check that would materially strengthen it.`,
    avoidances: [
      'Do not invent sources or claim knowledge you don\'t have.',
      'Do not evaluate your own training data as evidence.',
      'Do not recommend generic research practices ("check more sources").',
      'Name a specific missing dimension or contrary position.',
    ],
  },
};

export function selectDomainStandard(currentWork: { artifactKind?: string; bundleId?: string }): DomainStandard {
  const artifactKind = currentWork.artifactKind?.toLowerCase() || '';
  const bundleId = currentWork.bundleId?.toLowerCase() || '';

  if (artifactKind === 'code' || bundleId.includes('xcode') || bundleId.includes('vscode')) {
    return DOMAIN_STANDARDS.code;
  }
  if (artifactKind === 'design' || bundleId.includes('figma') || bundleId.includes('sketch')) {
    return DOMAIN_STANDARDS.design;
  }
  if (artifactKind === 'presentation' || bundleId.includes('keynote') || bundleId.includes('powerpoint')) {
    return DOMAIN_STANDARDS.design;
  }
  if (artifactKind === 'research' || bundleId.includes('safari') || bundleId.includes('chrome')) {
    return DOMAIN_STANDARDS.research;
  }
  if (artifactKind === 'message' || artifactKind === 'document' || bundleId.includes('mail') || bundleId.includes('pages')) {
    return DOMAIN_STANDARDS.writing;
  }

  return DOMAIN_STANDARDS.strategy;
}
