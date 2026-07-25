import {
  Cs486Fault,
  cs486ExecutableMemoryRequirements,
  cs486ExecutableDataModel,
  parseCs486FunctionSignature,
  type Cs486Executable,
  type Cs486ExecutableMemoryRequirements,
  type Cs486ProcessImageInitialization,
  type Cs486SyscallContext,
  type Cs486SyscallHandler,
  type Cs486SyscallResult,
} from "../../domain/cpu/cs486.js";
import {
  cs486Byte8DataModel,
  cs486Word32DataModel,
  type Cs486DataModel,
} from "../../domain/cpu/cs486Compatibility.js";
import { FilesystemError } from "../../domain/filesystem/inMemoryFilesystem.js";
import type {
  TerminalBuffer,
  TerminalCell,
} from "../../domain/terminal/terminalBuffer.js";
import type { ComputerWorkLane } from "./computerWorkMonitor.js";
import {
  filesystemExecute,
  type GuestFilesystem,
} from "../os/guestFilesystem.js";
import type { ProcessCredentials } from "../os/linuxCredentials.js";
import { encodeUtf8 } from "../../domain/text/utf8.js";

export const csAbiVersion = 1;
export const csAbiStartupMagic = 0x43_53_41_31;

export const csAbiLimits = Object.freeze({
  aggregateStartupWords: 8_192,
  arguments: 64,
  directoryDescriptors: 8,
  directoryEntries: 256,
  environmentEntries: 16,
  fileDescriptors: 8,
  framebufferCells: 80 * 25,
  ioWords: 4_096,
  keyFifo: 64,
  outputWords: 64_000,
  perStringWords: 256,
  startupBytes: 32 * 1_024,
});

export const csAbiSelectors = Object.freeze({
  exit: 0,
  termSize: 1,
  termPresent: 2,
  keyWait: 3,
  keyPoll: 4,
  clockTicks: 5,
  sleepTicks: 6,
  heapInfo: 7,
  fsOpen: 8,
  fsRead: 9,
  fsWrite: 10,
  fsSeek: 11,
  fsStat: 12,
  fsClose: 13,
  fsRemove: 14,
  fsRename: 15,
  wallTime: 16,
  fsGetcwd: 17,
  fsChdir: 18,
  fsMkdir: 19,
  fsRmdir: 20,
  fsAccess: 21,
  fsOpenDir: 22,
  fsReadDir: 23,
  fsCloseDir: 24,
  fsStatExtended: 25,
});

export const csAbiErrno = Object.freeze({
  eperm: 1,
  enoent: 2,
  eio: 5,
  eexist: 17,
  ebadf: 9,
  eagain: 11,
  enomem: 12,
  eacces: 13,
  efault: 14,
  einval: 22,
  emfile: 24,
  enospc: 28,
  epipe: 32,
  erange: 34,
});

export type CsAbiStandardInputResult =
  | { readonly kind: "data"; readonly units: readonly number[] }
  | { readonly kind: "eof" }
  | { readonly kind: "would-block" };

export type CsAbiStandardOutputResult =
  | { readonly kind: "broken-pipe" }
  | { readonly kind: "would-block" }
  | { readonly kind: "written"; readonly unitsWritten: number };

/** Process-scoped fd 0/1/2 endpoints supplied by a scheduler-owned pipeline. */
export interface CsAbiStandardIo {
  readonly inputReady: () => boolean;
  readonly outputReady: (descriptor: 1 | 2) => boolean;
  readonly read: (
    dataModel: Cs486DataModel,
    maximumUnits: number,
  ) => CsAbiStandardInputResult;
  readonly write: (
    descriptor: 1 | 2,
    dataModel: Cs486DataModel,
    units: readonly number[],
  ) => CsAbiStandardOutputResult;
}

export const csAbiKeycodes = Object.freeze({
  arrowDown: 0x101,
  arrowLeft: 0x102,
  arrowRight: 0x103,
  arrowUp: 0x104,
  backspace: 8,
  delete: 0x105,
  end: 0x106,
  enter: 13,
  escape: 27,
  home: 0x107,
  pageDown: 0x108,
  pageUp: 0x109,
  tab: 9,
});

export interface CsAbiHostedStartup {
  readonly argv: readonly string[];
  readonly cwd: string;
  readonly environment: readonly (readonly [name: string, value: string])[];
}

export interface PreparedCsAbiStartup {
  readonly environment: ReadonlyMap<string, string>;
  readonly heapBaseBytes: number;
  readonly heapWords: number;
  readonly image: Cs486ProcessImageInitialization;
  readonly startupAddress: number;
  readonly startupBytes: number;
}

export interface CsAbiRuntimeOptions {
  readonly computerId: string;
  readonly credentials: ProcessCredentials;
  readonly cwd: string;
  readonly filesystem: GuestFilesystem;
  readonly heapBaseBytes: number;
  readonly heapWords: number;
  readonly startupAddress: number;
  readonly currentTick: () => number;
  readonly currentWallTimeMilliseconds: () => number;
  readonly outputObserver?: (descriptor: 1 | 2, text: string) => void;
  readonly standardIo?: CsAbiStandardIo;
  readonly standardInput?: string;
  readonly runHostWork: (
    lane: ComputerWorkLane,
    deterministicUnits: number,
    action: () => void,
  ) => boolean;
  readonly terminal: TerminalBuffer;
}

interface OpenFile {
  readonly append: boolean;
  readonly dataModel: Cs486DataModel;
  readonly path: string;
  position: number;
  readonly readable: boolean;
  readonly writable: boolean;
}

interface OpenDirectory {
  readonly entries: readonly string[];
  position: number;
  readonly revision: number;
}

class CsAbiGuestError extends Error {
  constructor(
    readonly errno: number,
    message: string,
  ) {
    super(message);
  }
}

const startupHeaderWords = 15;
const openRead = 1;
const openWrite = 2;
const openCreate = 4;
const openTruncate = 8;
const openAppend = 16;
const openExclusive = 32;

