import {
  quarantineRejectedAsyncTransaction,
  rejectedAsyncTransactionCount,
} from "../runtime/transactionQuarantine.js";
import {
  decodeUtf8,
  encodeUtf8,
  utf8ByteLength as utf8Size,
} from "../text/utf8.js";

export interface FilesystemLimits {
  readonly allocationUnitBytes?: number;
  readonly capacityBytes: number;
  readonly directoryEntryBytes?: number;
  readonly maxEntries: number;
  readonly maxFileBytes: number;
  readonly maxPathLength: number;
  readonly reservedBytes?: number;
  readonly rootDirectoryEntries?: number;
}

export const defaultFilesystemLimits: FilesystemLimits = {
  allocationUnitBytes: 1,
  capacityBytes: 40 * 1_048_576,
  directoryEntryBytes: 0,
  maxEntries: 4_096,
  maxFileBytes: 8 * 1_048_576,
  maxPathLength: 255,
  reservedBytes: 0,
};

export interface InMemoryFilesystemSnapshot {
  readonly schema: 2;
  readonly baseImageId?: string;
  readonly blobs: readonly (readonly [id: string, contents: string])[];
  readonly directories: readonly string[];
  readonly files: readonly (readonly [path: string, blobId: string])[];
  readonly metadata?: readonly (readonly [
    path: string,
    metadata: FilesystemMetadata,
  ])[];
  readonly symbolicLinks?: readonly (readonly [path: string, target: string])[];
  readonly hardLinks?: readonly (readonly string[])[];
  readonly tombstones?: readonly string[];
}

/**
 * The filesystem payload written by Computer snapshot schema 1. It predates
 * base images and stores file contents inline instead of by content ID.
 */
export interface LegacyInMemoryFilesystemSnapshot {
  readonly directories: readonly string[];
  readonly files: readonly (readonly [path: string, contents: string])[];
  readonly metadata?: readonly (readonly [
    path: string,
    metadata: FilesystemMetadata,
  ])[];
  readonly symbolicLinks?: readonly (readonly [path: string, target: string])[];
  readonly hardLinks?: readonly (readonly string[])[];
}

export interface FilesystemBaseImageFile {
  readonly contents: string;
  readonly metadata?: Partial<
    Pick<FilesystemMetadata, "gid" | "mode" | "modifiedAtMilliseconds" | "uid">
  >;
  readonly path: string;
}

export interface FilesystemBaseImage {
  readonly directories: readonly string[];
  readonly files: readonly FilesystemBaseImageFile[];
  readonly id: string;
}

export interface FilesystemMetadata {
  readonly gid: number;
  readonly mode: number;
  readonly modifiedAtMilliseconds: number;
  readonly uid: number;
}

export type SynchronousTransactionOperation<Result> =
  () => Result extends PromiseLike<unknown> ? never : Result;

export function isInMemoryFilesystemSnapshot(
  value: unknown,
): value is InMemoryFilesystemSnapshot {
  if (!isRecord(value) || value.schema !== 2) return false;
  if (
    !hasOnlyKeys(value, [
      "schema",
      "baseImageId",
      "blobs",
      "directories",
      "files",
      "metadata",
      "symbolicLinks",
      "hardLinks",
      "tombstones",
    ]) ||
    (value.baseImageId !== undefined &&
      (typeof value.baseImageId !== "string" ||
        !/^[a-z0-9][a-z0-9._-]{0,63}$/u.test(value.baseImageId))) ||
    !isStringTupleArray(value.blobs) ||
    !isStringArray(value.directories) ||
    !isStringTupleArray(value.files) ||
    (value.metadata !== undefined && !isMetadataTupleArray(value.metadata)) ||
    (value.symbolicLinks !== undefined &&
      !isStringTupleArray(value.symbolicLinks)) ||
    (value.hardLinks !== undefined && !isHardLinkGroups(value.hardLinks)) ||
    (value.tombstones !== undefined && !isStringArray(value.tombstones))
  ) {
    return false;
  }

  const blobIds = new Set<string>();
  for (const [id, contents] of value.blobs) {
    if (blobIds.has(id) || storedBlobId(contents, id) !== id) return false;
    blobIds.add(id);
  }
  if (!areUniqueValidPaths(value.directories, false)) return false;
  const filePaths = value.files.map(([path]) => path);
  if (
    !areUniqueValidPaths(filePaths, false) ||
    value.files.some(([, blobId]) => !blobIds.has(blobId))
  ) {
    return false;
  }
  const symbolicLinkPaths = (value.symbolicLinks ?? []).map(([path]) => path);
  if (
    !areUniqueValidPaths(symbolicLinkPaths, false) ||
    (value.symbolicLinks ?? []).some(([, target]) => target.includes("\0")) ||
    !pathsAreDisjoint(value.directories, filePaths, symbolicLinkPaths) ||
    (value.metadata !== undefined &&
      !areUniqueValidPaths(
        value.metadata.map(([path]) => path),
        false,
      )) ||
    (value.tombstones !== undefined &&
      !areUniqueValidPaths(value.tombstones, false)) ||
    !hardLinkPathsAreUnique(value.hardLinks ?? [])
  ) {
    return false;
  }
  return true;
}

export function isLegacyInMemoryFilesystemSnapshot(
  value: unknown,
): value is LegacyInMemoryFilesystemSnapshot {
  if (!isRecord(value) || "schema" in value) return false;
  if (
    !hasOnlyKeys(value, [
      "directories",
      "files",
      "metadata",
      "symbolicLinks",
      "hardLinks",
    ]) ||
    !isStringArray(value.directories) ||
    !isStringTupleArray(value.files) ||
    (value.metadata !== undefined && !isMetadataTupleArray(value.metadata)) ||
    (value.symbolicLinks !== undefined &&
      !isStringTupleArray(value.symbolicLinks)) ||
    (value.hardLinks !== undefined && !isHardLinkGroups(value.hardLinks))
  ) {
    return false;
  }

  const directoryPaths = value.directories;
  const filePaths = value.files.map(([path]) => path);
  const symbolicLinkPaths = (value.symbolicLinks ?? []).map(([path]) => path);
  const existingPaths = new Set([
    ...directoryPaths,
    ...filePaths,
    ...symbolicLinkPaths,
  ]);
  if (
    !areUniqueValidPaths(directoryPaths, false) ||
    !areUniqueValidPaths(filePaths, false) ||
    !areUniqueValidPaths(symbolicLinkPaths, false) ||
    !pathsAreDisjoint(directoryPaths, filePaths, symbolicLinkPaths) ||
    !allParentsExist(existingPaths, directoryPaths) ||
    (value.symbolicLinks ?? []).some(([, target]) => target.includes("\0")) ||
    (value.metadata !== undefined &&
      (!areUniqueValidPaths(
        value.metadata.map(([path]) => path),
        false,
      ) ||
        value.metadata.some(([path]) => !existingPaths.has(path)))) ||
    !hardLinksAreValid(value.hardLinks ?? [], new Map(value.files))
  ) {
    return false;
  }
  return true;
}

export function migrateLegacyInMemoryFilesystemSnapshot(
  snapshot: LegacyInMemoryFilesystemSnapshot,
): InMemoryFilesystemSnapshot {
  if (!isLegacyInMemoryFilesystemSnapshot(snapshot)) {
    throw new TypeError("Invalid legacy filesystem snapshot");
  }
  const blobs = new Map<string, string>();
  const files = snapshot.files.map(([path, contents]) => {
    const blobId = contentBlobId(contents);
    const existing = blobs.get(blobId);
    if (existing !== undefined && existing !== contents) {
      throw new Error(`Filesystem blob collision for ${blobId}`);
    }
    blobs.set(blobId, contents);
    return [path, blobId] as const;
  });
  return {
    schema: 2,
    blobs: [...blobs]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([id, contents]) => [id, contents] as const),
    directories: [...snapshot.directories],
    files,
    metadata: snapshot.metadata?.map(
      ([path, metadata]) => [path, { ...metadata }] as const,
    ),
    symbolicLinks: snapshot.symbolicLinks?.map(
      ([path, target]) => [path, target] as const,
    ),
    hardLinks: snapshot.hardLinks?.map((paths) => [...paths]),
  };
}

const baseImages = new Map<string, FilesystemBaseImage>();
const contentBlobs = new Map<string, string>();

interface ActiveFilesystemTransaction {
  readonly createdBaseImageStateIds: Set<string>;
  readonly createdBlobIds: Set<string>;
  readonly owner: InMemoryFilesystem;
}

const activeFilesystemTransactions: ActiveFilesystemTransaction[] = [];

export function registerFilesystemBaseImage(image: FilesystemBaseImage): void {
  if (!/^[a-z0-9][a-z0-9._-]{0,63}$/u.test(image.id)) {
    throw new Error("Filesystem base-image ID is invalid");
  }
  const existing = baseImages.get(image.id);
  if (existing !== undefined && existing !== image) {
    throw new Error(`Filesystem base image ${image.id} is already registered`);
  }
  baseImages.set(image.id, image);
}

