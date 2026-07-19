import {
  BoundedIntervalAllocator,
  IntervalAllocationCapacityError,
  IntervalAllocationLimitError,
  type BoundedIntervalAllocation,
  type BoundedIntervalAllocatorSnapshot,
  type IntervalExtentSnapshot,
} from "../../domain/computer/boundedIntervalAllocator.js";
import type {
  GuestRamLedger,
  GuestRamOwnerDescriptor,
  MemoryLease,
} from "../../domain/computer/guestRamLedger.js";
import type {
  DosConfigurationDriverLoadPlan,
  DosMemoryConfigurationPlan,
} from "./dosMemoryConfiguration.js";

const kibibyte = 1_024;
const mebibyte = 1_024 * kibibyte;

export const dosGuestMemoryConstants = Object.freeze({
  alignmentBytes: 16,
  bufferChargeBytes: 528,
  commandBytes: 32 * kibibyte,
  conventionalEndExclusive: 640 * kibibyte,
  diagnosticLimit: 64,
  extendedStart: mebibyte,
  fileChargeBytes: 64,
  hmaBytes: 64 * kibibyte,
  kernelBytes: 16 * kibibyte,
  maxActiveDynamicReservations: 64,
  maxAllocationsPerRegion: 128,
  systemDataBytes: 16 * kibibyte,
  upperEndExclusive: 0xe_0000,
  upperStart: 0xc_0000,
} as const);

const unavailablePhysicalOwner: GuestRamOwnerDescriptor = Object.freeze({
  category: "os",
  displayName: "Reserved/unavailable physical memory",
  moduleId: "physical-unavailable",
});
const moduleIdPattern = /^[a-z0-9][a-z0-9._-]*$/u;

export type DosGuestMemoryState = "active" | "degraded-low";

export type DosGuestMemoryModuleCategory =
  "compiler" | "driver" | "editor" | "ide" | "linker" | "os" | "process";

export type DosGuestMemoryRequestedPlacement =
  "conventional" | "extended-first" | "hma" | "upper";

export type DosGuestMemoryActualPlacement =
  "conventional" | "extended" | "mixed" | "upper";

type AllocatableRegion = "conventional" | "extended" | "upper";

export interface DosGuestMemoryDiagnostic {
  readonly code: string;
  readonly lineNumber: number | null;
  readonly message: string;
}

export interface DosGuestMemoryExtentSnapshot {
  readonly endExclusive: number;
  readonly size: number;
  readonly start: number;
}

export interface DosGuestMemoryRegionSnapshot {
  readonly freeBytes: number;
  readonly freeExtents: readonly DosGuestMemoryExtentSnapshot[];
  readonly largestFreeBlockBytes: number;
  readonly totalBytes: number;
  readonly usedBytes: number;
}

export interface DosGuestMemoryModuleAllocationSnapshot {
  readonly address: number;
  readonly endExclusive: number;
  readonly placement: Exclude<DosGuestMemoryActualPlacement, "mixed">;
  readonly size: number;
}

export interface DosGuestMemoryModuleSnapshot {
  readonly actualPlacement: DosGuestMemoryActualPlacement;
  readonly address: number | null;
  readonly allocations: readonly DosGuestMemoryModuleAllocationSnapshot[];
  readonly category: DosGuestMemoryModuleCategory;
  readonly displayName: string;
  readonly moduleId: string;
  readonly requestedBytes: number;
  readonly requestedPlacement: DosGuestMemoryRequestedPlacement;
  readonly residentBytes: number;
}

export interface DosGuestMemoryFlagsSnapshot {
  readonly dosHigh: boolean;
  readonly dosHighRequested: boolean;
  readonly emm386NoEms: boolean;
  readonly himem: boolean;
  readonly hmaBytes: number;
  readonly umb: boolean;
  readonly xms: boolean;
}

export interface DosGuestMemorySnapshot {
  readonly allocationVisitCount: number;
  readonly diagnostics: readonly DosGuestMemoryDiagnostic[];
  readonly flags: DosGuestMemoryFlagsSnapshot;
  readonly modules: readonly DosGuestMemoryModuleSnapshot[];
  readonly physical: {
    readonly freeBytes: number;
    readonly reservedUnavailableBytes: number;
    readonly totalBytes: number;
    readonly usedBytes: number;
  };
  readonly regions: {
    readonly conventional: DosGuestMemoryRegionSnapshot;
    readonly extended: DosGuestMemoryRegionSnapshot;
    readonly upper: DosGuestMemoryRegionSnapshot;
  };
  readonly state: DosGuestMemoryState;
}

export type DosGuestMemoryConfigureResult =
  | {
      readonly configured: false;
      readonly diagnostics: readonly DosGuestMemoryDiagnostic[];
    }
  | {
      readonly configured: true;
      readonly snapshot: DosGuestMemorySnapshot;
    };

export interface DosGuestMemoryIdentity {
  readonly category: DosGuestMemoryModuleCategory;
  readonly displayName: string;
  readonly instanceId?: string;
  readonly moduleId: string;
}

export interface DosTransientResidentRequest extends DosGuestMemoryIdentity {
  readonly bytes: number;
}

export interface DosProcessGrantRequest {
  readonly displayName: string;
  readonly instanceId?: string;
  readonly linearAddressSpaceBytes: number;
  readonly moduleId: string;
  readonly physicalReservationBytes: number;
}

export interface DosLegacyProcessGrantRequest {
  readonly displayName: string;
  readonly instanceId?: string;
  readonly moduleId: string;
}

