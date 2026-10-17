import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PreparationStore, type PreparationSource } from '../preparation-store.js';
const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach(dir => rmSync(dir, {recursive:true,force:true})));
function setup() {
 const dir=mkdtempSync(join(tmpdir(),'flyd-prep-')); dirs.push(dir);
 const options={path:join(dir,'events.db'),now:()=>new Date('2026-10-17T00:00:00Z')};
 const store=new PreparationStore(options);
 const source:PreparationSource={turnId:'grant',sessionId:'session',text:'Prepare sponsor follow-ups',revision:1,consentRef:'explicit:grant'};
 const remit=store.registerRemit(source,{goal:'Sponsors',providerIdentity:'test:model'});
 return {store,source,remit,options};
}
it('replays durable claims once and preserves exact source words',()=>{
 const {store,source,remit,options}=setup();
 const candidate={remitId:remit.id,sourceSpan:source.text,outcome:'Follow-up draft'};
 const first=store.claim(source,candidate); expect(first.accepted).toBe(true);
 expect(new PreparationStore(options).claim(source,candidate).accepted).toBe(false);
 expect(store.listRemits('session')[0].source.text).toBe(source.text);
});
it('reserves at most two global attempts and deduplicates equivalent deliverables',()=>{
 const {store,source,remit}=setup();
 expect(store.claim(source,{remitId:remit.id,sourceSpan:source.text,outcome:'draft'}).accepted).toBe(true);
 expect(store.claim({...source,turnId:'2'},{remitId:remit.id,sourceSpan:source.text,outcome:'draft'}).accepted).toBe(false);
 expect(store.claim({...source,turnId:'3'},{remitId:remit.id,sourceSpan:source.text,outcome:'research'}).accepted).toBe(true);
 expect(store.claim({...source,turnId:'4'},{remitId:remit.id,sourceSpan:source.text,outcome:'outline'})).toMatchObject({accepted:false,reason:'capacity'});
});
it('prevents late publication after cancel, revision and erasure',()=>{
 for(const action of ['cancel','revision','erase']) {
 const {store,source,remit}=setup(); const result=store.claim(source,{remitId:remit.id,sourceSpan:source.text,outcome:'draft'});
 if(!result.accepted) throw Error('claim rejected');
 if(action==='cancel') store.cancel('session');
 if(action==='revision') store.registerRemit({...source,revision:2},{id:remit.id,goal:'Changed',providerIdentity:'test:model'});
 if(action==='erase') store.erase('session');
 expect(store.complete(result.attempt.id,{content:'Checked draft',evidenceRefs:['turn:grant']})).toBe(false);
 if(action==='erase') expect(store.list('session')).toEqual([]);
 }
});
it('retains checked output and rejects invented evidence spans and expired grants',()=>{
 const {store,source,remit}=setup();
 expect(store.claim(source,{remitId:remit.id,sourceSpan:'invented',outcome:'draft'}).accepted).toBe(false);
 const result=store.claim(source,{remitId:remit.id,sourceSpan:source.text,outcome:'draft'}); if(!result.accepted) throw Error('blocked');
 expect(store.complete(result.attempt.id,{content:'Actual draft',evidenceRefs:['turn:grant']})).toBe(true);
 expect(store.read(result.attempt.id)).toMatchObject({status:'prepared',content:'Actual draft'});
 expect(()=>store.registerRemit(source,{goal:'x',providerIdentity:'test',expiresAt:'2027-01-01T00:00:00Z'})).toThrow();
});
it('expiry and failed attempts cannot publish; repeated identical words can request another deliverable',()=>{
 const {store,source,remit,options}=setup();
 const first=store.claim(source,{remitId:remit.id,sourceSpan:source.text,outcome:'draft'});
 if(!first.accepted) throw Error('blocked');
 const second=store.claim({...source,turnId:'intentional-second-turn'},{remitId:remit.id,sourceSpan:source.text,outcome:'outline'});
 expect(second.accepted).toBe(true);
 const future=new PreparationStore({...options,now:()=>new Date('2026-11-17T00:00:00Z')});
 expect(future.isActive(first.attempt.id)).toBe(false);
 expect(future.complete(first.attempt.id,{content:'Too late',evidenceRefs:[]})).toBe(false);
 store.fail(first.attempt.id,'Checker rejected unsupported claims');
 expect(store.complete(first.attempt.id,{content:'No',evidenceRefs:[]})).toBe(false);
});
it('erasure survives restart and rejects delayed grant and transport retries',()=>{
 const {store,source,remit,options}=setup();
 store.claim(source,{remitId:remit.id,sourceSpan:source.text,outcome:'draft'});
 store.erase(source.sessionId);
 const restarted=new PreparationStore(options);
 expect(restarted.list()).toEqual([]);
 expect(restarted.listRemits(source.sessionId)).toEqual([]);
 expect(restarted.claim(source,{remitId:remit.id,sourceSpan:source.text,outcome:'draft'})).toEqual({accepted:false,reason:'erased'});
 expect(()=>restarted.registerRemit(source,{goal:'No resurrection',providerIdentity:'test'})).toThrow('Session erased');
});
it('reconciles an expired attempt after the worker aborts, so capacity is reusable',()=>{
 const {store,source,remit,options}=setup();
 const claim=store.claim(source,{remitId:remit.id,sourceSpan:source.text,outcome:'draft'}); if(!claim.accepted) throw Error('blocked');
 const future=new PreparationStore({...options,now:()=>new Date('2026-11-17T00:00:00Z')});
 future.fail(claim.attempt.id,'Scope expired; provider aborted');
 expect(future.read(claim.attempt.id)?.status).toBe('failed');
 expect(future.complete(claim.attempt.id,{content:'Too late',evidenceRefs:[]})).toBe(false);
});
it('permits a new deliverable revision when the supplied facts materially change',()=>{
 const {store,source,remit}=setup();
 const first=store.claim(source,{remitId:remit.id,sourceSpan:source.text,outcome:'Sponsor draft',context:[{ref:'contact-1',text:'Contact is Alex.'}]});
 if(!first.accepted)throw Error('blocked');
 store.complete(first.attempt.id,{content:'Dear Alex',evidenceRefs:['contact-1']});
 const next=store.claim({...source,turnId:'new-evidence'},{remitId:remit.id,sourceSpan:source.text,outcome:'Sponsor draft',context:[{ref:'contact-2',text:'Contact is Sam; Alex has left.'}]});
 expect(next.accepted).toBe(true);
});
