import type { SynchronousTransactionOperation } from "../../domain/filesystem/inMemoryFilesystem.js";
import {
  quarantineRejectedAsyncTransaction,
  rejectedAsyncTransactionCount,
} from "../../domain/runtime/transactionQuarantine.js";

export const dosDriveTableSchema = 1 as const;

export type DosDriveErrorCode =
  "invalid_drive" | "media_changed" | "no_media" | "read_only";

export interface DosDriveMediaDefinition {
  readonly generation: number;
  readonly readOnly?: boolean;
  readonly volumeLabel?: string;
}

export interface DosDriveDefinition {
  readonly currentDirectory?: string;
  readonly letter: string;
  readonly media?: DosDriveMediaDefinition;
  readonly mediaGeneration?: number;
}

export interface DosDriveTableCreateOptions {
  readonly activeDrive: string;
  readonly drives: readonly DosDriveDefinition[];
}

export interface DosDriveStateSnapshot {
  readonly currentDirectory: string;
  readonly letter: string;
  readonly mediaGeneration: number;
  readonly mediaPresent: boolean;
  readonly readOnly: boolean;
  readonly volumeLabel: string;
}

export interface DosDriveTableSnapshotV1 {
  readonly activeDrive: string;
  readonly drives: readonly DosDriveStateSnapshot[];
  readonly schema: typeof dosDriveTableSchema;
}

export type DosDriveTableSnapshot = DosDriveTableSnapshotV1;

export class DosDriveError extends Error {
  constructor(
    readonly code: DosDriveErrorCode,
    readonly drive: string,
    readonly expectedGeneration?: number,
    readonly actualGeneration?: number,
  ) {
    super(
      dosDriveErrorMessage(code, drive, expectedGeneration, actualGeneration),
    );
    this.name = "DosDriveError";
  }
}

/**
 * A bounded DOS drive table. Media generation is an optimistic-lock token:
 * callers must retain the generation they observed and stale operations fail
 * with `media_changed` instead of crossing an eject/insert boundary.
 */
export class DosDriveTable {
  private activeDriveValue: string;
  private readonly drives = new Map<string, MutableDosDriveState>();

  private constructor(snapshot: DosDriveTableSnapshotV1) {
    this.activeDriveValue = snapshot.activeDrive;
    for (const drive of snapshot.drives)
      this.drives.set(drive.letter, { ...drive });
  }

  static create(options: DosDriveTableCreateOptions): DosDriveTable {
    if (options.drives.length === 0 || options.drives.length > 26) {
      throw new RangeError("DOS drive table must contain 1..26 drives");
    }
    const drives: DosDriveStateSnapshot[] = [];
    const letters = new Set<string>();
    for (const definition of options.drives) {
      const letter = normalizeDosDriveLetter(definition.letter);
      if (letters.has(letter))
        throw new TypeError(`Duplicate DOS drive ${letter}:`);
      letters.add(letter);
      const mediaGeneration =
        definition.media?.generation ?? definition.mediaGeneration ?? 0;
      assertMediaGeneration(mediaGeneration);
      const currentDirectory = normalizeDosAbsoluteDirectory(
        definition.currentDirectory ?? "\\",
      );
      if (definition.media === undefined && currentDirectory !== "\\") {
        throw new TypeError(
          `Absent DOS media ${letter}: cannot retain a current directory`,
        );
      }
      drives.push(
        Object.freeze({
          currentDirectory,
          letter,
          mediaGeneration,
          mediaPresent: definition.media !== undefined,
          readOnly: definition.media?.readOnly ?? false,
          volumeLabel:
            definition.media === undefined
              ? ""
              : normalizeDosVolumeLabel(definition.media.volumeLabel ?? ""),
        }),
      );
    }
    const activeDrive = normalizeDosDriveLetter(options.activeDrive);
    if (!letters.has(activeDrive)) {
      throw new TypeError(`Active DOS drive ${activeDrive}: is not configured`);
    }
    return new DosDriveTable({
      activeDrive,
      drives: Object.freeze(drives),
      schema: dosDriveTableSchema,
    });
  }

  static restore(snapshot: unknown): DosDriveTable {
    return new DosDriveTable(parseDosDriveTableSnapshot(snapshot));
  }

  get activeDrive(): string {
    return this.activeDriveValue;
  }

  activeState(expectedGeneration?: number): Readonly<DosDriveStateSnapshot> {
    return this.requireMedia(this.activeDriveValue, expectedGeneration);
  }

  state(letter: string): Readonly<DosDriveStateSnapshot> {
    return Object.freeze({ ...this.requireDrive(letter) });
  }

  selectDrive(letter: string, expectedGeneration?: number): void {
    const drive = this.requireMedia(letter, expectedGeneration);
    this.activeDriveValue = drive.letter;
  }

  requireMedia(
    letter: string,
    expectedGeneration?: number,
  ): Readonly<DosDriveStateSnapshot> {
    const drive = this.requireDrive(letter);
    assertExpectedGeneration(drive, expectedGeneration);
    if (!drive.mediaPresent) {
      throw new DosDriveError(
        "no_media",
        drive.letter,
        expectedGeneration,
        drive.mediaGeneration,
      );
    }
    return Object.freeze({ ...drive });
  }

  assertWritable(letter: string, expectedGeneration?: number): void {
    const drive = this.requireMedia(letter, expectedGeneration);
    if (drive.readOnly) {
      throw new DosDriveError(
        "read_only",
        drive.letter,
        expectedGeneration,
        drive.mediaGeneration,
      );
    }
  }

  mountMedia(letter: string, media: DosDriveMediaDefinition): void {
    const drive = this.requireDrive(letter);
    assertMediaGeneration(media.generation);
    if (drive.mediaPresent || media.generation <= drive.mediaGeneration) {
      throw new DosDriveError(
        "media_changed",
        drive.letter,
        media.generation,
        drive.mediaGeneration,
      );
    }
    const readOnly = media.readOnly ?? false;
    const volumeLabel = normalizeDosVolumeLabel(media.volumeLabel ?? "");
    drive.currentDirectory = "\\";
    drive.mediaGeneration = media.generation;
    drive.mediaPresent = true;
    drive.readOnly = readOnly;
    drive.volumeLabel = volumeLabel;
  }

  ejectMedia(letter: string, expectedGeneration: number): number {
    const drive = this.requireMedia(letter, expectedGeneration);
    const mutable = this.drives.get(drive.letter)!;
    if (mutable.mediaGeneration === Number.MAX_SAFE_INTEGER) {
      throw new RangeError("DOS media generation is exhausted");
    }
    mutable.currentDirectory = "\\";
    mutable.mediaGeneration += 1;
    mutable.mediaPresent = false;
    mutable.readOnly = false;
    mutable.volumeLabel = "";
    return mutable.mediaGeneration;
  }

  setCurrentDirectory(
    letter: string,
    currentDirectory: string,
    expectedGeneration?: number,
  ): void {
    const drive = this.requireMedia(letter, expectedGeneration);
    this.drives.get(drive.letter)!.currentDirectory =
      normalizeDosAbsoluteDirectory(currentDirectory);
  }

  setVolumeLabel(
    letter: string,
    volumeLabel: string,
    expectedGeneration?: number,
  ): void {
    this.assertWritable(letter, expectedGeneration);
    const drive = this.requireMedia(letter, expectedGeneration);
    this.drives.get(drive.letter)!.volumeLabel =
      normalizeDosVolumeLabel(volumeLabel);
  }

