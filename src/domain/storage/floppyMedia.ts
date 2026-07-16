import {
  InMemoryFilesystem,
  isInMemoryFilesystemSnapshot,
  type InMemoryFilesystemSnapshot,
} from "../filesystem/inMemoryFilesystem.js";

export const floppyMediaSchema = 1 as const;
export const floppySectorBytes = 512;
export const floppySectorCount = 2_880;
export const floppyCapacityBytes = floppySectorBytes * floppySectorCount;
export const floppyDataStartLba = 33;
export const floppyDataClusterCount = floppySectorCount - floppyDataStartLba;
export const floppyMaximumMedia = 256;

const maximumEntries = 4_096;
const rootDirectoryEntries = 224;
const fatSectors = 9;
const fatCopies = 2;
const reservedSectors = 1;
const mediaDescriptor = 0xf0;
const minimumCluster = 2;
const maximumCluster = minimumCluster + floppyDataClusterCount - 1;
const fatEndOfChain = 0xfff;
const fat12Name =
  /^[A-Z0-9!#$%&'()@^_`{}~-]{1,8}(?:\.[A-Z0-9!#$%&'()@^_`{}~-]{1,3})?$/u;
const mediaIdPattern = /^f-[0-9a-hjkmnp-tv-z]{8}$/u;

export const fat12Attribute = Object.freeze({
  readOnly: 0x01,
  hidden: 0x02,
  system: 0x04,
  volumeLabel: 0x08,
  directory: 0x10,
  archive: 0x20,
});

export interface FloppyFatMetadataSnapshot {
  readonly attributes: number;
  readonly modifiedAtMilliseconds: number;
}

export interface FloppyMediaSnapshotV1 {
  readonly bootable: boolean;
  readonly clusterChains: readonly (readonly [
    path: string,
    clusters: readonly number[],
  ])[];
  readonly fatMetadata: readonly (readonly [
    path: string,
    metadata: FloppyFatMetadataSnapshot,
  ])[];
  readonly filesystem: InMemoryFilesystemSnapshot;
  readonly formatted: boolean;
  readonly instanceGeneration: number;
  readonly location: FloppyMediaLocation;
  readonly mediaId: string;
  readonly revision: number;
  readonly schema: typeof floppyMediaSchema;
  readonly volumeLabel: string;
  readonly writeProtected: boolean;
}

export type FloppyMediaLocation =
  | { readonly kind: "detached" }
  | { readonly computerId: string; readonly kind: "inserted" };

export type FloppyMediaSnapshot = FloppyMediaSnapshotV1;

export interface FloppyFormatOptions {
  readonly bootable?: boolean;
  readonly modifiedAtMilliseconds: number;
  readonly volumeLabel?: string;
}

export interface FloppyIoExtent {
  readonly lba: number;
  readonly sectorCount: number;
}

/**
 * One removable FAT12 medium. The tree is the convenient guest-facing form;
 * cluster chains and sector rendering are authoritative FAT12 projections.
 */
export class FloppyMedia {
  private filesystemValue = createFilesystem();
  private clusterChainsValue = new Map<string, readonly number[]>();
  private fatMetadataValue = new Map<string, FloppyFatMetadataSnapshot>();
  private formattedValue = false;
  private bootableValue = false;
  private volumeLabelValue = "";
  private writeProtectedValue = false;
  private instanceGenerationValue = 1;
  private locationValue: FloppyMediaLocation = Object.freeze({
    kind: "detached",
  });
  private revisionValue = 0;

  constructor(readonly mediaId: string) {
    requireMediaId(mediaId);
  }

  static restore(snapshot: unknown): FloppyMedia {
    const parsed = parseSnapshot(snapshot);
    const media = new FloppyMedia(parsed.mediaId);
    media.filesystemValue.restore(parsed.filesystem);
    media.clusterChainsValue = new Map(
      parsed.clusterChains.map(([path, clusters]) => [path, [...clusters]]),
    );
    media.fatMetadataValue = new Map(
      parsed.fatMetadata.map(([path, metadata]) => [path, { ...metadata }]),
    );
    media.formattedValue = parsed.formatted;
    media.bootableValue = parsed.bootable;
    media.volumeLabelValue = parsed.volumeLabel;
    media.writeProtectedValue = parsed.writeProtected;
    media.instanceGenerationValue = parsed.instanceGeneration;
    media.locationValue = parsed.location;
    media.revisionValue = parsed.revision;
    media.validateProjection();
    return media;
  }

  get bootable(): boolean {
    return this.bootableValue && this.hasBootFiles();
  }

  get formatted(): boolean {
    return this.formattedValue;
  }

  get freeBytes(): number {
    const allocatedClusters = [...this.clusterChainsValue.values()].reduce(
      (total, chain) => total + chain.length,
      0,
    );
    return (floppyDataClusterCount - allocatedClusters) * floppySectorBytes;
  }

  get filesystem(): InMemoryFilesystem {
    return this.filesystemValue;
  }

  get instanceGeneration(): number {
    return this.instanceGenerationValue;
  }

  get revision(): number {
    return this.revisionValue;
  }

  get location(): FloppyMediaLocation {
    return this.locationValue;
  }

  get volumeLabel(): string {
    return this.volumeLabelValue;
  }

  get writeProtected(): boolean {
    return this.writeProtectedValue;
  }

  format(options: FloppyFormatOptions): void {
    this.assertWritable();
    const label = normalizeVolumeLabel(options.volumeLabel ?? "");
    const timestamp = normalizeFatTime(options.modifiedAtMilliseconds);
    this.transaction(() => {
      this.filesystemValue = createFilesystem();
      this.clusterChainsValue.clear();
      this.fatMetadataValue.clear();
      this.formattedValue = true;
      this.bootableValue = false;
      this.volumeLabelValue = label;
      if (options.bootable === true) this.installBootFiles(timestamp);
      this.bumpRevision();
    });
  }

  installSystem(modifiedAtMilliseconds: number): void {
    this.requireFormatted();
    this.assertWritable();
    const timestamp = normalizeFatTime(modifiedAtMilliseconds);
    this.transaction(() => {
      this.installBootFiles(timestamp);
      this.bumpRevision();
    });
  }

  setWriteProtected(writeProtected: boolean): void {
    if (this.writeProtectedValue === writeProtected) return;
    this.writeProtectedValue = writeProtected;
    this.bumpRevision();
  }

  advanceInstanceGeneration(expectedGeneration: number): number {
    if (expectedGeneration !== this.instanceGenerationValue)
      throw new Error("Floppy media instance generation changed");
    if (this.instanceGenerationValue === Number.MAX_SAFE_INTEGER)
      throw new RangeError("Floppy media instance generation is exhausted");
    this.instanceGenerationValue += 1;
    this.bumpRevision();
    return this.instanceGenerationValue;
  }

  insert(computerId: string, expectedGeneration: number): void {
    requireComputerId(computerId);
    if (expectedGeneration !== this.instanceGenerationValue)
      throw new Error("Floppy media instance generation changed");
    if (this.locationValue.kind !== "detached")
      throw new Error(
        `Floppy media is already inserted in ${this.locationValue.computerId}`,
      );
    this.locationValue = Object.freeze({ computerId, kind: "inserted" });
    this.bumpRevision();
  }

  eject(computerId: string): number {
    requireComputerId(computerId);
    if (
      this.locationValue.kind !== "inserted" ||
      this.locationValue.computerId !== computerId
    )
      throw new Error("Floppy media is not inserted in this Computer");
    this.locationValue = Object.freeze({ kind: "detached" });
    return this.advanceInstanceGeneration(this.instanceGenerationValue);
  }

  list(path = "/"): readonly string[] {
    this.requireFormatted();
    return this.filesystemValue.list(normalizeFatPath(path));
  }

  exists(path: string): boolean {
    this.requireFormatted();
    return this.filesystemValue.exists(normalizeFatPath(path));
  }

  isDirectory(path: string): boolean {
    this.requireFormatted();
    return this.filesystemValue.isDirectory(normalizeFatPath(path));
  }

  readFile(path: string): string {
    this.requireFormatted();
    return this.filesystemValue.readFile(normalizeFatPath(path));
  }

  writeFile(
    path: string,
    contents: string,
    modifiedAtMilliseconds: number,
  ): void {
    this.requireFormatted();
    this.assertWritable();
    const normalized = normalizeFatPath(path);
    if (normalized === "/")
      throw new Error("Cannot write the FAT12 root directory");
    const timestamp = normalizeFatTime(modifiedAtMilliseconds);
    this.transaction(() => {
      const previous = this.clusterChainsValue.get(normalized) ?? [];
      const bytes = new TextEncoder().encode(contents).length;
      const requiredClusters = Math.ceil(bytes / floppySectorBytes);
      const nextChain = this.resizeClusterChain(
        previous,
        requiredClusters,
        normalized,
      );
      this.filesystemValue.writeFile(normalized, contents);
      this.filesystemValue.setModifiedTime(normalized, timestamp);
      this.clusterChainsValue.set(normalized, nextChain);
      this.fatMetadataValue.set(normalized, {
        attributes: fat12Attribute.archive,
        modifiedAtMilliseconds: timestamp,
      });
      this.assertRootCapacity();
      this.bumpRevision();
    });
  }

  makeDirectory(path: string, modifiedAtMilliseconds: number): void {
    this.requireFormatted();
    this.assertWritable();
    const normalized = normalizeFatPath(path);
    if (normalized === "/") return;
    const timestamp = normalizeFatTime(modifiedAtMilliseconds);
    this.transaction(() => {
      const chain = this.resizeClusterChain([], 1, normalized);
      this.filesystemValue.makeDirectory(normalized);
      this.filesystemValue.setModifiedTime(normalized, timestamp);
      this.clusterChainsValue.set(normalized, chain);
      this.fatMetadataValue.set(normalized, {
        attributes: fat12Attribute.directory,
        modifiedAtMilliseconds: timestamp,
      });
      this.assertRootCapacity();
      this.bumpRevision();
    });
  }

  delete(path: string): void {
    this.requireFormatted();
    this.assertWritable();
    const normalized = normalizeFatPath(path);
    if (normalized === "/")
      throw new Error("Cannot delete the FAT12 root directory");
    this.transaction(() => {
      const affected = [...this.clusterChainsValue.keys()].filter(
        (candidate) =>
          candidate === normalized || candidate.startsWith(`${normalized}/`),
      );
      this.filesystemValue.delete(normalized);
      for (const candidate of affected) {
        this.clusterChainsValue.delete(candidate);
        this.fatMetadataValue.delete(candidate);
      }
      this.bumpRevision();
    });
  }

  setVolumeLabel(label: string): void {
    this.requireFormatted();
    this.assertWritable();
    const normalized = normalizeVolumeLabel(label);
    if (normalized === this.volumeLabelValue) return;
    this.volumeLabelValue = normalized;
    this.bumpRevision();
  }

  setModifiedTime(path: string, modifiedAtMilliseconds: number): void {
    this.requireFormatted();
    this.assertWritable();
    const normalized = normalizeFatPath(path);
    if (normalized === "/") return;
    const metadata = this.fatMetadataValue.get(normalized);
    if (metadata === undefined)
      throw new Error(`FAT12 metadata not found: ${normalized}`);
    const timestamp = normalizeFatTime(modifiedAtMilliseconds);
    this.filesystemValue.setModifiedTime(normalized, timestamp);
    this.fatMetadataValue.set(normalized, {
      ...metadata,
      modifiedAtMilliseconds: timestamp,
    });
    this.bumpRevision();
  }

  metadata(path: string): Readonly<FloppyFatMetadataSnapshot> {
    const normalized = normalizeFatPath(path);
    if (normalized === "/")
      return {
        attributes: fat12Attribute.directory,
        modifiedAtMilliseconds: 0,
      };
    const metadata = this.fatMetadataValue.get(normalized);
    if (metadata === undefined)
      throw new Error(`FAT12 metadata not found: ${normalized}`);
    return Object.freeze({ ...metadata });
  }

  ioExtents(path: string): readonly FloppyIoExtent[] {
    this.requireFormatted();
    const normalized = normalizeFatPath(path);
    const clusters = this.clusterChainsValue.get(normalized) ?? [];
    if (clusters.length === 0) return [{ lba: 0, sectorCount: 1 }];
    const extents: FloppyIoExtent[] = [];
    for (const cluster of clusters) {
      const lba = floppyDataStartLba + cluster - minimumCluster;
      const last = extents.at(-1);
      if (last !== undefined && last.lba + last.sectorCount === lba) {
        extents[extents.length - 1] = {
          lba: last.lba,
          sectorCount: last.sectorCount + 1,
        };
      } else extents.push({ lba, sectorCount: 1 });
    }
    return Object.freeze(extents);
  }

  sector(lba: number): Uint8Array {
    this.requireFormatted();
    if (!Number.isSafeInteger(lba) || lba < 0 || lba >= floppySectorCount)
      throw new RangeError("FAT12 LBA is outside the medium");
    if (lba === 0) return this.bootSector();
    if (lba < reservedSectors + fatSectors * fatCopies) {
      const relative = (lba - reservedSectors) % fatSectors;
      return this.fatBytes().slice(
        relative * floppySectorBytes,
        (relative + 1) * floppySectorBytes,
      );
    }
    if (lba < floppyDataStartLba) {
      const rootBytes = this.directoryBytes("/", rootDirectoryEntries);
      const relative = lba - (reservedSectors + fatSectors * fatCopies);
      return rootBytes.slice(
        relative * floppySectorBytes,
        (relative + 1) * floppySectorBytes,
      );
    }
    const cluster = lba - floppyDataStartLba + minimumCluster;
    const owner = [...this.clusterChainsValue].find(([, chain]) =>
      chain.includes(cluster),
    );
    if (owner === undefined) return new Uint8Array(floppySectorBytes);
    const [path, chain] = owner;
    if (this.filesystemValue.isDirectory(path))
      return this.directoryCluster(path);
    const index = chain.indexOf(cluster);
    const bytes = new TextEncoder().encode(this.filesystemValue.readFile(path));
    return paddedSector(
      bytes.slice(index * floppySectorBytes, (index + 1) * floppySectorBytes),
    );
  }

  snapshot(): FloppyMediaSnapshotV1 {
    return Object.freeze({
      bootable: this.bootableValue,
      clusterChains: Object.freeze(
        [...this.clusterChainsValue]
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([path, clusters]) =>
            Object.freeze([path, Object.freeze([...clusters])] as const),
          ),
      ),
      fatMetadata: Object.freeze(
        [...this.fatMetadataValue]
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([path, metadata]) =>
            Object.freeze([path, Object.freeze({ ...metadata })] as const),
          ),
      ),
      filesystem: this.filesystemValue.snapshot(),
      formatted: this.formattedValue,
      instanceGeneration: this.instanceGenerationValue,
      location: this.locationValue,
      mediaId: this.mediaId,
      revision: this.revisionValue,
      schema: floppyMediaSchema,
      volumeLabel: this.volumeLabelValue,
      writeProtected: this.writeProtectedValue,
    });
  }

  transaction<Result>(operation: () => Result): Result {
    const before = this.snapshot();
    try {
      const result = operation();
      if (isPromiseLike(result))
        throw new TypeError("Floppy transaction must be synchronous");
      return result;
    } catch (error: unknown) {
      this.restoreInPlace(before);
      throw error;
    }
  }

  private installBootFiles(timestamp: number): void {
    for (const [path, contents] of [
      ["/IO.SYS", "CS-DOS boot loader\r\n"],
      ["/MSDOS.SYS", "CS-DOS system capsule\r\n"],
      ["/COMMAND.COM", "CS-DOS command interpreter\r\n"],
    ] as const) {
      this.writeFile(path, contents, timestamp);
      this.fatMetadataValue.set(path, {
        attributes:
          path === "/COMMAND.COM"
            ? fat12Attribute.archive
            : fat12Attribute.hidden |
              fat12Attribute.system |
              fat12Attribute.readOnly,
        modifiedAtMilliseconds: timestamp,
      });
    }
    this.bootableValue = true;
  }

  private hasBootFiles(): boolean {
    return ["/IO.SYS", "/MSDOS.SYS", "/COMMAND.COM"].every(
      (path) =>
        this.filesystemValue.exists(path) &&
        !this.filesystemValue.isDirectory(path),
    );
  }

  private resizeClusterChain(
    current: readonly number[],
    required: number,
    path: string,
  ): readonly number[] {
    if (
      !Number.isSafeInteger(required) ||
      required < 0 ||
      required > floppyDataClusterCount
    )
      throw new RangeError("Invalid FAT12 cluster requirement");
    if (required <= current.length)
      return Object.freeze(current.slice(0, required));
    const used = new Set<number>();
    for (const [candidatePath, chain] of this.clusterChainsValue) {
      if (candidatePath === path) continue;
      for (const cluster of chain) used.add(cluster);
    }
    const next = [...current];
    for (
      let cluster = minimumCluster;
      cluster <= maximumCluster && next.length < required;
      cluster += 1
    ) {
      if (!used.has(cluster) && !next.includes(cluster)) next.push(cluster);
    }
    if (next.length !== required) throw new Error("FAT12 disk is full");
    return Object.freeze(next);
  }

  private assertRootCapacity(): void {
    if (
      this.filesystemValue.list("/").length +
        (this.volumeLabelValue.length > 0 ? 1 : 0) >
      rootDirectoryEntries
    )
      throw new Error("FAT12 root directory is full");
  }

  private assertWritable(): void {
    if (this.writeProtectedValue)
      throw new Error("Floppy media is write-protected");
  }

  private requireFormatted(): void {
    if (!this.formattedValue) throw new Error("Floppy media is not formatted");
  }

  private bumpRevision(): void {
    if (this.revisionValue === Number.MAX_SAFE_INTEGER)
      throw new RangeError("Floppy media revision is exhausted");
    this.revisionValue += 1;
  }

  private restoreInPlace(snapshot: FloppyMediaSnapshotV1): void {
    this.filesystemValue = createFilesystem();
    this.filesystemValue.restore(snapshot.filesystem);
    this.clusterChainsValue = new Map(
      snapshot.clusterChains.map(([path, chain]) => [path, [...chain]]),
    );
    this.fatMetadataValue = new Map(
      snapshot.fatMetadata.map(([path, value]) => [path, { ...value }]),
    );
    this.formattedValue = snapshot.formatted;
    this.bootableValue = snapshot.bootable;
    this.volumeLabelValue = snapshot.volumeLabel;
    this.writeProtectedValue = snapshot.writeProtected;
    this.instanceGenerationValue = snapshot.instanceGeneration;
    this.locationValue = snapshot.location;
    this.revisionValue = snapshot.revision;
  }

  private validateProjection(): void {
    const owners = new Set<number>();
    for (const [path, chain] of this.clusterChainsValue) {
      if (!this.filesystemValue.exists(path))
        throw new TypeError(`FAT12 chain owner is missing: ${path}`);
      if (!this.fatMetadataValue.has(path))
        throw new TypeError(`FAT12 metadata is missing: ${path}`);
      for (const cluster of chain) {
        if (
          !Number.isSafeInteger(cluster) ||
          cluster < minimumCluster ||
          cluster > maximumCluster ||
          owners.has(cluster)
        )
          throw new TypeError("Invalid or duplicate FAT12 cluster");
        owners.add(cluster);
      }
      const expected = this.filesystemValue.isDirectory(path)
        ? 1
        : Math.ceil(this.filesystemValue.getSize(path) / floppySectorBytes);
      if (chain.length !== expected)
        throw new TypeError(`FAT12 cluster length mismatch: ${path}`);
    }
    if (
      [...this.fatMetadataValue.keys()].some(
        (path) => !this.clusterChainsValue.has(path),
      )
    )
      throw new TypeError("FAT12 metadata has no cluster-chain owner");
    this.assertRootCapacity();
  }

  private bootSector(): Uint8Array {
    const bytes = new Uint8Array(floppySectorBytes);
    bytes.set([0xeb, 0x3c, 0x90], 0);
    bytes.set(new TextEncoder().encode("CSFAT12 "), 3);
    write16(bytes, 11, floppySectorBytes);
    bytes[13] = 1;
    write16(bytes, 14, reservedSectors);
    bytes[16] = fatCopies;
    write16(bytes, 17, rootDirectoryEntries);
    write16(bytes, 19, floppySectorCount);
    bytes[21] = mediaDescriptor;
    write16(bytes, 22, fatSectors);
    write16(bytes, 24, 18);
    write16(bytes, 26, 2);
    bytes[36] = 0;
    bytes[38] = 0x29;
    write32(bytes, 39, mediaSerial(this.mediaId));
    bytes.set(
      new TextEncoder().encode(this.volumeLabelValue.padEnd(11, " ")),
      43,
    );
    bytes.set(new TextEncoder().encode("FAT12   "), 54);
    if (this.bootable) {
      bytes.set(new TextEncoder().encode("CS-DOS bootable floppy"), 62);
    } else bytes.set(new TextEncoder().encode("Non-system disk"), 62);
    bytes[510] = 0x55;
    bytes[511] = 0xaa;
    return bytes;
  }

  private fatBytes(): Uint8Array {
    const fat = new Uint8Array(fatSectors * floppySectorBytes);
    setFat12(fat, 0, 0xff0 | mediaDescriptor);
    setFat12(fat, 1, fatEndOfChain);
    for (const chain of this.clusterChainsValue.values()) {
      for (let index = 0; index < chain.length; index += 1)
        setFat12(fat, chain[index]!, chain[index + 1] ?? fatEndOfChain);
    }
    return fat;
  }

  private directoryCluster(path: string): Uint8Array {
    return this.directoryBytes(path, 16).slice(0, floppySectorBytes);
  }

  private directoryBytes(path: string, maximum: number): Uint8Array {
    const bytes = new Uint8Array(maximum * 32);
    let index = 0;
    if (path === "/" && this.volumeLabelValue.length > 0) {
      writeDirectoryEntry(
        bytes,
        index++,
        this.volumeLabelValue,
        fat12Attribute.volumeLabel,
        0,
        0,
        0,
      );
    }
    for (const name of this.filesystemValue.list(path).sort()) {
      if (index >= maximum) break;
      const child = path === "/" ? `/${name}` : `${path}/${name}`;
      const metadata = this.fatMetadataValue.get(child)!;
      const chain = this.clusterChainsValue.get(child) ?? [];
      writeDirectoryEntry(
        bytes,
        index++,
        name,
        metadata.attributes,
        chain[0] ?? 0,
        this.filesystemValue.isDirectory(child)
          ? 0
          : this.filesystemValue.getSize(child),
        metadata.modifiedAtMilliseconds,
      );
    }
    return bytes;
  }
}

