import type { BlockDeviceProfile } from "./storageProfiles.js";

export type BlockOperation = "flush" | "read" | "write";

export interface BlockRequest {
  readonly id: string;
  readonly operation: BlockOperation;
  readonly lba: number;
  readonly sectorCount: number;
}

export interface RemovableBlockMedia {
  readonly id: string;
  readonly sectorCount: number;
  readonly writeProtected?: boolean;
}

export interface BlockServiceTiming {
  readonly controllerNanoseconds: bigint;
  readonly headNanoseconds: bigint;
  readonly motorSpinUpNanoseconds: bigint;
  readonly rotationalNanoseconds: bigint;
  readonly seekNanoseconds: bigint;
  readonly transferNanoseconds: bigint;
  readonly writeSettleNanoseconds: bigint;
  readonly totalNanoseconds: bigint;
}

export type BlockTerminalCode =
  | "completed"
  | "device_powered_off"
  | "duplicate_request"
  | "invalid_request"
  | "io_queue_full"
  | "media_changed"
  | "no_media"
  | "write_protected";

export interface BlockCompletion {
  readonly request: BlockRequest;
  readonly outcome: "cancelled" | "completed" | "failed";
  readonly code: BlockTerminalCode;
  readonly mediaGeneration: number;
  readonly startedAtNanoseconds: bigint;
  readonly completedAtNanoseconds: bigint;
  readonly timing: BlockServiceTiming;
}

export type BlockSubmitResult =
  | {
      readonly outcome: "accepted";
      readonly queued: boolean;
      readonly deadlineNanoseconds?: bigint;
    }
  | { readonly outcome: "rejected"; readonly completion: BlockCompletion };

export interface ActiveBlockRequest {
  readonly request: BlockRequest;
  readonly deadlineNanoseconds: bigint;
  readonly bytes: number;
  readonly mediaGeneration: number;
}

export interface BlockDeviceStats {
  readonly accepted: number;
  readonly cancelled: number;
  readonly completed: number;
  readonly failed: number;
  readonly maximumQueueDepth: number;
  readonly readSectors: number;
  readonly rejected: number;
  readonly submitted: number;
  readonly totalDeviceNanoseconds: bigint;
  readonly totalRotationalNanoseconds: bigint;
  readonly totalSeekNanoseconds: bigint;
  readonly writtenSectors: number;
}

export interface BlockDeviceActivity {
  readonly mediaPresent: boolean;
  readonly pendingRequests: number;
  readonly state: "absent" | "idle" | "read" | "write";
}

interface MediaState {
  readonly id: string;
  readonly generation: number;
  readonly sectorCount: number;
  readonly writeProtected: boolean;
}

interface QueuedRequest {
  readonly request: BlockRequest;
  readonly submittedAtNanoseconds: bigint;
  readonly mediaGeneration: number;
}

interface ActiveRequest extends QueuedRequest {
  readonly startedAtNanoseconds: bigint;
  readonly deadlineNanoseconds: bigint;
  readonly timing: BlockServiceTiming;
  readonly finalCylinder: number;
  readonly finalHead: number;
}

const emptyTiming: BlockServiceTiming = Object.freeze({
  controllerNanoseconds: 0n,
  headNanoseconds: 0n,
  motorSpinUpNanoseconds: 0n,
  rotationalNanoseconds: 0n,
  seekNanoseconds: 0n,
  transferNanoseconds: 0n,
  writeSettleNanoseconds: 0n,
  totalNanoseconds: 0n,
});

/** Deterministic O(1) mechanical timing and bounded request queue. */
export class DeterministicBlockDevice {
  private active: ActiveRequest | undefined;
  private readonly queue: QueuedRequest[] = [];
  private readonly requestIds = new Set<string>();
  private media: MediaState | undefined;
  private mediaGenerationValue = 0;
  private currentCylinder = 0;
  private currentHead = 0;
  private motorRunning = false;
  private lastActivityNanoseconds = 0n;
  private acceptedValue = 0;
  private cancelledValue = 0;
  private completedValue = 0;
  private failedValue = 0;
  private maximumQueueDepthValue = 0;
  private readSectorsValue = 0;
  private rejectedValue = 0;
  private submittedValue = 0;
  private totalDeviceNanosecondsValue = 0n;
  private totalRotationalNanosecondsValue = 0n;
  private totalSeekNanosecondsValue = 0n;
  private writtenSectorsValue = 0;

