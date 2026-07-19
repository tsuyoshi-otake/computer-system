const memoryLeaseBrand: unique symbol = Symbol("MemoryLease");

export const guestRamOwnerCategories = Object.freeze([
  "os",
  "driver",
  "compiler",
  "linker",
  "editor",
  "ide",
  "process",
] as const);

export type GuestRamOwnerCategory = (typeof guestRamOwnerCategories)[number];

export type LegacyGuestRamOwner =
  | "compiler-asm"
  | "compiler-basic"
  | "compiler-c"
  | "compiler-cpp"
  | "dos-editor"
  | "dos-qbasic"
  | "dos-resident"
  | "dos-toolchain-ide"
  | "linker"
  | "program-list"
  | "vi";

export interface GuestRamOwnerDescriptor {
  readonly category: GuestRamOwnerCategory;
  readonly displayName: string;
  readonly instanceId?: string;
  readonly moduleId: string;
}

export type GuestRamOwner = LegacyGuestRamOwner | GuestRamOwnerDescriptor;

/** A descriptor cloned, validated, and frozen by normalizeGuestRamOwner(). */
export type GuestRamOwnerIdentity = Readonly<GuestRamOwnerDescriptor>;

export const guestRamOwnerValidationLimits = Object.freeze({
  displayNameLength: 96,
  instanceIdLength: 64,
  moduleIdLength: 64,
});

export const legacyGuestRamOwners = Object.freeze([
  "compiler-asm",
  "compiler-basic",
  "compiler-c",
  "compiler-cpp",
  "dos-editor",
  "dos-qbasic",
  "dos-resident",
  "dos-toolchain-ide",
  "linker",
  "program-list",
  "vi",
] as const satisfies readonly LegacyGuestRamOwner[]);

const legacyGuestRamOwnerIdentities: Readonly<
  Record<LegacyGuestRamOwner, GuestRamOwnerIdentity>
> = Object.freeze({
  "compiler-asm": frozenOwnerIdentity("compiler", "csasm", "CS ASM"),
  "compiler-basic": frozenOwnerIdentity("compiler", "csbasic", "CS BASIC"),
  "compiler-c": frozenOwnerIdentity("compiler", "csc", "CS C"),
  "compiler-cpp": frozenOwnerIdentity("compiler", "cscpp", "CS C++"),
  "dos-editor": frozenOwnerIdentity("editor", "edit", "EDIT"),
  "dos-qbasic": frozenOwnerIdentity("ide", "qbasic", "CS QBASIC"),
  "dos-resident": frozenOwnerIdentity(
    "os",
    "dos-resident",
    "DOS system and drivers",
  ),
  "dos-toolchain-ide": frozenOwnerIdentity(
    "ide",
    "pwb",
    "Programmer's WorkBench",
  ),
  linker: frozenOwnerIdentity("linker", "csld", "CS Linker"),
  "program-list": frozenOwnerIdentity(
    "process",
    "program-list",
    "Program List",
  ),
  vi: frozenOwnerIdentity("editor", "vi", "vi"),
});

const legacyGuestRamOwnerByGroup = createLegacyOwnerGroupIndex();
const guestRamOwnerCategorySet = new Set<string>(guestRamOwnerCategories);

/**
 * Converts legacy names or structured descriptors into an immutable identity.
 *
 * Validation reads only the four modeled properties, so work is independent of
 * unrelated properties on an input object. Returned identities never retain
 * the caller's mutable descriptor.
 */
export function normalizeGuestRamOwner(owner: unknown): GuestRamOwnerIdentity {
  if (typeof owner === "string") {
    if (owner.length > guestRamOwnerValidationLimits.moduleIdLength) {
      throw new RangeError("Legacy guest RAM owner exceeds the length limit");
    }
    if (
      !Object.prototype.hasOwnProperty.call(
        legacyGuestRamOwnerIdentities,
        owner,
      )
    ) {
      throw new RangeError("Unknown legacy guest RAM owner");
    }
    return legacyGuestRamOwnerIdentities[owner as LegacyGuestRamOwner];
  }
  if (
    typeof owner !== "object" ||
    owner === null ||
    Array.isArray(owner) ||
    !isPlainObject(owner)
  ) {
    throw new TypeError("Guest RAM owner must be a legacy name or descriptor");
  }

  const descriptor = owner as Readonly<Record<string, unknown>>;
  const category = descriptor.category;
  if (typeof category !== "string" || !guestRamOwnerCategorySet.has(category)) {
    throw new RangeError(
      `Guest RAM owner category must be one of ${guestRamOwnerCategories.join(", ")}`,
    );
  }
  const moduleId = requireModuleId(descriptor.moduleId);
  const displayName = requireDisplayName(descriptor.displayName);
  const instanceIdValue = descriptor.instanceId;
  const instanceId =
    instanceIdValue === undefined
      ? undefined
      : requireInstanceId(instanceIdValue);
  return frozenOwnerIdentity(
    category as GuestRamOwnerCategory,
    moduleId,
    displayName,
    instanceId,
  );
}

