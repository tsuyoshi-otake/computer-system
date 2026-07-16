import type {
  FilesystemLimits,
  FilesystemMetadata,
  SynchronousTransactionOperation,
} from "../../domain/filesystem/inMemoryFilesystem.js";
import {
  floppyDataStartLba,
  floppySectorCount,
  type FloppyMedia,
  type FloppyIoExtent,
} from "../../domain/storage/floppyMedia.js";
import { utf8ByteLength } from "../../domain/text/utf8.js";
import type { ComputerOsProfile } from "../../domain/computer/computer.js";
import type {
  FilesystemAccess,
  GuestFilesystem,
  GuestFilesystemStat,
} from "./guestFilesystem.js";

export interface FloppyDriveIo {
  readonly extents: readonly FloppyIoExtent[];
  readonly mediaGeneration: number;
  readonly operation: "read" | "write";
}

export type FloppyDriveActivity =
  "eject" | "insert" | "motor_start" | "read" | "seek" | "write";

export interface FloppyDriveOptions {
  readonly nowMilliseconds: () => number;
  readonly onActivity?: (activity: FloppyDriveActivity) => void;
  readonly onGuestEject?: () => void;
  readonly save: (media: FloppyMedia) => void;
}

/** One drive bay and its transient mount state; the medium remains authoritative. */
export class FloppyDrive {
  private mediaValue: FloppyMedia | undefined;
  private linuxMountedValue = false;
  private pendingIo: FloppyDriveIo[] = [];

  constructor(private readonly options: FloppyDriveOptions) {}

  get media(): FloppyMedia | undefined {
    return this.mediaValue;
  }

  get linuxMounted(): boolean {
    return this.linuxMountedValue;
  }

  insert(media: FloppyMedia): void {
    if (this.mediaValue !== undefined)
      throw new Error("Floppy drive already contains media");
    this.mediaValue = media;
    this.options.onActivity?.("insert");
  }

  eject(): FloppyMedia {
    const media = this.requireMedia();
    this.linuxMountedValue = false;
    this.pendingIo = [];
    this.mediaValue = undefined;
    this.options.onActivity?.("eject");
    return media;
  }

  requestGuestEject(): void {
    this.requireMedia();
    if (this.options.onGuestEject === undefined)
      throw new Error("Floppy eject boundary is unavailable");
    this.options.onGuestEject();
  }

  mountLinux(): void {
    const media = this.requireFormatted();
    if (this.linuxMountedValue)
      throw new Error("/mnt/floppy is already mounted");
    this.linuxMountedValue = true;
    this.recordIo("read", [{ lba: 0, sectorCount: 1 }], media);
  }

  unmountLinux(): void {
    if (!this.linuxMountedValue) throw new Error("/mnt/floppy is not mounted");
    this.linuxMountedValue = false;
  }

  format(bootable: boolean, volumeLabel = ""): void {
    const media = this.requireMedia();
    this.mutate(media, () =>
      media.format({
        bootable,
        modifiedAtMilliseconds: this.options.nowMilliseconds(),
        volumeLabel,
      }),
    );
    this.recordIo("write", [{ lba: 0, sectorCount: floppySectorCount }], media);
  }

  installSystem(): void {
    const media = this.requireFormatted();
    this.mutate(media, () =>
      media.installSystem(this.options.nowMilliseconds()),
    );
    this.recordIo(
      "write",
      [
        { lba: 0, sectorCount: 1 },
        ...media.ioExtents("/IO.SYS"),
        ...media.ioExtents("/MSDOS.SYS"),
        ...media.ioExtents("/COMMAND.COM"),
      ],
      media,
    );
  }

  isVisible(profile: ComputerOsProfile): boolean {
    return profile === "dos"
      ? this.mediaValue !== undefined
      : this.linuxMountedValue;
  }

  drainIo(): readonly FloppyDriveIo[] {
    const result = Object.freeze([...this.pendingIo]);
    this.pendingIo = [];
    return result;
  }

  access(operation: "read" | "write", path: string): void {
    const media = this.requireFormatted();
    const extents =
      path === "/" ? [{ lba: 0, sectorCount: 1 }] : media.ioExtents(path);
    this.recordIo(operation, extents, media);
  }

  mutate<Result>(media: FloppyMedia, operation: () => Result): Result {
    return media.transaction(() => {
      const result = operation();
      this.options.save(media);
      return result;
    });
  }

  timestamp(): number {
    return this.options.nowMilliseconds();
  }

  requireMedia(): FloppyMedia {
    if (this.mediaValue === undefined)
      throw new Error("No floppy media in drive A:");
    return this.mediaValue;
  }