export function prepareCsAbiStartup(
  executable: Cs486Executable,
  startup: CsAbiHostedStartup,
  credentials: ProcessCredentials,
): PreparedCsAbiStartup {
  const requirements = cs486ExecutableMemoryRequirements(executable);
  if (
    requirements.kind !== "declared" ||
    (requirements.version !== 4 &&
      requirements.version !== 5 &&
      requirements.version !== 6)
  ) {
    throw new Error("CS ABI requires a version 4, 5, or 6 executable");
  }
  const main = executable.symbols?.find(
    ({ name, section, type }) =>
      name === "main" && section === "text" && type === "function",
  );
  const mainSignature = parseCs486FunctionSignature(main?.functionSignature);
  const parameters = mainSignature?.parameterTypes.length;
  if (
    main === undefined ||
    mainSignature?.variadic !== false ||
    (parameters !== 0 && parameters !== 2)
  ) {
    throw new Error("CS ABI entry must be main(void) or main(int, char **)");
  }
  if (startup.argv.length < 1 || startup.argv.length > csAbiLimits.arguments) {
    throw new RangeError("CS ABI argument count limit exceeded");
  }
  if (startup.environment.length > csAbiLimits.environmentEntries) {
    throw new RangeError("CS ABI environment entry limit exceeded");
  }

  const environment = new Map<string, string>();
  for (const [name, value] of startup.environment) {
    if (!/^[A-Z][A-Z0-9_]{0,31}$/u.test(name) || environment.has(name)) {
      throw new TypeError("CS ABI environment name is invalid or duplicated");
    }
    requireWordString(value, `environment variable ${name}`);
    environment.set(name, value);
  }
  requireWordString(startup.cwd, "current directory");
  for (const argument of startup.argv) requireWordString(argument, "argument");

  if (cs486ExecutableDataModel(executable) === cs486Byte8DataModel)
    return prepareByteCsAbiStartup(
      requirements,
      startup,
      credentials,
      environment,
    );

  const startupAddress = requirements.alignedDataBytes;
  const argvTableIndex = startupHeaderWords;
  const environmentTableIndex = argvTableIndex + startup.argv.length + 1;
  const words = Array<number>(
    environmentTableIndex + startup.environment.length + 1,
  ).fill(0);
  const appendString = (value: string): number => {
    const address = startupAddress + words.length * 4;
    words.push(...[...value].map((character) => character.codePointAt(0)!), 0);
    if (words.length > csAbiLimits.aggregateStartupWords) {
      throw new RangeError("CS ABI aggregate startup word limit exceeded");
    }
    return address;
  };
  const argumentPointers = startup.argv.map(appendString);
  const environmentPointers = startup.environment.map(([name, value]) =>
    appendString(`${name}=${value}`),
  );
  const cwdPointer = appendString(startup.cwd);
  for (const [index, pointer] of argumentPointers.entries()) {
    words[argvTableIndex + index] = pointer;
  }
  for (const [index, pointer] of environmentPointers.entries()) {
    words[environmentTableIndex + index] = pointer;
  }
  const argvPointer = startupAddress + argvTableIndex * 4;
  const environmentPointer = startupAddress + environmentTableIndex * 4;
  const unalignedStartupBytes = words.length * 4;
  if (unalignedStartupBytes > csAbiLimits.startupBytes) {
    throw new RangeError("CS ABI startup block byte limit exceeded");
  }
  const heapBaseBytes = align(startupAddress + unalignedStartupBytes, 16);
  const heapEndBytes = requirements.alignedDataBytes + requirements.heapBytes;
  if (heapBaseBytes > heapEndBytes) {
    throw new RangeError("CS ABI startup block exceeds declared heap");
  }
  const heapWords = Math.floor((heapEndBytes - heapBaseBytes) / 4);
  words[0] = csAbiStartupMagic;
  words[1] = csAbiVersion;
  words[2] = startup.argv.length;
  words[3] = argvPointer;
  words[4] = startup.environment.length;
  words[5] = environmentPointer;
  words[6] = cwdPointer;
  words[7] = argumentPointers[0]!;
  words[8] = credentials.effectiveUserId;
  words[9] = credentials.effectiveGroupId;
  words[10] = heapBaseBytes;
  words[11] = heapWords;
  words[12] = startupAddress + 14 * 4;
  words[13] = heapBaseBytes - startupAddress;
  words[14] = 0;

  return Object.freeze({
    environment: new Map(environment),
    heapBaseBytes,
    heapWords,
    image: Object.freeze({
      segments: Object.freeze([
        Object.freeze({ address: startupAddress, words: Object.freeze(words) }),
      ]),
      stackArguments: Object.freeze([startup.argv.length, argvPointer]),
    }),
    startupAddress,
    startupBytes: heapBaseBytes - startupAddress,
  });
}

function prepareByteCsAbiStartup(
  requirements: Extract<
    Cs486ExecutableMemoryRequirements,
    { readonly kind: "declared" }
  >,
  startup: CsAbiHostedStartup,
  credentials: ProcessCredentials,
  environment: ReadonlyMap<string, string>,
): PreparedCsAbiStartup {
  const startupAddress = requirements.alignedDataBytes;
  const argvTableIndex = startupHeaderWords;
  const environmentTableIndex = argvTableIndex + startup.argv.length + 1;
  const bytes = Array<number>(
    (environmentTableIndex + startup.environment.length + 1) * 4,
  ).fill(0);
  const appendString = (value: string): number => {
    const address = startupAddress + bytes.length;
    for (const character of value) {
      const codePoint = character.codePointAt(0)!;
      if (codePoint > 0xff)
        throw new RangeError(
          "CS byte-profile startup strings require single-byte characters",
        );
      bytes.push(codePoint);
    }
    bytes.push(0);
    if (bytes.length > csAbiLimits.startupBytes)
      throw new RangeError("CS ABI aggregate startup byte limit exceeded");
    return address;
  };
  const argumentPointers = startup.argv.map(appendString);
  const environmentPointers = startup.environment.map(([name, value]) =>
    appendString(`${name}=${value}`),
  );
  const cwdPointer = appendString(startup.cwd);
  const writeInt32 = (word: number, value: number): void => {
    const offset = word * 4;
    const unsigned = value >>> 0;
    for (let byte = 0; byte < 4; byte += 1)
      bytes[offset + byte] = (unsigned >>> (byte * 8)) & 0xff;
  };
  for (const [index, pointer] of argumentPointers.entries())
    writeInt32(argvTableIndex + index, pointer);
  for (const [index, pointer] of environmentPointers.entries())
    writeInt32(environmentTableIndex + index, pointer);
  const argvPointer = startupAddress + argvTableIndex * 4;
  const environmentPointer = startupAddress + environmentTableIndex * 4;
  const heapBaseBytes = align(startupAddress + bytes.length, 16);
  const heapEndBytes = requirements.alignedDataBytes + requirements.heapBytes;
  if (heapBaseBytes > heapEndBytes)
    throw new RangeError("CS ABI startup block exceeds declared heap");
  const heapWords = Math.floor((heapEndBytes - heapBaseBytes) / 4);
  const header = [
    csAbiStartupMagic,
    csAbiVersion,
    startup.argv.length,
    argvPointer,
    startup.environment.length,
    environmentPointer,
    cwdPointer,
    argumentPointers[0]!,
    credentials.effectiveUserId,
    credentials.effectiveGroupId,
    heapBaseBytes,
    heapWords,
    startupAddress + 14 * 4,
    heapBaseBytes - startupAddress,
    0,
  ];
  for (const [index, value] of header.entries()) writeInt32(index, value);
  return Object.freeze({
    environment: new Map(environment),
    heapBaseBytes,
    heapWords,
    image: Object.freeze({
      segments: Object.freeze([
        Object.freeze({
          address: startupAddress,
          bytes: Object.freeze(bytes),
          words: Object.freeze([]),
        }),
      ]),
      stackArguments: Object.freeze([startup.argv.length, argvPointer]),
    }),
    startupAddress,
    startupBytes: heapBaseBytes - startupAddress,
  });
}

export class CsAbiRuntime {
  private closed = false;
  private cwd: string;
  private readonly descriptors = new Map<number, OpenFile>();
  private readonly directories = new Map<number, OpenDirectory>();
  private readonly keys: number[] = [];
  private outputWords = 0;
  private presentedRawFrame = false;
  private stdoutBuffer = "";
  private standardInputCursor = 0;
  private standardInputUnits: readonly number[] | undefined;

  constructor(private readonly options: CsAbiRuntimeOptions) {
    this.cwd = options.cwd;
  }

  get usedRawFramePresentation(): boolean {
    return this.presentedRawFrame;
  }

  readonly syscallHandler: Cs486SyscallHandler = (
    name,
    context,
  ): Cs486SyscallResult => {
    if (name !== "cs") return completeErrno(context, csAbiErrno.eperm);
    if (this.closed) return completeErrno(context, csAbiErrno.eio);
    try {
      return this.dispatch(context);
    } catch (error: unknown) {
      return completeErrno(context, errnoFor(error));
    }
  };

  enqueueKeyBatch(encoded: string): number | undefined {
    let decoded: unknown;
    try {
      decoded = JSON.parse(encoded);
    } catch {
      return undefined;
    }
    if (
      !Array.isArray(decoded) ||
      decoded.length < 1 ||
      decoded.length > 32 ||
      !decoded.every((value) => typeof value === "string" && value.length <= 32)
    ) {
      return undefined;
    }
    const codes = decoded.map((value) => keycode(value as string));
    if (
      // Zero is the ABI's "no key available" value for poll and for a spurious
      // wait resume, so a NUL code point is malformed transport input here.
      codes.some((code) => code === undefined || code === 0) ||
      this.keys.length + codes.length > csAbiLimits.keyFifo
    ) {
      return undefined;
    }
    this.keys.push(...(codes as number[]));
    return codes.length;
  }

