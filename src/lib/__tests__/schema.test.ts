import { describe, it, expect } from "vitest";
import {
  detectSignal,
  detectEventType,
  extractParticipants,
  extractTopics,
  isValidEventType,
  isValidEventOutcome,
  extractEventFromFrontmatter,
  type CaptureEventType,
} from "../schema.js";

describe("detectSignal", () => {
  it("detects budget_resistance", () => {
    expect(detectSignal("The sponsor had budget resistance and said no")).toBe("budget_resistance");
    expect(detectSignal("budget concerns are blocking us")).toBe("budget_resistance");
    expect(detectSignal("cost is an issue for them")).toBe("budget_resistance");
    expect(detectSignal("funding problem with the project")).toBe("budget_resistance");
    expect(detectSignal("money is tight right now")).toBe("budget_resistance");
  });

  it("detects budget_available", () => {
    expect(detectSignal("budget was approved today")).toBe("budget_available");
    expect(detectSignal("funding is secured for Q3")).toBe("budget_available");
  });

  it("detects positive_interest", () => {
    expect(detectSignal("they were very interested in the proposal")).toBe("positive_interest");
    expect(detectSignal("client is excited about this")).toBe("positive_interest");
  });

  it("detects blocked", () => {
    expect(detectSignal("we are completely blocked by legal")).toBe("blocked");
    expect(detectSignal("the project is stuck waiting for API access")).toBe("blocked");
  });

  it("detects launched", () => {
    expect(detectSignal("we shipped the feature last night")).toBe("launched");
    expect(detectSignal("the app was deployed to production")).toBe("launched");
  });

  it("detects cancelled", () => {
    expect(detectSignal("the project was killed by management")).toBe("cancelled");
    expect(detectSignal("we abandoned the initiative")).toBe("cancelled");
  });

  it("detects decision_made", () => {
    expect(detectSignal("we decided to go with React instead of Vue")).toBe("decision_made");
    expect(detectSignal("chose the Postgres option")).toBe("decision_made");
  });

  it("returns null for text with no signal", () => {
    expect(detectSignal("we worked on the UI today")).toBeNull();
    expect(detectSignal("fixed a bug in the auth flow")).toBeNull();
  });
});

describe("detectEventType", () => {
  it("detects goal type", () => {
    expect(detectEventType("Our goal is to launch by Q3")).toBe("goal");
    expect(detectEventType("I want to get 100 users by December")).toBe("goal");
    expect(detectEventType("we are working towards a product-market fit")).toBe("goal");
  });

  it("detects decision type", () => {
    expect(detectEventType("We decided to pivot to B2B")).toBe("decision");
    expect(detectEventType("I'll use TypeScript for this project")).toBe("decision");
    expect(detectEventType("Let's go with the simpler approach")).toBe("decision");
  });

  it("detects event type", () => {
    expect(detectEventType("Had a meeting with the team yesterday")).toBe("event");
    expect(detectEventType("met with the client this morning")).toBe("event");
    expect(detectEventType("did a demo for the investors")).toBe("event");
  });

  it("detects belief type", () => {
    expect(detectEventType("I believe this approach is wrong")).toBe("belief");
    expect(detectEventType("I think the market is not ready")).toBe("belief");
    expect(detectEventType("in my opinion, we should wait")).toBe("belief");
  });

  it("defaults to observation for neutral text", () => {
    expect(detectEventType("The sky is blue")).toBe("observation");
    expect(detectEventType("some notes about the project")).toBe("observation");
    expect(detectEventType("just regular updates")).toBe("observation");
  });
});

describe("extractParticipants", () => {
  it("extracts known names from text", () => {
    const result = extractParticipants("Had a meeting with Gino and Andy yesterday about the project");
    expect(result).toContain("gino");
    expect(result).toContain("andy");
  });

  it("extracts george and radarboy references", () => {
    const result = extractParticipants("George was working on the radarboy project");
    expect(result).toContain("george");
    expect(result).toContain("radarboy");
  });

  it("returns empty for no known names", () => {
    const result = extractParticipants("just working on the API today");
    expect(result).toEqual([]);
  });
});

describe("extractTopics", () => {
  it("extracts flyd topic", () => {
    expect(extractTopics("working on the flyd memory system")).toContain("flyd");
    expect(extractTopics("updating the knowledge base")).toContain("flyd");
  });

  it("extracts koko topic", () => {
    expect(extractTopics("the koko project needs more funding")).toContain("koko");
  });

  it("extracts multiple topics", () => {
    const result = extractTopics("Using AI for the graffiti machine project with bridgestone sponsorship");
    expect(result).toContain("ai");
    expect(result).toContain("graffiti machine");
    expect(result).toContain("bridgestone");
    expect(result).toContain("sponsorship");
  });

  it("returns empty for unrelated text", () => {
    expect(extractTopics("random text about nothing in particular")).toEqual([]);
  });
});

describe("isValidEventType", () => {
  it("validates known types", () => {
    const valid: CaptureEventType[] = ["event", "observation", "decision", "belief", "goal"];
    for (const t of valid) expect(isValidEventType(t)).toBe(true);
  });

  it("rejects invalid types", () => {
    expect(isValidEventType("invalid")).toBe(false);
    expect(isValidEventType("")).toBe(false);
    expect(isValidEventType("meeting")).toBe(false);
  });
});

describe("isValidEventOutcome", () => {
  it("validates known outcomes", () => {
    expect(isValidEventOutcome("confirmed")).toBe(true);
    expect(isValidEventOutcome("declined")).toBe(true);
    expect(isValidEventOutcome("pending")).toBe(true);
    expect(isValidEventOutcome("blocked")).toBe(true);
    expect(isValidEventOutcome("resolved")).toBe(true);
    expect(isValidEventOutcome("achieved")).toBe(true);
    expect(isValidEventOutcome("abandoned")).toBe(true);
  });

  it("rejects invalid outcomes", () => {
    expect(isValidEventOutcome("invalid")).toBe(false);
    expect(isValidEventOutcome("")).toBe(false);
  });
});

describe("extractEventFromFrontmatter", () => {
  it("extracts from type field as fallback", () => {
    const result = extractEventFromFrontmatter({ type: "event" });
    expect(result.event_type).toBe("event");
  });

  it("extracts from event_type field directly", () => {
    const result = extractEventFromFrontmatter({ event_type: "decision", type: "raw" });
    expect(result.event_type).toBe("decision");
  });

  it("extracts all fields", () => {
    const result = extractEventFromFrontmatter({
      event_type: "event",
      signal: "budget_resistance",
      confidence: 0.85,
      participants: ["george", "gino"],
      outcome: "declined",
      topics: ["sponsorship", "koko"],
    });
    expect(result.event_type).toBe("event");
    expect(result.signal).toBe("budget_resistance");
    expect(result.confidence).toBe(0.85);
    expect(result.participants).toEqual(["george", "gino"]);
    expect(result.outcome).toBe("declined");
    expect(result.topics).toEqual(["sponsorship", "koko"]);
  });

  it("ignores invalid confidence values", () => {
    expect(extractEventFromFrontmatter({ confidence: 1.5 }).confidence).toBeUndefined();
    expect(extractEventFromFrontmatter({ confidence: -0.1 }).confidence).toBeUndefined();
    expect(extractEventFromFrontmatter({ confidence: "high" }).confidence).toBeUndefined();
  });

  it("ignores invalid outcome", () => {
    expect(extractEventFromFrontmatter({ outcome: "maybe" }).outcome).toBeUndefined();
  });

  it("returns empty for no event fields", () => {
    expect(extractEventFromFrontmatter({})).toEqual({});
  });
});
