import { mkdtempSync,rmSync,readFileSync,appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach,afterEach,it,expect,vi } from "vitest";
import { IntelligenceEventStore } from "../../intelligence/event-store.js";
import { CognitiveCurator } from "../curator/curator.js";
import { procedureSignature,verifiedProcedureEvidence } from "../verified-procedure.js";
import { proposeFromOutcome } from "../../work-intelligence/skillify/propose.js";
import { confirmProposal } from "../../work-intelligence/skillify/confirm.js";
import { getProposal,configureSkillifyProposalDirectory } from "../../work-intelligence/skillify/proposal-store.js";
import { configureOutcomeJournalDirectory } from "../../work-intelligence/outcome-journal.js";
let dir:string,store:IntelligenceEventStore;
const originalTestHome=process.env.FLYD_DIR!;
const instructions="Check the original source before replacing a date";
beforeEach(()=>{dir=mkdtempSync(join(tmpdir(),"flyd-procedure-"));vi.stubEnv("FLYD_DIR",dir);configureSkillifyProposalDirectory(join(dir,"proposals"));configureOutcomeJournalDirectory(join(dir,"journal"));store=new IntelligenceEventStore();});
afterEach(()=>{store.close();configureSkillifyProposalDirectory(undefined);configureOutcomeJournalDirectory(join(originalTestHome,"overlay","founder-journal"));rmSync(dir,{recursive:true,force:true});vi.unstubAllEnvs();});
function evidence(count:number):number[]{
  return Array.from({length:count},(_,i)=>{
    const execution=new CognitiveCurator(store).recordObservation({execution:i,result:"verified"},"execution.original");
    return store.append({pathKind:"executive",kind:"verified_outcome",sourceId:"procedure.outcome",consent:{grantedAt:new Date().toISOString(),scopes:["procedure.outcome"]},retentionClass:"local_default",payloadClassification:"personal",provenance:"test",idempotencyKey:`outcome-${i}`,evidenceRefs:[`event:${execution}`],payload:{procedure:{signature:procedureSignature("research",instructions),instructions},outcome:{interventionId:`work-${i}`,attribution:"direct_verified"}}})!.sequence;
  });
}
it("requires independent outcome evidence rather than success or readback status",()=>{
  const refs=evidence(2);
  expect(verifiedProcedureEvidence(refs,"research",instructions)).toBe(false);
  expect(proposeFromOutcome({workSessionId:"work",interactionId:"close",outcomeStatus:"succeeded",domain:"research",intent:instructions})).toEqual([]);
  const third=evidence(3);
  expect(verifiedProcedureEvidence(third,"research",instructions)).toBe(true);
  expect(verifiedProcedureEvidence(third,"other",instructions)).toBe(false);
  expect(verifiedProcedureEvidence(third,"research","Unrelated lesson")).toBe(false);
});
it("uses the existing proposal/confirmation path and removes only generated source-erased guidance",()=>{
  evidence(3);
  const [proposal]=proposeFromOutcome({workSessionId:"work",interactionId:"close",outcomeStatus:"succeeded",domain:"research",intent:instructions});
  expect(proposal.knowledgeEvidence).toHaveLength(3);
  const result=confirmProposal(proposal.id,proposal.revision);
  expect(result.ok).toBe(true);
  const written=join(dir,"wiki",result.writtenPath!);
  appendFileSync(written,"\nHuman-authored note stays.\n");
  store.eraseSource("execution.original");
  expect(getProposal(proposal.id)).toBeNull();
  expect(readFileSync(written,"utf8")).not.toContain(instructions);
  expect(readFileSync(written,"utf8")).toContain("Human-authored note stays");
});
it("does not count reused evidence or ignore a known counterexample",()=>{
  const refs=evidence(3);
  const common=new CognitiveCurator(store).recordObservation({execution:"same original"},"execution.common");
  const reused=refs.map((_,i)=>store.append({pathKind:"executive",kind:"verified_outcome",sourceId:"procedure.reused",consent:{grantedAt:new Date().toISOString(),scopes:["procedure.reused"]},retentionClass:"local_default",payloadClassification:"personal",provenance:"test",idempotencyKey:`reused-${i}`,evidenceRefs:[`event:${common}`],payload:{procedure:{signature:procedureSignature("research",instructions),instructions},outcome:{interventionId:`reused-${i}`,attribution:"direct_verified"}}})!.sequence);
  expect(verifiedProcedureEvidence(reused,"research",instructions)).toBe(false);
  store.append({pathKind:"executive",kind:"verified_outcome",sourceId:"procedure.counterexample",consent:{grantedAt:new Date().toISOString(),scopes:["procedure.counterexample"]},retentionClass:"local_default",payloadClassification:"personal",provenance:"test",idempotencyKey:"counterexample",evidenceRefs:[`event:${common}`],payload:{procedure:{signature:procedureSignature("research",instructions),instructions},outcome:{interventionId:"failed-attempt",attribution:"not_helpful"}}});
  expect(verifiedProcedureEvidence(refs,"research",instructions)).toBe(false);
});
