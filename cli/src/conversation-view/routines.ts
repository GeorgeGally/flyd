import { createHash, randomUUID } from "node:crypto";
import { IntelligenceEventStore } from "../intelligence/event-store.js";
import { validateEnvelope, type EpistemicKind } from "../intelligence/context-envelope.js";

const SOURCE = "view.routines";
const hash = (value: string) => createHash("sha256").update(value).digest("hex");

export interface Routine {
  id: string;
  title: string;
  purpose: string;
  template: string;
  status: "suggested" | "active" | "dismissed";
  revision: number;
}

export interface RoutineRun {
  id: string;
  routineId: string;
  revision: number;
  session: string;
  text: string;
  status: "dispatching" | "submitted" | "unknown";
  receipt?: string;
}

interface State {
  routines: Map<string, Routine>;
  runs: Map<string, RoutineRun>;
  observations: Map<string, Set<string>>;
  enabled: boolean;
}

// Narrow discovery, not fuzzy intent merging or background sensing. Only
// explicitly submitted short requests; never attachments or app contents.
export function eligibleRoutineText(text: string): boolean {
  return text.length >= 24 && text.length <= 600 && text.trim().split(/\s+/).length >= 5 &&
    !/[\n\r]|https?:|@|```|\b(?:password|secret|token|api[_ -]?key|bearer|private key)\b|\b(?:sk-|ghp_|github_pat_|AKIA)[\w-]+/i.test(text) &&
    !text.trim().startsWith("/");
}

export function routineSlots(template: string): string[] {
  const pattern = /\{\{([a-z][a-z0-9_]{0,31})\}\}/g;
  const slots = [...new Set([...template.matchAll(pattern)].map(match => match[1]))];
  if (slots.length > 12 || /\{\{|\}\}/.test(template.replace(pattern, ""))) {
    throw new Error("Use inputs like {{topic}} (at most 12).");
  }
  return slots;
}

/** A replayable projection of canonical events, not a second memory authority. */
export class RoutineArtefacts {
  constructor(private readonly options: { path?: string } = {}) {}

  private use<T>(work: (db: IntelligenceEventStore) => T): T {
    const db = new IntelligenceEventStore({ path: this.options.path ?? process.env.FLYD_ROUTINES_DB });
    try { return db.transaction(() => work(db)); }
    finally { db.close(); }
  }

  private state(db: IntelligenceEventStore): State {
    const state: State = { routines: new Map(), runs: new Map(), observations: new Map(), enabled: true };
    for (const event of db.readSource(SOURCE)) {
      if (event.erased || !event.payload) continue;
      const payload = event.payload;
      if (payload.action === "observe") {
        const key = payload.key as string;
        const deliveries = state.observations.get(key) ?? new Set<string>();
        deliveries.add(payload.delivery as string);
        state.observations.set(key, deliveries);
      } else if (payload.action === "routine") {
        const routine = payload.routine as unknown as Routine;
        state.routines.set(routine.id, routine);
      } else if (payload.action === "run") {
        const run = payload.run as unknown as RoutineRun;
        state.runs.set(run.id, run);
      } else if (payload.action === "enabled") {
        state.enabled = payload.enabled === true;
      }
    }
    return state;
  }

  private event(db: IntelligenceEventStore, kind: EpistemicKind, payload: Record<string, unknown>, key: string = randomUUID()): void {
    const envelope = {
      pathKind: "interface" as const, kind, sourceId: SOURCE,
      consent: { grantedAt: new Date().toISOString(), scopes: [SOURCE] },
      retentionClass: "local_default" as const, payloadClassification: "personal" as const,
      provenance: "Flyd explicitly submitted requests and routine controls",
      idempotencyKey: key, payload,
    };
    const validation = validateEnvelope(envelope);
    if (!validation.ok) throw new Error(validation.detail);
    if (!db.append(envelope)) throw new Error("Could not save routine event");
  }

  list(): { routines: Routine[]; runs: RoutineRun[]; enabled: boolean } {
    return this.use(db => {
      const state = this.state(db);
      return {
        routines: [...state.routines.values()].filter(routine => routine.status !== "dismissed").slice(-50).reverse(),
        runs: [...state.runs.values()].slice(-50).reverse(),
        enabled: state.enabled && process.env.FLYD_ROUTINES !== "0",
      };
    });
  }

  observe(session: string, delivery: string, text: string): Routine | null {
    if (process.env.FLYD_ROUTINES === "0" || !eligibleRoutineText(text)) return null;
    return this.use(db => {
      const state = this.state(db);
      const eventKey = "observe:" + hash(session + "\0" + delivery);
      if (!state.enabled || db.findByIdempotencyKey(SOURCE, eventKey)) return null;
      const key = hash(session + "\0" + text.trim().toLowerCase().replace(/\s+/g, " "));
      const deliveries = state.observations.get(key);
      this.event(db, "observation", { action: "observe", key, delivery }, eventKey);
      if ((deliveries?.size ?? 0) < 2 || state.routines.has(key)) return null;
      const routine: Routine = {
        id: key, title: text.trim().slice(0, 72), purpose: text.trim(), template: text.trim(),
        status: "suggested", revision: 1,
      };
      this.event(db, "proposed_action", { action: "routine", routine });
      return routine;
    });
  }

  save(input: { id?: string; title: string; purpose: string; template: string; revision?: number }): Routine {
    if (![input.title, input.purpose, input.template].every(value => typeof value === "string" && value.trim()) ||
        input.title.length > 100 || input.purpose.length > 1000 || input.template.length > 4000) {
      throw new Error("Enter a title, purpose and request (up to 4000 characters).");
    }
    routineSlots(input.template);
    return this.use(db => {
      const previous = input.id ? this.state(db).routines.get(input.id) : undefined;
      if (input.id && (!previous || previous.revision !== input.revision)) {
        throw new Error("Routine changed; refresh before editing.");
      }
      const routine: Routine = {
        id: previous?.id ?? randomUUID(), title: input.title.trim(), purpose: input.purpose.trim(),
        template: input.template.trim(), status: "active", revision: (previous?.revision ?? 0) + 1,
      };
      this.event(db, "user_confirmed_intention", { action: "routine", routine });
      return routine;
    });
  }

  dismiss(id: string): void {
    this.use(db => {
      const previous = this.state(db).routines.get(id);
      if (!previous) throw new Error("Unknown routine");
      this.event(db, "user_confirmed_intention", {
        action: "routine", routine: { ...previous, status: "dismissed", revision: previous.revision + 1 },
      });
    });
  }

  enable(enabled: boolean): void {
    this.use(db => this.event(db, "user_confirmed_intention", { action: "enabled", enabled }));
  }

  erase(): void {
    this.use(db => {
      db.eraseSource(SOURCE);
      // Forgetting also stops future discovery. No run payload survives.
      this.event(db, "user_confirmed_intention", { action: "enabled", enabled: false });
    });
  }

  claim(id: string, revision: number, session: string, requestId: string, inputs: Record<string, unknown>): { run: RoutineRun; fresh: boolean } {
    if (!/^[\w-]{16,100}$/.test(requestId) || !session || session.length > 200) throw new Error("Invalid run request");
    return this.use(db => {
      const state = this.state(db);
      const previous = state.runs.get(requestId);
      if (previous) {
        if (previous.routineId !== id || previous.session !== session) throw new Error("Run identifier already used");
        return { run: previous, fresh: false };
      }
      const routine = state.routines.get(id);
      if (!routine || routine.status !== "active" || routine.revision !== revision) {
        throw new Error("Activate the current routine before running it.");
      }
      for (const slot of routineSlots(routine.template)) {
        if (typeof inputs[slot] !== "string" || !(inputs[slot] as string).trim() || (inputs[slot] as string).length > 1000) {
          throw new Error("Fill in " + slot);
        }
      }
      const text = routine.template.replace(/\{\{([a-z][a-z0-9_]{0,31})\}\}/g, (_, slot: string) => inputs[slot] as string);
      if (text.length > 12000) throw new Error("Request too long");
      const run: RoutineRun = { id: requestId, routineId: id, revision, session, text, status: "dispatching" };
      this.event(db, "user_confirmed_intention", { action: "run", run });
      return { run, fresh: true };
    });
  }

  settle(run: RoutineRun, receipt?: string): RoutineRun {
    return this.use(db => {
      const current = this.state(db).runs.get(run.id);
      if (!current) throw new Error("Run data was forgotten; check the conversation for delivery.");
      if (current.status !== "dispatching") return current;
      const next: RoutineRun = { ...current, status: receipt ? "submitted" : "unknown", ...(receipt ? { receipt } : {}) };
      this.event(db, "egress_receipt", { action: "run", run: next });
      return next;
    });
  }
}
