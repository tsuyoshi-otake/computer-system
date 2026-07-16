import type {
  BlockCompletion,
  BlockRequest,
  BlockSubmitResult,
  DeterministicBlockDevice,
  RemovableBlockMedia,
} from "../../domain/storage/blockDevice.js";
import type { TickWorkScope } from "./computerWorkMonitor.js";

export interface BlockIoSchedulerLimits {
  readonly maximumDevices: number;
  readonly maximumCompletionsPerTick: number;
  readonly maximumSectorsPerTick: number;
  readonly maximumBytesPerTick: number;
}

export const defaultBlockIoSchedulerLimits: BlockIoSchedulerLimits = {
  maximumDevices: 4_096,
  maximumCompletionsPerTick: 16,
  maximumSectorsPerTick: 256,
  maximumBytesPerTick: 128 * 1_024,
};

export type ScheduledBlockSubmitResult =
  | {
      readonly outcome: "accepted";
      readonly device: Extract<
        BlockSubmitResult,
        { readonly outcome: "accepted" }
      >;
    }
  | {
      readonly outcome: "rejected";
      readonly reason: "request_limit" | "stopping" | "unknown_device";
    }
  | {
      readonly outcome: "rejected";
      readonly device: Extract<
        BlockSubmitResult,
        { readonly outcome: "rejected" }
      >;
    };

export interface ScheduledBlockCompletion {
  readonly deviceId: string;
  readonly completion: BlockCompletion;
}

export interface BlockIoTickResult {
  readonly completions: readonly ScheduledBlockCompletion[];
  readonly bytes: number;
  readonly sectors: number;
  readonly hostDeferred: boolean;
  readonly budgetDeferred: boolean;
}

export interface BlockIoSchedulerStats {
  readonly accepted: number;
  readonly budgetDeferrals: number;
  readonly completed: number;
  readonly deadlinePops: number;
  readonly hostDeferrals: number;
  readonly maximumPendingDeadlines: number;
  readonly rejected: number;
  readonly registeredDevices: number;
  readonly submitted: number;
}

interface DeadlineEntry {
  readonly deadlineNanoseconds: bigint;
  readonly deviceId: string;
  readonly sequence: number;
}

/** Global due-only queue. Idle devices are retained in a Map and never polled. */
export class BlockIoScheduler {
  private readonly devices = new Map<string, DeterministicBlockDevice>();
  private readonly deadlines: DeadlineEntry[] = [];
  private readonly scheduledDeadline = new Map<string, bigint>();
  private sequence = 0;
  private acceptedValue = 0;
  private budgetDeferralsValue = 0;
  private completedValue = 0;
  private deadlinePopsValue = 0;
  private hostDeferralsValue = 0;
  private maximumPendingDeadlinesValue = 0;
  private rejectedValue = 0;
  private submittedValue = 0;

  constructor(
    readonly limits: BlockIoSchedulerLimits = defaultBlockIoSchedulerLimits,
  ) {
    for (const [name, value] of Object.entries(limits)) {
      if (!Number.isSafeInteger(value) || value <= 0) {
        throw new RangeError(`${name} must be a positive safe integer`);
      }
    }
  }

  get stats(): BlockIoSchedulerStats {
    return {
      accepted: this.acceptedValue,
      budgetDeferrals: this.budgetDeferralsValue,
      completed: this.completedValue,
      deadlinePops: this.deadlinePopsValue,
      hostDeferrals: this.hostDeferralsValue,
      maximumPendingDeadlines: this.maximumPendingDeadlinesValue,
      rejected: this.rejectedValue,
      registeredDevices: this.devices.size,
      submitted: this.submittedValue,
    };
  }

  register(deviceId: string, device: DeterministicBlockDevice): void {
    if (deviceId.length === 0 || deviceId.length > 128) {
      throw new RangeError("Block-device ID must contain 1..128 characters");
    }
    if (this.devices.has(deviceId)) {
      throw new Error(`Block device ${deviceId} is already registered`);
    }
    if (this.devices.size >= this.limits.maximumDevices) {
      throw new Error("Block-device registry capacity exceeded");
    }
    this.devices.set(deviceId, device);
    this.schedule(deviceId, device);
  }

  unregister(
    deviceId: string,
    atNanoseconds: bigint,
  ): readonly ScheduledBlockCompletion[] {
    const device = this.devices.get(deviceId);
    if (device === undefined) return [];
    this.devices.delete(deviceId);
    this.scheduledDeadline.delete(deviceId);
    return device.powerOff(atNanoseconds).map((completion) => ({
      deviceId,
      completion,
    }));
  }

  insertMedia(deviceId: string, media: RemovableBlockMedia): number {
    return this.requireDevice(deviceId).insertMedia(media);
  }

  ejectMedia(
    deviceId: string,
    atNanoseconds: bigint,
  ): readonly ScheduledBlockCompletion[] {
    const device = this.requireDevice(deviceId);
    const completions = device.ejectMedia(atNanoseconds);
    this.scheduledDeadline.delete(deviceId);
    return completions.map((completion) => ({ deviceId, completion }));
  }