export interface DosGuestMemoryReservation {
  readonly released: boolean;
  readonly residentBytes: number;
  release(): void;
}

export interface DosGuestProcessGrant extends DosGuestMemoryReservation {
  readonly allocations: readonly DosGuestMemoryModuleAllocationSnapshot[];
  readonly memoryBytes: number;
  readonly physicalReservationBytes: number;
}

export interface DosGuestMemoryCloseResult {
  readonly alreadyClosed: boolean;
  readonly closed: true;
}

interface RegionAllocators {
  readonly conventional: BoundedIntervalAllocator;
  readonly extended: BoundedIntervalAllocator | null;
  readonly upper: BoundedIntervalAllocator | null;
}

interface AllocationChunk {
  readonly allocation: BoundedIntervalAllocation;
  readonly region: AllocatableRegion;
}

interface ModuleRecord extends DosGuestMemoryIdentity {
  readonly chunks: AllocationChunk[];
  readonly dynamic: boolean;
  lease: MemoryLease | null;
  readonly requestedBytes: number;
  readonly requestedPlacement: DosGuestMemoryRequestedPlacement;
  released: boolean;
}

interface TrialContext {
  readonly allocators: RegionAllocators;
  visitCount: number;
}

interface TrialConfiguration {
  readonly allocators: RegionAllocators;
  readonly diagnostics: readonly DosGuestMemoryDiagnostic[];
  readonly flags: DosGuestMemoryFlagsSnapshot;
  readonly modules: ModuleRecord[];
  readonly reservedUnavailableBytes: number;
  readonly state: DosGuestMemoryState;
  readonly visitCount: number;
}

type ManagerLifecycle =
  "active" | "closed" | "degraded-low" | "new" | "rejected";

export class DosGuestMemoryConfigurationError extends Error {
  override readonly name = "DosGuestMemoryConfigurationError";
}

export class DosGuestMemoryOutOfMemoryError extends Error {
  override readonly name = "DosGuestMemoryOutOfMemoryError";

  constructor(
    readonly requestedBytes: number,
    readonly availableBytes: number,
  ) {
    super(
      `Out of Memory: requested ${String(requestedBytes)} bytes with ${String(availableBytes)} allocatable bytes available`,
    );
  }
}

export class DosGuestMemoryStateError extends Error {
  override readonly name = "DosGuestMemoryStateError";
}

/** Boot-scoped owner of the paragraph-aligned CS-DOS physical map. */
export class DosGuestMemoryManager {
  private lifecycle: ManagerLifecycle = "new";
  private allocators: RegionAllocators | null = null;
  private modules: ModuleRecord[] = [];
  private diagnostics: readonly DosGuestMemoryDiagnostic[] = Object.freeze([]);
  private flags: DosGuestMemoryFlagsSnapshot | null = null;
  private reservedUnavailableBytes = 0;
  private unavailableLease: MemoryLease | null = null;
  private allocationVisitCountValue = 0;
  private activeDynamicReservations = 0;

  constructor(private readonly ledger: GuestRamLedger) {
    if (ledger.usedBytes !== 0) {
      throw new DosGuestMemoryStateError(
        "DOS guest memory manager requires a clean GuestRamLedger",
      );
    }
  }

  configure(plan: DosMemoryConfigurationPlan): DosGuestMemoryConfigureResult {
    if (this.lifecycle !== "new") {
      throw new DosGuestMemoryStateError(
        "DOS guest memory configuration has already been attempted",
      );
    }
    if (this.ledger.usedBytes !== 0) {
      this.lifecycle = "rejected";
      return configurationFailure(
        "configuration-rejected",
        "Guest RAM ledger is no longer clean",
      );
    }
    try {
      validateConfigurationPlan(plan);
      this.commitTrial(this.buildActiveTrial(plan));
    } catch (error: unknown) {
      this.lifecycle = "rejected";
      return configurationFailure(
        "configuration-rejected",
        error instanceof DosGuestMemoryConfigurationError
          ? error.message
          : "DOS memory configuration could not be committed",
      );
    }
    return Object.freeze({ configured: true, snapshot: this.snapshot() });
  }

  configureDegradedMinimal(
    sourceDiagnostics: readonly DosGuestMemoryDiagnostic[] = [],
  ): DosGuestMemorySnapshot {
    if (this.lifecycle !== "new" && this.lifecycle !== "rejected") {
      throw new DosGuestMemoryStateError(
        "DOS guest memory configuration is already finalized",
      );
    }
    if (this.ledger.usedBytes !== 0) {
      throw new DosGuestMemoryStateError(
        "Degraded DOS configuration requires a clean GuestRamLedger",
      );
    }
    const diagnostics = sourceDiagnostics
      .slice(0, dosGuestMemoryConstants.diagnosticLimit - 1)
      .map((diagnostic) =>
        freezeDiagnostic(
          diagnostic.code,
          diagnostic.lineNumber,
          diagnostic.message,
        ),
      );
    diagnostics.push(
      freezeDiagnostic(
        "degraded-minimal",
        null,
        "Invalid CONFIG.SYS; booted the explicit 64 KiB low-memory DOS profile",
      ),
    );
    this.commitTrial(this.buildDegradedTrial(diagnostics));
    return this.snapshot();
  }

