import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { IntelligenceEventStore } from "../../intelligence/event-store.js";
import { CognitiveCurator } from "../curator/curator.js";
import { enqueueKnowledgeIssue, knowledgeIssues, runKnowledgeMaintenance, applyKnowledgeAnswers, knowledgeIssuePrompt } from "../curator/knowledge-maintenance.js";
import { SourceContractRegistry } from "../../intelligence/sensors/source-contracts.js";
import { migrateKnowledgeSources, runKnownFactMigration } from "../curator/knowledge-migration.js";
import { deriveWorldState } from "../../intelligence/world/world-model.js";
import { replayWorldModel } from "../../intelligence/world/replay-cache.js";
import { readProjection } from "../projections/store.js";

let dir: string, store: IntelligenceEventStore;
const key = { entityId: "project:harbor", property: "launch_date", scopeId: "project:harbor" };
beforeEach(() => { dir=mkdtempSync(join(tmpdir(),"flyd-maintain-")); vi.stubEnv("FLYD_DIR",dir); vi.stubEnv("FLYD_KNOWLEDGE_REPAIR","active"); store=new IntelligenceEventStore(); });
afterEach(() => { store.close(); rmSync(dir,{recursive:true,force:true}); vi.unstubAllEnvs(); });
const origin = () => new CognitiveCurator(store).recordConversationTurn({ sessionId:"research", user:"Check the Harbor launch date against the original document", assistant:"" });