export function isFloppyMediaSnapshot(
  value: unknown,
): value is FloppyMediaSnapshotV1 {
  try {
    parseSnapshot(value);
    return true;
  } catch {
    return false;
  }
}

export function requireMediaId(mediaId: string): string {
  if (!mediaIdPattern.test(mediaId))
    throw new TypeError("Invalid Floppy media ID");
  return mediaId;
}

export function normalizeFatPath(path: string): string {
  if (typeof path !== "string" || path.includes("\0"))
    throw new TypeError("Invalid FAT12 path");
  const source = path.replaceAll("\\", "/");
  if (!source.startsWith("/"))
    throw new TypeError("FAT12 path must be absolute");
  const segments: string[] = [];
  for (const raw of source.split("/")) {
    if (raw.length === 0 || raw === ".") continue;
    if (raw === "..")
      throw new TypeError("FAT12 parent traversal is not allowed");
    const segment = raw.toUpperCase();
    if (!fat12Name.test(segment))
      throw new TypeError(`Invalid FAT12 8.3 name: ${raw}`);
    segments.push(segment);
    if (segments.length > 32)
      throw new RangeError("FAT12 path depth limit exceeded");
  }
  const normalized = `/${segments.join("/")}`;
  if (normalized.length > 255)
    throw new RangeError("FAT12 path length limit exceeded");
  return normalized;
}

