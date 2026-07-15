export interface FilesystemLimits {
  readonly capacityBytes: number;
  readonly maxEntries: number;
  readonly maxFileBytes: number;
  readonly maxPathLength: number;
}

export const defaultFilesystemLimits: FilesystemLimits = {
  capacityBytes: 40 * 1_048_576,
  maxEntries: 4_096,
  maxFileBytes: 1_048_576,
  maxPathLength: 255,
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

export interface FilesystemBaseImageFile {
  readonly contents: string;
  readonly metadata?: Partial<Pick<FilesystemMetadata, "gid" | "mode" | "uid">>;
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

const baseImages = new Map<string, FilesystemBaseImage>();
const contentBlobs = new Map<string, string>();

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
  private usedBytesValue = 0;
  private baseImage: FilesystemBaseImage | undefined;

  constructor(readonly limits: FilesystemLimits = defaultFilesystemLimits) {
    for (const [name, value] of Object.entries(limits)) {
      if (!Number.isInteger(value) || value <= 0)
        throw new RangeError(`${name} must be positive`);
    }
    this.metadata.set("/", defaultMetadata(true));
  }

  get revision(): number {
    return this.revisionValue;
  }

  get baseImageId(): string | undefined {
    return this.baseImage?.id;
  }

  attachBaseImage(image: FilesystemBaseImage): void {
    if (this.baseImage?.id === image.id) return;
    registerFilesystemBaseImage(image);
    const imageState = baseImageState(image);
    for (const directory of [...image.directories].sort(
      (left, right) => left.length - right.length || left.localeCompare(right),
    )) {
      const path = this.normalize(directory);
      const existed = this.exists(path);
      this.makeDirectory(path);
      if (!existed) {
        this.metadata.set(path, {
          ...defaultMetadata(true),
          modifiedAtMilliseconds: 0,
        });
      }
    }
    for (const file of image.files) {
      const path = this.normalize(file.path);
      if (!this.exists(path)) {
        const size = imageState.sizes.get(path)!;
        if (size > this.limits.maxFileBytes)
          throw new FilesystemError("file_limit", "File is too large");
        if (this.usedBytesValue + size > this.limits.capacityBytes)
          throw new FilesystemError("capacity", "Filesystem capacity exceeded");
        this.requireParent(path);
        this.checkEntryCount(1);
        const inodeId = nextHardLinkId++;
        this.files.set(path, imageState.files.get(path)!);
        this.hardLinkIds.set(path, inodeId);
        this.hardLinkCounts.set(inodeId, 1);
        this.metadata.set(path, imageState.metadata.get(path)!);
        this.addChild(path);
        this.usedBytesValue += size;
        this.revisionValue += 1;
      }
    }
    this.baseImage = image;
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
    const normalized = this.normalize(path);
    if (this.exists(normalized))
      throw new FilesystemError("exists", `${path} already exists`);
    this.requireParent(normalized);
    this.checkEntryCount(1);
    if (target.includes("\0"))
      throw new FilesystemError("invalid_path", "Link target contains NUL");
    this.symbolicLinks.set(normalized, target.replaceAll("\\", "/"));
    this.metadata.set(normalized, defaultMetadata(false, 0o777));
    this.addChild(normalized);
    this.revisionValue += 1;
  }

  createHardLink(existing: string, path: string): void {
    const source = this.resolveSymbolicLinks(existing);
    if (!this.files.has(source))
      throw new FilesystemError("not_found", `${existing} is not a file`);
    const destination = this.normalize(path);
    if (this.exists(destination))
      throw new FilesystemError("exists", `${path} already exists`);
    this.requireParent(destination);
    this.checkEntryCount(1);
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
    const normalized = this.normalize(path);
    if (this.files.has(normalized))
      throw new FilesystemError("not_directory", `${path} is a file`);
    const additions = ancestors(normalized).filter(
      (candidate) => !this.directories.has(candidate),
    );
    const fileAncestor = additions.find((candidate) =>
      this.files.has(candidate),
    );
    if (fileAncestor !== undefined) {
      throw new FilesystemError("not_directory", `${fileAncestor} is a file`);
    }
    this.checkEntryCount(additions.length);
    for (const addition of additions) {
      this.directories.add(addition);
      this.children.set(addition, new Set());
      this.metadata.set(addition, defaultMetadata(true));
      this.addChild(addition);
    }
    if (additions.length > 0) this.revisionValue += 1;
  }

  readFile(path: string): string {
    const normalized = this.resolveSymbolicLinks(path);
    const blobId = this.files.get(normalized);
    if (blobId === undefined)
      throw new FilesystemError("not_found", `${path} is not a file`);
    return requireBlob(blobId);
  }

  writeFile(path: string, contents: string): void {
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

  appendFile(path: string, contents: string): void {
    const normalized = this.normalize(path);
    const current = this.exists(normalized) ? this.readFile(normalized) : "";
    this.writeFile(normalized, current + contents);
  }

  delete(path: string): void {
    const normalized = this.normalize(path);
    if (normalized === "/")
      throw new FilesystemError("protected", "Cannot delete root");
    if (!this.exists(normalized))
      throw new FilesystemError("not_found", `${path} does not exist`);
    if (this.symbolicLinks.has(normalized)) {
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
          this.usedBytesValue -= utf8Size(
            requireBlob(this.files.get(candidate)!),
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
      this.children.delete(candidate);
      this.directories.delete(candidate);
      this.metadata.delete(candidate);
    }
    this.revisionValue += 1;
  }

  copy(from: string, to: string): void {
    const source = this.normalize(from);
    const destination = this.normalize(to);
    const snapshot = this.subtreeSnapshot(source, from);
    this.validateTransfer(source, destination, snapshot, false);
    this.commitSnapshot(source, destination, snapshot, false);
  }

  move(from: string, to: string): void {
    const source = this.normalize(from);
    const destination = this.normalize(to);
    if (source === "/")
      throw new FilesystemError("protected", "Cannot move root");
    const snapshot = this.subtreeSnapshot(source, from);
    this.validateTransfer(source, destination, snapshot, true);
    this.delete(source);
    this.commitSnapshot(source, destination, snapshot, true);
  }

  getSize(path: string): number {
    const normalized = this.resolveSymbolicLinks(path);
    const blobId = this.files.get(normalized);
    if (blobId !== undefined) return utf8Size(requireBlob(blobId));
    if (this.directories.has(normalized)) return 0;
    throw new FilesystemError("not_found", `${path} does not exist`);
  }

  getFreeSpace(): number {
    return this.limits.capacityBytes - this.usedBytesValue;
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
  ): void {
    const normalized = this.resolveSymbolicLinks(path);
    const current = this.getMetadata(normalized);
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

  setModifiedTime(path: string, milliseconds: number): void {
    if (!Number.isFinite(milliseconds))
      throw new FilesystemError("invalid_path", "Invalid modification time");
    const normalized = this.resolveSymbolicLinks(path);
    const current = this.getMetadata(normalized);
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
        ...this.getMetadata(candidate),
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
            .filter((path) => !this.exists(path))
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
            path !== "/" && !metadataEquals(base?.metadata.get(path), metadata),
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
    for (const [id, contents] of snapshot.blobs) registerBlob(id, contents);
    for (const directory of [...snapshot.directories].sort(
      (left, right) => left.length - right.length || left.localeCompare(right),
    )) {
      restored.makeDirectory(directory);
    }
    for (const [path, blobId] of snapshot.files) {
      restored.writeFile(path, requireBlob(blobId));
    }
    for (const [path, target] of snapshot.symbolicLinks ?? []) {
      restored.createSymbolicLink(target, path);
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
    const previous = this.files.get(path);
    if (previous === blobId) return;
    const previousSize =
      previous === undefined ? 0 : utf8Size(requireBlob(previous));
    const linkId = this.hardLinkIds.get(path);
    const linkedPaths =
      linkId === undefined
        ? [path]
        : [...this.hardLinkIds]
            .filter(([, candidate]) => candidate === linkId)
            .map(([candidate]) => candidate);
    const delta = size - previousSize;
    if (this.usedBytesValue + delta > this.limits.capacityBytes) {
      throw new FilesystemError("capacity", "Filesystem capacity exceeded");
    }
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
        files: [[path, requireBlob(file)]],
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
      .map(([candidate, blobId]) => [candidate, requireBlob(blobId)] as const);
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
      const addedBytes = snapshot.files.reduce(
        (total, [, contents]) => total + utf8Size(contents),
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
    moving: boolean,
  ): void {
    for (const path of [...snapshot.directories].sort(
      (left, right) => left.length - right.length,
    ))
      this.makeDirectory(this.transferPath(source, destination, path));
    for (const [path, contents] of snapshot.files) {
      this.writeFile(this.transferPath(source, destination, path), contents);
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
    if (moving) {
      for (const [path, id] of snapshot.hardLinkIds) {
        this.hardLinkIds.set(this.transferPath(source, destination, path), id);
      }
    } else {
      const copiedGroups = new Map<number, string[]>();
      for (const [path, id] of snapshot.hardLinkIds) {
        const paths = copiedGroups.get(id) ?? [];
        paths.push(this.transferPath(source, destination, path));
        copiedGroups.set(id, paths);
      }
      for (const paths of copiedGroups.values()) {
        if (paths.length < 2) continue;
        const id = nextHardLinkId++;
        for (const path of paths) this.hardLinkIds.set(path, id);
      }
    }
    this.rebuildHardLinkCounts();
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
    let usedBytes = 0;
    for (const [path, blobId] of this.files) {
      const inodeId = this.requireInodeId(path);
      if (seen.has(inodeId)) continue;
      seen.add(inodeId);
      usedBytes += utf8Size(requireBlob(blobId));
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
      this.files.size + this.directories.size - 1 + additions >
      this.limits.maxEntries
    ) {
      throw new FilesystemError(
        "entry_limit",
        "Filesystem entry limit exceeded",
      );
    }
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
    siblings.add(baseName(path));
  }

  private removeChild(path: string): void {
    if (path === "/") return;
    this.children.get(parentPath(path))?.delete(baseName(path));
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
  readonly files: readonly (readonly [string, string])[];
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
    files.set(path, internBlob(file.contents));
    sizes.set(path, utf8Size(file.contents));
    metadata.set(path, {
      ...defaultMetadata(false),
      ...file.metadata,
      modifiedAtMilliseconds: 0,
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
  registerBlob(id, contents);
  return id;
}

function registerBlob(id: string, contents: string): void {
  if (contentBlobId(contents) !== id) {
    throw new Error(`Filesystem blob ${id} failed content-address validation`);
  }
  const existing = contentBlobs.get(id);
  if (existing !== undefined && existing !== contents) {
    throw new Error(`Filesystem blob collision for ${id}`);
  }
  contentBlobs.set(id, contents);
}

function requireBlob(id: string): string {
  const contents = contentBlobs.get(id);
  if (contents === undefined) throw new Error(`Missing filesystem blob ${id}`);
  return contents;
}

function contentBlobId(contents: string): string {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < contents.length; index += 1) {
    const value = contents.charCodeAt(index);
    first = Math.imul(first ^ value, 0x01000193) >>> 0;
    second = Math.imul(second ^ (value + index), 0x85ebca6b) >>> 0;
  }
  return `b${utf8Size(contents).toString(36)}-${first.toString(36)}-${second.toString(36)}`;
}

function utf8Size(value: string): number {
  let size = 0;
  for (const character of value) {
    const codePoint = character.codePointAt(0)!;
    size +=
      codePoint <= 0x7f
        ? 1
        : codePoint <= 0x7ff
          ? 2
          : codePoint <= 0xffff
            ? 3
            : 4;
  }
  return size;
}