  snapshot(): DosDriveTableSnapshotV1 {
    return Object.freeze({
      activeDrive: this.activeDriveValue,
      drives: Object.freeze(
        [...this.drives.values()]
          .sort((left, right) => left.letter.localeCompare(right.letter))
          .map((drive) => Object.freeze({ ...drive })),
      ),
      schema: dosDriveTableSchema,
    });
  }

  private requireDrive(letter: string): MutableDosDriveState {
    const normalized = normalizeDosDriveLetter(letter);
    const drive = this.drives.get(normalized);
    if (drive === undefined)
      throw new DosDriveError("invalid_drive", normalized);
    return drive;
  }
}

interface MutableDosDriveState {
  currentDirectory: string;
  letter: string;
  mediaGeneration: number;
  mediaPresent: boolean;
  readOnly: boolean;
  volumeLabel: string;
}

export function normalizeDosDriveLetter(letter: string): string {
  const normalized = letter.trim().replace(/:$/u, "").toUpperCase();
  if (!/^[A-Z]$/u.test(normalized)) {
    throw new DosDriveError("invalid_drive", normalized || letter);
  }
  return normalized;
}

export function normalizeDosAbsoluteDirectory(directory: string): string {
  const normalized = directory.replaceAll("/", "\\").toUpperCase();
  if (!normalized.startsWith("\\")) {
    throw new TypeError(
      "DOS current directory must be absolute within its drive",
    );
  }
  const segments: string[] = [];
  for (const segment of normalized.split("\\")) {
    if (segment.length === 0 || segment === ".") continue;
    if (segment === "..") {
      if (segments.length === 0) {
        throw new TypeError("DOS current directory escapes its drive root");
      }
      segments.pop();
      continue;
    }
    segments.push(normalizeDosCreatedName(segment));
  }
  return segments.length === 0 ? "\\" : `\\${segments.join("\\")}`;
}

const dosShortNameCharacters = "A-Za-z0-9!#$%&'()@^_`{}~\\-";
const dosShortNamePattern = new RegExp(
  `^[${dosShortNameCharacters}]{1,8}(?:\\.[${dosShortNameCharacters}]{1,3})?$`,
  "u",
);
const dosFileSpecComponentPattern = new RegExp(
  `^[${dosShortNameCharacters}*?]+$`,
  "u",
);

export function isValidDosCreatedName(name: string): boolean {
  return dosShortNamePattern.test(name);
}

export function normalizeDosCreatedName(name: string): string {
  if (!isValidDosCreatedName(name)) {
    throw new DosFileSpecError(
      "invalid_name",
      `Invalid DOS 8.3 creation name: ${name}`,
    );
  }
  return name.toUpperCase();
}

export type DosFileSpecErrorCode =
  | "duplicate_entry"
  | "entry_limit"
  | "invalid_entry"
  | "invalid_name"
  | "invalid_spec"
  | "match_limit";

export class DosFileSpecError extends Error {
  constructor(
    readonly code: DosFileSpecErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "DosFileSpecError";
  }
}

export interface DosFileSpec {
  readonly base: string;
  readonly extension: string;
  readonly source: string;
}

export interface DosFileSpecExpansionLimits {
  readonly maximumEntries?: number;
  readonly maximumMatches?: number;
}

export function parseDosFileSpec(source: string): DosFileSpec {
  const normalized = source.trim().toUpperCase();
  if (
    normalized.length === 0 ||
    normalized.includes("\\") ||
    normalized.includes("/") ||
    normalized.includes(":")
  ) {
    throw new DosFileSpecError(
      "invalid_spec",
      `Invalid DOS file spec: ${source}`,
    );
  }
  const components = normalized.split(".");
  if (components.length > 2) {
    throw new DosFileSpecError(
      "invalid_spec",
      `Invalid DOS file spec: ${source}`,
    );
  }
  const base = components[0]!;
  const explicitExtension = components.length === 2;
  const extension =
    components[1] ?? (base.includes("*") || base.includes("?") ? "*" : "");
  if (
    base.length === 0 ||
    base.length > 8 ||
    extension.length > 3 ||
    !dosFileSpecComponentPattern.test(base) ||
    (extension.length > 0 && !dosFileSpecComponentPattern.test(extension)) ||
    (!explicitExtension &&
      !base.includes("*") &&
      !base.includes("?") &&
      !isValidDosCreatedName(base))
  ) {
    throw new DosFileSpecError(
      "invalid_spec",
      `Invalid DOS file spec: ${source}`,
    );
  }
  return Object.freeze({ base, extension, source: normalized });
}

export function matchesDosFileSpec(
  name: string,
  fileSpec: string | DosFileSpec,
): boolean {
  if (!isValidDosCreatedName(name)) return false;
  const parsed =
    typeof fileSpec === "string" ? parseDosFileSpec(fileSpec) : fileSpec;
  const normalized = name.toUpperCase();
  const separator = normalized.indexOf(".");
  const base = separator < 0 ? normalized : normalized.slice(0, separator);
  const extension = separator < 0 ? "" : normalized.slice(separator + 1);
  return (
    matchesWildcardComponent(base, parsed.base) &&
    matchesWildcardComponent(extension, parsed.extension)
  );
}

export function expandDosFileSpec(
  entries: readonly string[],
  fileSpec: string | DosFileSpec,
  limits: DosFileSpecExpansionLimits = {},
): readonly string[] {
  const maximumEntries = limits.maximumEntries ?? 4_096;
  const maximumMatches = limits.maximumMatches ?? 512;
  assertPositiveLimit(maximumEntries, "maximumEntries");
  assertPositiveLimit(maximumMatches, "maximumMatches");
  if (entries.length > maximumEntries) {
    throw new DosFileSpecError(
      "entry_limit",
      `DOS file-spec expansion exceeds ${String(maximumEntries)} entries`,
    );
  }
  const parsed =
    typeof fileSpec === "string" ? parseDosFileSpec(fileSpec) : fileSpec;
  const seen = new Set<string>();
  const matches: string[] = [];
  for (const entry of entries) {
    if (!isValidDosCreatedName(entry)) {
      throw new DosFileSpecError(
        "invalid_entry",
        `Directory contains an invalid DOS 8.3 entry: ${entry}`,
      );
    }
    const normalized = entry.toUpperCase();
    if (seen.has(normalized)) {
      throw new DosFileSpecError(
        "duplicate_entry",
        `Directory contains duplicate DOS entry: ${entry}`,
      );
    }
    seen.add(normalized);
    if (!matchesDosFileSpec(normalized, parsed)) continue;
    if (matches.length >= maximumMatches) {
      throw new DosFileSpecError(
        "match_limit",
        `DOS file-spec expansion exceeds ${String(maximumMatches)} matches`,
      );
    }
    matches.push(normalized);
  }
  return Object.freeze(
    matches.sort((left, right) => left.localeCompare(right)),
  );
}

