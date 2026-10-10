import type { Project } from "../council/projects.js";
import type { TasteProfile, TasteRule } from "../council/taste.js";
import { planTasteSkills, type TasteSkill } from "../council/taste-skills.js";
import { escapeHtml } from "./markdown.js";
import { BASE_STYLE } from "./page.js";

// "Your taste": the signal first. What leads is what Flyd actually tells every
// agent — George's principles and the skills compiled from TASTE.md, in his
// own words, with when each loads — then each project's own rules, short.
// Everything else (rules seen once, rules about how work is done rather than
// how it looks, retired and vetoed ones) waits behind one quiet control. Any
// rule can be reworded or vetoed ("not me"); a veto is never learned again.

const STYLE = BASE_STYLE + `
main { max-width: 34em; margin: 0 auto; padding: 2.2em 1.5em 24vh; font-size: 19px; line-height: 1.55; }
h1 { font: 600 1.9em/1.15 var(--sans); color: var(--strong); margin: 0.4em 0 0.5em; letter-spacing: -0.02em; }
.lede { color: var(--muted); margin: 0 0 3.2em; max-width: 30em; }
section { margin: 0 0 3.6em; }
h2 { font: 600 1.25em/1.25 var(--sans); color: var(--strong); margin: 0 0 0.35em; letter-spacing: -0.01em; }
h3 { font: 500 0.82em/1.3 var(--sans); color: var(--accent); margin: 2.2em 0 0.9em; }
.loads { color: var(--muted); font-size: 0.86em; margin: 0 0 1.4em; }
.loads code { font: 0.86em var(--mono); color: var(--muted); }
.rule { margin: 0 0 1.9em; }
.rule p { margin: 0; }
.rule .text { color: var(--strong); outline: none; border-radius: 4px; }
.rule .text[contenteditable="true"] { background: var(--tint); padding: 0 0.2em; }
.principle .text { font-size: 1.12em; line-height: 1.4; letter-spacing: -0.005em; }
.rule .said { margin: 0.4em 0 0; color: var(--muted); font-size: 0.84em; line-height: 1.5; }
.rule .said q { quotes: "“" "”"; }
.rule .said .where { margin-left: 0.4em; font-size: 0.9em; opacity: 0.8; }
.rule .seen { color: var(--muted); font-size: 0.8em; margin-left: 0.5em; white-space: nowrap; }
.rule .actions { display: flex; gap: 16px; margin-top: 0.3em; opacity: 0.35; transition: opacity 160ms ease; }
.rule:hover .actions, .rule:focus-within .actions { opacity: 1; }
.rule button { font: 500 12.5px/1.4 var(--mono); color: var(--muted); background: none; border: 0; padding: 2px 0; cursor: pointer; }
.rule button:hover { color: var(--fg); }
.rule button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.project .rule { margin-bottom: 1.2em; }
details.rest { margin-top: 4.4em; color: var(--muted); }
details.rest > summary { cursor: pointer; list-style: none; font: 500 14px/1.4 var(--mono); color: var(--muted); }
details.rest > summary::-webkit-details-marker { display: none; }
details.rest > summary::before { content: "+ "; }
details.rest[open] > summary::before { content: "– "; }
details.rest > summary:hover { color: var(--fg); }
details.rest .why { font-size: 0.86em; margin: 1.2em 0 0; }
details.rest .rule .text { color: var(--fg); font-size: 0.92em; }
.vetoed .text { color: var(--muted); text-decoration: line-through; text-decoration-color: var(--faint); }
.none { color: var(--muted); }
`;

const SCRIPT = `
(function () {
  var token = document.body.dataset.token || "";
  function post(body) {
    return fetch("/api/taste", { method: "POST", headers: { "content-type": "application/json", "x-flyd-view-token": token }, body: JSON.stringify(body) })
      .then(function (res) { if (!res.ok) throw new Error(String(res.status)); location.reload(); });
  }
  document.getElementById("back").addEventListener("click", function () { location.href = "/"; });
  var rest = document.querySelector("details.rest");
  try { if (rest && sessionStorage.getItem("flyd-taste-rest") === "open") rest.open = true; } catch (e) {}
  if (rest) rest.addEventListener("toggle", function () { try { sessionStorage.setItem("flyd-taste-rest", rest.open ? "open" : ""); } catch (e) {} });
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

type Status = "active" | "vetoed" | "retired";

function shortDate(date: string): string {
  const parsed = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!parsed) return date;
  const month = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(parsed[2]) - 1];
  return `${Number(parsed[3])} ${month} ${parsed[1]}`;
}

function ruleHtml(rule: TasteRule, names: Record<string, string>, options: { status?: Status; quote?: boolean; seen?: boolean } = {}): string {
  const status = options.status ?? "active";
  const said = options.quote === false ? undefined : rule.evidence[0];
  const where = said ? [said.source, said.project ? names[said.project] ?? said.project : "", shortDate(said.date)].filter(Boolean).join(" · ") : "";
  const seen = !options.seen ? "" : rule.count === 0 ? "your words" : rule.count === 1 ? "once" : `${rule.count}×`;
  const actions = status === "active"
    ? `<button type="button" data-action="edit">reword</button><button type="button" data-action="veto">not me</button>`
    : `${status === "retired" ? `<button type="button" data-action="edit">reword</button>` : ""}<button type="button" data-action="restore">it is me</button>`;
  const classes = ["rule", rule.principle ? "principle" : "", status === "active" ? "" : status].filter(Boolean).join(" ");
  return `<div class="${classes}" data-id="${escapeHtml(rule.id)}">
  <p><span class="text">${escapeHtml(rule.text)}</span>${seen ? `<span class="seen">${escapeHtml(seen)}</span>` : ""}</p>
  ${said ? `<p class="said"><q>${escapeHtml(said.quote)}</q><span class="where">${escapeHtml(where)}</span></p>` : ""}
  <div class="actions">${actions}</div>