  reserveTransientResident(
    request: DosTransientResidentRequest,
  ): DosGuestMemoryReservation {
    this.requireOperational();
    validateIdentity(request);
    requirePositiveSafeInteger(request.bytes, "bytes");
    this.requireDynamicCapacity();
    this.requireUniqueActiveIdentity(
      request.category,
      request.moduleId,
      request.instanceId,
    );

    const alignedBytes = alignUp(request.bytes);
    const chunks = this.allocateOneFromLiveRegions(
      ["extended", "upper", "conventional"],
      alignedBytes,
    );
    if (chunks === null) {
      throw new DosGuestMemoryOutOfMemoryError(
        alignedBytes,
        this.allocatableFreeBytes(),
      );
    }
    let lease: MemoryLease;
    try {
      lease = this.ledger.acquire(
        sumChunkBytes(chunks),
        ledgerOwnerForIdentity(request),
      );
    } catch (error: unknown) {
      releaseChunks(chunks);
      throw error;
    }
    const record: ModuleRecord = {
      ...request,
      chunks,
      dynamic: true,
      lease,
      requestedBytes: request.bytes,
      requestedPlacement: "extended-first",
      released: false,
    };
    this.modules.push(record);
    this.activeDynamicReservations += 1;
    return new ResidentReservationHandle(record, () =>
      this.releaseDynamicRecord(record),
    );
  }

  grantProcess(request: DosProcessGrantRequest): DosGuestProcessGrant {
    this.requireOperational();
    validateIdentity({ ...request, category: "process" });
    requirePositiveSafeInteger(
      request.linearAddressSpaceBytes,
      "linearAddressSpaceBytes",
    );
    requirePositiveSafeInteger(
      request.physicalReservationBytes,
      "physicalReservationBytes",
    );
    this.requireDynamicCapacity();
    this.requireUniqueActiveIdentity(
      "process",
      request.moduleId,
      request.instanceId,
    );

    const alignedBytes = alignUp(request.physicalReservationBytes);
    const chunks = this.allocateChunksFromLiveRegions(alignedBytes);
    let lease: MemoryLease;
    try {
      lease = this.ledger.acquire(
        sumChunkBytes(chunks),
        ledgerOwnerForIdentity({
          category: "process",
          displayName: request.displayName,
          ...(request.instanceId === undefined
            ? {}
            : { instanceId: request.instanceId }),
          moduleId: request.moduleId,
        }),
      );
    } catch (error: unknown) {
      releaseChunks(chunks);
      throw error;
    }
    const record: ModuleRecord = {
      category: "process",
      chunks,
      displayName: request.displayName,
      dynamic: true,
      ...(request.instanceId === undefined
        ? {}
        : { instanceId: request.instanceId }),
      lease,
      moduleId: request.moduleId,
      requestedBytes: request.physicalReservationBytes,
      requestedPlacement: "extended-first",
      released: false,
    };
    this.modules.push(record);
    this.activeDynamicReservations += 1;
    return new ProcessGrantHandle(record, request.linearAddressSpaceBytes, () =>
      this.releaseDynamicRecord(record),
    );
  }

  grantLegacyProcess(
    request: DosLegacyProcessGrantRequest,
  ): DosGuestProcessGrant {
    const freeBytes = this.allocatableFreeBytes();
    if (freeBytes === 0) throw new DosGuestMemoryOutOfMemoryError(1, 0);
    return this.grantProcess({
      ...request,
      linearAddressSpaceBytes: freeBytes,
      physicalReservationBytes: freeBytes,
    });
  }

  snapshot(): DosGuestMemorySnapshot {
    this.requireOperational();
    const state: DosGuestMemoryState =
      this.lifecycle === "active" ? "active" : "degraded-low";
    const allocators = this.allocators!;
    const conventional = freezeRegionSnapshot(
      allocators.conventional.snapshot(),
    );
    const upper = freezeRegionSnapshot(allocators.upper?.snapshot());
    const extended = freezeRegionSnapshot(allocators.extended?.snapshot());
    const regionTotal =
      conventional.totalBytes + upper.totalBytes + extended.totalBytes;
    const regionUsed =
      conventional.usedBytes + upper.usedBytes + extended.usedBytes;
    const regionFree =
      conventional.freeBytes + upper.freeBytes + extended.freeBytes;
    if (
      regionTotal + this.reservedUnavailableBytes !== this.ledger.totalBytes ||
      regionUsed + this.reservedUnavailableBytes !== this.ledger.usedBytes ||
      regionFree !== this.ledger.availableBytes
    ) {
      throw new DosGuestMemoryStateError(
        "DOS memory regions and GuestRamLedger are inconsistent",
      );
    }
    return Object.freeze({
      allocationVisitCount: this.allocationVisitCountValue,
      diagnostics: Object.freeze([...this.diagnostics]),
      flags: Object.freeze({ ...this.flags! }),
      modules: freezeModuleSnapshots(
        this.modules.filter((module) => !module.released),
      ),
      physical: Object.freeze({
        freeBytes: this.ledger.availableBytes,
        reservedUnavailableBytes: this.reservedUnavailableBytes,
        totalBytes: this.ledger.totalBytes,
        usedBytes: this.ledger.usedBytes,
      }),
      regions: Object.freeze({ conventional, extended, upper }),
      state,
    });
  }

  close(): DosGuestMemoryCloseResult {
    if (this.lifecycle === "closed") {
      return Object.freeze({ alreadyClosed: true, closed: true });
    }
    let firstError: unknown;
    for (const module of [...this.modules].reverse()) {
      if (module.released) continue;
      try {
        finalizeModule(module);
      } catch (error: unknown) {
        firstError ??= error;
      }
    }
    if (this.unavailableLease !== null && !this.unavailableLease.released) {
      try {
        this.unavailableLease.release();
      } catch (error: unknown) {
        firstError ??= error;
      }
    }
    this.lifecycle = "closed";
    this.activeDynamicReservations = 0;
    if (this.ledger.usedBytes !== 0) {
      firstError ??= new DosGuestMemoryStateError(
        "GuestRamLedger retained bytes after DOS memory manager close",
      );
    }
    if (firstError !== undefined) throw asError(firstError);
    return Object.freeze({ alreadyClosed: false, closed: true });
  }

