import type { TasteProfile, TasteRule } from "../council/taste.js";
import { escapeHtml } from "./markdown.js";
import { BASE_STYLE } from "./page.js";

// "What I know about George": Flyd's learned taste, shown with its homework
// (the words that taught each rule, where and when), so he can reword a rule
// or veto it ("not me"). Vetoed rules are never learned again. The file
// behind it, TASTE.md, stays his to edit by hand too.

const STYLE = BASE_STYLE + `
main { max-width: 38em; margin: 0 auto; padding: 1.2em 1.5em 20vh; font-size: 19px; }
h1 { font: 600 1.5em/1.25 var(--sans); color: var(--strong); margin: 0.6em 0 0.2em; letter-spacing: -0.01em; }
.lede { color: var(--muted); margin: 0 0 1.6em; }
h2 { font: 500 13px/1 var(--mono); letter-spacing: 0.08em; text-transform: uppercase; color: var(--accent); margin: 2.4em 0 0.8em; }
.rule { padding: 0.75em 0; border-top: 1px solid var(--faint); }
.rule .text { color: var(--strong); outline: none; border-radius: 4px; }
.rule .text[contenteditable="true"] { background: var(--tint); padding: 0 0.2em; }
.rule .meta { font: 13px/1.5 var(--mono); color: var(--muted); margin-top: 0.25em; }
.rule .why { margin: 0.35em 0 0; padding: 0; list-style: none; font-size: 0.82em; color: var(--muted); }
.rule .why li::before { content: "“"; } .rule .why li .q::after { content: "”"; }
.rule .why .where { font: 12px var(--mono); margin-left: 0.5em; }
.rule .actions { display: flex; gap: 12px; margin-top: 0.35em; }
.rule button { font: 500 12.5px/1.4 var(--mono); color: var(--muted); background: none; border: 0; padding: 2px 0; cursor: pointer; }
.rule button:hover { color: var(--fg); }
.vetoed .text { color: var(--muted); text-decoration: line-through; text-decoration-color: var(--faint); }
.retired { opacity: 0.72; }
.none { color: var(--muted); font-size: 0.9em; }
`;

const SCRIPT = `
(function () {
  var token = document.body.dataset.token || "";
  function post(body) {
    return fetch("/api/taste", { method: "POST", headers: { "content-type": "application/json", "x-flyd-view-token": token }, body: JSON.stringify(body) })
      .then(function (res) { if (!res.ok) throw new Error(String(res.status)); location.reload(); });
  }
  document.getElementById("back").addEventListener("click", function () { location.href = "/"; });
  document.querySelectorAll(".rule").forEach(function (rule) {
    var id = rule.dataset.id;
    var text = rule.querySelector(".text");
    rule.querySelectorAll("button").forEach(function (button) {
      button.addEventListener("click", function () {
        var action = button.dataset.action;
        if (action === "edit") {
          text.contentEditable = "true";
          text.focus();
          button.textContent = "save";
          button.dataset.action = "save";
          return;
        }
        if (action === "save") { post({ action: "reword", id: id, text: text.textContent }); return; }
        post({ action: action, id: id });
      });
    });
    text.addEventListener("keydown", function (event) {
      if (event.key === "Enter") { event.preventDefault(); post({ action: "reword", id: id, text: text.textContent }); }
      if (event.key === "Escape") location.reload();
    });
  });
})();
`;

function ruleHtml(rule: TasteRule, names: Record<string, string>, status: "active" | "vetoed" | "retired"): string {
  const seen = rule.count === 0 ? "you wrote this"
    : rule.count === 1 ? `seen once${rule.last ? `, last ${rule.last}` : ""} — tentative`
      : `seen ${rule.count}×${rule.last ? `, last ${rule.last}` : ""}`;
  const across = rule.projects.length > 1 ? ` · in ${rule.projects.map((id) => names[id] ?? id).join(", ")}` : "";
  const why = rule.evidence.map((item) =>
    `<li><span class="q">${escapeHtml(item.quote)}</span><span class="where">${escapeHtml([item.source, item.project ? names[item.project] ?? item.project : "", item.date].filter(Boolean).join(" · "))}</span></li>`).join("");
  const actions = status === "vetoed" || status === "retired"
    ? `<button type="button" data-action="restore">it is me</button>`
    : `<button type="button" data-action="edit">reword</button><button type="button" data-action="veto">not me</button>`;
  const reword = status === "retired" ? `<button type="button" data-action="edit">reword</button>` : "";
  return `<div class="rule${status === "vetoed" ? " vetoed" : status === "retired" ? " retired" : ""}" data-id="${escapeHtml(rule.id)}">
  <div class="text">${escapeHtml(rule.text)}</div>
  <div class="meta">${escapeHtml(seen + across)}</div>
  ${why ? `<ul class="why">${why}</ul>` : ""}
  <div class="actions">${reword}${actions}</div>
</div>`;
}

export function renderTastePage(profile: TasteProfile, options: { token: string }): string {
  const section = (title: string, rules: TasteRule[], status: "active" | "vetoed" | "retired" = "active") =>
    rules.length ? `<h2>${escapeHtml(title)}</h2>\n${rules.map((rule) => ruleHtml(rule, profile.names, status)).join("\n")}` : "";
  const projects = [...new Set(profile.rules.filter((rule) => rule.scope !== "personal").map((rule) => rule.scope))];
  const body = [
    section("Everywhere", profile.rules.filter((rule) => rule.scope === "personal")),
    ...projects.map((id) => section(profile.names[id] ?? id, profile.rules.filter((rule) => rule.scope === id))),
    section("Retired", profile.retired ?? [], "retired"),
    section("Not me", profile.vetoed, "vetoed"),
  ].filter(Boolean).join("\n");
  return `<!doctype html>
<html lang="en" data-theme="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Your taste</title>
<style>${STYLE}</style>
<script>try { if (localStorage.getItem("flyd-view-theme") === "light") document.documentElement.setAttribute("data-theme", "light"); } catch (e) {}</script>
</head>
<body data-token="${escapeHtml(options.token)}">
<header><span class="who">taste</span><span class="picker"></span><button id="back" type="button">conversation</button></header>
<main>
  <h1>What I know about your taste</h1>
  <p class="lede">Learned from how you correct, turn down and approve work, with the words that taught each rule. Reword anything, or say “not me” and I won't learn it again.</p>
  ${body || `<p class="none">Nothing learned yet. I learn as you work.</p>`}
</main>
<script>${SCRIPT}</script>
</body>
</html>`;
}