</div>`;
}

const SKILL_HEADINGS: Record<string, string> = { interface: "How a screen should feel", spacing: "Spacing and balance" };

function georgeHtml(skills: TasteSkill[], names: Record<string, string>): string {
  const wide = skills.filter((skill) => skill.kind !== "project");
  if (!wide.length) return "";
  return `<section class="you">
  <h2>You, everywhere</h2>
  <p class="loads">Every agent loads these before it touches a screen, layout or stylesheet, in any of your projects: ${wide.map((skill) => `<code>${escapeHtml(skill.name)}</code>`).join(" and ")}.</p>
  ${wide.map((skill) => `<h3>${escapeHtml(SKILL_HEADINGS[skill.kind] ?? skill.title)}</h3>
  ${[...skill.principles, ...skill.rules].map((rule) => ruleHtml(rule, names)).join("\n")}`).join("\n")}
</section>`;
}

function projectHtml(skill: TasteSkill, names: Record<string, string>): string {
  return `<section class="project">
  <h2>${escapeHtml(names[skill.project!] ?? skill.project!)}</h2>
  <p class="loads">${escapeHtml(skill.when)} Never anywhere else.</p>
  ${[...skill.principles, ...skill.rules].map((rule) => ruleHtml(rule, names, { quote: false, seen: true })).join("\n")}
</section>`;
}

function restHtml(profile: TasteProfile, shown: Set<string>): string {
  const rest = profile.rules.filter((rule) => !shown.has(rule.id));
  const groups = [
    ["You, everywhere", rest.filter((rule) => rule.scope === "personal")] as const,
    ...[...new Set(rest.filter((rule) => rule.scope !== "personal").map((rule) => rule.scope))]
      .sort((a, b) => (profile.names[a] ?? a).localeCompare(profile.names[b] ?? b))
      .map((id) => [profile.names[id] ?? id, rest.filter((rule) => rule.scope === id)] as const),
  ];
  const retired = profile.retired ?? [];
  const total = rest.length + retired.length + profile.vetoed.length;
  if (!total) return "";
  const list = (rules: readonly TasteRule[], status?: Status) => rules.map((rule) => ruleHtml(rule, profile.names, { status, seen: true })).join("\n");
  return `<details class="rest">
  <summary>everything else · ${total}</summary>
  <p class="why">Rules I've seen only once, ones past the strongest few on each list, rules about how work gets done rather than how it looks, ones I set aside as too generic, and ones you said aren't you. Agents aren't told these. Say something twice and it moves up.</p>
  ${groups.filter(([, rules]) => rules.length).map(([title, rules]) => `<h3>${escapeHtml(title)}</h3>\n${list(rules)}`).join("\n")}
  ${retired.length ? `<h3>Set aside as too generic</h3>\n${list(retired, "retired")}` : ""}
  ${profile.vetoed.length ? `<h3>Not you</h3>\n${list(profile.vetoed, "vetoed")}` : ""}
</details>`;
}

export function renderTastePage(profile: TasteProfile, options: { token: string; projects?: Project[] }): string {
  const skills = planTasteSkills(profile, options.projects ?? []);
  const shown = new Set(skills.flatMap((skill) => [...skill.principles, ...skill.rules].map((rule) => rule.id)));
  const body = [
    georgeHtml(skills, profile.names),
    ...skills.filter((skill) => skill.kind === "project").map((skill) => projectHtml(skill, profile.names)),
    restHtml(profile, shown),
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
  <h1>Your taste</h1>
  <p class="lede">What I've learned from how you correct, turn down and approve work, in your own words, and what I tell every agent before it touches a screen. Reword anything, or say “not me” and I'll drop it for good.</p>
  ${body || `<p class="none">Nothing learned yet. I learn as you work.</p>`}
</main>
<script>${SCRIPT}</script>
</body>
</html>`;
}
