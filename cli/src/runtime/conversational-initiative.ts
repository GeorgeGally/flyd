import { chatModelChain, resolveModelConnection } from '../lib/config.js';
import { runLocalPreparation } from '../command/librarian.js';
import { PreparationStore } from './preparation-store.js';
import type { ConversationTurnSource } from './conversation-turn.js';
import { parsePreparationReading, type PreparationReading } from './preparation-reading.js';

export interface InitiativeDependencies {
  store: PreparationStore;
  run?: typeof runLocalPreparation;
  models?: () => string[];
}

/** Runs beside the answer, outside its read-only tool route, under an explicit stored remit. */
export function coordinatePreparation(input: {
  source: ConversationTurnSource;
  reading: PreparationReading | null;
  route: string;
  onAccepted?: (id: string) => void;
}, deps: InitiativeDependencies): string {
  const { source, reading } = input;
  if (!reading || source.final !== true || source.retention !== 'local_default' || !source.text.includes(reading.sourceSpan)) return '';
  const { store } = deps;
  if (!parsePreparationReading(reading, source.text, store.listRemits(source.sessionId))) return '';
  if (reading.kind === 'pause') { store.pause(source.sessionId, reading.remitId); return 'He is just venting. Respond naturally; new preparation for this goal is paused. Existing independently accepted work continues. Do not offer another task.'; }
  if (reading.kind === 'cancel') {
    store.cancel(source.sessionId, reading.remitId);
    return 'Further draft preparation for this goal is revoked. Any in-flight generation is being cancelled; no delayed result may publish. Say you will leave this goal alone. Do not claim another independent task or sent message was stopped.';
  }
  const modelFor = (identity?: string) => (deps.models ?? chatModelChain)().find(model => {
    try { const connection = resolveModelConnection(model); return Boolean(connection.apiKey) && (!identity || connection.providerIdentity === identity); } catch { return false; }
  });
  if (reading.kind === 'grant') {
    // A failed/uncertain reader cannot promote a proposal into standing permission.
    if (input.route !== 'act' && input.route !== 'delegate') return '';
    const model = modelFor();
    if (!model) return 'No draft preparation has been enabled because no permitted model is configured. Continue the conversation without promising work.';
    const remit = store.registerRemit(source, { goal: reading.goal, providerIdentity: resolveModelConnection(model).providerIdentity });
    return `He explicitly authorized local preparation for: ${remit.goal}. This scope is recorded until ${remit.expiresAt.slice(0, 10)}. Acknowledge it plainly. It allows drafts using his supplied conversation only; no sending, account writes, research or schedules. Do not call another tool to record it.`;
  }
  if (input.route !== 'answer') return '';
  const remit = store.listRemits(source.sessionId).find(item => item.id === reading.remitId);
  if (!remit) return '';
  const model = modelFor(remit.providerIdentity);
  if (!model) return '';
  store.recoverInterrupted();
  const outcome = `Prepare a useful local draft for ${remit.goal}, addressing this concern: ${reading.sourceSpan}`;
  const claimed = store.claim(source, { remitId: remit.id, sourceSpan: reading.sourceSpan, outcome,
    context: [{ ref: remit.source.turnId, text: remit.source.text }, ...(source.context ?? []).filter(item => item.ref !== remit.source.turnId).slice(-6)] });
  if (!claimed.accepted) {
    if (claimed.attempt) input.onAccepted?.(claimed.attempt.id);
    return claimed.attempt?.status === 'prepared'
      ? 'A checked draft for this concern already exists in the conversation. Do not start another or claim the wider goal is achieved.' : '';
  }
  const attempt = claimed.attempt;
  input.onAccepted?.(attempt.id);
  void (deps.run ?? runLocalPreparation)({ attemptId: attempt.id, goal: attempt.goal, outcome: attempt.outcome,
    source: attempt.source, context: attempt.context, model, providerIdentity: attempt.providerIdentity }, { store })
    .catch(() => store.fail(attempt.id, 'Preparation interrupted before checked completion'));
  return 'A bounded local draft has been accepted and is being prepared from his supplied conversation. You may say you are preparing a draft. The checked material will appear with this answer. Do not claim it is ready, sent, or that the underlying goal is achieved. Do not offer the same preparation again.';
}