  rollbackKeyBatch(count: number): void {
    if (!Number.isSafeInteger(count) || count < 0 || count > this.keys.length) {
      throw new RangeError("invalid CS ABI key rollback count");
    }
    this.keys.splice(this.keys.length - count, count);
  }

  finalize(): void {
    if (this.closed) return;
    this.closed = true;
    this.flushStdout();
    this.descriptors.clear();
    this.directories.clear();
    this.keys.length = 0;
  }

  private dispatch(context: Cs486SyscallContext): Cs486SyscallResult {
    const selector = context.readRegister("ebx");
    switch (selector) {
      case csAbiSelectors.exit:
        return {
          kind: "complete",
          value: normalizeExitStatus(context.readRegister("ecx")),
        };
      case csAbiSelectors.termSize:
        context.writeRegister(
          "eax",
          this.options.terminal.width | (this.options.terminal.height << 16),
        );
        return { kind: "continue" };
      case csAbiSelectors.termPresent:
        return this.present(context);
      case csAbiSelectors.keyWait:
        return this.waitKey(context);
      case csAbiSelectors.keyPoll:
        context.writeRegister("eax", this.keys.shift() ?? 0);
        return { kind: "continue" };
      case csAbiSelectors.clockTicks:
        context.writeRegister("eax", this.options.currentTick());
        return { kind: "continue" };
      case csAbiSelectors.sleepTicks: {
        const ticks = context.readRegister("ecx");
        if (!Number.isSafeInteger(ticks) || ticks < 0 || ticks > 1_000_000) {
          return completeErrno(context, csAbiErrno.einval);
        }
        return {
          kind: "sleep",
          resume: () => context.writeRegister("eax", 0),
          ticks,
        };
      }
      case csAbiSelectors.heapInfo:
        if (context.readRegister("ecx") !== 0)
          requireMemoryRange(context, context.readRegister("ecx"), 1);
        if (context.readRegister("edx") !== 0)
          requireMemoryRange(context, context.readRegister("edx"), 1);
        if (context.readRegister("ecx") !== 0)
          context.writeInt32(
            context.readRegister("ecx"),
            this.options.heapWords,
          );
        if (context.readRegister("edx") !== 0)
          context.writeInt32(
            context.readRegister("edx"),
            this.options.startupAddress,
          );
        context.writeRegister("eax", this.options.heapBaseBytes);
        context.writeRegister("edx", this.options.heapWords);
        context.writeRegister("esi", this.options.startupAddress);
        return { kind: "continue" };
      case csAbiSelectors.fsOpen:
        return this.open(context);
      case csAbiSelectors.fsRead:
        return this.read(context);
      case csAbiSelectors.fsWrite:
        return this.write(context);
      case csAbiSelectors.fsSeek:
        return this.seek(context);
      case csAbiSelectors.fsStat:
        return this.stat(context);
      case csAbiSelectors.fsClose:
        return this.close(context);
      case csAbiSelectors.fsRemove:
        return this.remove(context);
      case csAbiSelectors.fsRename:
        return this.rename(context);
      case csAbiSelectors.wallTime:
        return this.wallTime(context);
      case csAbiSelectors.fsGetcwd:
        return this.getcwd(context);
      case csAbiSelectors.fsChdir:
        return this.chdir(context);
      case csAbiSelectors.fsMkdir:
        return this.mkdir(context);
      case csAbiSelectors.fsRmdir:
        return this.rmdir(context);
      case csAbiSelectors.fsAccess:
        return this.access(context);
      case csAbiSelectors.fsOpenDir:
        return this.openDirectory(context);
      case csAbiSelectors.fsReadDir:
        return this.readDirectory(context);
      case csAbiSelectors.fsCloseDir:
        return this.closeDirectory(context);
      case csAbiSelectors.fsStatExtended:
        return this.statExtended(context);
      default:
        return completeErrno(context, csAbiErrno.einval);
    }
  }

  private present(context: Cs486SyscallContext): Cs486SyscallResult {
    this.presentedRawFrame = true;
    const pointer = context.readRegister("ecx");
    const packedDimensions = context.readRegister("edx") >>> 0;
    const width = packedDimensions & 0xffff;
    const height = packedDimensions >>> 16;
    const packedCursor = context.readRegister("esi") >>> 0;
    const cursorX = (packedCursor & 0xff) + 1;
    const cursorY = ((packedCursor >>> 8) & 0xff) + 1;
    const blink = (packedCursor & 0x1_00_00) !== 0;
    if (
      width < 1 ||
      width > this.options.terminal.width ||
      height < 1 ||
      height > this.options.terminal.height ||
      width * height > csAbiLimits.framebufferCells ||
      cursorX > width ||
      cursorY > height
    ) {
      return completeErrno(context, csAbiErrno.einval);
    }
    requireMemoryRange(context, pointer, width * height);
    let frameErrno: number | undefined;
    const ran = this.options.runHostWork("terminal", 1, () => {
      const rows: TerminalCell[][] = [];
      for (let y = 0; y < height; y += 1) {
        const row: TerminalCell[] = [];
        for (let x = 0; x < width; x += 1) {
          const word = context.readInt32(pointer + (y * width + x) * 4) >>> 0;
          const codePoint = word & 0xffff;
          if (
            codePoint === 0 ||
            codePoint === 10 ||
            codePoint === 13 ||
            (codePoint >= 0xd8_00 && codePoint <= 0xdf_ff)
          ) {
            frameErrno = csAbiErrno.einval;
            return;
          }
          row.push({
            background: (word >>> 20) & 0xf,
            character: String.fromCodePoint(codePoint),
            foreground: (word >>> 16) & 0xf,
          });
        }
        rows.push(row);
      }
      this.options.terminal.applyFrame(rows, {
        blink,
        x: cursorX,
        y: cursorY,
      });
    });
    if (!ran) return completeErrno(context, csAbiErrno.eagain);
    return frameErrno === undefined
      ? completeSuccess(context, 0)
      : completeErrno(context, frameErrno);
  }

  private waitKey(context: Cs486SyscallContext): Cs486SyscallResult {
    const available = this.keys.shift();
    if (available !== undefined) return completeSuccess(context, available);
    return {
      filter: "terminal_keys",
      kind: "wait_event",
      resume: (): void => {
        // A blocking key wait must never hand the guest a fabricated errno: a
        // guest that treats a negative result as fatal would exit on a wakeup it
        // never asked for. An empty FIFO here is the ABI's "no key" value, the
        // same one poll returns, so the guest simply waits again.
        context.writeRegister("eax", this.keys.shift() ?? 0);
      },
    };
  }