  private buildActiveTrial(
    plan: DosMemoryConfigurationPlan,
  ): TrialConfiguration {
    const himem = plan.drivers.some((driver) => driver.kind === "himem");
    const emm386NoEms = plan.drivers.some((driver) => driver.kind === "emm386");
    const umb = emm386NoEms && plan.dos.upperMemory === "enabled";
    const allocators = createRegionAllocators(
      this.ledger.totalBytes,
      umb,
      himem,
    );
    const context: TrialContext = { allocators, visitCount: 0 };
    const modules: ModuleRecord[] = [];
    const diagnostics: DosGuestMemoryDiagnostic[] = [];
    let dosHigh = false;
    try {
      dosHigh = this.allocateDosModules(
        context,
        modules,
        plan.dos.requestedKernelPlacement === "high",
        plan.files,
        plan.buffers,
        diagnostics,
      );
      for (const driver of plan.drivers) {
        modules.push(this.allocateDriver(context, driver, diagnostics));
      }
    } catch (error: unknown) {
      releaseTrialModules(modules);
      throw error;
    }
    const reservedUnavailableBytes = unavailablePhysicalBytes(
      this.ledger.totalBytes,
      allocators,
    );
    return {
      allocators,
      diagnostics: Object.freeze(diagnostics),
      flags: freezeFlags({
        dosHigh,
        dosHighRequested: plan.dos.requestedKernelPlacement === "high",
        emm386NoEms,
        himem,
        hmaBytes: himem
          ? Math.min(
              dosGuestMemoryConstants.hmaBytes,
              allocators.extended?.capacityBytes ?? 0,
            )
          : 0,
        umb,
        xms: himem && (allocators.extended?.capacityBytes ?? 0) > 0,
      }),
      modules,
      reservedUnavailableBytes,
      state: "active",
      visitCount: context.visitCount,
    };
  }

  private buildDegradedTrial(
    diagnostics: readonly DosGuestMemoryDiagnostic[],
  ): TrialConfiguration {
    const allocators = createRegionAllocators(
      this.ledger.totalBytes,
      false,
      false,
    );
    const context: TrialContext = { allocators, visitCount: 0 };
    const modules: ModuleRecord[] = [];
    try {
      this.allocateLowDosModules(context, modules, 0, 0);
    } catch (error: unknown) {
      releaseTrialModules(modules);
      throw error;
    }
    return {
      allocators,
      diagnostics: Object.freeze([...diagnostics]),
      flags: freezeFlags({
        dosHigh: false,
        dosHighRequested: false,
        emm386NoEms: false,
        himem: false,
        hmaBytes: 0,
        umb: false,
        xms: false,
      }),
      modules,
      reservedUnavailableBytes: unavailablePhysicalBytes(
        this.ledger.totalBytes,
        allocators,
      ),
      state: "degraded-low",
      visitCount: context.visitCount,
    };
  }

  private allocateDosModules(
    context: TrialContext,
    modules: ModuleRecord[],
    highRequested: boolean,
    files: number | null,
    buffers: number | null,
    diagnostics: DosGuestMemoryDiagnostic[],
  ): boolean {
    const fileBytes =
      files === null ? 0 : files * dosGuestMemoryConstants.fileChargeBytes;
    const bufferBytes =
      buffers === null
        ? 0
        : buffers * dosGuestMemoryConstants.bufferChargeBytes;
    const highResidentBytes =
      dosGuestMemoryConstants.kernelBytes +
      dosGuestMemoryConstants.systemDataBytes +
      fileBytes +
      bufferBytes;
    const hmaCapacity = Math.min(
      dosGuestMemoryConstants.hmaBytes,
      context.allocators.extended?.capacityBytes ?? 0,
    );
    if (highRequested && highResidentBytes <= hmaCapacity) {
      const highModules: ModuleRecord[] = [];
      try {
        highModules.push(
          requireModuleAllocation(
            context,
            "extended",
            osIdentity("dos-kernel", "CS-DOS kernel"),
            dosGuestMemoryConstants.kernelBytes,
            "hma",
          ),
          requireModuleAllocation(
            context,
            "extended",
            osIdentity("dos-system-data", "CS-DOS system data"),
            dosGuestMemoryConstants.systemDataBytes,
            "hma",
          ),
        );
        if (fileBytes > 0) {
          highModules.push(
            requireModuleAllocation(
              context,
              "extended",
              osIdentity("dos-files", "FILES table"),
              fileBytes,
              "hma",
            ),
          );
        }
        if (bufferBytes > 0) {
          highModules.push(
            requireModuleAllocation(
              context,
              "extended",
              osIdentity("dos-buffers", "BUFFERS data"),
              bufferBytes,
              "hma",
            ),
          );
        }
        const hmaEnd = dosGuestMemoryConstants.extendedStart + hmaCapacity;
        if (
          highModules.some((module) =>
            module.chunks.some(
              ({ allocation }) => allocation.endExclusive > hmaEnd,
            ),
          )
        ) {
          throw new DosGuestMemoryConfigurationError(
            "DOS high-memory data escaped the HMA boundary",
          );
        }
        const command = requireModuleAllocation(
          context,
          "conventional",
          osIdentity("command", "COMMAND.COM"),
          dosGuestMemoryConstants.commandBytes,
          "conventional",
        );
        modules.push(highModules[0]!, command, ...highModules.slice(1));
        return true;
      } catch {
        releaseTrialModules(highModules);
      }
    }
    if (highRequested) {
      diagnostics.push(
        freezeDiagnostic(
          "dos-high-fallback",
          null,
          "DOS=HIGH could not fit in the HMA; kernel and system data loaded low",
        ),
      );
    }
    this.allocateLowDosModules(context, modules, fileBytes, bufferBytes);
    return false;
  }

