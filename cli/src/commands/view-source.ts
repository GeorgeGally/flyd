import type { ConversationSource } from "../conversation-view/types.js";

export function conversationSourceForView(
  options: { project?: string; session?: string },
  flyd: ConversationSource,
  transcript: ConversationSource,
): ConversationSource {
  return options.project !== undefined || options.session !== undefined ? transcript : flyd;
}