  private open(context: Cs486SyscallContext): Cs486SyscallResult {
    if (this.descriptors.size >= csAbiLimits.fileDescriptors) {
      return completeErrno(context, csAbiErrno.emfile);
    }
    const path = this.resolvePath(
      readWordString(context, context.readRegister("ecx")),
    );
    const flags = context.readRegister("edx");
    const readable = (flags & openRead) !== 0;
    const writable = (flags & openWrite) !== 0;
    const allowedFlags =
      openRead |
      openWrite |
      openCreate |
      openTruncate |
      openAppend |
      openExclusive;
    if (
      (!readable && !writable) ||
      (flags & ~allowedFlags) !== 0 ||
      ((flags & (openCreate | openTruncate | openAppend | openExclusive)) !==
        0 &&
        !writable) ||
      ((flags & openExclusive) !== 0 && (flags & openCreate) === 0)
    ) {
      return completeErrno(context, csAbiErrno.einval);
    }
    const mode = context.readRegister("esi") & 0o777;
    const dataModel = contextDataModel(context);
    let position = 0;
    const ran = this.options.runHostWork("block_io", 1, () => {
      this.options.filesystem.transaction(() => {
        const exists = this.options.filesystem.exists(path);
        if (exists && (flags & openExclusive) !== 0) {
          throw new CsAbiGuestError(csAbiErrno.eexist, "file already exists");
        }
        if (!exists && (flags & openCreate) === 0) {
          throw new CsAbiGuestError(csAbiErrno.enoent, "file does not exist");
        }
        if (exists && this.options.filesystem.isDirectory(path)) {
          throw new CsAbiGuestError(
            csAbiErrno.einval,
            "cannot open a directory as a file",
          );
        }
        if (!exists) {
          if (dataModel === cs486Byte8DataModel)
            this.options.filesystem.writeFileBytes(
              path,
              new Uint8Array(),
              mode || 0o666,
            );
          else this.options.filesystem.writeFile(path, "", mode || 0o666);
        } else if ((flags & openTruncate) !== 0) {
          if (dataModel === cs486Byte8DataModel)
            this.options.filesystem.writeFileBytes(path, new Uint8Array());
          else this.options.filesystem.writeFile(path, "");
        }
        if ((flags & openAppend) !== 0) {
          position =
            dataModel === cs486Byte8DataModel
              ? this.options.filesystem.readFileBytes(path).length
              : [...this.options.filesystem.readFile(path)].length;
        }
      });
    });
    if (!ran) return completeErrno(context, csAbiErrno.eagain);
    const descriptor = firstAvailableDescriptor(this.descriptors);
    this.descriptors.set(descriptor, {
      append: (flags & openAppend) !== 0,
      dataModel,
      path,
      position,
      readable,
      writable,
    });
    return completeSuccess(context, descriptor);
  }

  private read(context: Cs486SyscallContext): Cs486SyscallResult {
    const descriptor = context.readRegister("ecx");
    const pointer = context.readRegister("edx");
    const count = requireIoCount(context.readRegister("esi"));
    requireIoMemoryRange(context, pointer, count);
    if (descriptor === 0) {
      if (count === 0) return completeSuccess(context, 0);
      if (this.options.standardIo !== undefined) {
        return this.readStandardIo(context, pointer, count);
      }
      if (this.options.standardInput !== undefined) {
        const units = this.getStandardInputUnits(context);
        const available = units.slice(
          this.standardInputCursor,
          this.standardInputCursor + count,
        );
        for (const [index, value] of available.entries()) {
          writeGuestIoUnit(context, pointer, index, value);
        }
        this.standardInputCursor += available.length;
        return completeSuccess(context, available.length);
      }
      if (this.keys.length > 0)
        return completeSuccess(
          context,
          this.copyStdinUnits(context, pointer, count),
        );
      return {
        filter: "terminal_keys",
        kind: "wait_event",
        resume: (): void => {
          context.writeRegister(
            "eax",
            this.keys.length === 0
              ? -csAbiErrno.eagain
              : this.copyStdinUnits(context, pointer, count),
          );
        },
      };
    }
    const file = this.descriptors.get(descriptor);
    if (file === undefined || !file.readable) {
      return completeErrno(context, csAbiErrno.ebadf);
    }
    if (file.dataModel !== contextDataModel(context))
      return completeErrno(context, csAbiErrno.einval);
    let values: number[] = [];
    const ran = this.options.runHostWork("block_io", ioUnits(count), () => {
      if (file.dataModel === cs486Byte8DataModel) {
        values = [
          ...this.options.filesystem
            .readFileBytes(file.path)
            .slice(file.position, file.position + count),
        ];
      } else {
        const contents = [...this.options.filesystem.readFile(file.path)];
        values = contents
          .slice(file.position, file.position + count)
          .map((character) => character.codePointAt(0)!);
      }
    });
    if (!ran) return completeErrno(context, csAbiErrno.eagain);
    for (const [index, value] of values.entries())
      writeGuestIoUnit(context, pointer, index, value);
    file.position += values.length;
    return completeSuccess(context, values.length);
  }

  private write(context: Cs486SyscallContext): Cs486SyscallResult {
    const descriptor = context.readRegister("ecx");
    const pointer = context.readRegister("edx");
    const count = requireIoCount(context.readRegister("esi"));
    requireIoMemoryRange(context, pointer, count);
    const dataModel = contextDataModel(context);
    const values: number[] = [];
    let text = "";
    for (let index = 0; index < count; index += 1) {
      const codePoint = readGuestIoUnit(context, pointer, index);
      values.push(codePoint);
      if (
        codePoint > 0x10_ff_ff ||
        (codePoint >= 0xd8_00 && codePoint <= 0xdf_ff)
      ) {
        return completeErrno(context, csAbiErrno.einval);
      }
      text += String.fromCodePoint(codePoint);
    }
    if (descriptor === 1 || descriptor === 2) {
      if (this.options.standardIo !== undefined) {
        return this.writeStandardIo(context, descriptor, values);
      }
      if (this.outputWords + count > csAbiLimits.outputWords) {
        return completeErrno(context, csAbiErrno.enospc);
      }
      if (count === 0 && descriptor === 2) {
        return completeSuccess(context, 0);
      }
      if (count === 0 && this.stdoutBuffer.length === 0) {
        return completeSuccess(context, 0);
      }
      const ran = this.options.runHostWork("terminal", 1, () => {
        if (descriptor === 2) {
          this.emitOutput(2, text);
        } else if (count === 0) {
          this.flushStdout();
        } else {
          this.writeStdout(text);
        }
        this.outputWords += count;
      });
      return ran
        ? completeSuccess(context, count)
        : completeErrno(context, csAbiErrno.eagain);
    }
    const file = this.descriptors.get(descriptor);
    if (file === undefined || !file.writable) {
      return completeErrno(context, csAbiErrno.ebadf);
    }
    if (file.dataModel !== dataModel)
      return completeErrno(context, csAbiErrno.einval);
    const ran = this.options.runHostWork("block_io", ioUnits(count), () => {
      if (file.dataModel === cs486Byte8DataModel) {
        const current = [...this.options.filesystem.readFileBytes(file.path)];
        const position = file.append ? current.length : file.position;
        while (current.length < position) current.push(0);
        const next = [
          ...current.slice(0, position),
          ...values,
          ...current.slice(position + values.length),
        ];
        this.options.filesystem.writeFileBytes(file.path, new Uint8Array(next));
        file.position = position + values.length;
      } else {
        const current = [...this.options.filesystem.readFile(file.path)];
        const position = file.append ? current.length : file.position;
        while (current.length < position) current.push("\0");
        const characters = [...text];
        const next = [
          ...current.slice(0, position),
          ...characters,
          ...current.slice(position + characters.length),
        ].join("");
        this.options.filesystem.writeFile(file.path, next);
        file.position = position + characters.length;
      }
    });
    return ran
      ? completeSuccess(context, count)
      : completeErrno(context, csAbiErrno.eagain);
  }

  private seek(context: Cs486SyscallContext): Cs486SyscallResult {
    const file = this.descriptors.get(context.readRegister("ecx"));
    if (file === undefined) return completeErrno(context, csAbiErrno.ebadf);
    const offset = context.readRegister("edx");
    const whence = context.readRegister("esi");
    if (whence !== 0 && whence !== 1 && whence !== 2) {
      return completeErrno(context, csAbiErrno.einval);
    }
    let next = 0;
    const ran = this.options.runHostWork("block_io", 1, () => {
      const base =
        whence === 0
          ? 0
          : whence === 1
            ? file.position
            : file.dataModel === cs486Byte8DataModel
              ? this.options.filesystem.readFileBytes(file.path).length
              : [...this.options.filesystem.readFile(file.path)].length;
      next = base + offset;
      if (!Number.isSafeInteger(next) || next < 0) {
        throw new CsAbiGuestError(
          csAbiErrno.einval,
          "file position is invalid",
        );
      }
    });
    if (!ran) return completeErrno(context, csAbiErrno.eagain);
    file.position = next;
    return completeSuccess(context, next);
  }