export function filesystemBlobPoolStats(): {
  readonly blobCount: number;
  readonly contentBytes: number;
} {
  let contentBytes = 0;
  for (const contents of contentBlobs.values())
    contentBytes += utf8Size(contents);
  return { blobCount: contentBlobs.size, contentBytes };
}

export class InMemoryFilesystem {
  /** Path -> content-addressed blob ID. Inode identity is tracked separately. */
  private readonly files = new Map<string, string>();
  private readonly metadata = new Map<string, FilesystemMetadata>();
  private readonly symbolicLinks = new Map<string, string>();
  private readonly hardLinkIds = new Map<string, number>();
  private readonly hardLinkCounts = new Map<number, number>();
  private readonly directories = new Set<string>(["/"]);
  private readonly children = new Map<string, Set<string>>([["/", new Set()]]);
  private revisionValue = 0;
  private usedBytesValue: number;
  private baseImage: FilesystemBaseImage | undefined;

  constructor(readonly limits: FilesystemLimits = defaultFilesystemLimits) {
    for (const name of [
      "capacityBytes",
      "maxEntries",
      "maxFileBytes",
      "maxPathLength",
    ] as const) {
      const value = limits[name];
      if (!Number.isSafeInteger(value) || value <= 0)
        throw new RangeError(`${name} must be positive`);
    }
    requireOptionalPositive(limits.allocationUnitBytes, "allocationUnitBytes");
    requireOptionalNonNegative(
      limits.directoryEntryBytes,
      "directoryEntryBytes",
    );
    requireOptionalNonNegative(limits.reservedBytes, "reservedBytes");
    requireOptionalPositive(
      limits.rootDirectoryEntries,
      "rootDirectoryEntries",
    );
    if (this.reservedBytes >= limits.capacityBytes) {
      throw new RangeError("reservedBytes must be smaller than capacityBytes");
    }
    this.usedBytesValue = this.reservedBytes;
    this.metadata.set("/", defaultMetadata(true));
  }

  get revision(): number {
    return this.revisionValue;
  }

  get baseImageId(): string | undefined {
    return this.baseImage?.id;
  }

  /**
   * Runs one bounded synchronous filesystem mutation atomically.
   *
   * The filesystem has a fixed entry ceiling, so capturing every mutable index
   * is bounded O(N). Restoring the internal indexes directly preserves inode
   * identities, hard-link groups, metadata, byte accounting, and the revision;
   * replaying a persistence snapshot would not preserve those identities.
   */
  transaction<Result>(
    operation: SynchronousTransactionOperation<Result>,
  ): Result {
    this.assertTransactionMutationAllowed();
    if (isExplicitAsyncFunction(operation)) {
      throw new FilesystemError(
        "transaction_async",
        "Filesystem transactions require a synchronous callback",
      );
    }
    const rejectedAsyncTransactions = rejectedAsyncTransactionCount();
    const before = {
      baseImage: this.baseImage,
      children: new Map(
        [...this.children].map(
          ([path, names]) => [path, new Set(names)] as const,
        ),
      ),
      directories: new Set(this.directories),
      files: new Map(this.files),
      hardLinkCounts: new Map(this.hardLinkCounts),
      hardLinkIds: new Map(this.hardLinkIds),
      metadata: new Map(
        [...this.metadata].map(
          ([path, metadata]) => [path, { ...metadata }] as const,
        ),
      ),
      nextHardLinkId,
      revision: this.revisionValue,
      symbolicLinks: new Map(this.symbolicLinks),
      usedBytes: this.usedBytesValue,
    };
    const frame: ActiveFilesystemTransaction = {
      createdBaseImageStateIds: new Set(),
      createdBlobIds: new Set(),
      owner: this,
    };
    activeFilesystemTransactions.push(frame);
    try {
      const result = operation();
      if (isThenable(result)) this.rejectThenableTransaction(result);
      if (rejectedAsyncTransactionCount() !== rejectedAsyncTransactions) {
        throw new FilesystemError(
          "transaction_async",
          "Filesystem transaction contains a rejected asynchronous transaction",
        );
      }
      return result;
    } catch (error: unknown) {
      try {
        this.files.clear();
        this.directories.clear();
        this.children.clear();
        this.metadata.clear();
        this.symbolicLinks.clear();
        this.hardLinkIds.clear();
        this.hardLinkCounts.clear();
        for (const [path, blobId] of before.files) this.files.set(path, blobId);
        for (const path of before.directories) this.directories.add(path);
        for (const [path, names] of before.children)
          this.children.set(path, new Set(names));
        for (const [path, metadata] of before.metadata)
          this.metadata.set(path, { ...metadata });
        for (const [path, target] of before.symbolicLinks)
          this.symbolicLinks.set(path, target);
        for (const [path, inodeId] of before.hardLinkIds)
          this.hardLinkIds.set(path, inodeId);
        for (const [inodeId, count] of before.hardLinkCounts)
          this.hardLinkCounts.set(inodeId, count);
        this.usedBytesValue = before.usedBytes;
        this.baseImage = before.baseImage;
        nextHardLinkId = before.nextHardLinkId;
        this.revisionValue = before.revision;
        for (const id of frame.createdBaseImageStateIds)
          baseImageStates.delete(id);
        for (const id of frame.createdBlobIds) contentBlobs.delete(id);
      } catch (rollbackError: unknown) {
        throw new AggregateError(
          [error, rollbackError],
          "Filesystem transaction rollback failed",
        );
      }
      throw error;
    } finally {
      activeFilesystemTransactions.pop();
    }
  }

  attachBaseImage(image: FilesystemBaseImage): void {
    this.assertTransactionMutationAllowed();
    if (activeFilesystemTransactions.at(-1)?.owner !== this) {
      this.transaction(() => this.attachBaseImage(image));
      return;
    }
    if (this.baseImage?.id === image.id) return;
    const previousBase =
      this.baseImage === undefined ? undefined : baseImageState(this.baseImage);
    const previousTombstones = new Set(
      previousBase === undefined
        ? []
        : [...previousBase.paths].filter(
            (path) => !this.hasCompatibleBaseEntry(path, previousBase),
          ),
    );
    const remainsDeleted = (path: string): boolean => {
      let candidate = path;
      while (candidate !== "/") {
        if (previousTombstones.has(candidate)) return true;
        candidate = parentPath(candidate);
      }
      return previousTombstones.has("/");
    };
    const imageDirectories = [...image.directories]
      .map((path) => this.normalize(path))
      .sort(
        (left, right) =>
          left.length - right.length || left.localeCompare(right),
      );
    const imageFiles = image.files.map((file) => ({
      file,
      path: this.normalize(file.path),
    }));
    const replaceableBaseFiles = new Set(
      previousBase === undefined
        ? []
        : imageFiles
            .map(({ path }) => path)
            .filter((path) => this.isUnmodifiedBaseFile(path, previousBase)),
    );
    const availableDirectories = new Set(this.directories);
    const addedDirectories = new Set<string>();
    for (const path of imageDirectories) {
      if (remainsDeleted(path)) continue;
      for (const candidate of ancestors(path)) {
        if (this.files.has(candidate)) {
          throw new FilesystemError("not_directory", `${candidate} is a file`);
        }
        if (this.symbolicLinks.has(candidate)) {
          throw new FilesystemError(
            "not_directory",
            `${candidate} is a symbolic link`,
          );
        }
        if (!availableDirectories.has(candidate)) {
          availableDirectories.add(candidate);
          addedDirectories.add(candidate);
        }
      }
    }
    let addedFiles = 0;
    let addedBytes = 0;
    const plannedFilePaths = new Set<string>();
    for (const { file, path } of imageFiles) {
      if (remainsDeleted(path)) continue;
      // A content/metadata/link-identical entry from the previous base can be
      // rebased. Every other exact entry is a per-Computer overlay, including
      // a deliberate type replacement of an older base entry.
      if (this.exists(path) && !replaceableBaseFiles.has(path)) continue;
      if (availableDirectories.has(path)) {
        throw new FilesystemError(
          "not_directory",
          `${path} is not a regular file`,
        );
      }
      if (plannedFilePaths.has(path)) {
        throw new FilesystemError(
          "exists",
          `${path} appears more than once in the base image`,
        );
      }
      const parent = parentPath(path);
      if (!availableDirectories.has(parent)) {
        throw new FilesystemError(
          "not_found",
          `Parent directory ${parent} does not exist`,
        );
      }
      const size = baseImageFileFacts(file).size;
      if (size > this.limits.maxFileBytes)
        throw new FilesystemError("file_limit", "File is too large");
      if (replaceableBaseFiles.has(path)) {
        const previousSize = previousBase!.sizes.get(path)!;
        addedBytes +=
          this.allocatedDataBytes(size) - this.allocatedDataBytes(previousSize);
        continue;
      }
      plannedFilePaths.add(path);
      addedFiles += 1;
      addedBytes += this.allocatedDataBytes(size);
    }
    this.checkEntryCount(addedDirectories.size + addedFiles);
    if (
      addedBytes > 0 &&
      this.usedBytesValue + addedBytes > this.limits.capacityBytes
    ) {
      throw new FilesystemError("capacity", "Filesystem capacity exceeded");
    }

    registerFilesystemBaseImage(image);
    const imageState = baseImageState(image);
    for (const path of imageDirectories) {
      if (remainsDeleted(path)) continue;
      const existed = this.exists(path);
      this.makeDirectory(path);
      if (!existed) {
        this.metadata.set(path, {
          ...defaultMetadata(true),
          modifiedAtMilliseconds: 0,
        });
      }
    }
    for (const { path } of imageFiles) {
      if (remainsDeleted(path)) continue;
      if (replaceableBaseFiles.has(path)) {
        const previousSize = previousBase!.sizes.get(path)!;
        const size = imageState.sizes.get(path)!;
        this.files.set(path, imageState.files.get(path)!);
        this.metadata.set(path, imageState.metadata.get(path)!);
        this.usedBytesValue +=
          this.allocatedDataBytes(size) - this.allocatedDataBytes(previousSize);
        this.revisionValue += 1;
        continue;
      }
      if (!this.exists(path)) {
        const size = imageState.sizes.get(path)!;
        if (size > this.limits.maxFileBytes)
          throw new FilesystemError("file_limit", "File is too large");
        const allocatedSize = this.allocatedDataBytes(size);
        if (
          allocatedSize > 0 &&
          this.usedBytesValue +
            allocatedSize +
            this.parentDirectoryGrowth(path) >
            this.limits.capacityBytes
        )
          throw new FilesystemError("capacity", "Filesystem capacity exceeded");
        this.requireParent(path);
        this.checkEntryCount(1);
        const inodeId = nextHardLinkId++;
        this.files.set(path, imageState.files.get(path)!);
        this.hardLinkIds.set(path, inodeId);
        this.hardLinkCounts.set(inodeId, 1);
        this.metadata.set(path, imageState.metadata.get(path)!);
        this.addChild(path);
        this.usedBytesValue += allocatedSize;
        this.revisionValue += 1;
      }
    }
    this.baseImage = image;
    // The selected immutable base is persisted state even when every new base
    // path is shadowed by an overlay and no directory or file was materialized.
    this.revisionValue += 1;
  }