  constructor(readonly profile: BlockDeviceProfile) {
    validateProfile(profile);
    if (!profile.removable) {
      this.mediaGenerationValue = 1;
      this.media = {
        id: `${profile.id}:fixed`,
        generation: this.mediaGenerationValue,
        sectorCount: profile.sectorCount,
        writeProtected: false,
      };
    }
  }

  get mediaGeneration(): number {
    return this.mediaGenerationValue;
  }

  get nextDeadlineNanoseconds(): bigint | undefined {
    return this.active?.deadlineNanoseconds;
  }

  get activity(): BlockDeviceActivity {
    if (this.media === undefined) {
      return { mediaPresent: false, pendingRequests: 0, state: "absent" };
    }
    const operation = this.active?.request.operation;
    return {
      mediaPresent: true,
      pendingRequests: (this.active === undefined ? 0 : 1) + this.queue.length,
      state:
        operation === "read"
          ? "read"
          : operation === "write"
            ? "write"
            : "idle",
    };
  }

  get stats(): BlockDeviceStats {
    return {
      accepted: this.acceptedValue,
      cancelled: this.cancelledValue,
      completed: this.completedValue,
      failed: this.failedValue,
      maximumQueueDepth: this.maximumQueueDepthValue,
      readSectors: this.readSectorsValue,
      rejected: this.rejectedValue,
      submitted: this.submittedValue,
      totalDeviceNanoseconds: this.totalDeviceNanosecondsValue,
      totalRotationalNanoseconds: this.totalRotationalNanosecondsValue,
      totalSeekNanoseconds: this.totalSeekNanosecondsValue,
      writtenSectors: this.writtenSectorsValue,
    };
  }

  insertMedia(media: RemovableBlockMedia): number {
    if (!this.profile.removable) {
      throw new Error("Fixed block-device media cannot be replaced");
    }
    if (this.media !== undefined)
      throw new Error("Block-device media is present");
    if (media.id.length === 0 || media.id.length > 128) {
      throw new RangeError("Block media ID must contain 1..128 characters");
    }
    if (media.sectorCount !== this.profile.sectorCount) {
      throw new RangeError("Block media geometry does not match the device");
    }
    this.mediaGenerationValue += 1;
    this.media = {
      id: media.id,
      generation: this.mediaGenerationValue,
      sectorCount: media.sectorCount,
      writeProtected: media.writeProtected ?? false,
    };
    this.motorRunning = false;
    this.currentCylinder = 0;
    this.currentHead = 0;
    return this.mediaGenerationValue;
  }

  ejectMedia(atNanoseconds: bigint): readonly BlockCompletion[] {
    requireGuestTime(atNanoseconds);
    if (!this.profile.removable) {
      throw new Error("Fixed block-device media cannot be ejected");
    }
    const completions = this.cancelAll("media_changed", atNanoseconds);
    this.media = undefined;
    this.mediaGenerationValue += 1;
    this.motorRunning = false;
    return completions;
  }

  powerOff(atNanoseconds: bigint): readonly BlockCompletion[] {
    requireGuestTime(atNanoseconds);
    this.motorRunning = false;
    return this.cancelAll("device_powered_off", atNanoseconds);
  }