  private stat(context: Cs486SyscallContext): Cs486SyscallResult {
    const path = this.resolvePath(
      readWordString(context, context.readRegister("ecx")),
    );
    const pointer = context.readRegister("edx");
    requireMemoryRange(context, pointer, 4);
    let values: readonly number[] = [];
    const ran = this.options.runHostWork("block_io", 1, () => {
      if (!this.options.filesystem.exists(path)) {
        throw new CsAbiGuestError(csAbiErrno.enoent, "path does not exist");
      }
      const stat = this.options.filesystem.stat(path);
      values = [
        stat.kind === "file" ? 1 : stat.kind === "directory" ? 2 : 3,
        stat.size,
        stat.metadata.mode,
        stat.metadata.modifiedAtMilliseconds,
      ];
    });
    if (!ran) return completeErrno(context, csAbiErrno.eagain);
    for (const [index, value] of values.entries()) {
      context.writeInt32(pointer + index * 4, value);
    }
    return completeSuccess(context, 0);
  }

  private close(context: Cs486SyscallContext): Cs486SyscallResult {
    const descriptor = context.readRegister("ecx");
    if (descriptor < 3 || !this.descriptors.delete(descriptor)) {
      return completeErrno(context, csAbiErrno.ebadf);
    }
    return completeSuccess(context, 0);
  }

  private remove(context: Cs486SyscallContext): Cs486SyscallResult {
    const path = this.resolvePath(
      readWordString(context, context.readRegister("ecx")),
    );
    const ran = this.options.runHostWork("block_io", 1, () => {
      if (!this.options.filesystem.exists(path)) {
        throw new CsAbiGuestError(csAbiErrno.enoent, "path does not exist");
      }
      this.options.filesystem.delete(path);
    });
    return ran
      ? completeSuccess(context, 0)
      : completeErrno(context, csAbiErrno.eagain);
  }

  private rename(context: Cs486SyscallContext): Cs486SyscallResult {
    const from = this.resolvePath(
      readWordString(context, context.readRegister("ecx")),
    );
    const to = this.resolvePath(
      readWordString(context, context.readRegister("edx")),
    );
    const ran = this.options.runHostWork("block_io", 1, () => {
      this.options.filesystem.transaction(() => {
        if (!this.options.filesystem.exists(from)) {
          throw new CsAbiGuestError(
            csAbiErrno.enoent,
            "source path does not exist",
          );
        }
        if (this.options.filesystem.exists(to))
          this.options.filesystem.delete(to);
        this.options.filesystem.move(from, to);
      });
    });
    return ran
      ? completeSuccess(context, 0)
      : completeErrno(context, csAbiErrno.eagain);
  }

  private wallTime(context: Cs486SyscallContext): Cs486SyscallResult {
    const seconds = Math.floor(
      this.options.currentWallTimeMilliseconds() / 1000,
    );
    if (
      !Number.isSafeInteger(seconds) ||
      seconds < -0x80_00_00_00 ||
      seconds > 0x7f_ff_ff_ff
    ) {
      return completeErrno(context, csAbiErrno.erange);
    }
    return completeSuccess(context, seconds);
  }

  private getcwd(context: Cs486SyscallContext): Cs486SyscallResult {
    const pointer = context.readRegister("ecx");
    const capacity = requireStringCapacity(context.readRegister("edx"));
    requireStringMemoryRange(context, pointer, capacity);
    const words = [...this.cwd].map((character) => character.codePointAt(0)!);
    if (words.length + 1 > capacity) {
      return completeErrno(context, csAbiErrno.erange);
    }
    writeGuestWordString(context, pointer, words);
    return completeSuccess(context, pointer);
  }

  private chdir(context: Cs486SyscallContext): Cs486SyscallResult {
    const path = this.resolvePath(
      readWordString(context, context.readRegister("ecx")),
    );
    const ran = this.options.runHostWork("block_io", 1, () => {
      if (!this.options.filesystem.exists(path)) {
        throw new CsAbiGuestError(
          csAbiErrno.enoent,
          "directory does not exist",
        );
      }
      if (!this.options.filesystem.isDirectory(path)) {
        throw new CsAbiGuestError(csAbiErrno.einval, "path is not a directory");
      }
      if (!this.options.filesystem.hasAccess(path, filesystemExecute)) {
        throw new CsAbiGuestError(
          csAbiErrno.eacces,
          "directory is not searchable",
        );
      }
    });
    if (!ran) return completeErrno(context, csAbiErrno.eagain);
    this.cwd = path;
    return completeSuccess(context, 0);
  }

  private mkdir(context: Cs486SyscallContext): Cs486SyscallResult {
    const path = this.resolvePath(
      readWordString(context, context.readRegister("ecx")),
    );
    const mode = context.readRegister("edx") & 0o777;
    const ran = this.options.runHostWork("block_io", 1, () => {
      if (this.options.filesystem.exists(path)) {
        throw new CsAbiGuestError(csAbiErrno.eexist, "path already exists");
      }
      this.options.filesystem.makeDirectory(path, mode || 0o777);
    });
    return ran
      ? completeSuccess(context, 0)
      : completeErrno(context, csAbiErrno.eagain);
  }

  private rmdir(context: Cs486SyscallContext): Cs486SyscallResult {
    const path = this.resolvePath(
      readWordString(context, context.readRegister("ecx")),
    );
    const ran = this.options.runHostWork("block_io", 1, () => {
      if (!this.options.filesystem.exists(path)) {
        throw new CsAbiGuestError(
          csAbiErrno.enoent,
          "directory does not exist",
        );
      }
      if (!this.options.filesystem.isDirectory(path)) {
        throw new CsAbiGuestError(csAbiErrno.einval, "path is not a directory");
      }
      this.options.filesystem.delete(path);
    });
    return ran
      ? completeSuccess(context, 0)
      : completeErrno(context, csAbiErrno.eagain);
  }

  private access(context: Cs486SyscallContext): Cs486SyscallResult {
    const path = this.resolvePath(
      readWordString(context, context.readRegister("ecx")),
    );
    const required = context.readRegister("edx");
    if (
      !Number.isInteger(required) ||
      required < 0 ||
      (required & ~0b111) !== 0
    ) {
      return completeErrno(context, csAbiErrno.einval);
    }
    const ran = this.options.runHostWork("block_io", 1, () => {
      if (!this.options.filesystem.exists(path)) {
        throw new CsAbiGuestError(csAbiErrno.enoent, "path does not exist");
      }
      if (
        required !== 0 &&
        !this.options.filesystem.hasAccess(path, required)
      ) {
        throw new CsAbiGuestError(csAbiErrno.eacces, "access denied");
      }
    });
    return ran
      ? completeSuccess(context, 0)
      : completeErrno(context, csAbiErrno.eagain);
  }

  private openDirectory(context: Cs486SyscallContext): Cs486SyscallResult {
    if (this.directories.size >= csAbiLimits.directoryDescriptors) {
      return completeErrno(context, csAbiErrno.emfile);
    }
    const path = this.resolvePath(
      readWordString(context, context.readRegister("ecx")),
    );
    let entries: readonly string[] = [];
    let revision = 0;
    const ran = this.options.runHostWork("block_io", 1, () => {
      if (!this.options.filesystem.exists(path)) {
        throw new CsAbiGuestError(
          csAbiErrno.enoent,
          "directory does not exist",
        );
      }
      if (!this.options.filesystem.isDirectory(path)) {
        throw new CsAbiGuestError(csAbiErrno.einval, "path is not a directory");
      }
      const snapshot = this.options.filesystem.list(path);
      if (snapshot.length > csAbiLimits.directoryEntries) {
        throw new CsAbiGuestError(
          csAbiErrno.enospc,
          "directory entry limit exceeded",
        );
      }
      for (const entry of snapshot) requireWordString(entry, "directory entry");
      entries = Object.freeze([...snapshot]);
      revision = this.options.filesystem.revision;
    });
    if (!ran) return completeErrno(context, csAbiErrno.eagain);
    const descriptor = firstAvailableDirectory(this.directories);
    this.directories.set(descriptor, { entries, position: 0, revision });
    return completeSuccess(context, descriptor);
  }

