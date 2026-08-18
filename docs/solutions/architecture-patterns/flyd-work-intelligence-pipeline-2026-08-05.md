---
title: "Building a work-intelligence pipeline on top of an invocation overlay"
date: 2026-08-05
category: architecture-patterns
module: flyd-work-intelligence
problem_type: architecture_pattern
component: development_workflow
severity: high
applies_when:
  - "Adding structured intelligence over an existing presence/invocation overlay"
  - "Replacing route-first intent dispatch with evidence-grounded multi-stage reasoning"
  - "Building work-context awareness from ambient foreground signals and Git evidence"
  - "Defining cross-language type contracts between native adapter and intelligence runtime"
tags:
  - work-intelligence
  - overlay
  - pipeline-architecture
  - evidence-grounded
  - domain-standards
  - swift-typescript-bridge
  - session-continuity
  - verification-loop
---

# Building a work-intelligence pipeline on top of an invocation overlay

## Context

The Flyd overlay already had a working presence model (PRESENT/INVOKED/LIVE modes), adapter-side environment capture, and a `/manifest` resolution endpoint. Invocations hit `/manifest`, a model classified the intent, and resolution routing chose between native text insertion, augment cards, or compose surfaces.

This was a **route-first** architecture: classify, then route. It worked for simple commands ("type this", "summarize selection"), but it had no work awareness. It didn't know what project the user was in, what artifact they were editing, or what domain-specific standards applied.

The work-intelligence loop replaced that with a Ground → Diagnose → Intervene pipeline layered on top of the existing resolution system. Dictation intents still follow the fast deterministic path. Everything else enters an evidence-grounded work-intelligence stage first.

## Guidance

### Layering, not replacing

The work-intelligence loop is injected into the existing `/manifest` pipeline, not a replacement. Dictation intents (`type`, `write`, `dictate`, `insert`) still hit the fast regex path. Non-dictation intents enter work-intelligence:

```
INVOKED intent
    ↓
Is this a dictation intent? ──yes──→ fast path: native text resolution
    │
    no
    ↓
Ground: construct CurrentWork from adapter evidence + Git
    ↓
Diagnose: LLM produces structured diagnosis against domain standards
    ↓
Intervene: LLM produces one high-leverage intervention + options
    ↓
Resolution: intervention rendered as augment cards
```

### Stage 1: Ground — evidence-attributed CurrentWork

The adapter captures foreground application, window title, focused element ref/role/value/selection, display identity, and bounds. The grounding step enriches this with repository context by walking up the document path to find a Git root.

The resulting `CurrentWork` struct carries:

| Field | Source | Example |
|-------|--------|---------|
| `project` | Git repo root name | `"CleanX"` |
| `objective` | Git branch name | `"fix-auth"` |
| `artifact` | Bundle ID classification | `{ kind: "code", title: "AuthService.swift" }` |
| `stage` | Focused element role + selection | `"execution"` or `"review"` |
| `nextAction` | Foreground state | `{ description: "Review selected content" }` |

Every field is an `EvidenceItem<T>` carrying `source`, `confidence` (`high`/`medium`/`low`), `provenance`, and `isHypothesis`. Inferred fields are tagged as hypotheses. The model receives an `uncertainty` array naming unknown fields.

### Stage 2: Diagnose — domain-specific critique standards

Rather than a generic "review this" prompt, the system selects a `DomainStandard` based on artifact kind and bundle ID. Five domains: `design`, `writing`, `strategy`, `code`, `research`. Each domain defines:

- **evaluation dimensions** (9-11 per domain): e.g. code has correctness, maintainability, security, failure handling, architectural fit
- **focus prompt**: one causal issue, not a list
- **avoidances**: domain-specific guardrails preventing generic criticism

The model receives the domain's evaluation dimensions verbatim in the prompt, so a design artifact is judged against hierarchy/clarity/composition, not test coverage.

### Stage 3: Intervene — one high-leverage action

Each intervention carries `kind` (insight/critique/reframe/alternative/etc.), `content` in the user's language, a `strongerAlternative`, and optionally 1-3 labeled `options` rendered as interactive augment cards. Visual grounding ties the intervention to a screen region when coordinates are available.

### State management: session store with TTL and revision tracking

Sessions are held in-memory with 30-minute TTL. Expired sessions return `null` from `get()`/`bump()` — callers must handle the null case. Never silently create a new session for an expired ID; that produces orphans and broken correlation.

Each session carries a monotonic `revision` counter, `ActionGrant` lifecycle tracking, max 20 turns, and conversation history retrieval for multi-turn coherence.

### Post-execution: verify before reporting

After every text operation, re-read the target element and compare against expected state. Produce a `verified`/`partial`/`failed` verdict. For repository actions, validate approved root, instruction limits, and Git status before spawning a child worker.

### Contract versioning across layers

The request/response contract between Swift adapter and TypeScript Core is explicitly versioned (`WORK_CONTRACT_VERSION = 1`). Mismatched versions are a hard failure. Both sides decode against shared golden fixtures.

## Why This Matters

**Evidence > classification.** Route-first can only bucket intents. Evidence-grounded builds a structured work model with provenance, enabling domain-specific critique the old system could never produce.

**Confidence and uncertainty are first-class.** Every field declares whether it's observed or inferred. Unknown fields are named. The model knows what it doesn't know.

**One intervention, not a list.** The pipeline forces focus: one primary issue, one causal explanation, one stronger alternative.

