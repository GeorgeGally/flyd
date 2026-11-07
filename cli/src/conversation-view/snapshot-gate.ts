// One expensive read at a time, shared by everyone who asks. Firstmate's fleet
// snapshot forks a crew-state check per task; started again before the last one
// ends (a timer tick, a job report, each client's answer), the runs stack up and
// a loaded machine only gets slower. The gate keeps one run in flight, serves its
// result for a short window after it ends, and after a slow run waits in
// proportion to how long it took before an unforced run may start again.

export interface SnapshotGateOptions {
  /** How long a finished run's result is served to every caller, fresh or not. */
  cacheMs: number;
  /** After a run of d ms, an unforced run waits slowFactor × d (never under cacheMs). */
  slowFactor: number;
  /** The longest that back-off may grow. */
  maxBackoffMs: number;
}

export class SnapshotGate<T> {
  private inFlight?: Promise<T>;
  private last?: { value: T; endedAt: number; durationMs: number };

  constructor(private readonly options: SnapshotGateOptions) {}

  /** Whether a run is in flight now. */
  get running(): boolean {
    return Boolean(this.inFlight);
  }

  /** The earliest time an unforced run may start: the cache window, or the slow-run back-off when longer. */
  nextRunAt(): number {
    if (!this.last) return 0;
    const backoff = Math.min(this.options.maxBackoffMs, this.options.slowFactor * this.last.durationMs);
    return this.last.endedAt + Math.max(this.options.cacheMs, backoff);
  }

  /**
   * The shared read. A caller that comes while a run is in flight gets that run's
   * result; inside the window after one ends it gets the kept result; otherwise a
   * run starts. `fresh` skips the slow-run back-off but never the cache window or
   * an in-flight run. A run that rejects keeps nothing, so the next caller retries.
   */
  read(run: () => Promise<T>, { fresh = false }: { fresh?: boolean } = {}): Promise<T> {
    if (this.inFlight) return this.inFlight;
    const now = Date.now();
    if (this.last && now < (fresh ? this.last.endedAt + this.options.cacheMs : this.nextRunAt())) {
      return Promise.resolve(this.last.value);
    }
    const flight = (async () => {
      try {
        const value = await run();
        const endedAt = Date.now();
        this.last = { value, endedAt, durationMs: Math.max(0, endedAt - now) };
        return value;
      } finally {
        this.inFlight = undefined;
      }
    })();
    this.inFlight = flight;
    return flight;
  }
}