function matchesWildcardComponent(value: string, pattern: string): boolean {
  let valueIndex = 0;
  let patternIndex = 0;
  let starIndex = -1;
  let starValueIndex = -1;
  while (valueIndex < value.length) {
    const token = pattern[patternIndex];
    if (token === "?" || token === value[valueIndex]) {
      valueIndex += 1;
      patternIndex += 1;
      continue;
    }
    if (token === "*") {
      starIndex = patternIndex;
      starValueIndex = valueIndex;
      patternIndex += 1;
      continue;
    }
    if (starIndex >= 0) {
      patternIndex = starIndex + 1;
      starValueIndex += 1;
      valueIndex = starValueIndex;
      continue;
    }
    return false;
  }
  while (pattern[patternIndex] === "*") patternIndex += 1;
  return patternIndex === pattern.length;
}

export const dosFatAttribute = Object.freeze({
  archive: 0x20,
  directory: 0x10,
  hidden: 0x02,
  readOnly: 0x01,
  system: 0x04,
  volumeLabel: 0x08,
});

export const dosFatMetadataSchema = 1 as const;

export type DosFatEntryKind = "directory" | "file" | "volume-label";

export interface DosFatMetadataSnapshotV1 {
  readonly attributes: number;
  readonly modifiedAtMilliseconds: number;
  readonly schema: typeof dosFatMetadataSchema;
}

export interface DosFatMetadataMigrationDefaults {
  readonly kind: DosFatEntryKind;
  readonly modifiedAtMilliseconds: number;
  readonly readOnly?: boolean;
}

export interface PackedDosFatTimestamp {
  readonly date: number;
  readonly time: number;
}

export const dosRuntimeStateSchema = 1 as const;

export interface DosRuntimeStateLimits {
  readonly maximumFatMetadataEntries: number;
  readonly maximumPathLength: number;
}

export const defaultDosRuntimeStateLimits: DosRuntimeStateLimits =
  Object.freeze({
    maximumFatMetadataEntries: 4_096,
    maximumPathLength: 255,
  });

export type DosFatMetadataEntrySnapshot = readonly [
  path: string,
  metadata: DosFatMetadataSnapshotV1,
];

export interface DosRuntimeStateSnapshotV1 {
  readonly drives: DosDriveTableSnapshotV1;
  readonly fatMetadata: readonly DosFatMetadataEntrySnapshot[];
  readonly revision: number;
  readonly schema: typeof dosRuntimeStateSchema;
}

export type DosRuntimeStateSnapshot = DosRuntimeStateSnapshotV1;

export interface DosRuntimeStateCreateOptions {
  readonly driveTable?: DosDriveTable;
  readonly limits?: Partial<DosRuntimeStateLimits>;
}

export type DosRuntimeStateErrorCode =
  | "capacity"
  | "destination_exists"
  | "metadata_not_found"
  | "path_overlap"
  | "revision_exhausted"
  | "transaction_async";

export class DosRuntimeStateError extends Error {
  constructor(
    readonly code: DosRuntimeStateErrorCode,
    message: string,
    readonly path?: string,
  ) {
    super(message);
    this.name = "DosRuntimeStateError";
  }
}

const maximumDosFatAttributes = 0x3f;
const minimumDosFatTimestamp = Date.UTC(1980, 0, 1);
const maximumDosFatTimestamp = Date.UTC(2107, 11, 31, 23, 59, 58);

export function migrateDosFatMetadata(
  value: unknown,
  defaults: DosFatMetadataMigrationDefaults,
): DosFatMetadataSnapshotV1 {
  if (value !== undefined && value !== null && !isRecord(value)) {
    throw new TypeError("Invalid DOS FAT metadata");
  }
  if (isRecord(value) && value.schema !== undefined && value.schema !== 1) {
    throw new TypeError("Unsupported DOS FAT metadata schema");
  }
  if (
    isRecord(value) &&
    value.schema === 1 &&
    (typeof value.attributes !== "number" ||
      typeof value.modifiedAtMilliseconds !== "number")
  ) {
    throw new TypeError("Invalid DOS FAT metadata");
  }
  const legacy =
    isRecord(value) && value.schema === undefined ? value : undefined;
  const modifiedAtMilliseconds =
    isRecord(value) && typeof value.modifiedAtMilliseconds === "number"
      ? value.modifiedAtMilliseconds
      : defaults.modifiedAtMilliseconds;
  const inferredReadOnly =
    defaults.readOnly ??
    (legacy !== undefined && typeof legacy.mode === "number"
      ? (legacy.mode & 0o222) === 0
      : false);
  const defaultAttributes = defaultDosFatAttributes(
    defaults.kind,
    inferredReadOnly,
  );
  const attributes =
    isRecord(value) && typeof value.attributes === "number"
      ? value.attributes
      : defaultAttributes;
  assertDosFatAttributes(attributes);
  assertDosFatAttributesForKind(attributes, defaults.kind);
  return Object.freeze({
    attributes,
    modifiedAtMilliseconds: truncateToDosFatTimestamp(modifiedAtMilliseconds),
    schema: dosFatMetadataSchema,
  });
}

export function defaultDosFatAttributes(
  kind: DosFatEntryKind,
  readOnly = false,
): number {
  const kindAttribute =
    kind === "directory"
      ? dosFatAttribute.directory
      : kind === "volume-label"
        ? dosFatAttribute.volumeLabel
        : dosFatAttribute.archive;
  return kindAttribute | (readOnly ? dosFatAttribute.readOnly : 0);
}

export function hasDosFatAttribute(
  attributes: number,
  attribute: number,
): boolean {
  assertDosFatAttributes(attributes);
  assertDosFatAttributes(attribute);
  return (attributes & attribute) === attribute;
}

export function setDosFatAttribute(
  attributes: number,
  attribute: number,
  enabled: boolean,
): number {
  assertDosFatAttributes(attributes);
  assertDosFatAttributes(attribute);
  const next = enabled ? attributes | attribute : attributes & ~attribute;
  assertDosFatAttributes(next);
  return next;
}

/** FAT stores seconds in two-second increments and years in the 1980..2107 range. */
export function truncateToDosFatTimestamp(milliseconds: number): number {
  if (!Number.isFinite(milliseconds)) {
    throw new TypeError("DOS FAT timestamp must be finite");
  }
  const clamped = Math.min(
    maximumDosFatTimestamp,
    Math.max(minimumDosFatTimestamp, Math.trunc(milliseconds)),
  );
  return Math.floor(clamped / 2_000) * 2_000;
}

export function packDosFatTimestamp(
  milliseconds: number,
): PackedDosFatTimestamp {
  const normalized = truncateToDosFatTimestamp(milliseconds);
  const value = new Date(normalized);
  return Object.freeze({
    date:
      ((value.getUTCFullYear() - 1980) << 9) |
      ((value.getUTCMonth() + 1) << 5) |
      value.getUTCDate(),
    time:
      (value.getUTCHours() << 11) |
      (value.getUTCMinutes() << 5) |
      Math.floor(value.getUTCSeconds() / 2),
  });
}

