import {
  decodeUtf8,
  encodeUtf8,
  utf8ByteLength,
} from "../../domain/text/utf8.js";
import type { GuestFilesystem } from "./guestFilesystem.js";

export const linuxArchiveLimits = Object.freeze({
  maximumArchiveBytes: 1_048_576,
  maximumEntries: 512,
  maximumExpandedBytes: 4 * 1_048_576,
  maximumOperands: 32,
  maximumPathDepth: 32,
});

export interface LinuxArchiveResult {
  readonly exitCode: number;
  readonly stderr: string;
  readonly stdout: string;
}

export interface LinuxArchiveIo {
  readonly filesystem: GuestFilesystem;
  readonly readBytes: (path: string) => Uint8Array;
  readonly writeBytes: (path: string, contents: Uint8Array) => void;
}

interface ArchiveEntry {
  readonly bytes?: Uint8Array;
  readonly gid: number;
  readonly kind: "directory" | "file" | "symbolic_link";
  readonly mode: number;
  readonly modifiedAtMilliseconds: number;
  readonly name: string;
  readonly preserveOwnership?: boolean;
  readonly target?: string;
  readonly uid: number;
}

export function executeLinuxTar(
  arguments_: readonly string[],
  currentDirectory: string,
  io: LinuxArchiveIo,
): LinuxArchiveResult {
  try {
    if (arguments_.length < 2)
      return usage(
        "tar -cf archive paths... | tar -tf archive | tar -xf archive [-C dir]",
      );
    const mode = arguments_[0]!.startsWith("-")
      ? arguments_[0]!.slice(1)
      : arguments_[0]!;
    if (!["cf", "tf", "xf"].includes(mode))
      return usage(
        "tar -cf archive paths... | tar -tf archive | tar -xf archive [-C dir]",
      );
    const archivePath = resolve(
      io.filesystem,
      currentDirectory,
      arguments_[1]!,
    );
    if (mode === "cf") {
      const operands = arguments_.slice(2);
      if (
        operands.length === 0 ||
        operands.length > linuxArchiveLimits.maximumOperands
      ) {
        throw new Error("operand count must be 1..32");
      }
      const entries = collectEntries(operands, currentDirectory, io);
      io.writeBytes(archivePath, encodeTar(entries));
      return ok();
    }
    const archive = boundedArchive(io.readBytes(archivePath));
    const entries = decodeTar(archive);
    if (mode === "tf")
      return ok(entries.map(({ name }) => `${name}\n`).join(""));
    let destination = currentDirectory;
    if (arguments_.length === 4 && arguments_[2] === "-C") {
      destination = resolve(io.filesystem, currentDirectory, arguments_[3]!);
    } else if (arguments_.length !== 2) {
      return usage("tar -xf archive [-C dir]");
    }
    extractEntries(entries, destination, io);
    return ok();
  } catch (error: unknown) {
    return fail("tar", error);
  }
}

export function executeLinuxGzip(
  command: "gzip" | "gunzip",
  arguments_: readonly string[],
  currentDirectory: string,
  io: LinuxArchiveIo,
): LinuxArchiveResult {
  try {
    let decompress = command === "gunzip";
    let keep = false;
    const files: string[] = [];
    for (const argument of arguments_) {
      if (argument === "-d") decompress = true;
      else if (argument === "-k") keep = true;
      else if (argument.startsWith("-"))
        return usage(`${command} [-d] [-k] file...`);
      else files.push(argument);
    }
    if (
      files.length === 0 ||
      files.length > linuxArchiveLimits.maximumOperands
    ) {
      return usage(`${command} [-d] [-k] file...`);
    }
    for (const file of files) {
      const source = resolve(io.filesystem, currentDirectory, file);
      const bytes = boundedArchive(io.readBytes(source));
      const output = decompress ? decodeGzip(bytes) : encodeGzip(bytes);
      const destination = decompress
        ? source.endsWith(".gz")
          ? source.slice(0, -3)
          : `${source}.out`
        : `${source}.gz`;
      io.writeBytes(destination, output);
      if (!keep) io.filesystem.delete(source);
    }
    return ok();
  } catch (error: unknown) {
    return fail(command, error);
  }
}

