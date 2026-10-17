import { createHash, randomUUID } from 'node:crypto';
import { IntelligenceEventStore } from '../intelligence/event-store.js';
import { validateEnvelope } from '../intelligence/context-envelope.js';

export interface PreparationSource {
  turnId: string;
  sessionId: string;
  text: string;
  revision: number;
  consentRef: string;
}
export interface PreparationRemit {
  id: string;
  sessionId: string;
  source: PreparationSource;
  goal: string;
  outcome?: string;
  revision: number;
  expiresAt: string;
  providerIdentity: string;
  revoked?: boolean;
  paused?: boolean;
}
export interface PreparationCandidate {
  remitId: string;
  sourceSpan: string;
  outcome: string;
  context?: Array<{ ref: string; text: string }>;
}
export interface PreparationAttempt {
  id: string;
  remitId: string;
  remitRevision: number;
  sessionId: string;
  source: PreparationSource;
  sourceSpan: string;
  goal: string;
  outcome: string;
  providerIdentity: string;
  context: Array<{ ref: string; text: string }>;
  status: 'accepted' | 'prepared' | 'cancelled' | 'failed' | 'unknown';
  createdAt: string;
  ownerPid: number;
  content?: string;
  evidenceRefs?: string[];
  reason?: string;
}
type Claim = { accepted: true; attempt: PreparationAttempt } | { accepted: false; reason: string; attempt?: PreparationAttempt };
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const sourceId = (session: string) => `initiative.session.${hash(session)}`;
const DAY = 86_400_000;
const nonempty = (value: string) => typeof value === 'string' && !!value.trim();
function validSource(source: PreparationSource): boolean {
  return [source.turnId, source.sessionId, source.text, source.consentRef].every(nonempty) &&
    source.sessionId.length <= 200 && source.text.length <= 12_000 && Number.isInteger(source.revision) && source.revision > 0;
}

function evidenceKey(source: PreparationSource, context: Array<{ ref: string; text: string }>): string {
  const words = [source.text, ...context.map(item => item.text)].map(text => text.trim().toLowerCase().replace(/\s+/g, ' '));
  return hash(JSON.stringify([...new Set(words)].sort()));
}

