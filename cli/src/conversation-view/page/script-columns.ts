import { CARD_SCRIPT } from "../cards.js";
import { LEFT_SCRIPT } from "../left-column.js";

/** Showing and hiding the columns, then the shared card and left-column scripts. */
export const COLUMNS_SCRIPT = `
  // The column shows when there is done work, unless he hid it.
  function showRail() {
    railEl.hidden = railHidden || railMobileDismissed || (!briefFilled && historyEl.hidden);
    if (railToggle) railToggle.setAttribute("aria-checked", String(!railHidden && !railMobileDismissed));
    setRail(railOn());
  }
  window.addEventListener("resize", function () {
    if (window.innerWidth > 720 && railMobileDismissed) { railMobileDismissed = false; showRail(); }
  });
  function hideRail(hidden) {
    railHidden = hidden;
    if (!hidden) railMobileDismissed = false;
    store("flyd-rail", hidden ? "off" : "on");
    showRail();
  }
  var railToggle = document.getElementById("rail-toggle");
  railToggle.setAttribute("aria-checked", String(!railHidden && !railMobileDismissed));
  railToggle.addEventListener("click", function () { hideRail(!railHidden && !railMobileDismissed); });
  document.getElementById("rail-hide").addEventListener("click", function () { hideRail(true); });
${CARD_SCRIPT}
${LEFT_SCRIPT}

`;