export function normalizeFatTime(milliseconds: number): number {
  if (!Number.isFinite(milliseconds))
    throw new TypeError("FAT timestamp must be finite");
  const minimum = Date.UTC(1980, 0, 1);
  const maximum = Date.UTC(2107, 11, 31, 23, 59, 58);
  return (
    Math.floor(Math.min(maximum, Math.max(minimum, milliseconds)) / 2_000) *
    2_000
  );
}

function createFilesystem(): InMemoryFilesystem {
  return new InMemoryFilesystem({
    capacityBytes: floppyDataClusterCount * floppySectorBytes,
    maxEntries: maximumEntries,
    maxFileBytes: floppyDataClusterCount * floppySectorBytes,
    maxPathLength: 255,
  });
}

function parseSnapshot(value: unknown): FloppyMediaSnapshotV1 {
  if (!isRecord(value) || value.schema !== floppyMediaSchema)
    throw new TypeError("Unsupported Floppy media snapshot");
  const keys = Object.keys(value).sort();
  const expected = [
    "bootable",
    "clusterChains",
    "fatMetadata",
    "filesystem",
    "formatted",
    "instanceGeneration",
    "location",
    "mediaId",
    "revision",
    "schema",
    "volumeLabel",
    "writeProtected",
  ].sort();
  if (
    keys.length !== expected.length ||
    keys.some((key, index) => key !== expected[index])
  )
    throw new TypeError("Invalid Floppy media snapshot fields");
  const instanceGeneration = value.instanceGeneration;
  const revision = value.revision;
  if (
    typeof value.bootable !== "boolean" ||
    typeof value.formatted !== "boolean" ||
    typeof value.writeProtected !== "boolean" ||
    typeof value.mediaId !== "string" ||
    typeof value.volumeLabel !== "string" ||
    typeof instanceGeneration !== "number" ||
    !Number.isSafeInteger(instanceGeneration) ||
    instanceGeneration < 1 ||
    typeof revision !== "number" ||
    !Number.isSafeInteger(revision) ||
    revision < 0 ||
    !isInMemoryFilesystemSnapshot(value.filesystem) ||
    !Array.isArray(value.clusterChains) ||
    !Array.isArray(value.fatMetadata)
  )
    throw new TypeError("Invalid Floppy media snapshot");
  requireMediaId(value.mediaId);
  const volumeLabel = normalizeVolumeLabel(value.volumeLabel);
  if (volumeLabel !== value.volumeLabel)
    throw new TypeError("Non-canonical Floppy label");
  const clusterChains = value.clusterChains.map((entry) => {
    if (
      !Array.isArray(entry) ||
      entry.length !== 2 ||
      typeof entry[0] !== "string" ||
      !Array.isArray(entry[1])
    )
      throw new TypeError("Invalid FAT12 cluster chain");
    const path = normalizeFatPath(entry[0]);
    const clusters = entry[1].map((cluster: unknown): number => {
      if (typeof cluster !== "number" || !Number.isSafeInteger(cluster))
        throw new TypeError("Invalid FAT12 cluster chain");
      return cluster;
    });
    if (path !== entry[0]) throw new TypeError("Invalid FAT12 cluster chain");
    return Object.freeze([path, Object.freeze(clusters)] as const);
  });
  const fatMetadata = value.fatMetadata.map((entry) => {
    if (
      !Array.isArray(entry) ||
      entry.length !== 2 ||
      typeof entry[0] !== "string" ||
      !isRecord(entry[1])
    )
      throw new TypeError("Invalid FAT12 metadata");
    const path = normalizeFatPath(entry[0]);
    const attributesValue = entry[1].attributes;
    const modifiedAtMilliseconds = entry[1].modifiedAtMilliseconds;
    if (
      path !== entry[0] ||
      typeof attributesValue !== "number" ||
      !Number.isSafeInteger(attributesValue) ||
      attributesValue < 0 ||
      attributesValue > 0x3f ||
      typeof modifiedAtMilliseconds !== "number" ||
      normalizeFatTime(modifiedAtMilliseconds) !== modifiedAtMilliseconds
    )
      throw new TypeError("Invalid FAT12 metadata");
    const attributes = attributesValue;
    return Object.freeze([
      path,
      Object.freeze({ attributes, modifiedAtMilliseconds }),
    ] as const);
  });
  if (
    new Set(clusterChains.map(([path]) => path)).size !==
      clusterChains.length ||
    new Set(fatMetadata.map(([path]) => path)).size !== fatMetadata.length
  )
    throw new TypeError("Duplicate FAT12 snapshot path");
  if (
    !value.formatted &&
    (value.bootable ||
      clusterChains.length > 0 ||
      fatMetadata.length > 0 ||
      volumeLabel.length > 0)
  )
    throw new TypeError("Unformatted Floppy contains FAT12 state");
  const location = parseLocation(value.location);
  return Object.freeze({
    bootable: value.bootable,
    clusterChains: Object.freeze(clusterChains),
    fatMetadata: Object.freeze(fatMetadata),
    filesystem: value.filesystem,
    formatted: value.formatted,
    instanceGeneration,
    location,
    mediaId: value.mediaId,
    revision,
    schema: floppyMediaSchema,
    volumeLabel,
    writeProtected: value.writeProtected,
  });
}

