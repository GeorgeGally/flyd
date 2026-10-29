/**
 * The front page's own places: the right column's two tabs, the jobs list
 * (one tab; the page's artefact column #rail is the other), the open job's
 * heading and the open job. The conversation itself (#stream and the message
 * box) is the page's own and sits in the middle, on the paper.
 */
export const FRONT_HTML = `<nav class="rtabs" id="rtabs" aria-label="Right column"><button type="button" class="rtab" data-rtab="jobs" aria-pressed="false">Jobs<span class="fdot" id="rtab-dot" hidden aria-label="something needs you"></span></button><button type="button" class="rtab" data-rtab="arts" aria-pressed="false">Artefacts</button></nav>
<aside class="jobs" id="jobs" aria-label="Jobs"><div id="jobs-list"></div></aside>
<div class="stage-head" id="stage-head"><button type="button" class="stage-back" id="stage-back">Back to the conversation</button><p class="crumb" id="stage-crumb"></p><h1 id="stage-title"></h1></div>
<section class="job-view" id="job-view" aria-label="The open job"></section>`;
