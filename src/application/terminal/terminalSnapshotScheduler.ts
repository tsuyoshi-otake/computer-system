export type EagerSnapshotRequest = "deduplicated" | "missing" | "queued";

export type EagerSnapshotCompletion =
  "detached" | "emitted" | "exhausted" | "missing" | "retrying";

export interface TerminalSnapshotSchedulerOptions {
  readonly maximumEagerAttempts: number;
  readonly maximumEagerPerPass: number;
  readonly maximumPeriodicPerPass: number;
}

/**
 * Keeps tick work bounded while allowing interactive sessions to bypass the
 * periodic round-robin delay. Attach/detach are control-path operations;
 * periodic and eager batches are the production hot paths.
 */
export class TerminalSnapshotScheduler {
  private readonly active = new Set<string>();
  private readonly activeOrder: string[] = [];
  private readonly eagerAttempts = new Map<string, number>();
  private readonly eagerQueue = new Set<string>();
  private periodicCursor = 0;

  constructor(private readonly options: TerminalSnapshotSchedulerOptions) {
    requirePositiveInteger(
      options.maximumEagerAttempts,
      "Maximum eager snapshot attempts",
    );
    requirePositiveInteger(
      options.maximumEagerPerPass,
      "Maximum eager snapshots per pass",
    );
    requirePositiveInteger(
      options.maximumPeriodicPerPass,
      "Maximum periodic snapshots per pass",
    );
  }

  get activeCount(): number {
    return this.active.size;
  }

  get pendingEagerCount(): number {
    return this.eagerAttempts.size;
  }

  attach(sessionId: string): void {
    if (this.active.has(sessionId)) {
      throw new Error(
        `Terminal snapshot session ${sessionId} is already active`,
      );
    }
    this.active.add(sessionId);
    this.activeOrder.push(sessionId);
  }

  detach(sessionId: string): boolean {
    if (!this.active.delete(sessionId)) return false;
    this.eagerAttempts.delete(sessionId);
    this.eagerQueue.delete(sessionId);

    const index = this.activeOrder.indexOf(sessionId);
    if (index >= 0) {
      this.activeOrder.splice(index, 1);
      if (index < this.periodicCursor) this.periodicCursor -= 1;
    }
    if (this.activeOrder.length === 0) this.periodicCursor = 0;
    else this.periodicCursor %= this.activeOrder.length;
    return true;
  }

  requestEager(sessionId: string): EagerSnapshotRequest {
    if (!this.active.has(sessionId)) return "missing";
    const outcome = this.eagerAttempts.has(sessionId)
      ? "deduplicated"
      : "queued";
    this.eagerAttempts.set(sessionId, this.options.maximumEagerAttempts);
    this.eagerQueue.add(sessionId);
    return outcome;
  }

  takeEagerBatch(): readonly string[] {
    const batch: string[] = [];
    for (const sessionId of this.eagerQueue) {
      this.eagerQueue.delete(sessionId);
      if (this.active.has(sessionId) && this.eagerAttempts.has(sessionId)) {
        batch.push(sessionId);
      }
      if (batch.length >= this.options.maximumEagerPerPass) break;
    }
    return batch;
  }

  completeEager(
    sessionId: string,
    snapshotChanged: boolean,
  ): EagerSnapshotCompletion {
    if (!this.active.has(sessionId)) {
      this.eagerAttempts.delete(sessionId);
      this.eagerQueue.delete(sessionId);
      return "detached";
    }
    const remaining = this.eagerAttempts.get(sessionId);
    if (remaining === undefined) return "missing";
    if (snapshotChanged) {
      this.eagerAttempts.delete(sessionId);
      return "emitted";
    }
    if (remaining <= 1) {
      this.eagerAttempts.delete(sessionId);
      return "exhausted";
    }
    this.eagerAttempts.set(sessionId, remaining - 1);
    this.eagerQueue.add(sessionId);
    return "retrying";
  }

  takePeriodicBatch(): readonly string[] {
    if (this.activeOrder.length === 0) {
      this.periodicCursor = 0;
      return [];
    }
    const count = Math.min(
      this.options.maximumPeriodicPerPass,
      this.activeOrder.length,
    );
    const batch: string[] = [];
    for (let index = 0; index < count; index += 1) {
      const sessionId = this.activeOrder[this.periodicCursor];
      this.periodicCursor = (this.periodicCursor + 1) % this.activeOrder.length;
      if (sessionId !== undefined) batch.push(sessionId);
    }
    return batch;
  }
}

function requirePositiveInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive integer`);
  }
}
