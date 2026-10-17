import { BASE_STYLE } from './page.js';

export function renderPreparationPage(token: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Flyd · Local preparation</title>
<style>${BASE_STYLE}
main{max-width:860px;margin:48px auto;padding:0 28px;font-size:18px;line-height:1.55}h1{font-size:44px;line-height:1.1;letter-spacing:-.04em}h2{font-size:25px;margin:0 0 12px}p{color:var(--muted)}section{padding:28px 0;border-top:1px solid var(--faint)}pre{font:inherit;white-space:pre-wrap;overflow-wrap:anywhere}button,a{color:var(--accent);font:inherit}button{background:none;border:1px solid var(--faint);border-radius:9px;padding:10px 16px;cursor:pointer;margin:16px 12px 0 0}button:hover{border-color:var(--accent)}button:disabled{opacity:.5}.flow{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px 24px;align-items:center;margin:32px 0}.flow span{border-bottom:2px solid var(--accent);padding:8px 0}.quote{border-left:2px solid var(--accent);padding-left:18px;color:var(--muted)}#status{min-height:28px;color:var(--accent)}@media(max-width:500px){main{margin-top:28px}h1{font-size:36px}.flow{font-size:15px}}
</style></head><body><header><a href="/">Flyd</a></header><main><h1>Local preparation</h1>
<p>Flyd can prepare drafts within a scope you have agreed. You review the material here or in the conversation. Nothing is sent or published.</p>
<div class="flow" aria-label="Preparation flow"><span>1. Your concern</span><span>2. A local draft</span><span>3. An independent check</span><span>4. Your review</span></div>
<div id="status" role="status"></div><div id="remits"></div><div id="drafts"></div><button id="forget">Forget preparation data</button></main>
<script>
let stateKey='';
const TOKEN=${JSON.stringify(token)}, session=new URLSearchParams(location.search).get('session')||'latest';
async function api(body){const response=await fetch('/api/preparation?session='+encodeURIComponent(session),{method:body?'POST':'GET',headers:{'content-type':'application/json','x-flyd-view-token':TOKEN},body:body?JSON.stringify(body):undefined});const data=await response.json();if(!response.ok)throw Error(data.error||'Preparation unavailable');return data;}
function el(tag,text,parent){const node=document.createElement(tag);node.textContent=text;if(parent)parent.append(node);return node;}
function action(parent,label,body){const button=el('button',label,parent);button.onclick=async()=>{button.disabled=true;try{await api(body);await load();}catch(error){document.getElementById('status').textContent=error.message;}finally{button.disabled=false;}};}
async function load(){const state=await api(),key=JSON.stringify(state);if(key===stateKey)return;stateKey=key;const remits=document.getElementById('remits'),drafts=document.getElementById('drafts');remits.replaceChildren();drafts.replaceChildren();
if(!state.remits.length)el('p','No preparation scope is active in this conversation. You can tell Flyd, “Keep preparing local drafts for our sponsorship work.”',remits);
for(const remit of state.remits){const item=el('section','',remits);el('h2',remit.goal,item);el('p','Your permission: '+remit.source.text,item).className='quote';el('p',remit.paused?'New preparation is paused because you said you were just venting. Existing work can finish.':'Active until '+new Date(remit.expiresAt).toLocaleDateString()+'. Uses only supplied conversation context.',item);action(item,'Stop preparing',{action:'cancel',id:remit.id});}
for(const draft of state.attempts.slice().reverse()){const item=el('section','',drafts);el('h2',draft.status==='prepared'?'Draft ready for review':draft.status==='accepted'?'Preparing a draft':draft.status==='cancelled'?'Preparation stopped':draft.status==='failed'?'Draft could not be checked':'Preparation interrupted',item);el('p',draft.goal,item);el('p','Why this started: '+draft.sourceSpan,item).className='quote';if(draft.status==='prepared'&&draft.content)el('pre',draft.content,item);if(draft.status==='accepted')action(item,'Stop preparing',{action:'cancel',id:draft.remitId});}}
document.getElementById('forget').onclick=async()=>{if(!confirm('Forget preparation scopes and drafts for this conversation? This also stops new preparation here.'))return;try{await api({action:'erase'});await load();}catch(error){document.getElementById('status').textContent=error.message;}};
load().catch(error=>document.getElementById('status').textContent=error.message);setInterval(()=>load().catch(()=>{}),5000);
</script></body></html>`;
}
