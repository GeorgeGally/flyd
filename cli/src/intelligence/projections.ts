import { createHash } from "node:crypto";
import type { IntelligenceEventStore, StoredEvent } from "./event-store.js";

/**
 * Deterministic projection framework (flyd-personal-intelligence-prd.md §2.1).
 *
 * Projectors are pure functions over the canonical event sequence. State can
 * be rebuilt from any sequence position; a checkpoint records how far each
 * projector has advanced so restarts resume without duplicate execution.
 */

export interface Projector<S> {
  name: string;
  initialState(): S;
  /** Pure transition — same (state, event) always yields the same state. */
  apply(state: S, event: StoredEvent): S;
}

export interface ProjectionSnapshot<S> {
  projector: string;
  lastSequence: number;
  state: S;
  stateHash: string;
}

interface ProjectionRecord<S> {
  state: S;
}

export class ProjectionEngine<S> {
  private readonly store: IntelligenceEventStore;
  private readonly projector: Projector<S>;
  private record: ProjectionRecord<S>;
  private lastSequence = 0;

  constructor(store: IntelligenceEventStore, projector: Projector<S>) {
    this.store = store;
    this.projector = projector;
    this.record = { state: projector.initialState() };
    this.lastSequence = store.getCheckpoint(projector.name);
  }

  /**
   * Apply every not-yet-projected event in canonical order. Erased events
   * arrive with payload withheld; projectors retract derived entries for them.
   * Returns how many events were applied.
   */
  runToHead(): number {
    let applied = 0;
    for (;;) {
      const batch = this.store.readFrom(this.lastSequence);
      if (batch.length === 0) break;
      for (const event of batch) {
        this.record.state = this.projector.apply(this.record.state, event);
        this.lastSequence = event.sequence;
        applied += 1;
      }
      if (batch.length < 1000) break;
    }
    this.saveCheckpoint();
    return applied;
  }

  /** Full rebuild from any position — the projection is never an authority. */
  rebuild(fromSequence = 0): ProjectionSnapshot<S> {
    this.record = { state: this.projector.initialState() };
    this.lastSequence = fromSequence;
    this.runToHead();
    return this.snapshot();
  }

  snapshot(): ProjectionSnapshot<S> {
    return {
      projector: this.projector.name,
      lastSequence: this.lastSequence,
      state: this.record.state,
      stateHash: this.stateHash(),
    };
  }

  stateHash(): string {
    return createHash("sha256").update(JSON.stringify(this.record.state)).digest("hex");
  }

  private saveCheckpoint(): void {
    this.store.saveCheckpoint(this.projector.name, this.lastSequence, this.stateHash());
  }
}
