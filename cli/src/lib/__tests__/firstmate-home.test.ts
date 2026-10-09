import { homedir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FirstmateDomainTransport } from "../../command/firstmate.js";
import { FirstmateInbox } from "../../conversation-view/firstmate-inbox.js";
import { firstmateHome } from "../firstmate-home.js";

const realHome = join(homedir(), "Documents", "firstmate");

describe("firstmateHome", () => {
  it("uses FLYD_FIRSTMATE_HOME, else ~/Documents/firstmate outside tests", () => {
    expect(firstmateHome({ FLYD_FIRSTMATE_HOME: " /tmp/fm " })).toBe("/tmp/fm");
    expect(firstmateHome({})).toBe(realHome);
  });

  it("never falls back to the real firstmate under vitest", () => {
    expect(firstmateHome({ VITEST: "true" })).not.toBe(realHome);
    expect(new FirstmateDomainTransport().home).not.toBe(realHome);
    expect(new FirstmateInbox().home).not.toBe(realHome);
    expect(new FirstmateDomainTransport().available()).toBe(false);
    expect(new FirstmateInbox().available()).toBe(false);
  });
});