/** Coordination facts replay from the canonical event spine inside its immediate transaction. */
export class PreparationStore {
  constructor(private readonly options: { path?: string; now?: () => Date; cooldownMs?: number } = {}) {}
  private now(): Date { return this.options.now?.() ?? new Date(); }
  private use<T>(work: (db: IntelligenceEventStore) => T): T {
    const db = new IntelligenceEventStore({ path: this.options.path ?? process.env.FLYD_INITIATIVE_DB });
    try { return db.transaction(() => work(db)); } finally { db.close(); }
  }
  private state(db: IntelligenceEventStore): { remits: Map<string, PreparationRemit>; attempts: Map<string, PreparationAttempt> } {
    const state = { remits: new Map<string, PreparationRemit>(), attempts: new Map<string, PreparationAttempt>() };
    for (const event of db.readSourcePrefix('initiative.session.')) {
      if (event.erased || !event.payload) continue;
      if (event.payload.remit) {
        const remit = event.payload.remit as unknown as PreparationRemit;
        state.remits.set(remit.id, remit);
      }
      if (event.payload.attempt) {
        const attempt = event.payload.attempt as unknown as PreparationAttempt;
        state.attempts.set(attempt.id, attempt);
      }
    }
    return state;
  }
  private event(db: IntelligenceEventStore, source: PreparationSource, payload: Record<string, unknown>, key: string = randomUUID()): void {
    const envelope = {
      pathKind: 'interface' as const, kind: 'executive_decision' as const,
      sourceId: sourceId(source.sessionId), provenance: 'Explicit user turn; bounded preparation coordination',
      consent: { grantedAt: this.now().toISOString(), scopes: ['initiative.preparation', source.consentRef] },
      retentionClass: 'local_default' as const, payloadClassification: 'personal' as const,
      idempotencyKey: key, evidenceRefs: [source.turnId, source.consentRef], payload,
    };
    const validation = validateEnvelope(envelope, { now: this.now(), consentLookup: db });
    if (!validation.ok) throw new Error(validation.detail);
    if (!db.append(envelope)) throw new Error('Could not record preparation');
  }
  registerRemit(source: PreparationSource, input: { id?: string; goal: string; providerIdentity: string; expiresAt?: string; outcome?: string }): PreparationRemit {
    if (!validSource(source) || !nonempty(input.goal) || !nonempty(input.providerIdentity)) throw new Error('Explicit source, consent and scoped goal required');
    const expires = input.expiresAt ? Date.parse(input.expiresAt) : this.now().getTime() + 30 * DAY;
    if (!Number.isFinite(expires) || expires <= this.now().getTime() || expires > this.now().getTime() + 30 * DAY) throw new Error('Remit must expire within 30 days');
    return this.use(db => {
      if (db.isRevoked(sourceId(source.sessionId))) throw new Error('Session erased');
      const state = this.state(db);
      const id = input.id ?? hash(JSON.stringify([source.sessionId, source.turnId, source.revision]));
      const previous = state.remits.get(id);
      if (previous && previous.sessionId !== source.sessionId) throw new Error('Remit belongs to another session');
      if (previous && previous.source.turnId === source.turnId && previous.source.revision === source.revision) return previous;
      const remit: PreparationRemit = { id, sessionId: source.sessionId, source: { ...source }, goal: input.goal,
        providerIdentity: input.providerIdentity, expiresAt: new Date(expires).toISOString(), revision: (previous?.revision ?? 0) + 1,
        ...(input.outcome ? { outcome: input.outcome } : {}) };
      this.event(db, source, { remit });
      return remit;
    });
  }
  listRemits(sessionId: string): PreparationRemit[] {
    return this.use(db => [...this.state(db).remits.values()].filter(remit => remit.sessionId === sessionId && !remit.revoked && Date.parse(remit.expiresAt) > this.now().getTime()));
  }
  claim(source: PreparationSource, candidate: PreparationCandidate): Claim {
    if (!validSource(source) || !nonempty(candidate.sourceSpan) || !source.text.includes(candidate.sourceSpan) || !nonempty(candidate.outcome)) return { accepted: false, reason: 'invalid_source' };
    if (candidate.outcome.length > 1000 || (candidate.context?.length ?? 0) > 12 || candidate.context?.some(item => !nonempty(item.ref) || !nonempty(item.text)) || (candidate.context?.reduce((sum, item) => sum + item.text.length, 0) ?? 0) > 16_000) return { accepted: false, reason: 'context_budget' };
    return this.use(db => {
      if (db.isRevoked(sourceId(source.sessionId))) return { accepted: false, reason: 'erased' };
      const state = this.state(db);
      const remit = state.remits.get(candidate.remitId);
      if (!remit || remit.sessionId !== source.sessionId || remit.revoked || remit.paused || Date.parse(remit.expiresAt) <= this.now().getTime()) return { accepted: false, reason: 'inactive_remit' };
      const id = hash(JSON.stringify([source.sessionId, source.turnId, source.revision, remit.id, remit.revision, candidate.outcome]));
      const previous = state.attempts.get(id);
      if (previous) return { accepted: false, reason: 'duplicate', attempt: previous };
      const active = [...state.attempts.values()].filter(attempt => attempt.status === 'accepted' || attempt.status === 'unknown');
      const equivalent = [...state.attempts.values()].find(attempt => attempt.remitId === remit.id && attempt.remitRevision === remit.revision && attempt.outcome.trim().toLowerCase() === candidate.outcome.trim().toLowerCase() && evidenceKey(attempt.source, attempt.context) === evidenceKey(source, candidate.context ?? []) &&
        (attempt.status === 'prepared' || attempt.status === 'accepted' || attempt.status === 'unknown' || this.now().getTime() - Date.parse(attempt.createdAt) < (this.options.cooldownMs ?? DAY)));
      if (equivalent) return { accepted: false, reason: 'equivalent', attempt: equivalent };
      if (active.length >= 2) return { accepted: false, reason: 'capacity' };
      const attempt: PreparationAttempt = { id, remitId: remit.id, remitRevision: remit.revision, sessionId: source.sessionId, source: { ...source }, sourceSpan: candidate.sourceSpan,
        goal: remit.goal, outcome: candidate.outcome, providerIdentity: remit.providerIdentity, context: candidate.context?.map(item => ({ ...item })) ?? [],
        status: 'accepted', createdAt: this.now().toISOString(), ownerPid: process.pid };
      this.event(db, source, { attempt }, `claim:${id}`);
      return { accepted: true, attempt };
    });
  }
  private active(db: IntelligenceEventStore, attempt: PreparationAttempt, remits: Map<string, PreparationRemit>): boolean {
    const remit = remits.get(attempt.remitId);
    return attempt.status === 'accepted' && !db.isRevoked(sourceId(attempt.sessionId)) && !!remit && !remit.revoked && remit.revision === attempt.remitRevision && Date.parse(remit.expiresAt) > this.now().getTime();
  }
  isActive(id: string): boolean { return this.use(db => { const state = this.state(db); const attempt = state.attempts.get(id); return !!attempt && this.active(db, attempt, state.remits); }); }
  complete(id: string, checked: { content: string; evidenceRefs: string[] }): boolean {
    if (!nonempty(checked.content) || checked.content.length > 32_000 || !checked.evidenceRefs.every(nonempty)) return false;
    return this.use(db => {
      const state = this.state(db); const attempt = state.attempts.get(id);
      if (!attempt || !this.active(db, attempt, state.remits)) return false;
      this.event(db, attempt.source, { attempt: { ...attempt, status: 'prepared', ...checked } }); return true;
    });
  }
  fail(id: string, reason: string): void {
    this.use(db => { const state = this.state(db); const attempt = state.attempts.get(id);
      if (attempt && (attempt.status === 'accepted' || attempt.status === 'unknown')) this.event(db, attempt.source, { attempt: { ...attempt, status: 'failed', reason: reason.slice(0, 500) } });
    });
  }
  pause(sessionId: string, remitId: string): void {
    this.use(db => { const remit = this.state(db).remits.get(remitId);
      if (remit && remit.sessionId === sessionId && !remit.revoked) this.event(db, remit.source, { remit: { ...remit, paused: true } });
    });
  }
  cancel(sessionId: string, remitId?: string): void {
    this.use(db => { const state = this.state(db);
      for (const remit of state.remits.values()) if (remit.sessionId === sessionId && (!remitId || remit.id === remitId) && !remit.revoked) this.event(db, remit.source, { remit: { ...remit, revoked: true } });
      for (const attempt of state.attempts.values()) if (attempt.sessionId === sessionId && (!remitId || attempt.remitId === remitId) && (attempt.status === 'accepted' || attempt.status === 'unknown')) this.event(db, attempt.source, { attempt: { ...attempt, status: 'cancelled' } });
    });
  }
  recoverInterrupted(): number {
    return this.use(db => { let count = 0;
      for (const attempt of this.state(db).attempts.values()) {
        if (attempt.status !== 'accepted' || attempt.ownerPid === process.pid) continue;
        try { process.kill(attempt.ownerPid, 0); } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ESRCH') continue;
          this.event(db, attempt.source, { attempt: { ...attempt, status: 'failed', reason: 'Owner exited before checked completion; no retry' } }); count++;
        }
      } return count;
    });
  }
  read(id: string): PreparationAttempt | undefined { return this.use(db => this.state(db).attempts.get(id)); }
  list(sessionId?: string): PreparationAttempt[] { return this.use(db => [...this.state(db).attempts.values()].filter(attempt => !sessionId || attempt.sessionId === sessionId)); }
  erase(sessionId: string): void { this.use(db => { db.eraseSource(sourceId(sessionId)); }); }
}