export interface MemoryLease {
  readonly [memoryLeaseBrand]: true;
  readonly bytes: number;
  readonly owner: GuestRamOwnerIdentity;
  readonly released: boolean;
  release(): void;
  resize(bytes: number): void;
}

export interface GuestRamOwnerBreakdown {
  readonly bytes: number;
  readonly category: GuestRamOwnerCategory;
  readonly displayName: string;
  readonly leases: number;
  readonly moduleId: string;
  /** Compatibility alias for legacy consumers; prefer category + moduleId. */
  readonly owner: string;
}

export interface GuestRamSnapshot {
  readonly availableBytes: number;
  readonly breakdown: readonly GuestRamOwnerBreakdown[];
  readonly leaseCount: number;
  readonly totalBytes: number;
  readonly usedBytes: number;
}

interface LeaseRecord {
  bytes: number;
  readonly owner: GuestRamOwnerIdentity;
}

export class GuestRamOutOfMemoryError extends Error {
  override readonly name = "GuestRamOutOfMemoryError";

  constructor(
    readonly requestedBytes: number,
    readonly availableBytes: number,
    readonly owner: GuestRamOwnerIdentity,
  ) {
    super(
      `Out of Memory: ${owner.displayName} (${owner.category}/${owner.moduleId}) requested ${String(requestedBytes)} bytes with ${String(availableBytes)} bytes available`,
    );
  }
}

/**
 * Transient per-boot accounting for host-implemented guest-resident components.
 *
 * Cs486Process owns the bounds and contents of each granted linear address
 * space. This ledger owns the corresponding admitted physical working set plus
 * RAM that processes must not see because DOS, editors, and compiler frontends
 * are implemented as host objects rather than bytes inside CS486.
 */
export class GuestRamLedger {
  private readonly leases = new Map<number, LeaseRecord>();
  private nextLeaseId = 1;
  private usedBytesValue = 0;

  constructor(readonly totalBytes: number) {
    requireNonNegativeSafeInteger(totalBytes, "totalBytes");
    if (totalBytes === 0) throw new RangeError("totalBytes must be positive");
  }

  get availableBytes(): number {
    return this.totalBytes - this.usedBytesValue;
  }

  get usedBytes(): number {
    return this.usedBytesValue;
  }

  acquire(bytes: number, owner: GuestRamOwner): MemoryLease {
    requireNonNegativeSafeInteger(bytes, "bytes");
    if (bytes === 0)
      throw new RangeError("Memory lease bytes must be positive");
    const identity = normalizeGuestRamOwner(owner);
    this.requireAvailable(bytes, identity);
    const id = this.nextLeaseId;
    this.nextLeaseId =
      this.nextLeaseId === Number.MAX_SAFE_INTEGER ? 1 : this.nextLeaseId + 1;
    if (this.leases.has(id)) {
      throw new Error("Guest RAM lease identifier space is exhausted");
    }
    this.leases.set(id, { bytes, owner: identity });
    this.usedBytesValue += bytes;
    return new LedgerMemoryLease(
      () => this.leaseBytes(id),
      () => this.release(id),
      (nextBytes) => this.resize(id, nextBytes),
      identity,
    );
  }

  /** O(L + G log G) for L leases and G normalized owner groups. */
  breakdown(): readonly GuestRamOwnerBreakdown[] {
    const owners = new Map<
      string,
      {
        bytes: number;
        readonly category: GuestRamOwnerCategory;
        displayName: string;
        leases: number;
        readonly moduleId: string;
      }
    >();
    for (const record of this.leases.values()) {
      const key = ownerGroupKey(record.owner);
      const current = owners.get(key) ?? {
        bytes: 0,
        category: record.owner.category,
        displayName: breakdownDisplayName(record.owner),
        leases: 0,
        moduleId: record.owner.moduleId,
      };
      current.bytes += record.bytes;
      current.leases += 1;
      const displayName = breakdownDisplayName(record.owner);
      // Category + moduleId is authoritative. A code-unit minimum keeps a
      // conflicting custom display name independent of admission order.
      if (compareText(displayName, current.displayName) < 0) {
        current.displayName = displayName;
      }
      owners.set(key, current);
    }
    return Object.freeze(
      [...owners]
        .map(([, value]) => value)
        .sort(
          (left, right) =>
            compareText(left.category, right.category) ||
            compareText(left.moduleId, right.moduleId),
        )
        .map((value) =>
          Object.freeze({
            bytes: value.bytes,
            category: value.category,
            displayName: value.displayName,
            leases: value.leases,
            moduleId: value.moduleId,
            owner:
              legacyGuestRamOwnerByGroup.get(
                ownerGroupKey(value.category, value.moduleId),
              ) ?? value.moduleId,
          }),
        ),
    );
  }

  snapshot(): GuestRamSnapshot {
    return Object.freeze({
      availableBytes: this.availableBytes,
      breakdown: this.breakdown(),
      leaseCount: this.leases.size,
      totalBytes: this.totalBytes,
      usedBytes: this.usedBytesValue,
    });
  }

  private leaseBytes(id: number): number {
    return this.requireLease(id).bytes;
  }

  private release(id: number): void {
    const record = this.requireLease(id);
    this.leases.delete(id);
    this.usedBytesValue -= record.bytes;
  }

