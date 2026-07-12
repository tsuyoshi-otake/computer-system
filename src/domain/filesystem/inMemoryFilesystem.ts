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

export class InMemoryFilesystem {
  private readonly files = new Map<string, string>();
  private readonly directories = new Set<string>(["/"]);

  constructor(readonly limits: FilesystemLimits = defaultFilesystemLimits) {
    for (const [name, value] of Object.entries(limits)) {
      if (!Number.isInteger(value) || value <= 0)
        throw new RangeError(`${name} must be positive`);
    }
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
    const prefix = normalized === "/" ? "/" : `${normalized}/`;
    const names = new Set<string>();
    for (const candidate of [...this.directories, ...this.files.keys()]) {
      if (!candidate.startsWith(prefix) || candidate === normalized) continue;
      const remainder = candidate.slice(prefix.length);
      const name = remainder.split("/")[0];
      if (name !== undefined && name.length > 0) names.add(name);
    }
    return [...names].sort();
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
    for (const addition of additions) this.directories.add(addition);
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
      if (candidate === normalized || candidate.startsWith(prefix))
        this.files.delete(candidate);
    }
    for (const candidate of [...this.directories]) {
      if (candidate === normalized || candidate.startsWith(prefix))
        this.directories.delete(candidate);
    }
  }

  copy(from: string, to: string): void {
    const source = this.normalize(from);
    const destination = this.normalize(to);
    const snapshot = this.snapshot(source, from);
    this.validateTransfer(source, destination, snapshot, false);
    this.commitSnapshot(source, destination, snapshot);
  }

  move(from: string, to: string): void {
    const source = this.normalize(from);
    const destination = this.normalize(to);
    if (source === "/")
      throw new FilesystemError("protected", "Cannot move root");
    const snapshot = this.snapshot(source, from);
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
    return this.limits.capacityBytes - this.usedBytes();
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
    const previousSize = this.files.has(path)
      ? utf8Size(this.files.get(path)!)
      : 0;
    if (this.usedBytes() - previousSize + size > this.limits.capacityBytes) {
      throw new FilesystemError("capacity", "Filesystem capacity exceeded");
    }
    if (!this.files.has(path)) this.checkEntryCount(1);
    this.files.set(path, contents);
  }

  private snapshot(path: string, original: string): FilesystemSnapshot {
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
      if (this.usedBytes() + addedBytes > this.limits.capacityBytes) {
        throw new FilesystemError("capacity", "Filesystem capacity exceeded");
      }
    }
  }

  private commitSnapshot(
    source: string,
    destination: string,
    snapshot: FilesystemSnapshot,
  ): void {
    for (const path of snapshot.directories) {
      this.directories.add(this.transferPath(source, destination, path));
    }
    for (const [path, contents] of snapshot.files) {
      this.files.set(this.transferPath(source, destination, path), contents);
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

  private usedBytes(): number {
    let total = 0;
    for (const contents of this.files.values()) total += utf8Size(contents);
    return total;
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
