import { escapeHtml } from "../markdown.js";
import { LEFT_BUTTON, LEFT_HTML, LEFT_PREFERENCE } from "../left-column.js";
import { FRONT_HTML } from "./front-markup.js";

export interface PageOptions { assistantLabel: string; sendToken?: string; newSession?: string; workCanvas?: boolean }

/** The page's markup: header, preferences, columns, stream and message box. */
export function pageMarkup(options: PageOptions, style: string, script: string): string {
  const label = escapeHtml(options.assistantLabel);
  const token = (options.sendToken ? ` data-send-token="${escapeHtml(options.sendToken)}"` : "")
    + (options.newSession ? ` data-new-session="${escapeHtml(options.newSession)}"` : "");
  return `<!doctype html>
<html lang="en" data-theme="light" data-layout="front">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${label}</title>
<style>${style}</style>
</head>
<body${token}${options.workCanvas ? ' data-work-canvas="1"' : ""}>
<header>
  <span class="who">${label}</span>
  <span class="front-date" id="front-date"></span>
  <nav class="centre-tabs" id="centre-tabs" aria-label="The conversation, news, the week or machines"><button type="button" class="ctab" data-centre="talk" aria-pressed="true">Conversation</button><button type="button" class="ctab" data-centre="news" aria-pressed="false">News<span class="fdot news-dot" id="news-dot" hidden aria-label="new stories"></span></button><button type="button" class="ctab" data-centre="week" aria-pressed="false">Week</button><button type="button" class="ctab" data-centre="machines" aria-pressed="false">Machines</button></nav>
  <span class="project-badge" id="project-badge" hidden></span>
  <span class="picker" id="conversation-title" aria-label="Current conversation"></span>
  <a class="article-back" id="article-back" hidden target="_blank" rel="noopener noreferrer"></a>
  <a class="site" id="site" hidden target="_blank" rel="noopener noreferrer"><span class="site-kind" id="site-kind"></span><span class="site-host" id="site-host"></span><span class="site-path" id="site-path"></span></a>
  <span class="when" id="when"></span>
  <span class="controls">
    ${LEFT_BUTTON}${options.workCanvas ? '<a href="/work" style="font-size:12px;color:var(--muted);text-decoration:none;padding:0 8px">work</a>' : ""}<a href="/whatsapp" style="font-size:12px;color:var(--muted);text-decoration:none;padding:0 8px">people</a><button id="tv-flip" type="button" role="switch" aria-checked="false">Artefacts</button><button id="prefs-open" type="button" aria-haspopup="dialog" aria-expanded="false" aria-controls="prefs">preferences</button>
  </span>
</header>
<section class="tv" id="tv" hidden aria-label="Artefacts"><div class="tv-stage" id="tv-stage" aria-live="polite"></div></section>
<div class="prefs" id="prefs" hidden role="dialog" aria-modal="true" aria-label="Preferences">
  <div class="prefs-page">
  <div class="prefs-top"><p class="prefs-title">Preferences</p><button id="prefs-close" type="button" aria-label="Close preferences">Done</button></div>
  <button id="mode" type="button" role="switch" aria-checked="false"><span class="prefs-words"><span class="prefs-name">Full replies</span><span class="prefs-about">Every reply as written, not Flyd's reading</span></span><span class="track" aria-hidden="true"></span></button>
  <button id="theme" type="button" role="switch" aria-checked="false"><span class="prefs-words"><span class="prefs-name">Light theme</span><span class="prefs-about">Dark when off</span></span><span class="track" aria-hidden="true"></span></button>
  <button id="rail-toggle" type="button" role="switch" aria-checked="true"><span class="prefs-words"><span class="prefs-name">Right column</span><span class="prefs-about">Past conversations and finished work</span></span><span class="track" aria-hidden="true"></span></button>
  ${LEFT_PREFERENCE}
  <button id="preparation-link" type="button"><span class="prefs-words"><span class="prefs-name">Local preparation</span><span class="prefs-about">Review drafts and stop preparation</span></span><span class="prefs-go" aria-hidden="true">→</span></button>
  <button id="routines-link" type="button"><span class="prefs-words"><span class="prefs-name">Routines</span><span class="prefs-about">Useful requests, ready to use again</span></span><span class="prefs-go" aria-hidden="true">→</span></button>
  <button id="taste-link" type="button"><span class="prefs-words"><span class="prefs-name">Taste</span><span class="prefs-about">What Flyd knows about your taste</span></span><span class="prefs-go" aria-hidden="true">→</span></button>
  </div>
</div>
${LEFT_HTML}
${FRONT_HTML}
<aside class="rail" id="rail" hidden aria-label="Conversation history and done work">
  <button class="rail-hide" id="rail-hide" type="button" aria-label="Hide the column">✕</button>
  <div class="rail-pane">
  <section class="fresh-news" id="fresh-news-arts" data-fresh hidden aria-label="Newest stories"></section>
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
  <div class="article-starters" id="article-starters" hidden></div>
  <div class="working" id="working" hidden aria-label="${label} is working"><span class="dots"><i></i><i></i><i></i></span></div>
</main>
<button class="jump" id="jump" type="button" hidden>↓ new</button>
<div class="lightbox" id="lightbox" hidden role="dialog" aria-label="Image"><button class="lightbox-nav lightbox-prev" type="button" aria-label="Previous image">‹</button><img id="lightbox-img" alt=""><button class="lightbox-nav lightbox-next" type="button" aria-label="Next image">›</button></div>
<div class="problem" id="problem"></div>
<a id="routine-suggestion" href="/routines" hidden style="position:fixed;bottom:150px;right:24px;font-size:14px;color:var(--accent);padding:12px;background:var(--tint);border-radius:12px">Keep this repeated request as a routine →</a>
<form class="composer" id="composer" hidden autocomplete="off">
  <div class="row">
    <p class="unread" id="staff" role="status" hidden></p>
    <ul class="commands" id="commands" role="listbox" aria-label="Skills and commands" hidden></ul>
    <p class="notice" id="notice" role="status" aria-live="polite" hidden></p>
    <div class="attachments" id="attachments" hidden></div>
    <div class="article-confirm" id="article-confirm" hidden>
      <p id="article-confirm-q"></p>
      <button type="button" id="article-confirm-yes">Remember</button>
      <button type="button" id="article-confirm-no">Not now</button>
    </div>
    <div class="scope-line"><button class="scope" id="scope" type="button" aria-haspopup="listbox" aria-expanded="false" aria-controls="scope-menu"><span id="scope-name">Project</span></button><ul class="scope-menu" id="scope-menu" role="listbox" aria-label="Where this message goes" hidden></ul></div>
    <div class="field">
      <div class="replying" id="replying" hidden><p class="replying-to">Replying to <span id="replying-title"></span></p><button class="replying-clear" type="button" id="replying-clear" aria-label="Stop replying to this">✕</button></div>
      <button class="attach" id="attach" type="button" aria-label="Attach images or documents" title="Attach images or documents">+</button>
      <input type="file" id="attach-input" multiple hidden tabindex="-1">
      <span class="story-chip" id="story-chip" hidden><span class="story-chip-name" id="story-chip-name"></span><button type="button" id="story-chip-clear" aria-label="Stop asking about this story">✕</button></span>
      <div class="typing">
        <div class="prediction-layer" id="prediction-layer" aria-hidden="true" hidden><span class="prediction-prefix" id="prediction-prefix"></span><span class="prediction-suffix" id="prediction-suffix"></span></div>
        <textarea id="input" rows="1" placeholder="Message" aria-label="Message"></textarea>
      </div>
      <span class="voice-wait" id="voice-wait" role="status" hidden><span class="spokes" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></span><span class="voice-wait-said" id="voice-wait-said"></span></span>
      <button class="prediction-toggle" id="prediction-toggle" type="button" aria-label="Toggle typing suggestions" aria-pressed="true">↹</button>
      <button id="send" type="submit" disabled aria-label="Send message">Send</button>
    </div>
    <div class="hint" id="usage"></div>
  </div>
</form>
<script>${script}</script>
</body>
</html>`;
}