  private allocateLowDosModules(
    context: TrialContext,
    modules: ModuleRecord[],
    fileBytes: number,
    bufferBytes: number,
  ): void {
    modules.push(
      requireModuleAllocation(
        context,
        "conventional",
        osIdentity("dos-kernel", "CS-DOS kernel"),
        dosGuestMemoryConstants.kernelBytes,
        "conventional",
      ),
      requireModuleAllocation(
        context,
        "conventional",
        osIdentity("command", "COMMAND.COM"),
        dosGuestMemoryConstants.commandBytes,
        "conventional",
      ),
      requireModuleAllocation(
        context,
        "conventional",
        osIdentity("dos-system-data", "CS-DOS system data"),
        dosGuestMemoryConstants.systemDataBytes,
        "conventional",
      ),
    );
    if (fileBytes > 0) {
      modules.push(
        requireModuleAllocation(
          context,
          "conventional",
          osIdentity("dos-files", "FILES table"),
          fileBytes,
          "conventional",
        ),
      );
    }
    if (bufferBytes > 0) {
      modules.push(
        requireModuleAllocation(
          context,
          "conventional",
          osIdentity("dos-buffers", "BUFFERS data"),
          bufferBytes,
          "conventional",
        ),
      );
    }
  }

  private allocateDriver(
    context: TrialContext,
    driver: DosConfigurationDriverLoadPlan,
    diagnostics: DosGuestMemoryDiagnostic[],
  ): ModuleRecord {
    const requestedPlacement =
      driver.placement.requestedPlacement === "upper"
        ? "upper"
        : "conventional";
    const order: readonly AllocatableRegion[] =
      requestedPlacement === "upper"
        ? ["upper", "conventional"]
        : ["conventional"];
    const alignedBytes = alignUp(driver.residentBytes);
    const chunks = allocateOneFromRegions(context, order, alignedBytes);
    if (chunks === null) {
      throw new DosGuestMemoryConfigurationError(
        `${driver.displayName} requires ${String(alignedBytes)} contiguous resident bytes`,
      );
    }
    if (
      requestedPlacement === "upper" &&
      chunks[0]!.region === "conventional"
    ) {
      diagnostics.push(
        freezeDiagnostic(
          "devicehigh-fallback",
          driver.lineNumber,
          `DEVICEHIGH: ${driver.displayName} loaded low; no contiguous UMB block was available`,
        ),
      );
    }
    return {
      category: "driver",
      chunks,
      displayName: driver.displayName,
      dynamic: false,
      lease: null,
      moduleId: driver.moduleId,
      requestedBytes: driver.residentBytes,
      requestedPlacement,
      released: false,
    };
  }

  private commitTrial(trial: TrialConfiguration): void {
    const acquiredLeases: MemoryLease[] = [];
    try {
      if (trial.reservedUnavailableBytes > 0) {
        this.unavailableLease = this.ledger.acquire(
          trial.reservedUnavailableBytes,
          unavailablePhysicalOwner,
        );
        acquiredLeases.push(this.unavailableLease);
      }
      for (const module of trial.modules) {
        module.lease = this.ledger.acquire(
          sumChunkBytes(module.chunks),
          ledgerOwnerForIdentity(module),
        );
        acquiredLeases.push(module.lease);
      }
      if (this.ledger.availableBytes !== allocatorFreeBytes(trial.allocators)) {
        throw new DosGuestMemoryConfigurationError(
          "Physical and address-region totals do not reconcile",
        );
      }
    } catch (error: unknown) {
      for (const lease of acquiredLeases.reverse()) {
        if (!lease.released) lease.release();
      }
      releaseTrialModules(trial.modules);
      this.unavailableLease = null;
      throw error;
    }
    this.allocators = trial.allocators;
    this.modules = trial.modules;
    this.diagnostics = Object.freeze([...trial.diagnostics]);
    this.flags = trial.flags;
    this.reservedUnavailableBytes = trial.reservedUnavailableBytes;
    this.allocationVisitCountValue = trial.visitCount;
    this.lifecycle = trial.state;
  }

  private allocateOneFromLiveRegions(
    order: readonly AllocatableRegion[],
    bytes: number,
  ): AllocationChunk[] | null {
    const allocators = this.allocators!;
    for (const region of order) {
      const allocator = allocatorForRegion(allocators, region);
      if (allocator === null) continue;
      const snapshot = allocator.snapshot();
      this.allocationVisitCountValue += snapshot.freeExtents.length;
      try {
        return [{ allocation: allocator.allocate(bytes), region }];
      } catch (error: unknown) {
        if (
          !(error instanceof IntervalAllocationCapacityError) &&
          !(error instanceof IntervalAllocationLimitError)
        )
          throw error;
      }
    }
    return null;
  }