  exists(path: string): boolean {
    const normalized = this.normalize(path);
    return (
      this.files.has(normalized) ||
      this.directories.has(normalized) ||
      this.symbolicLinks.has(normalized)
    );
  }

  isDirectory(path: string): boolean {
    return this.directories.has(this.resolveSymbolicLinks(path));
  }

  isSymbolicLink(path: string): boolean {
    return this.symbolicLinks.has(this.normalize(path));
  }

  readLink(path: string): string {
    const normalized = this.normalize(path);
    const target = this.symbolicLinks.get(normalized);
    if (target === undefined)
      throw new FilesystemError(
        "invalid_path",
        `${path} is not a symbolic link`,
      );
    return target;
  }

  createSymbolicLink(target: string, path: string): void {
    this.assertTransactionMutationAllowed();
    this.commitSymbolicLink(target, path, true);
  }

  private commitSymbolicLink(
    target: string,
    path: string,
    enforceCurrentLimits: boolean,
  ): void {
    const normalized = this.normalize(path);
    if (this.exists(normalized))
      throw new FilesystemError("exists", `${path} already exists`);
    this.requireParent(normalized);
    if (target.includes("\0"))
      throw new FilesystemError("invalid_path", "Link target contains NUL");
    const storedTarget = target.replaceAll("\\", "/");
    const targetBytes = utf8Size(storedTarget);
    const allocatedTargetBytes = this.allocatedDataBytes(targetBytes);
    if (enforceCurrentLimits && targetBytes > this.limits.maxPathLength)
      throw new FilesystemError("path_limit", "Link target is too long");
    if (enforceCurrentLimits) this.checkEntryCount(1);
    if (
      enforceCurrentLimits &&
      this.usedBytesValue +
        allocatedTargetBytes +
        this.parentDirectoryGrowth(normalized) >
        this.limits.capacityBytes
    ) {
      throw new FilesystemError("capacity", "Filesystem capacity exceeded");
    }
    this.symbolicLinks.set(normalized, storedTarget);
    this.metadata.set(normalized, defaultMetadata(false, 0o777));
    this.addChild(normalized);
    this.usedBytesValue += allocatedTargetBytes;
    this.revisionValue += 1;
  }

  createHardLink(existing: string, path: string): void {
    this.assertTransactionMutationAllowed();
    const source = this.resolveSymbolicLinks(existing);
    if (!this.files.has(source))
      throw new FilesystemError("not_found", `${existing} is not a file`);
    const destination = this.normalize(path);
    if (this.exists(destination))
      throw new FilesystemError("exists", `${path} already exists`);
    this.requireParent(destination);
    this.checkEntryCount(1);
    this.assertCapacity(this.parentDirectoryGrowth(destination));
    const id = this.requireInodeId(source);
    this.files.set(destination, this.files.get(source)!);
    this.hardLinkIds.set(source, id);
    this.hardLinkIds.set(destination, id);
    this.hardLinkCounts.set(id, (this.hardLinkCounts.get(id) ?? 1) + 1);
    this.metadata.set(destination, { ...this.getMetadata(source) });
    this.addChild(destination);
    this.revisionValue += 1;
  }

  getLinkCount(path: string): number {
    const normalized = this.resolveSymbolicLinks(path);
    const id = this.hardLinkIds.get(normalized);
    if (id === undefined) return 1;
    return this.hardLinkCounts.get(id) ?? 1;
  }

  resolveSymbolicLinks(path: string): string {
    let resolved = this.normalize(path);
    for (let hop = 0; hop < 16; hop += 1) {
      const segments = resolved.split("/").filter(Boolean);
      let prefix = "";
      let replaced = false;
      for (let index = 0; index < segments.length; index += 1) {
        prefix += `/${segments[index]}`;
        const target = this.symbolicLinks.get(prefix);
        if (target === undefined) continue;
        const linkTarget = target.startsWith("/")
          ? target
          : `${parentPath(prefix)}/${target}`;
        resolved = this.normalize(
          `${linkTarget}${segments.length > index + 1 ? `/${segments.slice(index + 1).join("/")}` : ""}`,
        );
        replaced = true;
        break;
      }
      if (!replaced) return resolved;
    }
    throw new FilesystemError(
      "invalid_path",
      `${path}: too many symbolic links`,
    );
  }

  list(path: string): string[] {
    const normalized = this.requireDirectory(path);
    return [...(this.children.get(normalized) ?? [])].sort();
  }

  makeDirectory(path: string): void {
    this.assertTransactionMutationAllowed();
    if (activeFilesystemTransactions.at(-1)?.owner !== this) {
      this.transaction(() => this.makeDirectory(path));
      return;
    }
    const normalized = this.normalize(path);
    if (this.files.has(normalized))
      throw new FilesystemError("not_directory", `${path} is a file`);
    if (this.symbolicLinks.has(normalized))
      throw new FilesystemError("exists", `${path} is a symbolic link`);
    const pathAncestors = ancestors(normalized);
    const additions = pathAncestors.filter(
      (candidate) => !this.directories.has(candidate),
    );
    const fileAncestor = pathAncestors.find((candidate) =>
      this.files.has(candidate),
    );
    if (fileAncestor !== undefined) {
      throw new FilesystemError("not_directory", `${fileAncestor} is a file`);
    }
    const symbolicLinkAncestor = pathAncestors.find((candidate) =>
      this.symbolicLinks.has(candidate),
    );
    if (symbolicLinkAncestor !== undefined) {
      throw new FilesystemError(
        "not_directory",
        `${symbolicLinkAncestor} is a symbolic link`,
      );
    }
    this.checkEntryCount(additions.length);
    for (const addition of additions) {
      const directoryBytes = this.directoryAllocatedBytes(addition, 0);
      this.assertCapacity(
        directoryBytes + this.parentDirectoryGrowth(addition),
      );
      this.directories.add(addition);
      this.children.set(addition, new Set());
      this.metadata.set(addition, defaultMetadata(true));
      this.usedBytesValue += directoryBytes;
      this.addChild(addition);
    }
    if (additions.length > 0) this.revisionValue += 1;
  }

  readFile(path: string): string {
    const normalized = this.resolveSymbolicLinks(path);
    const blobId = this.files.get(normalized);
    if (blobId === undefined)
      throw new FilesystemError("not_found", `${path} is not a file`);
    if (isBinaryBlobId(blobId)) {
      try {
        return decodeUtf8(decodeBase64Bytes(requireBlob(blobId)));
      } catch {
        throw new FilesystemError(
          "binary_file",
          `${path} contains non-UTF-8 binary data`,
        );
      }
    }
    return requireBlob(blobId);
  }

  readFileBytes(path: string): Uint8Array {
    const normalized = this.resolveSymbolicLinks(path);
    const blobId = this.files.get(normalized);
    if (blobId === undefined)
      throw new FilesystemError("not_found", `${path} is not a file`);
    return isBinaryBlobId(blobId)
      ? decodeBase64Bytes(requireBlob(blobId))
      : encodeUtf8(requireBlob(blobId));
  }

