export interface FilesystemLimits {
  readonly capacityBytes: number;
  readonly maxEntries: number;
  readonly maxFileBytes: number;
  readonly maxPathLength: number;
}

export const defaultFilesystemLimits: FilesystemLimits = {
  capacityBytes: 1_000_000,
  maxEntries: 4_096,
  maxFileBytes: 256_000,
  maxPathLength: 255,
};

export interface InMemoryFilesystemSnapshot {
  readonly directories: readonly string[];
  readonly files: readonly (readonly [path: string, contents: string])[];
}

export class InMemoryFilesystem {
  private readonly files = new Map<string, string>();
  private readonly directories = new Set<string>(["/"]);
  private readonly children = new Map<string, Set<string>>([["/", new Set()]]);
  private revisionValue = 0;
  private usedBytesValue = 0;

  constructor(readonly limits: FilesystemLimits = defaultFilesystemLimits) {
    for (const [name, value] of Object.entries(limits)) {
      if (!Number.isInteger(value) || value <= 0)
        throw new RangeError(`${name} must be positive`);
    }
  }

  get revision(): number {
    return this.revisionValue;
  }

  exists(path: string): boolean {
    const normalized = this.normalize(path);
    return this.files.has(normalized) || this.directories.has(normalized);
  }

  isDirectory(path: string): boolean {
    return this.directories.has(this.normalize(path));
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
      this.addChild(addition);
    }
    if (additions.length > 0) this.revisionValue += 1;
  }

  readFile(path: string): string {
    const normalized = this.normalize(path);
    const contents = this.files.get(normalized);
    if (contents === undefined)
      throw new FilesystemError("not_found", `${path} is not a file`);
    return contents;
  }

  writeFile(path: string, contents: string): void {
    const normalized = this.normalize(path);
    if (normalized === "/" || this.directories.has(normalized)) {
      throw new FilesystemError("is_directory", `${path} is a directory`);
    }
    this.requireParent(normalized);
    this.commitFile(normalized, contents);
  }

  appendFile(path: string, contents: string): void {
    const normalized = this.normalize(path);
    this.writeFile(normalized, (this.files.get(normalized) ?? "") + contents);
  }

  delete(path: string): void {
    const normalized = this.normalize(path);
    if (normalized === "/")
      throw new FilesystemError("protected", "Cannot delete root");
    if (!this.exists(normalized))
      throw new FilesystemError("not_found", `${path} does not exist`);
    const prefix = `${normalized}/`;
    for (const candidate of [...this.files.keys()]) {
      if (candidate === normalized || candidate.startsWith(prefix)) {
        this.usedBytesValue -= utf8Size(this.files.get(candidate)!);
        this.files.delete(candidate);
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
    }
    this.revisionValue += 1;
  }

  copy(from: string, to: string): void {
    const source = this.normalize(from);
    const destination = this.normalize(to);
    const snapshot = this.subtreeSnapshot(source, from);
    this.validateTransfer(source, destination, snapshot, false);
    this.commitSnapshot(source, destination, snapshot);
  }

  move(from: string, to: string): void {
    const source = this.normalize(from);
    const destination = this.normalize(to);
    if (source === "/")
      throw new FilesystemError("protected", "Cannot move root");
    const snapshot = this.subtreeSnapshot(source, from);
    this.validateTransfer(source, destination, snapshot, true);
    this.delete(source);
    this.commitSnapshot(source, destination, snapshot);
  }

  getSize(path: string): number {
    const normalized = this.normalize(path);
    const contents = this.files.get(normalized);
    if (contents !== undefined) return utf8Size(contents);
    if (this.directories.has(normalized)) return 0;
    throw new FilesystemError("not_found", `${path} does not exist`);
  }

  getFreeSpace(): number {
    return this.limits.capacityBytes - this.usedBytesValue;
  }

  snapshot(): InMemoryFilesystemSnapshot {
    return {
      directories: [...this.directories].filter((path) => path !== "/").sort(),
      files: [...this.files].sort(([left], [right]) =>
        left.localeCompare(right),
      ),
    };
  }

  restore(snapshot: InMemoryFilesystemSnapshot): void {
    const restored = new InMemoryFilesystem(this.limits);
    for (const directory of [...snapshot.directories].sort(
      (left, right) => left.length - right.length || left.localeCompare(right),
    )) {
      restored.makeDirectory(directory);
    }
    for (const [path, contents] of snapshot.files) {
      restored.writeFile(path, contents);
    }
    this.files.clear();
    this.directories.clear();
    this.children.clear();
    for (const directory of restored.directories)
      this.directories.add(directory);
    for (const [path, contents] of restored.files)
      this.files.set(path, contents);
    for (const [path, names] of restored.children)
      this.children.set(path, new Set(names));
    this.usedBytesValue = restored.usedBytesValue;
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
    const normalized = this.normalize(path);
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
    const previous = this.files.get(path);
    if (previous === contents) return;
    const previousSize = previous === undefined ? 0 : utf8Size(previous);
    if (this.usedBytesValue - previousSize + size > this.limits.capacityBytes) {
      throw new FilesystemError("capacity", "Filesystem capacity exceeded");
    }
    if (!this.files.has(path)) this.checkEntryCount(1);
    this.files.set(path, contents);
    if (previous === undefined) this.addChild(path);
    this.usedBytesValue += size - previousSize;
    this.revisionValue += 1;
  }

  private subtreeSnapshot(path: string, original: string): FilesystemSnapshot {
    const file = this.files.get(path);
    if (file !== undefined) return { directories: [], files: [[path, file]] };
    if (!this.directories.has(path)) {
      throw new FilesystemError("not_found", `${original} does not exist`);
    }
    const prefix = path === "/" ? "/" : `${path}/`;
    return {
      directories: [...this.directories].filter(
        (candidate) => candidate === path || candidate.startsWith(prefix),
      ),
      files: [...this.files].filter(([candidate]) =>
        candidate.startsWith(prefix),
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
  ): void {
    for (const path of [...snapshot.directories].sort(
      (left, right) => left.length - right.length,
    ))
      this.makeDirectory(this.transferPath(source, destination, path));
    for (const [path, contents] of snapshot.files) {
      this.writeFile(this.transferPath(source, destination, path), contents);
    }
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