export function unpackDosFatTimestamp(
  timestamp: PackedDosFatTimestamp,
): number {
  if (
    !Number.isInteger(timestamp.date) ||
    timestamp.date < 0 ||
    timestamp.date > 0xffff ||
    !Number.isInteger(timestamp.time) ||
    timestamp.time < 0 ||
    timestamp.time > 0xffff
  ) {
    throw new TypeError("Invalid packed DOS FAT timestamp");
  }
  const year = 1980 + ((timestamp.date >> 9) & 0x7f);
  const month = (timestamp.date >> 5) & 0x0f;
  const day = timestamp.date & 0x1f;
  const hour = (timestamp.time >> 11) & 0x1f;
  const minute = (timestamp.time >> 5) & 0x3f;
  const second = (timestamp.time & 0x1f) * 2;
  const milliseconds = Date.UTC(year, month - 1, day, hour, minute, second);
  const value = new Date(milliseconds);
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    value.getUTCFullYear() !== year ||
    value.getUTCMonth() !== month - 1 ||
    value.getUTCDate() !== day ||
    value.getUTCHours() !== hour ||
    value.getUTCMinutes() !== minute ||
    value.getUTCSeconds() !== second
  ) {
    throw new TypeError("Invalid packed DOS FAT timestamp");
  }
  return truncateToDosFatTimestamp(milliseconds);
}

/**
 * Bounded per-Computer DOS state. The aggregate owns its drive table so every
 * drive or FAT-metadata mutation advances one observable revision and callers
 * cannot mutate persisted state behind its back.
 */
export class DosRuntimeState {
  readonly limits: DosRuntimeStateLimits;

  private driveTableValue: DosDriveTable;
  private fatMetadataValue: Map<string, DosFatMetadataSnapshotV1>;
  private revisionValue: number;

  private constructor(
    driveTable: DosDriveTable,
    fatMetadata: Map<string, DosFatMetadataSnapshotV1>,
    revision: number,
    limits: DosRuntimeStateLimits,
  ) {
    this.driveTableValue = driveTable;
    this.fatMetadataValue = fatMetadata;
    this.revisionValue = revision;
    this.limits = limits;
  }

  static create(options: DosRuntimeStateCreateOptions = {}): DosRuntimeState {
    const limits = normalizeDosRuntimeStateLimits(options.limits);
    const driveTable =
      options.driveTable === undefined
        ? createDefaultDosDriveTable()
        : DosDriveTable.restore(options.driveTable.snapshot());
    validateDosRuntimeDriveTable(driveTable.snapshot());
    return new DosRuntimeState(driveTable, new Map(), 0, limits);
  }

  /** Ephemeral A:-only guest view used when CSBIOS boots a system floppy. */
  static createFloppyBoot(media: DosDriveMediaDefinition): DosRuntimeState {
    const limits = normalizeDosRuntimeStateLimits(undefined);
    const driveTable = DosDriveTable.create({
      activeDrive: "A",
      drives: [
        { letter: "A", media },
        { letter: "C", mediaGeneration: 0 },
      ],
    });
    validateDosRuntimeDriveTable(driveTable.snapshot(), true);
    return new DosRuntimeState(driveTable, new Map(), 0, limits);
  }

  static restore(
    snapshot: unknown,
    limits: Partial<DosRuntimeStateLimits> = {},
  ): DosRuntimeState {
    const normalizedLimits = normalizeDosRuntimeStateLimits(limits);
    const parsed = parseDosRuntimeStateSnapshot(snapshot, normalizedLimits);
    return new DosRuntimeState(
      DosDriveTable.restore(parsed.drives),
      new Map(parsed.fatMetadata),
      parsed.revision,
      normalizedLimits,
    );
  }

  get activeDrive(): string {
    return this.driveTableValue.activeDrive;
  }

  get fatMetadataCount(): number {
    return this.fatMetadataValue.size;
  }

  get revision(): number {
    return this.revisionValue;
  }

  /**
   * Runs one synchronous aggregate mutation atomically.
   *
   * Every mutator commits a newly cloned drive table or FAT map, so retaining
   * the three aggregate references is an O(1) undo record. This composes with
   * the filesystem transaction used by DOS commands without exposing mutable
   * state to callers.
   */
  transaction<Result>(
    operation: SynchronousTransactionOperation<Result>,
  ): Result {
    this.assertTransactionMutationAllowed();
    if (isExplicitAsyncFunction(operation)) {
      throw new DosRuntimeStateError(
        "transaction_async",
        "DOS runtime transactions require a synchronous callback",
      );
    }
    const beforeDriveTable = this.driveTableValue;
    const beforeFatMetadata = this.fatMetadataValue;
    const beforeRevision = this.revisionValue;
    const rejectedAsyncTransactions = rejectedAsyncTransactionCount();
    try {
      const result = operation();
      if (isThenable(result)) this.rejectThenableTransaction(result);
      if (rejectedAsyncTransactionCount() !== rejectedAsyncTransactions) {
        throw new DosRuntimeStateError(
          "transaction_async",
          "DOS runtime transaction contains a rejected asynchronous transaction",
        );
      }
      return result;
    } catch (error: unknown) {
      try {
        this.driveTableValue = beforeDriveTable;
        this.fatMetadataValue = beforeFatMetadata;
        this.revisionValue = beforeRevision;
      } catch (rollbackError: unknown) {
        throw new AggregateError(
          [error, rollbackError],
          "DOS runtime transaction rollback failed",
        );
      }
      throw error;
    }
  }

  driveState(letter: string): Readonly<DosDriveStateSnapshot> {
    return this.driveTableValue.state(letter);
  }

  driveTableSnapshot(): DosDriveTableSnapshotV1 {
    return this.driveTableValue.snapshot();
  }

  requireMedia(
    letter: string,
    expectedGeneration?: number,
  ): Readonly<DosDriveStateSnapshot> {
    return this.driveTableValue.requireMedia(letter, expectedGeneration);
  }

  assertWritable(letter: string, expectedGeneration?: number): void {
    this.driveTableValue.assertWritable(letter, expectedGeneration);
  }

  selectDrive(letter: string, expectedGeneration?: number): void {
    const next = this.cloneDriveTable();
    next.selectDrive(letter, expectedGeneration);
    this.commit(next, this.fatMetadataValue);
  }

  setCurrentDirectory(
    letter: string,
    currentDirectory: string,
    expectedGeneration?: number,
  ): void {
    const next = this.cloneDriveTable();
    next.setCurrentDirectory(letter, currentDirectory, expectedGeneration);
    this.commit(next, this.fatMetadataValue);
  }

  mountMedia(letter: string, media: DosDriveMediaDefinition): void {
    const normalizedLetter = normalizeDosDriveLetter(letter);
    const nextDrives = this.cloneDriveTable();
    nextDrives.mountMedia(normalizedLetter, media);
    const nextMetadata = withoutDriveFatMetadata(
      this.fatMetadataValue,
      normalizedLetter,
    );
    this.commit(nextDrives, nextMetadata);
  }

  ejectMedia(letter: string, expectedGeneration: number): number {
    const normalizedLetter = normalizeDosDriveLetter(letter);
    const nextDrives = this.cloneDriveTable();
    const nextGeneration = nextDrives.ejectMedia(
      normalizedLetter,
      expectedGeneration,
    );
    if (nextDrives.activeDrive === normalizedLetter) {
      // An installed DOS machine always has C:, but a system-floppy boot is
      // deliberately A:-only.  Keep A: selected (and not-ready) when there is
      // no fixed disk instead of turning a physical eject into an exception.
      if (nextDrives.state("C").mediaPresent) nextDrives.selectDrive("C");
    }
    const nextMetadata = withoutDriveFatMetadata(
      this.fatMetadataValue,
      normalizedLetter,
    );
    this.commit(nextDrives, nextMetadata);
    return nextGeneration;
  }

