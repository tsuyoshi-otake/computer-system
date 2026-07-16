import type {
  FilesystemLimits,
  FilesystemMetadata,
  InMemoryFilesystem,
  SynchronousTransactionOperation,
} from "../../domain/filesystem/inMemoryFilesystem.js";

export const filesystemRead = 0b100;
export const filesystemWrite = 0b010;
export const filesystemExecute = 0b001;

/** Bit mask composed from filesystemRead/filesystemWrite/filesystemExecute. */
export type FilesystemAccess = number;

export type GuestFilesystemEntryKind = "directory" | "file" | "symbolic_link";

export interface GuestFilesystemStat {
  readonly kind: GuestFilesystemEntryKind;
  readonly linkCount: number;
  readonly metadata: FilesystemMetadata;
  readonly size: number;
}

/**
 * The filesystem surface available to guest programs.
 *
 * It intentionally excludes persistence and base-image methods. Those methods
 * belong to trusted boot/storage code and must never be reachable through a
 * guest process.
 */
export interface GuestFilesystem {
  readonly baseImageId: string | undefined;
  readonly limits: FilesystemLimits;
  readonly revision: number;

  appendFile(path: string, contents: string): void;
  chmod(path: string, mode: number): void;
  chgrp(path: string, gid: number): void;
  chown(path: string, uid: number, gid?: number): void;
  copy(from: string, to: string): void;
  createHardLink(existing: string, path: string): void;
  createSymbolicLink(target: string, path: string): void;
  delete(path: string): void;
  exists(path: string): boolean;
  getFreeSpace(): number;
  getLinkCount(path: string): number;
  getMetadata(path: string, followLinks?: boolean): FilesystemMetadata;
  getSize(path: string): number;
  getUmask(): number;
  hasAccess(path: string, required: FilesystemAccess): boolean;
  isDirectory(path: string): boolean;
  isSymbolicLink(path: string): boolean;
  list(path: string): string[];
  makeDirectory(path: string, mode?: number): void;
  move(from: string, to: string): void;
  normalize(path: string): string;
  readFile(path: string): string;
  readLink(path: string): string;
  resolveSymbolicLinks(path: string): string;
  setMetadata(
    path: string,
    update: Partial<Pick<FilesystemMetadata, "gid" | "mode" | "uid">>,
  ): void;
  setModifiedTime(path: string, milliseconds: number): void;
  setUmask(mask: number): number;
  stat(path: string, followLinks?: boolean): GuestFilesystemStat;
  transaction<Result>(
    operation: SynchronousTransactionOperation<Result>,
  ): Result;
  writeFile(path: string, contents: string, mode?: number): void;
}

/** A trusted/DOS view which preserves the old unrestricted filesystem rules. */
export class UnrestrictedGuestFilesystem implements GuestFilesystem {
  private umaskValue: number;

  constructor(
    protected readonly filesystem: InMemoryFilesystem,
    umask = 0o022,
  ) {
    this.umaskValue = validUmask(umask);
  }

  get baseImageId(): string | undefined {
    return this.filesystem.baseImageId;
  }

  get limits(): FilesystemLimits {
    return this.filesystem.limits;
  }

  get revision(): number {
    return this.filesystem.revision;
  }

  appendFile(path: string, contents: string): void {
    this.filesystem.appendFile(path, contents);
  }

  chmod(path: string, mode: number): void {
    this.filesystem.setMetadata(path, { mode: validMode(mode) });
  }

  chgrp(path: string, gid: number): void {
    this.filesystem.setMetadata(path, { gid: validIdentity(gid, "gid") });
  }

  chown(path: string, uid: number, gid?: number): void {
    this.filesystem.setMetadata(path, {
      ...(gid === undefined ? {} : { gid: validIdentity(gid, "gid") }),
      uid: validIdentity(uid, "uid"),
    });
  }

  copy(from: string, to: string): void {
    this.filesystem.copy(from, to);
  }

  createHardLink(existing: string, path: string): void {
    this.filesystem.createHardLink(existing, path);
  }

  createSymbolicLink(target: string, path: string): void {
    this.filesystem.createSymbolicLink(target, path);
  }

  delete(path: string): void {
    this.filesystem.delete(path);
  }

  exists(path: string): boolean {
    return this.filesystem.exists(path);
  }

  getFreeSpace(): number {
    return this.filesystem.getFreeSpace();
  }

  getLinkCount(path: string): number {
    return this.filesystem.getLinkCount(path);
  }

  getMetadata(path: string, followLinks = true): FilesystemMetadata {
    return this.filesystem.getMetadata(path, followLinks);
  }

