import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
vi.mock("../../lib/brain-retrieval.js",()=>({retrieveLiveBrainEvidence:vi.fn(async()=>({matches:[]}))}));
import { IntelligenceEventStore } from "../../intelligence/event-store.js";
import { ingestKnowledgeCorrection } from "../curator/knowledge-repair.js";
import { captureKnowledgeSnapshot, verifyKnowledgeRead } from "../knowledge-verification.js";
import { buildEvalContext } from "../../evals/episodes/context.js";
import { liveKnowledgeRefresh } from "../live-knowledge.js";
import { respondToConversation } from "../../runtime/conversation-responder.js";
import { memoryEvidenceFromCompiled } from "../../runtime/resolution-receipt.js";

let dir:string,store:IntelligenceEventStore;
beforeEach(()=>{dir=mkdtempSync(join(tmpdir(),"flyd-consume-"));vi.stubEnv("FLYD_DIR",dir);vi.stubEnv("FLYD_MEMORY_DIR",dir);vi.stubEnv("FLYD_PROJECTS_PATH",join(dir,"projects.json"));vi.stubEnv("FLYD_KNOWLEDGE_REPAIR","active");vi.stubEnv("FLYD_ROOM","0");vi.stubEnv("FLYD_COS","0");store=new IntelligenceEventStore();});
afterEach(()=>{store.close();rmSync(dir,{recursive:true,force:true});vi.unstubAllEnvs();});

describe("knowledge consumers",()=>{
  it("freezes paired replay and records readback separately from accepting a fact",async()=>{
    ingestKnowledgeCorrection("Harbor launch date is 2030-06-10","first",store);
    const before=captureKnowledgeSnapshot(store);
    const receipt=ingestKnowledgeCorrection("Correction: Harbor launch date is 2030-06-12","second",store)!;
    const after=captureKnowledgeSnapshot(store);
    expect((await buildEvalContext("current","Harbor",10,before)).text).toContain("2030-06-10");
    expect((await buildEvalContext("current","Harbor",10,before)).text).not.toContain("2030-06-12");
    const context=await buildEvalContext("current","Harbor",10,after);
    expect(memoryEvidenceFromCompiled(after.memory,"No fact was supplied").verdict).toBe("insufficient");
    expect(memoryEvidenceFromCompiled(after.memory,context.text).matches.some(match=>match.kind==="canonical")).toBe(true);
    expect(verifyKnowledgeRead(store,receipt,{name:"replay",version:after.version,claimIds:after.memory.current.map(c=>c.claimId),prompt:context.text})).toBe("pass");
    expect(verifyKnowledgeRead(store,receipt,{name:"stale",version:before.version,claimIds:[],prompt:"Old answer"})).toBe("unknown");
    expect(store.readRecords("knowledge.verification")).toHaveLength(2);
    store.eraseSource("chat.cognition");
    expect((await buildEvalContext("current","Harbor",10,after)).text).not.toContain("2030-06-12");
  });

  it("refreshes a long-lived session once per change and refuses a raced compilation",async()=>{
    let version="one";
    const update=vi.fn();
    const compile=vi.fn(async()=>"current context");
    const refresh=liveKnowledgeRefresh(update,{version:()=>version,compile});
    expect(await refresh()).toBe(false);
    version="two";
    await Promise.all([refresh(),refresh()]);
    expect(update).toHaveBeenCalledTimes(1);
    expect(compile).toHaveBeenCalledTimes(1);
    version="three";
    compile.mockImplementationOnce(async()=>{version="four";return "stale context";});
    expect(await refresh()).toBe(false);
    expect(update).toHaveBeenCalledTimes(1);
    expect(await refresh()).toBe(true);
  });

  it.each(["chat","mobile"] as const)("retains an ordinary %s correction even if generation fails, then uses it in the next actual prompt",async(surface)=>{
    const base={...(surface === "mobile" ? {surface} : {}),sessionId:"knowledge-public",history:[],memory:{verdict:"insufficient" as const,matches:[]},situation:null,onToken:()=>undefined};
    const seen:string[]=[];
    const deps={models:()=>["gpt-4o-mini"],routeTurn:async()=>null,readRoom:async()=>null,
      runAgentLoop:async (_system:string,prompt:string)=>{seen.push(prompt);return "<final>The Harbor launch date is 2030-06-12.</final>";}};
    await respondToConversation({...base,turnNumber:1,message:"Correction: Harbor launch date is 2030-06-12"},{...deps,runAgentLoop:async()=>{throw new Error("Synthetic model outage");}}).catch(()=>undefined);
    expect(captureKnowledgeSnapshot(store).memory.current.some(c=>c.value==="2030-06-12")).toBe(true);
    await respondToConversation({...base,turnNumber:2,message:"When is Harbor launching?",memory:{verdict:"sufficient",matches:[{id:"old",path:"legacy-memory",stale:false,excerpt:"Harbor launch date is 2030-06-10"},{id:"old-canonical",path:"event:old",stale:false,excerpt:"project:harbor · launch_date: 2030-06-10"}]}},deps);
    expect(seen[seen.length-1]).toContain("2030-06-12");
    expect(seen[seen.length-1]).not.toContain("2030-06-10");
    expect(captureKnowledgeSnapshot(store).memory.current.some(c=>c.attribute==="launch_date"&&c.value==="2030-06-12")).toBe(true);
    expect(store.readRecords("knowledge.verification").some(event=>(event.payload?.verification as {consumer?:string})?.consumer===surface)).toBe(true);
  },20000);
});