  private resize(id: number, bytes: number): void {
    requireNonNegativeSafeInteger(bytes, "bytes");
    const record = this.requireLease(id);
    const delta = bytes - record.bytes;
    if (delta > 0) this.requireAvailable(delta, record.owner);
    record.bytes = bytes;
    this.usedBytesValue += delta;
  }

  private requireAvailable(bytes: number, owner: GuestRamOwnerIdentity): void {
    if (bytes > this.availableBytes) {
      throw new GuestRamOutOfMemoryError(bytes, this.availableBytes, owner);
    }
  }

  private requireLease(id: number): LeaseRecord {
    const record = this.leases.get(id);
    if (record === undefined)
      throw new Error("Memory lease is already released");
    return record;
  }
}

class LedgerMemoryLease implements MemoryLease {
  readonly [memoryLeaseBrand] = true as const;
  private releasedValue = false;

  constructor(
    private readonly readBytes: () => number,
    private readonly releaseLease: () => void,
    private readonly resizeLease: (bytes: number) => void,
    readonly owner: GuestRamOwnerIdentity,
  ) {}

  get bytes(): number {
    return this.releasedValue ? 0 : this.readBytes();
  }

  get released(): boolean {
    return this.releasedValue;
  }

  release(): void {
    if (this.releasedValue) throw new Error("Memory lease is already released");
    this.releaseLease();
    this.releasedValue = true;
  }

  resize(bytes: number): void {
    if (this.releasedValue) throw new Error("Memory lease is already released");
    this.resizeLease(bytes);
  }
}

function requireNonNegativeSafeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative safe integer`);
  }
}

const moduleIdPattern = /^[a-z0-9][a-z0-9._-]*$/u;
const instanceIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u;

function requireModuleId(value: unknown): string {
  return requireOwnerText(
    value,
    "moduleId",
    guestRamOwnerValidationLimits.moduleIdLength,
    moduleIdPattern,
  );
}

function requireDisplayName(value: unknown): string {
  const displayName = requireOwnerText(
    value,
    "displayName",
    guestRamOwnerValidationLimits.displayNameLength,
  );
  if (hasControlCharacter(displayName)) {
    throw new RangeError(
      "Guest RAM owner displayName contains a control character",
    );
  }
  return displayName;
}

function requireInstanceId(value: unknown): string {
  return requireOwnerText(
    value,
    "instanceId",
    guestRamOwnerValidationLimits.instanceIdLength,
    instanceIdPattern,
  );
}

function requireOwnerText(
  value: unknown,
  field: "displayName" | "instanceId" | "moduleId",
  maximumLength: number,
  pattern?: RegExp,
): string {
  if (typeof value !== "string") {
    throw new TypeError(`Guest RAM owner ${field} must be a string`);
  }
  if (value.length === 0 || value.length > maximumLength) {
    throw new RangeError(
      `Guest RAM owner ${field} must contain 1..${String(maximumLength)} characters`,
    );
  }
  if (value.trim() !== value) {
    throw new RangeError(
      `Guest RAM owner ${field} must not have surrounding whitespace`,
    );
  }
  if (pattern !== undefined && !pattern.test(value)) {
    throw new RangeError(`Guest RAM owner ${field} has an invalid format`);
  }
  return value;
}

function isPlainObject(value: object): boolean {
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

function frozenOwnerIdentity(
  category: GuestRamOwnerCategory,
  moduleId: string,
  displayName: string,
  instanceId?: string,
): GuestRamOwnerIdentity {
  return Object.freeze(
    instanceId === undefined
      ? { category, displayName, moduleId }
      : { category, displayName, instanceId, moduleId },
  );
}

function createLegacyOwnerGroupIndex(): ReadonlyMap<
  string,
  LegacyGuestRamOwner
> {
  const index = new Map<string, LegacyGuestRamOwner>();
  for (const owner of legacyGuestRamOwners) {
    const key = ownerGroupKey(legacyGuestRamOwnerIdentities[owner]);
    if (index.has(key)) {
      throw new Error("Legacy guest RAM owner mappings must be unique");
    }
    index.set(key, owner);
  }
  return index;
}

function ownerGroupKey(owner: GuestRamOwnerIdentity): string;
function ownerGroupKey(
  category: GuestRamOwnerCategory,
  moduleId: string,
): string;
function ownerGroupKey(
  ownerOrCategory: GuestRamOwnerIdentity | GuestRamOwnerCategory,
  moduleId?: string,
): string {
  if (typeof ownerOrCategory !== "string") {
    return `${ownerOrCategory.category}\u0000${ownerOrCategory.moduleId}`;
  }
  if (moduleId === undefined) {
    throw new Error("Guest RAM owner group moduleId is required");
  }
  return `${ownerOrCategory}\u0000${moduleId}`;
}

function breakdownDisplayName(owner: GuestRamOwnerIdentity): string {
  const legacy = legacyGuestRamOwnerByGroup.get(ownerGroupKey(owner));
  return legacy === undefined
    ? owner.displayName
    : legacyGuestRamOwnerIdentities[legacy].displayName;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