  getSize(path: string): number {
    return this.filesystem.getSize(path);
  }

  getUmask(): number {
    return this.umaskValue;
  }

  hasAccess(path: string): boolean {
    return this.filesystem.exists(path);
  }

  isDirectory(path: string): boolean {
    return this.filesystem.isDirectory(path);
  }

  isSymbolicLink(path: string): boolean {
    return this.filesystem.isSymbolicLink(path);
  }

  list(path: string): string[] {
    return this.filesystem.list(path);
  }

  makeDirectory(path: string, mode = 0o777): void {
    validMode(mode);
    const normalized = this.filesystem.normalize(path);
    const existed = this.filesystem.exists(normalized);
    this.filesystem.makeDirectory(normalized);
    if (!existed) {
      this.filesystem.setMetadata(normalized, {
        mode: creationMode(mode, this.umaskValue),
      });
    }
  }

  move(from: string, to: string): void {
    this.filesystem.move(from, to);
  }

  normalize(path: string): string {
    return this.filesystem.normalize(path);
  }

  readFile(path: string): string {
    return this.filesystem.readFile(path);
  }

  readLink(path: string): string {
    return this.filesystem.readLink(path);
  }

  resolveSymbolicLinks(path: string): string {
    return this.filesystem.resolveSymbolicLinks(path);
  }

  setMetadata(
    path: string,
    update: Partial<Pick<FilesystemMetadata, "gid" | "mode" | "uid">>,
  ): void {
    this.filesystem.setMetadata(path, {
      ...(update.gid === undefined
        ? {}
        : { gid: validIdentity(update.gid, "gid") }),
      ...(update.mode === undefined ? {} : { mode: validMode(update.mode) }),
      ...(update.uid === undefined
        ? {}
        : { uid: validIdentity(update.uid, "uid") }),
    });
  }

  setModifiedTime(path: string, milliseconds: number): void {
    this.filesystem.setModifiedTime(path, milliseconds);
  }

  setUmask(mask: number): number {
    const previous = this.umaskValue;
    this.umaskValue = validUmask(mask);
    return previous;
  }

  stat(path: string, followLinks = true): GuestFilesystemStat {
    return statFilesystem(this.filesystem, path, followLinks);
  }

  transaction<Result>(
    operation: SynchronousTransactionOperation<Result>,
  ): Result {
    return this.filesystem.transaction(operation);
  }

  writeFile(path: string, contents: string, mode = 0o666): void {
    validMode(mode);
    const normalized = this.filesystem.normalize(path);
    const existed = this.filesystem.exists(normalized);
    this.filesystem.writeFile(normalized, contents);
    if (!existed) {
      this.filesystem.setMetadata(normalized, {
        mode: creationMode(mode, this.umaskValue),
      });
    }
  }
}

export function unrestrictedGuestFilesystem(
  filesystem: InMemoryFilesystem,
  umask?: number,
): GuestFilesystem {
  return new UnrestrictedGuestFilesystem(filesystem, umask);
}

export function statFilesystem(
  filesystem: InMemoryFilesystem,
  path: string,
  followLinks = true,
): GuestFilesystemStat {
  const symbolicLink = filesystem.isSymbolicLink(path);
  const kind =
    symbolicLink && !followLinks
      ? "symbolic_link"
      : filesystem.isDirectory(path)
        ? "directory"
        : "file";
  return {
    kind,
    linkCount: kind === "symbolic_link" ? 1 : filesystem.getLinkCount(path),
    metadata: filesystem.getMetadata(path, followLinks),
    size:
      kind === "symbolic_link"
        ? utf8ByteLength(filesystem.readLink(path))
        : filesystem.getSize(path),
  };
}

export function creationMode(requested: number, umask: number): number {
  return validMode(requested) & ~validUmask(umask) & 0o1777;
}

export function validIdentity(value: number, name: "gid" | "uid"): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > 65_535) {
    throw new RangeError(`${name} must be an integer from 0 to 65535`);
  }
  return value;
}

export function validMode(mode: number): number {
  if (!Number.isInteger(mode) || mode < 0 || mode > 0o7777) {
    throw new RangeError("mode must be an integer from 0000 to 7777");
  }
  // csfs is mounted nosuid. Persisting set-user-ID/set-group-ID bits would be
  // misleading because this runtime never changes process credentials for an
  // executable inode. Sticky remains meaningful for directories.
  return mode & 0o1777;
}

export function validUmask(mask: number): number {
  if (!Number.isInteger(mask) || mask < 0 || mask > 0o777) {
    throw new RangeError("umask must be an integer from 000 to 777");
  }
  return mask;
}

function utf8ByteLength(value: string): number {
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
