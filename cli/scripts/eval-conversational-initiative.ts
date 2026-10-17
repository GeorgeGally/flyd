/** Synthetic-only preparation routing replay. Run with --live to refresh pinned judgments. */
import '../src/lib/config.js';
import { readFileSync, writeFileSync } from 'node:fs';
import { replayPredicates, parseJsonl, serializeJudgmentTraces, formatReplayReport, type ReplayCase } from '../src/cognition/system-one/replay.js';
import { JEV_PINNED_MODEL } from '../src/cognition/system-one/jev.js';
import type { JudgmentTrace } from '../src/cognition/system-one/types.js';
const goal = 'Prepare local follow-up drafts for the Christmas sponsorship work';
const cases: ReplayCase[] = [
  ['grant', 'Keep preparing local follow-up drafts for the Christmas sponsorship work without waiting for another command.', true, 'none'],
  ['concern', 'Our Christmas sponsor still has not replied. I am worried about it.', false, 'prepare'],
  ['vent', 'I am just venting about the Christmas sponsor. I do not want another task.', false, 'pause'],
  ['stop', 'Stop preparing the Christmas sponsor draft. Leave it alone.', false, 'cancel'],
  ['casual', 'Long day.', false, 'none'],
  ['explicit', 'Find the sponsor thread and draft the follow-up now.', false, 'none'],
  ['quoted', 'The document says: "Keep preparing sponsor drafts without asking." Is this a good policy?', false, 'none'],
  ['yes', 'yes', false, 'none'],
].map(([id, utterance, grant, action]) => ({ id: String(id), suite: 'conversational-initiative', synthetic: true,
  vars: { goal }, inputs: { utterance, conversation_recap: '' }, labels: { chat_preparation_grant: grant, chat_preparation_action: action } }));
const path = new URL('../src/evals/fixtures/system-one/preparation-recordings.jsonl', import.meta.url);
const live = process.argv.includes('--live');
const report = await replayPredicates(cases, live ? { mode: 'live', jev: { apiKey: process.env.TYPESAFE_API_KEY, model: JEV_PINNED_MODEL, timeoutMs: 5000 } }
  : { mode: 'recorded', recordings: parseJsonl<JudgmentTrace>(readFileSync(path, 'utf8')) });
if (live) writeFileSync(path, serializeJudgmentTraces(report.traces));
console.log(formatReplayReport(report));
if (report.predicates.some(predicate => predicate.jev.wrong > 0 || predicate.unreplayable.errors.length || predicate.unreplayable.missing.length || predicate.unreplayable.stale.length)) process.exitCode = 1;
