/**
 * The front page's own places: the jobs column, the sheet the active job
 * sits on with its heading, and the open job. The conversation itself
 * (#stream and the message box) and the artefact column (#rail) are the
 * page's own; the sheet holds the one and the right column is the other.
 */
export const FRONT_HTML = `<aside class="jobs" id="jobs" aria-label="Jobs"><div id="jobs-list"></div></aside>
<div class="sheet" aria-hidden="true"></div>
<div class="sheet-foot" aria-hidden="true"></div>
<div class="stage-head" id="stage-head"><p class="crumb" id="stage-crumb"></p><h1 id="stage-title"></h1></div>
<section class="job-view" id="job-view" aria-label="The open job"></section>`;