  submit(request: BlockRequest, atNanoseconds: bigint): BlockSubmitResult {
    requireGuestTime(atNanoseconds);
    this.submittedValue += 1;
    const invalidCode = this.validateRequest(request);
    if (invalidCode !== undefined) {
      return this.reject(request, invalidCode, atNanoseconds);
    }
    const media = this.media;
    if (media === undefined)
      return this.reject(request, "no_media", atNanoseconds);
    if (request.operation === "write" && media.writeProtected) {
      return this.reject(request, "write_protected", atNanoseconds);
    }
    if (
      request.operation !== "flush" &&
      request.lba + request.sectorCount > media.sectorCount
    ) {
      return this.reject(request, "invalid_request", atNanoseconds);
    }
    if (
      this.active !== undefined &&
      this.queue.length >= this.profile.queueDepth
    ) {
      return this.reject(request, "io_queue_full", atNanoseconds);
    }

    const queued: QueuedRequest = {
      request: { ...request },
      submittedAtNanoseconds: atNanoseconds,
      mediaGeneration: media.generation,
    };
    this.requestIds.add(request.id);
    this.acceptedValue += 1;
    if (this.active === undefined) {
      this.active = this.start(queued, atNanoseconds);
      return {
        outcome: "accepted",
        queued: false,
        deadlineNanoseconds: this.active.deadlineNanoseconds,
      };
    }
    this.queue.push(queued);
    this.maximumQueueDepthValue = Math.max(
      this.maximumQueueDepthValue,
      this.queue.length,
    );
    return { outcome: "accepted", queued: true };
  }

  peekActive(): ActiveBlockRequest | undefined {
    const active = this.active;
    return active === undefined
      ? undefined
      : {
          request: active.request,
          deadlineNanoseconds: active.deadlineNanoseconds,
          bytes: active.request.sectorCount * this.profile.sectorBytes,
          mediaGeneration: active.mediaGeneration,
        };
  }

  completeOneDue(atNanoseconds: bigint): BlockCompletion | undefined {
    requireGuestTime(atNanoseconds);
    const active = this.active;
    if (active === undefined || active.deadlineNanoseconds > atNanoseconds) {
      return undefined;
    }
    this.active = undefined;
    this.requestIds.delete(active.request.id);
    this.currentCylinder = active.finalCylinder;
    this.currentHead = active.finalHead;
    this.lastActivityNanoseconds = active.deadlineNanoseconds;
    this.completedValue += 1;
    if (active.request.operation === "read") {
      this.readSectorsValue += active.request.sectorCount;
    } else if (active.request.operation === "write") {
      this.writtenSectorsValue += active.request.sectorCount;
    }
    this.totalDeviceNanosecondsValue += active.timing.totalNanoseconds;
    this.totalRotationalNanosecondsValue += active.timing.rotationalNanoseconds;
    this.totalSeekNanosecondsValue += active.timing.seekNanoseconds;

    const completion: BlockCompletion = {
      request: active.request,
      outcome: "completed",
      code: "completed",
      mediaGeneration: active.mediaGeneration,
      startedAtNanoseconds: active.startedAtNanoseconds,
      completedAtNanoseconds: active.deadlineNanoseconds,
      timing: active.timing,
    };
    const next = this.queue.shift();
    if (next !== undefined) {
      this.active = this.start(next, active.deadlineNanoseconds);
    }
    return completion;
  }

  private start(
    request: QueuedRequest,
    availableAtNanoseconds: bigint,
  ): ActiveRequest {
    const startedAtNanoseconds = maximum(
      request.submittedAtNanoseconds,
      availableAtNanoseconds,
    );
    const timing = this.serviceTiming(request.request, startedAtNanoseconds);
    const finalLba =
      request.request.operation === "flush"
        ? 0
        : request.request.lba + request.request.sectorCount - 1;
    const final = this.chs(finalLba);
    return {
      ...request,
      startedAtNanoseconds,
      deadlineNanoseconds: startedAtNanoseconds + timing.totalNanoseconds,
      timing,
      finalCylinder:
        request.request.operation === "flush"
          ? this.currentCylinder
          : final.cylinder,
      finalHead:
        request.request.operation === "flush" ? this.currentHead : final.head,
    };
  }