export function encodeGzip(input: Uint8Array): Uint8Array {
  if (input.byteLength > linuxArchiveLimits.maximumExpandedBytes) {
    throw new Error("expanded byte limit exceeded");
  }
  const blocks: Uint8Array[] = [];
  for (
    let offset = 0;
    offset < input.length || offset === 0;
    offset += 65_535
  ) {
    const size = Math.min(65_535, input.length - offset);
    const final = offset + size >= input.length;
    const block = new Uint8Array(5 + size);
    block[0] = final ? 1 : 0;
    writeLe16(block, 1, size);
    writeLe16(block, 3, ~size & 0xffff);
    block.set(input.subarray(offset, offset + size), 5);
    blocks.push(block);
    if (input.length === 0) break;
  }
  const body = concatenate(blocks);
  const output = new Uint8Array(10 + body.length + 8);
  output.set([0x1f, 0x8b, 8, 0, 0, 0, 0, 0, 0, 3], 0);
  output.set(body, 10);
  writeLe32(output, 10 + body.length, crc32(input));
  writeLe32(output, 14 + body.length, input.length >>> 0);
  return output;
}

export function decodeGzip(input: Uint8Array): Uint8Array {
  if (
    input.length < 18 ||
    input[0] !== 0x1f ||
    input[1] !== 0x8b ||
    input[2] !== 8
  ) {
    throw new Error("invalid gzip header");
  }
  const flags = input[3]!;
  if (flags !== 0) throw new Error("gzip optional headers are not supported");
  const footer = input.length - 8;
  let cursor = 10;
  let bitOffset = 0;
  const bytes: number[] = [];
  let final = false;
  while (!final) {
    if (cursor >= footer) throw new Error("truncated DEFLATE stream");
    const header = readBits(input, { cursor, bitOffset }, 3);
    cursor = header.cursor;
    bitOffset = header.bitOffset;
    final = (header.value & 1) !== 0;
    const type = (header.value >>> 1) & 3;
    if (type !== 0)
      throw new Error("only bounded stored DEFLATE blocks are supported");
    if (bitOffset !== 0) {
      cursor += 1;
      bitOffset = 0;
    }
    if (cursor + 4 > footer) throw new Error("truncated stored DEFLATE block");
    const length = readLe16(input, cursor);
    const complement = readLe16(input, cursor + 2);
    cursor += 4;
    if ((~length & 0xffff) !== complement)
      throw new Error("invalid stored DEFLATE length");
    if (cursor + length > footer)
      throw new Error("truncated stored DEFLATE payload");
    if (bytes.length + length > linuxArchiveLimits.maximumExpandedBytes) {
      throw new Error("expanded byte limit exceeded");
    }
    for (let index = 0; index < length; index += 1)
      bytes.push(input[cursor + index]!);
    cursor += length;
  }
  if (cursor !== footer)
    throw new Error("unexpected data after DEFLATE stream");
  const output = Uint8Array.from(bytes);
  if (readLe32(input, footer) !== crc32(output))
    throw new Error("gzip CRC32 mismatch");
  if (readLe32(input, footer + 4) !== output.length >>> 0)
    throw new Error("gzip size mismatch");
  return output;
}

export function executeLinuxZip(
  arguments_: readonly string[],
  currentDirectory: string,
  io: LinuxArchiveIo,
): LinuxArchiveResult {
  try {
    if (
      arguments_.length < 2 ||
      arguments_.length - 1 > linuxArchiveLimits.maximumOperands
    ) {
      return usage("zip archive.zip paths...");
    }
    const archivePath = resolve(
      io.filesystem,
      currentDirectory,
      arguments_[0]!,
    );
    const entries = collectEntries(arguments_.slice(1), currentDirectory, io);
    io.writeBytes(archivePath, encodeZip(entries));
    return ok(entries.map(({ name }) => `  adding: ${name}\n`).join(""));
  } catch (error: unknown) {
    return fail("zip", error);
  }
}

