import {
  FilesystemError,
  type FilesystemLimits,
  type FilesystemMetadata,
  type InMemoryFilesystem,
  type SynchronousTransactionOperation,
} from "../../domain/filesystem/inMemoryFilesystem.js";
import {
  creationMode,
  filesystemExecute,
  filesystemRead,
  filesystemWrite,
  statFilesystem,
  validIdentity,
  validMode,
  validUmask,
  type FilesystemAccess,
  type GuestFilesystem,
  type GuestFilesystemStat,
} from "./guestFilesystem.js";
import type { ProcessCredentials } from "./linuxCredentials.js";
import { linuxAccountPaths } from "./linuxAccounts.js";

export const maxGuestFilesystemPathDepth = 128;
export const csfsNosuid = true;
const maximumCheckedSymbolicLinkHops = 16;

interface CopyEntry {
  readonly kind: "directory" | "file" | "symbolic_link";
  readonly metadata: FilesystemMetadata;
  readonly relativePath: string;
}

/**
 * A Linux DAC boundary around the persistence-oriented in-memory filesystem.
 *
 * All path checks walk only ancestors (or the explicitly requested subtree for
 * recursive copy/delete). No access decision scans unrelated filesystem state.
 * The credentials object is an immutable process snapshot, so a foreground
 * process cannot inherit later shell elevation by accident.
 */
export class CredentialedFilesystem implements GuestFilesystem {
  private umaskValue: number;

  constructor(
    private readonly filesystem: InMemoryFilesystem,
    private readonly credentialsSource:
      ProcessCredentials | (() => ProcessCredentials),
    umask = 0o022,
  ) {
    const credentials = this.credentials;
    validIdentity(credentials.realUserId, "uid");
    validIdentity(credentials.effectiveUserId, "uid");
    validIdentity(credentials.savedUserId, "uid");
    validIdentity(credentials.realGroupId, "gid");
    validIdentity(credentials.effectiveGroupId, "gid");
    validIdentity(credentials.savedGroupId, "gid");
    for (const gid of credentials.supplementaryGroupIds)
      validIdentity(gid, "gid");
    this.umaskValue = validUmask(umask);
  }

