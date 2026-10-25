import { LEFT_STYLE } from "./left-column.js";
import { BASE_STYLE } from "./page/base-style.js";
import { CHROME_STYLE } from "./page/chrome-style.js";
import { COMPOSER_STYLE } from "./page/composer-style.js";
import { FRONT_STYLE } from "./page/front-style.js";
import { pageMarkup, type PageOptions } from "./page/markup.js";
import { MESSAGE_STYLE } from "./page/message-style.js";
import { ARTEFACT_CHAT_SCRIPT } from "./page/script-artefact-chat.js";
import { BRIEF_SCRIPT } from "./page/script-brief.js";
import { COLUMNS_SCRIPT } from "./page/script-columns.js";
import { COMPOSER_SCRIPT } from "./page/script-composer.js";
import { FRONT_SCRIPT } from "./page/script-front.js";
import { CORE_SCRIPT } from "./page/script-core.js";
import { MESSAGES_SCRIPT } from "./page/script-messages.js";
import { REPLIES_SCRIPT } from "./page/script-replies.js";
import { SESSION_SCRIPT } from "./page/script-session.js";
import { SHOW_SCRIPT } from "./page/script-show.js";
import { SHOW_STYLE } from "./page/show-style.js";

// The whole page: one flat column, the captain's words and the replies, a
// slim header. Everything is inline (see the CSP in server.ts); the page
// fetches nothing but this server's own /api endpoints. Each part lives in
// page/: styles by area, the one page script in the order it runs, and the
// markup. The script parts are pieces of one IIFE: script-core.ts opens it and
// script-show.ts closes it, so they only work joined in this order.

export { BASE_STYLE };

// Each part is written as its own template, opening on a new line; joined, a
// part runs straight on from the one before it.
function joined(parts: string[]): string {
  return "\n" + parts.map((part) => part.replace(/^\n/, "")).join("");
}

const STYLE = BASE_STYLE + joined([CHROME_STYLE, MESSAGE_STYLE, COMPOSER_STYLE]) + LEFT_STYLE + SHOW_STYLE + FRONT_STYLE;

const SCRIPT = joined([
  CORE_SCRIPT,
  MESSAGES_SCRIPT,
  BRIEF_SCRIPT,
  REPLIES_SCRIPT,
  COLUMNS_SCRIPT,
  ARTEFACT_CHAT_SCRIPT,
  SESSION_SCRIPT,
  COMPOSER_SCRIPT,
  FRONT_SCRIPT,
  SHOW_SCRIPT,
]);

export function renderPage(options: PageOptions): string {
  return pageMarkup(options, STYLE, SCRIPT);
}
