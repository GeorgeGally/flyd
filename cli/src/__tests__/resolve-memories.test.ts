import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildMemoryPack } from "../resolve.js";
import type { BrainRetrievalResult } from "../lib/brain-retrieval.js";
import { workSessionStore } from "../work-intelligence/work-session-store.js";
import { conversationHistory } from "../conversation-history.js";
import { constructCurrentWork } from "../work-intelligence/current-work.js";
import { selectDomainStandard } from "../work-intelligence/domain-standards.js";
import { buildWorkIntelligencePrompt } from "../work-intelligence/intervention.js";
import { DOMAIN_STANDARDS } from "../work-intelligence/domain-standards.js";
import type { CurrentWork } from "../work-intelligence/types.js";

const retrieveResilientLexicalBrainEvidence = vi.fn(async (query: string): Promise<BrainRetrievalResult> => ({
  version: "1.0",
  source: "flyd-cli",
  query,
  generatedAt: "2026-07-28T00:00:00Z",
  sufficiency: { verdict: "sufficient", reason: "", coverage: 1 },
  matches: [
    {
      id: "memory_match:abc",
      type: "memory_match",
      source: "cli.retrieval",
      epistemicStatus: "observation",
      confidence: 0.8,
      confidenceProfile: {
        epistemicConfidence: 0.5,
        freshness: 1,
        interestAffinity: 0,
        retrievalUtility: 0.5,
        associationStrength: 0,
      },
      generatedAt: "2026-07-28T00:00:00Z",
      evidenceRefs: [],
      content: {
        path: "raw/2026-07-01.md",
        archive: "raw",
        excerpt: "George is building flyd.",
        retrievalScore: 80,
        recencyWeight: 1,
        reliabilityWeight: 1,
        corroborationCount: 0,
        stale: false,
        lastUpdated: null,
        isCurrent: false,
      },
    },
  ],
}));

vi.mock("../lib/brain-retrieval.js", () => ({
  get retrieveResilientLexicalBrainEvidence() {
    return retrieveResilientLexicalBrainEvidence;
  },
}));

const env = {
  application: { bundle_id: "com.apple.mail", name: "Mail" },
  window: { title: "Inbox", ref: "win_01" },
  focused_element: {
    ref: "el_01",
    role: "AXTextArea",
    description: "Message body",
    value: "",
    placeholder: "",
    selected_text: "",
  },
  selection: "",
  sufficiency: "semantic" as const,
};

beforeEach(() => {
  retrieveResilientLexicalBrainEvidence.mockClear();
});