  private allocateChunksFromLiveRegions(bytes: number): AllocationChunk[] {
    const availableBytes = this.allocatableFreeBytes();
    if (bytes > availableBytes) {
      throw new DosGuestMemoryOutOfMemoryError(bytes, availableBytes);
    }
    let remaining = bytes;
    const chunks: AllocationChunk[] = [];
    try {
      for (const region of ["extended", "upper", "conventional"] as const) {
        const allocator = allocatorForRegion(this.allocators!, region);
        if (allocator === null) continue;
        const extents = allocator.snapshot().freeExtents;
        for (const extent of extents) {
          if (remaining === 0) break;
          this.allocationVisitCountValue += 1;
          const allocation = allocator.allocate(
            Math.min(remaining, extent.size),
          );
          chunks.push({ allocation, region });
          remaining -= allocation.size;
        }
        if (remaining === 0) break;
      }
    } catch (error: unknown) {
      releaseChunks(chunks);
      throw error;
    }
    if (remaining !== 0) {
      releaseChunks(chunks);
      throw new DosGuestMemoryOutOfMemoryError(bytes, availableBytes);
    }
    return chunks;
  }

  private releaseDynamicRecord(record: ModuleRecord): void {
    if (record.released) {
      throw new DosGuestMemoryStateError(
        `Memory reservation ${record.moduleId} is already released`,
      );
    }
    finalizeModule(record);
    this.activeDynamicReservations -= 1;
  }

  private requireOperational(): void {
    if (this.lifecycle !== "active" && this.lifecycle !== "degraded-low") {
      throw new DosGuestMemoryStateError(
        "DOS guest memory manager is not configured and active",
      );
    }
  }

  private requireDynamicCapacity(): void {
    if (
      this.activeDynamicReservations >=
      dosGuestMemoryConstants.maxActiveDynamicReservations
    ) {
      throw new DosGuestMemoryStateError(
        `Active transient/process reservation limit of ${String(dosGuestMemoryConstants.maxActiveDynamicReservations)} has been reached`,
      );
    }
  }

  private requireUniqueActiveIdentity(
    category: DosGuestMemoryModuleCategory,
    moduleId: string,
    instanceId: string | undefined,
  ): void {
    if (
      this.modules.some(
        (module) =>
          !module.released &&
          module.category === category &&
          module.moduleId === moduleId &&
          module.instanceId === instanceId,
      )
    ) {
      throw new DosGuestMemoryStateError(
        `Memory module ${category}:${moduleId} is already active`,
      );
    }
  }

  private allocatableFreeBytes(): number {
    this.requireOperational();
    return allocatorFreeBytes(this.allocators!);
  }
}

class ResidentReservationHandle implements DosGuestMemoryReservation {
  constructor(
    protected readonly record: ModuleRecord,
    private readonly releaseRecord: () => void,
  ) {}

  get released(): boolean {
    return this.record.released;
  }

  get residentBytes(): number {
    return this.released ? 0 : sumChunkBytes(this.record.chunks);
  }

  release(): void {
    this.releaseRecord();
  }
}

class ProcessGrantHandle
  extends ResidentReservationHandle
  implements DosGuestProcessGrant
{
  readonly allocations: readonly DosGuestMemoryModuleAllocationSnapshot[];

  constructor(
    record: ModuleRecord,
    readonly memoryBytes: number,
    releaseRecord: () => void,
  ) {
    super(record, releaseRecord);
    this.allocations = freezeAllocationSnapshots(record.chunks);
  }

  get physicalReservationBytes(): number {
    return this.residentBytes;
  }
}

function validateConfigurationPlan(plan: DosMemoryConfigurationPlan): void {
  if (!Object.isFrozen(plan) || !Object.isFrozen(plan.drivers)) {
    throw new DosGuestMemoryConfigurationError(
      "DOS memory configuration plan must be immutable",
    );
  }
  if (plan.files !== null && (plan.files < 1 || plan.files > 255)) {
    throw new DosGuestMemoryConfigurationError("FILES is outside 1..255");
  }
  if (plan.buffers !== null && (plan.buffers < 1 || plan.buffers > 99)) {
    throw new DosGuestMemoryConfigurationError("BUFFERS is outside 1..99");
  }
  let himem = false;
  let emm386 = false;
  const moduleIds = new Set<string>();
  for (const driver of plan.drivers) {
    requirePositiveSafeInteger(driver.residentBytes, "driver residentBytes");
    if (moduleIds.has(driver.moduleId)) {
      throw new DosGuestMemoryConfigurationError(
        `Duplicate driver module ${driver.moduleId}`,
      );
    }
    moduleIds.add(driver.moduleId);
    if (driver.kind === "himem") {
      if (himem)
        throw new DosGuestMemoryConfigurationError("Duplicate HIMEM.SYS");
      himem = true;
    }
    if (driver.kind === "emm386") {
      if (!himem) {
        throw new DosGuestMemoryConfigurationError(
          "EMM386.EXE NOEMS requires HIMEM.SYS first",
        );
      }
      if (emm386)
        throw new DosGuestMemoryConfigurationError("Duplicate EMM386.EXE");
      if (driver.arguments.length !== 1 || driver.arguments[0] !== "NOEMS") {
        throw new DosGuestMemoryConfigurationError(
          "EMM386.EXE must be configured with NOEMS",
        );
      }
      emm386 = true;
    }
  }
  if (plan.dos.requestedKernelPlacement === "high" && !himem) {
    throw new DosGuestMemoryConfigurationError(
      "DOS=HIGH requires validated HIMEM.SYS",
    );
  }
  if (plan.dos.upperMemory === "enabled" && !emm386) {
    throw new DosGuestMemoryConfigurationError(
      "DOS=UMB requires validated EMM386.EXE NOEMS",
    );
  }
}