function parseLocation(value: unknown): FloppyMediaLocation {
  if (!isRecord(value) || typeof value.kind !== "string")
    throw new TypeError("Invalid Floppy media location");
  if (value.kind === "detached" && Object.keys(value).length === 1)
    return Object.freeze({ kind: "detached" });
  if (
    value.kind === "inserted" &&
    Object.keys(value).length === 2 &&
    typeof value.computerId === "string"
  ) {
    requireComputerId(value.computerId);
    return Object.freeze({ computerId: value.computerId, kind: "inserted" });
  }
  throw new TypeError("Invalid Floppy media location");
}

function requireComputerId(computerId: string): void {
  if (!/^c-[0-9a-hjkmnp-tv-z]{6}$/u.test(computerId))
    throw new TypeError("Invalid Computer identity for Floppy media");
}

function normalizeVolumeLabel(label: string): string {
  const normalized = label.trim().toUpperCase();
  const forbidden = '"*+,./:;<=>?[\\]|';
  if (
    normalized.length > 11 ||
    [...normalized].some((character) => forbidden.includes(character)) ||
    normalized.includes("\0")
  )
    throw new TypeError("Invalid FAT12 volume label");
  return normalized;
}

function setFat12(bytes: Uint8Array, cluster: number, value: number): void {
  const offset = Math.floor((cluster * 3) / 2);
  if ((cluster & 1) === 0) {
    bytes[offset] = value & 0xff;
    bytes[offset + 1] = (bytes[offset + 1]! & 0xf0) | ((value >>> 8) & 0x0f);
  } else {
    bytes[offset] = (bytes[offset]! & 0x0f) | ((value << 4) & 0xf0);
    bytes[offset + 1] = (value >>> 4) & 0xff;
  }
}