  private serviceTiming(
    request: BlockRequest,
    startedAtNanoseconds: bigint,
  ): BlockServiceTiming {
    if (request.operation === "flush") {
      return {
        ...emptyTiming,
        controllerNanoseconds: this.profile.controllerNanoseconds,
        totalNanoseconds: this.profile.controllerNanoseconds,
      };
    }

    const start = this.chs(request.lba);
    const end = this.chs(request.lba + request.sectorCount - 1);
    const distance = Math.abs(start.cylinder - this.currentCylinder);
    const seekNanoseconds = this.seekNanoseconds(distance);
    const initialHeadSwitches = start.head === this.currentHead ? 0 : 1;
    const startTrack = Math.floor(
      request.lba / this.profile.geometry.sectorsPerTrack,
    );
    const endTrack = Math.floor(
      (request.lba + request.sectorCount - 1) /
        this.profile.geometry.sectorsPerTrack,
    );
    const trackCrossings = endTrack - startTrack;
    const cylinderCrossings = end.cylinder - start.cylinder;
    const headNanoseconds =
      BigInt(initialHeadSwitches + trackCrossings) *
        this.profile.headSwitchNanoseconds +
      BigInt((distance > 0 ? 1 : 0) + Math.max(0, cylinderCrossings)) *
        this.profile.headSettleNanoseconds;
    const idle = startedAtNanoseconds - this.lastActivityNanoseconds;
    const motorStopped =
      !this.motorRunning ||
      (this.profile.motorIdleNanoseconds > 0n &&
        idle >= this.profile.motorIdleNanoseconds);
    const motorSpinUpNanoseconds = motorStopped
      ? this.profile.motorSpinUpNanoseconds
      : 0n;
    this.motorRunning = true;
    const positionedAt =
      startedAtNanoseconds +
      this.profile.controllerNanoseconds +
      motorSpinUpNanoseconds +
      seekNanoseconds +
      headNanoseconds;
    const rotationalNanoseconds = this.rotationalWaitNanoseconds(
      positionedAt,
      start.sector,
    );
    const bytes = request.sectorCount * this.profile.sectorBytes;
    const transferNanoseconds = ceilDivide(
      BigInt(bytes) * 1_000_000_000n,
      BigInt(this.profile.transferBytesPerSecond),
    );
    const writeSettleNanoseconds =
      request.operation === "write" ? this.profile.writeSettleNanoseconds : 0n;
    const totalNanoseconds =
      this.profile.controllerNanoseconds +
      motorSpinUpNanoseconds +
      seekNanoseconds +
      headNanoseconds +
      rotationalNanoseconds +
      transferNanoseconds +
      writeSettleNanoseconds;
    return {
      controllerNanoseconds: this.profile.controllerNanoseconds,
      headNanoseconds,
      motorSpinUpNanoseconds,
      rotationalNanoseconds,
      seekNanoseconds,
      transferNanoseconds,
      writeSettleNanoseconds,
      totalNanoseconds,
    };
  }

  private seekNanoseconds(distance: number): bigint {
    if (distance === 0) return 0n;
    const maximumDistance = Math.max(1, this.profile.geometry.cylinders - 1);
    const range =
      this.profile.fullStrokeSeekNanoseconds -
      this.profile.trackToTrackSeekNanoseconds;
    return (
      this.profile.trackToTrackSeekNanoseconds +
      (range * BigInt(distance)) / BigInt(maximumDistance)
    );
  }

  private rotationalWaitNanoseconds(
    atNanoseconds: bigint,
    sector: number,
  ): bigint {
    const period = ceilDivide(60_000_000_000n, BigInt(this.profile.rpm));
    const targetPhase =
      (period * BigInt(sector)) / BigInt(this.profile.geometry.sectorsPerTrack);
    const currentPhase = atNanoseconds % period;
    return (targetPhase - currentPhase + period) % period;
  }