  writeFile(path: string, contents: string): void {
    this.assertTransactionMutationAllowed();
    const original = this.normalize(path);
    const normalized = this.symbolicLinks.has(original)
      ? this.resolveSymbolicLinks(original)
      : original;
    if (normalized === "/" || this.directories.has(normalized)) {
      throw new FilesystemError("is_directory", `${path} is a directory`);
    }
    this.requireParent(normalized);
    this.commitFile(normalized, contents);
  }

  writeFileBytes(path: string, contents: Uint8Array): void {
    this.assertTransactionMutationAllowed();
    const original = this.normalize(path);
    const normalized = this.symbolicLinks.has(original)
      ? this.resolveSymbolicLinks(original)
      : original;
    if (normalized === "/" || this.directories.has(normalized)) {
      throw new FilesystemError("is_directory", `${path} is a directory`);
    }
    this.requireParent(normalized);
    const bytes = new Uint8Array(contents);
    const blobId = internBinaryBlob(bytes);
    this.commitStoredFile(normalized, blobId, bytes.byteLength);
  }

  appendFile(path: string, contents: string): void {
    const normalized = this.normalize(path);
    const current = this.exists(normalized) ? this.readFile(normalized) : "";
    this.writeFile(normalized, current + contents);
  }

  delete(path: string): void {
    this.assertTransactionMutationAllowed();
    const normalized = this.normalize(path);
    if (normalized === "/")
      throw new FilesystemError("protected", "Cannot delete root");
    if (!this.exists(normalized))
      throw new FilesystemError("not_found", `${path} does not exist`);
    if (this.symbolicLinks.has(normalized)) {
      this.usedBytesValue -= this.allocatedDataBytes(
        utf8Size(this.symbolicLinks.get(normalized)!),
      );
      this.symbolicLinks.delete(normalized);
      this.metadata.delete(normalized);
      this.removeChild(normalized);
      this.revisionValue += 1;
      return;
    }
    const prefix = `${normalized}/`;
    for (const candidate of [...this.files.keys()]) {
      if (candidate === normalized || candidate.startsWith(prefix)) {
        const inodeId = this.requireInodeId(candidate);
        const count = this.hardLinkCounts.get(inodeId) ?? 1;
        if (count === 1) {
          this.usedBytesValue -= this.allocatedDataBytes(
            blobLogicalSize(this.files.get(candidate)!),
          );
        }
        this.files.delete(candidate);
        this.hardLinkIds.delete(candidate);
        if (count <= 1) this.hardLinkCounts.delete(inodeId);
        else this.hardLinkCounts.set(inodeId, count - 1);
        this.metadata.delete(candidate);
        this.removeChild(candidate);
      }
    }
    for (const candidate of [...this.symbolicLinks.keys()]) {
      if (candidate.startsWith(prefix)) {
        this.usedBytesValue -= this.allocatedDataBytes(
          utf8Size(this.symbolicLinks.get(candidate)!),
        );
        this.symbolicLinks.delete(candidate);
        this.metadata.delete(candidate);
        this.removeChild(candidate);
      }
    }
    const removedDirectories = [...this.directories]
      .filter(
        (candidate) => candidate === normalized || candidate.startsWith(prefix),
      )
      .sort((left, right) => right.length - left.length);
    for (const candidate of removedDirectories) {
      this.removeChild(candidate);
      this.usedBytesValue -= this.directoryAllocatedBytes(candidate);
      this.children.delete(candidate);
      this.directories.delete(candidate);
      this.metadata.delete(candidate);
    }
    this.revisionValue += 1;
  }

  copy(from: string, to: string): void {
    this.assertTransactionMutationAllowed();
    if (activeFilesystemTransactions.at(-1)?.owner !== this) {
      this.transaction(() => this.copy(from, to));
      return;
    }
    const source = this.normalize(from);
    const destination = this.normalize(to);
    const snapshot = this.subtreeSnapshot(source, from);
    this.validateTransfer(source, destination, snapshot, false);
    this.commitSnapshot(source, destination, snapshot);
  }

  move(from: string, to: string): void {
    this.assertTransactionMutationAllowed();
    const source = this.normalize(from);
    const destination = this.normalize(to);
    if (source === "/")
      throw new FilesystemError("protected", "Cannot move root");
    const snapshot = this.subtreeSnapshot(source, from);
    this.validateTransfer(source, destination, snapshot, true);
    this.commitMove(source, destination, snapshot);
  }

  getSize(path: string): number {
    const normalized = this.resolveSymbolicLinks(path);
    const blobId = this.files.get(normalized);
    if (blobId !== undefined) return blobLogicalSize(blobId);
    if (this.directories.has(normalized)) return 0;
    throw new FilesystemError("not_found", `${path} does not exist`);
  }

  getFreeSpace(): number {
    return Math.max(0, this.limits.capacityBytes - this.usedBytesValue);
  }

  getMetadata(path: string, followLinks = true): FilesystemMetadata {
    const normalized = followLinks
      ? this.resolveSymbolicLinks(path)
      : this.normalize(path);
    const value = this.metadata.get(normalized);
    if (value === undefined)
      throw new FilesystemError("not_found", `${path} does not exist`);
    return { ...value };
  }

  setMetadata(
    path: string,
    update: Partial<Pick<FilesystemMetadata, "gid" | "mode" | "uid">>,
    followLinks = true,
  ): void {
    this.assertTransactionMutationAllowed();
    const normalized = followLinks
      ? this.resolveSymbolicLinks(path)
      : this.normalize(path);
    const current = this.getMetadata(normalized, false);
    const next = {
      ...current,
      ...update,
      mode: update.mode === undefined ? current.mode : update.mode & 0o7777,
    };
    if (JSON.stringify(current) === JSON.stringify(next)) return;
    const id = this.hardLinkIds.get(normalized);
    const paths =
      id === undefined
        ? [normalized]
        : [...this.hardLinkIds]
            .filter(([, candidate]) => candidate === id)
            .map(([candidate]) => candidate);
    for (const candidate of paths) this.metadata.set(candidate, { ...next });
    this.revisionValue += 1;
  }

  setModifiedTime(
    path: string,
    milliseconds: number,
    followLinks = true,
  ): void {
    this.assertTransactionMutationAllowed();
    if (!Number.isFinite(milliseconds))
      throw new FilesystemError("invalid_path", "Invalid modification time");
    const normalized = followLinks
      ? this.resolveSymbolicLinks(path)
      : this.normalize(path);
    const current = this.getMetadata(normalized, false);
    if (current.modifiedAtMilliseconds === milliseconds) return;
    const id = this.hardLinkIds.get(normalized);
    const paths =
      id === undefined
        ? [normalized]
        : [...this.hardLinkIds]
            .filter(([, candidate]) => candidate === id)
            .map(([candidate]) => candidate);
    for (const candidate of paths) {
      this.metadata.set(candidate, {
        ...this.getMetadata(candidate, false),
        modifiedAtMilliseconds: milliseconds,
      });
    }
    this.revisionValue += 1;
  }

  snapshot(): InMemoryFilesystemSnapshot {
    const base =
      this.baseImage === undefined ? undefined : baseImageState(this.baseImage);
    const directories = [...this.directories]
      .filter((path) => path !== "/" && !base?.directories.has(path))
      .sort();
    const files = [...this.files]
      .filter(([path, blobId]) => base?.files.get(path) !== blobId)
      .sort(([left], [right]) => left.localeCompare(right));
    const blobIds = new Set(files.map(([, blobId]) => blobId));
    const tombstones =
      base === undefined
        ? []
        : [...base.paths]
            .filter((path) => !this.hasCompatibleBaseEntry(path, base))
            .sort(
              (left, right) =>
                right.length - left.length || left.localeCompare(right),
            );
    return {
      schema: 2,
      baseImageId: this.baseImage?.id,
      blobs: [...blobIds].sort().map((id) => [id, requireBlob(id)] as const),
      directories,
      files,
      metadata: [...this.metadata]
        .filter(
          ([path, metadata]) =>
            path !== "/" &&
            (!metadataEquals(base?.metadata.get(path), metadata) ||
              (base?.paths.has(path) === true &&
                !this.hasCompatibleBaseEntry(path, base))),
        )
        .sort(([left], [right]) => left.localeCompare(right)),
      symbolicLinks: [...this.symbolicLinks]
        .filter(([path, target]) => base?.symbolicLinks.get(path) !== target)
        .sort(([left], [right]) => left.localeCompare(right)),
      hardLinks: hardLinkGroups(this.hardLinkIds),
      tombstones,
    };
  }

