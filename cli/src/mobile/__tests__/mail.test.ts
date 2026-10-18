import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { IntelligenceEventStore } from "../../intelligence/event-store.js";
import { saveAccount } from "../../connectors/accounts.js";
import { clearGoogleTokens, GOOGLE_SCOPES, type Http } from "../../connectors/google.js";
import { MobileMail } from "../mail.js";
import { MobileRequests } from "../requests.js";
let dir: string, db: IntelligenceEventStore;
const previous = process.env.FLYD_CONNECTOR_DIR;
beforeEach(()=>{dir=mkdtempSync(join(tmpdir(),'mobile-mail-'));process.env.FLYD_CONNECTOR_DIR=join(dir,'accounts');clearGoogleTokens();db=new IntelligenceEventStore({path:join(dir,'events.sqlite')});saveAccount({id:'personal',provider:'google',email:'me@example.com'},{clientId:'test',refreshToken:'secret',scopes:GOOGLE_SCOPES})});
afterEach(()=>{db.close();rmSync(dir,{recursive:true,force:true});if(previous===undefined)delete process.env.FLYD_CONNECTOR_DIR;else process.env.FLYD_CONNECTOR_DIR=previous});
function mock(handler:(url:string,init?:RequestInit)=>unknown){return vi.fn(async(url,init)=>new Response(JSON.stringify(String(url).includes('/token')?{access_token:'token',expires_in:3600}:await handler(String(url),init)))) as unknown as Http}
const draft={id:'reviewed-draft-123456',account:'personal',to:'you@example.com',subject:'Hello',body:'Exact reviewed words.\nThanks.'};
it('saves the exact reviewed draft once, independently of conversation requests',async()=>{let writes=0,raw='';const http=mock((url,init)=>{expect(url).not.toContain('/send');writes++;raw=JSON.parse(String(init?.body)).message.raw;return {id:'saved'}});const mail=new MobileMail(db,{http});expect(await mail.run('save',draft)).toMatchObject({status:'succeeded'});expect(await mail.run('save',draft)).toMatchObject({status:'succeeded'});expect(writes).toBe(1);expect(Buffer.from(Buffer.from(raw,'base64url').toString().split('\r\n\r\n')[1].replace(/\s/g,''),'base64').toString()).toBe(draft.body);expect(new MobileRequests(db).list()).toEqual([]);expect(await mail.run('drafts',{})).toMatchObject({drafts:[{to:draft.to,status:'succeeded'}]});await expect(mail.run('save',{...draft,body:'Changed'})).rejects.toThrow()});
it('keeps an uncertain save terminal across restart and never retries it',async()=>{let writes=0;const http=mock(()=>{writes++;throw Error('connection lost')});const mail=new MobileMail(db,{http});expect(await mail.run('save',draft)).toMatchObject({status:'unknown'});expect(await new MobileMail(db,{http}).run('save',draft)).toMatchObject({status:'unknown'});expect(writes).toBe(1)});
it('rejects invalid recipient before any provider request',async()=>{const http=mock(()=>({}));await expect(new MobileMail(db,{http}).run('save',{...draft,to:'bad\r\nBcc: attack@example.com'})).rejects.toThrow();expect(http).not.toHaveBeenCalled()});
it('loads inbox metadata with no message modification',async()=>{const http=mock(url=>url.includes('threads?')?{threads:[{id:'one'}]}:{messages:[{payload:{headers:[{name:'Subject',value:'An inbox item'},{name:'From',value:'Friend'}]}}]});const result=await new MobileMail(db,{http}).run('inbox',{account:'personal'});expect(result).toMatchObject({items:[{id:'one',subject:'An inbox item',from:'Friend'}]});expect(vi.mocked(http).mock.calls.every(([,init])=>!init?.method||init.method==='POST'||init.method==='GET')).toBe(true)});