describe("buildMemoryPack", () => {
  it("searches with the intent only — app name and window title stay out of the query", async () => {
    const pack = await buildMemoryPack("who am I", env);

    expect(retrieveResilientLexicalBrainEvidence).toHaveBeenCalledTimes(1);
    const query = retrieveResilientLexicalBrainEvidence.mock.calls[0][0];
    expect(query).toBe("who am I");
    expect(query).not.toContain("Mail");
    expect(query).not.toContain("Inbox");
    expect(pack.relevant).toHaveLength(1);
    expect(pack.relevant[0].content).toBe("George is building flyd.");
    expect(pack.relevant[0].epistemicStatus).toBe("observation");
    expect(pack.sources).toContain("raw/2026-07-01.md");
  });

  it("returns empty memory pack for an empty intent without searching", async () => {
    const pack = await buildMemoryPack("   ", env);
    expect(pack.relevant).toEqual([]);
    expect(pack.conflicts).toEqual([]);
    expect(pack.gaps).toEqual([]);
    expect(retrieveResilientLexicalBrainEvidence).not.toHaveBeenCalled();
  });

  it("carries epistemic metadata into RetrievedClaims", async () => {
    retrieveResilientLexicalBrainEvidence.mockResolvedValueOnce({
      version: "1.0" as const,
      source: "flyd-cli" as const,
      query: "test",
      generatedAt: "2026-07-28T00:00:00Z",
      sufficiency: { verdict: "sufficient", reason: "", coverage: 1 },
      matches: [{
        id: "memory_match:xyz",
        type: "memory_match" as const,
        source: "cli.retrieval" as const,
        epistemicStatus: "verified" as const,
        confidence: 0.9,
        confidenceProfile: {
          epistemicConfidence: 0.9,
          freshness: 0.85,
          interestAffinity: 0,
          retrievalUtility: 0.5,
          associationStrength: 0,
        },
        generatedAt: "2026-07-28T00:00:00Z",
        evidenceRefs: [],
        content: {
          path: "wiki/preferences/george.md",
          archive: "wiki",
          excerpt: "George prefers concise answers.",
          retrievalScore: 95,
          recencyWeight: 0.9,
          reliabilityWeight: 0.85,
          corroborationCount: 2,
          stale: false,
          lastUpdated: "2026-07-20",
          isCurrent: false,
        },
      }],
    });
    const pack = await buildMemoryPack("George preferences", env);
    expect(pack.relevant[0].epistemicStatus).toBe("verified");
    expect(pack.relevant[0].epistemicConfidence).toBe(0.9);
    expect(pack.relevant[0].freshness).toBe(0.85);
  });

  it("routes matches flagged isCurrent into pack.current instead of pack.relevant", async () => {
    retrieveResilientLexicalBrainEvidence.mockResolvedValueOnce({
      version: "1.0" as const,
      source: "flyd-cli" as const,
      query: "what am I working on",
      generatedAt: "2026-07-29T00:00:00Z",
      sufficiency: { verdict: "sufficient", reason: "", coverage: 1 },
      matches: [{
        id: "memory_match:current",
        type: "memory_match" as const,
        source: "cli.retrieval" as const,
        epistemicStatus: "observation" as const,
        confidence: 0.9,
        confidenceProfile: {
          epistemicConfidence: 0.9,
          freshness: 0.95,
          interestAffinity: 0,
          retrievalUtility: 0.5,
          associationStrength: 0,
        },
        generatedAt: "2026-07-29T00:00:00Z",
        evidenceRefs: [],
        content: {
          path: "wiki/projects/flyd.md",
          archive: "wiki" as const,
          excerpt: "Flyd memory recall repair is in progress.",
          retrievalScore: 90,
          recencyWeight: 0.95,
          reliabilityWeight: 0.9,
          corroborationCount: 0,
          stale: false,
          lastUpdated: "2026-07-29",
          isCurrent: true,
        },
      }],
    });

    const pack = await buildMemoryPack("what am I working on", env);

    expect(pack.current).toHaveLength(1);
    expect(pack.current[0].content).toBe("Flyd memory recall repair is in progress.");
    expect(pack.relevant).toHaveLength(0);
  });

  it("names the missing signal in gaps when a current_state query has no current match", async () => {
    const pack = await buildMemoryPack("what am I working on", env);

    expect(pack.current).toHaveLength(0);
    expect(pack.gaps).toHaveLength(1);
    expect(pack.gaps[0].importance).toBe("high");
  });

  it("does not add a currentness gap for non current_state queries", async () => {
    const pack = await buildMemoryPack("who am I", env);
    expect(pack.gaps).toHaveLength(0);
  });
});