  restore(snapshot: InMemoryFilesystemSnapshot): void {
    this.assertTransactionMutationAllowed();
    if (activeFilesystemTransactions.length > 0) {
      throw new FilesystemError(
        "transaction_scope",
        "Filesystem restore cannot run inside a transaction",
      );
    }
    if (snapshot.schema !== 2) {
      throw new Error("Unsupported filesystem snapshot schema");
    }
    const restored = new InMemoryFilesystem(this.limits);
    if (snapshot.baseImageId !== undefined) {
      const image = baseImages.get(snapshot.baseImageId);
      if (image === undefined) {
        throw new Error(
          `Unknown filesystem base image ${snapshot.baseImageId}`,
        );
      }
      restored.attachBaseImage(image);
    }
    for (const path of snapshot.tombstones ?? []) {
      if (restored.exists(path)) restored.delete(path);
    }
    for (const directory of [...snapshot.directories].sort(
      (left, right) => left.length - right.length || left.localeCompare(right),
    )) {
      restored.makeDirectory(directory);
    }
    const intendedFiles = new Map(restored.files);
    for (const [path, blobId] of snapshot.files)
      intendedFiles.set(path, blobId);
    const intendedNonFiles = new Set<string>([
      ...restored.directories,
      ...restored.symbolicLinks.keys(),
      ...snapshot.directories,
      ...(snapshot.symbolicLinks ?? []).map(([path]) => path),
    ]);
    const seenHardLinkPaths = new Set<string>();
    for (const paths of snapshot.hardLinks ?? []) {
      if (paths.length < 2) {
        throw new Error(
          "Invalid filesystem hard-link group: at least two paths are required",
        );
      }
      let expectedBlobId: string | undefined;
      for (const path of paths) {
        if (seenHardLinkPaths.has(path)) {
          throw new Error(
            `Invalid filesystem hard-link group: ${path} appears more than once`,
          );
        }
        seenHardLinkPaths.add(path);
        const blobId = intendedNonFiles.has(path)
          ? undefined
          : intendedFiles.get(path);
        if (blobId === undefined) {
          throw new Error(
            `Invalid filesystem hard-link group: ${path} is not a regular file`,
          );
        }
        expectedBlobId ??= blobId;
        if (blobId !== expectedBlobId) {
          throw new Error(
            `Invalid filesystem hard-link group: ${paths.join(", ")} do not share one blob`,
          );
        }
      }
    }
    for (const [id, contents] of snapshot.blobs) registerBlob(id, contents);
    const hardLinkPeers = new Map<string, readonly string[]>();
    for (const paths of snapshot.hardLinks ?? []) {
      for (const path of paths) hardLinkPeers.set(path, paths);
    }
    for (const [path, blobId] of snapshot.files) {
      if (!restored.exists(path)) {
        const peer = hardLinkPeers
          .get(path)
          ?.find((candidate) => restored.files.has(candidate));
        if (peer !== undefined) restored.createHardLink(peer, path);
      }
      restored.commitStoredFile(path, blobId, blobLogicalSize(blobId));
    }
    for (const paths of snapshot.hardLinks ?? []) {
      if (paths.length < 2) continue;
      const id = nextHardLinkId++;
      let count = 0;
      for (const path of paths) {
        if (restored.files.has(path)) {
          restored.hardLinkIds.set(path, id);
          count += 1;
        }
      }
      if (count > 1) restored.hardLinkCounts.set(id, count);
    }
    restored.rebuildHardLinkCounts();
    restored.rebuildUsedBytes();
    for (const [path, target] of snapshot.symbolicLinks ?? []) {
      // Schema 1 and all previously written schema-2 snapshots allowed link
      // targets beyond current creation limits and did not reserve their disk
      // bytes or entry slots. Restore them exactly, account their bytes, and
      // retain any resulting capacity debt; only new guest creation is bounded.
      restored.commitSymbolicLink(target, path, false);
    }
    for (const [path, metadata] of snapshot.metadata ?? []) {
      if (restored.exists(path)) restored.metadata.set(path, { ...metadata });
    }
    this.files.clear();
    this.directories.clear();
    this.children.clear();
    this.metadata.clear();
    this.symbolicLinks.clear();
    this.hardLinkIds.clear();
    this.hardLinkCounts.clear();
    for (const directory of restored.directories)
      this.directories.add(directory);
    for (const [path, blobId] of restored.files) this.files.set(path, blobId);
    for (const [path, metadata] of restored.metadata)
      this.metadata.set(path, { ...metadata });
    for (const [path, target] of restored.symbolicLinks)
      this.symbolicLinks.set(path, target);
    for (const [path, id] of restored.hardLinkIds)
      this.hardLinkIds.set(path, id);
    for (const [id, count] of restored.hardLinkCounts)
      this.hardLinkCounts.set(id, count);
    for (const [path, names] of restored.children)
      this.children.set(path, new Set(names));
    this.usedBytesValue = restored.usedBytesValue;
    this.baseImage = restored.baseImage;
    this.revisionValue += 1;
  }

  normalize(path: string): string {
    if (path.includes("\0"))
      throw new FilesystemError("invalid_path", "Path contains NUL");
    const source = path.replaceAll("\\", "/");
    const segments: string[] = [];
    for (const segment of source.split("/")) {
      if (segment.length === 0 || segment === ".") continue;
      if (segment === "..") {
        if (segments.length === 0)
          throw new FilesystemError("invalid_path", "Path escapes root");
        segments.pop();
      } else segments.push(segment);
    }
    const normalized = `/${segments.join("/")}`;
    if (normalized.length > this.limits.maxPathLength) {
      throw new FilesystemError("path_limit", "Path is too long");
    }
    return normalized;
  }

  private requireDirectory(path: string): string {
    const normalized = this.resolveSymbolicLinks(path);
    if (!this.directories.has(normalized)) {
      throw new FilesystemError("not_directory", `${path} is not a directory`);
    }
    return normalized;
  }

  private requireParent(path: string): void {
    const parent = path.slice(0, path.lastIndexOf("/")) || "/";
    if (!this.directories.has(parent)) {
      throw new FilesystemError(
        "not_found",
        `Parent directory ${parent} does not exist`,
      );
    }
  }

  private commitFile(path: string, contents: string): void {
    const size = utf8Size(contents);
    if (size > this.limits.maxFileBytes)
      throw new FilesystemError("file_limit", "File is too large");
    const blobId = internBlob(contents);
    this.commitStoredFile(path, blobId, size);
  }

  private commitStoredFile(path: string, blobId: string, size: number): void {
    if (size > this.limits.maxFileBytes)
      throw new FilesystemError("file_limit", "File is too large");
    const previous = this.files.get(path);
    if (previous === blobId) return;
    const previousSize =
      previous === undefined
        ? 0
        : this.allocatedDataBytes(blobLogicalSize(previous));
    const linkId = this.hardLinkIds.get(path);
    const linkedPaths =
      linkId === undefined
        ? [path]
        : [...this.hardLinkIds]
            .filter(([, candidate]) => candidate === linkId)
            .map(([candidate]) => candidate);
    const delta = this.allocatedDataBytes(size) - previousSize;
    const directoryGrowth =
      previous === undefined ? this.parentDirectoryGrowth(path) : 0;
    this.assertCapacity(delta + directoryGrowth);
    if (!this.files.has(path)) {
      this.checkEntryCount(1);
      const inodeId = nextHardLinkId++;
      this.hardLinkIds.set(path, inodeId);
      this.hardLinkCounts.set(inodeId, 1);
    }
    for (const linkedPath of linkedPaths) {
      this.files.set(linkedPath, blobId);
      this.metadata.set(linkedPath, {
        ...(this.metadata.get(linkedPath) ?? defaultMetadata(false)),
        modifiedAtMilliseconds: Date.now(),
      });
    }
    if (previous === undefined) this.addChild(path);
    this.usedBytesValue += delta;
    this.revisionValue += 1;
  }

  private subtreeSnapshot(path: string, original: string): FilesystemSnapshot {
    const file = this.files.get(path);
    if (file !== undefined)
      return {
        directories: [],
        files: [[path, file, requireBlob(file)]],
        hardLinkIds: this.hardLinkIds.has(path)
          ? [[path, this.hardLinkIds.get(path)!]]
          : [],
        metadata: [[path, this.getMetadata(path, false)]],
        symbolicLinks: [],
      };
    const link = this.symbolicLinks.get(path);
    if (link !== undefined)
      return {
        directories: [],
        files: [],
        hardLinkIds: [],
        metadata: [[path, this.getMetadata(path, false)]],
        symbolicLinks: [[path, link]],
      };
    if (!this.directories.has(path)) {
      throw new FilesystemError("not_found", `${original} does not exist`);
    }
    const prefix = path === "/" ? "/" : `${path}/`;
    const directories = [...this.directories].filter(
      (candidate) => candidate === path || candidate.startsWith(prefix),
    );
    const files = [...this.files]
      .filter(([candidate]) => candidate.startsWith(prefix))
      .map(
        ([candidate, blobId]) =>
          [candidate, blobId, requireBlob(blobId)] as const,
      );
    const symbolicLinks = [...this.symbolicLinks].filter(([candidate]) =>
      candidate.startsWith(prefix),
    );
    return {
      directories,
      files,
      hardLinkIds: [...this.hardLinkIds].filter(([candidate]) =>
        candidate.startsWith(prefix),
      ),
      symbolicLinks,
      metadata: [
        ...directories,
        ...files.map(([candidate]) => candidate),
        ...symbolicLinks.map(([candidate]) => candidate),
      ].map(
        (candidate) => [candidate, this.getMetadata(candidate, false)] as const,
      ),
    };
  }