export function executeLinuxUnzip(
  arguments_: readonly string[],
  currentDirectory: string,
  io: LinuxArchiveIo,
): LinuxArchiveResult {
  try {
    const listing = arguments_[0] === "-l";
    const archiveArgument = listing ? arguments_[1] : arguments_[0];
    if (archiveArgument === undefined)
      return usage("unzip [-l] archive.zip [-d dir]");
    let destination = currentDirectory;
    const remaining = arguments_.slice(listing ? 2 : 1);
    if (remaining.length === 2 && remaining[0] === "-d") {
      destination = resolve(io.filesystem, currentDirectory, remaining[1]!);
    } else if (remaining.length !== 0) {
      return usage("unzip [-l] archive.zip [-d dir]");
    }
    const archivePath = resolve(
      io.filesystem,
      currentDirectory,
      archiveArgument,
    );
    const entries = decodeZip(boundedArchive(io.readBytes(archivePath)));
    if (listing) {
      return ok(
        `  Length Name\n${entries
          .map(
            (entry) =>
              `${String(entry.bytes?.length ?? 0).padStart(8)} ${entry.name}\n`,
          )
          .join("")}`,
      );
    }
    extractEntries(entries, destination, io);
    return ok(entries.map(({ name }) => `  inflating: ${name}\n`).join(""));
  } catch (error: unknown) {
    return fail("unzip", error);
  }
}

function collectEntries(
  operands: readonly string[],
  currentDirectory: string,
  io: LinuxArchiveIo,
): readonly ArchiveEntry[] {
  const entries: ArchiveEntry[] = [];
  const seen = new Set<string>();
  const pending = operands
    .map((operand) => {
      const path = resolve(io.filesystem, currentDirectory, operand);
      return {
        name: path.slice(path.lastIndexOf("/") + 1),
        path,
      };
    })
    .toReversed();
  while (pending.length > 0) {
    const { name, path } = pending.pop()!;
    if (entries.length >= linuxArchiveLimits.maximumEntries) {
      throw new Error("archive entry limit exceeded");
    }
    validateArchiveName(name);
    if (seen.has(name)) throw new Error(`duplicate archive path: ${name}`);
    seen.add(name);
    const metadata = io.filesystem.getMetadata(path, false);
    if (io.filesystem.isSymbolicLink(path)) {
      entries.push({
        gid: metadata.gid,
        kind: "symbolic_link",
        mode: metadata.mode,
        modifiedAtMilliseconds: metadata.modifiedAtMilliseconds,
        name,
        target: io.filesystem.readLink(path),
        uid: metadata.uid,
      });
      continue;
    }
    if (io.filesystem.isDirectory(path)) {
      entries.push({
        gid: metadata.gid,
        kind: "directory",
        mode: metadata.mode,
        modifiedAtMilliseconds: metadata.modifiedAtMilliseconds,
        name: name.endsWith("/") ? name : `${name}/`,
        uid: metadata.uid,
      });
      const children = io.filesystem.list(path).sort().toReversed();
      for (const child of children) {
        pending.push({
          name: `${name}/${child}`,
          path: resolve(io.filesystem, path, child),
        });
      }
      continue;
    }
    const bytes = io.readBytes(path);
    entries.push({
      bytes,
      gid: metadata.gid,
      kind: "file",
      mode: metadata.mode,
      modifiedAtMilliseconds: metadata.modifiedAtMilliseconds,
      name,
      uid: metadata.uid,
    });
  }
  return entries;
}

function encodeTar(entries: readonly ArchiveEntry[]): Uint8Array {
  const chunks: Uint8Array[] = [];
  for (const entry of entries) {
    const header = new Uint8Array(512);
    writeAscii(header, 0, 100, entry.name);
    writeTarOctal(header, 100, 8, entry.mode & 0o7777);
    writeTarOctal(header, 108, 8, entry.uid);
    writeTarOctal(header, 116, 8, entry.gid);
    writeTarOctal(header, 124, 12, entry.bytes?.length ?? 0);
    writeTarOctal(
      header,
      136,
      12,
      Math.floor(entry.modifiedAtMilliseconds / 1000),
    );
    header.fill(0x20, 148, 156);
    header[156] =
      entry.kind === "file" ? 48 : entry.kind === "directory" ? 53 : 50;
    if (entry.target !== undefined) writeAscii(header, 157, 100, entry.target);
    writeAscii(header, 257, 6, "ustar\0");
    writeAscii(header, 263, 2, "00");
    let checksum = 0;
    for (const byte of header) checksum += byte;
    const checksumText = checksum.toString(8).padStart(6, "0");
    if (checksumText.length !== 6)
      throw new Error("tar checksum field limit exceeded");
    writeAscii(header, 148, 6, checksumText);
    header[154] = 0;
    header[155] = 0x20;
    chunks.push(header);
    if (entry.bytes !== undefined) {
      chunks.push(entry.bytes);
      const padding = (512 - (entry.bytes.length % 512)) % 512;
      if (padding > 0) chunks.push(new Uint8Array(padding));
    }
  }
  chunks.push(new Uint8Array(1024));
  return boundedArchive(concatenate(chunks));
}