  private readDirectory(context: Cs486SyscallContext): Cs486SyscallResult {
    const directory = this.directories.get(context.readRegister("ecx"));
    if (directory === undefined) {
      return completeErrno(context, csAbiErrno.ebadf);
    }
    const pointer = context.readRegister("edx");
    const capacity = requireStringCapacity(context.readRegister("esi"));
    requireStringMemoryRange(context, pointer, capacity);
    if (directory.revision !== this.options.filesystem.revision) {
      return completeErrno(context, csAbiErrno.eagain);
    }
    const entry = directory.entries[directory.position];
    if (entry === undefined) return completeSuccess(context, 0);
    const words = [...entry].map((character) => character.codePointAt(0)!);
    if (words.length + 1 > capacity) {
      return completeErrno(context, csAbiErrno.erange);
    }
    writeGuestWordString(context, pointer, words);
    directory.position += 1;
    return completeSuccess(context, 1);
  }

  private closeDirectory(context: Cs486SyscallContext): Cs486SyscallResult {
    return this.directories.delete(context.readRegister("ecx"))
      ? completeSuccess(context, 0)
      : completeErrno(context, csAbiErrno.ebadf);
  }

  private statExtended(context: Cs486SyscallContext): Cs486SyscallResult {
    const path = this.resolvePath(
      readWordString(context, context.readRegister("ecx")),
    );
    const pointer = context.readRegister("edx");
    requireMemoryRange(context, pointer, 7);
    let values: readonly number[] = [];
    const ran = this.options.runHostWork("block_io", 1, () => {
      if (!this.options.filesystem.exists(path)) {
        throw new CsAbiGuestError(csAbiErrno.enoent, "path does not exist");
      }
      const stat = this.options.filesystem.stat(path);
      values = [
        stat.kind === "file" ? 1 : stat.kind === "directory" ? 2 : 3,
        stat.size,
        stat.metadata.mode,
        stat.metadata.modifiedAtMilliseconds,
        stat.metadata.uid,
        stat.metadata.gid,
        stat.linkCount,
      ];
    });
    if (!ran) return completeErrno(context, csAbiErrno.eagain);
    for (const [index, value] of values.entries()) {
      context.writeInt32(pointer + index * 4, value);
    }
    return completeSuccess(context, 0);
  }

  private resolvePath(path: string): string {
    return this.options.filesystem.normalize(
      path.startsWith("/")
        ? path
        : `${this.cwd === "/" ? "" : this.cwd}/${path}`,
    );
  }

  private copyStdinUnits(
    context: Cs486SyscallContext,
    pointer: number,
    count: number,
  ): number {
    const available = this.keys.splice(0, count);
    if (
      contextDataModel(context) === cs486Byte8DataModel &&
      available.some((code) => code < 0 || code > 0xff)
    ) {
      return -csAbiErrno.einval;
    }
    for (const [index, code] of available.entries())
      writeGuestIoUnit(context, pointer, index, code);
    return available.length;
  }

  private getStandardInputUnits(
    context: Cs486SyscallContext,
  ): readonly number[] {
    if (this.standardInputUnits !== undefined) return this.standardInputUnits;
    this.standardInputUnits =
      contextDataModel(context) === cs486Byte8DataModel
        ? [...encodeUtf8(this.options.standardInput ?? "")]
        : [...(this.options.standardInput ?? "")].map((character) =>
            character.codePointAt(0)!,
          );
    return this.standardInputUnits;
  }

  private readStandardIo(
    context: Cs486SyscallContext,
    pointer: number,
    count: number,
  ): Cs486SyscallResult {
    const standardIo = this.options.standardIo!;
    const attempt = (): boolean => {
      const read = standardIo.read(contextDataModel(context), count);
      if (read.kind === "would-block") return false;
      if (read.kind === "eof") {
        context.writeRegister("eax", 0);
        return true;
      }
      for (const [index, value] of read.units.entries()) {
        writeGuestIoUnit(context, pointer, index, value);
      }
      context.writeRegister("eax", read.units.length);
      return true;
    };
    if (attempt()) return { kind: "continue" };
    return {
      filter: "csabi_fd0",
      kind: "wait_event",
      resume: (): void => {
        if (!attempt()) context.writeRegister("eax", -csAbiErrno.eagain);
      },
    };
  }

  private writeStandardIo(
    context: Cs486SyscallContext,
    descriptor: 1 | 2,
    values: readonly number[],
  ): Cs486SyscallResult {
    if (this.outputWords + values.length > csAbiLimits.outputWords) {
      return completeErrno(context, csAbiErrno.enospc);
    }
    const standardIo = this.options.standardIo!;
    const attempt = (): boolean => {
      const written = standardIo.write(
        descriptor,
        contextDataModel(context),
        values,
      );
      if (written.kind === "would-block") return false;
      if (written.kind === "broken-pipe") {
        context.writeRegister("eax", -csAbiErrno.epipe);
        return true;
      }
      this.outputWords += written.unitsWritten;
      context.writeRegister("eax", written.unitsWritten);
      return true;
    };
    if (attempt()) return { kind: "continue" };
    return {
      filter: `csabi_fd${String(descriptor)}`,
      kind: "wait_event",
      resume: (): void => {
        if (!attempt()) context.writeRegister("eax", -csAbiErrno.eagain);
      },
    };
  }

  private emitOutput(descriptor: 1 | 2, text: string): void {
    if (this.options.outputObserver === undefined) {
      writeTerminalText(this.options.terminal, text);
    } else {
      this.options.outputObserver(descriptor, text);
    }
  }

  private writeStdout(text: string): void {
    this.stdoutBuffer += text;
    const finalNewline = this.stdoutBuffer.lastIndexOf("\n");
    if (finalNewline < 0) return;
    this.emitOutput(1, this.stdoutBuffer.slice(0, finalNewline + 1));
    this.stdoutBuffer = this.stdoutBuffer.slice(finalNewline + 1);
  }

  private flushStdout(): void {
    if (this.stdoutBuffer.length === 0) return;
    this.emitOutput(1, this.stdoutBuffer);
    this.stdoutBuffer = "";
  }
}

/**
 * Heap placement a batch process reads through `heapInfo`. The host builds the
 * startup image before the process exists, so all three values are already
 * decided and stay constant for its whole life; the handler only reports them.
 */
export interface CsAbiBatchHeapLayout {
  readonly heapBaseBytes: number;
  readonly heapWords: number;
  readonly startupAddress: number;
}

/**
 * `Cs486SyscallHandler` tagged as the isolated batch policy.
 *
 * Ownership boundaries that must refuse a terminal-backed `CsAbiRuntime`
 * handler test this tag instead of comparing against one particular function
 * identity, so a batch process and a fully rejected process can both satisfy
 * the same guard.
 */
export interface CsAbiBatchSyscallHandler extends Cs486SyscallHandler {
  readonly isolatedCsAbi: true;
}

export function isCsAbiBatchSyscallHandler(
  handler: Cs486SyscallHandler | undefined,
): handler is CsAbiBatchSyscallHandler {
  return (
    handler !== undefined &&
    (handler as Partial<CsAbiBatchSyscallHandler>).isolatedCsAbi === true
  );
}

/** Rejection of an operation a batch process is not allowed to reach. */
class CsAbiBatchRejection extends Error {
  constructor(readonly fault: Cs486Fault) {
    super(fault.message);
    this.name = "CsAbiBatchRejection";
  }
}