function createRegionAllocators(
  totalBytes: number,
  umb: boolean,
  himem: boolean,
): RegionAllocators {
  const conventionalBytes = Math.min(
    totalBytes,
    dosGuestMemoryConstants.conventionalEndExclusive,
  );
  if (conventionalBytes < dosGuestMemoryConstants.alignmentBytes) {
    throw new DosGuestMemoryConfigurationError(
      "Physical RAM is too small for a conventional DOS region",
    );
  }
  const upperBytes = umb
    ? intersectionSize(
        totalBytes,
        dosGuestMemoryConstants.upperStart,
        dosGuestMemoryConstants.upperEndExclusive,
      )
    : 0;
  const extendedBytes = himem
    ? Math.max(0, totalBytes - dosGuestMemoryConstants.extendedStart)
    : 0;
  return {
    conventional: createAllocator(0, conventionalBytes),
    extended:
      extendedBytes >= dosGuestMemoryConstants.alignmentBytes
        ? createAllocator(dosGuestMemoryConstants.extendedStart, extendedBytes)
        : null,
    upper:
      upperBytes >= dosGuestMemoryConstants.alignmentBytes
        ? createAllocator(dosGuestMemoryConstants.upperStart, upperBytes)
        : null,
  };
}

function createAllocator(
  start: number,
  size: number,
): BoundedIntervalAllocator {
  return new BoundedIntervalAllocator({
    alignment: dosGuestMemoryConstants.alignmentBytes,
    maxAllocations: dosGuestMemoryConstants.maxAllocationsPerRegion,
    ranges: [{ size, start }],
  });
}

function intersectionSize(
  totalBytes: number,
  start: number,
  endExclusive: number,
): number {
  return Math.max(0, Math.min(totalBytes, endExclusive) - start);
}

function unavailablePhysicalBytes(
  totalBytes: number,
  allocators: RegionAllocators,
): number {
  return totalBytes - allocatorCapacityBytes(allocators);
}

function allocatorCapacityBytes(allocators: RegionAllocators): number {
  return (
    allocators.conventional.capacityBytes +
    (allocators.upper?.capacityBytes ?? 0) +
    (allocators.extended?.capacityBytes ?? 0)
  );
}

function allocatorFreeBytes(allocators: RegionAllocators): number {
  return (
    allocators.conventional.freeBytes +
    (allocators.upper?.freeBytes ?? 0) +
    (allocators.extended?.freeBytes ?? 0)
  );
}

function allocatorForRegion(
  allocators: RegionAllocators,
  region: AllocatableRegion,
): BoundedIntervalAllocator | null {
  return allocators[region];
}

function allocateOneFromRegions(
  context: TrialContext,
  order: readonly AllocatableRegion[],
  bytes: number,
): AllocationChunk[] | null {
  for (const region of order) {
    const allocator = allocatorForRegion(context.allocators, region);
    if (allocator === null) continue;
    context.visitCount += allocator.snapshot().freeExtents.length;
    try {
      return [{ allocation: allocator.allocate(bytes), region }];
    } catch (error: unknown) {
      if (
        !(error instanceof IntervalAllocationCapacityError) &&
        !(error instanceof IntervalAllocationLimitError)
      )
        throw error;
    }
  }
  return null;
}

function requireModuleAllocation(
  context: TrialContext,
  region: AllocatableRegion,
  identity: DosGuestMemoryIdentity,
  requestedBytes: number,
  requestedPlacement: DosGuestMemoryRequestedPlacement,
): ModuleRecord {
  const chunks = allocateOneFromRegions(
    context,
    [region],
    alignUp(requestedBytes),
  );
  if (chunks === null) {
    throw new DosGuestMemoryConfigurationError(
      `${identity.displayName} requires ${String(alignUp(requestedBytes))} contiguous ${region} bytes`,
    );
  }
  return {
    ...identity,
    chunks,
    dynamic: false,
    lease: null,
    requestedBytes,
    requestedPlacement,
    released: false,
  };
}

function osIdentity(
  moduleId: string,
  displayName: string,
): DosGuestMemoryIdentity {
  return { category: "os", displayName, moduleId };
}

function alignUp(value: number): number {
  requirePositiveSafeInteger(value, "memory bytes");
  const remainder = value % dosGuestMemoryConstants.alignmentBytes;
  if (remainder === 0) return value;
  const result = value + (dosGuestMemoryConstants.alignmentBytes - remainder);
  if (!Number.isSafeInteger(result)) {
    throw new RangeError("Aligned memory bytes must be a safe integer");
  }
  return result;
}

function validateIdentity(identity: DosGuestMemoryIdentity): void {
  if (
    identity.moduleId.length === 0 ||
    identity.moduleId.length > 64 ||
    !moduleIdPattern.test(identity.moduleId)
  ) {
    throw new RangeError(
      "moduleId must be a lowercase stable identifier of at most 64 characters",
    );
  }
  if (
    identity.displayName.length === 0 ||
    identity.displayName.length > 96 ||
    containsControlCharacters(identity.displayName)
  ) {
    throw new RangeError("displayName must contain 1..96 printable characters");
  }
  if (
    identity.instanceId !== undefined &&
    (identity.instanceId.length === 0 ||
      identity.instanceId.length > 64 ||
      containsControlCharacters(identity.instanceId))
  ) {
    throw new RangeError(
      "instanceId must contain 1..64 printable characters when provided",
    );
  }
}