export function decodeTar(input: Uint8Array): readonly ArchiveEntry[] {
  const entries: ArchiveEntry[] = [];
  let cursor = 0;
  while (cursor + 512 <= input.length) {
    const header = input.subarray(cursor, cursor + 512);
    if (header.every((byte) => byte === 0)) break;
    if (entries.length >= linuxArchiveLimits.maximumEntries)
      throw new Error("archive entry limit exceeded");
    const storedChecksum = readTarOctal(header, 148, 8);
    let checksum = 0;
    for (let index = 0; index < header.length; index += 1) {
      checksum += index >= 148 && index < 156 ? 0x20 : header[index]!;
    }
    if (checksum !== storedChecksum)
      throw new Error("tar header checksum mismatch");
    const name = readAscii(header, 0, 100);
    validateArchiveName(name);
    const size = readTarOctal(header, 124, 12);
    const type = header[156] === 0 ? 48 : header[156]!;
    cursor += 512;
    if (cursor + size > input.length) throw new Error("truncated tar entry");
    const common = {
      gid: readTarOctal(header, 116, 8),
      mode: readTarOctal(header, 100, 8),
      modifiedAtMilliseconds: readTarOctal(header, 136, 12) * 1000,
      name,
      uid: readTarOctal(header, 108, 8),
    };
    if (type === 48)
      entries.push({
        ...common,
        bytes: input.slice(cursor, cursor + size),
        kind: "file",
        preserveOwnership: true,
      });
    else if (type === 53)
      entries.push({ ...common, kind: "directory", preserveOwnership: true });
    else if (type === 50)
      entries.push({
        ...common,
        kind: "symbolic_link",
        preserveOwnership: true,
        target: readAscii(header, 157, 100),
      });
    else throw new Error(`unsupported tar entry type ${String(type)}`);
    cursor += Math.ceil(size / 512) * 512;
  }
  validateExpandedEntries(entries);
  return entries;
}

function encodeZip(entries: readonly ArchiveEntry[]): Uint8Array {
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const entry of entries) {
    if (entry.kind === "symbolic_link")
      throw new Error("zip symbolic links are not supported");
    const name = encodeUtf8(entry.name);
    const bytes = entry.bytes ?? new Uint8Array();
    if (name.length > 255) throw new Error("ZIP path byte limit exceeded");
    const checksum = crc32(bytes);
    const local = new Uint8Array(30 + name.length + bytes.length);
    writeLe32(local, 0, 0x04034b50);
    writeLe16(local, 4, 20);
    writeLe16(local, 6, 0x0800);
    writeLe16(local, 8, 0);
    writeLe32(local, 14, checksum);
    writeLe32(local, 18, bytes.length);
    writeLe32(local, 22, bytes.length);
    writeLe16(local, 26, name.length);
    local.set(name, 30);
    local.set(bytes, 30 + name.length);
    locals.push(local);
    const central = new Uint8Array(46 + name.length);
    writeLe32(central, 0, 0x02014b50);
    writeLe16(central, 4, 0x0314);
    writeLe16(central, 6, 20);
    writeLe16(central, 8, 0x0800);
    writeLe16(central, 10, 0);
    writeLe32(central, 16, checksum);
    writeLe32(central, 20, bytes.length);
    writeLe32(central, 24, bytes.length);
    writeLe16(central, 28, name.length);
    writeLe32(central, 38, ((entry.mode & 0xffff) << 16) >>> 0);
    writeLe32(central, 42, offset);
    central.set(name, 46);
    centrals.push(central);
    offset += local.length;
  }
  const localBytes = concatenate(locals);
  const centralBytes = concatenate(centrals);
  const end = new Uint8Array(22);
  writeLe32(end, 0, 0x06054b50);
  writeLe16(end, 8, entries.length);
  writeLe16(end, 10, entries.length);
  writeLe32(end, 12, centralBytes.length);
  writeLe32(end, 16, localBytes.length);
  return boundedArchive(concatenate([localBytes, centralBytes, end]));
}