/**
 * CS ABI policy for a process that runs with no OS services attached.
 *
 * A batch process executes wherever the host schedules it, including a managed
 * compute worker that has no guest filesystem, terminal, scheduler, or clock.
 * Only the three operations whose entire effect stays inside the process are
 * serviced:
 *
 * - `exit` completes with the normalized status, exactly as `CsAbiRuntime`.
 * - `heapInfo` reports the placement the host already committed to. It is a
 *   pure read of create-time values, so it cannot depend on where it runs.
 * - `fsWrite` on fd 1 and fd 2 appends to the process's own output stream.
 *
 * Every other selector, every other descriptor, and every non-`cs` syscall
 * raises `UnsupportedOperationError`. Nothing is approximated: a batch process
 * that reaches for a file, a key, or the clock fails with a guest-visible fault
 * naming the operation, and the caller re-runs it without batch mode.
 *
 * Unlike `CsAbiRuntime`, fd 1 is not line buffered and fd 2 is not a separate
 * sink. Both descriptors append to one ordered stream in exact write order,
 * which is what the process already does for its `print` opcodes. That removes
 * any buffered remainder, so terminating a batch process cannot drop output it
 * already accepted.
 */
export function createCsAbiBatchSyscallHandler(
  layout: CsAbiBatchHeapLayout,
  appendOutput: (text: string) => void,
): CsAbiBatchSyscallHandler {
  let outputWords = 0;
  const handler = (
    name: string,
    context: Cs486SyscallContext,
  ): Cs486SyscallResult => {
    if (name !== "cs") return completeErrno(context, csAbiErrno.eperm);
    try {
      switch (context.readRegister("ebx")) {
        case csAbiSelectors.exit:
          return {
            kind: "complete",
            value: normalizeExitStatus(context.readRegister("ecx")),
          };
        case csAbiSelectors.heapInfo:
          return batchHeapInfo(context, layout);
        case csAbiSelectors.fsWrite: {
          const written = batchWrite(context, appendOutput, outputWords);
          outputWords = written.outputWords;
          return written.result;
        }
        default:
          throw rejectBatchOperation(
            `CS ABI operation ${String(context.readRegister("ebx"))}`,
          );
      }
    } catch (error: unknown) {
      // A rejection is the batch contract failing, not a guest errno: it must
      // reach the process as the fault it is. Everything else keeps the
      // production mapping so a serviced operation reports the same errno it
      // would report under CsAbiRuntime.
      if (error instanceof CsAbiBatchRejection) throw error.fault;
      return completeErrno(context, errnoFor(error));
    }
  };
  return Object.assign(handler, { isolatedCsAbi: true as const });
}

/** A batch handler whose output sink is supplied after construction. */
export interface AttachableCsAbiBatchSyscallHandler {
  readonly attach: (sink: (text: string) => void) => void;
  readonly handler: CsAbiBatchSyscallHandler;
}

/**
 * Batch handler for a caller that owns the output buffer it writes into.
 *
 * Every host that runs a batch process - the shell session, MCP, the local
 * runtime path, and both compute-worker engines - has to build the handler
 * before the process that accumulates output, so the sink
 * cannot be a construction argument. `attach` runs immediately after that
 * construction and strictly before any slice, which makes an unattached sink a
 * host defect rather than a state a guest can reach.
 */
export function createAttachableCsAbiBatchSyscallHandler(
  layout: CsAbiBatchHeapLayout,
): AttachableCsAbiBatchSyscallHandler {
  let sink: ((text: string) => void) | undefined;
  return {
    attach: (next: (text: string) => void): void => {
      sink = next;
    },
    handler: createCsAbiBatchSyscallHandler(layout, (text) => {
      if (sink === undefined)
        throw new Error("Batch CS ABI output sink is not attached");
      sink(text);
    }),
  };
}

function rejectBatchOperation(operation: string): CsAbiBatchRejection {
  return new CsAbiBatchRejection(
    new Cs486Fault(
      "UnsupportedOperationError",
      `batch process cannot use ${operation}; re-run this program without batch mode`,
    ),
  );
}

function batchHeapInfo(
  context: Cs486SyscallContext,
  layout: CsAbiBatchHeapLayout,
): Cs486SyscallResult {
  if (context.readRegister("ecx") !== 0)
    requireMemoryRange(context, context.readRegister("ecx"), 1);
  if (context.readRegister("edx") !== 0)
    requireMemoryRange(context, context.readRegister("edx"), 1);
  if (context.readRegister("ecx") !== 0)
    context.writeInt32(context.readRegister("ecx"), layout.heapWords);
  if (context.readRegister("edx") !== 0)
    context.writeInt32(context.readRegister("edx"), layout.startupAddress);
  context.writeRegister("eax", layout.heapBaseBytes);
  context.writeRegister("edx", layout.heapWords);
  context.writeRegister("esi", layout.startupAddress);
  return { kind: "continue" };
}

function batchWrite(
  context: Cs486SyscallContext,
  appendOutput: (text: string) => void,
  outputWords: number,
): { readonly outputWords: number; readonly result: Cs486SyscallResult } {
  const descriptor = context.readRegister("ecx");
  const pointer = context.readRegister("edx");
  const count = requireIoCount(context.readRegister("esi"));
  requireIoMemoryRange(context, pointer, count);
  let text = "";
  for (let index = 0; index < count; index += 1) {
    const codePoint = readGuestIoUnit(context, pointer, index);
    if (
      codePoint > 0x10_ff_ff ||
      (codePoint >= 0xd8_00 && codePoint <= 0xdf_ff)
    )
      return { outputWords, result: completeErrno(context, csAbiErrno.einval) };
    text += String.fromCodePoint(codePoint);
  }
  if (descriptor !== 1 && descriptor !== 2)
    throw rejectBatchOperation(`file descriptor ${String(descriptor)}`);
  if (outputWords + count > csAbiLimits.outputWords)
    return { outputWords, result: completeErrno(context, csAbiErrno.enospc) };
  appendOutput(text);
  return {
    outputWords: outputWords + count,
    result: completeSuccess(context, count),
  };
}

export function writeTerminalText(
  terminal: TerminalBuffer,
  text: string,
): void {
  const newline = (): void => {
    if (terminal.cursorY >= terminal.height) terminal.scroll(1);
    terminal.setCursorPosition(
      1,
      Math.min(terminal.height, terminal.cursorY + 1),
    );
  };
  for (const character of text) {
    if (character === "\r") {
      terminal.setCursorPosition(1, terminal.cursorY);
      continue;
    }
    if (character === "\n") {
      newline();
      continue;
    }
    if (terminal.cursorX > terminal.width) newline();
    terminal.write(character);
  }
}

function requireWordString(value: string, name: string): void {
  const words = [...value];
  if (value.includes("\0") || words.length + 1 > csAbiLimits.perStringWords) {
    throw new RangeError(`${name} exceeds the CS ABI word-string limit`);
  }
}

function readWordString(context: Cs486SyscallContext, pointer: number): string {
  if (contextDataModel(context) === cs486Byte8DataModel) {
    requireStringMemoryRange(context, pointer, 1);
    let result = "";
    for (let index = 0; index < csAbiLimits.perStringWords; index += 1) {
      requireStringMemoryRange(context, pointer + index, 1);
      const value = readGuestByte(context, pointer + index);
      if (value === 0) return result;
      result += String.fromCodePoint(value);
    }
    throw new CsAbiGuestError(
      csAbiErrno.einval,
      "unterminated CS ABI byte string",
    );
  }
  requireMemoryRange(context, pointer, 1);
  let result = "";
  for (let index = 0; index < csAbiLimits.perStringWords; index += 1) {
    requireMemoryRange(context, pointer + index * 4, 1);
    const value = context.readInt32(pointer + index * 4) >>> 0;
    if (value === 0) return result;
    if (value > 0x10_ff_ff || (value >= 0xd8_00 && value <= 0xdf_ff)) {
      throw new CsAbiGuestError(
        csAbiErrno.einval,
        "invalid CS ABI word string",
      );
    }
    result += String.fromCodePoint(value);
  }
  throw new CsAbiGuestError(
    csAbiErrno.einval,
    "unterminated CS ABI word string",
  );
}

