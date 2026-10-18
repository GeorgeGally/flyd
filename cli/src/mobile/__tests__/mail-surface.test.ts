// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { MAIL_PAGE, MAIL_SCRIPT } from '../mail-surface.js';
async function flush(){for(let i=0;i<40;i++)await Promise.resolve()}
afterEach(()=>{vi.unstubAllGlobals();document.body.innerHTML='' });
it('renders provider text safely and saves only the reviewed snapshot after explicit confirmation',async()=>{
  document.body.innerHTML=MAIL_PAGE.match(/<body[^>]*>([\s\S]*)<\/body>/)![1];
  const calls:Array<{action:string;input:Record<string,unknown>}>=[];
  vi.stubGlobal('fetch',vi.fn(async(url:string,options?:{body:string})=>{
    if(url==='/api/state')return new Response(JSON.stringify({csrf:'csrf'}));
    const data=JSON.parse(options!.body);calls.push(data);
    const result=data.action==='accounts'?{accounts:[{id:'personal',email:'me@example.com',provider:'google'}]}:data.action==='inbox'?{items:[{id:'thread',subject:'<img src=x onerror=alert(1)>',from:'Friend <friend@example.com>'}]}:data.action==='read'?{id:'thread',messages:[{from:'Friend <friend@example.com>',subject:'Hello',text:'<script>attack()</script>'}]}:data.action==='drafts'?{drafts:[]}:{status:'succeeded'};
    return new Response(JSON.stringify({result}));
  }));
  new Function(MAIL_SCRIPT)();await flush();
  expect(document.querySelector('#mail-list img')).toBeNull();
  (document.querySelector('.mail-item') as HTMLButtonElement).click();await flush();
  expect(document.querySelector('#messages script')).toBeNull();expect(document.getElementById('messages')!.textContent).toContain('<script>');
  document.getElementById('reply')!.click();
  const body=document.getElementById('body') as HTMLTextAreaElement;body.value='Reviewed words';
  document.getElementById('draft-form')!.dispatchEvent(new Event('submit',{cancelable:true}));
  expect(calls.some(c=>c.action==='save')).toBe(false);
  body.value='Changed after review';document.getElementById('save')!.click();await flush();
  expect(calls.filter(c=>c.action==='save')).toHaveLength(1);
  expect(calls.find(c=>c.action==='save')!.input).toMatchObject({body:'Reviewed words',to:'friend@example.com',thread_id:'thread'});
  expect(document.getElementById('notice')!.textContent).toContain('not been sent');
});