  get credentials(): ProcessCredentials {
    return typeof this.credentialsSource === "function"
      ? this.credentialsSource()
      : this.credentialsSource;
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

  transaction<Result>(
    operation: SynchronousTransactionOperation<Result>,
  ): Result {
    return this.filesystem.transaction(operation);
  }

  appendFile(path: string, contents: string): void {
    const destination = this.resolveFollowedPath(path);
    this.requireManagedAccountsIntact(destination, false);
    if (this.filesystem.exists(destination)) {
      this.requireMode(destination, filesystemWrite);
      this.filesystem.appendFile(destination, contents);
      return;
    }
    this.requireCreate(destination);
    this.filesystem.appendFile(destination, contents);
    this.ownCreatedPath(destination, 0o666);
  }

  chmod(path: string, mode: number): void {
    const resolved = this.resolveFollowedPath(path);
    this.requireManagedAccountsIntact(resolved, true);
    const metadata = this.filesystem.getMetadata(resolved, false);
    if (!this.isRoot() && metadata.uid !== this.credentials.effectiveUserId) {
      throw operationNotPermitted(path);
    }
    this.filesystem.setMetadata(resolved, { mode: validMode(mode) });
  }

  chgrp(path: string, gid: number): void {
    const nextGroup = validIdentity(gid, "gid");
    const resolved = this.resolveFollowedPath(path);
    this.requireManagedAccountsIntact(resolved, true);
    const metadata = this.filesystem.getMetadata(resolved, false);
    if (
      !this.isRoot() &&
      (metadata.uid !== this.credentials.effectiveUserId ||
        !this.hasGroup(nextGroup))
    ) {
      throw operationNotPermitted(path);
    }
    this.filesystem.setMetadata(resolved, { gid: nextGroup });
  }

  chown(path: string, uid: number, gid?: number): void {
    if (!this.isRoot()) throw operationNotPermitted(path);
    const resolved = this.resolveFollowedPath(path);
    this.requireManagedAccountsIntact(resolved, true);
    this.filesystem.setMetadata(resolved, {
      ...(gid === undefined ? {} : { gid: validIdentity(gid, "gid") }),
      uid: validIdentity(uid, "uid"),
    });
  }

  copy(from: string, to: string): void {
    const source = this.resolveEntryPath(from);
    const destination = this.resolveEntryPath(to);
    this.requireManagedAccountsIntact(destination, false);
    const entries = this.collectReadableTree(source);
    this.requireCreate(destination);
    this.filesystem.copy(source, destination);
    for (const entry of entries) {
      const copiedPath = appendRelative(destination, entry.relativePath);
      const metadata = {
        gid: this.credentials.effectiveGroupId,
        mode:
          entry.kind === "symbolic_link"
            ? 0o777
            : creationMode(entry.metadata.mode, this.umaskValue),
        uid: this.credentials.effectiveUserId,
      };
      this.setMetadataWithoutFollowing(
        copiedPath,
        metadata,
        entry.kind !== "symbolic_link",
      );
    }
  }

  createHardLink(existing: string, path: string): void {
    const source = this.resolveFollowedPath(existing);
    this.requireManagedAccountsIntact(source, false);
    const sourceMetadata = this.filesystem.getMetadata(source, false);
    if (
      !this.isRoot() &&
      sourceMetadata.uid !== this.credentials.effectiveUserId
    ) {
      throw operationNotPermitted(existing);
    }
    const destination = this.resolveEntryPath(path);
    this.requireManagedAccountsIntact(destination, false);
    this.requireCreate(destination);
    this.filesystem.createHardLink(source, destination);
  }

  createSymbolicLink(target: string, path: string): void {
    const destination = this.resolveEntryPath(path);
    this.requireManagedAccountsIntact(destination, false);
    this.requireCreate(destination);
    this.filesystem.createSymbolicLink(target, destination);
    this.setMetadataWithoutFollowing(
      destination,
      {
        gid: this.credentials.effectiveGroupId,
        mode: 0o777,
        uid: this.credentials.effectiveUserId,
      },
      false,
    );
  }

  delete(path: string): void {
    const resolved = this.resolveEntryPath(path);
    this.requireManagedAccountsIntact(resolved, true);
    if (!this.filesystem.exists(resolved)) {
      throw new FilesystemError("not_found", `${path} does not exist`);
    }
    const parent = parentPath(resolved);
    this.requireMode(parent, filesystemWrite | filesystemExecute);
    this.requireStickyRemoval(parent, resolved, path);
    this.preflightDeleteTree(resolved);
    this.filesystem.delete(resolved);
  }

  exists(path: string): boolean {
    return this.filesystem.exists(this.resolveEntryPath(path));
  }

  getFreeSpace(): number {
    return this.filesystem.getFreeSpace();
  }

  getLinkCount(path: string): number {
    return this.filesystem.getLinkCount(this.resolveFollowedPath(path));
  }

  getMetadata(path: string, followLinks = true): FilesystemMetadata {
    const resolved = followLinks
      ? this.resolveFollowedPath(path)
      : this.resolveEntryPath(path);
    return this.filesystem.getMetadata(resolved, false);
  }

  getSize(path: string): number {
    return this.filesystem.getSize(this.resolveFollowedPath(path));
  }

  getUmask(): number {
    return this.umaskValue;
  }

  hasAccess(path: string, required: FilesystemAccess): boolean {
    try {
      const resolved = this.resolveFollowedPath(path);
      this.requireMode(resolved, required);
      return true;
    } catch (error: unknown) {
      if (error instanceof FilesystemError) return false;
      throw error;
    }
  }

  isDirectory(path: string): boolean {
    return this.filesystem.isDirectory(this.resolveFollowedPath(path));
  }

  isSymbolicLink(path: string): boolean {
    return this.filesystem.isSymbolicLink(this.resolveEntryPath(path));
  }

  list(path: string): string[] {
    const resolved = this.resolveFollowedPath(path);
    this.requireMode(resolved, filesystemRead | filesystemExecute);
    return this.filesystem.list(resolved);
  }

  makeDirectory(path: string, mode = 0o777): void {
    validMode(mode);
    const normalized = this.normalizedWithBoundedDepth(path);
    this.requireManagedAccountsIntact(normalized, false);
    const segments = pathSegments(normalized);
    if (segments.length === 0) return;
    const createdDirectories: string[] = [];
    let current = "/";
    try {
      this.requireMode(current, filesystemExecute);
      for (let index = 0; index < segments.length; index += 1) {
        const segment = segments[index]!;
        const candidate = joinPath(current, segment);
        if (!this.filesystem.exists(candidate)) {
          this.requireMode(current, filesystemWrite | filesystemExecute);
          this.filesystem.makeDirectory(candidate);
          createdDirectories.push(candidate);
          this.ownCreatedPath(
            candidate,
            index === segments.length - 1 ? mode : 0o777,
          );
          current = candidate;
          continue;
        }
        const resolved = this.filesystem.isSymbolicLink(candidate)
          ? this.resolveFollowedPath(candidate)
          : candidate;
        if (!this.filesystem.isDirectory(resolved)) {
          throw new FilesystemError(
            "not_directory",
            `${candidate} is not a directory`,
          );
        }
        this.requireMode(resolved, filesystemExecute);
        current = resolved;
      }
    } catch (error: unknown) {
      let rollbackError: unknown;
      for (const created of createdDirectories.toReversed()) {
        if (!this.filesystem.exists(created)) continue;
        try {
          this.filesystem.delete(created);
        } catch (candidateError: unknown) {
          rollbackError ??= candidateError;
        }
      }
      const residual = createdDirectories.some((created) =>
        this.filesystem.exists(created),
      );
      if (residual) {
        throw new FilesystemError(
          "rollback_failed",
          `${errorMessage(error)}; directory rollback failed: ${errorMessage(rollbackError)}`,
        );
      }
      throw error;
    }
  }

  move(from: string, to: string): void {
    const source = this.resolveEntryPath(from);
    const destination = this.resolveEntryPath(to);
    this.requireManagedAccountsIntact(source, true);
    this.requireManagedAccountsIntact(destination, false);
    if (!this.filesystem.exists(source)) {
      throw new FilesystemError("not_found", `${from} does not exist`);
    }
    const sourceParent = parentPath(source);
    this.requireMode(sourceParent, filesystemWrite | filesystemExecute);
    this.requireStickyRemoval(sourceParent, source, from);
    this.requireCreate(destination);
    this.filesystem.move(source, destination);
  }

  normalize(path: string): string {
    return this.normalizedWithBoundedDepth(path);
  }

  readFile(path: string): string {
    const resolved = this.resolveFollowedPath(path);
    this.requireMode(resolved, filesystemRead);
    return this.filesystem.readFile(resolved);
  }

  readLink(path: string): string {
    return this.filesystem.readLink(this.resolveEntryPath(path));
  }

  resolveSymbolicLinks(path: string): string {
    return this.resolveFollowedPath(path);
  }

  setMetadata(
    path: string,
    update: Partial<Pick<FilesystemMetadata, "gid" | "mode" | "uid">>,
  ): void {
    const resolved = this.resolveFollowedPath(path);
    this.requireManagedAccountsIntact(resolved, true);
    const current = this.filesystem.getMetadata(resolved, false);
    if (update.uid !== undefined && !this.isRoot()) {
      throw operationNotPermitted(path);
    }
    if (update.gid !== undefined && !this.isRoot()) {
      const nextGroup = validIdentity(update.gid, "gid");
      if (
        current.uid !== this.credentials.effectiveUserId ||
        !this.hasGroup(nextGroup)
      ) {
        throw operationNotPermitted(path);
      }
    }
    if (
      update.mode !== undefined &&
      !this.isRoot() &&
      current.uid !== this.credentials.effectiveUserId
    ) {
      throw operationNotPermitted(path);
    }
    this.filesystem.setMetadata(resolved, {
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
    const resolved = this.resolveFollowedPath(path);
    this.requireManagedAccountsIntact(resolved, false);
    const metadata = this.filesystem.getMetadata(resolved, false);
    if (!this.isRoot() && metadata.uid !== this.credentials.effectiveUserId) {
      this.requireMode(resolved, filesystemWrite);
    }
    this.filesystem.setModifiedTime(resolved, milliseconds);
  }

  setUmask(mask: number): number {
    const previous = this.umaskValue;
    this.umaskValue = validUmask(mask);
    return previous;
  }

  stat(path: string, followLinks = true): GuestFilesystemStat {
    const resolved = followLinks
      ? this.resolveFollowedPath(path)
      : this.resolveEntryPath(path);
    return statFilesystem(this.filesystem, resolved, followLinks);
  }

  writeFile(path: string, contents: string, mode = 0o666): void {
    validMode(mode);
    const destination = this.resolveFollowedPath(path);
    this.requireManagedAccountsIntact(destination, false);
    if (this.filesystem.exists(destination)) {
      this.requireMode(destination, filesystemWrite);
      this.filesystem.writeFile(destination, contents);
      return;
    }
    this.requireCreate(destination);
    this.filesystem.writeFile(destination, contents);
    this.ownCreatedPath(destination, mode);
  }

  private collectReadableTree(source: string): CopyEntry[] {
    const entries: CopyEntry[] = [];
    const pending: { readonly path: string; readonly relativePath: string }[] =
      [{ path: source, relativePath: "" }];
    while (pending.length > 0) {
      if (entries.length >= this.filesystem.limits.maxEntries) {
        throw new FilesystemError(
          "entry_limit",
          "Filesystem copy entry limit exceeded",
        );
      }
      const current = pending.pop()!;
      const metadata = this.filesystem.getMetadata(current.path, false);
      if (this.filesystem.isSymbolicLink(current.path)) {
        entries.push({
          kind: "symbolic_link",
          metadata,
          relativePath: current.relativePath,
        });
        continue;
      }
      if (!this.filesystem.isDirectory(current.path)) {
        this.requireMode(current.path, filesystemRead);
        entries.push({
          kind: "file",
          metadata,
          relativePath: current.relativePath,
        });
        continue;
      }
      this.requireMode(current.path, filesystemRead | filesystemExecute);
      entries.push({
        kind: "directory",
        metadata,
        relativePath: current.relativePath,
      });
      const names = this.filesystem.list(current.path);
      for (let index = names.length - 1; index >= 0; index -= 1) {
        const name = names[index]!;
        pending.push({
          path: joinPath(current.path, name),
          relativePath:
            current.relativePath.length === 0
              ? name
              : `${current.relativePath}/${name}`,
        });
      }
    }
    return entries;
  }

  private isRoot(): boolean {
    return this.credentials.effectiveUserId === 0;
  }

  private hasGroup(gid: number): boolean {
    const credentials = this.credentials;
    return (
      gid === credentials.effectiveGroupId ||
      credentials.supplementaryGroupIds.includes(gid)
    );
  }

  private normalizedWithBoundedDepth(path: string): string {
    const normalized = this.filesystem.normalize(path);
    if (pathSegments(normalized).length > maxGuestFilesystemPathDepth) {
      throw new FilesystemError(
        "path_limit",
        "Filesystem path depth limit exceeded",
      );
    }
    return normalized;
  }

  private ownCreatedPath(path: string, requestedMode: number): void {
    this.filesystem.setMetadata(path, {
      gid: this.credentials.effectiveGroupId,
      mode: creationMode(requestedMode, this.umaskValue),
      uid: this.credentials.effectiveUserId,
    });
  }

  private preflightDeleteTree(path: string): void {
    const pending = [path];
    let visited = 0;
    while (pending.length > 0) {
      if (visited >= this.filesystem.limits.maxEntries) {
        throw new FilesystemError(
          "entry_limit",
          "Filesystem delete entry limit exceeded",
        );
      }
      visited += 1;
      const current = pending.pop()!;
      if (
        this.filesystem.isSymbolicLink(current) ||
        !this.filesystem.isDirectory(current)
      ) {
        continue;
      }
      const names = this.filesystem.list(current);
      if (names.length === 0) continue;
      this.requireMode(
        current,
        filesystemRead | filesystemWrite | filesystemExecute,
      );
      for (const name of names) {
        const child = joinPath(current, name);
        this.requireStickyRemoval(current, child, child);
        pending.push(child);
      }
    }
  }

  private requireCreate(path: string): void {
    if (this.filesystem.exists(path)) {
      throw new FilesystemError("exists", `${path} already exists`);
    }
    this.requireMode(parentPath(path), filesystemWrite | filesystemExecute);
  }

  private requireManagedAccountsIntact(
    path: string,
    protectAncestors: boolean,
  ): void {
    const normalized = this.normalizedWithBoundedDepth(path);
    const descendantPrefix = normalized === "/" ? "/" : `${normalized}/`;
    for (const accountPath of Object.values(linuxAccountPaths)) {
      if (
        normalized === accountPath ||
        (protectAncestors && accountPath.startsWith(descendantPrefix))
      ) {
        throw new FilesystemError(
          "operation_not_permitted",
          `${path}: managed account database; use CS-Linux account commands`,
        );
      }
    }
  }

  private requireMode(path: string, required: FilesystemAccess): void {
    const metadata = this.filesystem.getMetadata(path, false);
    const directory = this.filesystem.isDirectory(path);
    if (this.isRoot()) {
      if (
        (required & filesystemExecute) !== 0 &&
        !directory &&
        (metadata.mode & 0o111) === 0
      ) {
        throw permissionDenied(path);
      }
      return;
    }
    const shift =
      metadata.uid === this.credentials.effectiveUserId
        ? 6
        : this.hasGroup(metadata.gid)
          ? 3
          : 0;
    const available = (metadata.mode >> shift) & 0b111;
    if ((available & required) !== required) throw permissionDenied(path);
  }

  private requireStickyRemoval(
    parent: string,
    entry: string,
    displayPath: string,
  ): void {
    const parentMetadata = this.filesystem.getMetadata(parent, false);
    if ((parentMetadata.mode & 0o1000) === 0 || this.isRoot()) return;
    const entryMetadata = this.filesystem.getMetadata(entry, false);
    const effectiveUserId = this.credentials.effectiveUserId;
    if (
      parentMetadata.uid !== effectiveUserId &&
      entryMetadata.uid !== effectiveUserId
    ) {
      throw operationNotPermitted(displayPath);
    }
  }

  private resolveEntryPath(path: string): string {
    return this.resolveCheckedPath(path, false);
  }

  private resolveFollowedPath(path: string): string {
    return this.resolveCheckedPath(path, true);
  }

  private resolveCheckedPath(path: string, followFinal: boolean): string {
    this.filesystem.normalize(path);
    const pending = path
      .replaceAll("\\", "/")
      .split("/")
      .filter((segment) => segment.length > 0 && segment !== ".");
    if (pending.length > maxGuestFilesystemPathDepth) throw pathDepthExceeded();
    const resolvedSegments: string[] = [];
    let symbolicLinkHops = 0;
    let componentSteps = 0;
    this.requireMode("/", filesystemExecute);
    while (pending.length > 0) {
      componentSteps += 1;
      if (
        componentSteps >
        maxGuestFilesystemPathDepth * (maximumCheckedSymbolicLinkHops + 1)
      ) {
        throw pathDepthExceeded();
      }
      const segment = pending.shift()!;
      if (segment === "..") {
        if (resolvedSegments.length === 0) {
          throw new FilesystemError("invalid_path", "Path escapes root");
        }
        const current = `/${resolvedSegments.join("/")}`;
        if (!this.filesystem.isDirectory(current)) {
          throw new FilesystemError(
            "not_directory",
            `${current} is not a directory`,
          );
        }
        this.requireMode(current, filesystemExecute);
        resolvedSegments.pop();
        continue;
      }
      const parent =
        resolvedSegments.length === 0 ? "/" : `/${resolvedSegments.join("/")}`;
      const candidate = joinPath(parent, segment);
      const isFinal = pending.length === 0;
      if (
        this.filesystem.isSymbolicLink(candidate) &&
        (followFinal || !isFinal)
      ) {
        symbolicLinkHops += 1;
        if (symbolicLinkHops > maximumCheckedSymbolicLinkHops) {
          throw new FilesystemError(
            "invalid_path",
            `${path}: too many symbolic links`,
          );
        }
        const target = this.filesystem
          .readLink(candidate)
          .replaceAll("\\", "/");
        const targetSegments = target
          .split("/")
          .filter((part) => part.length > 0 && part !== ".");
        if (
          pending.length + targetSegments.length >
          maxGuestFilesystemPathDepth * (maximumCheckedSymbolicLinkHops + 1)
        ) {
          throw pathDepthExceeded();
        }
        if (target.startsWith("/")) resolvedSegments.length = 0;
        pending.unshift(...targetSegments);
        continue;
      }
      this.filesystem.normalize(candidate);
      resolvedSegments.push(segment);
      if (resolvedSegments.length > maxGuestFilesystemPathDepth)
        throw pathDepthExceeded();
      if (pending.length === 0) return `/${resolvedSegments.join("/")}`;
      if (!this.filesystem.isDirectory(candidate)) {
        throw new FilesystemError(
          "not_directory",
          `${candidate} is not a directory`,
        );
      }
      this.requireMode(candidate, filesystemExecute);
    }
    return "/";
  }

  private setMetadataWithoutFollowing(
    path: string,
    update: Partial<Pick<FilesystemMetadata, "gid" | "mode" | "uid">>,
    followLinks: boolean,
  ): void {
    this.filesystem.setMetadata(path, update, followLinks);
  }
}

export function credentialedFilesystem(
  filesystem: InMemoryFilesystem,
  credentials: ProcessCredentials | (() => ProcessCredentials),
  umask?: number,
): CredentialedFilesystem {
  return new CredentialedFilesystem(filesystem, credentials, umask);
}

function appendRelative(root: string, relativePath: string): string {
  return relativePath.length === 0 ? root : `${root}/${relativePath}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function joinPath(parent: string, name: string): string {
  return parent === "/" ? `/${name}` : `${parent}/${name}`;
}

function operationNotPermitted(path: string): FilesystemError {
  return new FilesystemError(
    "operation_not_permitted",
    `${path}: Operation not permitted`,
  );
}

function parentPath(path: string): string {
  return path.slice(0, path.lastIndexOf("/")) || "/";
}

function pathSegments(path: string): string[] {
  return path.split("/").filter(Boolean);
}

function permissionDenied(path: string): FilesystemError {
  return new FilesystemError("permission_denied", `${path}: Permission denied`);
}

function pathDepthExceeded(): FilesystemError {
  return new FilesystemError(
    "path_limit",
    "Filesystem path depth limit exceeded",
  );
}