function writeDirectoryEntry(
  bytes: Uint8Array,
  index: number,
  name: string,
  attributes: number,
  cluster: number,
  size: number,
  modifiedAtMilliseconds: number,
): void {
  const offset = index * 32;
  if ((attributes & fat12Attribute.volumeLabel) !== 0) {
    bytes.set(
      new TextEncoder().encode(name.padEnd(11, " ").slice(0, 11)),
      offset,
    );
    bytes[offset + 11] = attributes;
    return;
  }
  const [base, extension = ""] = name.split(".");
  bytes.set(new TextEncoder().encode(base!.padEnd(8, " ").slice(0, 8)), offset);
  bytes.set(
    new TextEncoder().encode(extension.padEnd(3, " ").slice(0, 3)),
    offset + 8,
  );
  bytes[offset + 11] = attributes;
  const date = new Date(modifiedAtMilliseconds || Date.UTC(1980, 0, 1));
  const timeWord =
    (date.getUTCHours() << 11) |
    (date.getUTCMinutes() << 5) |
    Math.floor(date.getUTCSeconds() / 2);
  const dateWord =
    ((date.getUTCFullYear() - 1980) << 9) |
    ((date.getUTCMonth() + 1) << 5) |
    date.getUTCDate();
  write16(bytes, offset + 22, timeWord);
  write16(bytes, offset + 24, dateWord);
  write16(bytes, offset + 26, cluster);
  write32(bytes, offset + 28, size);
}

function paddedSector(source: Uint8Array): Uint8Array {
  const sector = new Uint8Array(floppySectorBytes);
  sector.set(source.slice(0, floppySectorBytes));
  return sector;
}

function write16(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >>> 8) & 0xff;
}

function write32(bytes: Uint8Array, offset: number, value: number): void {
  write16(bytes, offset, value & 0xffff);
  write16(bytes, offset + 2, Math.floor(value / 0x1_0000));
}

function mediaSerial(mediaId: string): number {
  let value = 0x811c9dc5;
  for (const character of mediaId) {
    value ^= character.charCodeAt(0);
    value = Math.imul(value, 0x01000193) >>> 0;
  }
  return value;
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    (typeof value === "object" || typeof value === "function") &&
    value !== null &&
    "then" in value
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