  private validateTransfer(
    source: string,
    destination: string,
    snapshot: FilesystemSnapshot,
    moving: boolean,
  ): void {
    if (destination === "/" || this.exists(destination)) {
      throw new FilesystemError("exists", `${destination} already exists`);
    }
    if (destination.startsWith(`${source}/`)) {
      throw new FilesystemError(
        "invalid_path",
        "Destination cannot be inside source",
      );
    }
    this.requireParent(destination);
    const mapped = [
      ...snapshot.directories.map((path) =>
        this.transferPath(source, destination, path),
      ),
      ...snapshot.files.map(([path]) =>
        this.transferPath(source, destination, path),
      ),
      ...snapshot.symbolicLinks.map(([path]) =>
        this.transferPath(source, destination, path),
      ),
    ];
    for (const path of mapped) {
      if (this.normalize(path) !== path || this.exists(path)) {
        throw new FilesystemError("exists", `${path} already exists`);
      }
    }
    if (!moving) {
      this.checkEntryCount(mapped.length);
      const inodeIds = new Map(snapshot.hardLinkIds);
      const copiedInodes = new Set<number>();
      const addedBytes =
        snapshot.files.reduce((total, [path, blobId]) => {
          const inodeId = inodeIds.get(path);
          if (inodeId !== undefined) {
            if (copiedInodes.has(inodeId)) return total;
            copiedInodes.add(inodeId);
          }
          return total + this.allocatedDataBytes(blobLogicalSize(blobId));
        }, 0) +
        snapshot.symbolicLinks.reduce(
          (total, [, target]) =>
            total + this.allocatedDataBytes(utf8Size(target)),
          0,
        );
      if (this.usedBytesValue + addedBytes > this.limits.capacityBytes) {
        throw new FilesystemError("capacity", "Filesystem capacity exceeded");
      }
    }
  }

  private commitSnapshot(
    source: string,
    destination: string,
    snapshot: FilesystemSnapshot,
  ): void {
    for (const path of [...snapshot.directories].sort(
      (left, right) => left.length - right.length,
    ))
      this.makeDirectory(this.transferPath(source, destination, path));
    const inodeIds = new Map(snapshot.hardLinkIds);
    const copiedInodes = new Map<number, string>();
    for (const [path, blobId] of snapshot.files) {
      const destinationPath = this.transferPath(source, destination, path);
      const inodeId = inodeIds.get(path);
      const copiedPeer =
        inodeId === undefined ? undefined : copiedInodes.get(inodeId);
      if (copiedPeer === undefined) {
        this.commitStoredFile(destinationPath, blobId, blobLogicalSize(blobId));
        if (inodeId !== undefined) copiedInodes.set(inodeId, destinationPath);
      } else {
        this.createHardLink(copiedPeer, destinationPath);
      }
    }
    for (const [path, target] of snapshot.symbolicLinks) {
      this.createSymbolicLink(
        target,
        this.transferPath(source, destination, path),
      );
    }
    for (const [path, metadata] of snapshot.metadata) {
      const destinationPath = this.transferPath(source, destination, path);
      if (this.exists(destinationPath))
        this.metadata.set(destinationPath, { ...metadata });
    }
    this.rebuildHardLinkCounts();
  }

  /**
   * Renames a validated subtree without unlinking and recreating its inodes.
   *
   * In particular, a moved file may share an inode with another path either
   * inside or outside the subtree. Replaying the move through delete/write
   * would temporarily release or duplicate that inode's bytes and could fail
   * after deleting the source on a full filesystem. Capture every value that
   * can fail validation first, then replace only path keys. The inode IDs,
   * link counts, content blobs, and used-byte total therefore stay unchanged.
   */
  private commitMove(
    source: string,
    destination: string,
    snapshot: FilesystemSnapshot,
  ): void {
    const sourceSiblings = this.children.get(parentPath(source));
    const destinationSiblings = this.children.get(parentPath(destination));
    if (sourceSiblings === undefined || destinationSiblings === undefined) {
      throw new Error("Filesystem child index is missing for move");
    }
    const directoryDelta = this.directoryMoveDelta(source, destination);
    this.assertCapacity(directoryDelta);

    const directories = snapshot.directories.map((path) => {
      const children = this.children.get(path);
      if (!this.directories.has(path) || children === undefined) {
        throw new Error(`Filesystem directory is missing for ${path}`);
      }
      return {
        children,
        destination: this.transferPath(source, destination, path),
        source: path,
      };
    });
    const files = snapshot.files.map(([path]) => {
      const blobId = this.files.get(path);
      const inodeId = this.hardLinkIds.get(path);
      if (blobId === undefined || inodeId === undefined) {
        throw new Error(`Filesystem inode is missing for ${path}`);
      }
      return {
        blobId,
        destination: this.transferPath(source, destination, path),
        inodeId,
        source: path,
      };
    });
    const symbolicLinks = snapshot.symbolicLinks.map(([path, target]) => ({
      destination: this.transferPath(source, destination, path),
      source: path,
      target,
    }));
    const metadata = snapshot.metadata.map(([path, value]) => ({
      destination: this.transferPath(source, destination, path),
      source: path,
      value,
    }));

    // No validation or capacity-changing operation occurs beyond this point.
    for (const entry of directories) {
      this.directories.delete(entry.source);
      this.children.delete(entry.source);
    }
    for (const entry of files) {
      this.files.delete(entry.source);
      this.hardLinkIds.delete(entry.source);
    }
    for (const entry of symbolicLinks) this.symbolicLinks.delete(entry.source);
    for (const entry of metadata) this.metadata.delete(entry.source);

    for (const entry of directories) {
      this.directories.add(entry.destination);
      this.children.set(entry.destination, entry.children);
    }
    for (const entry of files) {
      this.files.set(entry.destination, entry.blobId);
      this.hardLinkIds.set(entry.destination, entry.inodeId);
    }
    for (const entry of symbolicLinks)
      this.symbolicLinks.set(entry.destination, entry.target);
    for (const entry of metadata)
      this.metadata.set(entry.destination, { ...entry.value });

    sourceSiblings.delete(baseName(source));
    destinationSiblings.add(baseName(destination));
    this.usedBytesValue += directoryDelta;
    this.revisionValue += 1;
  }

  private rebuildHardLinkCounts(): void {
    this.hardLinkCounts.clear();
    for (const id of this.hardLinkIds.values()) {
      this.hardLinkCounts.set(id, (this.hardLinkCounts.get(id) ?? 0) + 1);
    }
    for (const [id, count] of [...this.hardLinkCounts]) {
      if (count < 2) this.hardLinkCounts.delete(id);
    }
  }

  private rebuildUsedBytes(): void {
    const seen = new Set<number>();
    let usedBytes = this.reservedBytes;
    for (const [path, blobId] of this.files) {
      const inodeId = this.requireInodeId(path);
      if (seen.has(inodeId)) continue;
      seen.add(inodeId);
      usedBytes += this.allocatedDataBytes(blobLogicalSize(blobId));
    }
    for (const target of this.symbolicLinks.values()) {
      usedBytes += this.allocatedDataBytes(utf8Size(target));
    }
    for (const directory of this.directories) {
      usedBytes += this.directoryAllocatedBytes(directory);
    }
    this.usedBytesValue = usedBytes;
  }

  private requireInodeId(path: string): number {
    const id = this.hardLinkIds.get(path);
    if (id === undefined) {
      throw new Error(`Filesystem inode is missing for ${path}`);
    }
    return id;
  }

  private transferPath(
    source: string,
    destination: string,
    path: string,
  ): string {
    if (path === source) return destination;
    if (source === "/") return `${destination}${path}`;
    return `${destination}${path.slice(source.length)}`;
  }

  private checkEntryCount(additions: number): void {
    if (
      additions > 0 &&
      this.files.size +
        this.symbolicLinks.size +
        this.directories.size -
        1 +
        additions >
        this.limits.maxEntries
    ) {
      throw new FilesystemError(
        "entry_limit",
        "Filesystem entry limit exceeded",
      );
    }
  }

  private hasCompatibleBaseEntry(
    path: string,
    base: FilesystemBaseImageState,
  ): boolean {
    if (base.files.has(path)) {
      return (
        this.files.has(path) &&
        !this.directories.has(path) &&
        !this.symbolicLinks.has(path)
      );
    }
    if (base.directories.has(path)) {
      return (
        this.directories.has(path) &&
        !this.files.has(path) &&
        !this.symbolicLinks.has(path)
      );
    }
    if (base.symbolicLinks.has(path)) {
      return (
        this.symbolicLinks.has(path) &&
        !this.files.has(path) &&
        !this.directories.has(path)
      );
    }
    return false;
  }

  private isUnmodifiedBaseFile(
    path: string,
    base: FilesystemBaseImageState,
  ): boolean {
    const baseBlob = base.files.get(path);
    const inodeId = this.hardLinkIds.get(path);
    return (
      baseBlob !== undefined &&
      this.files.get(path) === baseBlob &&
      metadataEquals(base.metadata.get(path), this.metadata.get(path)!) &&
      inodeId !== undefined &&
      (this.hardLinkCounts.get(inodeId) ?? 1) === 1
    );
  }

