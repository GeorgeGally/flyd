import { describe, expect, it } from "vitest";
import { isOpenConversationIntent } from "../open-intent.js";

describe("isOpenConversationIntent", () => {
  it.each([
    "Open Flyd",
    "open flyd.",
    "Open the app",
    "show Flyd",
    "Open the conversation",
    "open the conversation window",
    "Hey Flyd, open the app please",
    "can you open your app",
    "bring up flyd",
    "Show me the conversation",
    "open up the flyd app",
    "launch flyd",
    "open the chat",
    "open firstmate's conversation",
  ])("opens the window for %j", (utterance) => {
    expect(isOpenConversationIntent(utterance)).toBe(true);
  });

  it.each([
    "open the app store",
    "show me the conversation about pricing",
    "what is the flyd app",
    "open safari",
    "open the conversation with Sam in Slack",
    "how do I open the app",
    "flyd",
    "",
  ])("leaves %j to the normal resolver", (utterance) => {
    expect(isOpenConversationIntent(utterance)).toBe(false);
  });
});