function ledgerOwnerForIdentity(
  identity: DosGuestMemoryIdentity,
): GuestRamOwnerDescriptor {
  return {
    category: identity.category,
    displayName: identity.displayName,
    ...(identity.instanceId === undefined
      ? {}
      : { instanceId: identity.instanceId }),
    moduleId: identity.moduleId,
  };
}

function containsControlCharacters(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const character = value.charCodeAt(index);
    if (character <= 0x1f || character === 0x7f) return true;
  }
  return false;
}

function requirePositiveSafeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive safe integer`);
  }
}

function sumChunkBytes(chunks: readonly AllocationChunk[]): number {
  return chunks.reduce((total, chunk) => total + chunk.allocation.size, 0);
}

function releaseChunks(chunks: readonly AllocationChunk[]): void {
  for (const chunk of [...chunks].reverse()) {
    if (!chunk.allocation.released) chunk.allocation.release();
  }
}

function releaseTrialModules(modules: readonly ModuleRecord[]): void {
  for (const module of [...modules].reverse()) releaseChunks(module.chunks);
}

function finalizeModule(module: ModuleRecord): void {
  let firstError: unknown;
  try {
    releaseChunks(module.chunks);
  } catch (error: unknown) {
    firstError = error;
  }
  if (module.lease !== null && !module.lease.released) {
    try {
      module.lease.release();
    } catch (error: unknown) {
      firstError ??= error;
    }
  }
  module.released =
    module.chunks.every(({ allocation }) => allocation.released) &&
    (module.lease === null || module.lease.released);
  if (firstError !== undefined) throw asError(firstError);
}

function asError(error: unknown): Error {
  return error instanceof Error
    ? error
    : new DosGuestMemoryStateError("Unknown DOS memory finalization failure");
}

function freezeDiagnostic(
  code: string,
  lineNumber: number | null,
  message: string,
): DosGuestMemoryDiagnostic {
  return Object.freeze({
    code: code.slice(0, 64),
    lineNumber,
    message: message.slice(0, 256),
  });
}

function configurationFailure(
  code: string,
  message: string,
): DosGuestMemoryConfigureResult {
  return Object.freeze({
    configured: false,
    diagnostics: Object.freeze([freezeDiagnostic(code, null, message)]),
  });
}

function freezeFlags(
  flags: DosGuestMemoryFlagsSnapshot,
): DosGuestMemoryFlagsSnapshot {
  return Object.freeze({ ...flags });
}

function freezeRegionSnapshot(
  snapshot: BoundedIntervalAllocatorSnapshot | undefined,
): DosGuestMemoryRegionSnapshot {
  if (snapshot === undefined) {
    return Object.freeze({
      freeBytes: 0,
      freeExtents: Object.freeze([]),
      largestFreeBlockBytes: 0,
      totalBytes: 0,
      usedBytes: 0,
    });
  }
  return Object.freeze({
    freeBytes: snapshot.freeBytes,
    freeExtents: Object.freeze(
      snapshot.freeExtents.map((extent) => freezeExtentSnapshot(extent)),
    ),
    largestFreeBlockBytes: snapshot.largestFreeBlockBytes,
    totalBytes: snapshot.capacityBytes,
    usedBytes: snapshot.allocatedBytes,
  });
}

function freezeExtentSnapshot(
  extent: IntervalExtentSnapshot,
): DosGuestMemoryExtentSnapshot {
  return Object.freeze({
    endExclusive: extent.endExclusive,
    size: extent.size,
    start: extent.start,
  });
}

function freezeAllocationSnapshots(
  chunks: readonly AllocationChunk[],
): readonly DosGuestMemoryModuleAllocationSnapshot[] {
  return Object.freeze(
    chunks.map(({ allocation, region }) =>
      Object.freeze({
        address: allocation.start,
        endExclusive: allocation.endExclusive,
        placement: region,
        size: allocation.size,
      }),
    ),
  );
}

function freezeModuleSnapshots(
  modules: readonly ModuleRecord[],
): readonly DosGuestMemoryModuleSnapshot[] {
  const groups = new Map<string, ModuleRecord[]>();
  for (const module of modules) {
    const key = `${module.category}\u0000${module.moduleId}`;
    const group = groups.get(key) ?? [];
    group.push(module);
    groups.set(key, group);
  }
  return Object.freeze(
    [...groups.values()].map((group) => freezeModuleSnapshotGroup(group)),
  );
}

function freezeModuleSnapshotGroup(
  group: readonly ModuleRecord[],
): DosGuestMemoryModuleSnapshot {
  const first = group[0]!;
  const chunks = group.flatMap((module) => module.chunks);
  const allocations = freezeAllocationSnapshots(chunks);
  const placements = new Set(allocations.map(({ placement }) => placement));
  const requestedPlacements = new Set(
    group.map(({ requestedPlacement }) => requestedPlacement),
  );
  return Object.freeze({
    actualPlacement:
      placements.size === 1 ? allocations[0]!.placement : "mixed",
    address: allocations.length === 1 ? allocations[0]!.address : null,
    allocations,
    category: first.category,
    displayName: first.displayName,
    moduleId: first.moduleId,
    requestedBytes: group.reduce(
      (total, module) => total + module.requestedBytes,
      0,
    ),
    requestedPlacement:
      requestedPlacements.size === 1
        ? first.requestedPlacement
        : "extended-first",
    residentBytes: sumChunkBytes(chunks),
  });
}