  requireFormatted(): FloppyMedia {
    const media = this.requireMedia();
    if (!media.formatted) throw new Error("Floppy media is not formatted");
    return media;
  }

  private recordIo(
    operation: "read" | "write",
    extents: readonly FloppyIoExtent[],
    media: FloppyMedia,
  ): void {
    this.pendingIo.push({
      extents: Object.freeze(
        extents.map((extent) => Object.freeze({ ...extent })),
      ),
      mediaGeneration: media.instanceGeneration,
      operation,
    });
    this.options.onActivity?.("motor_start");
    if (extents.some((extent) => extent.lba >= floppyDataStartLba))
      this.options.onActivity?.("seek");
    this.options.onActivity?.(operation);
  }
}

const linuxMountPath = "/mnt/floppy";
const dosMountPath = "/drives/a";

/** Routes one mount subtree to FAT12 while leaving the installed filesystem untouched. */
export class FloppyGuestFilesystem implements GuestFilesystem {
  constructor(
    private readonly base: GuestFilesystem,
    private readonly drive: FloppyDrive,
    private readonly profile: ComputerOsProfile,
  ) {}

  get baseImageId(): string | undefined {
    return this.base.baseImageId;
  }
  get limits(): FilesystemLimits {
    return this.base.limits;
  }
  get revision(): number {
    return this.base.revision + (this.drive.media?.revision ?? 0);
  }

  appendFile(path: string, contents: string): void {
    const target = this.target(path);
    if (target === undefined) return this.base.appendFile(path, contents);
    this.writeFile(path, `${this.readFile(path)}${contents}`);
  }

  chmod(path: string, mode: number): void {
    this.rejectMetadata(path, () => this.base.chmod(path, mode));
  }
  chgrp(path: string, gid: number): void {
    this.rejectMetadata(path, () => this.base.chgrp(path, gid));
  }
  chown(path: string, uid: number, gid?: number): void {
    this.rejectMetadata(path, () => this.base.chown(path, uid, gid));
  }

  copy(from: string, to: string): void {
    const source = this.target(from);
    const destination = this.target(to);
    if (source === undefined && destination === undefined)
      return this.base.copy(from, to);
    if (this.isDirectory(from))
      throw new Error("FAT12 recursive copy is not supported");
    this.writeFile(to, this.readFile(from));
  }

  createHardLink(existing: string, path: string): void {
    if (this.target(existing) !== undefined || this.target(path) !== undefined)
      throw new Error("FAT12 does not support hard links");
    this.base.createHardLink(existing, path);
  }

  createSymbolicLink(target: string, path: string): void {
    if (this.target(path) !== undefined)
      throw new Error("FAT12 does not support symbolic links");
    this.base.createSymbolicLink(target, path);
  }

  delete(path: string): void {
    const target = this.target(path);
    if (target === undefined) return this.base.delete(path);
    const media = this.drive.requireFormatted();
    this.drive.mutate(media, () => media.delete(target));
    this.drive.access("write", target);
  }

  exists(path: string): boolean {
    const target = this.target(path);
    if (target !== undefined)
      return target === "/" || this.drive.requireFormatted().exists(target);
    if (this.isMountedParent(path)) return true;
    return this.base.exists(path);
  }

  getFreeSpace(): number {
    return this.drive.isVisible(this.profile)
      ? this.drive.requireFormatted().freeBytes
      : this.base.getFreeSpace();
  }
  getLinkCount(path: string): number {
    return this.target(path) === undefined ? this.base.getLinkCount(path) : 1;
  }

  getMetadata(path: string): FilesystemMetadata {
    const target = this.target(path);
    if (target === undefined) return this.base.getMetadata(path);
    const media = this.drive.requireFormatted();
    const directory = target === "/" || media.isDirectory(target);
    return {
      gid: 1_000,
      mode: directory ? 0o755 : 0o644,
      modifiedAtMilliseconds:
        target === "/" ? 0 : media.metadata(target).modifiedAtMilliseconds,
      uid: 1_000,
    };
  }

  getSize(path: string): number {
    const target = this.target(path);
    if (target === undefined) return this.base.getSize(path);
    const media = this.drive.requireFormatted();
    return target === "/" || media.isDirectory(target)
      ? 0
      : utf8ByteLength(media.readFile(target));
  }

  getUmask(): number {
    return this.base.getUmask();
  }
  hasAccess(path: string, required: FilesystemAccess): boolean {
    const target = this.target(path);
    if (target === undefined) return this.base.hasAccess(path, required);
    if (!this.exists(path)) return false;
    const write = (required & 0b010) !== 0;
    return !write || this.drive.requireFormatted().writeProtected === false;
  }
  isDirectory(path: string): boolean {
    const target = this.target(path);
    if (target === undefined) return this.base.isDirectory(path);
    return target === "/" || this.drive.requireFormatted().isDirectory(target);
  }
  isSymbolicLink(path: string): boolean {
    return this.target(path) === undefined && this.base.isSymbolicLink(path);
  }

