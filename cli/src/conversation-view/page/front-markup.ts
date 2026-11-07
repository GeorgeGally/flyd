/**
 * The front page's own places: the right column's tabs, the jobs list and the
 * project threads (the page's artefact column #rail is the third), the open job's
 * heading and the open job. The conversation itself (#stream and the message
 * box) is the page's own and sits in the middle, on the paper. The News tab
 * has its own two places and the weather icons.
 */
export const FRONT_HTML = `<nav class="rtabs" id="rtabs" aria-label="Right column"><button type="button" class="rtab" data-rtab="jobs" aria-pressed="false">Jobs<span class="fdot" id="rtab-dot" hidden aria-label="something needs you"></span></button><button type="button" class="rtab" data-rtab="threads" aria-pressed="false">Projects<span class="thread-dot" id="rtab-threads-dot" hidden aria-label="something unread"></span></button><button type="button" class="rtab" data-rtab="arts" aria-pressed="false">Artefacts</button></nav>
<aside class="jobs" id="jobs" aria-label="Jobs"><div id="jobs-list"></div></aside>
<aside class="threads" id="threads" aria-label="Projects"></aside>
<div class="stage-head" id="stage-head"><button type="button" class="stage-back" id="stage-back">Back to the conversation</button><p class="crumb" id="stage-crumb"></p><h1 id="stage-title"></h1></div>
<section class="job-view" id="job-view" aria-label="The open job"></section>
<aside class="desk-side" id="desk-side" aria-label="Weather and horoscope"></aside>
<section class="desk-news" id="desk-news" aria-label="News"></section>
<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>
<path id="wx-c" d="M6.8 18.5a4.3 4.3 0 0 1-.6-8.55 5.6 5.6 0 0 1 10.9-.9 4.75 4.75 0 0 1 .1 9.45z"/>
<symbol id="wx-sun" viewBox="0 0 24 24"><g stroke="#f0ae2c" stroke-width="2" stroke-linecap="round"><path d="M12 2.5v2.4M12 19.1v2.4M2.5 12h2.4M19.1 12h2.4M5.3 5.3 7 7M17 17l1.7 1.7M5.3 18.7 7 17M17 7l1.7-1.7"/></g><circle cx="12" cy="12" r="4.8" fill="#f0ae2c"/></symbol>
<symbol id="wx-moon" viewBox="0 0 24 24"><path d="M19.5 14.6A8 8 0 0 1 9.4 4.5a8 8 0 1 0 10.1 10.1z" fill="#8f94a8"/></symbol>
<symbol id="wx-few" viewBox="0 0 24 24"><circle cx="15.5" cy="8.5" r="4.6" fill="#f0ae2c"/><use href="#wx-c" fill="#c3c2bc" transform="translate(-1.5 3) scale(.9)"/></symbol>
<symbol id="wx-cloud" viewBox="0 0 24 24"><use href="#wx-c" fill="#b4b3ad" transform="translate(0 -1)"/></symbol>
<symbol id="wx-rain" viewBox="0 0 24 24"><use href="#wx-c" fill="#b4b3ad" transform="translate(1.2 -1.4) scale(.9)"/><path d="M8.5 18.2l-1.2 3M12.6 18.2l-1.2 3M16.7 18.2l-1.2 3" stroke="#3f86cf" stroke-width="2" stroke-linecap="round"/></symbol>
<symbol id="wx-snow" viewBox="0 0 24 24"><use href="#wx-c" fill="#b4b3ad" transform="translate(1.2 -1.4) scale(.9)"/><g fill="#9cc3e6"><circle cx="8" cy="20" r="1.3"/><circle cx="12.5" cy="20" r="1.3"/><circle cx="17" cy="20" r="1.3"/></g></symbol>
<symbol id="wx-storm" viewBox="0 0 24 24"><use href="#wx-c" fill="#8f8e88" transform="translate(1.2 -1.4) scale(.9)"/><path d="M13 14.5l-3.4 4.4h2.7l-1.5 3.6 4.3-5h-2.7l1.8-3z" fill="#f0ae2c"/></symbol>
</defs></svg>`;
