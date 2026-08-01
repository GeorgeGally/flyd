export type SleepFn = (milliseconds: number) => Promise<void>;

export interface MinimumIntervalGateOptions {
  minimumIntervalMs: number;
  now?: () => number;
  sleep?: SleepFn;
}

const defaultSleep: SleepFn = (milliseconds) => new Promise((resolve) => {
  const timer = setTimeout(resolve, milliseconds);
  timer.unref?.();
});

/**
 * Serialises requests for one provider and enforces a minimum start interval.
 * Each adapter owns its own gate so credentials and rate state never leak
 * across providers.
 */
export class MinimumIntervalGate {
  private queue: Promise<void> = Promise.resolve();
  private nextAllowedAt = 0;
  private readonly minimumIntervalMs: number;
  private readonly now: () => number;
  private readonly sleep: SleepFn;

  constructor(options: MinimumIntervalGateOptions) {
    this.minimumIntervalMs = Math.max(0, options.minimumIntervalMs);
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? defaultSleep;
  }

  wait(): Promise<void> {
    const task = this.queue.then(async () => {
      const delay = Math.max(0, this.nextAllowedAt - this.now());
      if (delay > 0) await this.sleep(delay);
      this.nextAllowedAt = this.now() + this.minimumIntervalMs;
    });
    this.queue = task.catch(() => undefined);
    return task;
  }
}