function contextDataModel(context: Cs486SyscallContext): Cs486DataModel {
  return context.dataModel ?? cs486Word32DataModel;
}

function readGuestByte(context: Cs486SyscallContext, address: number): number {
  if (context.readUint8 === undefined) {
    throw new CsAbiGuestError(
      csAbiErrno.efault,
      "CS ABI byte-profile memory access is unavailable",
    );
  }
  return context.readUint8(address);
}

function writeGuestByte(
  context: Cs486SyscallContext,
  address: number,
  value: number,
): void {
  if (context.writeUint8 === undefined) {
    throw new CsAbiGuestError(
      csAbiErrno.efault,
      "CS ABI byte-profile memory access is unavailable",
    );
  }
  context.writeUint8(address, value & 0xff);
}

function requireMemoryRange(
  context: Cs486SyscallContext,
  pointer: number,
  words: number,
): void {
  const bytes = words * 4;
  if (
    !Number.isSafeInteger(pointer) ||
    pointer < 0 ||
    pointer % 4 !== 0 ||
    !Number.isSafeInteger(words) ||
    words < 0 ||
    !Number.isSafeInteger(pointer + bytes) ||
    pointer + bytes > context.memoryLimitBytes
  ) {
    throw new CsAbiGuestError(
      csAbiErrno.efault,
      "CS ABI guest memory range is invalid",
    );
  }
}

function requireByteMemoryRange(
  context: Cs486SyscallContext,
  pointer: number,
  bytes: number,
): void {
  if (
    !Number.isSafeInteger(pointer) ||
    pointer < 0 ||
    !Number.isSafeInteger(bytes) ||
    bytes < 0 ||
    !Number.isSafeInteger(pointer + bytes) ||
    pointer + bytes > context.memoryLimitBytes
  ) {
    throw new CsAbiGuestError(
      csAbiErrno.efault,
      "CS ABI guest byte range is invalid",
    );
  }
}

function requireIoMemoryRange(
  context: Cs486SyscallContext,
  pointer: number,
  count: number,
): void {
  if (contextDataModel(context) === cs486Byte8DataModel)
    requireByteMemoryRange(context, pointer, count);
  else requireMemoryRange(context, pointer, count);
}

function requireStringMemoryRange(
  context: Cs486SyscallContext,
  pointer: number,
  capacity: number,
): void {
  requireIoMemoryRange(context, pointer, capacity);
}

function readGuestIoUnit(
  context: Cs486SyscallContext,
  pointer: number,
  index: number,
): number {
  return contextDataModel(context) === cs486Byte8DataModel
    ? readGuestByte(context, pointer + index)
    : context.readInt32(pointer + index * 4) >>> 0;
}

function writeGuestIoUnit(
  context: Cs486SyscallContext,
  pointer: number,
  index: number,
  value: number,
): void {
  if (contextDataModel(context) === cs486Byte8DataModel)
    writeGuestByte(context, pointer + index, value);
  else context.writeInt32(pointer + index * 4, value);
}

function requireIoCount(value: number): number {
  if (
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > csAbiLimits.ioWords
  ) {
    throw new CsAbiGuestError(
      csAbiErrno.einval,
      "CS ABI I/O word count limit exceeded",
    );
  }
  return value;
}

function requireStringCapacity(value: number): number {
  if (
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > csAbiLimits.perStringWords
  ) {
    throw new CsAbiGuestError(
      csAbiErrno.einval,
      "CS ABI word-string capacity is invalid",
    );
  }
  return value;
}

function writeGuestWordString(
  context: Cs486SyscallContext,
  pointer: number,
  words: readonly number[],
): void {
  if (contextDataModel(context) === cs486Byte8DataModel) {
    if (
      words.some((word) => !Number.isInteger(word) || word < 0 || word > 0xff)
    )
      throw new CsAbiGuestError(
        csAbiErrno.einval,
        "CS ABI byte string contains a non-byte character",
      );
    for (const [index, word] of words.entries())
      writeGuestByte(context, pointer + index, word);
    writeGuestByte(context, pointer + words.length, 0);
    return;
  }
  for (const [index, word] of words.entries()) {
    context.writeInt32(pointer + index * 4, word);
  }
  context.writeInt32(pointer + words.length * 4, 0);
}

function completeSuccess(
  context: Cs486SyscallContext,
  value: number,
): Cs486SyscallResult {
  context.writeRegister("eax", value);
  return { kind: "continue" };
}

function completeErrno(
  context: Cs486SyscallContext,
  errno: number,
): Cs486SyscallResult {
  context.writeRegister("eax", -errno);
  return { kind: "continue" };
}

function errnoFor(error: unknown): number {
  if (error instanceof CsAbiGuestError) return error.errno;
  if (error instanceof FilesystemError) {
    switch (error.code) {
      case "not_found":
        return csAbiErrno.enoent;
      case "permission_denied":
      case "protected":
        return csAbiErrno.eacces;
      case "capacity":
      case "file_limit":
      case "path_limit":
        return csAbiErrno.enospc;
      case "exists":
      case "invalid_path":
      case "is_directory":
      case "not_directory":
        return csAbiErrno.einval;
      default:
        return csAbiErrno.eio;
    }
  }
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  if (message.includes("permission") || message.includes("access")) {
    return csAbiErrno.eacces;
  }
  if (
    message.includes("space") ||
    message.includes("capacity") ||
    message.includes("limit")
  ) {
    return csAbiErrno.enospc;
  }
  if (error instanceof RangeError || error instanceof TypeError) {
    return csAbiErrno.efault;
  }
  return csAbiErrno.eio;
}

function firstAvailableDescriptor(
  descriptors: ReadonlyMap<number, OpenFile>,
): number {
  for (
    let descriptor = 3;
    descriptor < 3 + csAbiLimits.fileDescriptors;
    descriptor += 1
  ) {
    if (!descriptors.has(descriptor)) return descriptor;
  }
  throw new Error("CS ABI file descriptor table is full");
}

function firstAvailableDirectory(
  directories: ReadonlyMap<number, OpenDirectory>,
): number {
  for (
    let descriptor = 1;
    descriptor <= csAbiLimits.directoryDescriptors;
    descriptor += 1
  ) {
    if (!directories.has(descriptor)) return descriptor;
  }
  throw new Error("CS ABI directory descriptor table is full");
}

function ioUnits(words: number): number {
  return Math.max(1, Math.min(256, Math.ceil(words / 16)));
}

function keycode(value: string): number | undefined {
  const named: Readonly<Record<string, number>> = {
    ArrowDown: csAbiKeycodes.arrowDown,
    ArrowLeft: csAbiKeycodes.arrowLeft,
    ArrowRight: csAbiKeycodes.arrowRight,
    ArrowUp: csAbiKeycodes.arrowUp,
    Backspace: csAbiKeycodes.backspace,
    Delete: csAbiKeycodes.delete,
    End: csAbiKeycodes.end,
    Enter: csAbiKeycodes.enter,
    Escape: csAbiKeycodes.escape,
    Home: csAbiKeycodes.home,
    PageDown: csAbiKeycodes.pageDown,
    PageUp: csAbiKeycodes.pageUp,
    Tab: csAbiKeycodes.tab,
  };
  const known = named[value];
  if (known !== undefined) return known;
  const characters = [...value];
  return characters.length === 1 ? characters[0]!.codePointAt(0) : undefined;
}

function normalizeExitStatus(value: number): number {
  return Number.isInteger(value) ? value & 0xff : 1;
}

function align(value: number, alignment: number): number {
  return Math.ceil(value / alignment) * alignment;
}