**Domain-specific standards prevent generic answers.** A design review uses hierarchy/clarity/composition; a code review uses correctness/security/maintainability.

**Verification closes the loop.** The system re-reads after execution, compares against expected state, and records a verifiable outcome.

**Session continuity.** The in-memory session store preserves conversation history and current work model across invocations within the TTL window.

## When to Apply

- When an existing intelligent system has a working routing/presence layer but no work awareness
- When you need to move from intent classification to evidence-grounded reasoning
- When domain-specific critique standards would materially improve response quality
- When you need post-execution verification of automated actions
- When building a pipeline where each stage adds structured enrichment rather than replacing the previous layer

## Examples

### Evidence-attributed CurrentWork contract

```typescript
// cli/src/work-intelligence/types.ts:12-19
export interface EvidenceItem<T> {
  value: T;
  source: 'foreground' | 'repository' | 'document' | 'conversation' | 'memory' | 'user_correction';
  confidence: 'high' | 'medium' | 'low';
  provenance: string;
  sourceTimestamp: string;
  isHypothesis: boolean;
}
```

### Grounding: resolve project from Git, fall back to foreground app

```typescript
// cli/src/work-intelligence/current-work.ts:79-103
function resolveProjectEvidence(env, ctx): EvidenceItem<string> {
  if (ctx.resolvedProjectRoot) {
    return evidenceItem(extractProjectName(ctx.resolvedProjectRoot), 'foreground', 'high', ...);
  }
  if (ctx.gitBranch) {
    return evidenceItem(ctx.gitBranch.replace(/^feature\//, ''), 'repository', 'medium', ...);
  }
  return evidenceItem(appName, 'foreground', 'low', 'No repository evidence available', ..., true);
}
```

### Domain routing: artifact kind → evaluation dimensions

```typescript
// cli/src/work-intelligence/domain-standards.ts:123-143
export function selectDomainStandard(currentWork): DomainStandard {
  if (artifactKind === 'code' || bundleId.includes('xcode')) return DOMAIN_STANDARDS.code;
  if (artifactKind === 'design' || bundleId.includes('figma')) return DOMAIN_STANDARDS.design;
  // ...
  return DOMAIN_STANDARDS.strategy;
}
```

### Orchestration: Ground → Diagnose → Intervene

```typescript
// cli/src/work-intelligence/work-interaction-service.ts
export async function runWorkIntelligence(params) {
  let workSessionId = params.conversationId
    ? (workSessionStore.get(params.conversationId)?.sessionId ?? params.conversationId)
    : workSessionStore.createSession().sessionId;

  const repoInfo = resolveRepositoryFromPath(params.environment.document_path);
  const currentWork = buildCurrentWork({ environment, ...repoInfo });
  const domainStandard = selectDomainStandard({ artifactKind, bundleId });
  const prompt = buildWorkIntelligencePrompt({ currentWork, domainStandard, intent, conversationHistory });

  const responseText = await query(prompt, model, undefined, apiKey, baseURL, { json: true });
  const result = parseWorkIntelligenceResponse(responseText);

  // Update after query to avoid dirty state on failure
  workSessionStore.updateCurrentWork(workSessionId, currentWork);
  // ... add turn, return response
}
```

### Verification: post-execution re-read

> Reference updated 2026-08-15: `cli/src/work-intelligence/verification.ts` (shown below) was retired as dead code. The live post-execution verifier is `cli/src/runtime/result-verifier.ts` → `verifyWorkerResult()` (repository evidence + command re-runs). The text-operation re-read pattern below is preserved as the historical shape.

```typescript
// cli/src/work-intelligence/verification.ts:14-47 (retired — see cli/src/runtime/result-verifier.ts verifyWorkerResult)
export function verifyTextOperation(ctx: VerificationContext): VerificationResult {
  const checks: VerificationChecks = { reRead: checkReRead(ctx) };
  const diagnosisResolved = evaluateDiagnosisResolution(ctx.postExecutionValue, ctx.diagnosedIssueFinding);
  const verified = checks.reRead.passed && diagnosisResolved;
  let verdict: 'verified' | 'partial' | 'failed';
  if (verified) verdict = 'verified';
  else if (checks.reRead.actual.length > 0) verdict = 'partial';
  else verdict = 'failed';
  return { verdict, verificationChecks: checks, ... };
}
```

### Session store: TTL-safe get and bump

```typescript
// cli/src/work-intelligence/work-session-store.ts
get(sessionId: string, now = Date.now()): WorkSession | null {
  const session = this.sessions.get(sessionId);
  if (!session) return null;
  if (now - parseInt(session.lastActiveAt) > this.ttlMs) return null;
  return session;
}

bump(sessionId: string, now = Date.now()): WorkSession | null {
  const session = this.get(sessionId, now);
  if (session) { session.lastActiveAt = now.toString(); return session; }
  return null; // Expired — caller must create fresh
}
```

## Related

- `docs/product/flyd-work-intelligence-prd.md` — product authority for the work-intelligence loop
- `docs/solutions/architecture-patterns/flyd-overlay-thin-adapter-typescript-core-2026-07-23.md` — foundational adapter/Core split
- `docs/solutions/architecture-patterns/flyd-architectural-realignment-2026-07-28.md` — three-axis separation, observation protocol
- `docs/plans/2026-08-02-001-feat-work-intelligence-loop-plan.md` — implementation plan