  private addChild(path: string): void {
    const parent = parentPath(path);
    const siblings = this.children.get(parent);
    if (siblings === undefined) {
      throw new FilesystemError(
        "not_found",
        `Parent directory ${parent} does not exist`,
      );
    }
    const growth = this.parentDirectoryGrowth(path);
    this.assertCapacity(growth);
    siblings.add(baseName(path));
    this.usedBytesValue += growth;
  }

  private removeChild(path: string): void {
    if (path === "/") return;
    const parent = parentPath(path);
    const siblings = this.children.get(parent);
    if (siblings === undefined || !siblings.has(baseName(path))) return;
    const before = this.directoryAllocatedBytes(parent, siblings.size);
    siblings.delete(baseName(path));
    const after = this.directoryAllocatedBytes(parent, siblings.size);
    this.usedBytesValue -= before - after;
  }

  private get allocationUnitBytes(): number {
    return this.limits.allocationUnitBytes ?? 1;
  }

  private get directoryEntryBytes(): number {
    return this.limits.directoryEntryBytes ?? 0;
  }

  private get reservedBytes(): number {
    return this.limits.reservedBytes ?? 0;
  }

  private allocatedDataBytes(logicalBytes: number): number {
    if (logicalBytes === 0) return 0;
    return (
      Math.ceil(logicalBytes / this.allocationUnitBytes) *
      this.allocationUnitBytes
    );
  }

  private directoryAllocatedBytes(
    path: string,
    childCount = this.children.get(path)?.size ?? 0,
  ): number {
    if (path === "/" || this.directoryEntryBytes === 0) return 0;
    return this.allocatedDataBytes((childCount + 2) * this.directoryEntryBytes);
  }

  private parentDirectoryGrowth(path: string): number {
    const parent = parentPath(path);
    const siblings = this.children.get(parent);
    if (siblings === undefined) {
      throw new FilesystemError(
        "not_found",
        `Parent directory ${parent} does not exist`,
      );
    }
    const name = baseName(path);
    if (siblings.has(name)) return 0;
    const rootLimit = this.limits.rootDirectoryEntries;
    if (
      parent === "/" &&
      rootLimit !== undefined &&
      siblings.size >= rootLimit
    ) {
      throw new FilesystemError(
        "entry_limit",
        "FAT root-directory entry limit exceeded",
      );
    }
    return (
      this.directoryAllocatedBytes(parent, siblings.size + 1) -
      this.directoryAllocatedBytes(parent, siblings.size)
    );
  }

  private directoryMoveDelta(source: string, destination: string): number {
    const sourceParent = parentPath(source);
    const destinationParent = parentPath(destination);
    if (sourceParent === destinationParent) return 0;
    const sourceSiblings = this.children.get(sourceParent);
    const destinationSiblings = this.children.get(destinationParent);
    if (sourceSiblings === undefined || destinationSiblings === undefined) {
      throw new Error("Filesystem child index is missing for move");
    }
    const rootLimit = this.limits.rootDirectoryEntries;
    if (
      destinationParent === "/" &&
      rootLimit !== undefined &&
      destinationSiblings.size >= rootLimit
    ) {
      throw new FilesystemError(
        "entry_limit",
        "FAT root-directory entry limit exceeded",
      );
    }
    return (
      this.directoryAllocatedBytes(sourceParent, sourceSiblings.size - 1) -
      this.directoryAllocatedBytes(sourceParent, sourceSiblings.size) +
      this.directoryAllocatedBytes(
        destinationParent,
        destinationSiblings.size + 1,
      ) -
      this.directoryAllocatedBytes(destinationParent, destinationSiblings.size)
    );
  }

  private assertCapacity(delta: number): void {
    if (delta > 0 && this.usedBytesValue + delta > this.limits.capacityBytes) {
      throw new FilesystemError("capacity", "Filesystem capacity exceeded");
    }
  }

  private assertTransactionMutationAllowed(): void {
    if (rejectedAsyncTransactionCount() > 0) {
      throw new FilesystemError(
        "transaction_async",
        "Cannot mutate a filesystem while a rejected asynchronous transaction is pending",
      );
    }
    const active = activeFilesystemTransactions.at(-1);
    if (active !== undefined && active.owner !== this) {
      throw new FilesystemError(
        "transaction_scope",
        "Cannot mutate another filesystem inside an active transaction",
      );
    }
  }

  private rejectThenableTransaction(value: PromiseLike<unknown>): never {
    quarantineRejectedAsyncTransaction(value);
    throw new FilesystemError(
      "transaction_async",
      "Filesystem transactions require a synchronous callback",
    );
  }
}

export class FilesystemError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "FilesystemError";
  }
}

interface FilesystemSnapshot {
  readonly directories: readonly string[];
  readonly files: readonly (readonly [
    path: string,
    blobId: string,
    storedContents: string,
  ])[];
  readonly hardLinkIds: readonly (readonly [string, number])[];
  readonly metadata: readonly (readonly [string, FilesystemMetadata])[];
  readonly symbolicLinks: readonly (readonly [string, string])[];
}

let nextHardLinkId = 1;

function hardLinkGroups(
  links: ReadonlyMap<string, number>,
): readonly (readonly string[])[] {
  const groups = new Map<number, string[]>();
  for (const [path, id] of links) {
    const paths = groups.get(id) ?? [];
    paths.push(path);
    groups.set(id, paths);
  }
  return [...groups.values()]
    .filter((paths) => paths.length > 1)
    .map((paths) => paths.sort())
    .sort(([left = ""], [right = ""]) => left.localeCompare(right));
}

function defaultMetadata(
  directory: boolean,
  mode = directory ? 0o755 : 0o644,
): FilesystemMetadata {
  return {
    gid: 1_000,
    mode,
    modifiedAtMilliseconds: Date.now(),
    uid: 1_000,
  };
}

function ancestors(path: string): string[] {
  const result: string[] = [];
  let current = "";
  for (const segment of path.split("/").filter(Boolean)) {
    current += `/${segment}`;
    result.push(current);
  }
  return result;
}

function parentPath(path: string): string {
  return path.slice(0, path.lastIndexOf("/")) || "/";
}

function baseName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

interface FilesystemBaseImageState {
  readonly directories: ReadonlySet<string>;
  readonly files: ReadonlyMap<string, string>;
  readonly metadata: ReadonlyMap<string, FilesystemMetadata>;
  readonly paths: ReadonlySet<string>;
  readonly sizes: ReadonlyMap<string, number>;
  readonly symbolicLinks: ReadonlyMap<string, string>;
}

const baseImageStates = new Map<string, FilesystemBaseImageState>();
interface BaseImageFileFacts {
  readonly blobId: string;
  readonly contents: string;
  readonly size: number;
}

const baseImageFileFactsCache = new WeakMap<
  FilesystemBaseImageFile,
  BaseImageFileFacts
>();

function baseImageFileFacts(file: FilesystemBaseImageFile): BaseImageFileFacts {
  const cached = baseImageFileFactsCache.get(file);
  if (cached !== undefined && cached.contents === file.contents) return cached;
  const blobId = contentBlobId(file.contents);
  const facts = {
    blobId,
    contents: file.contents,
    size: encodedBlobSize(blobId),
  };
  baseImageFileFactsCache.set(file, facts);
  return facts;
}

function baseImageState(image: FilesystemBaseImage): FilesystemBaseImageState {
  const cached = baseImageStates.get(image.id);
  if (cached !== undefined) return cached;
  const directories = new Set(image.directories.map(normalizedImagePath));
  const files = new Map<string, string>();
  const sizes = new Map<string, number>();
  const metadata = new Map<string, FilesystemMetadata>();
  for (const directory of directories) {
    metadata.set(directory, {
      ...defaultMetadata(true),
      modifiedAtMilliseconds: 0,
    });
  }
  for (const file of image.files) {
    const path = normalizedImagePath(file.path);
    const facts = baseImageFileFacts(file);
    registerBlob(facts.blobId, file.contents, true);
    files.set(path, facts.blobId);
    sizes.set(path, facts.size);
    metadata.set(path, {
      ...defaultMetadata(false),
      ...file.metadata,
    });
  }
  const state: FilesystemBaseImageState = {
    directories,
    files,
    metadata,
    paths: new Set([...directories, ...files.keys()]),
    sizes,
    symbolicLinks: new Map(),
  };
  baseImageStates.set(image.id, state);
  for (const transaction of activeFilesystemTransactions)
    transaction.createdBaseImageStateIds.add(image.id);
  return state;
}

function normalizedImagePath(path: string): string {
  if (!path.startsWith("/") || path.includes("\0") || path.includes("//")) {
    throw new Error(`Invalid filesystem image path ${path}`);
  }
  return path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
}

function metadataEquals(
  left: FilesystemMetadata | undefined,
  right: FilesystemMetadata,
): boolean {
  return (
    left !== undefined &&
    left.gid === right.gid &&
    left.mode === right.mode &&
    left.modifiedAtMilliseconds === right.modifiedAtMilliseconds &&
    left.uid === right.uid
  );
}

function internBlob(contents: string): string {
  const id = contentBlobId(contents);
  registerBlob(id, contents, true);
  return id;
}