  list(path: string): string[] {
    const target = this.target(path);
    if (target !== undefined) {
      const media = this.drive.requireFormatted();
      this.drive.access("read", target);
      return [...media.list(target)];
    }
    const values = this.base.exists(path) ? this.base.list(path) : [];
    if (this.isMountedParent(path)) {
      const name = this.profile === "dos" ? "a" : "floppy";
      if (!values.includes(name)) values.push(name);
    }
    return values.sort();
  }

  makeDirectory(path: string, mode?: number): void {
    const target = this.target(path);
    if (target === undefined) return this.base.makeDirectory(path, mode);
    const media = this.drive.requireFormatted();
    this.drive.mutate(media, () =>
      media.makeDirectory(target, this.drive.timestamp()),
    );
    this.drive.access("write", target);
  }

  move(from: string, to: string): void {
    const source = this.target(from);
    const destination = this.target(to);
    if (source === undefined && destination === undefined)
      return this.base.move(from, to);
    if (this.isDirectory(from))
      throw new Error("FAT12 directory move is not supported");
    this.transaction(() => {
      this.writeFile(to, this.readFile(from));
      this.delete(from);
    });
  }

  normalize(path: string): string {
    return this.base.normalize(path);
  }
  readFile(path: string): string {
    const target = this.target(path);
    if (target === undefined) return this.base.readFile(path);
    const media = this.drive.requireFormatted();
    const contents = media.readFile(target);
    this.drive.access("read", target);
    return contents;
  }
  readLink(path: string): string {
    if (this.target(path) !== undefined)
      throw new Error("FAT12 does not support symbolic links");
    return this.base.readLink(path);
  }
  resolveSymbolicLinks(path: string): string {
    return this.target(path) === undefined
      ? this.base.resolveSymbolicLinks(path)
      : this.normalize(path);
  }
  setMetadata(
    path: string,
    update: Partial<Pick<FilesystemMetadata, "gid" | "mode" | "uid">>,
  ): void {
    this.rejectMetadata(path, () => this.base.setMetadata(path, update));
  }
  setModifiedTime(path: string, milliseconds: number): void {
    const target = this.target(path);
    if (target === undefined)
      return this.base.setModifiedTime(path, milliseconds);
    const media = this.drive.requireFormatted();
    this.drive.mutate(media, () => media.setModifiedTime(target, milliseconds));
    this.drive.access("write", target);
  }
  setUmask(mask: number): number {
    return this.base.setUmask(mask);
  }

  stat(path: string): GuestFilesystemStat {
    const target = this.target(path);
    if (target === undefined) return this.base.stat(path);
    return {
      kind: this.isDirectory(path) ? "directory" : "file",
      linkCount: 1,
      metadata: this.getMetadata(path),
      size: this.getSize(path),
    };
  }

  transaction<Result>(
    operation: SynchronousTransactionOperation<Result>,
  ): Result {
    const media = this.drive.media;
    // InMemoryFilesystem deliberately rejects cross-owner nested mutations.
    // While removable media is visible, FAT12 owns the command's undo boundary;
    // base-only commands retain the installed filesystem's normal boundary.
    return media === undefined || !this.drive.isVisible(this.profile)
      ? this.base.transaction(operation)
      : media.transaction(operation);
  }

  writeFile(path: string, contents: string, mode?: number): void {
    const target = this.target(path);
    if (target === undefined) return this.base.writeFile(path, contents, mode);
    const media = this.drive.requireFormatted();
    this.drive.mutate(media, () =>
      media.writeFile(target, contents, this.drive.timestamp()),
    );
    this.drive.access("write", target);
  }

  private target(path: string): string | undefined {
    if (!this.drive.isVisible(this.profile)) return undefined;
    const normalized = this.base.normalize(path);
    const mount = this.profile === "dos" ? dosMountPath : linuxMountPath;
    if (normalized !== mount && !normalized.startsWith(`${mount}/`))
      return undefined;
    return normalized === mount ? "/" : normalized.slice(mount.length);
  }

  private isMountedParent(path: string): boolean {
    if (!this.drive.isVisible(this.profile)) return false;
    const normalized = this.base.normalize(path);
    return normalized === (this.profile === "dos" ? "/drives" : "/mnt");
  }

  private rejectMetadata(path: string, fallback: () => void): void {
    if (this.target(path) !== undefined)
      throw new Error("FAT12 does not support ownership or mode changes");
    fallback();
  }
}