function decodeZip(input: Uint8Array): readonly ArchiveEntry[] {
  let end = -1;
  for (
    let index = input.length - 22;
    index >= Math.max(0, input.length - 65_557);
    index -= 1
  ) {
    if (readLe32(input, index) === 0x06054b50) {
      end = index;
      break;
    }
  }
  if (end < 0) throw new Error("ZIP end record is missing");
  const count = readLe16(input, end + 10);
  if (count > linuxArchiveLimits.maximumEntries)
    throw new Error("archive entry limit exceeded");
  let cursor = readLe32(input, end + 16);
  const entries: ArchiveEntry[] = [];
  for (let entryIndex = 0; entryIndex < count; entryIndex += 1) {
    if (readLe32(input, cursor) !== 0x02014b50)
      throw new Error("invalid ZIP central directory");
    const flags = readLe16(input, cursor + 8);
    const method = readLe16(input, cursor + 10);
    if ((flags & ~0x0800) !== 0 || method !== 0)
      throw new Error("only unencrypted stored ZIP entries are supported");
    const checksum = readLe32(input, cursor + 16);
    const size = readLe32(input, cursor + 24);
    const nameLength = readLe16(input, cursor + 28);
    const extraLength = readLe16(input, cursor + 30);
    const commentLength = readLe16(input, cursor + 32);
    const localOffset = readLe32(input, cursor + 42);
    const name = decodeUtf8(
      input.subarray(cursor + 46, cursor + 46 + nameLength),
    );
    validateArchiveName(name);
    if (readLe32(input, localOffset) !== 0x04034b50)
      throw new Error("invalid ZIP local header");
    const localNameLength = readLe16(input, localOffset + 26);
    const localExtraLength = readLe16(input, localOffset + 28);
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    if (dataOffset + size > input.length)
      throw new Error("truncated ZIP entry");
    const bytes = input.slice(dataOffset, dataOffset + size);
    if (crc32(bytes) !== checksum) throw new Error("ZIP CRC32 mismatch");
    const directory = name.endsWith("/");
    entries.push({
      ...(directory ? {} : { bytes }),
      gid: 0,
      kind: directory ? "directory" : "file",
      mode: readLe32(input, cursor + 38) >>> 16 || (directory ? 0o755 : 0o644),
      modifiedAtMilliseconds: 0,
      name,
      uid: 0,
    });
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  validateExpandedEntries(entries);
  return entries;
}

function extractEntries(
  entries: readonly ArchiveEntry[],
  destination: string,
  io: LinuxArchiveIo,
): void {
  if (
    !io.filesystem.exists(destination) ||
    !io.filesystem.isDirectory(destination)
  ) {
    throw new Error(
      `${destination}: extraction destination is not a directory`,
    );
  }
  validateExpandedEntries(entries);
  const targets = new Map<string, ArchiveEntry>();
  for (const entry of entries) {
    const name = entry.name.endsWith("/")
      ? entry.name.slice(0, -1)
      : entry.name;
    const target = resolve(io.filesystem, destination, name);
    if (target !== destination && !target.startsWith(`${destination}/`)) {
      throw new Error(`archive path escapes destination: ${entry.name}`);
    }
    if (targets.has(target))
      throw new Error(`duplicate archive path: ${entry.name}`);
    targets.set(target, entry);
  }
  for (const [target] of targets) {
    let parent = target.slice(0, target.lastIndexOf("/")) || "/";
    while (parent !== destination && parent.startsWith(`${destination}/`)) {
      const archivedParent = targets.get(parent);
      if (archivedParent?.kind === "symbolic_link") {
        throw new Error(`archive symlink pivot: ${archivedParent.name}`);
      }
      if (
        pathExists(io.filesystem, parent) &&
        io.filesystem.isSymbolicLink(parent)
      ) {
        throw new Error(`existing symlink pivot: ${parent}`);
      }
      parent = parent.slice(0, parent.lastIndexOf("/")) || "/";
    }
    if (pathExists(io.filesystem, target))
      throw new Error(`destination already exists: ${target}`);
  }
  io.filesystem.transaction(() => {
    const directories = [...targets]
      .filter(([, entry]) => entry.kind === "directory")
      .sort(([left], [right]) => left.length - right.length);
    for (const [target, entry] of directories) {
      try {
        ensureExtractionParents(target, destination, io.filesystem);
        if (!pathExists(io.filesystem, target)) {
          io.filesystem.makeDirectory(target, entry.mode);
        }
        if (!io.filesystem.isDirectory(target)) {
          throw new Error(
            `archive directory became a non-directory: ${entry.name}`,
          );
        }
        io.filesystem.setMetadata(target, {
          ...(entry.preserveOwnership && canPreserveOwnership(io.filesystem)
            ? { gid: entry.gid, uid: entry.uid }
            : {}),
          mode: entry.mode,
        });
        io.filesystem.setModifiedTime(target, entry.modifiedAtMilliseconds);
      } catch (error: unknown) {
        throw new Error(
          `directory ${entry.name}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    for (const [target, entry] of targets) {
      if (entry.kind === "directory") continue;
      try {
        ensureExtractionParents(target, destination, io.filesystem);
      } catch (error: unknown) {
        throw new Error(
          `parent of ${entry.name}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      if (entry.kind === "symbolic_link") {
        if (entry.target === undefined || entry.target.includes("\0")) {
          throw new Error(`invalid symbolic link: ${entry.name}`);
        }
        io.filesystem.createSymbolicLink(entry.target, target);
        continue;
      }
      io.writeBytes(target, entry.bytes ?? new Uint8Array());
      io.filesystem.setMetadata(target, {
        ...(entry.preserveOwnership && canPreserveOwnership(io.filesystem)
          ? { gid: entry.gid, uid: entry.uid }
          : {}),
        mode: entry.mode,
      });
      io.filesystem.setModifiedTime(target, entry.modifiedAtMilliseconds);
    }
  });
}

function ensureExtractionParents(
  path: string,
  destination: string,
  filesystem: GuestFilesystem,
): void {
  const missing: string[] = [];
  let parent = path.slice(0, path.lastIndexOf("/")) || "/";
  while (parent !== destination && !pathExists(filesystem, parent)) {
    missing.push(parent);
    parent = parent.slice(0, parent.lastIndexOf("/")) || "/";
  }
  if (!pathExists(filesystem, parent) || !filesystem.isDirectory(parent)) {
    throw new Error(`archive parent is not a directory: ${parent}`);
  }
  for (const directory of missing.toReversed())
    filesystem.makeDirectory(directory);
}

function pathExists(filesystem: GuestFilesystem, path: string): boolean {
  try {
    return filesystem.exists(path);
  } catch {
    return false;
  }
}

function canPreserveOwnership(filesystem: GuestFilesystem): boolean {
  const credentialed = filesystem as GuestFilesystem & {
    readonly credentials?: { readonly effectiveUserId: number };
  };
  return credentialed.credentials?.effectiveUserId === 0;
}

function validateExpandedEntries(entries: readonly ArchiveEntry[]): void {
  if (entries.length > linuxArchiveLimits.maximumEntries)
    throw new Error("archive entry limit exceeded");
  const seen = new Set<string>();
  let expandedBytes = 0;
  for (const entry of entries) {
    validateArchiveName(entry.name);
    const normalized = entry.name.endsWith("/")
      ? entry.name.slice(0, -1)
      : entry.name;
    if (seen.has(normalized))
      throw new Error(`duplicate archive path: ${entry.name}`);
    seen.add(normalized);
    expandedBytes += entry.bytes?.length ?? 0;
    if (expandedBytes > linuxArchiveLimits.maximumExpandedBytes) {
      throw new Error("expanded byte limit exceeded");
    }
  }
}

function validateArchiveName(name: string): void {
  if (
    name.length === 0 ||
    name.startsWith("/") ||
    name.includes("\\") ||
    name.includes("\0") ||
    utf8ByteLength(name) > 255
  ) {
    throw new Error(`invalid archive path: ${name}`);
  }
  const segments = name.split("/").filter((segment) => segment.length > 0);
  if (
    segments.length === 0 ||
    segments.length > linuxArchiveLimits.maximumPathDepth ||
    segments.some((segment) => segment === "." || segment === "..")
  ) {
    throw new Error(`invalid archive path: ${name}`);
  }
}

function resolve(
  filesystem: GuestFilesystem,
  directory: string,
  path: string,
): string {
  return filesystem.normalize(
    path.startsWith("/") ? path : `${directory}/${path}`,
  );
}

function boundedArchive(bytes: Uint8Array): Uint8Array {
  if (bytes.length > linuxArchiveLimits.maximumArchiveBytes) {
    throw new Error("archive byte limit exceeded");
  }
  return bytes;
}

function writeAscii(
  target: Uint8Array,
  offset: number,
  maximum: number,
  value: string,
): void {
  const bytes = encodeUtf8(value);
  if (bytes.length > maximum) throw new Error("tar text field limit exceeded");
  target.set(bytes, offset);
}

function readAscii(source: Uint8Array, offset: number, length: number): string {
  const bytes = source.subarray(offset, offset + length);
  const end = bytes.indexOf(0);
  return decodeUtf8(end < 0 ? bytes : bytes.subarray(0, end));
}

function writeTarOctal(
  target: Uint8Array,
  offset: number,
  length: number,
  value: number,
): void {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new Error("invalid tar numeric field");
  const source = value.toString(8).padStart(length - 1, "0");
  if (source.length > length - 1)
    throw new Error("tar numeric field limit exceeded");
  writeAscii(target, offset, length - 1, source);
  target[offset + length - 1] = 0;
}

function readTarOctal(
  source: Uint8Array,
  offset: number,
  length: number,
): number {
  const value = readAscii(source, offset, length).trim().replace(/\0+$/u, "");
  if (!/^[0-7]+$/u.test(value)) throw new Error("invalid tar numeric field");
  const result = Number.parseInt(value, 8);
  if (!Number.isSafeInteger(result))
    throw new Error("tar numeric field overflow");
  return result;
}

function readBits(
  source: Uint8Array,
  position: { readonly cursor: number; readonly bitOffset: number },
  count: number,
): {
  readonly bitOffset: number;
  readonly cursor: number;
  readonly value: number;
} {
  let cursor = position.cursor;
  let bitOffset = position.bitOffset;
  let value = 0;
  for (let index = 0; index < count; index += 1) {
    if (cursor >= source.length) throw new Error("truncated bit stream");
    value |= ((source[cursor]! >>> bitOffset) & 1) << index;
    bitOffset += 1;
    if (bitOffset === 8) {
      bitOffset = 0;
      cursor += 1;
    }
  }
  return { bitOffset, cursor, value };
}

function readLe16(source: Uint8Array, offset: number): number {
  if (offset < 0 || offset + 2 > source.length)
    throw new Error("truncated archive field");
  return source[offset]! | (source[offset + 1]! << 8);
}

function readLe32(source: Uint8Array, offset: number): number {
  if (offset < 0 || offset + 4 > source.length)
    throw new Error("truncated archive field");
  return (
    (source[offset]! |
      (source[offset + 1]! << 8) |
      (source[offset + 2]! << 16) |
      (source[offset + 3]! << 24)) >>>
    0
  );
}

function writeLe16(target: Uint8Array, offset: number, value: number): void {
  target[offset] = value & 0xff;
  target[offset + 1] = (value >>> 8) & 0xff;
}

function writeLe32(target: Uint8Array, offset: number, value: number): void {
  target[offset] = value & 0xff;
  target[offset + 1] = (value >>> 8) & 0xff;
  target[offset + 2] = (value >>> 16) & 0xff;
  target[offset + 3] = (value >>> 24) & 0xff;
}

function concatenate(chunks: readonly Uint8Array[]): Uint8Array {
  const length = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const output = new Uint8Array(length);
  let cursor = 0;
  for (const chunk of chunks) {
    output.set(chunk, cursor);
    cursor += chunk.length;
  }
  return output;
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ ((crc & 1) === 0 ? 0 : 0xedb88320);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function ok(stdout = ""): LinuxArchiveResult {
  return { exitCode: 0, stderr: "", stdout };
}

function usage(syntax: string): LinuxArchiveResult {
  return { exitCode: 2, stderr: `usage: ${syntax}\n`, stdout: "" };
}

function fail(command: string, error: unknown): LinuxArchiveResult {
  return {
    exitCode: 1,
    stderr: `${command}: ${error instanceof Error ? error.message : String(error)}\n`,
    stdout: "",
  };
}
