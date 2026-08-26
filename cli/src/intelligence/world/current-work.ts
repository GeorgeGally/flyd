import { constructCurrentWork, type GroundingContext } from "../../work-intelligence/current-work.js";
import type { StoredEvent } from "../event-store.js";
import type { WorldModelState } from "./world-model.js";
import { activeClaims, worldModelProjector } from "./world-model.js";

/**
 * Current Work as a world-model projection (plan U3).
 *
 * Runs beside the legacy `constructCurrentWork` reader until reconciliation
 * proves parity; the cutover itself belongs to U8. Work-only events project
 * into the current-work view without ever becoming personal intent — the
 * projector namespace keeps the two worlds separate.
 */

export const WORK_SOURCE_PREFIX = "work.";

export function isWorkOnlyEvent(event: StoredEvent): boolean {
  return event.sourceId.startsWith(WORK_SOURCE_PREFIX);
}

export interface ProjectedCurrentWork {
  project?: { value: string; authority: string };
  stage?: { value: string; authority: string };
  objective?: { value: string; authority: string };
}

/**
 * Projected current work from the world-model state: only claims whose
 * entities were created by work-scoped sources. Personal beliefs and intents
 * (any other namespace) are invisible here by construction.
 */
export function projectedCurrentWork(state: WorldModelState, now = new Date()): ProjectedCurrentWork {
  const out: ProjectedCurrentWork = {};
  for (const claim of activeClaims(state, now)) {
    if (!isWorkEntity(claim.entityId)) continue;
    if (claim.attribute === "project" || claim.attribute === "stage" || claim.attribute === "objective") {
      out[claim.attribute] = { value: claim.value, authority: claim.authority };
    }
  }
  return out;
}

function isWorkEntity(entityId: string): boolean {
  // resolveEntityId renders namespace:key, so work-scoped namespaces start
  // with the "work." prefix (e.g. "work.foreground:keynote").
  return entityId.startsWith(WORK_SOURCE_PREFIX);
}

/** Convert one legacy grounding snapshot into a canonical work observation event shape. */
export function groundingToEventPayload(
  ctx: GroundingContext,
  sequenceHint: number,
  capturedAt: string,
): Array<Record<string, unknown>> {
  const projectRoot = ctx.resolvedProjectRoot;
  const projectName = projectRoot ? projectRoot.split("/").pop() : undefined;
  // Mirror the legacy reader's project resolution order: repo root → branch
  // name → foreground application name.
  const projectValue = projectName ?? (ctx.gitBranch ? ctx.gitBranch.replace(/^feature\//, "") : ctx.environment.application?.name);
  const stage = ctx.environment.focused_element?.role.includes("TextArea")
    ? ctx.environment.focused_element.selected_text?.length
      ? "review"
      : "execution"
    : "exploration";

  const payloads: Array<Record<string, unknown>> = [];
  const entity = { namespace: `${WORK_SOURCE_PREFIX}foreground`, key: projectValue };
  if (projectValue) payloads.push({ entity, attribute: "project", value: projectValue });
  payloads.push({ entity, attribute: "stage", value: stage });
  if (ctx.gitBranch) payloads.push({ entity, attribute: "objective", value: `Work on ${ctx.gitBranch} branch` });
  void sequenceHint;
  void capturedAt;
  return payloads;
}

// ---------------------------------------------------------------------------
// Parity check against the legacy reader on frozen fixtures
// ---------------------------------------------------------------------------

export interface ParityResult {
  fixture: string;
  matchesLegacy: boolean;
  legacyProject: string;
  projectedProject?: string;
  legacyStage: string;
  projectedStage?: string;
}

/**
 * Compare the projected current work with the legacy constructCurrentWork
 * output for one frozen fixture. Parity means: same project name and same
 * stage classification from identical grounding evidence.
 */
export function parityCheck(fixtureName: string, grounding: GroundingContext): ParityResult {
  const legacy = constructCurrentWork(grounding);

  // Frozen fixture → synthetic spine events → projection
  const state: WorldModelState = { claims: [] };
  const capturedAt = new Date().toISOString();
  const payloads = groundingToEventPayload(grounding, 1, capturedAt);
  let sequence = 1;
  for (const payload of payloads) {
    const event: StoredEvent = {
      sequence: sequence++,
      id: `parity-${sequence}`,
      schemaVersion: 1,
      kind: "observation",
      sourceId: `${WORK_SOURCE_PREFIX}foreground`,
      capturedAt,
      consentJson: "{}",
      retentionClass: "ephemeral",
      provenance: "parity-fixture",
      idempotencyKey: `parity-${fixtureName}-${sequence}`,
      causationIds: [],
      evidenceRefs: [],
      payloadDomain: "domain:parity",
      payload,
      redacted: false,
      erased: false,
    };
    state.claims = worldModelProjector.apply(state, event).claims;
  }

  const projected = projectedCurrentWork(state);
  return {
    fixture: fixtureName,
    matchesLegacy:
      projected.project?.value === legacy.project.value &&
      projected.stage?.value === legacy.stage.value,
    legacyProject: legacy.project.value,
    projectedProject: projected.project?.value,
    legacyStage: String(legacy.stage.value),
    projectedStage: projected.stage?.value,
  };
}