  volumeLabel(letter: string, expectedGeneration?: number): string {
    return this.driveTableValue.requireMedia(letter, expectedGeneration)
      .volumeLabel;
  }

  setVolumeLabel(
    letter: string,
    volumeLabel: string,
    expectedGeneration?: number,
  ): void {
    const next = this.cloneDriveTable();
    next.setVolumeLabel(letter, volumeLabel, expectedGeneration);
    this.commit(next, this.fatMetadataValue);
  }

  /**
   * FAT operations are bound to the caller's observed media generation. This
   * prevents deferred work from crossing an A: eject/remount boundary. A
   * transfer validates source and destination generations independently.
   */
  fatMetadata(
    path: string,
    expectedGeneration: number,
  ): Readonly<DosFatMetadataSnapshotV1> | undefined {
    const normalized = this.normalizeMetadataPath(
      path,
      false,
      expectedGeneration,
    );
    const metadata = this.fatMetadataValue.get(normalized);
    return metadata === undefined ? undefined : Object.freeze({ ...metadata });
  }

  setFatMetadata(
    path: string,
    value: unknown,
    defaults: DosFatMetadataMigrationDefaults,
    expectedGeneration: number,
  ): Readonly<DosFatMetadataSnapshotV1> {
    const normalized = this.normalizeMetadataPath(
      path,
      true,
      expectedGeneration,
    );
    const metadata = migrateDosFatMetadata(value, defaults);
    return this.storeFatMetadata(normalized, metadata);
  }

  fatAttributes(path: string, expectedGeneration: number): number {
    return this.requireFatMetadata(path, false, expectedGeneration).metadata
      .attributes;
  }

  setFatAttributes(
    path: string,
    attributes: number,
    expectedGeneration: number,
  ): Readonly<DosFatMetadataSnapshotV1> {
    const current = this.requireFatMetadata(path, true, expectedGeneration);
    const metadata = migrateDosFatMetadata(
      {
        attributes,
        modifiedAtMilliseconds: current.metadata.modifiedAtMilliseconds,
        schema: dosFatMetadataSchema,
      },
      {
        kind: dosFatEntryKind(current.metadata.attributes),
        modifiedAtMilliseconds: current.metadata.modifiedAtMilliseconds,
      },
    );
    return this.storeFatMetadata(current.path, metadata);
  }

  setFatAttribute(
    path: string,
    attribute: number,
    enabled: boolean,
    expectedGeneration: number,
  ): Readonly<DosFatMetadataSnapshotV1> {
    const current = this.requireFatMetadata(path, true, expectedGeneration);
    const attributes = setDosFatAttribute(
      current.metadata.attributes,
      attribute,
      enabled,
    );
    const metadata = migrateDosFatMetadata(
      {
        attributes,
        modifiedAtMilliseconds: current.metadata.modifiedAtMilliseconds,
        schema: dosFatMetadataSchema,
      },
      {
        kind: dosFatEntryKind(current.metadata.attributes),
        modifiedAtMilliseconds: current.metadata.modifiedAtMilliseconds,
      },
    );
    return this.storeFatMetadata(current.path, metadata);
  }

  setFatModifiedTime(
    path: string,
    modifiedAtMilliseconds: number,
    expectedGeneration: number,
  ): Readonly<DosFatMetadataSnapshotV1> {
    const current = this.requireFatMetadata(path, true, expectedGeneration);
    const metadata = migrateDosFatMetadata(
      {
        attributes: current.metadata.attributes,
        modifiedAtMilliseconds,
        schema: dosFatMetadataSchema,
      },
      {
        kind: dosFatEntryKind(current.metadata.attributes),
        modifiedAtMilliseconds,
      },
    );
    return this.storeFatMetadata(current.path, metadata);
  }

  copyFatMetadata(
    source: string,
    destination: string,
    sourceExpectedGeneration: number,
    destinationExpectedGeneration: number,
  ): number {
    const normalizedSource = this.normalizeMetadataPath(
      source,
      false,
      sourceExpectedGeneration,
    );
    const normalizedDestination = this.normalizeMetadataPath(
      destination,
      true,
      destinationExpectedGeneration,
    );
    this.assertDistinctTransfer(normalizedSource, normalizedDestination);
    const sourceEntries = this.requireFatMetadataSubtree(normalizedSource);
    this.assertDestinationAvailable(normalizedDestination);
    const destinationEntries = this.rebaseFatMetadataEntries(
      sourceEntries,
      normalizedSource,
      normalizedDestination,
    );
    if (
      this.fatMetadataValue.size + destinationEntries.length >
      this.limits.maximumFatMetadataEntries
    ) {
      throw new DosRuntimeStateError(
        "capacity",
        `DOS FAT metadata capacity ${String(this.limits.maximumFatMetadataEntries)} exceeded`,
        normalizedDestination,
      );
    }
    const next = new Map(this.fatMetadataValue);
    for (const [path, metadata] of destinationEntries) {
      next.set(path, Object.freeze({ ...metadata }));
    }
    this.commit(this.driveTableValue, next);
    return destinationEntries.length;
  }

  moveFatMetadata(
    source: string,
    destination: string,
    sourceExpectedGeneration: number,
    destinationExpectedGeneration: number,
  ): number {
    const normalizedSource = this.normalizeMetadataPath(
      source,
      true,
      sourceExpectedGeneration,
    );
    const normalizedDestination = this.normalizeMetadataPath(
      destination,
      true,
      destinationExpectedGeneration,
    );
    this.assertDistinctTransfer(normalizedSource, normalizedDestination);
    const sourceEntries = this.requireFatMetadataSubtree(normalizedSource);
    this.assertDestinationAvailable(normalizedDestination);
    const destinationEntries = this.rebaseFatMetadataEntries(
      sourceEntries,
      normalizedSource,
      normalizedDestination,
    );
    const next = new Map(this.fatMetadataValue);
    for (const [path] of sourceEntries) next.delete(path);
    for (const [path, metadata] of destinationEntries) {
      next.set(path, Object.freeze({ ...metadata }));
    }
    this.commit(this.driveTableValue, next);
    return destinationEntries.length;
  }

  deleteFatMetadata(path: string, expectedGeneration: number): number {
    const normalized = this.normalizeMetadataPath(
      path,
      true,
      expectedGeneration,
    );
    const entries = this.requireFatMetadataSubtree(normalized);
    const next = new Map(this.fatMetadataValue);
    for (const [entryPath] of entries) next.delete(entryPath);
    this.commit(this.driveTableValue, next);
    return entries.length;
  }

  snapshot(): DosRuntimeStateSnapshotV1 {
    return createDosRuntimeStateSnapshot(
      this.driveTableValue.snapshot(),
      this.fatMetadataValue,
      this.revisionValue,
    );
  }

  /**
   * Returns the cold disk projection. C: remains byte-for-byte equivalent,
   * while A: always starts without media and cannot retain stale FAT entries.
   */
  persistentSnapshot(): DosRuntimeStateSnapshotV1 {
    const live = this.driveTableValue.snapshot();
    const c = live.drives.find(({ letter }) => letter === "C")!;
    const a = live.drives.find(({ letter }) => letter === "A")!;
    const coldDrives = DosDriveTable.restore({
      activeDrive: "C",
      drives: [
        {
          currentDirectory: "\\",
          letter: "A",
          mediaGeneration: a.mediaGeneration,
          mediaPresent: false,
          readOnly: false,
          volumeLabel: "",
        },
        c,
      ],
      schema: dosDriveTableSchema,
    }).snapshot();
    const persistentMetadata = new Map(
      [...this.fatMetadataValue].filter(([path]) => path.startsWith("C:\\")),
    );
    return createDosRuntimeStateSnapshot(
      coldDrives,
      persistentMetadata,
      this.revisionValue,
    );
  }

