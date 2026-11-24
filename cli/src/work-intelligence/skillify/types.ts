export type SkillifyProposalKind =
  | 'domain_standard'
  | 'constraint'
  | 'decision'
  | 'project_page';

export type SkillifyProposalStatus =
  | 'proposed'
  | 'confirmed'
  | 'declined'
  | 'expired'
  | 'written';

export interface SkillifyProposal {
  knowledgeEvidence?: number[];
  id: string;
  kind: SkillifyProposalKind;
  targetPath: string;
  body: string;
  provenance: string;
  sourceOutcome: string;
  domain?: string;
  workSessionId?: string;
  interactionId?: string;
  status: SkillifyProposalStatus;
  dedupeKey: string;
  revision: number;
  createdAt: string;
  expiresAt: string;
  confirmedAt?: string;
  writtenAt?: string;
}

export interface SkillifyProposeInput {
  knowledgeEvidence?: number[];
  kind: SkillifyProposalKind;
  targetPath: string;
  body: string;
  provenance: string;
  sourceOutcome: string;
  domain?: string;
  dedupeKey: string;
}

export const SKILLIFY_MAX_PENDING = 20;
export const SKILLIFY_TTL_DAYS = 7;