  submit(
    deviceId: string,
    request: BlockRequest,
    atNanoseconds: bigint,
  ): ScheduledBlockSubmitResult {
    this.submittedValue += 1;
    const device = this.devices.get(deviceId);
    if (device === undefined) {
      this.rejectedValue += 1;
      return { outcome: "rejected", reason: "unknown_device" };
    }
    const bytes = request.sectorCount * device.profile.sectorBytes;
    if (
      request.sectorCount > this.limits.maximumSectorsPerTick ||
      bytes > this.limits.maximumBytesPerTick
    ) {
      this.rejectedValue += 1;
      return { outcome: "rejected", reason: "request_limit" };
    }
    const result = device.submit(request, atNanoseconds);
    if (result.outcome === "rejected") {
      this.rejectedValue += 1;
      return { outcome: "rejected", device: result };
    }
    this.acceptedValue += 1;
    this.schedule(deviceId, device);
    return { outcome: "accepted", device: result };
  }

  runDue(atNanoseconds: bigint, workScope?: TickWorkScope): BlockIoTickResult {
    if (atNanoseconds < 0n)
      throw new RangeError("Guest time must be non-negative");
    const completions: ScheduledBlockCompletion[] = [];
    let sectors = 0;
    let bytes = 0;
    let hostDeferred = false;
    let budgetDeferred = false;

    while (true) {
      const entry = this.peekCurrentDeadline();
      if (entry === undefined || entry.deadlineNanoseconds > atNanoseconds)
        break;
      const device = this.devices.get(entry.deviceId);
      const active = device?.peekActive();
      if (device === undefined || active === undefined) {
        this.popDeadline();
        continue;
      }
      const nextSectors = sectors + active.request.sectorCount;
      const nextBytes = bytes + active.bytes;
      if (
        completions.length >= this.limits.maximumCompletionsPerTick ||
        nextSectors > this.limits.maximumSectorsPerTick ||
        nextBytes > this.limits.maximumBytesPerTick
      ) {
        this.budgetDeferralsValue += 1;
        budgetDeferred = true;
        break;
      }

      const operation = (): BlockCompletion => {
        const completion = device.completeOneDue(atNanoseconds);
        if (completion === undefined) {
          throw new Error("Due block-device request did not complete");
        }
        return completion;
      };
      let completion: BlockCompletion;
      if (workScope === undefined) {
        completion = operation();
      } else {
        const attempt = workScope.tryRun(
          {
            lane: "block_io",
            deterministicUnits: Math.max(1, active.request.sectorCount),
            computerId: entry.deviceId,
          },
          operation,
        );
        if (attempt.outcome === "deferred") {
          this.hostDeferralsValue += 1;
          hostDeferred = true;
          break;
        }
        completion = attempt.value;
      }

      this.popDeadline();
      this.scheduledDeadline.delete(entry.deviceId);
      this.completedValue += 1;
      sectors = nextSectors;
      bytes = nextBytes;
      completions.push({ deviceId: entry.deviceId, completion });
      this.schedule(entry.deviceId, device);
    }

    return { completions, bytes, sectors, hostDeferred, budgetDeferred };
  }

  private requireDevice(deviceId: string): DeterministicBlockDevice {
    const device = this.devices.get(deviceId);
    if (device === undefined)
      throw new Error(`Unknown block device ${deviceId}`);
    return device;
  }

  private schedule(deviceId: string, device: DeterministicBlockDevice): void {
    const deadlineNanoseconds = device.nextDeadlineNanoseconds;
    if (deadlineNanoseconds === undefined) {
      this.scheduledDeadline.delete(deviceId);
      return;
    }
    if (this.scheduledDeadline.get(deviceId) === deadlineNanoseconds) return;
    this.scheduledDeadline.set(deviceId, deadlineNanoseconds);
    pushHeap(this.deadlines, {
      deadlineNanoseconds,
      deviceId,
      sequence: this.sequence++,
    });
    this.maximumPendingDeadlinesValue = Math.max(
      this.maximumPendingDeadlinesValue,
      this.deadlines.length,
    );
  }

  private peekCurrentDeadline(): DeadlineEntry | undefined {
    while (this.deadlines.length > 0) {
      const entry = this.deadlines[0]!;
      if (
        this.devices.has(entry.deviceId) &&
        this.scheduledDeadline.get(entry.deviceId) === entry.deadlineNanoseconds
      ) {
        return entry;
      }
      this.popDeadline();
    }
    return undefined;
  }

  private popDeadline(): DeadlineEntry | undefined {
    const entry = popHeap(this.deadlines);
    if (entry !== undefined) this.deadlinePopsValue += 1;
    return entry;
  }
}

function deadlineBefore(left: DeadlineEntry, right: DeadlineEntry): boolean {
  return (
    left.deadlineNanoseconds < right.deadlineNanoseconds ||
    (left.deadlineNanoseconds === right.deadlineNanoseconds &&
      left.sequence < right.sequence)
  );
}

function pushHeap(heap: DeadlineEntry[], entry: DeadlineEntry): void {
  heap.push(entry);
  let index = heap.length - 1;
  while (index > 0) {
    const parent = Math.floor((index - 1) / 2);
    if (!deadlineBefore(entry, heap[parent]!)) break;
    heap[index] = heap[parent]!;
    index = parent;
  }
  heap[index] = entry;
}

function popHeap(heap: DeadlineEntry[]): DeadlineEntry | undefined {
  const root = heap[0];
  const last = heap.pop();
  if (root === undefined || last === undefined || heap.length === 0)
    return root;
  let index = 0;
  while (true) {
    const left = index * 2 + 1;
    if (left >= heap.length) break;
    const right = left + 1;
    const child =
      right < heap.length && deadlineBefore(heap[right]!, heap[left]!)
        ? right
        : left;
    if (!deadlineBefore(heap[child]!, last)) break;
    heap[index] = heap[child]!;
    index = child;
  }
  heap[index] = last;
  return root;
}