  private cloneDriveTable(): DosDriveTable {
    return DosDriveTable.restore(this.driveTableValue.snapshot());
  }

  private normalizeMetadataPath(
    path: string,
    writable: boolean,
    expectedGeneration: number,
  ): string {
    assertMediaGeneration(expectedGeneration);
    const normalized = normalizeDosRuntimePath(
      path,
      this.limits.maximumPathLength,
    );
    const drive = normalized.slice(0, 1);
    if (writable)
      this.driveTableValue.assertWritable(drive, expectedGeneration);
    else this.driveTableValue.requireMedia(drive, expectedGeneration);
    return normalized;
  }

  private requireFatMetadata(
    path: string,
    writable: boolean,
    expectedGeneration: number,
  ): {
    readonly metadata: DosFatMetadataSnapshotV1;
    readonly path: string;
  } {
    const normalized = this.normalizeMetadataPath(
      path,
      writable,
      expectedGeneration,
    );
    const metadata = this.fatMetadataValue.get(normalized);
    if (metadata === undefined) {
      throw new DosRuntimeStateError(
        "metadata_not_found",
        `DOS FAT metadata not found: ${normalized}`,
        normalized,
      );
    }
    return { metadata, path: normalized };
  }

  private requireFatMetadataSubtree(
    path: string,
  ): readonly (readonly [string, DosFatMetadataSnapshotV1])[] {
    if (!this.fatMetadataValue.has(path)) {
      throw new DosRuntimeStateError(
        "metadata_not_found",
        `DOS FAT metadata not found: ${path}`,
        path,
      );
    }
    return [...this.fatMetadataValue]
      .filter(([candidate]) => isDosRuntimePathWithin(candidate, path))
      .sort(([left], [right]) => left.localeCompare(right));
  }

  private storeFatMetadata(
    path: string,
    metadata: DosFatMetadataSnapshotV1,
  ): Readonly<DosFatMetadataSnapshotV1> {
    const current = this.fatMetadataValue.get(path);
    if (current !== undefined && sameDosFatMetadata(current, metadata)) {
      return Object.freeze({ ...current });
    }
    if (
      current === undefined &&
      this.fatMetadataValue.size >= this.limits.maximumFatMetadataEntries
    ) {
      throw new DosRuntimeStateError(
        "capacity",
        `DOS FAT metadata capacity ${String(this.limits.maximumFatMetadataEntries)} exceeded`,
        path,
      );
    }
    const next = new Map(this.fatMetadataValue);
    next.set(path, Object.freeze({ ...metadata }));
    this.commit(this.driveTableValue, next);
    return Object.freeze({ ...metadata });
  }

  private assertDistinctTransfer(source: string, destination: string): void {
    if (source === destination || isDosRuntimePathWithin(destination, source)) {
      throw new DosRuntimeStateError(
        "path_overlap",
        `DOS FAT metadata destination overlaps source: ${destination}`,
        destination,
      );
    }
  }

  private assertDestinationAvailable(destination: string): void {
    if (
      [...this.fatMetadataValue.keys()].some((path) =>
        isDosRuntimePathWithin(path, destination),
      )
    ) {
      throw new DosRuntimeStateError(
        "destination_exists",
        `DOS FAT metadata destination exists: ${destination}`,
        destination,
      );
    }
  }

  private rebaseFatMetadataEntries(
    entries: readonly (readonly [string, DosFatMetadataSnapshotV1])[],
    source: string,
    destination: string,
  ): readonly (readonly [string, DosFatMetadataSnapshotV1])[] {
    return entries.map(([path, metadata]) => {
      const rebased = rebaseDosRuntimePath(path, source, destination);
      const normalized = normalizeDosRuntimePath(
        rebased,
        this.limits.maximumPathLength,
      );
      return [normalized, metadata] as const;
    });
  }

  private commit(
    driveTable: DosDriveTable,
    fatMetadata: Map<string, DosFatMetadataSnapshotV1>,
  ): void {
    this.assertTransactionMutationAllowed();
    const drivesChanged = !sameDosDriveTableSnapshot(
      this.driveTableValue.snapshot(),
      driveTable.snapshot(),
    );
    const metadataChanged = fatMetadata !== this.fatMetadataValue;
    if (!drivesChanged && !metadataChanged) return;
    validateDosRuntimeDriveTable(driveTable.snapshot());
    validateFatMetadataMedia(fatMetadata, driveTable);
    validateFatMetadataHierarchy(fatMetadata);
    if (this.revisionValue === Number.MAX_SAFE_INTEGER) {
      throw new DosRuntimeStateError(
        "revision_exhausted",
        "DOS runtime revision is exhausted",
      );
    }
    this.driveTableValue = driveTable;
    this.fatMetadataValue = fatMetadata;
    this.revisionValue += 1;
  }

  private assertTransactionMutationAllowed(): void {
    if (rejectedAsyncTransactionCount() > 0) {
      throw new DosRuntimeStateError(
        "transaction_async",
        "Cannot mutate DOS runtime state while a rejected asynchronous transaction is pending",
      );
    }
  }

  private rejectThenableTransaction(value: PromiseLike<unknown>): never {
    quarantineRejectedAsyncTransaction(value);
    throw new DosRuntimeStateError(
      "transaction_async",
      "DOS runtime transactions require a synchronous callback",
    );
  }
}

export function normalizeDosRuntimePath(
  path: string,
  maximumPathLength = defaultDosRuntimeStateLimits.maximumPathLength,
): string {
  assertPositiveLimit(maximumPathLength, "maximumPathLength");
  if (typeof path !== "string" || path.length === 0) {
    throw new TypeError("DOS runtime path must be a non-empty string");
  }
  if (path.length > maximumPathLength + 9) {
    throw new RangeError(
      `DOS runtime path exceeds ${String(maximumPathLength)} characters`,
    );
  }
  const slashed = path.replaceAll("/", "\\");
  const internal = /^\\drives\\([A-Za-z])(?:\\(.*))?$/u.exec(slashed);
  const dos = /^([A-Za-z]):\\(.*)$/u.exec(slashed);
  const drive = internal?.[1] ?? dos?.[1];
  const tail = internal === null ? dos?.[2] : (internal[2] ?? "");
  if (drive === undefined || tail === undefined) {
    throw new TypeError(`DOS runtime path must be absolute: ${path}`);
  }
  const withinDrive = normalizeDosAbsoluteDirectory(`\\${tail}`);
  const normalized = `${normalizeDosDriveLetter(drive)}:${withinDrive}`;
  if (normalized.length > maximumPathLength) {
    throw new RangeError(
      `DOS runtime path exceeds ${String(maximumPathLength)} characters`,
    );
  }
  return normalized;
}

function createDefaultDosDriveTable(): DosDriveTable {
  return DosDriveTable.create({
    activeDrive: "C",
    drives: [
      { letter: "A", mediaGeneration: 0 },
      {
        letter: "C",
        media: { generation: 1, volumeLabel: "CS-DOS" },
      },
    ],
  });
}

