import { escapeHtml } from "../markdown.js";
import { LEFT_BUTTON, LEFT_HTML, LEFT_PREFERENCE } from "../left-column.js";

export interface PageOptions { assistantLabel: string; sendToken?: string; newSession?: string }

/** The page's markup: header, preferences, columns, stream, artefact view and message box. */
export function pageMarkup(options: PageOptions, style: string, script: string): string {
  const label = escapeHtml(options.assistantLabel);
  const token = (options.sendToken ? ` data-send-token="${escapeHtml(options.sendToken)}"` : "")
    + (options.newSession ? ` data-new-session="${escapeHtml(options.newSession)}"` : "");
  return `<!doctype html>
<html lang="en" data-theme="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${label}</title>
<style>${style}</style>
</head>
<body${token}>
<header>
  <span class="who">${label}</span>
  <span class="project-badge" id="project-badge" hidden></span>
  <span class="picker" id="conversation-title" aria-label="Current conversation"></span>
  <span class="air" id="air">standby</span>
  <a class="site" id="site" hidden target="_blank" rel="noopener noreferrer"><span class="site-kind" id="site-kind"></span><span class="site-host" id="site-host"></span><span class="site-path" id="site-path"></span></a>
  <span class="when" id="when"></span>
  <span class="controls">
    ${LEFT_BUTTON}<a href="/whatsapp" style="font-size:12px;color:var(--muted);text-decoration:none;padding:0 8px">people</a><button id="prefs-open" type="button" aria-haspopup="dialog" aria-expanded="false" aria-controls="prefs">preferences</button>
    <button id="flip" type="button" role="switch" aria-checked="false" aria-label="Artefact view">artefact<span class="track" aria-hidden="true"></span></button>
  </span>
</header>
<div class="prefs" id="prefs" hidden role="dialog" aria-label="Preferences">
  <p class="prefs-title">Preferences</p>
  <button id="mode" type="button" role="switch" aria-checked="false"><span class="prefs-words"><span class="prefs-name">Full replies</span><span class="prefs-about">Every reply as written, not Flyd's reading</span></span><span class="track" aria-hidden="true"></span></button>
  <button id="theme" type="button" role="switch" aria-checked="false"><span class="prefs-words"><span class="prefs-name">Light theme</span><span class="prefs-about">Dark when off</span></span><span class="track" aria-hidden="true"></span></button>
  <button id="rail-toggle" type="button" role="switch" aria-checked="true"><span class="prefs-words"><span class="prefs-name">Right column</span><span class="prefs-about">Past conversations and finished work</span></span><span class="track" aria-hidden="true"></span></button>
  ${LEFT_PREFERENCE}
  <button id="preparation-link" type="button"><span class="prefs-words"><span class="prefs-name">Local preparation</span><span class="prefs-about">Review drafts and stop preparation</span></span><span class="prefs-go" aria-hidden="true">→</span></button>
  <button id="routines-link" type="button"><span class="prefs-words"><span class="prefs-name">Routines</span><span class="prefs-about">Useful requests, ready to use again</span></span><span class="prefs-go" aria-hidden="true">→</span></button>
  <button id="taste-link" type="button"><span class="prefs-words"><span class="prefs-name">Taste</span><span class="prefs-about">What Flyd knows about your taste</span></span><span class="prefs-go" aria-hidden="true">→</span></button>
</div>
${LEFT_HTML}
<aside class="rail" id="rail" hidden aria-label="Conversation history and done work">
  <button class="rail-hide" id="rail-hide" type="button" aria-label="Hide the column">✕</button>
  <div class="rail-pane">
  <div class="brief" id="brief" hidden>
    <section class="brief-list" id="notices" hidden aria-label="Notices"></section>
    <section class="brief-list artefacts" id="artefacts" hidden aria-label="Artefacts"></section>
    <section class="brief-list" id="done" hidden aria-label="Done"></section>
  </div>
  <section class="history" id="history" hidden aria-label="Past conversations"><div class="history-top"><h2 class="history-title">History</h2></div><div id="history-list"></div></section>
  <div class="brief brief-news" id="brief-news" hidden>
    <section class="brief-list news" id="news" hidden aria-label="News"></section>
  </div>
  </div>
</aside>
<main id="stream" aria-live="polite">
  <p class="empty" id="empty" hidden>Nothing said yet.</p>
  <div class="working" id="working" hidden aria-label="${label} is working"><span class="dots"><i></i><i></i><i></i></span></div>
  <section class="inline-screen" id="inline-screen" hidden aria-label="The artefact"></section>
</main>
<button class="jump" id="jump" type="button" hidden>↓ new</button>
<div class="lightbox" id="lightbox" hidden role="dialog" aria-label="Image"><button class="lightbox-nav lightbox-prev" type="button" aria-label="Previous image">‹</button><img id="lightbox-img" alt=""><button class="lightbox-nav lightbox-next" type="button" aria-label="Next image">›</button></div>
<div class="problem" id="problem"></div>
<a id="routine-suggestion" href="/routines" hidden style="position:fixed;bottom:150px;right:24px;font-size:14px;color:var(--accent);padding:12px;background:var(--tint);border-radius:12px">Keep this repeated request as a routine →</a>
<section class="show" id="show" hidden aria-label="Flyd's artefact: what it thinks you need to see">
  <div class="tv">
    <div class="scene" id="scene" aria-live="polite">
      <div class="scene-text">
        <h1 class="scene-head" id="scene-head"></h1>
        <p class="scene-line" id="scene-line"></p>
        <div class="scene-meta" id="scene-meta"></div>
      </div>
    </div>
  </div>
  <div class="ticks" id="ticks" aria-label="Flyd's scenes" hidden></div>
  <nav class="semantic-context" id="semantic-context" aria-label="Other work"></nav>
  <div class="readouts" id="readouts" aria-label="Readouts"></div>
  <div class="calls" id="calls" hidden role="dialog" aria-modal="true" aria-labelledby="calls-title">
    <div class="calls-sheet" tabindex="-1">
      <div class="calls-top"><h2 id="calls-title">Your decisions</h2><button id="calls-close" type="button" aria-label="Close">✕</button></div>
      <ol class="calls-list" id="calls-list"></ol>
    </div>
  </div>
  <div class="drill" id="drill" hidden role="dialog" aria-modal="true" aria-labelledby="drill-title">
    <div class="drill-sheet" tabindex="-1">
      <div class="drill-top"><h2 id="drill-title"></h2><button id="drill-close" type="button" aria-label="Close">✕</button></div>
      <ul class="drill-list" id="drill-list"></ul>
    </div>
  </div>
  <div class="foot"><p class="doing" id="show-doing">Standby</p><span id="show-nav" hidden><button class="show-nav" id="show-prev" type="button" aria-label="Previous card">←</button><button class="show-nav" id="show-next" type="button" aria-label="Next card">→</button></span></div>
</section>
<form class="composer" id="composer" hidden autocomplete="off">
  <div class="row">
    <p class="unread" id="staff" role="status" hidden></p>
    <ul class="commands" id="commands" role="listbox" aria-label="Skills and commands" hidden></ul>
    <section class="about" id="about" aria-label="What this message is about" hidden><button class="about-clear" type="button" id="about-clear" aria-label="Not about this">✕</button><div class="about-head" id="about-head"></div><p class="about-title" id="about-title"></p><div id="about-body"></div></section>
    <p class="notice" id="notice" role="status" aria-live="polite" hidden></p>
    <div class="attachments" id="attachments" hidden></div>
    <div class="field">
      <div class="typing">
        <div class="prediction-layer" id="prediction-layer" aria-hidden="true" hidden><span class="prediction-prefix" id="prediction-prefix"></span><span class="prediction-suffix" id="prediction-suffix"></span></div>
        <textarea id="input" rows="1" placeholder="Message ${label}" aria-label="Message ${label}"></textarea>
      </div>
      <button class="prediction-toggle" id="prediction-toggle" type="button" aria-label="Toggle typing suggestions" aria-pressed="true">↹</button>
      <button id="send" type="submit" disabled aria-label="Send to ${label}">AHOY</button>
    </div>
    <div class="hint" id="usage"></div>
  </div>
</form>
<script>${script}</script>
</body>
</html>`;
}