describe("durable knowledge maintenance", () => {
  it("migrates attributable scopes idempotently and leaves unknown or erased originals alone",()=>{
    const source=new CognitiveCurator(store).recordConversationTurn({sessionId:"migration",user:"Harbor launch date is 2030-06-12",assistant:""});
    const first=migrateKnowledgeSources(store,[source]);
    expect(first.applied).toHaveLength(1);
    expect(migrateKnowledgeSources(store,[source]).applied).toEqual(first.applied);
    runKnownFactMigration(store);
    expect(deriveWorldState(replayWorldModel(store)).current).toHaveLength(1);
    store.eraseSource("chat.cognition");
    expect(migrateKnowledgeSources(store,[source]).applied).toHaveLength(0);
  });

  it("respects paused learning and never sends local-only evidence to a research model",async()=>{
    const registry=new SourceContractRegistry();
    registry.register({sourceId:"private.local",displayName:"Local evidence",sensitivity:"low",scopes:["private.local"],retentionClass:"local_default",egressDestinations:[],purpose:"Local checks",enabledByDefault:true});
    const source=new CognitiveCurator(store).recordObservation({sourceEvidence:{text:"Harbor launch date is 2030-06-12"}},"private.local");
    enqueueKnowledgeIssue(store,{originSequence:source,question:"Check this private evidence",key,source:{kind:"research"}});
    const dispatch=vi.fn((id:string)=>id);
    await runKnowledgeMaintenance({store,deps:{dispatch}});
    expect(dispatch).not.toHaveBeenCalled();
    enqueueKnowledgeIssue(store,{originSequence:origin(),question:"Local recheck",key,source:{kind:"event",sequence:source}});
    await runKnowledgeMaintenance({store});
    expect(knowledgeIssuePrompt(store)).not.toContain("2030-06-12");
    registry.setStatus("private.local","paused");
    expect(migrateKnowledgeSources(store,[source]).applied).toHaveLength(0);
  });
  it("reads an original source without new chat and applies only grounded issue-scoped answers",async()=>{
    const source = new CognitiveCurator(store).recordObservation({ sourceEvidence:{text:"Harbor launch date is 2030-06-12"} },"test.source");
    const issue=enqueueKnowledgeIssue(store,{originSequence:origin(),question:"Check Harbor date",key,source:{kind:"event",sequence:source}});
    expect(enqueueKnowledgeIssue(store,{originSequence:issue.originSequence,question:issue.question,key,source:issue.source}).id).toBe(issue.id);
    expect(await runKnowledgeMaintenance({store})).toBe(1);
    const ready=knowledgeIssues(store)[0];
    expect(ready.state).toBe("ready");
    expect(applyKnowledgeAnswers(store,[{issueId:issue.id,value:"2030-06-12",sequence:ready.evidenceSequences[0],quote:"Harbor launch date is 2030-06-12"}])).toHaveLength(1);
    expect(deriveWorldState(replayWorldModel(store)).current[0].value).toBe("2030-06-12");
    expect(readProjection("now")).toContain("2030-06-12");
    store.eraseSource("test.source");
    expect(deriveWorldState(replayWorldModel(store)).current).toHaveLength(0);
    expect(readProjection("now")).not.toContain("2030-06-12");
    expect(store.readRecords("knowledge.source")).toHaveLength(0);
  });

  it("defers unavailable evidence after bounded retries and survives process reopen",async()=>{
    const issue=enqueueKnowledgeIssue(store,{originSequence:origin(),question:"Missing source",key,source:{kind:"event",sequence:99999}});
    const now=new Date();
    await runKnowledgeMaintenance({store,now});
    expect(knowledgeIssues(store)[0].state).toBe("queued");
    const reopened=new IntelligenceEventStore();
    await runKnowledgeMaintenance({store:reopened,now:new Date(now.getTime()+360000)});
    expect(knowledgeIssues(reopened).find((i)=>i.id===issue.id)?.state).toBe("deferred");
    reopened.close();
  });

  it("retention purges retract numeric and UUID-linked knowledge copies without revoking the source",()=>{
    const source=new CognitiveCurator(store).recordObservation({sourceEvidence:{text:"Harbor launch date is 2030-06-12"}},"retention.original");
    const original=store.getBySequence(source)!;
    const numeric=store.append({pathKind:"executive",kind:"observation",sourceId:"chat.cognition",consent:{grantedAt:new Date().toISOString(),scopes:["chat.cognition"]},retentionClass:"local_default",payloadClassification:"personal",provenance:"knowledge-source:v1",idempotencyKey:"retention-numeric",evidenceRefs:[`event:${source}`],payload:{recordType:"knowledge.source",sourceEvidence:{text:"copied numeric content"}}})!;
    const uuid=store.append({pathKind:"executive",kind:"observation",sourceId:"chat.cognition",consent:{grantedAt:new Date().toISOString(),scopes:["chat.cognition"]},retentionClass:"local_default",payloadClassification:"personal",provenance:"knowledge-source:v1",idempotencyKey:"retention-uuid",evidenceRefs:[`event:${original.id}`],payload:{recordType:"knowledge.source",sourceEvidence:{text:"copied UUID content"}}})!;
    expect(store.getByEventReference(`event:${original.id}`)?.sequence).toBe(source);
    expect(store.purgeSourceBefore("retention.original",new Date(Date.now()+1000))).toBe(1);
    expect(store.getBySequence(numeric.sequence)?.payload).toBeUndefined();
    expect(store.getBySequence(uuid.sequence)?.payload).toBeUndefined();
    expect(store.isRevoked("retention.original")).toBe(false);
  });

  it("resumes an idempotent existing domain run rather than dispatching another fleet",async()=>{
    enqueueKnowledgeIssue(store,{originSequence:origin(),question:"Investigate original evidence",key,source:{kind:"research"}});
    const dispatch=vi.fn((id:string)=>id);
    const report=vi.fn<((id:string)=>{finished:boolean;text:string}|null)>(()=>null);
    const now=new Date();
    await runKnowledgeMaintenance({store,now,deps:{dispatch,report}});
    expect(dispatch).toHaveBeenCalledTimes(1);
    report.mockReturnValue({finished:false,text:""});
    await runKnowledgeMaintenance({store,now:new Date(now.getTime()+360000),deps:{dispatch,report}});
    expect(dispatch).toHaveBeenCalledTimes(1);
    report.mockReturnValue({finished:true,text:"Source A gives 2030-06-12; source B differs"});
    await runKnowledgeMaintenance({store,now:new Date(now.getTime()+720000),deps:{dispatch,report}});
    expect(knowledgeIssues(store)[0].state).toBe("ready");
    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it("revocation during a source read prevents copying its payload into another source",async()=>{
    const source=new CognitiveCurator(store).recordObservation({sourceEvidence:{text:"private original"}},"source.revoked");
    enqueueKnowledgeIssue(store,{originSequence:origin(),question:"Recheck",key,source:{kind:"event",sequence:source}});
    await runKnowledgeMaintenance({store,deps:{read:async()=>{store.eraseSource("source.revoked");return {text:"private original",locator:"test"};}}});
    expect(store.readRecords("knowledge.source")).toHaveLength(0);
  });
});