function registerBlob(
  id: string,
  contents: string,
  alreadyValidated = false,
): void {
  if (!alreadyValidated && storedBlobId(contents, id) !== id) {
    throw new Error(`Filesystem blob ${id} failed content-address validation`);
  }
  const existing = contentBlobs.get(id);
  if (existing !== undefined && existing !== contents) {
    throw new Error(`Filesystem blob collision for ${id}`);
  }
  contentBlobs.set(id, contents);
  if (existing === undefined) {
    for (const transaction of activeFilesystemTransactions)
      transaction.createdBlobIds.add(id);
  }
}

function internBinaryBlob(contents: Uint8Array): string {
  const id = binaryBlobId(contents);
  registerBlob(id, encodeBase64Bytes(contents), true);
  return id;
}

function storedBlobId(contents: string, expectedId: string): string {
  return isBinaryBlobId(expectedId)
    ? binaryBlobId(decodeBase64Bytes(contents))
    : contentBlobId(contents);
}

function isBinaryBlobId(id: string): boolean {
  return /^x[0-9a-z]+-[0-9a-z]+-[0-9a-z]+$/u.test(id);
}

function blobLogicalSize(id: string): number {
  return encodedBlobSize(id);
}

function encodedBlobSize(id: string): number {
  const separator = id.indexOf("-");
  const size = Number.parseInt(id.slice(1, separator), 36);
  if (!Number.isSafeInteger(size) || size < 0) {
    throw new Error(`Invalid binary filesystem blob ${id}`);
  }
  return size;
}

function binaryBlobId(contents: Uint8Array): string {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < contents.length; index += 1) {
    const value = contents[index]!;
    first = Math.imul(first ^ value, 0x01000193) >>> 0;
    second = Math.imul(second ^ (value + index), 0x85ebca6b) >>> 0;
  }
  return `x${contents.length.toString(36)}-${first.toString(36)}-${second.toString(36)}`;
}

const base64Alphabet =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function encodeBase64Bytes(bytes: Uint8Array): string {
  let output = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index]!;
    const second = bytes[index + 1];
    const third = bytes[index + 2];
    const value = (first << 16) | ((second ?? 0) << 8) | (third ?? 0);
    output += base64Alphabet[(value >>> 18) & 63]!;
    output += base64Alphabet[(value >>> 12) & 63]!;
    output += second === undefined ? "=" : base64Alphabet[(value >>> 6) & 63]!;
    output += third === undefined ? "=" : base64Alphabet[value & 63]!;
  }
  return output;
}

function decodeBase64Bytes(source: string): Uint8Array {
  if (
    source.length % 4 !== 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(
      source,
    )
  ) {
    throw new Error("Invalid binary filesystem blob encoding");
  }
  const output: number[] = [];
  for (let index = 0; index < source.length; index += 4) {
    const values = [0, 1, 2, 3].map((offset) => {
      const character = source[index + offset]!;
      return character === "=" ? 0 : base64Alphabet.indexOf(character);
    });
    const value =
      (values[0]! << 18) | (values[1]! << 12) | (values[2]! << 6) | values[3]!;
    output.push((value >>> 16) & 0xff);
    if (source[index + 2] !== "=") output.push((value >>> 8) & 0xff);
    if (source[index + 3] !== "=") output.push(value & 0xff);
  }
  return Uint8Array.from(output);
}

function requireBlob(id: string): string {
  const contents = contentBlobs.get(id);
  if (contents === undefined) throw new Error(`Missing filesystem blob ${id}`);
  return contents;
}

function contentBlobId(contents: string): string {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  let size = 0;
  for (let index = 0; index < contents.length; index += 1) {
    const value = contents.charCodeAt(index);
    first = Math.imul(first ^ value, 0x01000193) >>> 0;
    second = Math.imul(second ^ (value + index), 0x85ebca6b) >>> 0;
    if (value <= 0x7f) size += 1;
    else if (value <= 0x7ff) size += 2;
    else if (
      value >= 0xd800 &&
      value <= 0xdbff &&
      index + 1 < contents.length &&
      contents.charCodeAt(index + 1) >= 0xdc00 &&
      contents.charCodeAt(index + 1) <= 0xdfff
    ) {
      size += 4;
    } else if (
      value >= 0xdc00 &&
      value <= 0xdfff &&
      index > 0 &&
      contents.charCodeAt(index - 1) >= 0xd800 &&
      contents.charCodeAt(index - 1) <= 0xdbff
    ) {
      // The paired high surrogate accounted for this code unit.
    } else size += 3;
  }
  return `b${size.toString(36)}-${first.toString(36)}-${second.toString(36)}`;
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

function hasOnlyKeys(
  value: Readonly<Record<string, unknown>>,
  allowedKeys: readonly string[],
): boolean {
  const allowed = new Set(allowedKeys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function isStringArray(value: unknown): value is readonly string[] {
  return (
    Array.isArray(value) && value.every((entry) => typeof entry === "string")
  );
}

function isStringTupleArray(
  value: unknown,
): value is readonly (readonly [string, string])[] {
  return (
    Array.isArray(value) &&
    value.every(
      (entry) =>
        Array.isArray(entry) &&
        entry.length === 2 &&
        typeof entry[0] === "string" &&
        typeof entry[1] === "string",
    )
  );
}

function isMetadataTupleArray(
  value: unknown,
): value is readonly (readonly [string, FilesystemMetadata])[] {
  return (
    Array.isArray(value) &&
    value.every(
      (entry) =>
        Array.isArray(entry) &&
        entry.length === 2 &&
        typeof entry[0] === "string" &&
        isFilesystemMetadata(entry[1]),
    )
  );
}

function isFilesystemMetadata(value: unknown): value is FilesystemMetadata {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ["gid", "mode", "modifiedAtMilliseconds", "uid"]) &&
    Number.isSafeInteger(value.gid) &&
    (value.gid as number) >= 0 &&
    Number.isSafeInteger(value.mode) &&
    (value.mode as number) >= 0 &&
    (value.mode as number) <= 0o7777 &&
    typeof value.modifiedAtMilliseconds === "number" &&
    Number.isFinite(value.modifiedAtMilliseconds) &&
    Number.isSafeInteger(value.uid) &&
    (value.uid as number) >= 0
  );
}

function isHardLinkGroups(
  value: unknown,
): value is readonly (readonly string[])[] {
  return (
    Array.isArray(value) &&
    value.every(
      (paths) =>
        Array.isArray(paths) &&
        paths.length >= 2 &&
        paths.every((path) => typeof path === "string"),
    )
  );
}

function areUniqueValidPaths(
  paths: readonly string[],
  allowRoot: boolean,
): boolean {
  const unique = new Set<string>();
  for (const path of paths) {
    if (!isValidSnapshotPath(path, allowRoot) || unique.has(path)) return false;
    unique.add(path);
  }
  return true;
}

function isValidSnapshotPath(path: string, allowRoot: boolean): boolean {
  if (path === "/") return allowRoot;
  return (
    path.length > 1 &&
    path.length <= defaultFilesystemLimits.maxPathLength &&
    path.startsWith("/") &&
    !path.endsWith("/") &&
    !path.includes("\0") &&
    !path.includes("\\") &&
    !path.includes("//") &&
    path
      .slice(1)
      .split("/")
      .every((segment) => segment !== "." && segment !== "..")
  );
}

function pathsAreDisjoint(...groups: readonly (readonly string[])[]): boolean {
  const paths = new Set<string>();
  for (const group of groups) {
    for (const path of group) {
      if (paths.has(path)) return false;
      paths.add(path);
    }
  }
  return true;
}

function allParentsExist(
  paths: ReadonlySet<string>,
  directories: readonly string[],
): boolean {
  const availableDirectories = new Set(directories);
  for (const path of paths) {
    const parent = parentPath(path);
    if (parent !== "/" && !availableDirectories.has(parent)) return false;
  }
  return true;
}

function hardLinkPathsAreUnique(
  groups: readonly (readonly string[])[],
): boolean {
  const paths = new Set<string>();
  for (const group of groups) {
    for (const path of group) {
      if (!isValidSnapshotPath(path, false) || paths.has(path)) return false;
      paths.add(path);
    }
  }
  return true;
}

function hardLinksAreValid(
  groups: readonly (readonly string[])[],
  files: ReadonlyMap<string, string>,
): boolean {
  if (!hardLinkPathsAreUnique(groups)) return false;
  for (const group of groups) {
    const expectedContents = files.get(group[0]!);
    if (
      expectedContents === undefined ||
      group.some((path) => files.get(path) !== expectedContents)
    ) {
      return false;
    }
  }
  return true;
}

function requireOptionalPositive(
  value: number | undefined,
  name: string,
): void {
  if (value !== undefined && (!Number.isSafeInteger(value) || value <= 0)) {
    throw new RangeError(`${name} must be positive`);
  }
}

function requireOptionalNonNegative(
  value: number | undefined,
  name: string,
): void {
  if (value !== undefined && (!Number.isSafeInteger(value) || value < 0)) {
    throw new RangeError(`${name} must be non-negative`);
  }
}