describe("work-intelligence memory context", () => {
  function makeCurrentWork(overrides: Partial<CurrentWork> = {}): CurrentWork {
    return {
      project: { value: "Flyd", source: "foreground", confidence: "high", provenance: "test", sourceTimestamp: new Date().toISOString(), isHypothesis: false },
      objective: { value: "Implement work intelligence", source: "foreground", confidence: "medium", provenance: "test", sourceTimestamp: new Date().toISOString(), isHypothesis: false },
      artifact: { kind: "code", title: "resolve.ts", contentDigest: "test", bundleId: "com.apple.dt.Xcode" },
      stage: { value: "execution", source: "foreground", confidence: "medium", provenance: "test", sourceTimestamp: new Date().toISOString(), isHypothesis: false },
      constraints: { value: [], source: "foreground", confidence: "low", provenance: "test", sourceTimestamp: new Date().toISOString(), isHypothesis: true },
      openLoops: [],
      nextAction: { value: { description: "Review", readiness: "ready" }, source: "foreground", confidence: "high", provenance: "test", sourceTimestamp: new Date().toISOString(), isHypothesis: false },
      evidenceSummary: {
        sources: ["foreground_element"],
        snapshotTimestamp: new Date().toISOString(),
        foregroundApp: "VS Code",
        activeWindowTitle: "resolve.ts",
      },
      uncertainty: [],
      confidence: [{ field: "project", confidence: "high" }],
      ...overrides,
    };
  }

  it("builds memory retrieval alongside current work context", async () => {
    const pack = await buildMemoryPack("who am I", env);
    expect(pack.relevant).toHaveLength(1);
    expect(pack.relevant[0].content).toBe("George is building flyd.");
  });

  it("constructs current work from foreground evidence", () => {
    const codeEnv = {
      application: { bundle_id: "com.microsoft.VSCode", name: "VS Code" },
      window: { title: "resolve.ts — flyd", ref: "win_01" },
      focused_element: {
        ref: "el_01",
        role: "AXTextArea",
        description: "Code editor",
        value: "export async function resolve",
        placeholder: "",
        selected_text: "",
      },
      selection: "",
      sufficiency: "semantic" as const,
    };
    const cw = constructCurrentWork({
      environment: codeEnv,
      resolvedProjectRoot: "/Users/george/flyd",
      gitBranch: "main",
    });
    expect(cw.project.value).toBe("flyd");
    expect(cw.artifact.kind).toBe("code");
    expect(cw.stage.value).toBe("execution");
  });

  it("selects correct domain standard for code artifact", () => {
    const standard = selectDomainStandard({ artifactKind: "code", bundleId: "com.apple.dt.Xcode" });
    expect(standard.domain).toBe("code");
  });

  it("builds WI prompt with current work and domain standards", () => {
    const cw = makeCurrentWork();
    const standard = DOMAIN_STANDARDS.code;
    const prompt = buildWorkIntelligencePrompt({
      currentWork: cw,
      domainStandard: standard,
      intent: "review this",
    });
    expect(prompt).toContain("Flyd");
    expect(prompt).toContain("resolve.ts");
    expect(prompt).toContain("correctness");
    expect(prompt).toContain("GROUND RULES");
  });

  it("carries conversation history from work session store", () => {
    const session = workSessionStore.createSession();
    workSessionStore.addTurn(session.sessionId, "what is this", "It is a function", "work_intelligence");
    workSessionStore.addTurn(session.sessionId, "review it", "Looks good", "work_intelligence");

    const cw = makeCurrentWork();
    const standard = DOMAIN_STANDARDS.code;
    const turns = workSessionStore.getActiveConversationTurns(session.sessionId);
    const history = turns.map(t => `User: ${t.user}\nFlyd: ${t.assistant}`).join("\n");

    const prompt = buildWorkIntelligencePrompt({
      currentWork: cw,
      domainStandard: standard,
      intent: "what about errors?",
      conversationHistory: history,
    });

    expect(prompt).toContain("RECENT CONVERSATION");
    expect(prompt).toContain("what is this");
    expect(prompt).toContain("review it");
    expect(prompt).toContain("what about errors?");
  });

  it("limits conversation history to last 6 turns via conversation store", () => {
    const session = workSessionStore.createSession();
    for (let i = 0; i < 10; i++) {
      workSessionStore.addTurn(session.sessionId, `question ${i}`, `answer ${i}`, "work_intelligence");
    }

    // workSessionStore.getActiveConversationTurns returns up to 10 turns;
    // the 6-turn limit is applied by conversationHistory.get() when
    // falling through to workSessionStore.
    const rawTurns = workSessionStore.getActiveConversationTurns(session.sessionId);
    expect(rawTurns).toHaveLength(10);

    // conversationHistory.get() slices to last 6 from the WI fallback
    const limitedTurns = conversationHistory.get(session.sessionId);
    expect(limitedTurns).toHaveLength(6);
    expect(limitedTurns[0].user).toBe("question 4");
    expect(limitedTurns[5].user).toBe("question 9");
  });
});
