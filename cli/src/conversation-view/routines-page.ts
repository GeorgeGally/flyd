import { BASE_STYLE } from "./page.js";

const CLIENT = String.raw`
const session = new URLSearchParams(location.search).get('session') || 'latest';
let state, fieldId = 0;
const cards = document.getElementById('cards'), status = document.getElementById('status');
function el(tag, text, parent) {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (parent) parent.append(element);
  return element;
}
async function api(body) {
  const response = await fetch('/api/routines', {
    method: body ? 'POST' : 'GET',
    headers: { 'content-type': 'application/json', 'x-flyd-view-token': TOKEN },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await response.json();
  if (!response.ok) throw Error(data.error || 'Unavailable');
  return data;
}
function button(parent, text, action) {
  const control = el('button', text, parent); control.type = 'button';
  control.onclick = async () => {
    control.disabled = true;
    try { await action(); } catch (error) { status.textContent = error.message; }
    finally { control.disabled = false; }
  };
  return control;
}
function field(parent, label, value, multiline = false) {
  const name = el('label', label, parent);
  const input = el(multiline ? 'textarea' : 'input', undefined, parent);
  input.id = 'field-' + (++fieldId); name.htmlFor = input.id; input.value = value || '';
  return input;
}
function editor(routine) {
  const card = el('article', undefined, cards);
  const title = field(card, 'Name', routine?.title);
  const purpose = field(card, 'What this helps you achieve', routine?.purpose);
  const template = field(card, 'Request · use {{topic}} for a variable input', routine?.template, true);
  button(card, routine ? 'Save and activate' : 'Create', async () => {
    await api({ action: 'save', id: routine?.id, revision: routine?.revision,
      title: title.value, purpose: purpose.value, template: template.value });
    await load();
  });
  button(card, 'Cancel', () => card.remove());
}
function show() {
  cards.replaceChildren();
  document.getElementById('toggle').textContent = state.enabled ? 'Pause suggestions' : 'Resume suggestions';
  if (!state.routines.length) el('p', 'Nothing to keep yet. Create one, or repeat a short request in the conversation.', cards);
  for (const routine of state.routines) {
    const card = el('article', undefined, cards);
    el('span', routine.status === 'suggested' ? 'Suggested from three repeated requests' : 'Ready to use', card).className = 'tag';
    el('h2', routine.title, card); el('p', routine.purpose, card);
    const inputs = Object.create(null);
    for (const match of routine.template.matchAll(/\{\{([a-z][a-z0-9_]{0,31})\}\}/g)) {
      if (!inputs[match[1]]) inputs[match[1]] = field(card, match[1].replaceAll('_', ' '), '');
    }
    const preview = el('pre', routine.template, card);
    const update = () => { preview.textContent = routine.template.replace(/\{\{([a-z][a-z0-9_]{0,31})\}\}/g,
      (_, slot) => inputs[slot].value || '{{' + slot + '}}'); };
    Object.values(inputs).forEach(input => input.oninput = update);
    const actions = el('div', undefined, card); actions.className = 'actions';
    button(actions, 'Edit', () => editor(routine));
    button(actions, 'Dismiss', async () => { await api({ action: 'dismiss', id: routine.id }); await load(); });
    if (routine.status === 'suggested') {
      button(actions, 'Keep this routine', async () => { await api({ action: 'save', ...routine }); await load(); });
    } else {
      // A lost response keeps the same immutable request for the next click.
      let pending = null;
      button(actions, 'Run with Flyd', async () => {
        pending ??= { action: 'run', id: routine.id, revision: routine.revision, session,
          requestId: crypto.randomUUID(), inputs: Object.fromEntries(Object.entries(inputs).map(([key, input]) => [key, input.value])) };
        const result = await api(pending);
        status.textContent = result.run.status === 'submitted'
          ? 'Request submitted. Open the conversation for its answer.'
          : 'Submission uncertain. Check the conversation before starting another run.';
        await load();
      });
    }
  }
  const runs = document.getElementById('runs'); runs.replaceChildren();
  for (const run of state.runs) {
    const card = el('article', undefined, runs);
    el('span', run.status === 'dispatching' ? 'Submission interrupted or still in progress' : run.status, card);
    el('pre', run.text, card);
    const link = el('a', 'Open conversation', card); link.href = '/?session=' + encodeURIComponent(run.session);
  }
}
async function load() { state = await api(); show(); }
document.getElementById('new').onclick = () => editor();
document.getElementById('toggle').onclick = async () => {
  try { await api({ action: 'enabled', enabled: !state.enabled }); await load(); }
  catch (error) { status.textContent = error.message; }
};
document.getElementById('erase').onclick = async () => {
  if (!confirm('Forget all routine suggestions, definitions and run records?')) return;
  try { await api({ action: 'erase' }); await load(); } catch (error) { status.textContent = error.message; }
};
load().catch(error => status.textContent = error.message);
`;

/** Core-owned controls. Stored requests only enter textContent/value, never HTML. */
export function renderRoutinesPage(token: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Flyd · Routines</title><style>${BASE_STYLE}
body{font-size:17px}main{max-width:860px;margin:48px auto;padding:0 24px}
h1{font-size:44px;letter-spacing:-.04em;line-height:1.1}p{color:var(--muted)}
article{background:var(--tint);border-radius:16px;padding:24px;margin:20px 0;transition:opacity .2s}
label{display:block;color:var(--muted);font-size:14px;margin-top:14px}
input,textarea{display:block;width:100%;padding:12px;margin:6px 0 12px;background:var(--bg);color:var(--fg);border:1px solid var(--faint);border-radius:8px;font:inherit}
textarea{min-height:100px}button,a{color:var(--accent);background:none;border:0;font:inherit;cursor:pointer;margin-right:16px}
button:disabled{opacity:.5;cursor:default}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:inherit}
#status{min-height:28px;color:var(--accent)}.actions{display:flex;flex-wrap:wrap;gap:12px}.tag{font-size:13px;color:var(--accent)}
@media(prefers-reduced-motion:reduce){article{transition:none}}
</style></head><body><header><a href="/">Flyd</a><span>Routines</span></header><main>
<h1>Less repeating.<br>More doing.</h1>
<p>Keep a useful request as an editable artefact. Repeated requests can suggest one; you decide what to keep. Running it asks Flyd through the usual conversation.</p>
<div class="actions"><button id="new">Create a routine</button><button id="toggle"></button><button id="erase">Forget routine data</button></div>
<p id="status" role="status"></p><section id="cards"></section><h2>Recent runs</h2>
<p>Submitted means Flyd received the request. Its answer and outcome remain in the conversation. An interrupted submission is never retried automatically.</p>
<section id="runs"></section></main><script>const TOKEN=${JSON.stringify(token).replace(/</g, "\\u003c")};${CLIENT}</script></body></html>`;
}
