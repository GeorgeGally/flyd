/** Transport ceiling, not a new action policy. Account writes use the existing
 * explicit account-intent path, including reviewed WhatsApp draft authority. */
export const MOBILE_TOOLS = new Set([
  "web_search", "read_url", "recall", "remember",
  "connected_accounts", "email_search", "email_read", "email_mailboxes",
  "drive_search", "drive_read", "whatsapp_status", "whatsapp_search", "whatsapp_read",
]);