function normalizeDosRuntimeStateLimits(
  limits: Partial<DosRuntimeStateLimits> | undefined,
): DosRuntimeStateLimits {
  const normalized = Object.freeze({
    ...defaultDosRuntimeStateLimits,
    ...limits,
  });
  assertPositiveLimit(
    normalized.maximumFatMetadataEntries,
    "maximumFatMetadataEntries",
  );
  assertPositiveLimit(normalized.maximumPathLength, "maximumPathLength");
  return normalized;
}

function parseDosRuntimeStateSnapshot(
  value: unknown,
  limits: DosRuntimeStateLimits,
): DosRuntimeStateSnapshotV1 {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["drives", "fatMetadata", "revision", "schema"]) ||
    value.schema !== dosRuntimeStateSchema ||
    !Number.isSafeInteger(value.revision) ||
    (value.revision as number) < 0 ||
    !Array.isArray(value.fatMetadata)
  ) {
    throw new TypeError("Invalid DOS runtime-state snapshot");
  }
  if (value.fatMetadata.length > limits.maximumFatMetadataEntries) {
    throw new DosRuntimeStateError(
      "capacity",
      `DOS FAT metadata capacity ${String(limits.maximumFatMetadataEntries)} exceeded`,
    );
  }
  const driveTable = DosDriveTable.restore(value.drives);
  const drives = driveTable.snapshot();
  validateDosRuntimeDriveTable(drives);
  const fatMetadata = new Map<string, DosFatMetadataSnapshotV1>();
  for (const entry of value.fatMetadata) {
    if (
      !Array.isArray(entry) ||
      entry.length !== 2 ||
      typeof entry[0] !== "string"
    ) {
      throw new TypeError("Invalid DOS FAT metadata entry");
    }
    const path = normalizeDosRuntimePath(entry[0], limits.maximumPathLength);
    if (path !== entry[0] || fatMetadata.has(path)) {
      throw new TypeError(
        "DOS FAT metadata paths must be canonical and unique",
      );
    }
    fatMetadata.set(path, parseDosFatMetadataSnapshot(entry[1]));
  }
  validateFatMetadataMedia(fatMetadata, driveTable);
  validateFatMetadataHierarchy(fatMetadata);
  return createDosRuntimeStateSnapshot(
    drives,
    fatMetadata,
    value.revision as number,
  );
}

function parseDosFatMetadataSnapshot(value: unknown): DosFatMetadataSnapshotV1 {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["attributes", "modifiedAtMilliseconds", "schema"]) ||
    value.schema !== dosFatMetadataSchema ||
    typeof value.attributes !== "number" ||
    typeof value.modifiedAtMilliseconds !== "number"
  ) {
    throw new TypeError("Invalid DOS FAT metadata snapshot");
  }
  const metadata = migrateDosFatMetadata(value, {
    kind: dosFatEntryKind(value.attributes),
    modifiedAtMilliseconds: value.modifiedAtMilliseconds,
  });
  if (metadata.modifiedAtMilliseconds !== value.modifiedAtMilliseconds) {
    throw new TypeError("DOS FAT metadata timestamp is not canonical");
  }
  return metadata;
}

function createDosRuntimeStateSnapshot(
  drives: DosDriveTableSnapshotV1,
  fatMetadata: ReadonlyMap<string, DosFatMetadataSnapshotV1>,
  revision: number,
): DosRuntimeStateSnapshotV1 {
  return Object.freeze({
    drives,
    fatMetadata: Object.freeze(
      [...fatMetadata]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(
          ([path, metadata]) =>
            Object.freeze([
              path,
              Object.freeze({ ...metadata }),
            ]) as DosFatMetadataEntrySnapshot,
        ),
    ),
    revision,
    schema: dosRuntimeStateSchema,
  });
}

function validateDosRuntimeDriveTable(
  snapshot: DosDriveTableSnapshotV1,
  allowFloppyBoot = false,
): void {
  if (
    snapshot.drives.length !== 2 ||
    !snapshot.drives.some(({ letter }) => letter === "A") ||
    !snapshot.drives.some(({ letter }) => letter === "C")
  ) {
    throw new TypeError(
      "DOS runtime drive table must contain exactly A: and C:",
    );
  }
  const c = snapshot.drives.find(({ letter }) => letter === "C")!;
  const active = snapshot.drives.find(
    ({ letter }) => letter === snapshot.activeDrive,
  )!;
  if (!c.mediaPresent && !allowFloppyBoot) {
    throw new TypeError("DOS runtime system drive C: must contain media");
  }
  if (!active.mediaPresent) {
    throw new TypeError("DOS runtime active drive must contain media");
  }
}

function validateFatMetadataMedia(
  fatMetadata: ReadonlyMap<string, DosFatMetadataSnapshotV1>,
  driveTable: DosDriveTable,
): void {
  for (const path of fatMetadata.keys()) {
    driveTable.requireMedia(path.slice(0, 1));
  }
}

function validateFatMetadataHierarchy(
  fatMetadata: ReadonlyMap<string, DosFatMetadataSnapshotV1>,
): void {
  for (const [path, metadata] of fatMetadata) {
    if (
      path.endsWith(":\\") &&
      dosFatEntryKind(metadata.attributes) !== "directory"
    ) {
      throw new TypeError("DOS drive-root FAT metadata must be a directory");
    }
    for (
      let parent = parentDosRuntimePath(path);
      parent !== undefined;
      parent = parentDosRuntimePath(parent)
    ) {
      const parentMetadata = fatMetadata.get(parent);
      if (
        parentMetadata !== undefined &&
        dosFatEntryKind(parentMetadata.attributes) !== "directory"
      ) {
        throw new TypeError(
          `DOS FAT metadata ancestor is not a directory: ${parent}`,
        );
      }
    }
  }
}

function withoutDriveFatMetadata(
  fatMetadata: ReadonlyMap<string, DosFatMetadataSnapshotV1>,
  drive: string,
): Map<string, DosFatMetadataSnapshotV1> {
  const prefix = `${normalizeDosDriveLetter(drive)}:\\`;
  const next = new Map<string, DosFatMetadataSnapshotV1>();
  for (const [path, metadata] of fatMetadata) {
    if (!path.startsWith(prefix)) next.set(path, metadata);
  }
  return next.size === fatMetadata.size ? new Map(fatMetadata) : next;
}

function dosFatEntryKind(attributes: number): DosFatEntryKind {
  assertDosFatAttributes(attributes);
  if ((attributes & dosFatAttribute.volumeLabel) !== 0) return "volume-label";
  if ((attributes & dosFatAttribute.directory) !== 0) return "directory";
  return "file";
}

function sameDosFatMetadata(
  left: DosFatMetadataSnapshotV1,
  right: DosFatMetadataSnapshotV1,
): boolean {
  return (
    left.schema === right.schema &&
    left.attributes === right.attributes &&
    left.modifiedAtMilliseconds === right.modifiedAtMilliseconds
  );
}

