import type {
  DisplayDevice,
  DisplayState,
  DisplayTileDelta,
} from "../../domain/display/displayDevice.js";
import type {
  DisplayModeSpecification,
  DisplayProfileSpecification,
} from "../../domain/display/displayProfile.js";

export interface ComputerDisplayDeltaBrokerOptions {
  readonly maximumComputersPerPass?: number;
  readonly maximumPayloadBytesPerPass?: number;
  readonly maximumTilesPerComputerBatch?: number;
  readonly maximumTilesPerPass?: number;
}

export type DisplayStreamState =
  "idle" | "keyframe_pending" | "keyframe_emitting" | "resync_queued";

export interface ComputerDisplayUpdate {
  readonly schema: 1;
  readonly computerId: string;
  readonly displayRevision: number;
  readonly epoch: number;
  readonly kind: "delta" | "keyframe" | "state";
  readonly mode: DisplayModeSpecification | undefined;
  readonly outcome: "complete" | "pending";
  readonly profile: DisplayProfileSpecification;
  readonly remaining: number;
  readonly sequence: number;
  readonly state: DisplayState;
  readonly tiles: readonly DisplayTileDelta[];
}

export interface ComputerDisplayPublication {
  readonly consumerIds: readonly string[];
  readonly update: ComputerDisplayUpdate;
}

export type DisplayConsumerAttachResult =
  | {
      readonly outcome: "attached" | "display_replaced";
      readonly consumerCount: number;
      readonly epoch: number;
    }
  | {
      readonly outcome: "already_attached";
      readonly consumerCount: number;
      readonly epoch: number;
    };

export type DisplayConsumerDetachResult =
  | { readonly outcome: "detached"; readonly consumerCount: number }
  | { readonly outcome: "released"; readonly consumerCount: 0 }
  | { readonly outcome: "not_attached" | "not_found" };

export type DisplayResyncResult =
  | { readonly outcome: "queued"; readonly streamState: DisplayStreamState }
  | { readonly outcome: "not_attached" | "not_found" };

export interface ComputerDisplayBrokerPass {
  readonly inspectedComputers: number;
  readonly outcome: "budget_exhausted" | "idle" | "published";
  readonly payloadBytes: number;
  readonly publications: readonly ComputerDisplayPublication[];
  readonly tiles: number;
}

interface ComputerDisplayEntry {
  readonly computerId: string;
  readonly consumers: Set<string>;
  display: DisplayDevice;
  epoch: number;
  lastModeId: string | undefined;
  lastStateKey: string | undefined;
  sequence: number;
  streamState: DisplayStreamState;
}

const defaultMaximumComputersPerPass = 8;
const defaultMaximumPayloadBytesPerPass = 32 * 1_024;
const defaultMaximumTilesPerComputerBatch = 64;
const defaultMaximumTilesPerPass = 128;
const maximumTilePayloadBytes = 16 * 16;

/**
 * Owns destructive display drains once per Computer and fans each immutable
 * result out to all attached consumers. Processing cost is O(D + S), where D
 * is the bounded number of emitted tiles and S is the number of consumers for
 * the Computers actually published during this pass.
 */
export class ComputerDisplayDeltaBroker {
  private readonly entries = new Map<string, ComputerDisplayEntry>();
  private readonly activeComputerIds: string[] = [];
  private readonly activeComputerIndexes = new Map<string, number>();
  private readonly maximumComputersPerPass: number;
  private readonly maximumPayloadBytesPerPass: number;
  private readonly maximumTilesPerComputerBatch: number;
  private readonly maximumTilesPerPass: number;
  private cursor = 0;

  constructor(options: ComputerDisplayDeltaBrokerOptions = {}) {
    this.maximumComputersPerPass =
      options.maximumComputersPerPass ?? defaultMaximumComputersPerPass;
    this.maximumPayloadBytesPerPass =
      options.maximumPayloadBytesPerPass ?? defaultMaximumPayloadBytesPerPass;
    this.maximumTilesPerComputerBatch =
      options.maximumTilesPerComputerBatch ??
      defaultMaximumTilesPerComputerBatch;
    this.maximumTilesPerPass =
      options.maximumTilesPerPass ?? defaultMaximumTilesPerPass;
    requirePositiveInteger(
      this.maximumComputersPerPass,
      "Maximum Computers per display pass",
    );
    requirePositiveInteger(
      this.maximumPayloadBytesPerPass,
      "Maximum display payload bytes per pass",
    );
    requirePositiveInteger(
      this.maximumTilesPerComputerBatch,
      "Maximum display tiles per Computer batch",
    );
    requirePositiveInteger(
      this.maximumTilesPerPass,
      "Maximum display tiles per pass",
    );
    if (this.maximumPayloadBytesPerPass < maximumTilePayloadBytes) {
      throw new RangeError(
        `Maximum display payload bytes per pass must be at least ${String(maximumTilePayloadBytes)}`,
      );
    }
  }