  private chs(lba: number): { cylinder: number; head: number; sector: number } {
    const { heads, sectorsPerTrack } = this.profile.geometry;
    const track = Math.floor(lba / sectorsPerTrack);
    return {
      cylinder: Math.floor(track / heads),
      head: track % heads,
      sector: lba % sectorsPerTrack,
    };
  }

  private validateRequest(
    request: BlockRequest,
  ): Exclude<BlockTerminalCode, "completed"> | undefined {
    if (
      request.id.length === 0 ||
      request.id.length > 128 ||
      !Number.isSafeInteger(request.lba) ||
      request.lba < 0 ||
      !Number.isSafeInteger(request.sectorCount) ||
      request.sectorCount < 0 ||
      request.sectorCount > this.profile.maximumRequestSectors ||
      (request.operation === "flush" && request.sectorCount !== 0) ||
      (request.operation !== "flush" && request.sectorCount === 0)
    ) {
      return "invalid_request";
    }
    return this.requestIds.has(request.id) ? "duplicate_request" : undefined;
  }

  private reject(
    request: BlockRequest,
    code: Exclude<BlockTerminalCode, "completed">,
    atNanoseconds: bigint,
  ): BlockSubmitResult {
    this.rejectedValue += 1;
    this.failedValue += 1;
    return {
      outcome: "rejected",
      completion: {
        request: { ...request },
        outcome: "failed",
        code,
        mediaGeneration: this.media?.generation ?? this.mediaGenerationValue,
        startedAtNanoseconds: atNanoseconds,
        completedAtNanoseconds: atNanoseconds,
        timing: emptyTiming,
      },
    };
  }

  private cancelAll(
    code: "device_powered_off" | "media_changed",
    atNanoseconds: bigint,
  ): readonly BlockCompletion[] {
    const pending: Array<ActiveRequest | QueuedRequest> = [];
    if (this.active !== undefined) pending.push(this.active);
    pending.push(...this.queue);
    this.active = undefined;
    this.queue.length = 0;
    const completions = pending.map<BlockCompletion>((item) => {
      this.requestIds.delete(item.request.id);
      this.cancelledValue += 1;
      return {
        request: item.request,
        outcome: "cancelled",
        code,
        mediaGeneration: item.mediaGeneration,
        startedAtNanoseconds: isActiveRequest(item)
          ? item.startedAtNanoseconds
          : item.submittedAtNanoseconds,
        completedAtNanoseconds: atNanoseconds,
        timing: isActiveRequest(item) ? item.timing : emptyTiming,
      };
    });
    return completions;
  }
}

function isActiveRequest(
  request: ActiveRequest | QueuedRequest,
): request is ActiveRequest {
  return "deadlineNanoseconds" in request;
}

function validateProfile(profile: BlockDeviceProfile): void {
  const positiveIntegers = [
    profile.sectorBytes,
    profile.sectorCount,
    profile.geometry.cylinders,
    profile.geometry.heads,
    profile.geometry.sectorsPerTrack,
    profile.rpm,
    profile.transferBytesPerSecond,
    profile.maximumRequestSectors,
  ];
  if (
    positiveIntegers.some((value) => !Number.isSafeInteger(value) || value <= 0)
  ) {
    throw new RangeError("Block-device profile integers must be positive");
  }
  if (!Number.isSafeInteger(profile.queueDepth) || profile.queueDepth < 0) {
    throw new RangeError("Block-device queue depth must be non-negative");
  }
  const geometrySectors =
    profile.geometry.cylinders *
    profile.geometry.heads *
    profile.geometry.sectorsPerTrack;
  if (geometrySectors !== profile.sectorCount) {
    throw new RangeError("Block-device geometry must equal its sector count");
  }
}

function requireGuestTime(value: bigint): void {
  if (value < 0n) throw new RangeError("Guest time must be non-negative");
}

function ceilDivide(numerator: bigint, denominator: bigint): bigint {
  return (numerator + denominator - 1n) / denominator;
}

function maximum(left: bigint, right: bigint): bigint {
  return left > right ? left : right;
}