function sameDosDriveTableSnapshot(
  left: DosDriveTableSnapshotV1,
  right: DosDriveTableSnapshotV1,
): boolean {
  if (
    left.schema !== right.schema ||
    left.activeDrive !== right.activeDrive ||
    left.drives.length !== right.drives.length
  ) {
    return false;
  }
  return left.drives.every((drive, index) => {
    const candidate = right.drives[index];
    return (
      candidate !== undefined &&
      drive.currentDirectory === candidate.currentDirectory &&
      drive.letter === candidate.letter &&
      drive.mediaGeneration === candidate.mediaGeneration &&
      drive.mediaPresent === candidate.mediaPresent &&
      drive.readOnly === candidate.readOnly &&
      drive.volumeLabel === candidate.volumeLabel
    );
  });
}

function isDosRuntimePathWithin(path: string, root: string): boolean {
  if (path === root) return true;
  const prefix = root.endsWith("\\") ? root : `${root}\\`;
  return path.startsWith(prefix);
}

function rebaseDosRuntimePath(
  path: string,
  source: string,
  destination: string,
): string {
  if (path === source) return destination;
  const relative = path.slice(source.length).replace(/^\\/u, "");
  return `${destination}${destination.endsWith("\\") ? "" : "\\"}${relative}`;
}

function parentDosRuntimePath(path: string): string | undefined {
  if (path.endsWith(":\\")) return undefined;
  const separator = path.lastIndexOf("\\");
  return separator === 2 ? path.slice(0, 3) : path.slice(0, separator);
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function parseDosDriveTableSnapshot(value: unknown): DosDriveTableSnapshotV1 {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["activeDrive", "drives", "schema"]) ||
    value.schema !== dosDriveTableSchema ||
    typeof value.activeDrive !== "string" ||
    !Array.isArray(value.drives) ||
    value.drives.length === 0 ||
    value.drives.length > 26
  ) {
    throw new TypeError("Invalid DOS drive-table snapshot");
  }
  const activeDrive = normalizeDosDriveLetter(value.activeDrive);
  if (activeDrive !== value.activeDrive) {
    throw new TypeError("DOS drive-table snapshot is not canonical");
  }
  const letters = new Set<string>();
  const drives: DosDriveStateSnapshot[] = [];
  let previousLetter: string | undefined;
  for (const candidate of value.drives) {
    if (
      !isRecord(candidate) ||
      !hasOnlyKeys(candidate, [
        "currentDirectory",
        "letter",
        "mediaGeneration",
        "mediaPresent",
        "readOnly",
        "volumeLabel",
      ]) ||
      typeof candidate.letter !== "string" ||
      typeof candidate.currentDirectory !== "string" ||
      typeof candidate.mediaGeneration !== "number" ||
      typeof candidate.mediaPresent !== "boolean" ||
      typeof candidate.readOnly !== "boolean" ||
      typeof candidate.volumeLabel !== "string"
    ) {
      throw new TypeError("Invalid DOS drive-table entry");
    }
    const letter = normalizeDosDriveLetter(candidate.letter);
    const currentDirectory = normalizeDosAbsoluteDirectory(
      candidate.currentDirectory,
    );
    const volumeLabel = normalizeDosVolumeLabel(candidate.volumeLabel);
    if (
      letter !== candidate.letter ||
      currentDirectory !== candidate.currentDirectory ||
      volumeLabel !== candidate.volumeLabel
    ) {
      throw new TypeError("DOS drive-table entry is not canonical");
    }
    if (letters.has(letter))
      throw new TypeError(`Duplicate DOS drive ${letter}:`);
    if (previousLetter !== undefined && previousLetter >= letter) {
      throw new TypeError(
        "DOS drive-table entries are not canonically ordered",
      );
    }
    letters.add(letter);
    previousLetter = letter;
    assertMediaGeneration(candidate.mediaGeneration);
    if (
      !candidate.mediaPresent &&
      (candidate.currentDirectory !== "\\" ||
        candidate.readOnly ||
        candidate.volumeLabel !== "")
    ) {
      throw new TypeError(
        "Absent DOS media cannot retain directory, label, or read-only state",
      );
    }
    drives.push(
      Object.freeze({
        currentDirectory,
        letter,
        mediaGeneration: candidate.mediaGeneration,
        mediaPresent: candidate.mediaPresent,
        readOnly: candidate.readOnly,
        volumeLabel,
      }),
    );
  }
  if (!letters.has(activeDrive)) {
    throw new TypeError(`Active DOS drive ${activeDrive}: is not configured`);
  }
  return Object.freeze({
    activeDrive,
    drives: Object.freeze(drives),
    schema: dosDriveTableSchema,
  });
}

function normalizeDosVolumeLabel(label: string): string {
  const normalized = label.trim().toUpperCase();
  if (
    normalized.length > 11 ||
    [...normalized].some(
      (character) =>
        character.charCodeAt(0) < 0x20 ||
        '"*+,./:;<=>?[\\]|'.includes(character),
    )
  ) {
    throw new TypeError("Invalid DOS volume label");
  }
  return normalized;
}

function assertExpectedGeneration(
  drive: MutableDosDriveState,
  expectedGeneration?: number,
): void {
  if (expectedGeneration === undefined) return;
  assertMediaGeneration(expectedGeneration);
  if (drive.mediaGeneration !== expectedGeneration) {
    throw new DosDriveError(
      "media_changed",
      drive.letter,
      expectedGeneration,
      drive.mediaGeneration,
    );
  }
}

function assertMediaGeneration(generation: number): void {
  if (!Number.isSafeInteger(generation) || generation < 0) {
    throw new RangeError("DOS media generation must be a non-negative integer");
  }
}

function assertPositiveLimit(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError(`${name} must be a positive integer`);
  }
}

function assertDosFatAttributes(attributes: number): void {
  if (
    !Number.isSafeInteger(attributes) ||
    attributes < 0 ||
    (attributes & ~maximumDosFatAttributes) !== 0 ||
    ((attributes & dosFatAttribute.directory) !== 0 &&
      (attributes & dosFatAttribute.volumeLabel) !== 0)
  ) {
    throw new TypeError("Invalid DOS FAT attributes");
  }
}

function assertDosFatAttributesForKind(
  attributes: number,
  kind: DosFatEntryKind,
): void {
  const directory = (attributes & dosFatAttribute.directory) !== 0;
  const volumeLabel = (attributes & dosFatAttribute.volumeLabel) !== 0;
  if (
    (kind === "file" && (directory || volumeLabel)) ||
    (kind === "directory" && !directory) ||
    (kind === "volume-label" && !volumeLabel)
  ) {
    throw new TypeError(`DOS FAT attributes do not describe a ${kind}`);
  }
}

function dosDriveErrorMessage(
  code: DosDriveErrorCode,
  drive: string,
  expectedGeneration?: number,
  actualGeneration?: number,
): string {
  switch (code) {
    case "invalid_drive":
      return `Invalid DOS drive ${drive}:`;
    case "no_media":
      return `No media in DOS drive ${drive}:`;
    case "read_only":
      return `DOS drive ${drive}: is read-only`;
    case "media_changed":
      return `DOS drive ${drive}: media changed${expectedGeneration === undefined ? "" : ` (expected ${String(expectedGeneration)}, actual ${String(actualGeneration)})`}`;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isExplicitAsyncFunction(
  value: unknown,
): value is () => Promise<unknown> {
  return (
    typeof value === "function" &&
    Object.prototype.toString.call(value) === "[object AsyncFunction]"
  );
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    ((typeof value === "object" && value !== null) ||
      typeof value === "function") &&
    typeof Reflect.get(value, "then") === "function"
  );
}