  get computerCount(): number {
    return this.entries.size;
  }

  attach(
    computerId: string,
    consumerId: string,
    display: DisplayDevice,
  ): DisplayConsumerAttachResult {
    requireIdentifier(computerId, "Computer ID");
    requireIdentifier(consumerId, "Display consumer ID");
    const existing = this.entries.get(computerId);
    if (existing === undefined) {
      const entry: ComputerDisplayEntry = {
        computerId,
        consumers: new Set([consumerId]),
        display,
        epoch: 1,
        lastModeId: display.activeMode?.id,
        lastStateKey: undefined,
        sequence: 0,
        streamState: isActive(display) ? "keyframe_pending" : "idle",
      };
      this.entries.set(computerId, entry);
      this.addActiveComputer(computerId);
      return { outcome: "attached", consumerCount: 1, epoch: entry.epoch };
    }

    const alreadyAttached = existing.consumers.has(consumerId);
    existing.consumers.add(consumerId);
    if (existing.display !== display) {
      existing.display = display;
      existing.epoch += 1;
      existing.lastModeId = display.activeMode?.id;
      existing.lastStateKey = undefined;
      existing.streamState = isActive(display) ? "keyframe_pending" : "idle";
      return {
        outcome: "display_replaced",
        consumerCount: existing.consumers.size,
        epoch: existing.epoch,
      };
    }
    if (!alreadyAttached) this.queueKeyframe(existing);
    return {
      outcome: alreadyAttached ? "already_attached" : "attached",
      consumerCount: existing.consumers.size,
      epoch: existing.epoch,
    };
  }

  detach(computerId: string, consumerId: string): DisplayConsumerDetachResult {
    const entry = this.entries.get(computerId);
    if (entry === undefined) return { outcome: "not_found" };
    if (!entry.consumers.delete(consumerId)) return { outcome: "not_attached" };
    if (entry.consumers.size > 0) {
      return { outcome: "detached", consumerCount: entry.consumers.size };
    }
    this.entries.delete(computerId);
    this.removeActiveComputer(computerId);
    return { outcome: "released", consumerCount: 0 };
  }

  requestResync(computerId: string, consumerId: string): DisplayResyncResult {
    const entry = this.entries.get(computerId);
    if (entry === undefined) return { outcome: "not_found" };
    if (!entry.consumers.has(consumerId)) return { outcome: "not_attached" };
    this.queueKeyframe(entry);
    return { outcome: "queued", streamState: entry.streamState };
  }

  process(): ComputerDisplayBrokerPass {
    const publications: ComputerDisplayPublication[] = [];
    let inspectedComputers = 0;
    let payloadBytes = 0;
    let tiles = 0;
    const inspectionLimit = Math.min(
      this.maximumComputersPerPass,
      this.activeComputerIds.length,
    );

    while (
      inspectedComputers < inspectionLimit &&
      this.activeComputerIds.length > 0
    ) {
      const computerId = this.activeComputerIds[this.cursor]!;
      this.cursor = (this.cursor + 1) % this.activeComputerIds.length;
      inspectedComputers += 1;
      const entry = this.entries.get(computerId);
      if (entry === undefined) continue;

      const modeId = entry.display.activeMode?.id;
      if (entry.lastModeId !== modeId) {
        entry.lastModeId = modeId;
        entry.epoch += 1;
        entry.lastStateKey = undefined;
      }
      const stateKey = displayStateKey(entry.display);
      if (entry.lastStateKey !== stateKey) {
        entry.lastStateKey = stateKey;
        if (isActive(entry.display)) this.queueKeyframe(entry);
        else entry.streamState = "idle";
        publications.push(this.publishState(entry));
        continue;
      }
      if (!isActive(entry.display)) continue;

      if (entry.streamState === "keyframe_pending") {
        entry.display.requestKeyframe();
        entry.streamState = "keyframe_emitting";
      }
      const remainingTileBudget = this.maximumTilesPerPass - tiles;
      const remainingPayloadBudget =
        this.maximumPayloadBytesPerPass - payloadBytes;
      const payloadTileLimit = Math.floor(
        remainingPayloadBudget / maximumTilePayloadBytes,
      );
      const tileLimit = Math.min(
        remainingTileBudget,
        payloadTileLimit,
        this.maximumTilesPerComputerBatch,
        entry.display.maximumBatchTiles,
      );
      if (tileLimit <= 0) break;
      if (entry.display.dirtyTileCount === 0) continue;

      const kind =
        entry.streamState === "keyframe_emitting" ||
        entry.streamState === "resync_queued"
          ? "keyframe"
          : "delta";
      const batch = entry.display.takeDirtyTiles(tileLimit);
      tiles += batch.tiles.length;
      payloadBytes += batch.payloadBytes;
      entry.sequence += 1;
      publications.push({
        consumerIds: [...entry.consumers],
        update: {
          schema: 1,
          computerId: entry.computerId,
          displayRevision: batch.revision,
          epoch: entry.epoch,
          kind,
          mode: entry.display.activeMode,
          outcome: batch.outcome,
          profile: entry.display.profile,
          remaining: batch.remaining,
          sequence: entry.sequence,
          state: entry.display.state,
          tiles: batch.tiles,
        },
      });
      if (batch.outcome === "complete" && kind === "keyframe") {
        if (entry.streamState === "resync_queued") {
          entry.streamState = "keyframe_pending";
        } else {
          entry.streamState = "idle";
        }
      }
    }

    const budgetExhausted =
      tiles >= this.maximumTilesPerPass ||
      this.maximumPayloadBytesPerPass - payloadBytes < maximumTilePayloadBytes;
    return {
      inspectedComputers,
      outcome:
        publications.length === 0
          ? "idle"
          : budgetExhausted
            ? "budget_exhausted"
            : "published",
      payloadBytes,
      publications,
      tiles,
    };
  }

  private addActiveComputer(computerId: string): void {
    this.activeComputerIndexes.set(computerId, this.activeComputerIds.length);
    this.activeComputerIds.push(computerId);
  }

  private publishState(
    entry: ComputerDisplayEntry,
  ): ComputerDisplayPublication {
    entry.sequence += 1;
    return {
      consumerIds: [...entry.consumers],
      update: {
        schema: 1,
        computerId: entry.computerId,
        displayRevision: entry.display.revision,
        epoch: entry.epoch,
        kind: "state",
        mode: entry.display.activeMode,
        outcome: "complete",
        profile: entry.display.profile,
        remaining: entry.display.dirtyTileCount,
        sequence: entry.sequence,
        state: entry.display.state,
        tiles: [],
      },
    };
  }

  private queueKeyframe(entry: ComputerDisplayEntry): void {
    if (!isActive(entry.display)) {
      entry.streamState = "idle";
      return;
    }
    entry.streamState =
      entry.streamState === "keyframe_emitting" ||
      entry.streamState === "resync_queued"
        ? "resync_queued"
        : "keyframe_pending";
  }

  private removeActiveComputer(computerId: string): void {
    const index = this.activeComputerIndexes.get(computerId);
    if (index === undefined) return;
    const lastIndex = this.activeComputerIds.length - 1;
    const lastId = this.activeComputerIds[lastIndex]!;
    if (index !== lastIndex) {
      this.activeComputerIds[index] = lastId;
      this.activeComputerIndexes.set(lastId, index);
    }
    this.activeComputerIds.pop();
    this.activeComputerIndexes.delete(computerId);
    if (this.activeComputerIds.length === 0) this.cursor = 0;
    else this.cursor %= this.activeComputerIds.length;
  }
}

function displayStateKey(display: DisplayDevice): string {
  const state = display.state;
  if (state.kind === "faulted") return `faulted:${state.message}`;
  return `${state.kind}:${"modeId" in state ? state.modeId : ""}`;
}

function isActive(display: DisplayDevice): boolean {
  return display.activeMode !== undefined;
}

function requireIdentifier(value: string, label: string): void {
  if (value.length === 0 || value.length > 128) {
    throw new TypeError(`${label} must contain 1..128 characters`);
  }
}

function requirePositiveInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive integer`);
  }
}
