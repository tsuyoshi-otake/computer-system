import { encodeUtf8, utf8ByteLength } from "../../domain/text/utf8.js";
import type { SynchronousTransactionOperation } from "../../domain/filesystem/inMemoryFilesystem.js";
import {
  DosPathError,
  linuxRootDefaultPath,
  linuxUserDefaultPath,
  type OsProfile,
} from "./osProfile.js";
import type { ShellClockSource } from "./clock.js";
import type { ComputerHardwareProfile } from "../../domain/computer/hardware.js";
import type {
  DosGuestMemoryRegionSnapshot,
  DosGuestMemorySnapshot,
} from "./dosGuestMemoryManager.js";
import type { LinuxGuestMemorySnapshot } from "./linuxGuestMemoryManager.js";
import type { VirtualDevice } from "./osProfile.js";
import { formatOsIdentity } from "./osIdentity.js";
import {
  cs486ExecutableDataModel,
  runCs486,
  validateCs486Executable,
  type Cs486Executable,
} from "../../domain/cpu/cs486.js";
import { cpuModelSpecification } from "../../domain/cpu/models.js";
import {
  cs486Byte8DataModel,
  cs486Word32DataModel,
  type Cs486DataModel,
} from "../../domain/cpu/cs486Compatibility.js";
import type { CpuMicroarchitectureStats } from "../../domain/cpu/memoryHierarchy.js";
import { cpuCyclesToMicroseconds } from "../../domain/cpu/timing.js";
import { TerminalBuffer } from "../../domain/terminal/terminalBuffer.js";
import { CsAbiRuntime, prepareCsAbiStartup } from "../runtime/csAbi.js";
import {
  assembleCs486,
  assembleCs486Object,
  Cs486CompileError,
  type Cs486AssemblerOptions,
} from "../toolchain/cs486Assembler.js";
import {
  cs486ObjectDataModel,
  validateCs486Object,
  type Cs486Object,
} from "../../domain/cpu/cs486Object.js";
import {
  compileCs486Object,
  compileCs486Source,
  type Cs486SourceLanguage,
} from "../toolchain/highLevelCompilers.js";
import type { Cs486CFrontendOptions } from "../toolchain/cs486CFrontend.js";
import {
  cs486CPreprocessorLimits,
  preprocessCs486C,
  type Cs486CPreprocessorInclude,
} from "../toolchain/cs486CPreprocessor.js";
import { cs486AsmPreprocessorLimits } from "../toolchain/cs486AsmPreprocessor.js";
import {
  fingerprintCsDosProgram,
  parseCsDosProgramList,
  type CsDosProgramList,
} from "../toolchain/csDosProgramList.js";
import { Cs486LinkError, linkCs486Objects } from "../toolchain/cs486Linker.js";
import {
  createCs486Archive,
  deleteCs486ArchiveMembers,
  parseCs486Archive,
  refreshCs486ArchiveIndex,
  replaceCs486ArchiveMembers,
  selectParsedCs486LinkInputs,
  serializeCs486Archive,
  type Cs486Archive,
  type Cs486LinkInput,
} from "../toolchain/cs486Archive.js";
import {
  Cs486Debugger,
  type Cs486DebuggerOutcome,
} from "../toolchain/cs486Debugger.js";
import { sha256Hex } from "./passwordHash.js";
import { md5Hex } from "./md5Hash.js";
import { parseInstalledHostedCArchive } from "./hostedCLibcImage.js";
import { base64Decode, base64Encode } from "./base64.js";
import {
  commandRegistryFor,
  isDosInternalCommand,
  isLinuxBuiltinCommand,
  type CommandRegistry,
} from "./commandRegistry.js";
import {
  commandExecutablePath,
  decodeSystemUtility,
} from "./osFilesystemImages.js";
import { DosCommandAdapter } from "./dosCommands.js";
import { filesystemExecute, type GuestFilesystem } from "./guestFilesystem.js";
import type { LinuxAccountDatabase, LinuxUserRecord } from "./linuxAccounts.js";
import type { ProcessCredentials } from "./linuxCredentials.js";
import { shellTextPolicyFor, type ShellTextPolicy } from "./shellTextPolicy.js";
import type { DosFileDialogSnapshot } from "../editor/editorScreen.js";
import type {
  ShellAction,
  ShellCommandResult,
  ShellCompletionCandidate,
  ShellCompletionResult,
  ShellToolchainCommandResult,
} from "./shellTypes.js";
import {
  concatGuestToolchainTranscripts,
  createGuestToolchainTranscript,
  emptyGuestToolchainTranscript,
  guestToolchainTranscriptFromCompileError,
  guestToolchainTranscriptFromFailure,
  guestToolchainTranscriptFromStreams,
  renderGuestToolchainTranscript,
} from "../toolchain/guestToolchainTranscript.js";
import type { PeripheralBusBroker } from "../io/peripheralBusBroker.js";
import {
  machineFaceAt,
  type MachineFace,
} from "../../domain/computer/machineFace.js";
import {
  linuxManualPage,
  linuxManualPages,
  renderLinuxManualPage,
} from "./linuxManual.js";
import type {
  OsJobRecord,
  OsProcessRecord,
  OsProcessSignal,
  OsRuntimeState,
} from "./osRuntimeState.js";
import { parseLinuxCrontab } from "./linuxCrontab.js";
import { executeLinuxAwk, executeLinuxSed } from "./linuxTextProcessors.js";
import {
  executeLinuxGzip,
  executeLinuxTar,
  executeLinuxUnzip,
  executeLinuxZip,
  type LinuxArchiveResult,
} from "./linuxArchives.js";
import { executeLinuxGit } from "./linuxGit.js";
import {
  DosDriveError,
  DosRuntimeState,
  DosRuntimeStateError,
  dosFatAttribute,
  expandDosFileSpec,
  hasDosFatAttribute,
  migrateDosFatMetadata,
  truncateToDosFatTimestamp,
  type DosFatMetadataSnapshotV1,
} from "./dosRuntimeState.js";
import type { FloppyDrive, FloppyDriveIo } from "./floppyDrive.js";
import {
  csAsmProductName,
  csCFamilyProductName,
  csQBasicProductName,
} from "../editor/qbasicSession.js";

export type {
  ShellAction,
  ShellBackgroundRequest,
  ShellCommandResult,
  ShellCompletionResult,
  ShellTerminalCompletion,
  ShellForegroundRequest,
  ShellForegroundPython,
  ShellJobControlRequest,
} from "./shellTypes.js";

export interface ShellCommandRuntimeOptions {
  readonly accounts?: LinuxAccountDatabase;
  readonly clock: ShellClockSource;
  readonly computerId: number;
  readonly computerName: string;
  readonly currentTick: () => number;
  readonly credentials: () => ProcessCredentials;
  readonly profile: OsProfile;
  readonly ticksPerSecond: number;
  readonly hardware: ComputerHardwareProfile;
  readonly dosMemorySnapshot?: () => DosGuestMemorySnapshot;
  readonly linuxMemorySnapshot?: () => LinuxGuestMemorySnapshot;
  readonly admitProcessMemory: ShellProcessMemoryAdmission;
  readonly admitUtilityMemory: ShellUtilityMemoryAdmission;
  readonly virtualDevices?: ReadonlyMap<string, VirtualDevice>;
  readonly peripherals?: PeripheralBusBroker;
  readonly deferGuestExecution?: boolean;
  readonly requestFilesystemIo?: (
    operation: "read" | "write",
    bytes: number,
  ) => string | undefined;
  readonly requestFloppyIo?: (
    requests: readonly FloppyDriveIo[],
  ) => string | undefined;
  readonly floppyDrive?: FloppyDrive;
  readonly syncFilesystem?: () => void;
  readonly osRuntime?: OsRuntimeState;
  readonly sessionId?: () => string | undefined;
  readonly selfPid?: () => number | undefined;
  readonly signalProcess?: (pid: number, signal: OsProcessSignal) => void;
  readonly dosRuntime?: DosRuntimeState;
  readonly onDosRuntimeChanged?: (state: DosRuntimeState) => void;
}

export interface ShellProcessMemoryAdmissionRequest {
  readonly displayName: string;
  readonly executable: Cs486Executable;
  readonly kind: "debugger" | "execution";
  readonly moduleId: string;
}

export interface ShellProcessMemoryGrant {
  readonly memoryBytes: number;
  readonly released: boolean;
  bindProcess(pid: number): void;
  release(): void;
}

export type ShellProcessMemoryAdmission = (
  request: ShellProcessMemoryAdmissionRequest,
) => ShellProcessMemoryGrant;

export interface ShellUtilityMemoryAdmissionRequest {
  readonly displayName: string;
  readonly moduleId: string;
  readonly residentBytes: number;
}

export interface ShellUtilityMemoryGrant {
  readonly released: boolean;
  readonly residentBytes: number;
  release(): void;
}

export type ShellUtilityMemoryAdmission = (
  request: ShellUtilityMemoryAdmissionRequest,
) => ShellUtilityMemoryGrant;

interface CFamilyCommandOptions {
  readonly arguments: readonly string[];
  readonly definitions: readonly {
    readonly name: string;
    readonly replacement?: string;
  }[];
  readonly dependencyFile?: string;
  readonly dependencyGeneration: boolean;
  readonly dataModel: Cs486DataModel;
  readonly includePaths: readonly string[];
  readonly optimizationLevel: 0 | 1;
  readonly standard: string;
  readonly undefines: readonly string[];
}

interface CsDosBuildUnitRecord {
  readonly fingerprint: string;
  readonly objectDigest: string;
  readonly objectPath: string;
}

interface CsDosBuildRecord {
  readonly fingerprint: string;
  readonly generatedPaths: readonly string[];
  readonly projectPath: string;
  readonly units: Readonly<Record<string, CsDosBuildUnitRecord>>;
  readonly version: 1;
}

const csDosBuildRecordMarker = "CS-DOS-BUILD-RECORD 1.0\n";

export interface ShellRuntimeIdentityState {
  readonly currentDirectory: string;
  readonly environment: readonly (readonly [string, string])[];
  readonly previousDirectory: string;
}

interface MemoryRegion {
  readonly free: number;
  readonly total: number;
  readonly used: number;
}

interface DosMemoryLayout {
  readonly conventional: MemoryRegion;
  readonly extended: MemoryRegion;
  readonly largestConventionalBlockBytes: number;
  readonly largestUpperBlockBytes: number;
  readonly reserved: MemoryRegion;
  readonly runtimeBytes: number;
  readonly snapshot: DosGuestMemorySnapshot;
  readonly systemBytes: number;
  readonly total: MemoryRegion;
  readonly upper: MemoryRegion;
}

interface DosDirectoryGroup {
  readonly directory: string;
  readonly targets: readonly string[];
}

const maximumOutputLength = 256_000;
const maximumCompletionCandidates = 64;
const maximumCompletionLineLength = 128;
const linuxGitResidentBytes = 1_048_576;
const maximumEnvironmentVariables = 256;
const initManagedServiceNames: ReadonlySet<string> = new Set([
  "syslog",
  "cron",
]);
const dosShortDisplayNamePattern =
  /^[A-Za-z0-9!#$%&'()@^_`{}~-]{1,8}(?:\.[A-Za-z0-9!#$%&'()@^_`{}~-]{1,3})?$/u;

function formatDosDirectoryName(name: string): string {
  const normalized = name.toUpperCase();
  const separator = normalized.indexOf(".");
  const base = separator < 0 ? normalized : normalized.slice(0, separator);
  const extension = separator < 0 ? "" : normalized.slice(separator + 1);
  return `${base.padEnd(8)} ${extension.padEnd(3)}`;
}

function formatDosDecimal(value: number): string {
  const digits = String(Math.max(0, Math.trunc(value)));
  const leadingDigits = digits.length % 3 || 3;
  const groups = [digits.slice(0, leadingDigits)];
  for (let index = leadingDigits; index < digits.length; index += 3) {
    groups.push(digits.slice(index, index + 3));
  }
  return groups.join(",");
}

export class ShellCommandRuntime {
  private readonly bootTick: number;
  private readonly dosCommands: DosCommandAdapter | undefined;
  private readonly registry: CommandRegistry;
  private readonly textPolicy: ShellTextPolicy;
  private currentDirectory: string;
  private previousDirectory: string;
  private readonly environment: Map<string, string>;
  private dosEcho = true;
  private temporarySequence = 0;
  private xargsDepth = 0;
  private ioReadBytes = 0;
  private ioWriteBytes = 0;
  private cs486Debugger: Cs486Debugger | undefined;
  private cs486DebuggerMemoryGrant: ShellProcessMemoryGrant | undefined;
  private readonly cs486DebuggerSymbols = new Map<string, number>();
  private cs486DebuggerOutputCursor = 0;
  private readonly dosRuntime: DosRuntimeState | undefined;
  private dosTransactionDepth = 0;
  private admittedMakeRecipeDepth = 0;

  constructor(
    private readonly filesystem: GuestFilesystem,
    private readonly options: ShellCommandRuntimeOptions,
  ) {
    this.bootTick = options.currentTick();
    this.currentDirectory = options.profile.initialDirectory;
    this.previousDirectory = options.profile.initialDirectory;
    this.environment = new Map(options.profile.environment);
    this.registry = commandRegistryFor(options.profile.id);
    this.textPolicy = shellTextPolicyFor(options.profile.id);
    this.dosCommands =
      options.profile.id === "dos" ? new DosCommandAdapter(this) : undefined;
    this.dosRuntime =
      options.profile.id === "dos"
        ? (options.dosRuntime ?? DosRuntimeState.create())
        : undefined;
  }

  get cwd(): string {
    return this.currentDirectory;
  }

  /**
   * Commits a DOS-only aggregate mutation and its shell-facing directory state
   * as one observer-visible unit. An observer rejection restores both views and
   * republishes the restored aggregate so persistence cannot retain the failed
   * candidate state.
   */
  private runDosRuntimeTransaction<Result>(
    operation: SynchronousTransactionOperation<Result>,
  ): Result {
    const dosRuntime = this.dosRuntime;
    if (dosRuntime === undefined || this.dosTransactionDepth > 0)
      return operation();
    const beforeRevision = dosRuntime.revision;
    const beforeCurrentDirectory = this.currentDirectory;
    const beforePreviousDirectory = this.previousDirectory;
    const observer = this.options.onDosRuntimeChanged;
    let observerAttempted = false;
    this.dosTransactionDepth += 1;
    try {
      return dosRuntime.transaction<Result>(() => {
        const result = operation();
        if (observer !== undefined && dosRuntime.revision !== beforeRevision) {
          observerAttempted = true;
          observer(dosRuntime);
        }
        return result;
      });
    } catch (error: unknown) {
      this.currentDirectory = beforeCurrentDirectory;
      this.previousDirectory = beforePreviousDirectory;
      if (observerAttempted && observer !== undefined) {
        try {
          observer(dosRuntime);
        } catch (observerRollbackError: unknown) {
          throw new AggregateError(
            [error, observerRollbackError],
            "DOS transaction observer rollback failed",
          );
        }
      }
      throw error;
    } finally {
      this.dosTransactionDepth -= 1;
    }
  }

  /**
   * Commits filesystem and FAT state as one bounded synchronous mutation.
   * Nested single-file helpers reuse the outer undo boundary, and observers see
   * only the final committed aggregate rather than intermediate wildcard rows.
   */
  private runDosFilesystemTransaction<Result>(
    operation: SynchronousTransactionOperation<Result>,
  ): Result {
    const dosRuntime = this.dosRuntime;
    if (dosRuntime === undefined) return this.filesystem.transaction(operation);
    if (this.dosTransactionDepth > 0) return operation();
    const beforeIoWriteBytes = this.ioWriteBytes;
    try {
      return this.filesystem.transaction(
        () =>
          this.runDosRuntimeTransaction(operation) as ReturnType<
            SynchronousTransactionOperation<Result>
          >,
      );
    } catch (error: unknown) {
      this.ioWriteBytes = beforeIoWriteBytes;
      throw error;
    }
  }

  private dosMediaForPath(
    path: string,
    state = this.dosRuntime,
  ): { readonly generation: number; readonly letter: string } | undefined {
    const match = /^\/drives\/([a-z])(?:\/|$)/u.exec(path);
    if (match === null || state === undefined) return undefined;
    // Real removable A: media owns its FAT metadata in FloppyMedia. The DOS
    // aggregate still owns drive selection/generation, but must not maintain a
    // second metadata truth for the same files.
    if (match[1] === "a" && this.options.floppyDrive?.media !== undefined)
      return undefined;
    const media = state.requireMedia(match[1]!.toUpperCase());
    return { generation: media.mediaGeneration, letter: media.letter };
  }

  private ensureDosFatMetadata(
    path: string,
  ): Readonly<DosFatMetadataSnapshotV1> | undefined {
    if (this.dosRuntime === undefined) return undefined;
    return this.runDosRuntimeTransaction(() =>
      this.ensureDosFatMetadataIn(this.dosRuntime!, path),
    );
  }

  private ensureDosFatMetadataIn(
    state: DosRuntimeState,
    path: string,
  ): Readonly<DosFatMetadataSnapshotV1> | undefined {
    const media = this.dosMediaForPath(path, state);
    if (media === undefined) return undefined;
    const match = /^\/drives\/[a-z](?:\/(.*))?$/u.exec(path);
    if (match === null || !this.filesystem.exists(path)) return undefined;
    const root = `/drives/${media.letter.toLowerCase()}`;
    const segments = match[1]?.split("/").filter(Boolean) ?? [];
    const candidates = [root];
    let candidate = root;
    for (const segment of segments) {
      candidate = `${candidate}/${segment}`;
      candidates.push(candidate);
    }
    for (const current of candidates) {
      if (state.fatMetadata(current, media.generation) !== undefined) continue;
      const metadata = this.filesystem.getMetadata(current);
      state.setFatMetadata(
        current,
        metadata,
        {
          kind: this.filesystem.isDirectory(current) ? "directory" : "file",
          modifiedAtMilliseconds: metadata.modifiedAtMilliseconds,
        },
        media.generation,
      );
      if (current === "/drives/c/io.sys" || current === "/drives/c/msdos.sys") {
        state.setFatAttribute(
          current,
          dosFatAttribute.hidden,
          true,
          media.generation,
        );
        state.setFatAttribute(
          current,
          dosFatAttribute.system,
          true,
          media.generation,
        );
        state.setFatAttribute(
          current,
          dosFatAttribute.readOnly,
          true,
          media.generation,
        );
      }
    }
    return state.fatMetadata(path, media.generation);
  }

  private assertDosPathWritable(path: string): void {
    if (this.dosRuntime === undefined) return;
    this.runDosRuntimeTransaction(() => {
      this.assertDosPathWritableIn(this.dosRuntime!, path);
    });
  }

  private assertDosPathWritableIn(state: DosRuntimeState, path: string): void {
    const media = this.dosMediaForPath(path, state);
    if (media === undefined) return;
    state.assertWritable(media.letter, media.generation);
    if (
      this.filesystem.exists(path) &&
      hasDosFatAttribute(
        this.ensureDosFatMetadataIn(state, path)!.attributes,
        dosFatAttribute.readOnly,
      )
    ) {
      throw new Error("Access is denied.");
    }
  }

  private markDosFileWritten(path: string): void {
    this.runDosRuntimeTransaction(() => {
      const media = this.dosMediaForPath(path);
      if (media === undefined || this.dosRuntime === undefined) return;
      const current = this.dosRuntime.fatMetadata(path, media.generation);
      if (current === undefined) this.ensureDosFatMetadata(parentPath(path));
      const modifiedAtMilliseconds = truncateToDosFatTimestamp(
        this.options.clock.currentWallTimeMilliseconds(),
      );
      this.dosRuntime.setFatMetadata(
        path,
        {
          attributes:
            (current?.attributes ?? dosFatAttribute.archive) |
            dosFatAttribute.archive,
          modifiedAtMilliseconds,
          schema: 1,
        },
        {
          kind: this.filesystem.isDirectory(path) ? "directory" : "file",
          modifiedAtMilliseconds,
        },
        media.generation,
      );
    });
  }

  private preflightDosFileWrite(path: string): void {
    const media = this.dosMediaForPath(path);
    if (media === undefined || this.dosRuntime === undefined) return;
    if (this.filesystem.exists(path)) {
      this.ensureDosFatMetadata(path);
      return;
    }
    const trial = DosRuntimeState.restore(
      this.dosRuntime.snapshot(),
      this.dosRuntime.limits,
    );
    this.ensureDosFatMetadataIn(trial, parentPath(path));
    trial.setFatMetadata(
      path,
      undefined,
      {
        kind: "file",
        modifiedAtMilliseconds:
          this.options.clock.currentWallTimeMilliseconds(),
      },
      media.generation,
    );
  }

  private deleteDosFatMetadata(path: string): void {
    this.runDosRuntimeTransaction(() => {
      const media = this.dosMediaForPath(path);
      if (media === undefined || this.dosRuntime === undefined) return;
      this.dosRuntime.deleteFatMetadata(path, media.generation);
    });
  }

  private copyDosFatMetadata(source: string, destination: string): void {
    this.runDosRuntimeTransaction(() => {
      const sourceMedia = this.dosMediaForPath(source);
      const destinationMedia = this.dosMediaForPath(destination);
      if (
        sourceMedia === undefined ||
        destinationMedia === undefined ||
        this.dosRuntime === undefined
      ) {
        return;
      }
      const sourceMetadata = this.ensureDosFatMetadata(source)!;
      this.dosRuntime.setFatMetadata(
        destination,
        sourceMetadata,
        {
          kind: this.filesystem.isDirectory(destination) ? "directory" : "file",
          modifiedAtMilliseconds: sourceMetadata.modifiedAtMilliseconds,
        },
        destinationMedia.generation,
      );
    });
  }

  private moveDosFatMetadata(source: string, destination: string): void {
    this.runDosRuntimeTransaction(() => {
      const sourceMedia = this.dosMediaForPath(source);
      const destinationMedia = this.dosMediaForPath(destination);
      if (
        sourceMedia === undefined ||
        destinationMedia === undefined ||
        this.dosRuntime === undefined
      ) {
        return;
      }
      this.dosRuntime.moveFatMetadata(
        source,
        destination,
        sourceMedia.generation,
        destinationMedia.generation,
      );
    });
  }

  complete(line: string, cursor: number): ShellCompletionResult {
    if (
      line.length > maximumCompletionLineLength ||
      !Number.isSafeInteger(cursor) ||
      cursor < 0 ||
      cursor > line.length
    ) {
      return emptyShellCompletion(line, cursor);
    }
    const beforeCursor = line.slice(0, cursor);
    const tokenStart = findCompletionTokenStart(beforeCursor);
    const token = beforeCursor.slice(tokenStart);
    if (/['"]/u.test(token))
      return emptyShellCompletion(line, cursor, tokenStart, cursor);
    const commandPosition = isCommandCompletionPosition(
      beforeCursor.slice(0, tokenStart),
    );
    const completionSet = commandPosition
      ? this.commandCompletions(token)
      : this.pathCompletions(token);
    const maximumReplacementLength =
      maximumCompletionLineLength - (line.length - (cursor - tokenStart));
    const candidates = completionSet.candidates.flatMap((candidate) => {
      if (candidate.insertText.length <= maximumReplacementLength)
        return [candidate];
      if (
        candidate.insertText.endsWith(" ") &&
        candidate.displayText.length <= maximumReplacementLength
      ) {
        return [{ ...candidate, insertText: candidate.displayText }];
      }
      return [];
    });
    const truncated =
      completionSet.truncated ||
      candidates.length < completionSet.candidates.length;
    if (candidates.length === 0)
      return {
        ...emptyShellCompletion(line, cursor, tokenStart, cursor),
        truncated,
      };

    const common = longestCommonPrefix(
      candidates.map((candidate) => candidate.displayText),
      this.options.profile.id === "dos",
    );
    const replacement =
      candidates.length === 1 ? candidates[0]!.insertText : common;
    const value = `${line.slice(0, tokenStart)}${replacement}${line.slice(cursor)}`;
    return {
      candidates,
      cursor: tokenStart + replacement.length,
      replaceEnd: cursor,
      replaceStart: tokenStart,
      truncated,
      value,
    };
  }

  get profile(): OsProfile {
    return this.options.profile;
  }

  get credentials(): ProcessCredentials {
    return this.options.credentials();
  }

  activateUser(user: LinuxUserRecord): string | undefined {
    this.closeDebugger();
    const homeProblem = this.loginDirectoryProblem(user.home);
    this.environment.clear();
    for (const [name, value] of this.options.profile.environment)
      this.setEnvironmentEntry(name, value);
    this.setEnvironmentEntry("HOME", user.home);
    this.setEnvironmentEntry(
      "PATH",
      user.uid === 0 ? linuxRootDefaultPath : linuxUserDefaultPath,
    );
    this.setEnvironmentEntry("USER", user.name);
    this.setEnvironmentEntry("LOGNAME", user.name);
    this.setEnvironmentEntry("SHELL", user.shell);
    this.previousDirectory = this.currentDirectory;
    this.currentDirectory = homeProblem === undefined ? user.home : "/";
    return homeProblem === undefined
      ? undefined
      : `Could not chdir to home directory ${user.home}: ${homeProblem}`;
  }

  deactivateUser(): void {
    this.closeDebugger();
    this.environment.clear();
    for (const [name, value] of this.options.profile.environment) {
      if (name === "HOME" || name === "LOGNAME" || name === "USER") continue;
      this.setEnvironmentEntry(name, value);
    }
    this.previousDirectory = this.currentDirectory;
    this.currentDirectory = "/";
  }

  switchUser(user: LinuxUserRecord, login: boolean): void {
    this.closeDebugger();
    this.setEnvironmentEntry("USER", user.name);
    this.setEnvironmentEntry("LOGNAME", user.name);
    this.setEnvironmentEntry("SHELL", user.shell);
    if (login) {
      this.setEnvironmentEntry("HOME", user.home);
      this.setEnvironmentEntry(
        "PATH",
        user.uid === 0 ? linuxRootDefaultPath : linuxUserDefaultPath,
      );
      this.previousDirectory = this.currentDirectory;
      this.currentDirectory = user.home;
    }
  }

  closeDebugger(): void {
    this.cs486Debugger = undefined;
    this.cs486DebuggerSymbols.clear();
    this.cs486DebuggerOutputCursor = 0;
    const grant = this.cs486DebuggerMemoryGrant;
    this.cs486DebuggerMemoryGrant = undefined;
    if (grant !== undefined && !grant.released) grant.release();
  }

  private loginDirectoryProblem(home: string): string | undefined {
    try {
      if (!this.filesystem.exists(home)) return "No such file or directory";
      if (!this.filesystem.isDirectory(home)) return "Not a directory";
      if (!this.filesystem.hasAccess(home, filesystemExecute))
        return "Permission denied";
      return undefined;
    } catch (error: unknown) {
      return message(error);
    }
  }

  restoreDirectory(path: string): void {
    this.previousDirectory = this.currentDirectory;
    this.currentDirectory = path;
  }

  captureIdentityState(): ShellRuntimeIdentityState {
    if (this.environment.size > maximumEnvironmentVariables)
      throw new Error("shell environment variable limit exceeded");
    return Object.freeze({
      currentDirectory: this.currentDirectory,
      environment: Object.freeze(
        [...this.environment].map(([name, value]) =>
          Object.freeze([name, value] as const),
        ),
      ),
      previousDirectory: this.previousDirectory,
    });
  }

  restoreIdentityState(state: ShellRuntimeIdentityState): void {
    if (state.environment.length > maximumEnvironmentVariables)
      throw new Error("shell environment variable limit exceeded");
    this.environment.clear();
    for (const [name, value] of state.environment)
      this.setEnvironmentEntry(name, value);
    this.currentDirectory = state.currentDirectory;
    this.previousDirectory = state.previousDirectory;
  }

  getUmask(): number {
    return this.filesystem.getUmask();
  }

  prompt(): string {
    if (this.options.profile.id === "dos") {
      return this.renderDosPrompt(this.environment.get("PROMPT") ?? "$P$G");
    }
    const display =
      this.currentDirectory ===
      (this.environment.get("HOME") ?? this.options.profile.home)
        ? "~"
        : this.options.profile.pathDialect.display(this.currentDirectory);
    const credentials = this.options.credentials();
    return `${credentials.loginName}@${this.options.computerName}:${display}${credentials.effectiveUserId === 0 ? "#" : "$"} `;
  }

  resolveVariable(name: string, lastExitCode: number): string | undefined {
    if (name === "?") return String(lastExitCode);
    if (name === "PWD") return this.currentDirectory;
    if (name === "OLDPWD") return this.previousDirectory;
    return this.environment.get(this.environmentName(name));
  }

  setVariable(name: string, value: string): void {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(name)) {
      throw new Error(`${name}: invalid variable name`);
    }
    this.setEnvironmentEntry(this.environmentName(name), value);
  }

  isBuiltInCommand(name: string): boolean {
    return this.installedSystemUtility(name) !== undefined;
  }

  get dosEchoEnabled(): boolean {
    return this.dosEcho;
  }

  setDosEchoEnabled(enabled: boolean): void {
    this.dosEcho = enabled;
  }

  expandDosVariables(
    value: string,
    scriptName: string,
    arguments_: readonly string[],
    lastExitCode: number,
  ): string {
    return value.replace(
      /%([A-Za-z_][A-Za-z0-9_]*)%|%([0-9])/gu,
      (_match, variable: string | undefined, position: string | undefined) => {
        if (position !== undefined) {
          const index = Number(position);
          return index === 0 ? scriptName : (arguments_[index - 1] ?? "");
        }
        if (variable?.toUpperCase() === "ERRORLEVEL")
          return String(lastExitCode);
        return this.environment.get(this.environmentName(variable ?? "")) ?? "";
      },
    );
  }

  executeDosControlLine(line: string): ShellCommandResult | undefined {
    const normalized = line.trim().replace(/^@/u, "").trimStart();
    const driveSelection = /^([A-Za-z]):$/u.exec(normalized);
    if (driveSelection !== null) return this.selectDosDrive(driveSelection[1]!);
    const match = /^([A-Za-z]+)(?:\s+(.*))?$/su.exec(normalized);
    if (match === null) return undefined;
    const command = match[1]!.toLowerCase();
    const remainder = match[2] ?? "";
    switch (command) {
      case "rem":
        return success();
      case "set":
        return this.dosSet(remainder);
      case "path":
        return this.dosPath(remainder);
      case "prompt":
        return this.dosPrompt(remainder);
      case "echo":
        return remainder.length === 0 || /^(?:off|on)$/iu.test(remainder)
          ? this.dosEchoCommand(remainder)
          : undefined;
      default:
        return undefined;
    }
  }

  resolveDosProgram(
    name: string,
  ):
    | { readonly kind: "batch" | "executable"; readonly path: string }
    | undefined {
    if (name.length === 0) return undefined;
    const hasDirectory = name.includes("/") || name.includes("\\");
    const directories = hasDirectory
      ? [""]
      : [
          this.currentDirectory,
          ...(this.environment.get("PATH") ?? "")
            .split(";")
            .filter((entry) => entry.length > 0)
            .slice(0, 16)
            .map((entry) => this.resolvePath(entry)),
        ];
    const hasExtension = /\.[^/\\]+$/u.test(name);
    const names = hasExtension ? [name] : [name, `${name}.bat`];
    for (const directory of directories) {
      for (const candidateName of names) {
        const candidate = hasDirectory
          ? this.resolvePath(candidateName)
          : this.resolvePath(joinPath(directory, candidateName.toLowerCase()));
        if (
          this.filesystem.exists(candidate) &&
          !this.filesystem.isDirectory(candidate)
        ) {
          return {
            kind: candidate.toLowerCase().endsWith(".bat")
              ? "batch"
              : "executable",
            path: candidate,
          };
        }
      }
    }
    return undefined;
  }

  executeAdmittedMakeRecipe(
    words: readonly string[],
    stdin: string,
  ): ShellCommandResult {
    this.admittedMakeRecipeDepth += 1;
    try {
      return this.execute(words, stdin);
    } finally {
      this.admittedMakeRecipeDepth -= 1;
    }
  }

  execute(words: readonly string[], stdin: string): ShellCommandResult {
    const assignments = words.findIndex((word) => !isAssignment(word));
    if (assignments !== 0) {
      const count = assignments < 0 ? words.length : assignments;
      for (const assignment of words.slice(0, count)) {
        const separator = assignment.indexOf("=");
        this.setEnvironmentEntry(
          this.environmentName(assignment.slice(0, separator)),
          assignment.slice(separator + 1),
        );
      }
      if (assignments < 0) return success();
      words = words.slice(assignments);
    }

    const [requestedCommand = "", ...arguments_] = words;
    const installed = this.installedSystemUtility(requestedCommand);
    const canonical = this.canonicalCommand(requestedCommand);
    const command = installed ?? canonical;
    if (this.registry.has(requestedCommand)) {
      const executablePath = commandExecutablePath(
        this.options.profile.id,
        this.registry.canonical(requestedCommand),
      );
      if (this.filesystem.exists(executablePath)) {
        this.ioReadBytes += this.filesystem.getSize(executablePath);
      }
    }
    try {
      if (
        this.options.profile.id === "dos" &&
        this.registry.has(requestedCommand) &&
        !isDosInternalCommand(canonical) &&
        installed === undefined
      ) {
        return this.commandNotFound(requestedCommand);
      }
      const profileResult = this.dosCommands?.execute(
        requestedCommand,
        arguments_,
        stdin,
      );
      if (profileResult !== undefined) return profileResult;
      if (
        this.options.profile.id === "linux" &&
        installed === undefined &&
        !this.registry.has(requestedCommand) &&
        !isExecutableCommand(command)
      ) {
        const resolved = this.resolveLinuxExecutableName(requestedCommand);
        if (resolved !== undefined)
          return this.runExecutable([resolved, ...arguments_]);
      }
      if (
        (!this.registry.has(requestedCommand) || installed === undefined) &&
        !isExecutableCommand(command)
      ) {
        return this.commandNotFound(requestedCommand);
      }
      const result = this.dispatch(command, arguments_, stdin);
      if (
        result.stdout.length > maximumOutputLength ||
        result.stderr.length > maximumOutputLength
      ) {
        return failure(command, "output limit exceeded");
      }
      return result;
    } catch (error: unknown) {
      if (error instanceof Cs486CompileError) {
        return status(1, "", this.formatCompileError(error, requestedCommand));
      }
      if (error instanceof Cs486LinkError) {
        const commandName =
          this.options.profile.id === "dos" ? "LINK" : command || "ld";
        return status(
          1,
          "",
          `${commandName}: error CSLINK001: ${error.message}${this.textPolicy.newline}`,
        );
      }
      if (this.options.profile.id === "dos" && error instanceof DosPathError) {
        return status(1, "", "Invalid filename or extension.\r\n");
      }
      if (
        this.options.profile.id === "dos" &&
        error instanceof DosRuntimeStateError
      ) {
        return status(1, "", `${error.message}\r\n`);
      }
      if (this.dosCommands !== undefined) {
        return status(
          1,
          "",
          `${this.dosCommands.failureMessage(requestedCommand)}\r\n`,
        );
      }
      return failure(command, message(error));
    }
  }

  private formatCompileError(
    error: Cs486CompileError,
    requestedCommand: string,
  ): string {
    const newline = this.textPolicy.newline;
    if (this.options.profile.id === "dos") {
      const source =
        error.source === undefined
          ? requestedCommand.toUpperCase()
          : this.options.profile.pathDialect.display(error.source);
      return `${source}(${String(error.line ?? 1)},${String(error.column ?? 1)}): error ${error.code}: ${error.detail}${newline}`;
    }
    const location =
      error.source === undefined
        ? requestedCommand || "as"
        : `${error.source}:${String(error.line ?? 1)}:${String(error.column ?? 1)}`;
    return `${location}: error ${error.code}: ${error.detail}${newline}`;
  }

  renderToolchainCommandResult(
    result: ShellToolchainCommandResult,
  ): ShellCommandResult {
    const rendered = renderGuestToolchainTranscript(result.transcript, {
      displaySource: (source) =>
        this.options.profile.pathDialect.display(source),
      profile: this.options.profile.id,
    });
    return {
      exitCode: result.exitCode,
      stderr: rendered.stderr,
      stdout: rendered.stdout,
      ...(result.cpuCycles === undefined
        ? {}
        : { cpuCycles: result.cpuCycles }),
      ...(result.foreground === undefined
        ? {}
        : { foreground: result.foreground }),
    };
  }

  private captureToolchainResult(
    execute: () => ShellCommandResult,
    command: string,
    fallbackSource: string,
  ): ShellToolchainCommandResult {
    try {
      const result = execute();
      return {
        exitCode: result.exitCode,
        transcript: guestToolchainTranscriptFromStreams(
          result.stdout,
          result.stderr,
        ),
        ...(result.cpuCycles === undefined
          ? {}
          : { cpuCycles: result.cpuCycles }),
        ...(result.foreground === undefined
          ? {}
          : { foreground: result.foreground }),
      };
    } catch (error: unknown) {
      return this.toolchainErrorResult(error, command, fallbackSource);
    }
  }

  private toolchainErrorResult(
    error: unknown,
    command: string,
    fallbackSource: string,
  ): ShellToolchainCommandResult {
    if (error instanceof Cs486CompileError) {
      return {
        exitCode: 1,
        transcript: guestToolchainTranscriptFromCompileError(
          error,
          fallbackSource,
        ),
      };
    }
    if (error instanceof Cs486LinkError) {
      return {
        exitCode: 1,
        transcript: createGuestToolchainTranscript([
          {
            diagnostic: {
              code: "CSLINK001",
              message: error.message,
              notes: [],
              severity: "error",
              source: this.options.profile.id === "dos" ? "LINK" : command,
            },
            kind: "diagnostic",
          },
        ]),
      };
    }
    return {
      exitCode: 1,
      transcript: guestToolchainTranscriptFromFailure(
        `${this.displayName(command)}: ${message(error)}${this.textPolicy.newline}`,
      ),
    };
  }

  resolvePath(path: string): string {
    if (this.dosRuntime !== undefined) return this.resolveDosDrivePath(path);
    return this.filesystem.normalize(
      this.options.profile.pathDialect.resolve(
        path,
        this.currentDirectory,
        this.environment.get("HOME") ?? this.options.profile.home,
      ),
    );
  }

  private selectDosDrive(letter: string): ShellCommandResult {
    const drives = this.dosRuntime;
    if (drives === undefined) return failure(letter, "drive table unavailable");
    try {
      this.runDosRuntimeTransaction(() => {
        drives.selectDrive(letter);
        const state = drives.requireMedia(drives.activeDrive);
        this.previousDirectory = this.currentDirectory;
        this.currentDirectory = this.filesystem.normalize(
          `/drives/${state.letter.toLowerCase()}${state.currentDirectory === "\\" ? "" : state.currentDirectory.replaceAll("\\", "/")}`,
        );
      });
      return success();
    } catch (error: unknown) {
      if (error instanceof DosDriveError) {
        if (error.code === "no_media") {
          return status(1, "", `Not ready reading drive ${error.drive}\r\n`);
        }
        return status(1, "", "Invalid drive specification\r\n");
      }
      return status(1, "", `Drive error: ${message(error)}\r\n`);
    }
  }

  private resolveDosDrivePath(path: string): string {
    const drives = this.dosRuntime;
    if (drives === undefined) throw new Error("DOS drive table is unavailable");
    const expanded = path === "~" ? this.options.profile.home : path;
    const slashPath = expanded.replaceAll("\\", "/");
    if (
      slashPath.startsWith("/drives/") ||
      /^(?:nul|con|(?:com|spi|i2c)[1-6])$/iu.test(slashPath)
    ) {
      return this.filesystem.normalize(
        this.options.profile.pathDialect.resolve(
          slashPath,
          this.currentDirectory,
          this.environment.get("HOME") ?? this.options.profile.home,
        ),
      );
    }
    const explicit = /^([A-Za-z]):(.*)$/u.exec(slashPath);
    const letter = explicit?.[1] ?? drives.activeDrive;
    const state = drives.requireMedia(letter);
    const tail = explicit?.[2] ?? slashPath;
    const root = `/drives/${state.letter.toLowerCase()}`;
    const base = tail.startsWith("/")
      ? root
      : `${root}${state.currentDirectory === "\\" ? "" : state.currentDirectory.replaceAll("\\", "/")}`;
    return this.filesystem.normalize(
      this.options.profile.pathDialect.resolve(
        `${base}/${tail.replace(/^\/+|\/+$/gu, "")}`,
        this.currentDirectory,
        this.environment.get("HOME") ?? this.options.profile.home,
      ),
    );
  }

  currentDirectoryDisplay(): string {
    return this.options.profile.pathDialect.display(this.currentDirectory);
  }

  dosRemoveDirectory(arguments_: readonly string[]): ShellCommandResult {
    if (arguments_.length !== 1) {
      return status(2, "", "Required parameter missing.\r\n");
    }
    const path = this.resolvePath(arguments_[0]!);
    if (!this.filesystem.isDirectory(path)) {
      return status(1, "", "The system cannot find the path specified.\r\n");
    }
    if (this.filesystem.list(path).length > 0) {
      return status(
        1,
        "",
        "Invalid path, not directory, or directory not empty.\r\n",
      );
    }
    try {
      const trial = DosRuntimeState.restore(
        this.dosRuntime!.snapshot(),
        this.dosRuntime!.limits,
      );
      this.assertDosPathWritableIn(trial, path);
      const trialMedia = this.dosMediaForPath(path, trial)!;
      trial.deleteFatMetadata(path, trialMedia.generation);
      this.runDosFilesystemTransaction(() => {
        this.assertDosPathWritable(path);
        this.filesystem.delete(path);
        this.deleteDosFatMetadata(path);
      });
    } catch (error: unknown) {
      return status(1, "", `${message(error)}\r\n`);
    }
    return success();
  }

  dosDelete(arguments_: readonly string[]): ShellCommandResult {
    if (arguments_.length === 0)
      return status(2, "", "Required parameter missing.\r\n");
    if (arguments_.some((argument) => argument.startsWith("/")))
      return status(2, "", "Invalid switch.\r\n");
    try {
      const targets = this.dosMutationTargets(arguments_);
      if (targets.length === 0) return status(1, "", "File not found.\r\n");
      if (targets.some((target) => this.filesystem.isDirectory(target)))
        return status(1, "", "Access is denied.\r\n");
      const trial = DosRuntimeState.restore(
        this.dosRuntime!.snapshot(),
        this.dosRuntime!.limits,
      );
      for (const target of targets) {
        this.assertDosPathWritableIn(trial, target);
        const media = this.dosMediaForPath(target, trial)!;
        trial.deleteFatMetadata(target, media.generation);
      }
      this.runDosFilesystemTransaction(() => {
        for (const target of targets) this.assertDosPathWritable(target);
        for (const target of targets) {
          this.filesystem.delete(target);
          this.deleteDosFatMetadata(target);
        }
      });
      return success();
    } catch (error: unknown) {
      return status(1, "", `${message(error)}\r\n`);
    }
  }

  dosCopy(arguments_: readonly string[]): ShellCommandResult {
    if (arguments_.length !== 2)
      return status(2, "", "Required parameter missing.\r\n");
    try {
      const sources = this.dosMutationTargets([arguments_[0]!]);
      if (sources.length === 0) return status(1, "", "File not found.\r\n");
      if (sources.some((source) => this.filesystem.isDirectory(source)))
        return status(1, "", "Access is denied.\r\n");
      const destination = this.resolvePath(arguments_[1]!);
      const destinationIsDirectory =
        this.filesystem.exists(destination) &&
        this.filesystem.isDirectory(destination);
      if (sources.length > 1 && !destinationIsDirectory) {
        return status(
          1,
          "",
          "Multiple source files require an existing destination directory.\r\n",
        );
      }
      const copies = sources.map((source) => ({
        contents: this.readFile(source),
        destination: destinationIsDirectory
          ? joinPath(destination, baseName(source))
          : destination,
        source,
      }));
      const destinations = new Set<string>();
      let requiredBytes = 0;
      for (const copy of copies) {
        if (copy.source === copy.destination)
          return status(1, "", "File cannot be copied onto itself.\r\n");
        if (destinations.has(copy.destination))
          return status(1, "", "Duplicate destination filename.\r\n");
        destinations.add(copy.destination);
        requiredBytes += Math.max(
          0,
          utf8ByteLength(copy.contents) -
            (this.filesystem.exists(copy.destination)
              ? this.filesystem.getSize(copy.destination)
              : 0),
        );
      }
      if (requiredBytes > this.filesystem.getFreeSpace())
        return status(1, "", "Insufficient disk space.\r\n");
      const trial = DosRuntimeState.restore(
        this.dosRuntime!.snapshot(),
        this.dosRuntime!.limits,
      );
      for (const copy of copies) {
        const sourceMetadata = this.ensureDosFatMetadataIn(trial, copy.source)!;
        this.assertDosPathWritableIn(trial, copy.destination);
        this.ensureDosFatMetadataIn(trial, parentPath(copy.destination));
        const destinationMedia = this.dosMediaForPath(copy.destination, trial)!;
        trial.setFatMetadata(
          copy.destination,
          sourceMetadata,
          {
            kind: "file",
            modifiedAtMilliseconds: sourceMetadata.modifiedAtMilliseconds,
          },
          destinationMedia.generation,
        );
      }
      this.runDosFilesystemTransaction(() => {
        for (const copy of copies) {
          this.writeFile(copy.destination, copy.contents);
          this.copyDosFatMetadata(copy.source, copy.destination);
        }
      });
      return success(
        `${String(copies.length).padStart(9)} file(s) copied.\r\n`,
      );
    } catch (error: unknown) {
      return status(1, "", `${message(error)}\r\n`);
    }
  }

  dosRename(arguments_: readonly string[]): ShellCommandResult {
    if (arguments_.length !== 2)
      return status(2, "", "Required parameter missing.\r\n");
    try {
      const sources = this.dosMutationTargets([arguments_[0]!]);
      if (sources.length === 0) return status(1, "", "File not found.\r\n");
      if (sources.some((source) => this.filesystem.isDirectory(source)))
        return status(1, "", "Access is denied.\r\n");
      const templateSource = arguments_[1]!.replaceAll("\\", "/");
      if (sources.length > 1 && /[/:]/u.test(templateSource)) {
        return status(
          1,
          "",
          "Wildcard rename destination must be a filename template.\r\n",
        );
      }
      const pairs = sources.map((source) => {
        const destination = /[/:]/u.test(templateSource)
          ? this.resolvePath(arguments_[1]!)
          : this.resolvePath(
              joinPath(
                parentPath(source),
                applyDosRenameTemplate(baseName(source), templateSource),
              ),
            );
        return { destination, source };
      });
      const sourceSet = new Set(sources);
      const destinationSet = new Set<string>();
      for (const pair of pairs) {
        if (parentPath(pair.destination) !== parentPath(pair.source))
          return status(
            1,
            "",
            "REN cannot move files between directories.\r\n",
          );
        if (
          destinationSet.has(pair.destination) ||
          (this.filesystem.exists(pair.destination) &&
            pair.destination !== pair.source) ||
          (sourceSet.has(pair.destination) && pair.destination !== pair.source)
        ) {
          return status(1, "", "Duplicate filename or file not found.\r\n");
        }
        destinationSet.add(pair.destination);
      }
      const trial = DosRuntimeState.restore(
        this.dosRuntime!.snapshot(),
        this.dosRuntime!.limits,
      );
      for (const pair of pairs) {
        this.assertDosPathWritableIn(trial, pair.source);
        this.assertDosPathWritableIn(trial, pair.destination);
        if (pair.source === pair.destination) continue;
        const sourceMedia = this.dosMediaForPath(pair.source, trial)!;
        const destinationMedia = this.dosMediaForPath(pair.destination, trial)!;
        trial.moveFatMetadata(
          pair.source,
          pair.destination,
          sourceMedia.generation,
          destinationMedia.generation,
        );
      }
      this.runDosFilesystemTransaction(() => {
        for (const pair of pairs) {
          this.assertDosPathWritable(pair.source);
          this.ensureDosFatMetadata(pair.source);
          this.assertDosPathWritable(pair.destination);
          if (pair.source !== pair.destination)
            this.filesystem.move(pair.source, pair.destination);
          if (pair.source !== pair.destination)
            this.moveDosFatMetadata(pair.source, pair.destination);
        }
      });
      return success();
    } catch (error: unknown) {
      return status(1, "", `${message(error)}\r\n`);
    }
  }

  private dosMutationTargets(sources: readonly string[]): readonly string[] {
    const targets = new Map<string, string>();
    for (const source of sources) {
      if (/[*?]/u.test(source)) {
        for (const group of this.dosDirectoryGroups(source, false)) {
          for (const target of group.targets) targets.set(target, target);
        }
      } else {
        const target = this.resolvePath(source);
        if (!this.filesystem.exists(target)) throw new Error("File not found.");
        targets.set(target, target);
      }
      if (targets.size > 512) throw new Error("File match limit exceeded.");
    }
    return [...targets.values()].sort((left, right) =>
      left.localeCompare(right),
    );
  }

  dosDirectory(arguments_: readonly string[]): ShellCommandResult {
    let bare = false;
    let wide = false;
    let recursive = false;
    let path = ".";
    let attributeFilters: readonly (readonly [number, boolean])[] = [
      [dosFatAttribute.hidden, false],
      [dosFatAttribute.system, false],
    ];
    for (const argument of arguments_) {
      const option = argument.toUpperCase();
      if (option === "/B") bare = true;
      else if (option === "/W") wide = true;
      else if (option === "/S") recursive = true;
      else if (option === "/A") attributeFilters = [];
      else if (option.startsWith("/A:")) {
        const parsed = parseDosAttributeFilter(option.slice(3));
        if (parsed === undefined)
          return status(2, "", `Invalid switch - ${argument}\r\n`);
        attributeFilters = parsed;
      } else if (argument.startsWith("/")) {
        return status(2, "", `Invalid switch - ${argument}\r\n`);
      } else if (path === ".") path = argument;
      else return status(2, "", "Too many parameters.\r\n");
    }
    let groups: readonly DosDirectoryGroup[];
    try {
      groups = this.dosDirectoryGroups(path, recursive);
      groups = groups.map((group) => ({
        ...group,
        targets: group.targets.filter((target) =>
          this.matchesDosAttributeFilters(target, attributeFilters),
        ),
      }));
    } catch (error: unknown) {
      return status(1, "", `${message(error)}\r\n`);
    }
    const targets = groups.flatMap(({ targets: entries }) => entries);
    if (targets.length === 0) return status(1, "", "File not found.\r\n");
    if (bare) {
      return success(
        `${targets
          .map((target) =>
            recursive
              ? this.options.profile.pathDialect.display(target)
              : baseName(target).toUpperCase(),
          )
          .join("\r\n")}\r\n`,
      );
    }
    const rows: string[] = [];
    let fileCount = 0;
    let fileBytes = 0;
    let directoryCount = 0;
    for (const group of groups) {
      if (groups.length > 1) {
        if (rows.length > 0) rows.push("");
        rows.push(
          ` Directory of ${this.options.profile.pathDialect.display(group.directory)}`,
          "",
        );
      }
      if (wide) {
        const cells: string[] = [];
        for (const target of group.targets) {
          const directoryEntry = this.filesystem.isDirectory(target);
          if (directoryEntry) directoryCount += 1;
          else {
            fileCount += 1;
            fileBytes += this.filesystem.getSize(target);
          }
          cells.push(
            `${directoryEntry ? `[${baseName(target).toUpperCase()}]` : baseName(target).toUpperCase()}`.padEnd(
              16,
            ),
          );
        }
        for (let index = 0; index < cells.length; index += 5) {
          rows.push(
            cells
              .slice(index, index + 5)
              .join("")
              .trimEnd(),
          );
        }
        continue;
      }
      for (const target of group.targets) {
        const name = baseName(target);
        const displayName = formatDosDirectoryName(name);
        const directoryEntry = this.filesystem.isDirectory(target);
        const metadata = this.filesystem.getMetadata(target);
        const fatMetadata =
          this.ensureDosFatMetadata(target) ??
          migrateDosFatMetadata(metadata, {
            kind: directoryEntry ? "directory" : "file",
            modifiedAtMilliseconds: metadata.modifiedAtMilliseconds,
          });
        const timestamp = this.dosDirectoryTimestamp(
          fatMetadata.modifiedAtMilliseconds,
        );
        if (directoryEntry) {
          directoryCount += 1;
          rows.push(`${displayName} ${"<DIR>".padEnd(13)} ${timestamp}`);
        } else {
          const size = this.filesystem.getSize(target);
          fileCount += 1;
          fileBytes += size;
          rows.push(
            `${displayName} ${formatDosDecimal(size).padStart(13)} ${timestamp}`,
          );
        }
      }
    }
    const firstDirectory = groups[0]!.directory;
    const driveLetter =
      /^\/drives\/([a-z])(?:\/|$)/u.exec(firstDirectory)?.[1]?.toUpperCase() ??
      "C";
    const drive = this.dosRuntime?.driveState(driveLetter);
    const volume = this.dosVolumeLines(driveLetter, drive?.volumeLabel);
    return success(
      [
        ...volume,
        ...(groups.length === 1
          ? [
              ` Directory of ${this.options.profile.pathDialect.display(firstDirectory)}`,
              "",
            ]
          : []),
        ...rows,
        `${String(fileCount).padStart(9)} file(s) ${formatDosDecimal(fileBytes).padStart(14)} bytes`,
        `${String(directoryCount).padStart(9)} dir(s)  ${formatDosDecimal(this.filesystem.getFreeSpace()).padStart(14)} bytes free`,
        "",
      ].join("\r\n"),
    );
  }

  private matchesDosAttributeFilters(
    path: string,
    filters: readonly (readonly [number, boolean])[],
  ): boolean {
    const metadata = this.ensureDosFatMetadata(path);
    if (metadata === undefined) return true;
    return filters.every(
      ([attribute, expected]) =>
        hasDosFatAttribute(metadata.attributes, attribute) === expected,
    );
  }

  private dosDirectoryGroups(
    source: string,
    recursive: boolean,
  ): readonly DosDirectoryGroup[] {
    const slashSource = source.replaceAll("\\", "/");
    const wildcard = /[*?]/u.test(slashSource);
    let root: string;
    let pattern: string;
    if (wildcard) {
      const slash = slashSource.lastIndexOf("/");
      const driveRelative =
        slash < 0 ? /^([A-Za-z]:)(.*)$/u.exec(slashSource) : null;
      const directorySource =
        slash >= 0
          ? slashSource.slice(0, slash) || "/"
          : (driveRelative?.[1] ?? ".");
      pattern =
        slash >= 0
          ? slashSource.slice(slash + 1)
          : (driveRelative?.[2] ?? slashSource);
      if (/[*?]/u.test(directorySource))
        throw new Error("Wildcards are not allowed in directory names.");
      root = this.resolvePath(directorySource);
      if (!this.filesystem.isDirectory(root))
        throw new Error("The system cannot find the path specified.");
    } else {
      const resolved = this.resolvePath(source);
      if (!this.filesystem.exists(resolved)) throw new Error("File not found.");
      if (!this.filesystem.isDirectory(resolved)) {
        return [{ directory: parentPath(resolved), targets: [resolved] }];
      }
      root = resolved;
      pattern = "*.*";
    }

    const groups: DosDirectoryGroup[] = [];
    const pending: { readonly depth: number; readonly directory: string }[] = [
      { depth: 0, directory: root },
    ];
    let scanned = 0;
    while (pending.length > 0) {
      const current = pending.pop()!;
      if (current.depth > 32)
        throw new Error("Directory depth limit exceeded.");
      const names = this.filesystem.list(current.directory);
      scanned += names.length;
      if (scanned > 512) throw new Error("Directory entry limit exceeded.");
      const matches = expandDosFileSpec(names, pattern, {
        maximumEntries: 512,
        maximumMatches: 512,
      });
      const actual = new Map(names.map((name) => [name.toUpperCase(), name]));
      groups.push({
        directory: current.directory,
        targets: matches.map((name) =>
          joinPath(current.directory, actual.get(name) ?? name.toLowerCase()),
        ),
      });
      if (!recursive) continue;
      const directories = names
        .map((name) => joinPath(current.directory, name))
        .filter(
          (target) =>
            this.filesystem.isDirectory(target) &&
            !this.filesystem.isSymbolicLink(target),
        );
      for (let index = directories.length - 1; index >= 0; index -= 1) {
        pending.push({
          depth: current.depth + 1,
          directory: directories[index]!,
        });
      }
    }
    return groups;
  }

  private dosDirectoryTimestamp(milliseconds: number): string {
    const date = new Date(milliseconds);
    const hour = date.getUTCHours();
    const hour12 = hour % 12 || 12;
    return `${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}-${String(date.getUTCFullYear()).slice(-2)}  ${String(hour12).padStart(2)}:${String(date.getUTCMinutes()).padStart(2, "0")}${hour < 12 ? "a" : "p"}`;
  }

  isKnownCommand(name: string): boolean {
    return this.installedSystemUtility(name) !== undefined;
  }

  runQBasicSource(sourceName: string, source: string): ShellCommandResult {
    return this.buildDosIdeSource("basic", sourceName, source, undefined, true);
  }

  runQBasicSourceForEditor(
    sourceName: string,
    source: string,
  ): ShellToolchainCommandResult {
    return this.buildDosIdeSourceForEditor(
      "basic",
      sourceName,
      source,
      undefined,
      true,
    );
  }

  runToolchainIdeSource(
    language: "asm" | "c" | "cpp",
    sourceName: string,
    source: string,
  ): ShellCommandResult {
    return this.buildDosIdeSource(
      language,
      sourceName,
      source,
      undefined,
      true,
    );
  }

  buildDosIdeSource(
    language: "asm" | "basic" | "c" | "cpp",
    sourceName: string,
    source: string,
    outputPath: string,
    runAfterCompile: boolean,
  ): ShellCommandResult;
  buildDosIdeSource(
    language: "asm" | "basic" | "c" | "cpp",
    sourceName: string,
    source: string,
    outputPath: string | undefined,
    runAfterCompile: true,
  ): ShellCommandResult;
  buildDosIdeSource(
    language: "asm" | "basic" | "c" | "cpp",
    sourceName: string,
    source: string,
    outputPath: string | undefined,
    runAfterCompile: boolean,
  ): ShellCommandResult {
    if (source.length > 128_000) {
      return this.toolchainFailure(
        language === "basic" ? "qbasic" : language,
        "source limit exceeded",
      );
    }
    if (!runAfterCompile && outputPath === undefined) {
      throw new Error("WorkBench build output is missing");
    }
    const command =
      language === "basic"
        ? "qbasic"
        : language === "asm"
          ? "as"
          : language === "cpp"
            ? "c++"
            : "c";
    const cOptions =
      language === "c" || language === "cpp"
        ? this.parseCFamilyCommandOptions([], language)
        : undefined;
    if (this.options.deferGuestExecution === true) {
      return {
        exitCode: 0,
        foreground: {
          command,
          credentials: this.options.credentials(),
          kind: "compile",
          task: {
            compileOnly: false,
            kind: "source",
            language,
            outputPath,
            runAfterCompile,
            source,
            sourceName,
            ...(language === "asm"
              ? {
                  assemblerDialect: this.options.profile.id,
                  assemblerHome:
                    this.environment.get("HOME") ?? this.options.profile.home,
                }
              : cOptions === undefined
                ? {}
                : {
                    cDataModel: cOptions.dataModel,
                    cDefinitions: cOptions.definitions,
                    cIncludePaths: cOptions.includePaths,
                    cUndefines: cOptions.undefines,
                  }),
          },
          umask: this.filesystem.getUmask(),
        },
        stderr: "",
        stdout: "",
      };
    }
    const includeBytesBefore = this.ioReadBytes;
    const executable =
      language === "asm"
        ? assembleCs486(source, this.assemblerOptions(sourceName))
        : compileCs486Source(
            language,
            source,
            cOptions === undefined
              ? { sourceName }
              : this.cFamilyFrontendOptions(
                  sourceName,
                  cOptions.includePaths,
                  cOptions.definitions,
                  cOptions.undefines,
                  cOptions.optimizationLevel,
                  cOptions.dataModel,
                ),
          );
    const compileCycles = Math.max(
      1,
      Math.ceil((source.length + this.ioReadBytes - includeBytesBefore) / 4) +
        executable.instructions.length * 4,
    );
    if (outputPath !== undefined) {
      this.writeFile(outputPath, `CS486\n${JSON.stringify(executable)}`);
    }
    if (runAfterCompile) {
      return this.executeCs486(executable, false, compileCycles);
    }
    return {
      cpuCycles: Math.min(1_000_000, compileCycles),
      exitCode: 0,
      stderr: "",
      stdout: "",
    };
  }

  buildDosIdeSourceForEditor(
    language: "asm" | "basic" | "c" | "cpp",
    sourceName: string,
    source: string,
    outputPath: string | undefined,
    runAfterCompile: boolean,
  ): ShellToolchainCommandResult {
    return this.captureToolchainResult(
      () =>
        this.buildDosIdeSource(
          language,
          sourceName,
          source,
          outputPath,
          runAfterCompile as true,
        ),
      language === "basic" ? "qbasic" : language,
      sourceName,
    );
  }

  compileDosIdeFileForEditor(
    language: "asm" | "c" | "cpp",
    sourceName: string,
    outputPath: string,
  ): ShellToolchainCommandResult {
    return this.captureToolchainResult(
      () =>
        this.compileExecutable(language, [sourceName, "-c", "-o", outputPath]),
      language === "asm" ? "as" : language,
      sourceName,
    );
  }

  buildDosProgramList(
    projectInput: string,
    rebuildAll = false,
    runAfterBuild = false,
    executeDeferred = false,
  ): ShellCommandResult {
    return this.renderToolchainCommandResult(
      this.buildDosProgramListForEditor(
        projectInput,
        rebuildAll,
        runAfterBuild,
        executeDeferred,
      ),
    );
  }

  buildDosProgramListForEditor(
    projectInput: string,
    rebuildAll = false,
    runAfterBuild = false,
    executeDeferred = false,
  ): ShellToolchainCommandResult {
    if (this.options.deferGuestExecution === true && !executeDeferred) {
      return {
        exitCode: 0,
        foreground: {
          command: "pwb",
          credentials: this.options.credentials(),
          kind: "compile",
          task: {
            execute: (): ShellToolchainCommandResult => {
              const built = this.buildDosProgramListForEditor(
                projectInput,
                rebuildAll,
                false,
                true,
              );
              if (!runAfterBuild || built.exitCode !== 0) return built;
              const { outputPath } = this.inspectDosProgramList(projectInput);
              const run = this.execute(["run", outputPath], "");
              return {
                cpuCycles:
                  (built.cpuCycles ?? 0) + (run.cpuCycles ?? 0) || undefined,
                exitCode: run.exitCode,
                ...(run.foreground === undefined
                  ? {}
                  : { foreground: run.foreground }),
                transcript: concatGuestToolchainTranscripts([
                  built.transcript,
                  guestToolchainTranscriptFromStreams(run.stdout, run.stderr),
                ]),
              };
            },
            kind: "program-list",
          },
          umask: this.filesystem.getUmask(),
        },
        transcript: emptyGuestToolchainTranscript(),
      };
    }
    try {
      if (this.options.profile.id !== "dos") {
        throw new Error("Program Lists are available only in CS-DOS");
      }
      const projectPath = this.resolvePath(projectInput);
      const projectSource = this.readFile(projectPath);
      const program = parseCsDosProgramList(projectSource);
      const baseDirectory = parentPath(projectPath);
      const metadataPath = this.filesystem.normalize(
        replacePathExtension(projectPath, ".cbr"),
      );
      const previous = this.readCsDosBuildRecord(metadataPath, projectPath);
      const previousGenerated = new Set(previous?.generatedPaths ?? []);
      const resolvedSources = program.sources.map((source) => ({
        ...source,
        path: this.resolveProgramPath(baseDirectory, source.path),
      }));
      const resolvedUserObjects = program.objectPaths.map((path) =>
        this.resolveProgramPath(baseDirectory, path),
      );
      const resolvedIncludePaths = program.includePaths.map((path) =>
        this.resolveProgramPath(baseDirectory, path),
      );
      const outputPath = this.resolveProgramPath(
        baseDirectory,
        program.outputPath,
      );
      const listingPath =
        program.listingPath === undefined
          ? undefined
          : this.resolveProgramPath(baseDirectory, program.listingPath);
      const mapPath =
        program.mapPath === undefined
          ? undefined
          : this.resolveProgramPath(baseDirectory, program.mapPath);
      const generatedObjectPaths = resolvedSources.map((source) =>
        this.resolveProgramPath(
          baseDirectory,
          `${dosSourceBasename(source.path)}.OBJ`,
        ),
      );
      const generatedPaths = [
        ...generatedObjectPaths,
        outputPath,
        ...(listingPath === undefined ? [] : [listingPath]),
        ...(mapPath === undefined ? [] : [mapPath]),
      ];
      const generatedPathSet = new Set(generatedPaths);
      const authoredPaths = new Set([
        projectPath,
        ...resolvedSources.map(({ path }) => path),
        ...resolvedUserObjects,
      ]);
      if (generatedPathSet.size !== generatedPaths.length) {
        throw new Error("generated outputs collide after DOS path resolution");
      }
      if (
        authoredPaths.has(metadataPath) ||
        generatedPathSet.has(metadataPath)
      ) {
        throw new Error(
          `build record path collides with a project path: ${metadataPath}`,
        );
      }
      for (const path of generatedPaths) {
        if (authoredPaths.has(path)) {
          throw new Error(
            `generated output collides with authored input: ${path}`,
          );
        }
        if (this.filesystem.exists(path) && !previousGenerated.has(path)) {
          throw new Error(
            `generated output already exists and is not project-owned: ${path}`,
          );
        }
      }

      const objects: Cs486Object[] = [];
      const generatedObjects = new Map<string, string>();
      const units: Record<string, CsDosBuildUnitRecord> = {};
      const fingerprintInputs = [
        { contents: projectSource, path: projectPath },
      ];
      const results: string[] = [];
      for (const [index, source] of resolvedSources.entries()) {
        const contents = this.readFile(source.path);
        const dependencies = [{ contents, path: source.path }];
        let frontendOptions: Cs486CFrontendOptions | undefined;
        if (source.language === "c" || source.language === "cpp") {
          const optionArguments = [
            ...resolvedIncludePaths.flatMap((path) => ["-I", path]),
            ...program.definitions.map(({ name, replacement }) =>
              replacement === undefined
                ? `-D${name}`
                : `-D${name}=${replacement}`,
            ),
            ...program.undefines.map((name) => `-U${name}`),
          ];
          const parsed = this.parseCFamilyCommandOptions(
            optionArguments,
            source.language,
          );
          const baseOptions = this.cFamilyFrontendOptions(
            source.path,
            parsed.includePaths,
            parsed.definitions,
            parsed.undefines,
            parsed.optimizationLevel,
            parsed.dataModel,
          );
          frontendOptions = {
            ...baseOptions,
            include: (request): Cs486CPreprocessorInclude | undefined => {
              const included = baseOptions.include?.(request);
              if (
                included !== undefined &&
                !dependencies.some(({ path }) => path === included.sourceName)
              ) {
                dependencies.push({
                  contents: included.source,
                  path: included.sourceName,
                });
              }
              return included;
            },
          };
          preprocessCs486C(contents, frontendOptions);
        }
        fingerprintInputs.push(...dependencies);
        const unitFingerprint = fingerprintCsDosProgram(
          program,
          dependencies,
          `CS-DOS-${source.language.toUpperCase()}-1.0`,
        );
        const objectPath = generatedObjectPaths[index]!;
        const previousUnit = previous?.units[source.path];
        let object: Cs486Object;
        let encodedObject: string;
        if (
          !rebuildAll &&
          previousUnit?.fingerprint === unitFingerprint &&
          previousUnit.objectPath === objectPath &&
          this.filesystem.exists(objectPath)
        ) {
          encodedObject = this.readFile(objectPath);
          if (sha256Hex(encodedObject) !== previousUnit.objectDigest) {
            throw new Error(
              `cached object changed outside WorkBench: ${objectPath}`,
            );
          }
          object = this.readCs486Object(objectPath);
          results.push(
            `Reused ${this.options.profile.pathDialect.display(objectPath)}`,
          );
        } else {
          object =
            source.language === "asm"
              ? assembleCs486Object(
                  contents,
                  this.assemblerOptions(source.path),
                )
              : compileCs486Object(
                  source.language,
                  contents,
                  frontendOptions ?? { sourceName: source.path },
                );
          encodedObject = `CS486OBJ\n${JSON.stringify(object)}`;
          generatedObjects.set(objectPath, encodedObject);
          results.push(
            `Compiled ${this.options.profile.pathDialect.display(source.path)}`,
          );
        }
        units[source.path] = {
          fingerprint: unitFingerprint,
          objectDigest: sha256Hex(encodedObject),
          objectPath,
        };
        objects.push(object);
      }
      for (const path of resolvedUserObjects) {
        const encoded = this.readFile(path);
        fingerprintInputs.push({ contents: encoded, path });
        objects.push(this.readCs486Object(path));
        results.push(`Input ${this.options.profile.pathDialect.display(path)}`);
      }

      const executable = linkCs486Objects(objects, { entry: program.entry });
      const fingerprint = fingerprintCsDosProgram(program, fingerprintInputs);
      const record: CsDosBuildRecord = {
        fingerprint,
        generatedPaths,
        projectPath,
        units,
        version: 1,
      };
      const listing =
        listingPath === undefined
          ? undefined
          : renderCsNativeListing(resolvedSources, objects);
      const symbolMap =
        mapPath === undefined
          ? undefined
          : renderCsNativeMap(program.entry, executable);
      this.runDosFilesystemTransaction(() => {
        for (const path of previous?.generatedPaths ?? []) {
          if (
            !generatedPathSet.has(path) &&
            !authoredPaths.has(path) &&
            this.filesystem.exists(path)
          ) {
            this.filesystem.delete(path);
          }
        }
        for (const [path, encoded] of generatedObjects) {
          this.writeFile(path, encoded);
        }
        this.writeFile(outputPath, `CS486\n${JSON.stringify(executable)}`);
        if (listingPath !== undefined && listing !== undefined) {
          this.writeFile(listingPath, listing);
        }
        if (mapPath !== undefined && symbolMap !== undefined) {
          this.writeFile(mapPath, symbolMap);
        }
        this.writeFile(
          metadataPath,
          `${csDosBuildRecordMarker}${JSON.stringify(record)}`,
        );
      });
      results.push(
        `Linked ${this.options.profile.pathDialect.display(outputPath)} fingerprint ${fingerprint.slice(0, 12)}`,
      );
      return {
        exitCode: 0,
        transcript: guestToolchainTranscriptFromStreams(
          `${results.join("\r\n")}\r\n`,
          "",
        ),
      };
    } catch (error: unknown) {
      return this.toolchainErrorResult(error, "PWB", projectInput);
    }
  }

  cleanDosProgramList(projectInput: string): ShellCommandResult {
    try {
      const projectPath = this.resolvePath(projectInput);
      const metadataPath = this.filesystem.normalize(
        replacePathExtension(projectPath, ".cbr"),
      );
      const record = this.readCsDosBuildRecord(metadataPath, projectPath);
      if (record === undefined) {
        throw new Error(
          "no WorkBench build record exists for this Program List",
        );
      }
      const program = parseCsDosProgramList(this.readFile(projectPath));
      const baseDirectory = parentPath(projectPath);
      const authored = new Set([
        projectPath,
        ...program.sources.map(({ path }) =>
          this.resolveProgramPath(baseDirectory, path),
        ),
        ...program.objectPaths.map((path) =>
          this.resolveProgramPath(baseDirectory, path),
        ),
      ]);
      this.runDosFilesystemTransaction(() => {
        for (const path of record.generatedPaths) {
          if (authored.has(path)) {
            throw new Error(`refusing to clean authored input ${path}`);
          }
          if (this.filesystem.exists(path)) this.filesystem.delete(path);
        }
        if (this.filesystem.exists(metadataPath)) {
          this.filesystem.delete(metadataPath);
        }
      });
      return success(
        `Cleaned ${String(record.generatedPaths.length)} project-owned output(s)\r\n`,
      );
    } catch (error: unknown) {
      return this.toolchainFailure("PWB", message(error));
    }
  }

  inspectDosProgramList(projectInput: string): {
    readonly listingPath?: string;
    readonly mapPath?: string;
    readonly outputPath: string;
    readonly projectPath: string;
  } {
    const projectPath = this.resolvePath(projectInput);
    const program = parseCsDosProgramList(this.readFile(projectPath));
    const baseDirectory = parentPath(projectPath);
    return {
      listingPath:
        program.listingPath === undefined
          ? undefined
          : this.resolveProgramPath(baseDirectory, program.listingPath),
      mapPath:
        program.mapPath === undefined
          ? undefined
          : this.resolveProgramPath(baseDirectory, program.mapPath),
      outputPath: this.resolveProgramPath(baseDirectory, program.outputPath),
      projectPath,
    };
  }

  browseDosFiles(directoryInput: string): DosFileDialogSnapshot {
    const directory = this.resolvePath(directoryInput);
    const displayDirectory =
      this.options.profile.pathDialect.display(directory);
    const mediaGeneration = this.dosFileDialogGeneration(directory);
    try {
      if (
        !this.filesystem.exists(directory) ||
        !this.filesystem.isDirectory(directory) ||
        this.filesystem.isSymbolicLink(directory)
      ) {
        throw new Error("Directory not found.");
      }
      const names = this.filesystem.list(directory);
      if (names.length > 256) {
        throw new Error("Directory entry limit exceeded.");
      }
      const entries = names.map((name) => {
        if (!dosShortDisplayNamePattern.test(name)) {
          throw new Error(`Directory contains invalid DOS 8.3 name: ${name}`);
        }
        const fileName = joinPath(directory, name);
        const directoryEntry = this.filesystem.isDirectory(fileName);
        return {
          displayName: name.toUpperCase(),
          fileName,
          kind: directoryEntry ? ("directory" as const) : ("file" as const),
          size: directoryEntry ? 0 : this.filesystem.getSize(fileName),
        };
      });
      entries.sort(
        (left, right) =>
          (left.kind === right.kind ? 0 : left.kind === "directory" ? -1 : 1) ||
          (left.displayName < right.displayName
            ? -1
            : left.displayName > right.displayName
              ? 1
              : 0),
      );
      const generationAfter = this.dosFileDialogGeneration(directory);
      if (generationAfter !== mediaGeneration) {
        throw new Error("Media changed while reading the directory.");
      }
      return {
        directory,
        displayDirectory,
        drives: ["C:", "A:"],
        entries,
        mediaGeneration,
      };
    } catch (error: unknown) {
      return {
        directory,
        displayDirectory,
        drives: ["C:", "A:"],
        entries: [],
        error: message(error),
        mediaGeneration,
      };
    }
  }

  private dosFileDialogGeneration(directory: string): number {
    const letter =
      /^\/drives\/([a-z])(?:\/|$)/u.exec(directory)?.[1]?.toUpperCase() ?? "C";
    if (letter === "A" && this.options.floppyDrive !== undefined) {
      return (
        this.options.floppyDrive.media?.instanceGeneration ??
        this.dosRuntime?.driveState("A").mediaGeneration ??
        0
      );
    }
    return this.dosRuntime?.driveState(letter).mediaGeneration ?? 0;
  }

  private resolveProgramPath(baseDirectory: string, input: string): string {
    return this.filesystem.normalize(
      this.options.profile.pathDialect.resolve(
        input,
        baseDirectory,
        this.environment.get("HOME") ?? this.options.profile.home,
      ),
    );
  }

  private readCsDosBuildRecord(
    metadataPath: string,
    projectPath: string,
  ): CsDosBuildRecord | undefined {
    if (!this.filesystem.exists(metadataPath)) return undefined;
    const encoded = this.readFile(metadataPath);
    if (
      encoded.length > 256_000 ||
      !encoded.startsWith(csDosBuildRecordMarker)
    ) {
      throw new Error("invalid WorkBench build record");
    }
    let decoded: unknown;
    try {
      decoded = JSON.parse(encoded.slice(csDosBuildRecordMarker.length));
    } catch {
      throw new Error("invalid WorkBench build record");
    }
    if (!isCsDosBuildRecord(decoded, projectPath)) {
      throw new Error("invalid WorkBench build record");
    }
    return decoded;
  }

  private dispatch(
    command: string,
    arguments_: readonly string[],
    stdin: string,
  ): ShellCommandResult {
    if (command.includes("/") || command.startsWith(".")) {
      return this.runExecutable([command, ...arguments_]);
    }
    switch (command) {
      case "help":
        return success(
          [
            "Computer System BusyBox shell",
            "files: pwd cd ls cat mkdir rmdir touch rm cp mv ln readlink realpath find du quota",
            "text: echo printf head tail wc grep sed awk sort uniq tr nl",
            "text+: tee cmp diff sha256sum md5sum base64 od hexdump xargs",
            "shell: sh bash source env printenv export unset alias unalias command read local shift getopts",
            "system: clear vi more less crontab shutdown reboot exit login logout passwd su sudo true false",
            "accounts: useradd userdel usermod groupadd groupdel getent groups umask",
            "process: ps top kill pgrep pkill killall jobs fg bg wait nice nohup watch service",
            "sessions: tty who w last",
            "info: whoami id hostname uname date uptime stat df du quota man apropos",
            "hardware: cpuinfo free mount dmesg spi i2c /proc/cpuinfo /proc/meminfo",
            "archive: tar gzip gunzip zip unzip",
            "utility: history time sleep seq cut test [",
            "toolchain: as cc c++ ld make nm run objdump csdb",
            "version control: git (local repositories; remote transport unavailable)",
            "syntax: |  >  >>  <  &&  ||  ;  '...'  \"...\"  $VAR  $?",
          ].join("\n") + "\n",
        );
      case "pwd":
        return arguments_.length === 0
          ? success(
              `${this.options.profile.pathDialect.display(this.currentDirectory)}\n`,
            )
          : usage("pwd");
      case "cd":
        return this.changeDirectory(arguments_);
      case "ls":
        return this.list(arguments_);
      case "cat":
        return this.cat(arguments_, stdin);
      case "awk":
        return this.linuxAwk(arguments_, stdin);
      case "sed":
        return this.linuxSed(arguments_, stdin);
      case "crontab":
        return this.linuxCrontab(arguments_);
      case "echo":
        return this.echo(arguments_);
      case "printf":
        return this.printf(arguments_);
      case "mkdir":
        return this.makeDirectories(arguments_);
      case "touch":
        return this.touch(arguments_);
      case "rm":
        return this.remove(arguments_);
      case "cp":
        return this.copy(arguments_);
      case "mv":
        return this.move(arguments_);
      case "head":
        return this.headOrTail("head", arguments_, stdin);
      case "tail":
        return this.headOrTail("tail", arguments_, stdin);
      case "tar":
      case "zip":
      case "unzip":
        return this.linuxArchiveCommand(command, arguments_);
      case "wc":
        return this.wordCount(arguments_, stdin);
      case "grep":
        return this.grep(arguments_, stdin);
      case "gzip":
      case "gunzip":
        return this.linuxArchiveCommand(command, arguments_);
      case "nohup":
        return failure(
          "nohup",
          "use nohup {sleep|python|micropython|run} ... &",
          2,
        );
      case "sort":
        return this.sort(arguments_, stdin);
      case "uniq":
        return this.uniq(arguments_, stdin);
      case "tr":
        return this.translate(arguments_, stdin);
      case "find":
        return this.find(arguments_);
      case "basename":
        return arguments_.length === 1
          ? success(`${baseName(this.resolvePath(arguments_[0]!))}\n`)
          : usage("basename <path>");
      case "dirname":
        return arguments_.length === 1
          ? success(`${parentPath(this.resolvePath(arguments_[0]!))}\n`)
          : usage("dirname <path>");
      case "whoami":
        return arguments_.length === 0
          ? success(`${this.options.credentials().loginName}\n`)
          : usage("whoami");
      case "id":
        return this.linuxId(arguments_);
      case "hostname":
        return arguments_.length === 0
          ? success(`${this.options.computerName}\n`)
          : usage("hostname");
      case "uname":
        return this.uname(arguments_);
      case "ps":
        return this.linuxProcesses(arguments_);
      case "top":
        return this.linuxTop(arguments_);
      case "kill":
        return this.linuxKill(arguments_);
      case "pgrep":
        return this.linuxPgrep(arguments_);
      case "pkill":
        return this.linuxPkill(arguments_);
      case "killall":
        return this.linuxKillAll(arguments_);
      case "jobs":
        return this.linuxJobs(arguments_);
      case "fg":
        return this.linuxForegroundJob(arguments_);
      case "bg":
        return this.linuxBackgroundJob(arguments_);
      case "wait":
        return this.linuxWait(arguments_);
      case "tty":
        return this.linuxTty(arguments_);
      case "who":
        return this.linuxWho(arguments_);
      case "w":
        return this.linuxW(arguments_);
      case "last":
        return this.linuxLast(arguments_);
      case "service":
        return this.linuxService(arguments_);
      case "telinit":
        return this.linuxTelinit(arguments_);
      case "runlevel":
        return this.linuxRunlevel(arguments_);
      case "cs-init-ctl":
        return this.linuxInitCtl(arguments_);
      case "man":
        return this.linuxMan(arguments_);
      case "apropos":
        return this.linuxApropos(arguments_);
      case "date":
        return this.date(arguments_);
      case "time":
        return this.commandNotFound(command);
      case "cpuinfo":
        return this.cpuInfo(arguments_);
      case "free":
        return this.freeMemory(arguments_);
      case "spi":
        return this.spiCommand(arguments_);
      case "i2c":
        return this.i2cCommand(arguments_);
      case "cpu":
      case "mem":
      case "systeminfo":
      case "tree":
      case "vol":
        return this.commandNotFound(command);
      case "chmod":
        return this.linuxChangeMode(arguments_);
      case "chown":
        return this.linuxChangeOwner(arguments_, true);
      case "chgrp":
        return this.linuxChangeOwner(arguments_, false);
      case "cmp":
        return this.linuxCompare(arguments_);
      case "diff":
        return this.linuxDiff(arguments_);
      case "git":
        return this.linuxGit(arguments_);
      case "dmesg":
        return this.linuxDmesg(arguments_);
      case "file":
        return this.linuxFile(arguments_);
      case "groups":
        return this.linuxGroups(arguments_);
      case "umask":
        return this.linuxUmask(arguments_);
      case "hexdump":
      case "od":
        return this.linuxHexDump(command, arguments_, stdin);
      case "ln":
        return this.linuxLink(arguments_);
      case "mktemp":
        return this.linuxMakeTemporary(arguments_);
      case "mount":
        return this.linuxMount(arguments_);
      case "umount":
        return this.linuxUnmount(arguments_);
      case "eject":
        return this.linuxEject(arguments_);
      case "mkfs.fat":
        return this.linuxFormatFloppy(arguments_);
      case "printenv":
        return this.linuxPrintEnvironment(arguments_);
      case "readlink":
        return this.linuxReadLink(arguments_);
      case "realpath":
        return this.linuxRealPath(arguments_);
      case "rmdir":
        return this.linuxRemoveDirectory(arguments_);
      case "sha256sum":
        return this.linuxSha256Sum(arguments_, stdin);
      case "md5sum":
        return this.linuxMd5Sum(arguments_, stdin);
      case "base64":
        return this.linuxBase64(arguments_, stdin);
      case "nl":
        return this.linuxNumberLines(arguments_, stdin);
      case "sync":
        if (arguments_.length !== 0) return usage("sync");
        if (this.options.syncFilesystem === undefined)
          return failure("sync", "persistence boundary is unavailable", 1);
        this.options.syncFilesystem();
        return success();
      case "tee":
        return this.linuxTee(arguments_, stdin);
      case "xargs":
        return this.linuxXargs(arguments_, stdin);
      case "yes":
        return this.linuxYes(arguments_);
      case "as":
        return this.compileExecutable("asm", arguments_);
      case "ar":
        return this.staticArchive(arguments_);
      case "cc":
        return this.compileExecutable("c", arguments_);
      case "c++":
        return this.compileExecutable("cpp", arguments_);
      case "run":
        return this.runExecutable(arguments_);
      case "ranlib":
        return this.refreshStaticArchive(arguments_);
      case "csdb":
        return this.debugExecutable(arguments_);
      case "objdump":
        return this.objectDump(arguments_);
      case "ld":
        return this.linkObjects(arguments_);
      case "make":
        return failure("make", "internal dispatch is unavailable", 2);
      case "nm":
        return this.listSymbols(arguments_);
      case "path":
      case "prompt":
      case "rem":
      case "set":
        return this.commandNotFound(command);
      case "uptime":
        return this.linuxUptime(arguments_);
      case "vmstat":
        return this.linuxVmstat(arguments_);
      case "sleep":
        return this.sleep(arguments_);
      case "seq":
        return this.sequence(arguments_);
      case "cut":
        return this.cut(arguments_, stdin);
      case "stat":
        return this.stat(arguments_);
      case "df":
        return this.diskFree(arguments_);
      case "du":
        return this.diskUsage(arguments_);
      case "quota":
        return this.quota(arguments_);
      case "test":
      case "[":
        return this.test(command, arguments_);
      case "env":
      case "export":
        return this.environmentCommand(command, arguments_);
      case "unset":
        return this.unset(arguments_);
      case "which":
      case "type":
        return this.locate(command, arguments_);
      case "clear":
        return arguments_.length === 0
          ? success("", { action: "clear" })
          : usage("clear");
      case "true":
        return arguments_.length === 0 ? success() : usage("true");
      case "false":
        return arguments_.length === 0 ? status(1) : usage("false");
      case "shutdown":
        return arguments_.length === 0
          ? success("Shutting down\n", { action: "shutdown" })
          : usage("shutdown");
      case "reboot":
        return arguments_.length === 0
          ? success("Rebooting\n", { action: "reboot" })
          : usage("reboot");
      case "exit":
        return success("logout\n", { action: "shutdown" });
      case "edit":
      case "vi":
      case "sh":
      case "bash":
      case "source":
      case "alias":
      case "command":
      case "getopts":
      case "local":
      case "read":
      case "shift":
      case "unalias":
        return failure(command, "internal dispatch is unavailable", 125);
      default:
        return this.commandNotFound(command);
    }
  }

  changeDirectory(arguments_: readonly string[]): ShellCommandResult {
    if (arguments_.length > 1) return usage("cd [directory]");
    const requested = arguments_[0] ?? this.environment.get("HOME") ?? "/";
    const destination =
      requested === "-" ? this.previousDirectory : this.resolvePath(requested);
    if (!this.filesystem.isDirectory(destination)) {
      return failure("cd", `${requested}: not a directory`);
    }
    if (!this.filesystem.hasAccess(destination, filesystemExecute))
      return failure("cd", `${requested}: Permission denied`);
    if (this.dosRuntime !== undefined) {
      const match = /^\/drives\/([a-z])(?:\/(.*))?$/u.exec(destination);
      if (match === null)
        return failure("cd", `${requested}: invalid drive path`);
      const letter = match[1]!.toUpperCase();
      const directory =
        match[2] === undefined || match[2].length === 0
          ? "\\"
          : `\\${match[2].replaceAll("/", "\\")}`;
      const activeDrive = this.dosRuntime.activeDrive;
      this.runDosRuntimeTransaction(() => {
        this.dosRuntime!.setCurrentDirectory(letter, directory);
        if (letter === activeDrive) {
          this.previousDirectory = this.currentDirectory;
          this.currentDirectory = destination;
        }
      });
      return success(
        letter === activeDrive && requested === "-" ? `${destination}\n` : "",
      );
    }
    this.previousDirectory = this.currentDirectory;
    this.currentDirectory = destination;
    return success(requested === "-" ? `${destination}\n` : "");
  }

  private list(arguments_: readonly string[]): ShellCommandResult {
    let long = false;
    let all = false;
    let human = false;
    let directoryEntry = false;
    const paths: string[] = [];
    for (const argument of arguments_) {
      if (argument === "--") {
        continue;
      }
      if (argument.startsWith("-") && argument !== "-") {
        for (const flag of argument.slice(1)) {
          if (flag === "l") long = true;
          else if (flag === "a" || flag === "1") all ||= flag === "a";
          else if (flag === "h") human = true;
          else if (flag === "d") directoryEntry = true;
          else return failure("ls", `invalid option -- '${flag}'`, 2);
        }
      } else paths.push(argument);
    }
    if (paths.length === 0) paths.push(".");
    const sections: string[] = [];
    for (const [index, path] of paths.entries()) {
      const resolved = this.resolvePath(path);
      const resolvedDevice = this.virtualDevice(resolved);
      if (!this.filesystem.exists(resolved) && resolvedDevice === undefined) {
        return failure("ls", `${path}: no such file or directory`);
      }
      const listDirectory =
        this.filesystem.isDirectory(resolved) && !directoryEntry;
      if (listDirectory && !this.filesystem.hasAccess(resolved, 0b101))
        return failure(
          "ls",
          `cannot open directory '${path}': Permission denied`,
          2,
        );
      const names = listDirectory
        ? this.filesystem
            .list(resolved)
            .filter((name) => all || !name.startsWith("."))
        : [baseName(resolved)];
      if (listDirectory) {
        for (const devicePath of this.virtualDevicePaths()) {
          if (parentPath(devicePath) !== resolved) continue;
          const name = baseName(devicePath);
          if ((all || !name.startsWith(".")) && !names.includes(name)) {
            names.push(name);
          }
        }
        names.sort();
        if (all) names.unshift(".", "..");
      }
      const prefix = paths.length > 1 ? `${path}:\n` : "";
      const listing = long
        ? names
            .map((name) => {
              const target = listDirectory
                ? name === "."
                  ? resolved
                  : name === ".."
                    ? parentPath(resolved)
                    : joinPath(resolved, name)
                : resolved;
              const device = this.virtualDevice(target) !== undefined;
              const symbolic = this.filesystem.isSymbolicLink(target);
              const directory =
                !symbolic && this.filesystem.isDirectory(target);
              const size = device
                ? 0
                : symbolic
                  ? utf8ByteLength(this.filesystem.readLink(target))
                  : this.filesystem.getSize(target);
              const metadata = device
                ? {
                    gid: 0,
                    mode: 0o666,
                    modifiedAtMilliseconds: 0,
                    uid: 0,
                  }
                : this.filesystem.getMetadata(target, !symbolic);
              const renderedName = symbolic
                ? `${name} -> ${this.filesystem.readLink(target)}`
                : name;
              return `${linuxModeString(device ? "device" : symbolic ? "link" : directory ? "directory" : "file", metadata.mode)} ${String(device || symbolic ? 1 : this.filesystem.getLinkCount(target)).padStart(2)} ${this.linuxIdentityName(metadata.uid, "user").padEnd(8)} ${this.linuxIdentityName(metadata.gid, "group").padEnd(8)} ${formatLinuxSize(size, human).padStart(8)} ${formatLinuxTimestamp(metadata.modifiedAtMilliseconds)} ${renderedName}`;
            })
            .join("\n")
        : names.map((name) => this.displayName(name)).join("  ");
      const total =
        long && listDirectory
          ? `total ${String(
              names.reduce((sum, name) => {
                if (name === "." || name === "..") return sum;
                const target = joinPath(resolved, name);
                return (
                  sum +
                  (this.virtualDevice(target) === undefined
                    ? this.filesystem.getSize(target)
                    : 0)
                );
              }, 0),
            )}\n`
          : "";
      sections.push(`${index > 0 ? "\n" : ""}${prefix}${total}${listing}`);
    }
    return success(sections.join("") + "\n");
  }

  cat(arguments_: readonly string[], stdin: string): ShellCommandResult {
    let numbered = false;
    const paths: string[] = [];
    for (const argument of arguments_) {
      if (argument === "-n") numbered = true;
      else if (argument.startsWith("-") && argument !== "-") {
        return failure("cat", `invalid option '${argument}'`, 2);
      } else paths.push(argument);
    }
    const sources = paths.length === 0 ? ["-"] : paths;
    let output = "";
    for (const path of sources) {
      output += path === "-" ? stdin : this.readFile(path);
    }
    if (numbered) {
      output = splitLines(output)
        .map((line, index) => `${String(index + 1).padStart(6)}\t${line}`)
        .join("\n");
      if (output.length > 0) output += "\n";
    }
    return success(output);
  }

  private echo(arguments_: readonly string[]): ShellCommandResult {
    const newline = arguments_[0] !== "-n";
    const values = newline ? arguments_ : arguments_.slice(1);
    return success(values.join(" ") + (newline ? "\n" : ""));
  }

  private printf(arguments_: readonly string[]): ShellCommandResult {
    if (arguments_.length === 0)
      return usage("printf <format> [arguments ...]");
    const [format = "", ...values] = arguments_;
    let valueIndex = 0;
    const output = decodeEscapes(format).replace(
      /%([%sd])/gu,
      (_match, specifier: string): string => {
        if (specifier === "%") return "%";
        const value = values[valueIndex++] ?? "";
        if (specifier === "d") {
          const number = Number.parseInt(value, 10);
          return Number.isNaN(number) ? "0" : String(number);
        }
        return value;
      },
    );
    return success(output);
  }

  private spiCommand(arguments_: readonly string[]): ShellCommandResult {
    if (arguments_.length !== 3) {
      return this.protocolUsage("spi <bus> <chip-select> <hex-bytes>");
    }
    const peripherals = this.options.peripherals;
    if (peripherals === undefined) {
      return this.protocolFailure("spi", "controller unavailable");
    }
    try {
      const endpoint = {
        computerId: this.options.computerName,
        face: this.protocolBusFace(arguments_[0]!),
      };
      const chipSelect = protocolInteger(arguments_[1]!);
      const transmit = protocolHexBytes(arguments_[2]!);
      const result = peripherals.transferSpi(endpoint, chipSelect, transmit);
      switch (result.outcome) {
        case "completed":
          return success(
            `${formatProtocolHex(result.receive)}${this.protocolNewline()}`,
          );
        case "chip_select_conflict":
          return this.protocolFailure(
            "spi",
            `chip-select ${String(result.chipSelect)} conflict`,
          );
        case "detached":
          return this.protocolFailure("spi", "no peripheral attached");
        case "deferred":
          return this.protocolFailure(
            "spi",
            `host work budget exhausted; retry after tick ${String(result.retryTick)}`,
          );
        case "missing_computer":
          return this.protocolFailure("spi", "controller unavailable");
        case "powered_off":
          return this.protocolFailure("spi", "controller is powered off");
        case "protocol_error":
          return this.protocolFailure("spi", result.message);
        case "transfer_limit_exceeded":
          return this.protocolFailure(
            "spi",
            `transfer exceeds ${String(result.maximum)} bytes`,
          );
      }
    } catch (error: unknown) {
      return this.protocolFailure("spi", message(error));
    }
  }

  private i2cCommand(arguments_: readonly string[]): ShellCommandResult {
    if (arguments_.length === 2 && arguments_[1]!.toLowerCase() === "scan") {
      const peripherals = this.options.peripherals;
      if (peripherals === undefined) {
        return this.protocolFailure("i2c", "controller unavailable");
      }
      try {
        const result = peripherals.scanI2c({
          computerId: this.options.computerName,
          face: this.protocolBusFace(arguments_[0]!),
        });
        if (result.outcome === "missing_computer") {
          return this.protocolFailure("i2c", "controller unavailable");
        }
        if (result.outcome === "powered_off") {
          return this.protocolFailure("i2c", "controller is powered off");
        }
        if (result.outcome === "deferred") {
          return this.protocolFailure(
            "i2c",
            `host work budget exhausted; retry after tick ${String(result.retryTick)}`,
          );
        }
        if (result.conflicts.length > 0) {
          return this.protocolFailure(
            "i2c",
            `address conflict: ${result.conflicts.map(formatI2cAddress).join(" ")}`,
          );
        }
        return success(
          `${result.addresses.map(formatI2cAddress).join(" ")}${this.protocolNewline()}`,
        );
      } catch (error: unknown) {
        return this.protocolFailure("i2c", message(error));
      }
    }
    if (arguments_.length !== 4) {
      return this.protocolUsage(
        "i2c <bus> scan | i2c <bus> <address> <write-hex|-> <read-length>",
      );
    }
    const peripherals = this.options.peripherals;
    if (peripherals === undefined) {
      return this.protocolFailure("i2c", "controller unavailable");
    }
    try {
      const endpoint = {
        computerId: this.options.computerName,
        face: this.protocolBusFace(arguments_[0]!),
      };
      const address = protocolInteger(arguments_[1]!);
      const write = protocolHexBytes(arguments_[2]!);
      const readLength = protocolInteger(arguments_[3]!);
      const result = peripherals.transactI2c(
        endpoint,
        address,
        write,
        readLength,
      );
      switch (result.outcome) {
        case "completed":
          return success(
            `${formatProtocolHex(result.read)}${this.protocolNewline()}`,
          );
        case "address_conflict":
          return this.protocolFailure(
            "i2c",
            `address ${formatI2cAddress(result.address)} conflict`,
          );
        case "deferred":
          return this.protocolFailure(
            "i2c",
            `host work budget exhausted; retry after tick ${String(result.retryTick)}`,
          );
        case "missing_computer":
          return this.protocolFailure("i2c", "controller unavailable");
        case "nack":
          return this.protocolFailure(
            "i2c",
            `NACK at ${formatI2cAddress(result.address)}`,
          );
        case "powered_off":
          return this.protocolFailure("i2c", "controller is powered off");
        case "protocol_error":
          return this.protocolFailure("i2c", result.message);
        case "transaction_limit_exceeded":
          return this.protocolFailure(
            "i2c",
            `transaction exceeds ${String(result.maximum)} bytes`,
          );
      }
    } catch (error: unknown) {
      return this.protocolFailure("i2c", message(error));
    }
  }

  private protocolBusFace(value: string): MachineFace {
    const bus = protocolInteger(value);
    const index = this.options.profile.id === "dos" ? bus - 1 : bus;
    return machineFaceAt(index);
  }

  private protocolFailure(command: string, detail: string): ShellCommandResult {
    return status(
      1,
      "",
      `${this.options.profile.id === "dos" ? command.toUpperCase() : command}: ${detail}${this.protocolNewline()}`,
    );
  }

  private protocolUsage(value: string): ShellCommandResult {
    const rendered =
      this.options.profile.id === "dos" ? value.toUpperCase() : value;
    return status(2, "", `usage: ${rendered}${this.protocolNewline()}`);
  }

  private protocolNewline(): string {
    return this.options.profile.id === "dos" ? "\r\n" : "\n";
  }

  makeDirectories(arguments_: readonly string[]): ShellCommandResult {
    const recursive = arguments_.includes("-p");
    const paths = arguments_.filter((argument) => argument !== "-p");
    if (paths.length === 0) return usage("mkdir [-p] <directory ...>");
    if (this.options.profile.id === "dos") {
      const plans = paths.map((path) => ({
        path,
        resolved: this.resolvePath(path),
      }));
      const plannedDirectories = new Set<string>();
      const trial = DosRuntimeState.restore(
        this.dosRuntime!.snapshot(),
        this.dosRuntime!.limits,
      );
      for (const { path, resolved } of plans) {
        if (
          !this.filesystem.hasAccess(
            this.closestExistingDirectory(resolved),
            0b011,
          )
        ) {
          return failure(
            "mkdir",
            `cannot create directory '${path}': Permission denied`,
          );
        }
        const parent = parentPath(resolved);
        if (
          !recursive &&
          !this.filesystem.isDirectory(parent) &&
          !plannedDirectories.has(parent)
        ) {
          return failure("mkdir", `${path}: parent directory does not exist`);
        }
        if (
          !recursive &&
          (this.filesystem.exists(resolved) || plannedDirectories.has(resolved))
        ) {
          return failure("mkdir", `${path}: already exists`);
        }
        this.assertDosPathWritableIn(trial, resolved);
        plannedDirectories.add(resolved);
      }
      this.runDosFilesystemTransaction(() => {
        for (const { resolved } of plans) {
          this.assertDosPathWritable(resolved);
          this.filesystem.makeDirectory(resolved);
          this.ensureDosFatMetadata(resolved);
        }
      });
      return success();
    }
    for (const path of paths) {
      const resolved = this.resolvePath(path);
      if (
        !this.filesystem.hasAccess(
          this.closestExistingDirectory(resolved),
          0b011,
        )
      )
        return failure(
          "mkdir",
          `cannot create directory '${path}': Permission denied`,
        );
      if (!recursive && !this.filesystem.isDirectory(parentPath(resolved))) {
        return failure("mkdir", `${path}: parent directory does not exist`);
      }
      if (!recursive && this.filesystem.exists(resolved)) {
        return failure("mkdir", `${path}: already exists`);
      }
      this.filesystem.makeDirectory(resolved);
    }
    return success();
  }

  private touch(arguments_: readonly string[]): ShellCommandResult {
    if (arguments_.length === 0) return usage("touch <file ...>");
    for (const path of arguments_) {
      const resolved = this.resolvePath(path);
      if (this.filesystem.isDirectory(resolved)) {
        return failure("touch", `${path}: is a directory`);
      }
      if (!this.filesystem.exists(resolved)) this.writeFile(path, "");
      else if (!this.filesystem.hasAccess(resolved, 0b010))
        return failure("touch", `cannot touch '${path}': Permission denied`);
      this.filesystem.setModifiedTime(
        resolved,
        this.options.clock.currentWallTimeMilliseconds(),
      );
    }
    return success();
  }

  remove(arguments_: readonly string[]): ShellCommandResult {
    let recursive = false;
    let force = false;
    const paths: string[] = [];
    for (const argument of arguments_) {
      if (argument.startsWith("-") && argument !== "-") {
        for (const flag of argument.slice(1)) {
          if (flag === "r" || flag === "R") recursive = true;
          else if (flag === "f") force = true;
          else return failure("rm", `invalid option -- '${flag}'`, 2);
        }
      } else paths.push(argument);
    }
    if (paths.length === 0) return usage("rm [-rf] <path ...>");
    for (const path of paths) {
      const resolved = this.resolvePath(path);
      if (!this.filesystem.exists(resolved)) {
        if (force) continue;
        return failure("rm", `${path}: no such file or directory`);
      }
      if (this.filesystem.isDirectory(resolved) && !recursive) {
        return failure("rm", `${path}: is a directory`);
      }
      if (!this.filesystem.hasAccess(parentPath(resolved), 0b011))
        return failure("rm", `cannot remove '${path}': Permission denied`);
      this.filesystem.delete(resolved);
    }
    return success();
  }

  copy(arguments_: readonly string[]): ShellCommandResult {
    const recursive = arguments_.includes("-r") || arguments_.includes("-R");
    const paths = arguments_.filter(
      (argument) => argument !== "-r" && argument !== "-R",
    );
    if (paths.length !== 2) return usage("cp [-r] <source> <destination>");
    const source = this.resolvePath(paths[0]!);
    if (this.filesystem.isDirectory(source) && !recursive) {
      return failure("cp", `${paths[0]}: omitting directory`);
    }
    if (!this.filesystem.hasAccess(source, 0b100))
      return failure("cp", `cannot open '${paths[0]}': Permission denied`);
    const destination = this.transferDestination(source, paths[1]!);
    if (!this.filesystem.hasAccess(parentPath(destination), 0b011))
      return failure("cp", `cannot create '${paths[1]}': Permission denied`);
    this.filesystem.copy(source, destination);
    return success();
  }

  move(arguments_: readonly string[]): ShellCommandResult {
    if (arguments_.length !== 2) return usage("mv <source> <destination>");
    const source = this.resolvePath(arguments_[0]!);
    const destination = this.transferDestination(source, arguments_[1]!);
    if (
      !this.filesystem.hasAccess(parentPath(source), 0b011) ||
      !this.filesystem.hasAccess(parentPath(destination), 0b011)
    )
      return failure("mv", "cannot move: Permission denied");
    if (this.options.profile.id === "dos") {
      const trial = DosRuntimeState.restore(
        this.dosRuntime!.snapshot(),
        this.dosRuntime!.limits,
      );
      this.assertDosPathWritableIn(trial, source);
      this.assertDosPathWritableIn(trial, destination);
      const sourceMedia = this.dosMediaForPath(source, trial)!;
      const destinationMedia = this.dosMediaForPath(destination, trial)!;
      trial.moveFatMetadata(
        source,
        destination,
        sourceMedia.generation,
        destinationMedia.generation,
      );
      this.runDosFilesystemTransaction(() => {
        this.assertDosPathWritable(source);
        this.assertDosPathWritable(destination);
        this.filesystem.move(source, destination);
        this.moveDosFatMetadata(source, destination);
      });
      return success();
    }
    this.filesystem.move(source, destination);
    return success();
  }

  private transferDestination(source: string, destination: string): string {
    const resolved = this.resolvePath(destination);
    return this.filesystem.isDirectory(resolved)
      ? joinPath(resolved, baseName(source))
      : resolved;
  }

  private headOrTail(
    command: "head" | "tail",
    arguments_: readonly string[],
    stdin: string,
  ): ShellCommandResult {
    const parsed = parseLineCount(arguments_, command);
    if (parsed.error !== undefined) return parsed.error;
    const sources = parsed.paths.length === 0 ? ["-"] : parsed.paths;
    const sections: string[] = [];
    for (const path of sources) {
      const input = path === "-" ? stdin : this.readFile(path);
      const lines = splitLines(input);
      const selected =
        command === "head"
          ? lines.slice(0, parsed.count)
          : lines.slice(Math.max(0, lines.length - parsed.count));
      sections.push(selected.join("\n"));
    }
    const output = sections.join("\n");
    return success(output.length === 0 ? "" : `${output}\n`);
  }

  private wordCount(
    arguments_: readonly string[],
    stdin: string,
  ): ShellCommandResult {
    let showLines = false;
    let showWords = false;
    let showBytes = false;
    const paths: string[] = [];
    for (const argument of arguments_) {
      if (argument.startsWith("-") && argument !== "-") {
        for (const flag of argument.slice(1)) {
          if (flag === "l") showLines = true;
          else if (flag === "w") showWords = true;
          else if (flag === "c") showBytes = true;
          else return failure("wc", `invalid option -- '${flag}'`, 2);
        }
      } else paths.push(argument);
    }
    if (!showLines && !showWords && !showBytes) {
      showLines = true;
      showWords = true;
      showBytes = true;
    }
    const sources = paths.length === 0 ? ["-"] : paths;
    const rows = sources.map((path) => {
      const input = path === "-" ? stdin : this.readFile(path);
      const values = [
        ...(showLines ? [countOccurrences(input, "\n")] : []),
        ...(showWords
          ? [input.trim().length === 0 ? 0 : input.trim().split(/\s+/u).length]
          : []),
        ...(showBytes ? [utf8Size(input)] : []),
      ];
      return `${values.map((value) => String(value).padStart(7)).join("")}${path === "-" ? "" : ` ${path}`}`;
    });
    return success(`${rows.join("\n")}\n`);
  }

  private grep(
    arguments_: readonly string[],
    stdin: string,
  ): ShellCommandResult {
    let ignoreCase = false;
    let numbered = false;
    let invert = false;
    const values: string[] = [];
    for (const argument of arguments_) {
      if (argument.startsWith("-") && argument !== "-" && values.length === 0) {
        for (const flag of argument.slice(1)) {
          if (flag === "i") ignoreCase = true;
          else if (flag === "n") numbered = true;
          else if (flag === "v") invert = true;
          else if (flag !== "F")
            return failure("grep", `invalid option -- '${flag}'`, 2);
        }
      } else values.push(argument);
    }
    if (values.length === 0) return usage("grep [-Finv] <pattern> [file ...]");
    const [rawPattern = "", ...paths] = values;
    const pattern = ignoreCase ? rawPattern.toLocaleLowerCase() : rawPattern;
    const sources = paths.length === 0 ? ["-"] : paths;
    const matches: string[] = [];
    for (const path of sources) {
      const input = path === "-" ? stdin : this.readFile(path);
      for (const [index, line] of splitLines(input).entries()) {
        const candidate = ignoreCase ? line.toLocaleLowerCase() : line;
        if (candidate.includes(pattern) === invert) continue;
        const prefix = `${sources.length > 1 ? `${path}:` : ""}${numbered ? `${String(index + 1)}:` : ""}`;
        matches.push(`${prefix}${line}`);
      }
    }
    return matches.length === 0
      ? status(1)
      : success(`${matches.join("\n")}\n`);
  }

  private sort(
    arguments_: readonly string[],
    stdin: string,
  ): ShellCommandResult {
    let reverse = false;
    let unique = false;
    const paths: string[] = [];
    for (const argument of arguments_) {
      if (argument === "-r") reverse = true;
      else if (argument === "-u") unique = true;
      else if (argument.startsWith("-") && argument !== "-") {
        return failure("sort", `invalid option '${argument}'`, 2);
      } else paths.push(argument);
    }
    let lines = splitLines(this.readInputs(paths, stdin)).sort((left, right) =>
      left.localeCompare(right),
    );
    if (unique) lines = [...new Set(lines)];
    if (reverse) lines.reverse();
    return success(lines.length === 0 ? "" : `${lines.join("\n")}\n`);
  }

  private uniq(
    arguments_: readonly string[],
    stdin: string,
  ): ShellCommandResult {
    let count = false;
    const paths: string[] = [];
    for (const argument of arguments_) {
      if (argument === "-c") count = true;
      else if (argument.startsWith("-") && argument !== "-") {
        return failure("uniq", `invalid option '${argument}'`, 2);
      } else paths.push(argument);
    }
    if (paths.length > 1) return usage("uniq [-c] [file]");
    const lines = splitLines(this.readInputs(paths, stdin));
    const output: string[] = [];
    for (const line of lines) {
      const previous = output.at(-1);
      if (!count) {
        if (line !== previous) output.push(line);
        continue;
      }
      const match = /^(\s*\d+) (.*)$/u.exec(previous ?? "");
      if (match !== null && match[2] === line) {
        output[output.length - 1] =
          `${String(Number(match[1]) + 1).padStart(7)} ${line}`;
      } else output.push(`${String(1).padStart(7)} ${line}`);
    }
    return success(output.length === 0 ? "" : `${output.join("\n")}\n`);
  }

  private translate(
    arguments_: readonly string[],
    stdin: string,
  ): ShellCommandResult {
    if (arguments_.length !== 2) return usage("tr <set1> <set2>");
    const from = expandCharacterSet(decodeEscapes(arguments_[0]!));
    const to = expandCharacterSet(decodeEscapes(arguments_[1]!));
    if (from.length === 0 || to.length === 0)
      return failure("tr", "empty set", 2);
    const table = new Map(
      from.map((character, index) => [
        character,
        to[Math.min(index, to.length - 1)]!,
      ]),
    );
    return success(
      [...stdin].map((character) => table.get(character) ?? character).join(""),
    );
  }

  private find(arguments_: readonly string[]): ShellCommandResult {
    const root = this.resolvePath(arguments_[0] ?? ".");
    if (!this.filesystem.exists(root)) {
      return failure(
        "find",
        `${arguments_[0] ?? "."}: no such file or directory`,
      );
    }
    let namePattern: string | undefined;
    if (arguments_.length > 1) {
      if (arguments_.length !== 3 || arguments_[1] !== "-name") {
        return usage("find [path] [-name pattern]");
      }
      namePattern = arguments_[2];
    }
    const paths: string[] = [];
    const pending = [root];
    while (pending.length > 0) {
      const path = pending.pop()!;
      if (namePattern === undefined || globMatches(baseName(path), namePattern))
        paths.push(path);
      if (
        this.filesystem.isDirectory(path) &&
        !this.filesystem.isSymbolicLink(path)
      ) {
        const children = this.filesystem.list(path);
        for (let index = children.length - 1; index >= 0; index -= 1)
          pending.push(joinPath(path, children[index]!));
      }
    }
    return success(`${paths.join("\n")}\n`);
  }

  dosEchoCommand(value: string): ShellCommandResult {
    const normalized = value.trim();
    if (normalized.length === 0) {
      return success(`ECHO is ${this.dosEcho ? "on" : "off"}.\r\n`);
    }
    if (/^off$/iu.test(normalized)) {
      this.dosEcho = false;
      return success();
    }
    if (/^on$/iu.test(normalized)) {
      this.dosEcho = true;
      return success();
    }
    return success(`${value}\r\n`);
  }

  dosSet(value: string): ShellCommandResult {
    const assignment = value.trim();
    if (assignment.length === 0) {
      return success(
        `${[...this.environment]
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([name, contents]) => `${name}=${contents}`)
          .join("\r\n")}\r\n`,
      );
    }
    const separator = assignment.indexOf("=");
    if (separator < 0) {
      const prefix = this.environmentName(assignment);
      const matches = [...this.environment]
        .filter(([name]) => name.startsWith(prefix))
        .sort(([left], [right]) => left.localeCompare(right));
      return matches.length === 0
        ? status(1, "", `Environment variable ${assignment} not defined\r\n`)
        : success(
            `${matches.map(([name, contents]) => `${name}=${contents}`).join("\r\n")}\r\n`,
          );
    }
    const name = assignment.slice(0, separator).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(name))
      return failure("set", `${name}: invalid variable name`, 2);
    const canonical = this.environmentName(name);
    const contents = assignment.slice(separator + 1);
    if (contents.length === 0) this.environment.delete(canonical);
    else this.setEnvironmentEntry(canonical, contents);
    return success();
  }

  dosPath(value: string): ShellCommandResult {
    const requested = value.trim();
    if (requested.length === 0)
      return success(`PATH=${this.environment.get("PATH") ?? ""}\r\n`);
    this.setEnvironmentEntry("PATH", requested === ";" ? "" : requested);
    return success();
  }

  dosPrompt(value: string): ShellCommandResult {
    const requested = value.trim();
    if (requested.length > 64)
      return failure("prompt", "prompt template limit exceeded", 2);
    this.setEnvironmentEntry(
      "PROMPT",
      requested.length === 0 ? "$P$G" : requested,
    );
    return success();
  }

  private renderDosPrompt(template: string): string {
    const displayPath = this.options.profile.pathDialect.display(
      this.currentDirectory,
    );
    const drive = /^[A-Za-z]:/u.exec(displayPath)?.[0]?.slice(0, 1) ?? "C";
    const replacements: Readonly<Record<string, string>> = {
      B: "|",
      G: ">",
      L: "<",
      N: drive,
      P: displayPath,
      Q: "=",
      V: formatOsIdentity(this.options.profile.identity),
      _: "\n",
      $: "$",
    };
    let rendered = "";
    for (let index = 0; index < template.length && rendered.length < 128;) {
      const character = template[index]!;
      if (character !== "$" || index + 1 >= template.length) {
        rendered += character;
        index += 1;
        continue;
      }
      const token = template[index + 1]!.toUpperCase();
      rendered += replacements[token] ?? `$${template[index + 1]!}`;
      index += 2;
    }
    return `${rendered} `;
  }

  private environmentName(name: string): string {
    return this.textPolicy.environmentName(name);
  }

  private environmentCommand(
    command: "env" | "export",
    arguments_: readonly string[],
  ): ShellCommandResult {
    for (const argument of arguments_) {
      if (!isAssignment(argument)) return usage(`${command} [NAME=value ...]`);
      const separator = argument.indexOf("=");
      this.setEnvironmentEntry(
        this.environmentName(argument.slice(0, separator)),
        argument.slice(separator + 1),
      );
    }
    if (arguments_.length > 0) return success();
    const entries = [
      ...this.environment,
      ["PWD", this.currentDirectory] as const,
      ["OLDPWD", this.previousDirectory] as const,
    ].sort(([left], [right]) => left.localeCompare(right));
    return success(
      `${entries.map(([key, value]) => `${key}=${value}`).join("\n")}\n`,
    );
  }

  private unset(arguments_: readonly string[]): ShellCommandResult {
    if (arguments_.length === 0) return usage("unset <NAME ...>");
    for (const name of arguments_) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(name)) {
        return failure("unset", `${name}: invalid variable name`, 2);
      }
      this.environment.delete(this.environmentName(name));
    }
    return success();
  }

  private locate(
    command: "type" | "which",
    arguments_: readonly string[],
  ): ShellCommandResult {
    if (arguments_.length === 0) return usage(`${command} <command ...>`);
    const output: string[] = [];
    for (const name of arguments_) {
      if (this.installedSystemUtility(name) === undefined)
        return status(1, "", `${name}: not found\n`);
      const canonical = this.registry.canonical(name);
      output.push(
        command === "type" && isLinuxBuiltinCommand(canonical)
          ? `${name} is a shell builtin`
          : this.options.profile.pathDialect.display(
              commandExecutablePath(this.options.profile.id, canonical),
            ),
      );
    }
    return success(`${output.join("\n")}\n`);
  }

  private readInputs(paths: readonly string[], stdin: string): string {
    if (paths.length === 0) return stdin;
    return paths
      .map((path) => (path === "-" ? stdin : this.readFile(path)))
      .join("");
  }

  readFile(path: string): string {
    const resolved = this.resolvePath(path);
    const device = this.virtualDevice(resolved);
    if (device === undefined && !this.filesystem.hasAccess(resolved, 0b100)) {
      throw new Error(`${path}: Permission denied`);
    }
    const contents =
      device === undefined ? this.filesystem.readFile(resolved) : device.read();
    if (device === undefined) this.ioReadBytes += utf8ByteLength(contents);
    return contents;
  }

  readFileBytes(path: string): Uint8Array {
    const resolved = this.resolvePath(path);
    if (this.virtualDevice(resolved) !== undefined) {
      throw new Error(`${path}: binary device I/O is not supported`);
    }
    if (!this.filesystem.hasAccess(resolved, 0b100)) {
      throw new Error(`${path}: Permission denied`);
    }
    const contents = this.filesystem.readFileBytes(resolved);
    this.ioReadBytes += contents.byteLength;
    return contents;
  }

  private readSymbolicLink(path: string): string {
    const resolved = this.resolvePath(path);
    if (!this.filesystem.isSymbolicLink(resolved)) {
      throw new Error(`${path}: not a symbolic link`);
    }
    const target = this.filesystem.readLink(resolved);
    this.ioReadBytes += utf8ByteLength(target);
    return target;
  }

  pathExists(path: string): boolean {
    try {
      const resolved = this.resolvePath(path);
      return (
        this.filesystem.exists(resolved) ||
        this.virtualDevice(resolved) !== undefined
      );
    } catch {
      return false;
    }
  }

  writeFile(path: string, contents: string, append = false): void {
    const resolved = this.resolvePath(path);
    const device = this.virtualDevice(resolved);
    if (device !== undefined) {
      device.write(contents);
      return;
    }
    const accessPath = this.filesystem.exists(resolved)
      ? resolved
      : parentPath(resolved);
    const required = this.filesystem.exists(resolved) ? 0b010 : 0b011;
    if (!this.filesystem.hasAccess(accessPath, required))
      throw new Error(`${path}: Permission denied`);
    if (this.options.profile.id === "dos") {
      this.runDosFilesystemTransaction(() => {
        this.assertDosPathWritable(resolved);
        this.preflightDosFileWrite(resolved);
        if (append) this.filesystem.appendFile(resolved, contents);
        else this.filesystem.writeFile(resolved, contents);
        this.filesystem.setModifiedTime(
          resolved,
          truncateToDosFatTimestamp(
            this.options.clock.currentWallTimeMilliseconds(),
          ),
        );
        this.markDosFileWritten(resolved);
        this.ioWriteBytes += utf8ByteLength(contents);
      });
      return;
    }
    if (append) this.filesystem.appendFile(resolved, contents);
    else this.filesystem.writeFile(resolved, contents);
    this.ioWriteBytes += utf8ByteLength(contents);
  }

  writeFileBytes(path: string, contents: Uint8Array): void {
    const resolved = this.resolvePath(path);
    if (this.virtualDevice(resolved) !== undefined) {
      throw new Error(`${path}: binary device I/O is not supported`);
    }
    const accessPath = this.filesystem.exists(resolved)
      ? resolved
      : parentPath(resolved);
    const required = this.filesystem.exists(resolved) ? 0b010 : 0b011;
    if (!this.filesystem.hasAccess(accessPath, required)) {
      throw new Error(`${path}: Permission denied`);
    }
    this.filesystem.writeFileBytes(resolved, contents);
    this.ioWriteBytes += contents.byteLength;
  }

  currentTick(): number {
    return this.options.currentTick();
  }

  environmentValue(name: string): string | undefined {
    return this.environment.get(this.environmentName(name));
  }

  setEnvironmentValue(name: string, value: string): void {
    this.setEnvironmentEntry(this.environmentName(name), value);
  }

  unsetEnvironmentValue(name: string): void {
    this.environment.delete(this.environmentName(name));
  }

  private setEnvironmentEntry(name: string, value: string): void {
    if (
      !this.environment.has(name) &&
      this.environment.size >= maximumEnvironmentVariables
    ) {
      throw new Error("shell environment variable limit exceeded");
    }
    this.environment.set(name, value);
  }

  private closestExistingDirectory(path: string): string {
    let candidate = parentPath(path);
    while (!this.filesystem.isDirectory(candidate)) {
      if (candidate === "/") return "/";
      candidate = parentPath(candidate);
    }
    return candidate;
  }

  ticksPerSecond(): number {
    return this.options.ticksPerSecond;
  }

  canonicalCommand(name: string): string {
    return this.registry.canonical(name);
  }

  beginFilesystemIo(): void {
    this.ioReadBytes = 0;
    this.ioWriteBytes = 0;
  }

  completeFilesystemIo(schedule = true): string | undefined {
    const floppy = this.options.floppyDrive?.drainIo() ?? [];
    if (
      schedule &&
      floppy.length > 0 &&
      this.options.requestFloppyIo !== undefined
    ) {
      return this.options.requestFloppyIo(floppy);
    }
    const bytes = this.ioReadBytes + this.ioWriteBytes;
    if (
      !schedule ||
      bytes === 0 ||
      this.options.requestFilesystemIo === undefined
    ) {
      return undefined;
    }
    return this.options.requestFilesystemIo(
      this.ioWriteBytes > 0 ? "write" : "read",
      bytes,
    );
  }

  private installedSystemUtility(name: string): string | undefined {
    if (!this.registry.has(name)) return undefined;
    const canonical = this.registry.canonical(name);
    const path = commandExecutablePath(this.options.profile.id, canonical);
    if (!this.filesystem.exists(path) || this.filesystem.isDirectory(path)) {
      return undefined;
    }
    if (!this.filesystem.hasAccess(path, filesystemExecute)) return undefined;
    if (
      (this.options.profile.id === "dos" && isDosInternalCommand(canonical)) ||
      (this.options.profile.id === "linux" && isLinuxBuiltinCommand(canonical))
    ) {
      return canonical;
    }
    return decodeSystemUtility(this.filesystem.readFile(path));
  }

  private displayName(name: string): string {
    return this.textPolicy.displayName(name);
  }

  private commandCompletions(prefix: string): {
    readonly candidates: readonly ShellCompletionCandidate[];
    readonly truncated: boolean;
  } {
    const matches = this.registry
      .names(prefix)
      .filter((name) => this.installedSystemUtility(name) !== undefined);
    return {
      candidates: matches.slice(0, maximumCompletionCandidates).map((name) => {
        const displayText =
          this.options.profile.id === "dos" ? this.displayName(name) : name;
        return {
          displayText,
          insertText: `${displayText} `,
          kind: "command",
        };
      }),
      truncated: matches.length > maximumCompletionCandidates,
    };
  }

  private pathCompletions(token: string): {
    readonly candidates: readonly ShellCompletionCandidate[];
    readonly truncated: boolean;
  } {
    const dos = this.options.profile.id === "dos";
    const { directoryToken, displayPrefix, namePrefix, separator } =
      completionPathParts(token, dos);
    let resolvedDirectory: string;
    let names: string[];
    try {
      resolvedDirectory = this.resolvePath(directoryToken);
      names = [...this.filesystem.list(resolvedDirectory)];
    } catch {
      return { candidates: [], truncated: false };
    }
    const virtualNames = new Set<string>();
    for (const devicePath of this.virtualDevicePaths()) {
      if (parentPath(devicePath) !== resolvedDirectory) continue;
      const name = baseName(devicePath);
      names.push(name);
      virtualNames.add(dos ? name.toLowerCase() : name);
    }
    const comparablePrefix = dos ? namePrefix.toLowerCase() : namePrefix;
    const matches = [...new Set(names)]
      .filter((name) => {
        if (!dos && comparablePrefix.length === 0 && name.startsWith("."))
          return false;
        const comparableName = dos ? name.toLowerCase() : name;
        return comparableName.startsWith(comparablePrefix);
      })
      .sort((left, right) => {
        const comparableLeft = dos ? left.toLowerCase() : left;
        const comparableRight = dos ? right.toLowerCase() : right;
        return comparableLeft < comparableRight
          ? -1
          : comparableLeft > comparableRight
            ? 1
            : 0;
      });
    return {
      candidates: matches.slice(0, maximumCompletionCandidates).map((name) => {
        const resolved = joinPath(resolvedDirectory, name);
        const directory =
          this.filesystem.exists(resolved) &&
          this.filesystem.isDirectory(resolved);
        const renderedName = dos ? this.displayName(name) : name;
        const displayText = `${displayPrefix}${renderedName}${
          directory ? separator : ""
        }`;
        const virtualKey = dos ? name.toLowerCase() : name;
        const kind: ShellCompletionCandidate["kind"] = directory
          ? "directory"
          : virtualNames.has(virtualKey)
            ? "device"
            : "file";
        return {
          displayText,
          insertText: directory ? displayText : `${displayText} `,
          kind,
        };
      }),
      truncated: matches.length > maximumCompletionCandidates,
    };
  }

  private commandNotFound(command: string): ShellCommandResult {
    return this.textPolicy.commandNotFound(command);
  }

  private virtualDevice(path: string): VirtualDevice | undefined {
    const dynamic = this.options.virtualDevices?.get(path);
    if (dynamic !== undefined) return dynamic;
    const configured = this.options.profile.virtualDevices.get(path);
    if (configured !== undefined) return configured;
    if (this.options.profile.id !== "linux") return undefined;
    if (path === "/var/log/messages" && this.options.osRuntime !== undefined) {
      return this.readOnlyDevice(path, () =>
        this.options.osRuntime!.renderMessagesLog(),
      );
    }
    if (path === "/var/log/auth.log" && this.options.osRuntime !== undefined) {
      return this.readOnlyDevice(path, () =>
        this.options.osRuntime!.renderAuthLog(),
      );
    }
    const selfPid = this.options.selfPid?.();
    const runtimePath =
      selfPid !== undefined && path.startsWith("/proc/self/")
        ? `/proc/${String(selfPid)}/${path.slice("/proc/self/".length)}`
        : path;
    const processStatusMatch = /^\/proc\/([1-9][0-9]*)\/status$/u.exec(
      runtimePath,
    );
    if (processStatusMatch !== null && this.options.osRuntime !== undefined) {
      const pid = Number(processStatusMatch[1]);
      if (
        Number.isSafeInteger(pid) &&
        this.options.osRuntime.process(pid) !== undefined
      ) {
        return this.readOnlyDevice(path, () => {
          const memory = this.requireLinuxMemorySnapshot().processes.find(
            (process) => process.pid === pid,
          ) ?? { pid, residentBytes: 0, virtualBytes: 0 };
          return this.options.osRuntime!.renderProcStatus(pid, memory);
        });
      }
    }
    const runtimeProc = this.options.osRuntime?.readProc(runtimePath);
    if (runtimeProc !== undefined)
      return this.readOnlyDevice(path, () =>
        this.options.osRuntime!.readProc(runtimePath)!,
      );
    if (path === "/proc/cpuinfo")
      return this.readOnlyDevice(path, () => this.linuxCpuInfo());
    if (path === "/proc/meminfo")
      return this.readOnlyDevice(path, () => this.linuxMemoryInfo());
    if (path === "/proc/version")
      return this.readOnlyDevice(
        path,
        () =>
          "Linux version 1.0.0-cs (cs@cs-linux) #1 CS-Linux SMP i486 GNU/Linux\n",
      );
    if (path === "/proc/uptime")
      return this.readOnlyDevice(
        path,
        () =>
          `${this.uptimeSeconds().toFixed(2)} ${this.uptimeSeconds().toFixed(2)}\n`,
      );
    if (path === "/proc/loadavg")
      return this.readOnlyDevice(path, () => "0.00 0.00 0.00 1/1 1\n");
    if (path === "/proc/mounts")
      return this.readOnlyDevice(
        path,
        () =>
          "csfs / csfs rw,nosuid,nodev 0 0\nproc /proc proc ro,nosuid,nodev,noexec 0 0\ncsdev /dev csdev rw,nosuid,noexec 0 0\ntmpfs /tmp tmpfs rw,nosuid,nodev 0 0\n",
      );
    return undefined;
  }

  private virtualDevicePaths(): readonly string[] {
    return [
      ...new Set([
        ...(this.options.virtualDevices?.keys() ?? []),
        ...this.options.profile.virtualDevices.keys(),
        ...(this.options.osRuntime?.procDevicePaths() ?? []),
        ...(this.options.profile.id === "linux"
          ? [
              "/var/log/auth.log",
              "/var/log/messages",
              "/proc/cpuinfo",
              "/proc/loadavg",
              "/proc/meminfo",
              "/proc/mounts",
              "/proc/uptime",
              "/proc/version",
              ...(this.options.selfPid?.() === undefined
                ? []
                : [
                    "/proc/self/cmdline",
                    "/proc/self/stat",
                    "/proc/self/status",
                  ]),
            ]
          : []),
      ]),
    ].sort();
  }

  private readOnlyDevice(path: string, read: () => string): VirtualDevice {
    return {
      path,
      read,
      write: (): never => {
        throw new Error(`${path}: read-only virtual file`);
      },
    };
  }

  private linuxCpuInfo(): string {
    const cpu = cpuModelSpecification(this.options.hardware.cpuModel);
    return (
      [
        "processor\t: 0",
        `model name\t: ${cpu.displayName}`,
        `model id\t: ${cpu.id}`,
        `address size\t: ${String(cpu.addressBits)} bit`,
        `data bus\t: ${String(cpu.dataBusBits)} bit`,
        `clock\t\t: ${formatClock(this.options.hardware.clockHz)}`,
        `l1 cache\t: ${formatCacheBytes(cpu.microarchitecture.l1CacheBytes)}`,
        `l2 cache\t: ${formatCacheBytes(cpu.microarchitecture.externalCacheBytes)}`,
        `cache line\t: ${String(cpu.microarchitecture.cacheLineBytes)} bytes`,
        `pipeline\t: ${cpu.microarchitecture.pipeline}`,
        `branch predictor: ${cpu.microarchitecture.branchPrediction}`,
        `memory modules\t: ${cpu.microarchitecture.memoryModules}`,
        "execution mode\t: protected sandbox",
        "paging\t\t: unavailable",
      ].join("\n") + "\n"
    );
  }

  private linuxMemoryInfo(): string {
    const memory = this.requireLinuxMemorySnapshot();
    const physical = memory.physical;
    const resident = memory.resident;
    return (
      [
        `MemTotal: ${physical.totalBytes} B`,
        `MemUsed:  ${physical.usedBytes} B`,
        `MemFree:  ${physical.freeBytes} B`,
        `MemAvailable: ${physical.availableBytes} B`,
        `KernelResident: ${resident.kernelBytes} B`,
        `SystemServices: ${resident.servicesBytes} B`,
        `Buffers: ${resident.buffersBytes} B`,
        `GuestRuntime: ${resident.guestRuntimeBytes} B`,
        "SwapTotal: 0 B",
        "SwapFree:  0 B",
        "MemoryModel: 32-bit protected flat sandbox",
      ].join("\n") + "\n"
    );
  }

  private requireLinuxMemorySnapshot(): LinuxGuestMemorySnapshot {
    const snapshot = this.options.linuxMemorySnapshot?.();
    if (snapshot === undefined) {
      throw new Error("CS-Linux memory snapshot is unavailable");
    }
    return snapshot;
  }

  private uptimeSeconds(): number {
    return (
      (this.options.currentTick() - this.bootTick) / this.options.ticksPerSecond
    );
  }

  private linuxId(arguments_: readonly string[]): ShellCommandResult {
    const option = arguments_[0]?.startsWith("-") ? arguments_[0] : undefined;
    const username = arguments_[option === undefined ? 0 : 1];
    if (
      arguments_.length > (option === undefined ? 1 : 2) ||
      (option !== undefined &&
        !["-u", "-g", "-G", "-un", "-gn"].includes(option))
    )
      return usage("id [-u|-g|-G|-un|-gn] [user]");
    const current = this.options.credentials();
    const user =
      username === undefined
        ? this.options.accounts?.getUserByUid(current.effectiveUserId)
        : this.options.accounts?.getUser(username);
    if (user === undefined)
      return failure("id", `${username ?? current.loginName}: no such user`, 1);
    const groups = this.options.accounts?.groupsForUser(user.name) ?? [];
    const groupIds = [...new Set([user.gid, ...groups.map(({ gid }) => gid)])];
    if (option === "-u") return success(`${String(user.uid)}\n`);
    if (option === "-un") return success(`${user.name}\n`);
    if (option === "-g") return success(`${String(user.gid)}\n`);
    if (option === "-gn")
      return success(`${this.linuxIdentityName(user.gid, "group")}\n`);
    if (option === "-G") return success(`${groupIds.join(" ")}\n`);
    const renderedGroups = groupIds
      .map((gid) => `${String(gid)}(${this.linuxIdentityName(gid, "group")})`)
      .join(",");
    return success(
      `uid=${String(user.uid)}(${user.name}) gid=${String(user.gid)}(${this.linuxIdentityName(user.gid, "group")}) groups=${renderedGroups}\n`,
    );
  }

  private linuxUptime(arguments_: readonly string[]): ShellCommandResult {
    if (arguments_.length !== 0) return usage("uptime");
    const seconds = Math.max(0, this.uptimeSeconds());
    const days = Math.floor(seconds / 86_400);
    const hours = Math.floor((seconds % 86_400) / 3_600);
    const minutes = Math.floor((seconds % 3_600) / 60);
    const now = new Date(this.options.clock.currentWallTimeMilliseconds());
    const clock = Number.isFinite(now.getTime())
      ? formatDate(now, "%H:%M:%S")
      : "00:00:00";
    const duration =
      days > 0
        ? `${String(days)} day${days === 1 ? "" : "s"}, ${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`
        : `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
    return success(
      ` ${clock} up ${duration},  1 user,  load average: 0.00, 0.00, 0.00\n`,
    );
  }

  private uname(arguments_: readonly string[]): ShellCommandResult {
    if (this.options.profile.id === "linux") {
      const values = new Map<string, string>([
        ["s", "Linux"],
        ["n", this.options.computerName],
        ["r", "1.0.0-cs"],
        ["v", "#1 CS-Linux SMP"],
        ["m", "i486"],
        ["p", "i486"],
        ["i", "unknown"],
        ["o", "GNU/Linux"],
      ]);
      if (arguments_.length === 0) return success("Linux\n");
      const flags = arguments_.flatMap((argument) =>
        argument === "--all"
          ? ["a"]
          : argument.startsWith("-")
            ? [...argument.slice(1)]
            : ["?"],
      );
      if (flags.some((flag) => flag !== "a" && !values.has(flag)))
        return usage("uname [-asnrvmpio]");
      const selected = flags.includes("a")
        ? ["s", "n", "r", "v", "m", "o"]
        : [...new Set(flags)];
      return success(
        `${selected.map((flag) => values.get(flag)!).join(" ")}\n`,
      );
    }
    if (
      arguments_.length > 1 ||
      (arguments_.length === 1 && arguments_[0] !== "-a")
    )
      return usage("uname [-a]");
    const name = formatOsIdentity(this.options.profile.identity);
    const system =
      this.options.profile.id === "dos"
        ? `${name} [CPU ${cpuModelSpecification(this.options.hardware.cpuModel).runtimeName} ${formatClock(this.options.hardware.clockHz)}, Memory ${formatBinaryBytes(this.options.hardware.memoryBytes)}]`
        : name;
    return success(
      arguments_[0] === "-a"
        ? `${system} ${this.options.computerName} sandbox-vm\n`
        : `${system}\n`,
    );
  }

  private date(arguments_: readonly string[]): ShellCommandResult {
    const parsed = parseDateArguments(arguments_);
    if (parsed === undefined)
      return usage("date [--real|--game|--virtual] [+FORMAT]");

    if (parsed.mode === "game") {
      const game = this.options.clock.currentGameTime();
      if (
        !Number.isFinite(game.absoluteTicks) ||
        !Number.isFinite(game.timeOfDay)
      ) {
        return failure("date", "game clock is unavailable", 1);
      }
      const day = Math.floor(Math.max(0, game.absoluteTicks) / 24_000) + 1;
      const timeOfDay =
        ((Math.floor(game.timeOfDay) % 24_000) + 24_000) % 24_000;
      const seconds = Math.floor(((timeOfDay + 6_000) % 24_000) * 3.6);
      const date = new Date(Date.UTC(2000, 0, day, 0, 0, seconds));
      if (parsed.format === undefined) {
        return success(
          `Minecraft day ${String(day)} ${formatDate(date, "%H:%M:%S")}\n`,
        );
      }
      return success(`${formatDate(date, parsed.format)}\n`);
    }

    const milliseconds =
      parsed.mode === "real"
        ? this.options.clock.currentWallTimeMilliseconds()
        : Date.UTC(2000, 0, 1) +
          (this.options.currentTick() / this.options.ticksPerSecond) * 1_000;
    const date = new Date(milliseconds);
    if (!Number.isFinite(date.getTime())) {
      return failure("date", `${parsed.mode} clock is unavailable`, 1);
    }
    if (parsed.format === undefined)
      return success(
        parsed.mode === "real"
          ? `${formatLinuxDate(date)}\n`
          : `${date.toISOString()}\n`,
      );
    return success(`${formatDate(date, parsed.format)}\n`);
  }

  dosTime(arguments_: readonly string[]): ShellCommandResult {
    if (arguments_.length !== 0) {
      return status(
        2,
        "",
        "The host-backed system time cannot be changed.\r\n",
      );
    }
    const date = new Date(this.options.clock.currentWallTimeMilliseconds());
    if (!Number.isFinite(date.getTime()))
      return status(1, "", "System time is unavailable.\r\n");
    const centiseconds = String(
      Math.floor(date.getUTCMilliseconds() / 10),
    ).padStart(2, "0");
    return success(
      `Current time is ${formatDate(date, "%H:%M:%S")}.${centiseconds}\r\n`,
    );
  }

  dosDate(arguments_: readonly string[]): ShellCommandResult {
    if (arguments_.length !== 0)
      return status(
        2,
        "",
        "The host-backed system date cannot be changed.\r\n",
      );
    const date = new Date(this.options.clock.currentWallTimeMilliseconds());
    if (!Number.isFinite(date.getTime()))
      return status(1, "", "System date is unavailable.\r\n");
    const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    return success(
      `Current date is ${weekdays[date.getUTCDay()]} ${formatDate(date, "%m-%d-%Y")}\r\n`,
    );
  }

  dosHelp(arguments_: readonly string[]): ShellCommandResult {
    if (arguments_.length > 1) {
      return status(2, "", "Invalid number of parameters.\r\n");
    }
    if (arguments_[0] !== undefined) {
      const name = arguments_[0].toUpperCase();
      if (["AS", "ASM", "CSASM"].includes(name)) {
        return success(
          [
            csAsmProductName,
            "Usage: ASM [/C] <source> [/OUT:output]",
            "Use CSASM [source] or PWB [source] for the full-screen WorkBench.",
            "WorkBench keys: F2 Save, F3 Next Error, F5 Debug, F7 Build, Shift+F5 Build and Run.",
            "ABI: up to 32 word arguments, SIGNATURE name,return[,I32...], integer return in EAX.",
            "This is CS486OBJ/CSX, not MASM, OMF, COM, EXE, near/far, or DOS interrupts.",
            "",
          ].join("\r\n"),
        );
      }
      if (["C++", "CC", "CSCC", "CSCPP"].includes(name)) {
        return success(
          [
            csCFamilyProductName,
            `Usage: ${name === "C++" || name === "CSCPP" ? "C++" : "CC"} [/C] <source> [/OUT:output]`,
            "Use CSCC [source], CSCPP [source], or PWB [source] for the full-screen WorkBench.",
            "Options: /I:path, /Dname[=value], /Uname; Linux uses -I, -D, and -U.",
            "WorkBench keys: F2 Save, F3 Next Error, F5 Debug, F7 Build, Shift+F5 Build and Run.",
            'C++ is a limited subset; extern "C" declarations use the unmangled word-argument CS ABI.',
            "",
          ].join("\r\n"),
        );
      }
      if (name === "QBASIC") {
        return success(
          [
            csQBasicProductName,
            "Usage: QBASIC [switches] [file]",
            "Use QBASIC /RUN file or F5 to run source transiently in the IDE.",
            "CS QBASIC does not create OBJ, CSX, EXE, or another persistent artifact.",
            "Use HELP QBASIC because QBASIC /HELP is not a supported switch.",
            "",
          ].join("\r\n"),
        );
      }
      if (name === "PWB") {
        return success(
          [
            `${csAsmProductName} / ${csCFamilyProductName}`,
            "Usage: PWB [source]",
            "The source extension selects ASM, C, or C++ mode.",
            "Make > Set Program List selects a bounded CS PROGRAM LIST 1.0 project.",
            "F7 builds incrementally; Ctrl+F7 rebuilds; Clean removes only recorded project outputs.",
            "F3 / Shift+F3 navigate compiler locations from the F4 Output pane.",
            "F5 debugs inside WorkBench; the DEBUG command is optional, not a required post-build step.",
            "",
          ].join("\r\n"),
        );
      }
      if (name === "EDIT") {
        return success(
          [
            "CS-DOS EDIT 1.0",
            "Usage: EDIT [file]",
            "Ctrl+O and Ctrl+Shift+S open the bounded A:/C: DOS file browser.",
            "Dirty New/Open/Exit and overwrite/external-change decisions require Save, Discard/Reopen, or Cancel.",
            "F2 saves; F1 shows keyboard help; primary-mouse menus and dialog decisions are supported.",
            "",
          ].join("\r\n"),
        );
      }
      if (!this.isKnownCommand(name)) {
        return status(1, "", `Help not available for ${name}.\r\n`);
      }
      return success(
        `${name} is available in Computer System DOS. Use ${name} /? where supported.\r\n`,
      );
    }
    return success(
      [
        "Computer System DOS 1.0 Command Help",
        "",
        "CD CHDIR CLS COPY DATE DEL DIR DOSKEY ECHO EDIT ERASE EXIT",
        "MD MEM MKDIR MOVE PATH PROMPT RD REN RENAME RMDIR SET TIME",
        "I2C SPI TIMER TREE TYPE VER VOL",
        "",
        "Development: CS ASM 1.0 (AS/ASM/CSASM), CS C/C++ 1.0 (CC/C++/PWB)",
        "Also available: CS QBASIC 1.0, LD, NM, OBJDUMP, RUN, DEBUG, VI",
        "Type HELP command for a short availability summary.",
        "",
      ].join("\r\n"),
    );
  }

  private sleep(arguments_: readonly string[]): ShellCommandResult {
    if (arguments_.length !== 1) return usage("sleep <seconds>");
    const seconds = Number(arguments_[0]);
    if (!Number.isFinite(seconds) || seconds < 0 || seconds > 3_600) {
      return failure("sleep", "seconds must be between 0 and 3600", 2);
    }
    return {
      exitCode: 0,
      stderr: "",
      stdout: "",
      sleepTicks: Math.ceil(seconds * this.options.ticksPerSecond),
    };
  }

  private sequence(arguments_: readonly string[]): ShellCommandResult {
    if (arguments_.length < 1 || arguments_.length > 3)
      return usage("seq [first [step]] last");
    const values = arguments_.map(Number);
    if (values.some((value) => !Number.isFinite(value)))
      return failure("seq", "arguments must be numbers", 2);
    const first = values.length === 1 ? 1 : values[0]!;
    const step = values.length === 3 ? values[1]! : 1;
    const last = values.at(-1)!;
    if (step === 0) return failure("seq", "step must not be zero", 2);
    const count = Math.floor((last - first) / step) + 1;
    if (count < 0) return success();
    if (count > 10_000) return failure("seq", "output limit exceeded");
    return success(
      `${Array.from({ length: count }, (_, index) => first + index * step).join("\n")}\n`,
    );
  }

  private cut(
    arguments_: readonly string[],
    stdin: string,
  ): ShellCommandResult {
    let delimiter = "\t";
    let fields: readonly number[] | undefined;
    const paths: string[] = [];
    for (let index = 0; index < arguments_.length; index += 1) {
      const argument = arguments_[index]!;
      if (argument === "-d") delimiter = arguments_[++index] ?? "";
      else if (argument === "-f") {
        const value = arguments_[++index] ?? "";
        fields = value.split(",").map(Number);
      } else paths.push(argument);
    }
    if (
      delimiter.length !== 1 ||
      fields === undefined ||
      fields.some(
        (field) => !Number.isSafeInteger(field) || field < 1 || field > 1_000,
      )
    ) {
      return usage("cut [-d delimiter] -f fields [file ...]");
    }
    const output = splitLines(this.readInputs(paths, stdin)).map((line) => {
      const columns = line.split(delimiter);
      return fields.map((field) => columns[field - 1] ?? "").join(delimiter);
    });
    return success(output.length === 0 ? "" : `${output.join("\n")}\n`);
  }

  private stat(arguments_: readonly string[]): ShellCommandResult {
    if (arguments_.length !== 1) return usage("stat <path>");
    const resolved = this.resolvePath(arguments_[0]!);
    const device = this.virtualDevice(resolved);
    if (device !== undefined)
      return success(
        `  File: ${arguments_[0]}\n  Size: 0\tBlocks: 0\tIO Block: 1 character special file\nDevice: csdev\tInode: 0\tLinks: 1\nAccess: (0666/crw-rw-rw-)  Uid: (    0/    root)   Gid: (    0/    root)\n`,
      );
    if (!this.filesystem.exists(resolved))
      return failure(
        "stat",
        `cannot statx '${arguments_[0]}': No such file or directory`,
      );
    const symbolic = this.filesystem.isSymbolicLink(resolved);
    const kind = symbolic
      ? "symbolic link"
      : this.filesystem.isDirectory(resolved)
        ? "directory"
        : "regular file";
    const metadata = this.filesystem.getMetadata(resolved, !symbolic);
    const mode = linuxModeString(
      symbolic
        ? "link"
        : this.filesystem.isDirectory(resolved)
          ? "directory"
          : "file",
      metadata.mode,
    );
    const modified = new Date(metadata.modifiedAtMilliseconds).toISOString();
    return success(
      `  File: ${arguments_[0]}${symbolic ? ` -> ${this.filesystem.readLink(resolved)}` : ""}\n` +
        `  Size: ${String(symbolic ? utf8ByteLength(this.filesystem.readLink(resolved)) : this.filesystem.getSize(resolved))}\tBlocks: 1\tIO Block: 1 ${kind}\n` +
        `Device: csfs\tInode: ${String(stablePathInode(resolved))}\tLinks: ${String(symbolic ? 1 : this.filesystem.getLinkCount(resolved))}\n` +
        `Access: (${metadata.mode.toString(8).padStart(4, "0")}/${mode})  Uid: (${String(metadata.uid).padStart(5)}/${this.linuxIdentityName(metadata.uid, "user").padStart(8)})   Gid: (${String(metadata.gid).padStart(5)}/${this.linuxIdentityName(metadata.gid, "group").padStart(8)})\n` +
        `Modify: ${modified}\n`,
    );
  }

  private diskFree(arguments_: readonly string[]): ShellCommandResult {
    const human = arguments_[0] === "-h";
    const paths = arguments_.filter((argument) => argument !== "-h");
    if (
      paths.length > 1 ||
      arguments_.some(
        (argument) => argument.startsWith("-") && argument !== "-h",
      )
    )
      return usage("df [-h] [path]");
    const free = this.filesystem.getFreeSpace();
    const capacity = this.filesystem.limits.capacityBytes;
    const used = capacity - free;
    const percent = capacity === 0 ? 0 : Math.ceil((used / capacity) * 100);
    const display = (value: number): string =>
      human ? formatLinuxSize(value, true) : String(Math.ceil(value / 1_024));
    return success(
      `Filesystem      Size  Used Avail Use% Mounted on\ncsfs         ${display(capacity).padStart(6)} ${display(used).padStart(5)} ${display(free).padStart(5)} ${String(percent).padStart(3)}% /\n`,
    );
  }

  private staticArchive(arguments_: readonly string[]): ShellCommandResult {
    const usageText = "ar {rcs|r|d|t|x} <archive> [members ...]";
    if (this.options.profile.id !== "linux" || arguments_.length < 2) {
      return this.toolchainUsage(usageText);
    }
    const flags = arguments_[0]!.replace(/^-+/u, "");
    const operations = [...flags].filter((flag) => "rdtx".includes(flag));
    if (
      !/^[cdrstx]+$/u.test(flags) ||
      operations.length !== 1 ||
      new Set(operations).size !== 1
    ) {
      return this.toolchainUsage(usageText);
    }
    const operation = operations[0]!;
    const archivePath = this.resolvePath(arguments_[1]!);
    const operands = arguments_.slice(2);
    const archiveExists = this.filesystem.exists(archivePath);
    if (archiveExists && this.filesystem.isDirectory(archivePath)) {
      return this.toolchainFailure("ar", `${arguments_[1]}: is a directory`);
    }
    const readArchive = (): Cs486Archive => {
      if (!archiveExists)
        throw new Error(`${arguments_[1]}: archive does not exist`);
      return parseCs486Archive(this.readFile(archivePath));
    };

    if (operation === "t") {
      if (operands.length !== 0) return this.toolchainUsage(usageText);
      const archive = readArchive();
      return success(
        archive.members.map((member) => member.name).join("\n") +
          (archive.members.length === 0 ? "" : "\n"),
      );
    }
    if (operation === "r") {
      if (operands.length === 0 && !flags.includes("s")) {
        return this.toolchainUsage(usageText);
      }
      const prior = archiveExists
        ? parseCs486Archive(this.readFile(archivePath))
        : undefined;
      const replacements = operands.map((path) => ({
        name: archiveMemberName(path),
        object: this.readCs486Object(path),
      }));
      const candidate =
        replacements.length === 0
          ? prior === undefined
            ? createCs486Archive([])
            : refreshCs486ArchiveIndex(prior)
          : replaceCs486ArchiveMembers(prior, replacements);
      const encoded = serializeCs486Archive(candidate);
      this.filesystem.transaction(() => this.writeFile(archivePath, encoded));
      return {
        cpuCycles: archiveWorkCycles(candidate),
        exitCode: 0,
        stderr: "",
        stdout: "",
      };
    }
    if (operation === "d") {
      if (operands.length === 0) return this.toolchainUsage(usageText);
      const candidate = deleteCs486ArchiveMembers(
        readArchive(),
        operands.map(archiveMemberName),
      );
      const encoded = serializeCs486Archive(candidate);
      this.filesystem.transaction(() => this.writeFile(archivePath, encoded));
      return {
        cpuCycles: archiveWorkCycles(candidate),
        exitCode: 0,
        stderr: "",
        stdout: "",
      };
    }
    if (operation === "x") {
      const archive = readArchive();
      const requested =
        operands.length === 0
          ? archive.members
          : operands.map((operand) => {
              const name = archiveMemberName(operand);
              const member = archive.members.find(
                (candidate) => candidate.name === name,
              );
              if (member === undefined)
                throw new Error(`archive member not found: ${name}`);
              return member;
            });
      this.filesystem.transaction(() => {
        for (const member of requested) {
          this.writeFile(
            this.resolvePath(member.name),
            `CS486OBJ\n${JSON.stringify(member.object)}`,
          );
        }
      });
      return {
        cpuCycles: archiveWorkCycles(archive),
        exitCode: 0,
        stderr: "",
        stdout: "",
      };
    }
    return this.toolchainUsage(usageText);
  }

  private refreshStaticArchive(
    arguments_: readonly string[],
  ): ShellCommandResult {
    if (this.options.profile.id !== "linux" || arguments_.length !== 1) {
      return this.toolchainUsage("ranlib <archive>");
    }
    const path = this.resolvePath(arguments_[0]!);
    const archive = refreshCs486ArchiveIndex(
      parseCs486Archive(this.readFile(path)),
    );
    const encoded = serializeCs486Archive(archive);
    this.filesystem.transaction(() => this.writeFile(path, encoded));
    return {
      cpuCycles: archiveWorkCycles(archive),
      exitCode: 0,
      stderr: "",
      stdout: "",
    };
  }

  private compileExecutable(
    language: Exclude<Cs486SourceLanguage, "basic"> | "asm",
    arguments_: readonly string[],
  ): ShellCommandResult {
    const name = language === "asm" ? "as" : language;
    const usageText =
      this.options.profile.id === "dos"
        ? `${language === "asm" ? "ASM" : name.toUpperCase()} [/C] <source> [/OUT:output]${language === "asm" ? "" : " [/Ipath] [/Dname[=value]] [/Uname]"}`
        : `${name} [-c] <source> [-o output]${language === "asm" ? "" : " [-I path] [-D name[=value]] [-U name]"}`;
    const productName =
      language === "asm" ? csAsmProductName : csCFamilyProductName;
    const versionRequested =
      arguments_.length === 1 &&
      (this.options.profile.id === "dos"
        ? /^\/VERSION$/iu.test(arguments_[0]!)
        : arguments_[0] === "--version");
    if (versionRequested) {
      return success(
        `${productName} for ${cpuModelSpecification(this.options.hardware.cpuModel).runtimeName}${this.textPolicy.newline}`,
      );
    }
    const helpRequested =
      arguments_.length === 1 &&
      (this.options.profile.id === "dos"
        ? arguments_[0] === "/?"
        : arguments_[0] === "--help");
    if (helpRequested) {
      return success(
        `${productName}${this.textPolicy.newline}Usage: ${usageText}${this.textPolicy.newline}`,
      );
    }
    arguments_ = this.normalizeCompileOptions(arguments_);
    if (language !== "asm") {
      return this.compileCFamilyDriver(language, arguments_, usageText);
    }
    const compileOnly = arguments_.filter(
      (argument) => argument === "-c",
    ).length;
    if (compileOnly > 1) return this.toolchainUsage(usageText);
    const filtered = arguments_.filter((argument) => argument !== "-c");
    const outputIndex = filtered.indexOf("-o");
    if (
      filtered.length < 1 ||
      filtered.length > 3 ||
      (outputIndex >= 0 && (outputIndex !== 1 || filtered.length !== 3)) ||
      (outputIndex < 0 && filtered.length !== 1)
    )
      return this.toolchainUsage(usageText);
    const sourcePath = filtered[0]!;
    const sourceName = this.resolvePath(sourcePath);
    const outputPath = this.resolvePath(
      outputIndex < 0
        ? this.options.profile.id === "dos"
          ? replacePathExtension(
              sourcePath,
              compileOnly === 1 ? ".OBJ" : ".CSX",
            )
          : compileOnly === 1
            ? "a.o"
            : "a.out"
        : filtered[2]!,
    );
    const source = this.readFile(sourceName);
    const sourceLimit = cs486AsmPreprocessorLimits.sourceCharacters;
    if (source.length > sourceLimit)
      return this.toolchainFailure(language, "source limit exceeded");
    if (
      this.options.deferGuestExecution === true &&
      this.admittedMakeRecipeDepth === 0
    ) {
      return {
        exitCode: 0,
        foreground: {
          command: language === "asm" ? "as" : language === "cpp" ? "c++" : "c",
          credentials: this.options.credentials(),
          kind: "compile",
          task: {
            compileOnly: compileOnly === 1,
            kind: "source",
            language: "asm",
            outputPath,
            runAfterCompile: false,
            source,
            sourceName,
            assemblerDialect: this.options.profile.id,
            assemblerHome:
              this.environment.get("HOME") ?? this.options.profile.home,
          },
          umask: this.filesystem.getUmask(),
        },
        stderr: "",
        stdout: "",
      };
    }
    const includeBytesBefore = this.ioReadBytes;
    const output =
      compileOnly === 1
        ? assembleCs486Object(source, this.assemblerOptions(sourceName))
        : assembleCs486(source, this.assemblerOptions(sourceName));
    const object = output.format === "cs486-object";
    this.writeFile(
      outputPath,
      `${object ? "CS486OBJ" : "CS486"}\n${JSON.stringify(output)}`,
    );
    return {
      exitCode: 0,
      stderr: "",
      stdout: "",
      cpuCycles: Math.max(
        1,
        Math.ceil((source.length + this.ioReadBytes - includeBytesBefore) / 4) +
          (object
            ? output.assembly.split("\n").length * 2
            : output.instructions.length * 4),
      ),
    };
  }

  private compileCFamilyDriver(
    language: "c" | "cpp",
    arguments_: readonly string[],
    usageText: string,
  ): ShellCommandResult {
    const options = this.parseCFamilyCommandOptions(arguments_, language);
    const compileOnlyCount = options.arguments.filter(
      (argument) => argument === "-c",
    ).length;
    if (compileOnlyCount > 1) return this.toolchainUsage(usageText);
    const compileOnly = compileOnlyCount === 1;
    const linkOperands: string[] = [];
    const libraryPathTokens: string[] = [];
    const ordinaryOperands: string[] = [];
    let outputOperand: string | undefined;
    for (let index = 0; index < options.arguments.length; index += 1) {
      const argument = options.arguments[index]!;
      if (argument === "-c") continue;
      if (argument === "-o") {
        if (
          outputOperand !== undefined ||
          options.arguments[index + 1] === undefined
        )
          return this.toolchainUsage(usageText);
        outputOperand = options.arguments[++index]!;
        continue;
      }
      if (argument === "-L") {
        const directory = options.arguments[++index];
        if (directory === undefined) return this.toolchainUsage(usageText);
        libraryPathTokens.push("-L", directory);
        continue;
      }
      if (argument.startsWith("-L") || argument.startsWith("-l")) {
        if (argument.startsWith("-L")) libraryPathTokens.push(argument);
        else linkOperands.push(argument);
        continue;
      }
      if (argument.startsWith("-")) {
        return this.toolchainFailure(
          language,
          `unsupported compiler-driver option '${argument}'`,
          2,
        );
      }
      ordinaryOperands.push(argument);
      linkOperands.push(argument);
    }
    if (ordinaryOperands.length === 0 || ordinaryOperands.length > 64) {
      return this.toolchainUsage(usageText);
    }
    const expectedExtension =
      language === "c" ? /\.c$/iu : /\.(?:cc|cpp|cxx)$/iu;
    let sourceOperands = ordinaryOperands.filter((operand) =>
      expectedExtension.test(operand),
    );
    if (sourceOperands.length === 0 && ordinaryOperands.length === 1) {
      const candidate = this.readFile(this.resolvePath(ordinaryOperands[0]!));
      if (
        !candidate.startsWith("CS486OBJ\n") &&
        !candidate.startsWith("CS486AR\n")
      ) {
        sourceOperands = [ordinaryOperands[0]!];
      }
    }
    if (sourceOperands.length > 1) {
      return this.toolchainFailure(
        language,
        "multiple source files require separate bounded compile steps",
        2,
      );
    }
    const sourcePath = sourceOperands[0];
    const modelLibraryTokens =
      this.options.profile.id === "linux"
        ? ["-L", `/usr/lib/${options.dataModel}`]
        : [];
    if (sourcePath === undefined) {
      if (compileOnly || options.dependencyGeneration)
        return this.toolchainUsage(usageText);
      const linkerArguments = [
        ...modelLibraryTokens,
        ...options.arguments,
        ...(this.options.profile.id === "linux" ? ["-lc"] : []),
      ];
      return this.linkObjects(linkerArguments);
    }
    if (
      compileOnly &&
      (ordinaryOperands.length !== 1 ||
        linkOperands.length !== 1 ||
        libraryPathTokens.length > 0)
    ) {
      return this.toolchainFailure(
        language,
        "compile-only mode accepts exactly one source and no link inputs",
        2,
      );
    }
    if (!compileOnly && this.options.profile.id === "linux") {
      libraryPathTokens.unshift(...modelLibraryTokens);
      linkOperands.push("-lc");
    }
    const sourceOperandIndex = linkOperands.indexOf(sourcePath);
    const linkInputsBefore = compileOnly
      ? []
      : this.readCompilerLinkInputs([
          ...libraryPathTokens,
          ...linkOperands.slice(0, sourceOperandIndex),
        ]);
    const linkInputs = compileOnly
      ? []
      : this.readCompilerLinkInputs([
          ...libraryPathTokens,
          ...linkOperands.slice(sourceOperandIndex + 1),
        ]);
    const sourceName = this.resolvePath(sourcePath);
    const outputName =
      outputOperand ??
      (this.options.profile.id === "dos"
        ? replacePathExtension(sourcePath, compileOnly ? ".OBJ" : ".CSX")
        : compileOnly
          ? "a.o"
          : "a.out");
    const outputPath = this.resolvePath(outputName);
    const dependencyOutputPath = options.dependencyGeneration
      ? this.resolvePath(
          options.dependencyFile ?? replacePathExtension(outputPath, ".d"),
        )
      : undefined;
    const source = this.readFile(sourceName);
    if (source.length > cs486CPreprocessorLimits.rootSourceCharacters) {
      return this.toolchainFailure(language, "source limit exceeded");
    }
    if (
      this.options.deferGuestExecution === true &&
      this.admittedMakeRecipeDepth === 0
    ) {
      return {
        exitCode: 0,
        foreground: {
          command: language === "cpp" ? "c++" : "c",
          credentials: this.options.credentials(),
          kind: "compile",
          task: {
            cDefinitions: options.definitions,
            cDataModel: options.dataModel,
            cIncludePaths: options.includePaths,
            cOptimizationLevel: options.optimizationLevel,
            cUndefines: options.undefines,
            compileOnly,
            ...(dependencyOutputPath === undefined
              ? {}
              : {
                  dependencyOutputPath,
                  dependencyTarget: outputName,
                }),
            kind: "source",
            language,
            ...(linkInputs.length === 0 ? {} : { linkInputs }),
            ...(linkInputsBefore.length === 0 ? {} : { linkInputsBefore }),
            outputPath,
            runAfterCompile: false,
            source,
            sourceName,
          },
          umask: this.filesystem.getUmask(),
        },
        stderr: "",
        stdout: "",
      };
    }

    const includeBytesBefore = this.ioReadBytes;
    const dependencies = [sourceName];
    const frontendOptions = this.cFamilyFrontendOptions(
      sourceName,
      options.includePaths,
      options.definitions,
      options.undefines,
      options.optimizationLevel,
      options.dataModel,
      dependencies,
    );
    const object = compileCs486Object(language, source, frontendOptions);
    const output = compileOnly
      ? object
      : linkCs486Objects(
          selectParsedCs486LinkInputs([
            ...linkInputsBefore,
            { kind: "object", object },
            ...linkInputs,
          ]).objects,
        );
    const encoded = `${output.format === "cs486-object" ? "CS486OBJ" : "CS486"}\n${JSON.stringify(output)}`;
    this.filesystem.transaction(() => {
      this.writeFile(outputPath, encoded);
      if (dependencyOutputPath !== undefined) {
        this.writeFile(
          dependencyOutputPath,
          renderCompilerDependencies(outputName, dependencies),
        );
      }
    });
    return {
      cpuCycles: Math.max(
        1,
        Math.ceil((source.length + this.ioReadBytes - includeBytesBefore) / 4) +
          (output.format === "cs486-object"
            ? output.assembly.split("\n").length * 2
            : output.instructions.length * 4),
      ),
      exitCode: 0,
      stderr: "",
      stdout: "",
    };
  }

  private readCompilerLinkInputs(
    arguments_: readonly string[],
  ): readonly Cs486LinkInput[] {
    const libraryPaths: string[] = [];
    const operands: string[] = [];
    for (let index = 0; index < arguments_.length; index += 1) {
      const argument = arguments_[index]!;
      const libraryPath =
        argument === "-L"
          ? arguments_[++index]
          : argument.startsWith("-L")
            ? argument.slice(2)
            : undefined;
      if (libraryPath !== undefined) {
        if (
          this.options.profile.id !== "linux" ||
          libraryPath.length === 0 ||
          libraryPath.length > 128
        ) {
          throw new Error("invalid compiler library path");
        }
        const resolved = this.resolvePath(libraryPath);
        if (!libraryPaths.includes(resolved)) libraryPaths.push(resolved);
        if (libraryPaths.length > 16)
          throw new Error("library path count limit exceeded");
        continue;
      }
      operands.push(argument);
    }
    const searchPaths = [...libraryPaths, "/usr/lib"];
    return operands.map((operand): Cs486LinkInput => {
      if (operand.startsWith("-l")) {
        if (!/^-l[A-Za-z0-9_+.-]{1,64}$/u.test(operand)) {
          throw new Error(`invalid library option '${operand}'`);
        }
        const library = operand.slice(2);
        const path = searchPaths
          .map((directory) =>
            this.filesystem.normalize(
              `${directory.replace(/\/$/u, "")}/lib${library}.csa`,
            ),
          )
          .find(
            (candidate) =>
              this.filesystem.exists(candidate) &&
              !this.filesystem.isDirectory(candidate),
          );
        if (path === undefined) throw new Error(`cannot find -l${library}`);
        return {
          archive: this.parseCompilerArchive(this.readFile(path)),
          kind: "archive",
        };
      }
      const encoded = this.readFile(this.resolvePath(operand));
      return encoded.startsWith("CS486AR\n")
        ? { archive: this.parseCompilerArchive(encoded), kind: "archive" }
        : { kind: "object", object: this.parseCs486Object(encoded, operand) };
    });
  }

  private linkObjects(arguments_: readonly string[]): ShellCommandResult {
    const usageText =
      this.options.profile.id === "dos"
        ? "LINK <objects...> [/OUT:output] [/ENTRY:symbol]"
        : "ld <objects|archives...> [-L directory] [-l library] [-o output] [-e symbol]";
    arguments_ = this.normalizeLinkOptions(arguments_);
    let outputPath = this.options.profile.id === "dos" ? "" : "a.out";
    let entry: string | undefined;
    const libraryPaths: string[] = [];
    const orderedOperands: string[] = [];
    let outputSeen = false;
    let entrySeen = false;
    for (let index = 0; index < arguments_.length; index += 1) {
      const argument = arguments_[index]!;
      if (argument === "-o" || argument === "-e" || argument === "--entry") {
        const value = arguments_[++index];
        if (value === undefined) return this.toolchainUsage(usageText);
        if (argument === "-o") {
          if (outputSeen) return this.toolchainUsage(usageText);
          outputSeen = true;
          outputPath = value;
        } else {
          if (entrySeen) return this.toolchainUsage(usageText);
          entrySeen = true;
          entry = value;
        }
        continue;
      }
      const libraryPath =
        argument === "-L"
          ? arguments_[++index]
          : argument.slice(0, 2) === "-L"
            ? argument.slice(2)
            : undefined;
      if (libraryPath !== undefined) {
        if (
          this.options.profile.id !== "linux" ||
          libraryPath.length === 0 ||
          libraryPath.length > 128
        ) {
          return this.toolchainUsage(usageText);
        }
        const resolved = this.resolvePath(libraryPath);
        if (!libraryPaths.includes(resolved)) libraryPaths.push(resolved);
        if (libraryPaths.length > 16)
          return this.toolchainFailure("ld", "library path limit exceeded");
        continue;
      }
      if (argument.startsWith("-") && !argument.startsWith("-l")) {
        return this.toolchainFailure(
          "ld",
          `unsupported option '${argument}'`,
          2,
        );
      }
      orderedOperands.push(argument);
    }
    if (orderedOperands.length === 0 || orderedOperands.length > 64)
      return this.toolchainUsage(usageText);
    const searchPaths = [...libraryPaths, "/usr/lib"];
    const inputs: Cs486LinkInput[] = orderedOperands.map((operand) => {
      if (operand.startsWith("-l")) {
        if (
          this.options.profile.id !== "linux" ||
          !/^-l[A-Za-z0-9_+.-]{1,64}$/u.test(operand)
        ) {
          throw new Error(`invalid library option '${operand}'`);
        }
        const library = operand.slice(2);
        const path = searchPaths
          .map((directory) =>
            this.filesystem.normalize(
              `${directory.replace(/\/$/u, "")}/lib${library}.csa`,
            ),
          )
          .find(
            (candidate) =>
              this.filesystem.exists(candidate) &&
              !this.filesystem.isDirectory(candidate),
          );
        if (path === undefined) throw new Error(`cannot find -l${library}`);
        return {
          archive: this.parseCompilerArchive(this.readFile(path)),
          kind: "archive",
        };
      }
      const encoded = this.readFile(this.resolvePath(operand));
      return encoded.startsWith("CS486AR\n")
        ? { archive: this.parseCompilerArchive(encoded), kind: "archive" }
        : { kind: "object", object: this.parseCs486Object(encoded, operand) };
    });
    const selection = selectParsedCs486LinkInputs(inputs);
    const objects = selection.objects;
    if (outputPath.length === 0) {
      const firstPath = orderedOperands.find(
        (operand) => !operand.startsWith("-l"),
      );
      if (firstPath === undefined) return this.toolchainUsage(usageText);
      outputPath = replacePathExtension(firstPath, ".CSX");
    }
    outputPath = this.resolvePath(outputPath);
    if (
      this.options.deferGuestExecution === true &&
      this.admittedMakeRecipeDepth === 0
    ) {
      return {
        exitCode: 0,
        foreground: {
          command: "ld",
          credentials: this.options.credentials(),
          kind: "compile",
          task: { entry, kind: "link", objects, outputPath },
          umask: this.filesystem.getUmask(),
        },
        stderr: "",
        stdout: "",
      };
    }
    const executable = linkCs486Objects(objects, { entry });
    this.writeFile(outputPath, `CS486\n${JSON.stringify(executable)}`);
    return {
      exitCode: 0,
      stderr: "",
      stdout: "",
      cpuCycles: Math.min(
        1_000_000,
        objects.reduce(
          (total, object) =>
            total + object.symbols.length * 4 + object.relocations.length * 4,
          executable.instructions.length * 4,
        ) +
          selection.symbolIndexLookups * 2 +
          selection.archiveMembersExamined * 8,
      ),
    };
  }

  private parseCompilerArchive(encoded: string): Cs486Archive {
    return parseInstalledHostedCArchive(encoded) ?? parseCs486Archive(encoded);
  }

  private runExecutable(arguments_: readonly string[]): ShellCommandResult {
    arguments_ = arguments_.map((argument) =>
      this.options.profile.id === "dos" && /^\/stats$/iu.test(argument)
        ? "--stats"
        : this.dosOption(argument),
    );
    let stats = false;
    const trailingOption = arguments_[arguments_.length - 1];
    if (
      this.options.profile.id === "dos" &&
      (trailingOption === "--stats" || trailingOption === "-v")
    ) {
      stats = true;
      arguments_ = arguments_.slice(0, -1);
    }
    if (arguments_[0] === "--stats" || arguments_[0] === "-v") {
      if (stats) return this.toolchainUsage("run [--stats] <executable>");
      stats = true;
      arguments_ = arguments_.slice(1);
    }
    const [path, ...programArguments] = arguments_;
    if (path === undefined)
      return this.toolchainUsage("run [--stats] <executable> [arguments ...]");
    if (this.options.profile.id === "dos" && programArguments.length > 0) {
      return this.toolchainUsage("run [--stats] <executable>");
    }
    const resolvedPath = this.resolvePath(path);
    const encoded = this.readFile(resolvedPath);
    const utility = decodeSystemUtility(encoded);
    if (utility !== undefined) {
      if (stats)
        return failure(path, "system utilities do not accept run --stats");
      return this.dispatch(utility, programArguments, "");
    }
    if (!encoded.startsWith("CS486\n"))
      return failure(path, "not a CS486 executable");
    let executable: unknown;
    try {
      executable = JSON.parse(encoded.slice(6));
    } catch {
      return failure(path, "invalid executable encoding");
    }
    validateCs486Executable(executable);
    return this.executeCs486(
      executable,
      stats,
      0,
      this.options.profile.id === "linux" &&
        (executable.version === 4 || executable.version === 5) &&
        executable.symbols?.some(
          ({ name, section, type }) =>
            name === "main" && section === "text" && type === "function",
        ) === true
        ? {
            argv: [resolvedPath, ...programArguments],
            cwd: this.currentDirectory,
            environment: this.hostedEnvironmentSnapshot(),
          }
        : undefined,
    );
  }

  private resolveLinuxExecutableName(name: string): string | undefined {
    if (
      name.length < 1 ||
      name.length > 64 ||
      name.includes("/") ||
      name.includes("\\") ||
      !/^[A-Za-z0-9+_.-]+$/u.test(name)
    )
      return undefined;
    const path = this.environment.get("PATH") ?? "";
    if (path.length > 4_096) throw new Error("PATH exceeds the lookup limit");
    for (const directory of path.split(":").slice(0, 16)) {
      if (directory.length === 0 || directory.length > 255) continue;
      let candidate: string;
      try {
        const normalizedDirectory = this.resolvePath(directory);
        candidate = this.filesystem.normalize(
          joinPath(normalizedDirectory, name),
        );
      } catch {
        continue;
      }
      try {
        if (!this.filesystem.exists(candidate)) continue;
        if (this.filesystem.isDirectory(candidate))
          throw new Error(`${name}: resolved PATH entry is a directory`);
        if (!this.filesystem.hasAccess(candidate, 0b101))
          throw new Error(`${name}: permission denied`);
      } catch (error: unknown) {
        const detail = error instanceof Error ? error.message : "";
        if (detail.startsWith(`${name}:`)) throw error;
        continue;
      }
      return candidate;
    }
    return undefined;
  }

  private executeCs486(
    executable: Cs486Executable,
    stats: boolean,
    compileCycles = 0,
    hostedStartup?: {
      readonly argv: readonly string[];
      readonly cwd: string;
      readonly environment: readonly (readonly [string, string])[];
    },
  ): ShellCommandResult {
    if (this.options.deferGuestExecution === true) {
      return {
        exitCode: 0,
        foreground: {
          command: compileCycles > 0 ? "basic" : "run",
          compileCycles,
          credentials: this.options.credentials(),
          executable,
          ...(hostedStartup === undefined ? {} : { hostedStartup }),
          kind: "cs486",
          stats,
          umask: this.filesystem.getUmask(),
        },
        stderr: "",
        stdout: "",
      };
    }
    const admit = this.options.admitProcessMemory;
    if (admit === undefined) {
      throw new Error("process memory admission is unavailable");
    }
    const grant = admit({
      displayName: "CS486 process",
      executable,
      kind: "execution",
      moduleId: "cs486-process",
    });
    let result;
    let csAbi: CsAbiRuntime | undefined;
    let hostedStdout = "";
    let hostedStderr = "";
    try {
      if (
        !Number.isSafeInteger(grant.memoryBytes) ||
        grant.memoryBytes <= 0 ||
        grant.released
      ) {
        throw new TypeError(
          "process memory admission returned an invalid grant",
        );
      }
      const runOptions = {
        cpuModel: this.options.hardware.cpuModel,
        // Keep guest execution bounded, but allow medium-sized benchmark and
        // compiled workloads to complete in the same 100k-instruction envelope
        // used by the core CS486 runner.
        instructionLimit: 100_000,
        memoryBytes: grant.memoryBytes,
      } as const;
      if (hostedStartup === undefined) {
        result = runCs486(executable, runOptions);
      } else {
        const credentials = this.options.credentials();
        const prepared = prepareCsAbiStartup(
          executable,
          hostedStartup,
          credentials,
        );
        csAbi = new CsAbiRuntime({
          computerId: String(this.options.computerId),
          credentials,
          currentTick: this.options.currentTick,
          currentWallTimeMilliseconds: (): number =>
            this.options.clock.currentWallTimeMilliseconds(),
          cwd: hostedStartup.cwd,
          filesystem: this.filesystem,
          heapBaseBytes: prepared.heapBaseBytes,
          heapWords: prepared.heapWords,
          outputObserver: (descriptor, text): void => {
            if (descriptor === 1) hostedStdout += text;
            else hostedStderr += text;
          },
          runHostWork: (_lane, _deterministicUnits, action): boolean => {
            action();
            return true;
          },
          startupAddress: prepared.startupAddress,
          terminal: new TerminalBuffer(80, 25),
        });
        result = runCs486(executable, {
          ...runOptions,
          processImage: prepared.image,
          syscallHandler: csAbi.syscallHandler,
        });
      }
    } finally {
      csAbi?.finalize();
      if (!grant.released) grant.release();
    }
    const runtimeName = cpuModelSpecification(
      this.options.hardware.cpuModel,
    ).runtimeName;
    const newline = this.textPolicy.newline;
    const runtimeStderr = stats
      ? `${runtimeName}: ${result.executedInstructions} instructions, ${result.cycles} CPU cycles, ${cpuCyclesToMicroseconds(result.cycles, this.options.hardware.clockHz).toFixed(3)} us at ${formatClock(this.options.hardware.clockHz)}, ${result.state}${newline}${formatMicroarchitectureStats(result.microarchitecture)}${newline}`
      : result.state === "yielded"
        ? `${runtimeName}: execution limit reached${newline}`
        : "";
    return {
      exitCode: result.state === "halted" ? 0 : 124,
      stderr:
        normalizeGuestProgramOutput(hostedStderr, newline) + runtimeStderr,
      stdout: normalizeGuestProgramOutput(
        result.output + hostedStdout,
        newline,
      ),
      cpuCycles: Math.min(1_000_000, compileCycles + result.cycles),
    };
  }

  private hostedEnvironmentSnapshot(): readonly (readonly [string, string])[] {
    const credentials = this.options.credentials();
    const values = new Map<string, string>([
      ["CS_ABI", "cs-abi-1"],
      ["CS_PROFILE", "cs-linux-word32"],
      ["PWD", this.currentDirectory],
      ["USER", this.environment.get("USER") ?? credentials.loginName],
    ]);
    for (const name of ["HOME", "PATH", "SHELL", "TERM"] as const) {
      const value = this.environment.get(name);
      if (value !== undefined) values.set(name, value);
    }
    return Object.freeze(
      [...values]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([name, value]) => Object.freeze([name, value] as const)),
    );
  }

  private debugExecutable(arguments_: readonly string[]): ShellCommandResult {
    const newline = this.textPolicy.newline;
    const dos = this.options.profile.id === "dos";
    const usageText = dos
      ? "DEBUG <program>|LOAD <program>|R|U [address] [count]|D <address> [length]|BP <address>|BC <address|*>|T|G [limit]|STATUS|Q"
      : "csdb <program>|load <program>|regs|disasm [address] [count]|memory <address> [length]|break <address>|clear <address|all>|step|continue [limit]|status|quit";
    if (arguments_.length === 0) return this.toolchainUsage(usageText);

    const aliases = dos
      ? new Map<string, string>([
          ["load", "load"],
          ["r", "regs"],
          ["regs", "regs"],
          ["u", "disasm"],
          ["disasm", "disasm"],
          ["d", "memory"],
          ["memory", "memory"],
          ["bp", "break"],
          ["break", "break"],
          ["bc", "clear"],
          ["clear", "clear"],
          ["t", "step"],
          ["step", "step"],
          ["g", "continue"],
          ["continue", "continue"],
          ["status", "status"],
          ["q", "quit"],
          ["quit", "quit"],
          ["?", "help"],
          ["help", "help"],
        ])
      : new Map<string, string>([
          ["load", "load"],
          ["regs", "regs"],
          ["disasm", "disasm"],
          ["memory", "memory"],
          ["break", "break"],
          ["clear", "clear"],
          ["step", "step"],
          ["continue", "continue"],
          ["status", "status"],
          ["quit", "quit"],
          ["help", "help"],
        ]);
    const requested = arguments_[0]!;
    const operation = aliases.get(requested.toLowerCase()) ?? "load";
    const operands = aliases.has(requested.toLowerCase())
      ? arguments_.slice(1)
      : arguments_;

    try {
      if (operation === "help") return success(`${usageText}${newline}`);
      if (operation === "quit") {
        if (operands.length !== 0) return this.toolchainUsage(usageText);
        this.closeDebugger();
        return success(
          dos ? `Program terminated.${newline}` : `debugger closed${newline}`,
        );
      }
      if (operation === "load") {
        if (operands.length !== 1) return this.toolchainUsage(usageText);
        const path = operands[0]!;
        const encoded = this.readFile(path);
        if (!encoded.startsWith("CS486\n"))
          return this.debuggerFailure("not a CS486 executable");
        let executable: unknown;
        try {
          executable = JSON.parse(encoded.slice(6));
        } catch {
          return this.debuggerFailure("invalid executable encoding");
        }
        validateCs486Executable(executable);
        this.closeDebugger();
        const grant = this.options.admitProcessMemory({
          displayName: "CS486 debugger",
          executable,
          kind: "debugger",
          moduleId: "cs486-debugger",
        });
        let debugger_: Cs486Debugger;
        try {
          if (
            !Number.isSafeInteger(grant.memoryBytes) ||
            grant.memoryBytes <= 0 ||
            grant.released
          ) {
            throw new TypeError(
              "process memory admission returned an invalid grant",
            );
          }
          debugger_ = Cs486Debugger.load(executable, {
            cpuModel: this.options.hardware.cpuModel,
            memoryBytes: grant.memoryBytes,
          });
          const pid = this.options.selfPid?.();
          if (pid !== undefined) grant.bindProcess(pid);
        } catch (error: unknown) {
          if (!grant.released) grant.release();
          throw error;
        }
        this.cs486Debugger = debugger_;
        this.cs486DebuggerMemoryGrant = grant;
        this.cs486DebuggerOutputCursor = 0;
        this.cs486DebuggerSymbols.clear();
        for (const symbol of executable.symbols ?? []) {
          if ((symbol.section ?? "text") === "text")
            this.cs486DebuggerSymbols.set(symbol.name, symbol.address);
        }
        const first = debugger_.disassemble(0, 1)[0];
        const displayPath = dos
          ? this.options.profile.pathDialect.display(this.resolvePath(path))
          : this.resolvePath(path);
        return success(
          `${dos ? "Loaded" : "loaded"} ${displayPath}: ${String(executable.instructions.length)} instructions, ${cs486ExecutableDataModel(executable)}${newline}${
            first === undefined
              ? ""
              : `${this.formatDebuggerInstruction(first)}${newline}`
          }`,
        );
      }

      const debugger_ = this.cs486Debugger;
      if (debugger_ === undefined)
        return this.debuggerFailure(
          dos ? "No program loaded." : "no program loaded",
        );
      if (operation === "status") {
        if (operands.length !== 0) return this.toolchainUsage(usageText);
        return success(
          `${this.formatDebuggerOutcome(debugger_.state)}${newline}`,
        );
      }
      if (operation === "regs") {
        if (operands.length !== 0) return this.toolchainUsage(usageText);
        const snapshot = debugger_.registerSnapshot();
        const names = [
          "eax",
          "ebx",
          "ecx",
          "edx",
          "esi",
          "edi",
          "esp",
          "ebp",
        ] as const;
        const body = dos
          ? [
              `EIP=${this.formatDebuggerAddress(snapshot.instructionAddress)} ${names
                .slice(0, 4)
                .map(
                  (name) =>
                    `${name.toUpperCase()}=${this.formatDebuggerWord(snapshot.registers[name])}`,
                )
                .join(" ")}`,
              names
                .slice(4)
                .map(
                  (name) =>
                    `${name.toUpperCase()}=${this.formatDebuggerWord(snapshot.registers[name])}`,
                )
                .join(" "),
            ]
          : [
              `ip ${this.formatDebuggerAddress(snapshot.instructionAddress)}`,
              ...names.map(
                (name) =>
                  `${name} ${this.formatDebuggerWord(snapshot.registers[name])} (${String(snapshot.registers[name])})`,
              ),
            ];
        return success(`${body.join(newline)}${newline}`);
      }
      if (operation === "disasm") {
        if (operands.length > 2) return this.toolchainUsage(usageText);
        const address =
          operands[0] === undefined
            ? debugger_.registerSnapshot().instructionAddress
            : this.parseDebuggerAddress(operands[0]);
        const count =
          operands[1] === undefined ? 8 : this.parseDebuggerCount(operands[1]);
        const listing = debugger_.disassemble(address, count);
        return success(
          `${listing.map((instruction) => this.formatDebuggerInstruction(instruction)).join(newline)}${listing.length === 0 ? "" : newline}`,
        );
      }
      if (operation === "memory") {
        if (operands.length < 1 || operands.length > 2)
          return this.toolchainUsage(usageText);
        const address = this.parseDebuggerAddress(operands[0]!);
        const length =
          operands[1] === undefined ? 16 : this.parseDebuggerCount(operands[1]);
        const bytes = debugger_.readMemory(address, length);
        const rows: string[] = [];
        for (let offset = 0; offset < bytes.length; offset += 16) {
          const row = bytes.slice(offset, Math.min(bytes.length, offset + 16));
          rows.push(
            `${this.formatDebuggerAddress(address + offset)}  ${[...row]
              .map((byte) => byte.toString(16).padStart(2, "0"))
              .join(" ")}`,
          );
        }
        return success(`${rows.join(newline)}${newline}`);
      }
      if (operation === "break") {
        if (operands.length !== 1) return this.toolchainUsage(usageText);
        const address = this.parseDebuggerAddress(operands[0]!);
        const added = debugger_.setBreakpoint(address);
        return success(
          `${added ? "breakpoint set" : "breakpoint already set"} at ${this.formatDebuggerAddress(address)}${newline}`,
        );
      }
      if (operation === "clear") {
        if (operands.length !== 1) return this.toolchainUsage(usageText);
        if (operands[0]!.toLowerCase() === "all" || operands[0] === "*") {
          debugger_.clearBreakpoints();
          return success(
            `${dos ? "All breakpoints cleared." : "all breakpoints cleared"}${newline}`,
          );
        }
        const address = this.parseDebuggerAddress(operands[0]!);
        const removed = debugger_.clearBreakpoint(address);
        return success(
          `${removed ? "breakpoint cleared" : "breakpoint was not set"} at ${this.formatDebuggerAddress(address)}${newline}`,
        );
      }
      if (operation === "step") {
        if (operands.length !== 0) return this.toolchainUsage(usageText);
        if (this.options.deferGuestExecution === true)
          return {
            exitCode: 0,
            foreground: {
              command: dos ? "debug" : "csdb",
              complete: () => this.debuggerExecutionResult(debugger_.state),
              credentials: this.options.credentials(),
              kind: "debugger",
              start: () => debugger_.startStepExecution(),
              umask: this.filesystem.getUmask(),
            },
            stderr: "",
            stdout: "",
          };
        return this.debuggerExecutionResult(debugger_.step());
      }
      if (operation === "continue") {
        if (operands.length > 1) return this.toolchainUsage(usageText);
        const limit =
          operands[0] === undefined
            ? 10_000
            : this.parseDebuggerCount(operands[0]);
        if (this.options.deferGuestExecution === true)
          return {
            exitCode: 0,
            foreground: {
              command: dos ? "debug" : "csdb",
              complete: () => this.debuggerExecutionResult(debugger_.state),
              credentials: this.options.credentials(),
              kind: "debugger",
              start: () => debugger_.startContinueExecution(limit),
              umask: this.filesystem.getUmask(),
            },
            stderr: "",
            stdout: "",
          };
        return this.debuggerExecutionResult(debugger_.continue(limit));
      }
      return this.toolchainUsage(usageText);
    } catch (error: unknown) {
      return this.debuggerFailure(message(error));
    }
  }

  private debuggerExecutionResult(
    outcome: Cs486DebuggerOutcome,
  ): ShellCommandResult {
    const newline = this.textPolicy.newline;
    const output = this.takeDebuggerOutput();
    const state = `${this.formatDebuggerOutcome(outcome)}${newline}`;
    if (outcome.kind === "faulted")
      return status(
        1,
        output,
        `${outcome.fault.typeName}: ${outcome.fault.message}${newline}`,
      );
    if (outcome.kind === "paused" && outcome.reason === "interrupted")
      return status(
        130,
        this.joinDebuggerOutput(output, `^C${newline}${state}`),
        "",
      );
    if (outcome.kind === "limit")
      return status(124, this.joinDebuggerOutput(output, state), "");
    return success(this.joinDebuggerOutput(output, state));
  }

  private takeDebuggerOutput(): string {
    const debugger_ = this.cs486Debugger;
    if (debugger_ === undefined) return "";
    const output = debugger_.output.slice(this.cs486DebuggerOutputCursor);
    this.cs486DebuggerOutputCursor = debugger_.output.length;
    return normalizeGuestProgramOutput(output, this.textPolicy.newline);
  }

  private joinDebuggerOutput(output: string, state: string): string {
    if (output.length === 0) return state;
    return output.endsWith(this.textPolicy.newline)
      ? `${output}${state}`
      : `${output}${this.textPolicy.newline}${state}`;
  }

  private formatDebuggerOutcome(outcome: Cs486DebuggerOutcome): string {
    const address = this.formatDebuggerAddress(outcome.address);
    const work = `${String(outcome.executedInstructions)} instruction(s), ${String(outcome.cpuCycles)} cycles`;
    if (outcome.kind === "paused")
      return `${this.options.profile.id === "dos" ? "Paused" : "paused"} at ${address} (${outcome.reason}; ${work})`;
    if (outcome.kind === "halted")
      return `${this.options.profile.id === "dos" ? "Halted" : "halted"} at ${address} (${work})`;
    if (outcome.kind === "limit")
      return `${this.options.profile.id === "dos" ? "Continue limit reached" : "continue limit reached"} at ${address} (${work})`;
    return `${this.options.profile.id === "dos" ? "Faulted" : "faulted"} at ${address} (${work})`;
  }

  private formatDebuggerInstruction(
    instruction: ReturnType<Cs486Debugger["disassemble"]>[number],
  ): string {
    const labels =
      instruction.labels.length === 0
        ? ""
        : `${instruction.labels.join(",")}: `;
    return `${this.formatDebuggerAddress(instruction.address)}  ${labels}${instruction.text}`;
  }

  private parseDebuggerAddress(value: string): number {
    const symbol = this.cs486DebuggerSymbols.get(value);
    if (symbol !== undefined) return symbol;
    if (this.options.profile.id === "dos") {
      const matches = [...this.cs486DebuggerSymbols].filter(
        ([name]) => name.toLowerCase() === value.toLowerCase(),
      );
      if (matches.length === 1) return matches[0]![1];
    }
    const parsed = this.parseDebuggerNumber(
      value,
      this.options.profile.id === "dos" ? 16 : 10,
    );
    if (parsed === undefined)
      throw new RangeError(`invalid debug address ${value}`);
    return parsed;
  }

  private parseDebuggerCount(value: string): number {
    const parsed = this.parseDebuggerNumber(value, 10);
    if (parsed === undefined || parsed <= 0)
      throw new RangeError(`invalid debug count ${value}`);
    return parsed;
  }

  private parseDebuggerNumber(
    value: string,
    defaultRadix: 10 | 16,
  ): number | undefined {
    const radix = /^0x/iu.test(value) ? 16 : defaultRadix;
    const digits = /^0x/iu.test(value) ? value.slice(2) : value;
    if (
      digits.length === 0 ||
      !(radix === 16 ? /^[0-9a-f]+$/iu : /^\d+$/u).test(digits)
    )
      return undefined;
    const parsed = Number.parseInt(digits, radix);
    return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
  }

  private formatDebuggerAddress(address: number): string {
    return this.options.profile.id === "dos"
      ? address.toString(16).toUpperCase().padStart(8, "0")
      : `0x${address.toString(16).padStart(8, "0")}`;
  }

  private formatDebuggerWord(value: number): string {
    return (value >>> 0).toString(16).toUpperCase().padStart(8, "0");
  }

  private debuggerFailure(detail: string): ShellCommandResult {
    const command = this.options.profile.id === "dos" ? "DEBUG" : "csdb";
    return status(1, "", `${command}: ${detail}${this.textPolicy.newline}`);
  }

  private objectDump(arguments_: readonly string[]): ShellCommandResult {
    if (arguments_.length !== 1)
      return this.toolchainUsage("objdump <object|executable>");
    const encoded = this.readFile(arguments_[0]!);
    const newline = this.textPolicy.newline;
    if (encoded.startsWith("CS486OBJ\n")) {
      const object = this.parseCs486Object(encoded, arguments_[0]!);
      return success(
        [
          `format ${object.format} v${String(object.version)} ${object.language} ${cs486ObjectDataModel(object)}`,
          `data ${String(object.dataBytes)} bytes`,
          ...(object.sections ?? []).map((section) =>
            section.name === "text"
              ? `section text align 1 size ${String(section.instructions.length)} instructions`
              : section.name === "bss"
                ? `section bss align ${String(section.alignment)} size ${String(section.size)} bytes`
                : `section ${section.name} align ${String(section.alignment)} size ${String(section.bytes.length)} bytes`,
          ),
          ...object.symbols.map(
            (symbol) =>
              `symbol ${symbol.binding.padEnd(9)} ${symbol.section.padEnd(6)} ${(symbol.type ?? "notype").padEnd(8)} ${symbol.name}${symbol.offset === undefined ? "" : ` @${String(symbol.offset)}`}${symbol.functionSignature === undefined ? "" : ` ${symbol.functionSignature}`}`,
          ),
          ...object.relocations.map(
            (relocation) =>
              `reloc ${relocation.type} ${(relocation.section ?? "text").padEnd(6)} @${String(relocation.offset ?? relocation.instructionOffset)}${relocation.field === undefined ? "" : `.${relocation.field}`} -> ${relocation.symbol}${relocation.addend === undefined || relocation.addend === 0 ? "" : ` ${relocation.addend > 0 ? "+" : ""}${String(relocation.addend)}`}`,
          ),
          object.assembly.replaceAll("\n", newline),
        ].join(newline) + newline,
      );
    }
    if (!encoded.startsWith("CS486\n"))
      return failure(arguments_[0]!, "not a CS486 object or executable");
    const executable: unknown = JSON.parse(encoded.slice(6));
    validateCs486Executable(executable);
    return success(
      [
        `format ${executable.format} v${String(executable.version)} ${cs486ExecutableDataModel(executable)}`,
        ...(executable.functionEntries ?? []).map(
          (entry) =>
            `function @${String(entry.address)} ${entry.functionSignature}`,
        ),
        ...executable.instructions.map(
          (instruction, index) =>
            `${index.toString(16).padStart(4, "0")} ${JSON.stringify(instruction)}`,
        ),
      ].join(newline) + newline,
    );
  }

  private listSymbols(arguments_: readonly string[]): ShellCommandResult {
    if (arguments_.length !== 1)
      return this.toolchainUsage("nm <object|executable>");
    const encoded = this.readFile(arguments_[0]!);
    const newline = this.textPolicy.newline;
    if (encoded.startsWith("CS486OBJ\n")) {
      const object = this.parseCs486Object(encoded, arguments_[0]!);
      return success(
        [
          `# data-model ${cs486ObjectDataModel(object)}`,
          ...object.symbols.map(
            (symbol) =>
              `${symbol.offset?.toString(16).padStart(8, "0") ?? "        "} ${nmSymbolCode(symbol.section, symbol.binding)} ${symbol.name}${symbol.functionSignature === undefined ? "" : ` ${symbol.functionSignature}`}`,
          ),
        ].join(newline) + newline,
      );
    }
    if (!encoded.startsWith("CS486\n"))
      return failure(arguments_[0]!, "not a CS486 object or executable");
    const executable: unknown = JSON.parse(encoded.slice(6));
    validateCs486Executable(executable);
    return success(
      [
        `# data-model ${cs486ExecutableDataModel(executable)}`,
        ...(executable.symbols ?? []).map(
          (symbol) =>
            `${symbol.address.toString(16).padStart(8, "0")} ${nmSymbolCode(symbol.section ?? "text", "global")} ${symbol.name}${symbol.functionSignature === undefined ? "" : ` ${symbol.functionSignature}`}`,
        ),
      ].join(newline) + newline,
    );
  }

  private readCs486Object(path: string): Cs486Object {
    return this.parseCs486Object(this.readFile(path), path);
  }

  private parseCs486Object(encoded: string, path: string): Cs486Object {
    if (!encoded.startsWith("CS486OBJ\n"))
      throw new TypeError(`${path}: not a CS486 object`);
    let object: unknown;
    try {
      object = JSON.parse(encoded.slice(9));
    } catch {
      throw new TypeError(`${path}: invalid object encoding`);
    }
    validateCs486Object(object);
    return object;
  }

  private cpuInfo(arguments_: readonly string[]): ShellCommandResult {
    return arguments_.length === 0
      ? success(this.linuxCpuInfo())
      : usage("cpuinfo");
  }

  private freeMemory(arguments_: readonly string[]): ShellCommandResult {
    if (
      arguments_.length > 1 ||
      (arguments_[0] !== undefined && arguments_[0] !== "-h")
    ) {
      return usage("free [-h]");
    }
    const memory = this.requireLinuxMemorySnapshot().physical;
    const display = arguments_[0] === "-h" ? formatBinaryBytes : String;
    return success(
      `              total        used        free   available\nMem:     ${display(memory.totalBytes).padStart(10)}  ${display(memory.usedBytes).padStart(10)}  ${display(memory.freeBytes).padStart(10)}  ${display(memory.availableBytes).padStart(10)}\nSwap:             0           0           0           0\n`,
    );
  }

  dosCpu(arguments_: readonly string[]): ShellCommandResult {
    if (arguments_.length !== 0) return usage("CPU");
    const cpu = cpuModelSpecification(this.options.hardware.cpuModel);
    return success(
      [
        cpu.displayName,
        `Model ID: ${cpu.id}`,
        `Address size: ${String(cpu.addressBits)} bit`,
        `Data bus: ${String(cpu.dataBusBits)} bit`,
        `Clock speed: ${formatClock(this.options.hardware.clockHz)}`,
        `L1 cache: ${formatCacheBytes(cpu.microarchitecture.l1CacheBytes)}`,
        `External L2 cache: ${formatCacheBytes(cpu.microarchitecture.externalCacheBytes)}`,
        `Cache line: ${String(cpu.microarchitecture.cacheLineBytes)} bytes`,
        `Pipeline: ${cpu.microarchitecture.pipeline}`,
        `Branch prediction: ${cpu.microarchitecture.branchPrediction}`,
        `Memory modules: ${cpu.microarchitecture.memoryModules}`,
        "Execution modes: real, protected, virtual-8086 compatibility",
        "Current mode: protected sandbox",
      ].join("\r\n") + "\r\n",
    );
  }

  dosMemory(arguments_: readonly string[]): ShellCommandResult {
    const option = arguments_[0]?.toUpperCase();
    if (
      arguments_.length > 1 ||
      (option !== undefined &&
        option !== "/C" &&
        option !== "/D" &&
        option !== "/F" &&
        option !== "/P")
    )
      return usage("MEM [/C | /D | /F | /P]");
    if (option === "/P")
      return failure("MEM", "/P paging is not supported by this terminal", 2);
    if (this.options.dosMemorySnapshot === undefined) {
      return failure("MEM", "DOS memory manager is unavailable", 2);
    }
    const layout = this.dosMemoryLayout();
    const snapshot = layout.snapshot;
    const lines = [
      `${formatOsIdentity(this.options.profile.identity)} Memory`,
      "",
      "Memory Type        Total       Used       Free",
      "----------------  ----------  ----------  ----------",
      this.dosMemoryRow("Conventional", layout.conventional),
      this.dosMemoryRow("Upper", layout.upper),
      this.dosMemoryRow("Reserved", layout.reserved),
      this.dosMemoryRow("Extended (XMS)", layout.extended),
      "----------------  ----------  ----------  ----------",
      this.dosMemoryRow("Total memory", layout.total),
      "",
      `${String(snapshot.physical.totalBytes).padStart(12)} bytes total memory`,
      `${String(layout.systemBytes).padStart(12)} bytes DOS system and drivers`,
      `${String(layout.runtimeBytes).padStart(12)} bytes guest runtime`,
      `${String(layout.largestConventionalBlockBytes).padStart(12)} bytes largest executable program size`,
      `${String(layout.largestUpperBlockBytes).padStart(12)} bytes largest free upper memory block`,
    ];
    if (option === "/C") {
      lines.push(
        "",
        "Modules using memory below 1 MB:",
        "Category/Module              Name                     Bytes  Placement",
      );
      for (const module of snapshot.modules) {
        const allocations = module.allocations.filter(
          ({ placement }) => placement !== "extended",
        );
        if (allocations.length === 0) continue;
        const bytes = allocations.reduce(
          (total, allocation) => total + allocation.size,
          0,
        );
        const placements = new Set(
          allocations.map(({ placement }) => placement),
        );
        const placement =
          placements.size === 1 ? titleCase([...placements][0]!) : "Mixed";
        lines.push(
          `${`${module.category}/${module.moduleId}`.padEnd(28)} ${module.displayName.padEnd(20)} ${String(bytes).padStart(10)}  ${placement}`,
        );
      }
    }
    if (option === "/D") {
      const flags = snapshot.flags;
      lines.push(
        "",
        `Memory manager state: ${snapshot.state}`,
        "CPU mode: protected sandbox",
        "DOS compatibility mode: virtual-8086 model",
        "Paging: unavailable",
        `XMS driver (HIMEM.SYS): ${flags.himem ? "installed" : "not installed"}`,
        `XMS service: ${flags.xms ? "available" : "unavailable"}`,
        `HMA size: ${String(flags.hmaBytes)} bytes`,
        `UMB provider (EMM386.EXE): ${flags.emm386NoEms ? "installed (NOEMS)" : "not installed"}`,
        `DOS high requested: ${flags.dosHighRequested ? "yes" : "no"}`,
        `DOS high: ${flags.dosHigh ? "enabled" : "disabled"}`,
        `UMB link: ${flags.umb ? "enabled" : "disabled"}`,
      );
      for (const diagnostic of snapshot.diagnostics) {
        lines.push(
          `Diagnostic ${diagnostic.code}${diagnostic.lineNumber === null ? "" : ` (line ${String(diagnostic.lineNumber)})`}: ${diagnostic.message}`,
        );
      }
    }
    if (option === "/F") {
      lines.push("", "Free memory blocks:");
      this.appendDosFreeExtents(
        lines,
        "Conventional",
        snapshot.regions.conventional,
      );
      this.appendDosFreeExtents(lines, "Upper", snapshot.regions.upper);
      this.appendDosFreeExtents(
        lines,
        "Extended (XMS)",
        snapshot.regions.extended,
      );
      lines.push(
        "",
        "Largest free blocks:",
        `Conventional      ${String(snapshot.regions.conventional.largestFreeBlockBytes).padStart(10)} bytes`,
        `Upper             ${String(snapshot.regions.upper.largestFreeBlockBytes).padStart(10)} bytes`,
        `Extended (XMS)    ${String(snapshot.regions.extended.largestFreeBlockBytes).padStart(10)} bytes`,
      );
    }
    return success(`${lines.join("\r\n")}\r\n`);
  }

  dosAttrib(arguments_: readonly string[]): ShellCommandResult {
    const updates: (readonly [number, boolean])[] = [];
    let recursive = false;
    let path = "*.*";
    let pathSeen = false;
    for (const argument of arguments_) {
      const option = argument.toUpperCase();
      if (option === "/S") {
        recursive = true;
        continue;
      }
      if (/^[+-][RHSA]+$/u.test(option)) {
        const enabled = option[0] === "+";
        for (const token of option.slice(1)) {
          updates.push([dosAttributeForToken(token)!, enabled]);
        }
        continue;
      }
      if (argument.startsWith("/") || pathSeen)
        return status(2, "", "Invalid number of parameters.\r\n");
      path = argument;
      pathSeen = true;
    }
    try {
      const targets =
        /[*?]/u.test(path) || recursive
          ? this.dosDirectoryGroups(path, recursive).flatMap(
              ({ targets: entries }) => entries,
            )
          : this.dosMutationTargets([path]);
      const unique = [...new Set(targets)].sort((left, right) =>
        left.localeCompare(right),
      );
      if (unique.length === 0) return status(1, "", "File not found.\r\n");
      if (updates.length === 0) {
        const current = unique.map((target) => ({
          metadata: this.ensureDosFatMetadata(target)!,
          target,
        }));
        return success(
          `${current
            .map(({ metadata, target }) => {
              const flags = [
                [dosFatAttribute.readOnly, "R"],
                [dosFatAttribute.hidden, "H"],
                [dosFatAttribute.system, "S"],
                [dosFatAttribute.archive, "A"],
              ] as const;
              const rendered = flags
                .map(([attribute, flag]) =>
                  hasDosFatAttribute(metadata.attributes, attribute)
                    ? flag
                    : " ",
                )
                .join("   ");
              return `${rendered}     ${this.options.profile.pathDialect.display(target)}`;
            })
            .join("\r\n")}\r\n`,
        );
      }
      const trial = DosRuntimeState.restore(
        this.dosRuntime!.snapshot(),
        this.dosRuntime!.limits,
      );
      for (const target of unique) {
        const media = this.dosMediaForPath(target, trial)!;
        const metadata = this.ensureDosFatMetadataIn(trial, target)!;
        trial.assertWritable(media.letter, media.generation);
        let attributes = metadata.attributes;
        for (const [attribute, enabled] of updates) {
          attributes = enabled
            ? attributes | attribute
            : attributes & ~attribute;
        }
        trial.setFatAttributes(target, attributes, media.generation);
      }
      this.runDosFilesystemTransaction(() => {
        for (const target of unique) {
          const media = this.dosMediaForPath(target)!;
          const metadata = this.ensureDosFatMetadata(target)!;
          let attributes = metadata.attributes;
          for (const [attribute, enabled] of updates) {
            attributes = enabled
              ? attributes | attribute
              : attributes & ~attribute;
          }
          this.dosRuntime!.setFatAttributes(
            target,
            attributes,
            media.generation,
          );
        }
      });
      return success();
    } catch (error: unknown) {
      return status(1, "", `${message(error)}\r\n`);
    }
  }

  dosLabel(arguments_: readonly string[]): ShellCommandResult {
    if (arguments_.length > 2)
      return status(2, "", "Invalid number of parameters.\r\n");
    let letter = this.dosRuntime?.activeDrive ?? "C";
    let label: string | undefined;
    if (arguments_[0] !== undefined && /^[A-Za-z]:?$/u.test(arguments_[0])) {
      letter = arguments_[0][0]!;
      label = arguments_[1];
    } else if (arguments_[0] !== undefined) {
      label = arguments_[0];
    }
    try {
      const media = this.dosRuntime?.requireMedia(letter);
      if (media === undefined)
        return status(1, "", "Invalid drive specification\r\n");
      if (label === undefined) {
        return success(
          `${this.dosVolumeLines(media.letter, media.volumeLabel).join("\r\n")}\r\n`,
        );
      }
      this.runDosRuntimeTransaction(() => {
        this.dosRuntime!.setVolumeLabel(
          media.letter,
          label,
          media.mediaGeneration,
        );
      });
      return success();
    } catch (error: unknown) {
      if (error instanceof DosDriveError && error.code === "no_media")
        return status(1, "", `Not ready reading drive ${error.drive}\r\n`);
      return status(1, "", `${message(error)}\r\n`);
    }
  }

  dosCheckDisk(arguments_: readonly string[]): ShellCommandResult {
    if (
      arguments_.length > 1 ||
      (arguments_[0] !== undefined && !/^[A-Za-z]:?$/u.test(arguments_[0]))
    ) {
      return status(2, "", "CHKDSK is read-only; usage: CHKDSK [drive:]\r\n");
    }
    const letter = arguments_[0]?.[0] ?? this.dosRuntime?.activeDrive ?? "C";
    try {
      const media = this.dosRuntime?.requireMedia(letter);
      if (media === undefined)
        return status(1, "", "Invalid drive specification\r\n");
      const root = `/drives/${media.letter.toLowerCase()}`;
      const entries = this.collectDosDiskEntries(root);
      let files = 0;
      let directories = 0;
      let fileBytes = 0;
      for (const entry of entries) {
        this.ensureDosFatMetadata(entry);
        if (this.filesystem.isDirectory(entry)) directories += 1;
        else {
          files += 1;
          fileBytes += this.filesystem.getSize(entry);
        }
      }
      const freeBytes = this.filesystem.getFreeSpace();
      return success(
        [
          ...this.dosVolumeLines(media.letter, media.volumeLabel),
          "",
          `${String(fileBytes + freeBytes).padStart(14)} bytes total disk space`,
          `${String(fileBytes).padStart(14)} bytes in ${String(files)} file(s)`,
          `${String(freeBytes).padStart(14)} bytes available on disk`,
          `${String(directories).padStart(14)} directorie(s) checked`,
          "",
          "CHKDSK found no filesystem metadata errors.",
          "Read-only check complete; no repairs were attempted.",
          "",
        ].join("\r\n"),
      );
    } catch (error: unknown) {
      if (error instanceof DosDriveError && error.code === "no_media")
        return status(1, "", `Not ready reading drive ${error.drive}\r\n`);
      return status(1, "", `${message(error)}\r\n`);
    }
  }

  private collectDosDiskEntries(root: string): readonly string[] {
    const entries: string[] = [];
    const pending: { readonly depth: number; readonly path: string }[] = [
      { depth: 0, path: root },
    ];
    while (pending.length > 0) {
      const current = pending.pop()!;
      if (current.depth > 32)
        throw new Error("Directory depth limit exceeded.");
      for (const name of [...this.filesystem.list(current.path)]
        .sort()
        .reverse()) {
        const path = joinPath(current.path, name);
        entries.push(path);
        if (entries.length > 4_096)
          throw new Error("Filesystem entry limit exceeded.");
        if (this.filesystem.isDirectory(path))
          pending.push({ depth: current.depth + 1, path });
      }
    }
    return entries;
  }

  dosVolume(arguments_: readonly string[]): ShellCommandResult {
    if (
      arguments_.length > 1 ||
      (arguments_[0] !== undefined && !/^[A-Za-z]:?$/u.test(arguments_[0]))
    )
      return usage("VOL [drive:]");
    const letter = arguments_[0]?.[0] ?? this.dosRuntime?.activeDrive ?? "C";
    try {
      const drive = this.dosRuntime?.requireMedia(letter);
      return success(
        `${this.dosVolumeLines(drive?.letter, drive?.volumeLabel).join("\r\n")}\r\n`,
      );
    } catch (error: unknown) {
      if (error instanceof DosDriveError && error.code === "no_media")
        return status(1, "", `Not ready reading drive ${error.drive}\r\n`);
      return status(1, "", "Invalid drive specification\r\n");
    }
  }

  private dosVolumeLines(letter = "C", label = "CS-DOS"): readonly string[] {
    const serial = Math.max(0, this.options.computerId)
      .toString(16)
      .toUpperCase()
      .padStart(8, "0")
      .slice(-8);
    return [
      ` Volume in drive ${letter} is ${label.length === 0 ? "unlabeled" : label}`,
      ` Volume Serial Number is ${serial.slice(0, 4)}-${serial.slice(4)}`,
    ];
  }

  dosTree(arguments_: readonly string[]): ShellCommandResult {
    let path = ".";
    let includeFiles = false;
    for (const argument of arguments_) {
      const option = argument.toUpperCase();
      if (option === "/F") includeFiles = true;
      else if (option === "/A") continue;
      else if (path === ".") path = argument;
      else return usage("TREE [path] [/F] [/A]");
    }
    const root = this.resolvePath(path);
    if (!this.filesystem.isDirectory(root)) {
      return failure("TREE", `${path}: not a directory`, 1);
    }
    const lines = [
      "Folder PATH listing",
      this.options.profile.pathDialect.display(root),
    ];
    const maximumEntries = 512;
    const maximumDepth = 32;
    let entries = 0;
    let truncated = false;
    const visit = (directory: string, prefix: string, depth: number): void => {
      if (truncated) return;
      const children = this.filesystem
        .list(directory)
        .map((name) => ({
          name,
          path: directory === "/" ? `/${name}` : `${directory}/${name}`,
        }))
        .filter(
          ({ path: child }) =>
            includeFiles || this.filesystem.isDirectory(child),
        );
      for (const [index, child] of children.entries()) {
        if (entries >= maximumEntries || depth >= maximumDepth) {
          truncated = true;
          lines.push(`${prefix}... TREE limit reached`);
          return;
        }
        entries += 1;
        const last = index === children.length - 1;
        const directoryChild = this.filesystem.isDirectory(child.path);
        lines.push(`${prefix}+---${child.name.toUpperCase()}`);
        if (directoryChild) {
          visit(child.path, `${prefix}${last ? "    " : "|   "}`, depth + 1);
        }
      }
    };
    visit(root, "", 0);
    return status(
      truncated ? 1 : 0,
      `${lines.join("\r\n")}\r\n`,
      truncated ? "TREE: output or depth limit reached\r\n" : "",
    );
  }

  private dosMemoryLayout(): DosMemoryLayout {
    const snapshot = this.options.dosMemorySnapshot!();
    const conventional = memoryRegion(
      snapshot.regions.conventional.totalBytes,
      snapshot.regions.conventional.usedBytes,
    );
    const upper = memoryRegion(
      snapshot.regions.upper.totalBytes,
      snapshot.regions.upper.usedBytes,
    );
    const extended = memoryRegion(
      snapshot.regions.extended.totalBytes,
      snapshot.regions.extended.usedBytes,
    );
    const reserved = memoryRegion(
      snapshot.physical.reservedUnavailableBytes,
      snapshot.physical.reservedUnavailableBytes,
    );
    const systemBytes = snapshot.modules
      .filter(({ category }) => category === "os" || category === "driver")
      .reduce((total, module) => total + module.residentBytes, 0);
    const runtimeBytes = snapshot.modules
      .filter(({ category }) => category !== "os" && category !== "driver")
      .reduce((total, module) => total + module.residentBytes, 0);
    return {
      conventional,
      extended,
      largestConventionalBlockBytes:
        snapshot.regions.conventional.largestFreeBlockBytes,
      largestUpperBlockBytes: snapshot.regions.upper.largestFreeBlockBytes,
      reserved,
      runtimeBytes,
      snapshot,
      systemBytes,
      total: memoryRegion(
        snapshot.physical.totalBytes,
        snapshot.physical.usedBytes,
      ),
      upper,
    };
  }

  private appendDosFreeExtents(
    lines: string[],
    name: string,
    region: DosGuestMemoryRegionSnapshot,
  ): void {
    if (region.freeExtents.length === 0) {
      lines.push(`${name.padEnd(18)} none`);
      return;
    }
    for (const extent of region.freeExtents) {
      const start = extent.start.toString(16).toUpperCase().padStart(8, "0");
      const end = (extent.endExclusive - 1)
        .toString(16)
        .toUpperCase()
        .padStart(8, "0");
      lines.push(
        `${name.padEnd(18)} ${start}-${end}  ${String(extent.size).padStart(10)} bytes`,
      );
    }
  }

  private dosMemoryRow(name: string, region: MemoryRegion): string {
    const format = (bytes: number): string =>
      `${String(Math.floor(bytes / 1_024))}K`;
    return `${name.padEnd(16)}  ${format(region.total).padStart(10)}  ${format(region.used).padStart(10)}  ${format(region.free).padStart(10)}`;
  }

  private dosOption(argument: string): string {
    return this.textPolicy.option(argument);
  }

  private toolchainUsage(usageText: string): ShellCommandResult {
    return status(2, "", `Usage: ${usageText}${this.textPolicy.newline}`);
  }

  private toolchainFailure(
    command: string,
    detail: string,
    exitCode = 1,
  ): ShellCommandResult {
    return status(
      exitCode,
      "",
      `${this.displayName(command)}: ${detail}${this.textPolicy.newline}`,
    );
  }

  private normalizeCompileOptions(
    arguments_: readonly string[],
  ): readonly string[] {
    if (this.options.profile.id !== "dos") return arguments_;
    const normalized: string[] = [];
    for (const argument of arguments_) {
      if (/^\/c$/iu.test(argument)) {
        normalized.push("-c");
        continue;
      }
      if (/^\/mbyte8$/iu.test(argument)) {
        normalized.push("-mbyte8");
        continue;
      }
      if (/^\/mword32$/iu.test(argument)) {
        normalized.push("-mword32");
        continue;
      }
      const dataModel = /^\/mdata-model:(cs-(?:byte8|word32)-v1)$/iu.exec(
        argument,
      );
      if (dataModel !== null) {
        normalized.push(`-mdata-model=${dataModel[1]!.toLowerCase()}`);
        continue;
      }
      const output = /^\/out:(.+)$/iu.exec(argument);
      if (output !== null) {
        normalized.push("-o", output[1]!);
        continue;
      }
      const preprocessor = /^\/([idu])(?::)?(.+)$/iu.exec(argument);
      if (preprocessor !== null) {
        normalized.push(
          `-${preprocessor[1]!.toUpperCase()}${preprocessor[2]!}`,
        );
        continue;
      }
      normalized.push(this.dosOption(argument));
    }
    return normalized;
  }

  private parseCFamilyCommandOptions(
    arguments_: readonly string[],
    language: "c" | "cpp",
  ): CFamilyCommandOptions {
    const structural: string[] = [];
    const definitions: {
      readonly name: string;
      readonly replacement?: string;
    }[] = [
      { name: "__CS__", replacement: "1" },
      { name: "__CS486__", replacement: "1" },
      { name: "__STDC__", replacement: "1" },
      { name: "__STDC_HOSTED__", replacement: "1" },
      { name: "__STDC_VERSION__", replacement: "201112L" },
      { name: "__CS_ABI_VERSION__", replacement: "100" },
      { name: "__CS_DATA_MODEL__", replacement: "1" },
      { name: "__CS_WORD_BITS__", replacement: "32" },
      {
        name: this.options.profile.id === "dos" ? "__CS_DOS__" : "__CS_LINUX__",
        replacement: "1",
      },
      ...(language === "cpp"
        ? [{ name: "__cplusplus", replacement: "1" }]
        : []),
    ];
    const undefines: string[] = [];
    const includePaths: string[] = [];
    let dependencyGeneration = false;
    let dependencyFile: string | undefined;
    let optimizationLevel: 0 | 1 = 1;
    let dataModel: Cs486DataModel = cs486Word32DataModel;
    let standard = language === "c" ? "c11" : "c++11";
    const appendInclude = (value: string): void => {
      if (value.length === 0 || value.length > 128)
        throw new Error("include path limit exceeded");
      const resolved = this.resolvePath(value);
      if (!includePaths.includes(resolved)) includePaths.push(resolved);
      if (includePaths.length > 16)
        throw new Error("include path count limit exceeded");
    };
    const appendDefinition = (value: string): void => {
      const match = /^([A-Za-z_][A-Za-z0-9_]{0,63})(?:=(.*))?$/u.exec(value);
      if (match === null || (match[2]?.length ?? 0) > 2_048)
        throw new Error(`invalid preprocessor definition ${value}`);
      definitions.push({
        name: match[1]!,
        replacement: match[2] ?? "1",
      });
      if (definitions.length > 128)
        throw new Error("preprocessor definition limit exceeded");
    };
    const appendUndefine = (value: string): void => {
      if (!/^[A-Za-z_][A-Za-z0-9_]{0,63}$/u.test(value))
        throw new Error(`invalid preprocessor undefine ${value}`);
      if (!undefines.includes(value)) undefines.push(value);
      if (undefines.length > 128)
        throw new Error("preprocessor undefine limit exceeded");
    };

    for (let index = 0; index < arguments_.length; index += 1) {
      const argument = arguments_[index]!;
      if (argument === "-MMD") {
        if (this.options.profile.id !== "linux")
          throw new Error("-MMD is available only on CS-Linux");
        dependencyGeneration = true;
        continue;
      }
      if (argument === "-MF" || argument.startsWith("-MF")) {
        const value =
          argument === "-MF" ? arguments_[++index] : argument.slice(3);
        if (value === undefined || value.length === 0 || value.length > 128)
          throw new Error("-MF requires a bounded guest path");
        dependencyFile = value;
        continue;
      }
      if (argument === "-O0" || argument === "-O1") {
        optimizationLevel = argument === "-O0" ? 0 : 1;
        continue;
      }
      if (argument === "-mbyte8" || argument === "-mdata-model=cs-byte8-v1") {
        dataModel = cs486Byte8DataModel;
        continue;
      }
      if (argument === "-mword32" || argument === "-mdata-model=cs-word32-v1") {
        dataModel = cs486Word32DataModel;
        continue;
      }
      if (argument.startsWith("-m"))
        throw new Error(`unsupported data-model option '${argument}'`);
      if (argument.startsWith("-O")) {
        throw new Error(`unsupported optimization option '${argument}'`);
      }
      if (argument.startsWith("-std=")) {
        const requested = argument.slice(5);
        const supported =
          language === "c" ? requested === "c11" : requested === "c++11";
        if (!supported)
          throw new Error(`unsupported language standard '${requested}'`);
        standard = requested;
        continue;
      }
      if (argument === "-g" || argument === "-Wall" || argument === "-Werror") {
        continue;
      }
      if (argument.startsWith("-W")) {
        throw new Error(`unsupported warning option '${argument}'`);
      }
      const exact = /^-([IDU])$/u.exec(argument);
      const attached = /^-([IDU])(.+)$/u.exec(argument);
      if (exact === null && attached === null) {
        structural.push(argument);
        continue;
      }
      const option = (exact ?? attached)![1]!;
      const value =
        attached?.[2] ??
        ((): string => {
          const next = arguments_[++index];
          if (next === undefined)
            throw new Error(`-${option} requires an operand`);
          return next;
        })();
      if (option === "I") appendInclude(value);
      else if (option === "D") appendDefinition(value);
      else appendUndefine(value);
    }
    if (this.options.profile.id === "dos") {
      const include = this.environment.get("INCLUDE") ?? "";
      for (const value of include.split(";")) {
        if (value.trim().length > 0) appendInclude(value.trim());
      }
    }
    if (dependencyFile !== undefined && !dependencyGeneration) {
      throw new Error("-MF requires -MMD");
    }
    return {
      arguments: structural,
      dataModel,
      ...(dependencyFile === undefined ? {} : { dependencyFile }),
      dependencyGeneration,
      definitions: [
        ...definitions.filter(
          ({ name }) => name !== "__CS_DATA_MODEL__" && name !== "__CS_BYTE8__",
        ),
        {
          name: "__CS_DATA_MODEL__",
          replacement: dataModel === cs486Byte8DataModel ? "2" : "1",
        },
        ...(dataModel === cs486Byte8DataModel
          ? [{ name: "__CS_BYTE8__", replacement: "1" }]
          : []),
      ],
      includePaths,
      optimizationLevel,
      standard,
      undefines,
    };
  }

  private cFamilyFrontendOptions(
    sourceName: string,
    includePaths: readonly string[],
    definitions: CFamilyCommandOptions["definitions"],
    undefines: readonly string[],
    optimizationLevel: 0 | 1 = 1,
    dataModel: Cs486DataModel = cs486Word32DataModel,
    dependencies?: string[],
  ): Cs486CFrontendOptions {
    const systemDirectory =
      this.options.profile.id === "dos" ? "/drives/c/include" : "/usr/include";
    return {
      dataModel,
      definitions,
      include: (request): Cs486CPreprocessorInclude | undefined => {
        const directories = request.quoted
          ? [parentPath(request.fromSource), ...includePaths, systemDirectory]
          : [...includePaths, systemDirectory];
        for (const directory of directories) {
          let resolved: string;
          try {
            resolved = this.filesystem.normalize(
              this.options.profile.pathDialect.resolve(
                request.path,
                directory,
                this.environment.get("HOME") ?? this.options.profile.home,
              ),
            );
          } catch {
            continue;
          }
          if (!this.filesystem.exists(resolved)) continue;
          if (
            this.filesystem.isDirectory(resolved) ||
            !this.filesystem.hasAccess(resolved, 0b100)
          ) {
            throw new Error(`${request.path}: include file is not readable`);
          }
          const source = this.filesystem.readFile(resolved);
          this.ioReadBytes += utf8ByteLength(source);
          if (dependencies !== undefined && !dependencies.includes(resolved)) {
            dependencies.push(resolved);
          }
          return { identity: resolved, source, sourceName: resolved };
        }
        return undefined;
      },
      optimizationLevel,
      sourceName,
      undefines,
    };
  }

  private normalizeLinkOptions(
    arguments_: readonly string[],
  ): readonly string[] {
    if (this.options.profile.id !== "dos")
      return arguments_.map((argument) => this.dosOption(argument));
    const normalized: string[] = [];
    for (const argument of arguments_) {
      const output = /^\/out:(.+)$/iu.exec(argument);
      if (output !== null) {
        normalized.push("-o", output[1]!);
        continue;
      }
      const entry = /^\/entry:(.+)$/iu.exec(argument);
      if (entry !== null) {
        normalized.push("-e", entry[1]!);
        continue;
      }
      normalized.push(this.dosOption(argument));
    }
    return normalized;
  }

  private assemblerOptions(sourceName: string): Cs486AssemblerOptions {
    return {
      dialect: this.options.profile.id,
      include: (
        request,
        fromSource,
      ): ReturnType<NonNullable<Cs486AssemblerOptions["include"]>> => {
        let resolved: string;
        try {
          resolved = this.filesystem.normalize(
            this.options.profile.pathDialect.resolve(
              request,
              parentPath(fromSource),
              this.environment.get("HOME") ?? this.options.profile.home,
            ),
          );
        } catch {
          return undefined;
        }
        if (
          !this.filesystem.exists(resolved) ||
          this.filesystem.isDirectory(resolved) ||
          !this.filesystem.hasAccess(resolved, 0b100)
        ) {
          return undefined;
        }
        const source = this.filesystem.readFile(resolved);
        this.ioReadBytes += utf8ByteLength(source);
        return { source, sourceName: resolved };
      },
      sourceName,
    };
  }

  dosSystemInfo(arguments_: readonly string[]): ShellCommandResult {
    if (arguments_.length !== 0) return usage("SYSTEMINFO");
    const cpu = cpuModelSpecification(this.options.hardware.cpuModel);
    const capacity = this.filesystem.limits.capacityBytes;
    const usedDisk = capacity - this.filesystem.getFreeSpace();
    return success(
      [
        `Computer ID: ${this.options.computerName}`,
        `Operating System: ${formatOsIdentity(this.options.profile.identity)}`,
        `OS Alias: ${this.options.profile.identity.shortName} ${this.options.profile.identity.version}`,
        `CPU: ${cpu.displayName}, ${formatClock(this.options.hardware.clockHz)}`,
        `Data bus: ${String(cpu.dataBusBits)} bit`,
        `Memory: ${this.options.hardware.memoryBytes} bytes`,
        `Memory modules: ${cpu.microarchitecture.memoryModules}`,
        `L1 cache: ${formatCacheBytes(cpu.microarchitecture.l1CacheBytes)}`,
        `External L2 cache: ${formatCacheBytes(cpu.microarchitecture.externalCacheBytes)}`,
        `Pipeline: ${cpu.microarchitecture.pipeline}`,
        `Disk: ${usedDisk} / ${capacity} bytes used`,
      ].join("\r\n") + "\r\n",
    );
  }

  private diskUsage(arguments_: readonly string[]): ShellCommandResult {
    let includeFiles = false;
    let summarize = false;
    let human = false;
    const requested: string[] = [];
    for (const argument of arguments_) {
      if (argument.startsWith("-") && argument !== "-") {
        for (const flag of argument.slice(1)) {
          if (flag === "a") includeFiles = true;
          else if (flag === "s") summarize = true;
          else if (flag === "h") human = true;
          else return usage("du [-a|-s] [-h] [path ...]");
        }
      } else requested.push(argument);
    }
    if (includeFiles && summarize) return usage("du [-a|-s] [-h] [path ...]");
    if (requested.length > 32) return failure("du", "too many paths", 2);

    const paths = requested.length === 0 ? ["."] : requested;
    const output: string[] = [];
    for (const requestedPath of paths) {
      const resolved = this.resolvePath(requestedPath);
      if (!this.filesystem.exists(resolved)) {
        return failure("du", `${requestedPath}: no such file or directory`);
      }
      const entries: {
        readonly directory: boolean;
        readonly path: string;
        readonly size: number;
      }[] = [];
      const measure = (path: string): number => {
        if (
          !this.filesystem.isDirectory(path) ||
          this.filesystem.isSymbolicLink(path)
        ) {
          const size = this.filesystem.isSymbolicLink(path)
            ? utf8ByteLength(this.filesystem.readLink(path))
            : this.filesystem.getSize(path);
          entries.push({ directory: false, path, size });
          return size;
        }
        let size = 0;
        for (const name of this.filesystem.list(path))
          size += measure(joinPath(path, name));
        entries.push({ directory: true, path, size });
        return size;
      };
      const total = measure(resolved);
      if (!summarize && this.filesystem.isDirectory(resolved)) {
        for (const entry of entries) {
          if (entry.path === resolved || (!includeFiles && !entry.directory))
            continue;
          output.push(`${formatDuSize(entry.size, human)}\t${entry.path}`);
        }
      }
      output.push(`${formatDuSize(total, human)}\t${requestedPath}`);
    }
    return success(`${output.join("\n")}\n`);
  }

  private quota(arguments_: readonly string[]): ShellCommandResult {
    if (arguments_.length !== 0) return usage("quota");
    const capacity = this.filesystem.limits.capacityBytes;
    const free = this.filesystem.getFreeSpace();
    const used = capacity - free;
    return success(
      `Disk quota: ${used} / ${capacity} bytes used (${free} bytes free)\n` +
        `Limits: ${this.filesystem.limits.maxFileBytes} bytes/file, ${this.filesystem.limits.maxEntries} entries\n`,
    );
  }

  private linuxChangeMode(arguments_: readonly string[]): ShellCommandResult {
    if (arguments_.length < 2 || arguments_.length > 33)
      return usage("chmod <octal-mode> <path ...>");
    const [modeText = "", ...paths] = arguments_;
    if (!/^[0-7]{3,4}$/u.test(modeText))
      return failure("chmod", `invalid mode: '${modeText}'`, 1);
    const mode = Number.parseInt(modeText, 8);
    for (const path of paths) {
      const resolved = this.resolvePath(path);
      if (!this.filesystem.exists(resolved))
        return failure(
          "chmod",
          `cannot access '${path}': No such file or directory`,
        );
      try {
        this.filesystem.chmod(resolved, mode);
      } catch {
        return failure(
          "chmod",
          `changing permissions of '${path}': Operation not permitted`,
        );
      }
    }
    return success();
  }

  private linuxChangeOwner(
    arguments_: readonly string[],
    includeOwner: boolean,
  ): ShellCommandResult {
    const command = includeOwner ? "chown" : "chgrp";
    if (arguments_.length < 2 || arguments_.length > 33)
      return usage(
        `${command} <owner${includeOwner ? "[:group]" : ""}> <path ...>`,
      );
    const [identity = "", ...paths] = arguments_;
    const [ownerName = "", groupName] = includeOwner
      ? identity.split(":", 2)
      : ["", identity];
    const uid = includeOwner
      ? this.linuxIdentityNumber(ownerName, "user")
      : undefined;
    const gid =
      groupName === undefined
        ? undefined
        : this.linuxIdentityNumber(groupName, "group");
    if (
      (includeOwner && uid === undefined) ||
      (groupName !== undefined && gid === undefined)
    )
      return failure(command, `invalid user or group: '${identity}'`, 1);
    for (const path of paths) {
      const resolved = this.resolvePath(path);
      if (!this.filesystem.exists(resolved))
        return failure(
          command,
          `cannot access '${path}': No such file or directory`,
        );
      try {
        if (includeOwner) this.filesystem.chown(resolved, uid!, gid);
        else this.filesystem.chgrp(resolved, gid!);
      } catch {
        return failure(
          command,
          `changing ownership of '${path}': Operation not permitted`,
        );
      }
    }
    return success();
  }

  private linuxLink(arguments_: readonly string[]): ShellCommandResult {
    let symbolic = false;
    const paths: string[] = [];
    for (const argument of arguments_) {
      if (argument === "-s" || argument === "--symbolic") symbolic = true;
      else if (argument.startsWith("-"))
        return failure("ln", `invalid option -- '${argument}'`, 1);
      else paths.push(argument);
    }
    if (paths.length !== 2) return usage("ln [-s] <target> <link-name>");
    const target = symbolic ? paths[0]! : this.resolvePath(paths[0]!);
    const link = this.resolvePath(paths[1]!);
    if (!this.filesystem.hasAccess(parentPath(link), 0b011))
      return failure(
        "ln",
        `failed to create link '${paths[1]}': Permission denied`,
      );
    if (symbolic) this.filesystem.createSymbolicLink(target, link);
    else this.filesystem.createHardLink(target, link);
    return success();
  }

  private linuxReadLink(arguments_: readonly string[]): ShellCommandResult {
    if (arguments_.length !== 1) return usage("readlink <path>");
    const path = this.resolvePath(arguments_[0]!);
    if (!this.filesystem.isSymbolicLink(path)) return status(1);
    return success(`${this.filesystem.readLink(path)}\n`);
  }

  private linuxRealPath(arguments_: readonly string[]): ShellCommandResult {
    if (arguments_.length !== 1) return usage("realpath <path>");
    const resolved = this.filesystem.resolveSymbolicLinks(
      this.resolvePath(arguments_[0]!),
    );
    if (!this.filesystem.exists(resolved))
      return failure(
        "realpath",
        `${arguments_[0]}: No such file or directory`,
        1,
      );
    return success(`${resolved}\n`);
  }

  private linuxRemoveDirectory(
    arguments_: readonly string[],
  ): ShellCommandResult {
    if (arguments_.length === 0 || arguments_.length > 32)
      return usage("rmdir <directory ...>");
    for (const path of arguments_) {
      const resolved = this.resolvePath(path);
      if (!this.filesystem.isDirectory(resolved))
        return failure("rmdir", `failed to remove '${path}': Not a directory`);
      if (this.filesystem.list(resolved).length > 0)
        return failure(
          "rmdir",
          `failed to remove '${path}': Directory not empty`,
        );
      if (!this.filesystem.hasAccess(parentPath(resolved), 0b011))
        return failure(
          "rmdir",
          `failed to remove '${path}': Permission denied`,
        );
      this.filesystem.delete(resolved);
    }
    return success();
  }

  private linuxGroups(arguments_: readonly string[]): ShellCommandResult {
    if (arguments_.length > 1) return usage("groups [user]");
    const username = arguments_[0] ?? this.options.credentials().loginName;
    const user = this.options.accounts?.getUser(username);
    if (user === undefined)
      return failure("groups", `${username}: no such user`, 1);
    const names = this.options
      .accounts!.groupsForUser(user.name)
      .map(({ name }) => name);
    return success(`${names.join(" ")}\n`);
  }

  private linuxUmask(arguments_: readonly string[]): ShellCommandResult {
    if (arguments_.length === 0) {
      return success(
        `${this.filesystem.getUmask().toString(8).padStart(4, "0")}\n`,
      );
    }
    if (arguments_.length !== 1 || !/^[0-7]{1,4}$/u.test(arguments_[0]!)) {
      return usage("umask [000-777]");
    }
    const mask = Number.parseInt(arguments_[0]!, 8);
    if (mask > 0o777) return usage("umask [000-777]");
    this.filesystem.setUmask(mask);
    return success();
  }

  private linuxIdentityName(value: number, kind: "group" | "user"): string {
    const record =
      kind === "user"
        ? this.options.accounts?.getUserByUid(value)
        : this.options.accounts?.getGroupByGid(value);
    return record?.name ?? String(value);
  }

  private linuxIdentityNumber(
    value: string,
    kind: "group" | "user",
  ): number | undefined {
    if (/^(?:0|[1-9][0-9]{0,4})$/u.test(value)) {
      const parsed = Number(value);
      return parsed <= 65_535 ? parsed : undefined;
    }
    return kind === "user"
      ? this.options.accounts?.getUser(value)?.uid
      : this.options.accounts?.getGroup(value)?.gid;
  }

  private linuxPrintEnvironment(
    arguments_: readonly string[],
  ): ShellCommandResult {
    if (arguments_.length > 1) return usage("printenv [name]");
    if (arguments_[0] !== undefined) {
      const value = this.environment.get(arguments_[0]);
      return value === undefined ? status(1) : success(`${value}\n`);
    }
    return success(
      `${[...this.environment]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([name, value]) => `${name}=${value}`)
        .join("\n")}\n`,
    );
  }

  private linuxFile(arguments_: readonly string[]): ShellCommandResult {
    if (arguments_.length === 0 || arguments_.length > 32)
      return usage("file <path ...>");
    const lines: string[] = [];
    for (const path of arguments_) {
      const resolved = this.resolvePath(path);
      if (!this.filesystem.exists(resolved)) {
        lines.push(`${path}: cannot open (No such file or directory)`);
        continue;
      }
      if (this.filesystem.isSymbolicLink(resolved)) {
        lines.push(
          `${path}: symbolic link to ${this.filesystem.readLink(resolved)}`,
        );
      } else if (this.filesystem.isDirectory(resolved)) {
        lines.push(`${path}: directory`);
      } else {
        const contents = this.filesystem.readFile(resolved);
        const description = contents.startsWith("CS486\n")
          ? "Computer System CS486 executable"
          : contents.includes("\0")
            ? "data"
            : contents.length === 0
              ? "empty"
              : "Unicode text, UTF-8 text";
        lines.push(`${path}: ${description}`);
      }
    }
    return success(`${lines.join("\n")}\n`);
  }

  private linuxSha256Sum(
    arguments_: readonly string[],
    stdin: string,
  ): ShellCommandResult {
    if (arguments_.length > 32)
      return failure("sha256sum", "too many files", 1);
    const paths = arguments_.length === 0 ? ["-"] : arguments_;
    const lines = paths.map((path) => {
      const contents = path === "-" ? stdin : this.readFile(path);
      return `${sha256Hex(contents)}  ${path}`;
    });
    return success(`${lines.join("\n")}\n`);
  }

  private linuxMd5Sum(
    arguments_: readonly string[],
    stdin: string,
  ): ShellCommandResult {
    if (arguments_.length > 32) return failure("md5sum", "too many files", 1);
    const paths = arguments_.length === 0 ? ["-"] : arguments_;
    const lines = paths.map((path) => {
      const contents = path === "-" ? stdin : this.readFile(path);
      return `${md5Hex(contents)}  ${path}`;
    });
    return success(`${lines.join("\n")}\n`);
  }

  private linuxBase64(
    arguments_: readonly string[],
    stdin: string,
  ): ShellCommandResult {
    let decode = false;
    const paths: string[] = [];
    for (const argument of arguments_) {
      if (argument === "-d" || argument === "--decode") decode = true;
      else if (argument.startsWith("-") && argument !== "-")
        return failure("base64", `invalid option -- '${argument}'`, 2);
      else paths.push(argument);
    }
    if (paths.length > 1) return usage("base64 [-d] [file]");
    const input = paths.length === 0 ? stdin : this.readFile(paths[0]!);
    if (decode) {
      try {
        return success(base64Decode(input));
      } catch (error: unknown) {
        return failure("base64", message(error), 1);
      }
    }
    return success(`${wrapAtWidth(base64Encode(input), 76)}\n`);
  }

  private linuxNumberLines(
    arguments_: readonly string[],
    stdin: string,
  ): ShellCommandResult {
    if (
      arguments_.some(
        (argument) => argument.startsWith("-") && argument !== "-",
      )
    )
      return usage("nl [file ...]");
    const paths = arguments_.length === 0 ? ["-"] : arguments_;
    if (paths.length > 32) return failure("nl", "too many files", 1);
    let counter = 0;
    const lines: string[] = [];
    for (const path of paths) {
      const input = path === "-" ? stdin : this.readFile(path);
      for (const line of splitLines(input)) {
        if (line.length === 0) {
          lines.push("      \t");
        } else {
          counter += 1;
          lines.push(`${String(counter).padStart(6)}\t${line}`);
        }
      }
    }
    return success(lines.length === 0 ? "" : `${lines.join("\n")}\n`);
  }

  private linuxTee(
    arguments_: readonly string[],
    stdin: string,
  ): ShellCommandResult {
    let append = false;
    const paths: string[] = [];
    for (const argument of arguments_) {
      if (argument === "-a" || argument === "--append") append = true;
      else if (argument.startsWith("-"))
        return failure("tee", `invalid option -- '${argument}'`, 1);
      else paths.push(argument);
    }
    if (paths.length > 32) return failure("tee", "too many files", 1);
    for (const path of paths) this.writeFile(path, stdin, append);
    return success(stdin);
  }

  private linuxCompare(arguments_: readonly string[]): ShellCommandResult {
    let silent = false;
    const paths: string[] = [];
    for (const argument of arguments_) {
      if (argument === "-s" || argument === "--silent") silent = true;
      else paths.push(argument);
    }
    if (paths.length !== 2) return usage("cmp [-s] <file1> <file2>");
    const left = this.readFile(paths[0]!);
    const right = this.readFile(paths[1]!);
    if (left === right) return success();
    if (silent) return status(1);
    const length = Math.min(left.length, right.length);
    let offset = 0;
    while (offset < length && left[offset] === right[offset]) offset += 1;
    const line = left.slice(0, offset).split("\n").length;
    return status(
      1,
      `${paths[0]} ${paths[1]} differ: byte ${String(offset + 1)}, line ${String(line)}\n`,
    );
  }

  private linuxDiff(arguments_: readonly string[]): ShellCommandResult {
    const paths = arguments_.filter((argument) => argument !== "-u");
    if (
      paths.length !== 2 ||
      arguments_.some(
        (argument) => argument.startsWith("-") && argument !== "-u",
      )
    )
      return usage("diff [-u] <file1> <file2>");
    const left = splitLines(this.readFile(paths[0]!));
    const right = splitLines(this.readFile(paths[1]!));
    if (left.join("\n") === right.join("\n")) return success();
    if (left.length + right.length > 4_000)
      return failure("diff", "comparison line limit exceeded", 1);
    const lines = [`--- ${paths[0]}`, `+++ ${paths[1]}`, "@@"];
    const maximum = Math.max(left.length, right.length);
    for (let index = 0; index < maximum; index += 1) {
      if (left[index] === right[index]) lines.push(` ${left[index] ?? ""}`);
      else {
        if (left[index] !== undefined) lines.push(`-${left[index]}`);
        if (right[index] !== undefined) lines.push(`+${right[index]}`);
      }
    }
    return status(1, `${lines.join("\n")}\n`);
  }

  private linuxGit(arguments_: readonly string[]): ShellCommandResult {
    if (this.options.profile.id !== "linux") {
      return failure("git", "not available on CS-DOS", 1);
    }
    const grant = this.options.admitUtilityMemory({
      displayName: "CS System Git",
      moduleId: "git",
      residentBytes: linuxGitResidentBytes,
    });
    try {
      const credentials = this.options.credentials();
      return executeLinuxGit(arguments_, {
        computerName: this.options.computerName,
        currentDirectory: this.currentDirectory,
        effectiveUserId: credentials.effectiveUserId,
        filesystem: this.filesystem,
        loginName: credentials.loginName,
        nowMilliseconds: () => this.options.clock.currentWallTimeMilliseconds(),
        readFile: (path) => this.readFile(path),
        readFileBytes: (path) => this.readFileBytes(path),
        readLink: (path) => this.readSymbolicLink(path),
        writeFile: (path, contents) => this.writeFile(path, contents),
        writeFileBytes: (path, contents) => this.writeFileBytes(path, contents),
      });
    } finally {
      grant.release();
    }
  }

  private linuxHexDump(
    command: "hexdump" | "od",
    arguments_: readonly string[],
    stdin: string,
  ): ShellCommandResult {
    const paths = arguments_.filter(
      (argument) =>
        argument !== "-C" && argument !== "-An" && argument !== "-tx1",
    );
    if (paths.length > 1) return usage(`${command} [-C] [file]`);
    const contents = paths[0] === undefined ? stdin : this.readFile(paths[0]);
    const bytes = encodeUtf8(contents);
    if (bytes.length > 65_536)
      return failure(command, "input limit exceeded", 1);
    const lines: string[] = [];
    for (let offset = 0; offset < bytes.length; offset += 16) {
      const row = bytes.slice(offset, offset + 16);
      const hex = [...row]
        .map((value) => value.toString(16).padStart(2, "0"))
        .join(" ");
      if (command === "od") lines.push(hex);
      else {
        const ascii = [...row]
          .map((value) =>
            value >= 32 && value < 127 ? String.fromCharCode(value) : ".",
          )
          .join("");
        lines.push(
          `${offset.toString(16).padStart(8, "0")}  ${hex.padEnd(47)}  |${ascii}|`,
        );
      }
    }
    if (command === "hexdump")
      lines.push(bytes.length.toString(16).padStart(8, "0"));
    return success(lines.length === 0 ? "" : `${lines.join("\n")}\n`);
  }

  private linuxMakeTemporary(
    arguments_: readonly string[],
  ): ShellCommandResult {
    if (arguments_.length > 1) return usage("mktemp [template]");
    const template = arguments_[0] ?? "/tmp/tmp.XXXXXX";
    if (!/X{6}$/u.test(template))
      return failure("mktemp", `too few X's in template '${template}'`, 1);
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const suffix = (++this.temporarySequence).toString(36).padStart(6, "0");
      const path = template.replace(/X{6}$/u, suffix);
      const resolved = this.resolvePath(path);
      if (this.filesystem.exists(resolved)) continue;
      this.filesystem.writeFile(resolved, "");
      this.filesystem.setMetadata(resolved, { mode: 0o600 });
      return success(`${path}\n`);
    }
    return failure("mktemp", "failed to create file", 1);
  }

  private linuxMount(arguments_: readonly string[]): ShellCommandResult {
    if (arguments_.length !== 0) {
      if (this.options.credentials().effectiveUserId !== 0)
        return failure("mount", "permission denied", 1);
      const filtered = arguments_.filter(
        (value) => value !== "-t" && value !== "vfat",
      );
      if (
        filtered.length !== 2 ||
        filtered[0] !== "/dev/fd0" ||
        filtered[1] !== "/mnt/floppy"
      ) {
        return usage("mount [-t vfat] /dev/fd0 /mnt/floppy");
      }
      const drive = this.options.floppyDrive;
      if (drive === undefined)
        return failure("mount", "floppy drive is unavailable", 1);
      drive.mountLinux();
      this.options.osRuntime?.mount({
        filesystemType: "vfat",
        mountedTick: this.options.currentTick(),
        options: Object.freeze([
          "uid=1000",
          "gid=1000",
          "fmask=0133",
          "dmask=0022",
        ]),
        readOnly: drive.media?.writeProtected === true,
        source: "/dev/fd0",
        target: "/mnt/floppy",
      });
      return success();
    }
    if (this.options.osRuntime !== undefined) {
      return success(
        this.options.osRuntime
          .mounts()
          .map(
            ({ filesystemType, options, readOnly, source, target }) =>
              `${source} on ${target} type ${filesystemType} (${[
                readOnly ? "ro" : "rw",
                ...options.filter(
                  (option) => option !== "ro" && option !== "rw",
                ),
              ].join(",")})\n`,
          )
          .join(""),
      );
    }
    return success(
      [
        "computer-system on / type csfs (rw,nosuid,nodev)",
        "proc on /proc type proc (ro,nosuid,nodev,noexec)",
        "dev on /dev type csdev (rw,nosuid,noexec)",
        "tmpfs on /tmp type tmpfs (rw,nosuid,nodev)",
        "",
      ].join("\n"),
    );
  }

  dosFormat(arguments_: readonly string[]): ShellCommandResult {
    const drive = this.options.floppyDrive;
    if (drive === undefined)
      return status(1, "", "Not ready reading drive A\r\n");
    let bootable = false;
    let label = "";
    let driveSeen = false;
    for (const argument of arguments_) {
      if (/^A:$/iu.test(argument)) driveSeen = true;
      else if (/^\/S$/iu.test(argument)) bootable = true;
      else if (/^\/V:/iu.test(argument)) label = argument.slice(3);
      else return status(2, "", "Invalid switch.\r\n");
    }
    if (!driveSeen) return status(2, "", "Required parameter missing.\r\n");
    drive.format(bootable, label);
    this.refreshDosFloppyState();
    return success("Formatting 1.44M\r\nFormat complete.\r\n");
  }

  dosSystemDisk(arguments_: readonly string[]): ShellCommandResult {
    if (arguments_.length !== 1 || !/^A:$/iu.test(arguments_[0]!))
      return status(2, "", "The syntax of the command is incorrect.\r\n");
    const drive = this.options.floppyDrive;
    if (drive === undefined)
      return status(1, "", "Not ready reading drive A\r\n");
    drive.installSystem();
    return success("System transferred.\r\n");
  }

  dosEject(arguments_: readonly string[]): ShellCommandResult {
    if (
      arguments_.length > 1 ||
      (arguments_[0] !== undefined && !/^A:$/iu.test(arguments_[0]))
    ) {
      return status(2, "", "The syntax of the command is incorrect.\r\n");
    }
    const drive = this.options.floppyDrive;
    if (drive === undefined)
      return status(1, "", "Not ready reading drive A\r\n");
    drive.requestGuestEject();
    return success("Diskette ejected from drive A:.\r\n");
  }

  private refreshDosFloppyState(): void {
    const state = this.dosRuntime;
    const media = this.options.floppyDrive?.media;
    if (state === undefined || media === undefined) return;
    const current = state.driveState("A");
    if (current.mediaPresent) state.ejectMedia("A", current.mediaGeneration);
    const detached = state.driveState("A");
    state.mountMedia("A", {
      generation: Math.max(
        media.instanceGeneration,
        detached.mediaGeneration + 1,
      ),
      readOnly: media.writeProtected,
      volumeLabel: media.volumeLabel,
    });
  }

  private linuxUnmount(arguments_: readonly string[]): ShellCommandResult {
    if (arguments_.length !== 1 || arguments_[0] !== "/mnt/floppy")
      return usage("umount /mnt/floppy");
    if (this.options.credentials().effectiveUserId !== 0)
      return failure("umount", "permission denied", 1);
    const drive = this.options.floppyDrive;
    if (drive === undefined)
      return failure("umount", "floppy drive is unavailable", 1);
    drive.unmountLinux();
    this.options.osRuntime?.unmount("/mnt/floppy");
    return success();
  }

  private linuxEject(arguments_: readonly string[]): ShellCommandResult {
    if (
      arguments_.length > 1 ||
      (arguments_[0] !== undefined && arguments_[0] !== "/dev/fd0")
    ) {
      return usage("eject [/dev/fd0]");
    }
    if (this.options.credentials().effectiveUserId !== 0)
      return failure("eject", "permission denied", 1);
    const drive = this.options.floppyDrive;
    if (drive === undefined)
      return failure("eject", "floppy drive is unavailable", 1);
    if (drive.linuxMounted) {
      drive.unmountLinux();
      this.options.osRuntime?.unmount("/mnt/floppy");
    }
    drive.requestGuestEject();
    return success();
  }

  private linuxFormatFloppy(arguments_: readonly string[]): ShellCommandResult {
    if (this.options.credentials().effectiveUserId !== 0)
      return failure("mkfs.fat", "permission denied", 1);
    let label = "";
    const operands: string[] = [];
    for (let index = 0; index < arguments_.length; index += 1) {
      if (arguments_[index] === "-n") label = arguments_[++index] ?? "";
      else if (arguments_[index] === "-F") {
        if (arguments_[++index] !== "12")
          return failure("mkfs.fat", "only FAT12 is supported", 1);
      } else operands.push(arguments_[index]!);
    }
    if (operands.length !== 1 || operands[0] !== "/dev/fd0")
      return usage("mkfs.fat [-F 12] [-n LABEL] /dev/fd0");
    const drive = this.options.floppyDrive;
    if (drive === undefined)
      return failure("mkfs.fat", "floppy drive is unavailable", 1);
    if (drive.linuxMounted)
      return failure("mkfs.fat", "/dev/fd0 is mounted", 1);
    drive.format(false, label);
    return success("mkfs.fat: formatted 1.44 MiB FAT12 floppy\n");
  }

  private linuxDmesg(arguments_: readonly string[]): ShellCommandResult {
    if (arguments_.length !== 0) return usage("dmesg");
    if (this.options.osRuntime === undefined)
      return failure("dmesg", "OS runtime state is unavailable", 1);
    return success(this.options.osRuntime.renderJournal("boot"));
  }

  private linuxProcesses(arguments_: readonly string[]): ShellCommandResult {
    const full = arguments_.some(
      (argument) => argument === "-f" || argument === "-ef",
    );
    if (
      arguments_.some(
        (argument) => !["-e", "-f", "-ef", "-A"].includes(argument),
      )
    ) {
      return usage("ps [-e|-A] [-f]");
    }
    const state = this.options.osRuntime;
    if (state === undefined)
      return failure("ps", "OS process table is unavailable", 1);
    const processes = state.processes();
    const rows = full
      ? [
          "UID        PID  PPID  NI S      CYCLES START COMMAND",
          ...processes.map(
            (process) =>
              `${String(process.uid).padEnd(10)} ${String(process.pid).padStart(5)} ${String(process.parentPid).padStart(5)} ${String(process.niceValue).padStart(3)} ${processStateCode(process)} ${String(process.cpuCycles).padStart(11)} ${String(process.startTick).padStart(5)} ${process.command}`,
          ),
        ]
      : [
          "  PID  NI S      CYCLES COMMAND",
          ...processes.map(
            (process) =>
              `${String(process.pid).padStart(5)} ${String(process.niceValue).padStart(3)} ${processStateCode(process)} ${String(process.cpuCycles).padStart(11)} ${process.command}`,
          ),
        ];
    return success(`${rows.join("\n")}\n`);
  }

  private linuxTop(arguments_: readonly string[]): ShellCommandResult {
    if (arguments_.length !== 0) return usage("top");
    const state = this.options.osRuntime;
    if (state === undefined)
      return failure("top", "OS process table is unavailable", 1);
    const processes = state.processes();
    const memoryByPid = new Map(
      this.requireLinuxMemorySnapshot().processes.map((memory) => [
        memory.pid,
        memory,
      ]),
    );
    const states = new Map<string, number>();
    for (const process of processes)
      states.set(process.state, (states.get(process.state) ?? 0) + 1);
    const summary = [...states]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, count]) => `${String(count)} ${name}`)
      .join(", ");
    return success(
      [
        `top - up ${this.uptimeSeconds().toFixed(0)}s, load average: ${state.renderProcLoadAverage().trim().split(" ").slice(0, 3).join(", ")}`,
        `Tasks: ${String(processes.length)} total${summary.length === 0 ? "" : `, ${summary}`}`,
        "  PID UID    NI S       VIRT        RES      CYCLES COMMAND",
        ...processes.map((process) => {
          const memory = memoryByPid.get(process.pid) ?? {
            residentBytes: 0,
            virtualBytes: 0,
          };
          return `${String(process.pid).padStart(5)} ${String(process.uid).padStart(5)} ${String(process.niceValue).padStart(3)} ${processStateCode(process)} ${String(memory.virtualBytes).padStart(10)} ${String(memory.residentBytes).padStart(10)} ${String(process.cpuCycles).padStart(11)} ${process.command}`;
        }),
        "",
      ].join("\n"),
    );
  }

  private linuxVmstat(arguments_: readonly string[]): ShellCommandResult {
    if (arguments_.length !== 0) return usage("vmstat");
    const state = this.options.osRuntime;
    if (state === undefined)
      return failure("vmstat", "OS process table is unavailable", 1);
    const memory = this.requireLinuxMemorySnapshot();
    const processes = state.processes();
    const runnable = processes.filter(
      ({ state: processState }) =>
        processState === "ready" || processState === "running",
    ).length;
    const blocked = processes.filter(
      ({ state: processState }) => processState === "waiting",
    ).length;
    const kibibyte = 1_024;
    const columns: readonly (readonly [value: number, width: number])[] = [
      [runnable, 2],
      [blocked, 2],
      [0, 6],
      [Math.floor(memory.physical.freeBytes / kibibyte), 6],
      [Math.floor(memory.resident.buffersBytes / kibibyte), 6],
      [0, 6],
      [0, 4],
      [0, 4],
      [0, 5],
      [0, 5],
      [0, 4],
      [0, 4],
      [0, 2],
      [0, 2],
      [100, 2],
      [0, 2],
      [0, 2],
    ];
    return success(
      [
        "procs -----------memory---------- ---swap-- -----io---- -system-- ------cpu-----",
        " r  b   swpd   free   buff  cache   si   so    bi    bo   in   cs us sy id wa st",
        columns
          .map(([value, width]) => String(value).padStart(width))
          .join(" "),
        "",
      ].join("\n"),
    );
  }

  private linuxKill(arguments_: readonly string[]): ShellCommandResult {
    const state = this.options.osRuntime;
    if (state === undefined)
      return failure("kill", "OS process table is unavailable", 1);
    const parsed = parseSignalArguments(arguments_);
    if ("error" in parsed) return failure("kill", parsed.error, 2);
    if (parsed.pids.length > 16)
      return failure("kill", "at most 16 process IDs may be signalled", 2);
    return this.signalPids("kill", state, parsed.pids, parsed.signal);
  }

  private linuxPgrep(arguments_: readonly string[]): ShellCommandResult {
    const state = this.options.osRuntime;
    if (state === undefined)
      return failure("pgrep", "OS process table is unavailable", 1);
    let listNames = false;
    let exact = false;
    const rest: string[] = [];
    for (const argument of arguments_) {
      if (argument === "-l") listNames = true;
      else if (argument === "-x") exact = true;
      else if (argument.startsWith("-"))
        return failure("pgrep", `invalid option -- '${argument}'`, 2);
      else rest.push(argument);
    }
    if (rest.length !== 1) return usage("pgrep [-l] [-x] pattern");
    const pattern = rest[0]!;
    const matches = state
      .processes()
      .filter((process) => matchesProcessName(process, pattern, exact))
      .sort((left, right) => left.pid - right.pid);
    if (matches.length === 0) return status(1);
    return success(
      `${matches
        .map((process) =>
          listNames
            ? `${String(process.pid)} ${processName(process)}`
            : String(process.pid),
        )
        .join("\n")}\n`,
    );
  }

  private linuxPkill(arguments_: readonly string[]): ShellCommandResult {
    const state = this.options.osRuntime;
    if (state === undefined)
      return failure("pkill", "OS process table is unavailable", 1);
    const parsed = parseSignalPatternArguments(arguments_);
    if ("error" in parsed) return failure("pkill", parsed.error, 2);
    const matches = state
      .processes()
      .filter((process) =>
        matchesProcessName(process, parsed.pattern, parsed.exact),
      );
    if (matches.length === 0) return status(1);
    return this.signalPids(
      "pkill",
      state,
      matches.map((process) => process.pid),
      parsed.signal,
    );
  }

  private linuxKillAll(arguments_: readonly string[]): ShellCommandResult {
    const state = this.options.osRuntime;
    if (state === undefined)
      return failure("killall", "OS process table is unavailable", 1);
    const parsed = parseSignalNamesArguments(arguments_);
    if ("error" in parsed) return failure("killall", parsed.error, 2);
    if (parsed.names.length > 16)
      return failure("killall", "at most 16 process names may be signalled", 2);
    const failures: string[] = [];
    const pids: number[] = [];
    for (const name of parsed.names) {
      const matches = state
        .processes()
        .filter((process) => processName(process) === name);
      if (matches.length === 0) {
        failures.push(`${name}: no process found`);
        continue;
      }
      pids.push(...matches.map((process) => process.pid));
    }
    if (pids.length === 0) {
      return status(
        1,
        "",
        `${failures.map((detail) => `killall: ${detail}`).join("\n")}\n`,
      );
    }
    const signalled = this.signalPids("killall", state, pids, parsed.signal);
    if (failures.length === 0) return signalled;
    return status(
      1,
      signalled.stdout,
      `${failures.map((detail) => `killall: ${detail}`).join("\n")}\n${signalled.stderr}`,
    );
  }

  private signalPids(
    commandName: string,
    state: OsRuntimeState,
    pids: readonly number[],
    signal: OsProcessSignal,
  ): ShellCommandResult {
    const caller = this.options.credentials();
    const failures: string[] = [];
    for (const pid of pids) {
      const process = state.process(pid);
      if (process === undefined) {
        failures.push(`${String(pid)}: no such process`);
        continue;
      }
      if (pid === 1) {
        failures.push("1: refusing to signal cs-init");
        continue;
      }
      if (
        caller.effectiveUserId !== 0 &&
        caller.effectiveUserId !== process.uid
      ) {
        failures.push(`${String(pid)}: operation not permitted`);
        continue;
      }
      try {
        if (this.options.signalProcess === undefined) {
          state.signalProcess(pid, signal, this.options.currentTick());
        } else {
          this.options.signalProcess(pid, signal);
        }
      } catch (error: unknown) {
        failures.push(`${String(pid)}: ${message(error)}`);
      }
    }
    return failures.length === 0
      ? success()
      : status(
          1,
          "",
          `${failures.map((detail) => `${commandName}: ${detail}`).join("\n")}\n`,
        );
  }

  private linuxJobs(arguments_: readonly string[]): ShellCommandResult {
    if (arguments_.length !== 0) return usage("jobs");
    const state = this.options.osRuntime;
    if (state === undefined)
      return failure("jobs", "job table is unavailable", 1);
    const jobs = state.jobs(this.options.credentials().effectiveUserId);
    return success(
      jobs.length === 0 ? "" : `${jobs.map(renderJob).join("\n")}\n`,
    );
  }

  private linuxForegroundJob(
    arguments_: readonly string[],
  ): ShellCommandResult {
    if (arguments_.length > 1) return usage("fg [job]");
    const state = this.options.osRuntime;
    if (state === undefined)
      return failure("fg", "job table is unavailable", 1);
    const selected = selectJob(
      state.jobs(this.options.credentials().effectiveUserId),
      arguments_[0],
    );
    if ("error" in selected) return failure("fg", selected.error, 1);
    if (selected.job.state === "done")
      return this.consumeCompletedJob("fg", state, selected.job);
    return {
      ...success(),
      jobControl: { jobId: selected.job.jobId, kind: "foreground" },
    };
  }

  private linuxBackgroundJob(
    arguments_: readonly string[],
  ): ShellCommandResult {
    if (arguments_.length > 1) return usage("bg [job]");
    const state = this.options.osRuntime;
    if (state === undefined)
      return failure("bg", "job table is unavailable", 1);
    const selected = selectJob(
      state.jobs(this.options.credentials().effectiveUserId),
      arguments_[0],
    );
    if ("error" in selected) return failure("bg", selected.error, 1);
    if (selected.job.state === "done")
      return failure("bg", "job has already completed", 1);
    if (selected.job.state === "stopped") {
      try {
        if (this.options.signalProcess === undefined) {
          state.transitionJob(selected.job.jobId, {
            kind: "continue",
            tick: this.options.currentTick(),
          });
        } else {
          this.options.signalProcess(selected.job.pid, "SIGCONT");
        }
      } catch (error: unknown) {
        return failure("bg", message(error), 1);
      }
    }
    return success(`${renderJob(state.job(selected.job.jobId)!)}\n`);
  }

  private linuxWait(arguments_: readonly string[]): ShellCommandResult {
    if (arguments_.length > 1) return usage("wait [job|pid]");
    const state = this.options.osRuntime;
    if (state === undefined)
      return failure("wait", "job table is unavailable", 1);
    const jobs = state.jobs(this.options.credentials().effectiveUserId);
    if (arguments_.length === 0) {
      if (jobs.some((job) => job.state !== "done")) {
        return {
          ...success(),
          jobControl: {
            jobIds: Object.freeze(jobs.map(({ jobId }) => jobId)),
            kind: "wait",
          },
        };
      }
      let exitCode = 0;
      for (const job of jobs) {
        exitCode = job.exitStatus ?? exitCode;
        state.removeJob(job.jobId);
        state.reapProcess(job.pid);
      }
      return status(exitCode);
    }
    const selected = selectJob(jobs, arguments_[0]);
    if ("error" in selected) return failure("wait", selected.error, 1);
    if (selected.job.state !== "done") {
      return {
        ...success(),
        jobControl: {
          jobIds: Object.freeze([selected.job.jobId]),
          kind: "wait",
        },
      };
    }
    return this.consumeCompletedJob("wait", state, selected.job);
  }

  private consumeCompletedJob(
    command: "fg" | "wait",
    state: OsRuntimeState,
    job: OsJobRecord,
  ): ShellCommandResult {
    try {
      const exitCode = job.exitStatus ?? 0;
      state.removeJob(job.jobId);
      state.reapProcess(job.pid);
      return status(exitCode);
    } catch (error: unknown) {
      return failure(command, message(error), 1);
    }
  }

  private linuxTty(arguments_: readonly string[]): ShellCommandResult {
    if (arguments_.length !== 0) return usage("tty");
    const state = this.options.osRuntime;
    const sessionId = this.options.sessionId?.();
    const session =
      state === undefined || sessionId === undefined
        ? undefined
        : state.loginSession(sessionId);
    return session === undefined
      ? status(1, "not a tty\n")
      : success(`/dev/${session.terminal}\n`);
  }

  private linuxWho(arguments_: readonly string[]): ShellCommandResult {
    if (arguments_.length !== 0) return usage("who");
    const state = this.options.osRuntime;
    if (state === undefined)
      return failure("who", "login-session table is unavailable", 1);
    return success(
      state
        .loginSessions()
        .map((session) => {
          const timestamp =
            session.loginWallMilliseconds === undefined
              ? `tick ${String(session.loginTick)}`
              : formatLastLoginTimestamp(session.loginWallMilliseconds);
          return `${session.username.padEnd(12)} ${session.terminal.padEnd(8)} ${timestamp}${session.remote === undefined ? "" : ` (${session.remote})`}\n`;
        })
        .join(""),
    );
  }

  private linuxW(arguments_: readonly string[]): ShellCommandResult {
    if (arguments_.length !== 0) return usage("w");
    const state = this.options.osRuntime;
    if (state === undefined)
      return failure("w", "login-session table is unavailable", 1);
    const sessions = state.loginSessions();
    return success(
      [
        `up ${this.uptimeSeconds().toFixed(0)}s, ${String(sessions.length)} user${sessions.length === 1 ? "" : "s"}, load average: ${state.renderProcLoadAverage().trim().split(" ").slice(0, 3).join(", ")}`,
        "USER         TTY      LOGIN@ IDLE",
        ...sessions.map(
          (session) =>
            `${session.username.padEnd(12)} ${session.terminal.padEnd(8)} ${String(session.loginTick).padStart(6)} ${String(Math.max(0, this.options.currentTick() - session.lastActivityTick)).padStart(4)}t`,
        ),
        "",
      ].join("\n"),
    );
  }

  private linuxLast(arguments_: readonly string[]): ShellCommandResult {
    if (arguments_.length !== 0) return usage("last");
    const state = this.options.osRuntime;
    if (state === undefined)
      return failure("last", "login history is unavailable", 1);
    const records = [...state.snapshot().lastLogins].sort(
      (left, right) => right.loginTick - left.loginTick,
    );
    return success(
      records
        .map((record) => {
          const loginTimestamp =
            record.loginWallMilliseconds === undefined
              ? `tick ${String(record.loginTick)}`
              : formatLastLoginTimestamp(record.loginWallMilliseconds);
          const logoutTimestamp =
            record.logoutTick === undefined
              ? "still logged in"
              : record.logoutWallMilliseconds === undefined
                ? `tick ${String(record.logoutTick)} (${record.logoutReason ?? "logout"})`
                : `${formatLastLoginTimestamp(record.logoutWallMilliseconds)} (${record.logoutReason ?? "logout"})`;
          return `${record.username.padEnd(12)} ${record.terminal.padEnd(8)} ${loginTimestamp} - ${logoutTimestamp}\n`;
        })
        .join(""),
    );
  }

  private linuxService(arguments_: readonly string[]): ShellCommandResult {
    const state = this.options.osRuntime;
    if (state === undefined)
      return failure("service", "service table is unavailable", 1);
    if (arguments_.length === 1 && arguments_[0] === "--status-all") {
      return success(
        state
          .services()
          .map(
            (service) =>
              `[ ${service.state === "running" ? "+" : service.state === "failed" ? "!" : "-"} ] ${service.name}\n`,
          )
          .join(""),
      );
    }
    if (arguments_.length !== 2)
      return usage("service --status-all | service <name> status");
    const [name = "", action = ""] = arguments_;
    const service = state.services().find((entry) => entry.name === name);
    if (service === undefined)
      return failure("service", `${name}: unrecognized service`, 1);
    if (action !== "status") {
      return failure(
        "service",
        `${name}: managed by cs-init; only status is available in this release`,
        1,
      );
    }
    return status(
      service.state === "running" ? 0 : 3,
      `${name} is ${service.state}${service.pid === undefined ? "" : ` (pid ${String(service.pid)})`}\n`,
    );
  }

  private linuxCrontab(arguments_: readonly string[]): ShellCommandResult {
    if (arguments_.length !== 1 || arguments_[0] !== "-l") {
      return usage("crontab -l | crontab -e");
    }
    return success(this.readFile("/etc/crontab"));
  }

  private linuxSed(
    arguments_: readonly string[],
    stdin: string,
  ): ShellCommandResult {
    const result = executeLinuxSed(arguments_, stdin, (path) =>
      this.readFile(path),
    );
    return status(result.exitCode, result.stdout, result.stderr);
  }

  private linuxAwk(
    arguments_: readonly string[],
    stdin: string,
  ): ShellCommandResult {
    const result = executeLinuxAwk(arguments_, stdin, (path) =>
      this.readFile(path),
    );
    return status(result.exitCode, result.stdout, result.stderr);
  }

  private linuxArchiveCommand(
    command: string,
    arguments_: readonly string[],
  ): ShellCommandResult {
    const io = {
      filesystem: this.filesystem,
      readBytes: (path: string): Uint8Array => this.readFileBytes(path),
      writeBytes: (path: string, contents: Uint8Array): void =>
        this.writeFileBytes(path, contents),
    };
    let result: LinuxArchiveResult;
    switch (command) {
      case "tar":
        result = executeLinuxTar(arguments_, this.currentDirectory, io);
        break;
      case "gzip":
      case "gunzip":
        result = executeLinuxGzip(
          command,
          arguments_,
          this.currentDirectory,
          io,
        );
        break;
      case "zip":
        result = executeLinuxZip(arguments_, this.currentDirectory, io);
        break;
      case "unzip":
        result = executeLinuxUnzip(arguments_, this.currentDirectory, io);
        break;
      default:
        return failure(command, "archive implementation is unavailable", 127);
    }
    return status(result.exitCode, result.stdout, result.stderr);
  }

  private linuxRunlevel(arguments_: readonly string[]): ShellCommandResult {
    if (arguments_.length !== 0) return usage("runlevel");
    const state = this.options.osRuntime;
    if (state === undefined)
      return failure("runlevel", "runlevel is unavailable", 1);
    const { current, previous } = state.runlevel();
    if (current === undefined) return success("unknown\n");
    return success(`${previous ?? "N"} ${current}\n`);
  }

  private linuxTelinit(arguments_: readonly string[]): ShellCommandResult {
    if (this.options.credentials().effectiveUserId !== 0) {
      return failure("telinit", "must be superuser", 1);
    }
    if (arguments_.length !== 1) return usage("telinit {0-6|S}");
    const requested = arguments_[0]!;
    const normalized = requested === "s" ? "S" : requested;
    if (normalized.length !== 1 || !"0123456S".includes(normalized)) {
      return failure("telinit", `${requested}: invalid runlevel`, 1);
    }
    if (normalized === "0") return success("", { action: "shutdown" });
    if (normalized === "6") return success("", { action: "reboot" });
    const state = this.options.osRuntime;
    if (state === undefined)
      return failure("telinit", "runlevel table is unavailable", 1);
    const tick = this.options.currentTick();
    this.runRcDirectoryTransition(state, normalized, tick);
    state.setRunlevel(normalized, tick);
    return success();
  }

  private runRcDirectoryTransition(
    state: OsRuntimeState,
    runlevel: string,
    tick: number,
  ): void {
    const directory = `/etc/rc${runlevel === "S" ? "1" : runlevel}.d`;
    if (
      !this.filesystem.exists(directory) ||
      !this.filesystem.isDirectory(directory)
    )
      return;
    const entries = this.filesystem
      .list(directory)
      .map((entry) => /^([SK])(\d{2})([a-z][a-z0-9_-]*)$/u.exec(entry))
      .filter((match): match is RegExpExecArray => match !== null)
      .map((match) => ({
        kind: match[1] as "S" | "K",
        order: Number(match[2]),
        name: match[3]!,
      }))
      .sort((left, right) => left.order - right.order);
    for (const entry of entries.filter((item) => item.kind === "K")) {
      this.stopInitManagedService(state, entry.name, tick);
    }
    for (const entry of entries.filter((item) => item.kind === "S")) {
      this.startInitManagedService(state, entry.name, tick);
    }
  }

  private linuxInitCtl(arguments_: readonly string[]): ShellCommandResult {
    if (this.options.credentials().effectiveUserId !== 0) {
      return failure("cs-init-ctl", "must be superuser", 1);
    }
    if (arguments_.length !== 2) {
      return usage("cs-init-ctl <name> start|stop|restart|status");
    }
    const [name = "", action = ""] = arguments_;
    if (!initManagedServiceNames.has(name)) {
      return failure("cs-init-ctl", `${name}: unrecognized service`, 1);
    }
    const state = this.options.osRuntime;
    if (state === undefined) {
      return failure("cs-init-ctl", "service table is unavailable", 1);
    }
    const tick = this.options.currentTick();
    switch (action) {
      case "start":
        return this.startInitManagedService(state, name, tick);
      case "stop":
        return this.stopInitManagedService(state, name, tick);
      case "restart":
        this.stopInitManagedService(state, name, tick);
        return this.startInitManagedService(state, name, tick);
      case "status": {
        const service = state.service(name);
        if (service === undefined) return status(3, `${name} is not running\n`);
        return status(
          service.state === "running" ? 0 : 3,
          `${name} is ${service.state}${service.pid === undefined ? "" : ` (pid ${String(service.pid)})`}\n`,
        );
      }
      default:
        return usage("cs-init-ctl <name> start|stop|restart|status");
    }
  }

  private startInitManagedService(
    state: OsRuntimeState,
    name: string,
    tick: number,
  ): ShellCommandResult {
    let service = state.service(name);
    if (service === undefined) {
      service = state.registerService({ enabled: true, name, tick });
    }
    if (service.state === "running" || service.state === "starting") {
      return status(0, `${name} is already running\n`);
    }
    state.transitionService(name, { kind: "start", tick });
    const daemon = state.spawnProcess({
      command: `/etc/init.d/${name}`,
      gid: 0,
      parentPid: 1,
      startTick: tick,
      state: "running",
      uid: 0,
    });
    state.transitionProcess(daemon.pid, {
      kind: "sleep",
      reason: `${name}-daemon`,
      tick,
    });
    state.transitionService(name, { kind: "running", pid: daemon.pid, tick });
    if (name === "cron") this.validateCrontabOnStart(state, tick);
    return success();
  }

  private stopInitManagedService(
    state: OsRuntimeState,
    name: string,
    tick: number,
  ): ShellCommandResult {
    const service = state.service(name);
    if (service === undefined || service.state === "inactive") {
      return status(0, `${name} is not running\n`);
    }
    state.transitionService(name, { kind: "stop", tick });
    if (service.pid !== undefined && state.process(service.pid) !== undefined) {
      // Signaling the bound process to exit while the service is "stopping"
      // makes synchronizeProcessDependents finish the service transition to
      // "inactive" automatically; do not also call transitionService(kind:
      // "stopped") here or it double-transitions an already-inactive service.
      state.signalProcess(service.pid, "SIGTERM", tick);
      state.reapProcess(service.pid);
    } else {
      state.transitionService(name, { kind: "stopped", tick });
    }
    return success();
  }

  private validateCrontabOnStart(state: OsRuntimeState, tick: number): void {
    if (!this.filesystem.exists("/etc/crontab")) return;
    const parsed = parseLinuxCrontab(this.filesystem.readFile("/etc/crontab"));
    for (const warning of parsed.warnings) {
      state.appendSystemJournal(tick, `cron: ${warning}`, "warning");
    }
  }

  private linuxMan(arguments_: readonly string[]): ShellCommandResult {
    if (arguments_.length < 1 || arguments_.length > 2)
      return usage("man [section] <topic>");
    const requestedSection =
      arguments_.length === 2 ? arguments_[0] : undefined;
    if (
      requestedSection !== undefined &&
      !["1", "5", "6", "7", "8"].includes(requestedSection)
    ) {
      return failure("man", `unsupported section ${requestedSection}`, 1);
    }
    const topic = arguments_.at(-1) ?? "";
    if (topic.length > 64)
      return failure("man", "topic exceeds the 64-character limit", 2);
    const entry = linuxManualPage(topic);
    return entry === undefined ||
      (requestedSection !== undefined &&
        String(entry.section) !== requestedSection)
      ? failure("man", `no manual entry for ${topic}`, 1)
      : success(renderLinuxManualPage(entry));
  }

  private linuxApropos(arguments_: readonly string[]): ShellCommandResult {
    if (arguments_.length !== 1) return usage("apropos <word>");
    const query = (arguments_[0] ?? "").trim().toLowerCase();
    if (query.length === 0 || query.length > 64)
      return failure("apropos", "word must contain 1..64 characters", 2);
    const matches = linuxManualPages()
      .filter(
        (entry) =>
          entry.name.includes(query) ||
          entry.summary.toLowerCase().includes(query),
      )
      .slice(0, 64);
    return matches.length === 0
      ? status(1)
      : success(
          `${matches.map((entry) => `${entry.name} (${String(entry.section)}) - ${entry.summary}`).join("\n")}\n`,
        );
  }

  private linuxYes(arguments_: readonly string[]): ShellCommandResult {
    const value = arguments_.length === 0 ? "y" : arguments_.join(" ");
    return status(
      1,
      `${Array.from({ length: 1_024 }, () => value).join("\n")}\n`,
      "yes: bounded output limit reached\n",
    );
  }

  private linuxXargs(
    arguments_: readonly string[],
    stdin: string,
  ): ShellCommandResult {
    if (this.xargsDepth > 0)
      return failure("xargs", "recursive use is not supported", 1);
    if (arguments_.some((argument) => argument.startsWith("-")))
      return usage("xargs [command [initial-arguments ...]]");
    const values = stdin.trim().length === 0 ? [] : stdin.trim().split(/\s+/u);
    if (values.length > 128)
      return failure("xargs", "argument limit exceeded", 1);
    const command = arguments_.length === 0 ? ["echo"] : [...arguments_];
    this.xargsDepth += 1;
    try {
      return this.execute([...command, ...values], "");
    } finally {
      this.xargsDepth -= 1;
    }
  }

  private test(
    command: "[" | "test",
    originalArguments: readonly string[],
  ): ShellCommandResult {
    const arguments_ = [...originalArguments];
    if (command === "[") {
      if (arguments_.pop() !== "]") return failure("[", "missing ]", 2);
    }
    if (arguments_.length === 0) return status(1);
    if (arguments_.length === 1)
      return status(arguments_[0]!.length === 0 ? 1 : 0);
    if (arguments_.length === 2) {
      const [operator, value = ""] = arguments_;
      if (operator === "-n") return status(value.length > 0 ? 0 : 1);
      if (operator === "-z") return status(value.length === 0 ? 0 : 1);
      const path = this.resolvePath(value);
      if (operator === "-e")
        return status(
          this.filesystem.exists(path) || this.virtualDevice(path) !== undefined
            ? 0
            : 1,
        );
      if (operator === "-f")
        return status(
          this.filesystem.exists(path) && !this.filesystem.isDirectory(path)
            ? 0
            : 1,
        );
      if (operator === "-d")
        return status(this.filesystem.isDirectory(path) ? 0 : 1);
      if (operator === "-s")
        return status(
          this.filesystem.exists(path) && this.filesystem.getSize(path) > 0
            ? 0
            : 1,
        );
    }
    if (arguments_.length === 3) {
      const [left = "", operator, right = ""] = arguments_;
      if (operator === "=" || operator === "==")
        return status(left === right ? 0 : 1);
      if (operator === "!=") return status(left !== right ? 0 : 1);
      const leftNumber = Number(left);
      const rightNumber = Number(right);
      if (!Number.isFinite(leftNumber) || !Number.isFinite(rightNumber))
        return failure("test", "integer expression expected", 2);
      const comparisons = new Map<string, boolean>([
        ["-eq", leftNumber === rightNumber],
        ["-ne", leftNumber !== rightNumber],
        ["-lt", leftNumber < rightNumber],
        ["-le", leftNumber <= rightNumber],
        ["-gt", leftNumber > rightNumber],
        ["-ge", leftNumber >= rightNumber],
      ]);
      if (comparisons.has(operator ?? ""))
        return status(comparisons.get(operator ?? "") ? 0 : 1);
    }
    return failure("test", "unsupported expression", 2);
  }
}

type DateMode = "game" | "real" | "virtual";

function linuxModeString(
  kind: "device" | "directory" | "file" | "link",
  mode: number,
): string {
  const type =
    kind === "directory"
      ? "d"
      : kind === "link"
        ? "l"
        : kind === "device"
          ? "c"
          : "-";
  const bits = [0o400, 0o200, 0o100, 0o040, 0o020, 0o010, 0o004, 0o002, 0o001];
  return (
    type +
    bits
      .map((bit, index) =>
        (mode & bit) === 0
          ? "-"
          : index % 3 === 0
            ? "r"
            : index % 3 === 1
              ? "w"
              : "x",
      )
      .join("")
  );
}

function formatLinuxSize(bytes: number, human: boolean): string {
  if (!human) return String(bytes);
  return formatBinaryBytes(bytes)
    .replace(" MiB", "M")
    .replace(" KiB", "K")
    .replace(" B", "B")
    .replace(" bytes", "B");
}

const linuxWeekdayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const linuxMonthNames = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

export function formatLastLoginTimestamp(milliseconds: number): string {
  const date = new Date(milliseconds);
  if (!Number.isFinite(date.getTime())) return "";
  return `${linuxWeekdayNames[date.getUTCDay()]} ${linuxMonthNames[date.getUTCMonth()]} ${String(date.getUTCDate()).padStart(2)} ${formatDate(date, "%H:%M:%S")} ${String(date.getUTCFullYear())}`;
}

function formatLinuxTimestamp(milliseconds: number): string {
  const date = new Date(milliseconds);
  if (!Number.isFinite(date.getTime())) return "Jan  1 00:00";
  return `${linuxMonthNames[date.getUTCMonth()]} ${String(date.getUTCDate()).padStart(2)} ${String(date.getUTCHours()).padStart(2, "0")}:${String(date.getUTCMinutes()).padStart(2, "0")}`;
}

function formatLinuxDate(date: Date): string {
  return `${linuxWeekdayNames[date.getUTCDay()]} ${linuxMonthNames[date.getUTCMonth()]} ${String(date.getUTCDate()).padStart(2)} ${formatDate(date, "%H:%M:%S")} UTC ${String(date.getUTCFullYear())}`;
}

function stablePathInode(path: string): number {
  let value = 2_166_136_261;
  for (const character of path) {
    value ^= character.codePointAt(0)!;
    value = Math.imul(value, 16_777_619) >>> 0;
  }
  return Math.max(1, value);
}

function formatDuSize(bytes: number, human: boolean): string {
  return human
    ? formatLinuxSize(bytes, true)
    : String(Math.ceil(bytes / 1_024));
}

function findCompletionTokenStart(value: string): number {
  for (let index = value.length - 1; index >= 0; index -= 1) {
    if (/\s|[;&|<>]/u.test(value[index] ?? "")) return index + 1;
  }
  return 0;
}

function isCommandCompletionPosition(prefix: string): boolean {
  const separator = Math.max(
    prefix.lastIndexOf(";"),
    prefix.lastIndexOf("|"),
    prefix.lastIndexOf("&"),
  );
  return prefix.slice(separator + 1).trim().length === 0;
}

function completionPathParts(
  token: string,
  dos: boolean,
): {
  readonly directoryToken: string;
  readonly displayPrefix: string;
  readonly namePrefix: string;
  readonly separator: "/" | "\\";
} {
  if (!dos) {
    const slash = token.lastIndexOf("/");
    return {
      directoryToken: slash < 0 ? "." : token.slice(0, slash) || "/",
      displayPrefix: slash < 0 ? "" : token.slice(0, slash + 1),
      namePrefix: slash < 0 ? token : token.slice(slash + 1),
      separator: "/",
    };
  }

  const normalized = token.replaceAll("/", "\\");
  const slash = normalized.lastIndexOf("\\");
  if (slash >= 0) {
    const rawDirectory = normalized.slice(0, slash);
    return {
      directoryToken: rawDirectory.length === 0 ? "\\" : rawDirectory,
      displayPrefix: dosCompletionDisplayPrefix(normalized.slice(0, slash + 1)),
      namePrefix: normalized.slice(slash + 1),
      separator: "\\",
    };
  }
  const drive = /^([A-Za-z]:)(.*)$/u.exec(normalized);
  if (drive !== null) {
    const displayPrefix = `${drive[1]!.toUpperCase()}\\`;
    return {
      directoryToken: displayPrefix,
      displayPrefix,
      namePrefix: drive[2] ?? "",
      separator: "\\",
    };
  }
  return {
    directoryToken: ".",
    displayPrefix: "",
    namePrefix: normalized,
    separator: "\\",
  };
}

function dosCompletionDisplayPrefix(value: string): string {
  return value.replace(/^([a-z]):/iu, (drive) => drive.toUpperCase());
}

function emptyShellCompletion(
  value: string,
  requestedCursor: number,
  replaceStart?: number,
  replaceEnd?: number,
): ShellCompletionResult {
  const cursor =
    Number.isSafeInteger(requestedCursor) &&
    requestedCursor >= 0 &&
    requestedCursor <= value.length
      ? requestedCursor
      : value.length;
  return {
    candidates: [],
    cursor,
    replaceEnd: replaceEnd ?? cursor,
    replaceStart: replaceStart ?? cursor,
    truncated: false,
    value,
  };
}

function longestCommonPrefix(
  values: readonly string[],
  caseInsensitive = false,
): string {
  let prefix = values[0] ?? "";
  for (const value of values.slice(1)) {
    let length = 0;
    while (
      length < prefix.length &&
      length < value.length &&
      (caseInsensitive
        ? prefix[length]!.toLowerCase() === value[length]!.toLowerCase()
        : prefix[length] === value[length])
    ) {
      length += 1;
    }
    prefix = prefix.slice(0, length);
    if (prefix.length === 0) break;
  }
  return prefix;
}

function parseDateArguments(
  arguments_: readonly string[],
): { readonly format?: string; readonly mode: DateMode } | undefined {
  if (arguments_.length > 2) return undefined;
  let mode: DateMode = "real";
  let format: string | undefined;
  for (const argument of arguments_) {
    if (argument === "--real") mode = "real";
    else if (argument === "--game") mode = "game";
    else if (argument === "--virtual") mode = "virtual";
    else if (argument.startsWith("+") && format === undefined)
      format = argument.slice(1);
    else return undefined;
  }
  return { format, mode };
}

function formatDate(date: Date, format: string): string {
  return format.replace(/%[sYmdHMS%]/gu, (specifier) => {
    switch (specifier) {
      case "%s":
        return String(Math.floor(date.getTime() / 1_000));
      case "%Y":
        return String(date.getUTCFullYear()).padStart(4, "0");
      case "%m":
        return String(date.getUTCMonth() + 1).padStart(2, "0");
      case "%d":
        return String(date.getUTCDate()).padStart(2, "0");
      case "%H":
        return String(date.getUTCHours()).padStart(2, "0");
      case "%M":
        return String(date.getUTCMinutes()).padStart(2, "0");
      case "%S":
        return String(date.getUTCSeconds()).padStart(2, "0");
      default:
        return "%";
    }
  });
}

function success(
  stdout = "",
  extra: { readonly action?: ShellAction } = {},
): ShellCommandResult {
  return { ...extra, exitCode: 0, stderr: "", stdout };
}

function status(
  exitCode: number,
  stdout = "",
  stderr = "",
): ShellCommandResult {
  return { exitCode, stderr, stdout };
}

function failure(
  command: string,
  detail: string,
  exitCode = 1,
): ShellCommandResult {
  return status(exitCode, "", `${command}: ${detail}\n`);
}

function usage(usageText: string): ShellCommandResult {
  return status(2, "", `Usage: ${usageText}\n`);
}

function isAssignment(value: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*=/u.test(value);
}

function dosSourceBasename(path: string): string {
  const name = path.split("/").at(-1) ?? "";
  const dot = name.lastIndexOf(".");
  return dot < 0 ? name : name.slice(0, dot);
}

function renderCsNativeListing(
  sources: CsDosProgramList["sources"],
  objects: readonly Cs486Object[],
): string {
  const sections = sources.map((source, index) => {
    const object = objects[index];
    if (object === undefined) {
      throw new Error("CS-native listing object is missing");
    }
    return [
      `; CS ASM 1.0 native listing: ${source.path}`,
      `; Language: ${source.language}; object format: CS486OBJ v${String(object.version)}; data model: ${cs486ObjectDataModel(object)}`,
      object.assembly,
    ].join("\r\n");
  });
  const listing = `CS-NATIVE-LISTING 1.0\r\n${sections.join("\r\n\r\n")}\r\n`;
  if (listing.length > 256_000) {
    throw new Error("CS-native listing limit exceeded");
  }
  return listing;
}

function renderCsNativeMap(entry: string, executable: Cs486Executable): string {
  const symbols = [...(executable.symbols ?? [])]
    .sort(
      (left, right) =>
        left.address - right.address ||
        (left.name < right.name ? -1 : left.name > right.name ? 1 : 0),
    )
    .slice(0, 4_096);
  const rows = symbols.map(
    (symbol) =>
      `${symbol.address.toString(16).toUpperCase().padStart(8, "0")} ${symbol.section ?? "ABS"} ${symbol.type ?? "notype"} ${symbol.name}${symbol.functionSignature === undefined ? "" : ` ${symbol.functionSignature}`}`,
  );
  return [
    "CS-NATIVE-LINK-MAP 1.0",
    `Entry: ${entry}`,
    `Data model: ${cs486ExecutableDataModel(executable)}`,
    "Format: validated CS486 v5 executable / CS486OBJ v1-v4 inputs",
    ...rows,
    "",
  ].join("\r\n");
}

function isCsDosBuildRecord(
  value: unknown,
  projectPath: string,
): value is CsDosBuildRecord {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  if (
    record.version !== 1 ||
    record.projectPath !== projectPath ||
    typeof record.fingerprint !== "string" ||
    !/^[0-9a-f]{64}$/u.test(record.fingerprint) ||
    !Array.isArray(record.generatedPaths) ||
    record.generatedPaths.length > 70 ||
    !record.generatedPaths.every(
      (path) => typeof path === "string" && path.length <= 256,
    ) ||
    typeof record.units !== "object" ||
    record.units === null
  ) {
    return false;
  }
  const units = Object.entries(record.units as Record<string, unknown>);
  if (units.length > 64) return false;
  return units.every(([path, unit]) => {
    if (path.length > 256 || typeof unit !== "object" || unit === null) {
      return false;
    }
    const candidate = unit as Record<string, unknown>;
    return (
      typeof candidate.fingerprint === "string" &&
      /^[0-9a-f]{64}$/u.test(candidate.fingerprint) &&
      typeof candidate.objectDigest === "string" &&
      /^[0-9a-f]{64}$/u.test(candidate.objectDigest) &&
      typeof candidate.objectPath === "string" &&
      candidate.objectPath.length <= 256
    );
  });
}

function parentPath(path: string): string {
  return path === "/" ? "/" : path.slice(0, path.lastIndexOf("/")) || "/";
}

function baseName(path: string): string {
  return path === "/" ? "/" : path.slice(path.lastIndexOf("/") + 1);
}

function nmSymbolCode(
  section: "bss" | "data" | "rodata" | "text",
  binding: "global" | "local" | "undefined",
): string {
  if (binding === "undefined") return "U";
  const code =
    section === "text"
      ? "T"
      : section === "rodata"
        ? "R"
        : section === "data"
          ? "D"
          : "B";
  return binding === "global" ? code : code.toLowerCase();
}

function joinPath(parent: string, child: string): string {
  return parent === "/" ? `/${child}` : `${parent}/${child}`;
}

function protocolInteger(value: string): number {
  if (!/^(?:0x[0-9a-f]+|[0-9]+)$/iu.test(value)) {
    throw new Error(`invalid integer '${value}'`);
  }
  const parsed = Number.parseInt(
    value,
    value.toLowerCase().startsWith("0x") ? 16 : 10,
  );
  if (!Number.isSafeInteger(parsed))
    throw new Error(`invalid integer '${value}'`);
  return parsed;
}

function protocolHexBytes(value: string): Uint8Array {
  if (value === "-") return new Uint8Array();
  const normalized = value.replaceAll("_", "");
  if (!/^(?:[0-9a-f]{2})*$/iu.test(normalized)) {
    throw new Error("hex bytes must contain complete byte pairs");
  }
  return Uint8Array.from(
    Array.from({ length: normalized.length / 2 }, (_unused, index) =>
      Number.parseInt(normalized.slice(index * 2, index * 2 + 2), 16),
    ),
  );
}

function formatProtocolHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function formatI2cAddress(address: number): string {
  return `0x${address.toString(16).padStart(2, "0")}`;
}

function splitLines(value: string): string[] {
  if (value.length === 0) return [];
  const lines = value.replaceAll("\r\n", "\n").split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines;
}

function decodeEscapes(value: string): string {
  return value.replace(/\\([\\nrt])/gu, (_match, escaped: string) => {
    switch (escaped) {
      case "n":
        return "\n";
      case "r":
        return "\r";
      case "t":
        return "\t";
      default:
        return "\\";
    }
  });
}

function expandCharacterSet(value: string): string[] {
  const characters = [...value];
  const expanded: string[] = [];
  for (let index = 0; index < characters.length; index += 1) {
    const start = characters[index]!;
    const separator = characters[index + 1];
    const end = characters[index + 2];
    if (separator === "-" && end !== undefined) {
      const startCode = start.codePointAt(0)!;
      const endCode = end.codePointAt(0)!;
      if (startCode <= endCode && endCode - startCode <= 255) {
        for (let code = startCode; code <= endCode; code += 1) {
          expanded.push(String.fromCodePoint(code));
        }
        index += 2;
        continue;
      }
    }
    expanded.push(start);
  }
  return expanded;
}

function parseLineCount(
  arguments_: readonly string[],
  command: "head" | "tail",
): {
  readonly count: number;
  readonly error?: ShellCommandResult;
  readonly paths: readonly string[];
} {
  let count = 10;
  const paths: string[] = [];
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index]!;
    if (argument === "-n") {
      const value = arguments_[index + 1];
      if (value === undefined)
        return {
          count,
          error: usage(`${command} [-n count] [file ...]`),
          paths,
        };
      count = Number(value);
      index += 1;
    } else if (/^-[0-9]+$/u.test(argument)) count = Number(argument.slice(1));
    else if (argument.startsWith("-") && argument !== "-") {
      return {
        count,
        error: failure(command, `invalid option '${argument}'`, 2),
        paths,
      };
    } else paths.push(argument);
  }
  if (!Number.isSafeInteger(count) || count < 0 || count > 100_000) {
    return { count, error: failure(command, "invalid line count", 2), paths };
  }
  return { count, paths };
}

function countOccurrences(value: string, character: string): number {
  let count = 0;
  for (const candidate of value) if (candidate === character) count += 1;
  return count;
}

function utf8Size(value: string): number {
  let size = 0;
  for (const character of value) {
    const point = character.codePointAt(0)!;
    size += point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
  }
  return size;
}

function memoryRegion(total: number, used: number): MemoryRegion {
  const boundedTotal = Math.max(0, Math.floor(total));
  const boundedUsed = Math.min(boundedTotal, Math.max(0, Math.floor(used)));
  return {
    free: boundedTotal - boundedUsed,
    total: boundedTotal,
    used: boundedUsed,
  };
}

function titleCase(value: string): string {
  return value.length === 0
    ? value
    : `${value[0]!.toUpperCase()}${value.slice(1)}`;
}

function normalizeGuestProgramOutput(
  output: string,
  newline: "\n" | "\r\n",
): string {
  const normalized = output.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
  return newline === "\n" ? normalized : normalized.replaceAll("\n", "\r\n");
}

function formatClock(clockHz: number): string {
  if (clockHz >= 1_000_000)
    return `${(clockHz / 1_000_000).toFixed(2).replace(/\.00$/u, "")} MHz`;
  if (clockHz >= 1_000)
    return `${(clockHz / 1_000).toFixed(2).replace(/\.00$/u, "")} kHz`;
  return `${clockHz} Hz`;
}

function replacePathExtension(path: string, extension: string): string {
  const slash = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  const dot = path.lastIndexOf(".");
  return `${dot > slash ? path.slice(0, dot) : path}${extension}`;
}

function applyDosRenameTemplate(sourceName: string, template: string): string {
  const [sourceBase = "", sourceExtension = ""] = sourceName
    .toUpperCase()
    .split(".", 2);
  const [templateBase = "", templateExtension] = template
    .toUpperCase()
    .split(".", 2);
  const applyComponent = (source: string, pattern: string): string => {
    if (!/[*?]/u.test(pattern)) return pattern;
    let output = "";
    let sourceIndex = 0;
    for (const character of pattern) {
      if (character === "*") {
        output += source.slice(sourceIndex);
        sourceIndex = source.length;
      } else if (character === "?") {
        if (sourceIndex < source.length) output += source[sourceIndex];
        sourceIndex += 1;
      } else {
        output += character;
        sourceIndex += 1;
      }
    }
    return output;
  };
  const base = applyComponent(sourceBase, templateBase);
  const extension =
    templateExtension === undefined
      ? ""
      : applyComponent(sourceExtension, templateExtension);
  return extension.length === 0 ? base : `${base}.${extension}`;
}

function processStateCode(process: OsProcessRecord): string {
  switch (process.state) {
    case "ready":
      return "R";
    case "running":
      return "R";
    case "sleeping":
      return "S";
    case "waiting":
      return "W";
    case "stopped":
      return "T";
    case "zombie":
      return "Z";
  }
}

function renderJob(job: OsJobRecord): string {
  const state =
    job.state === "done"
      ? `Done(${String(job.exitStatus ?? 0)})`
      : job.state === "stopped"
        ? "Stopped"
        : "Running";
  return `[${String(job.jobId)}] ${state.padEnd(10)} ${String(job.pid).padStart(5)} ${job.command}`;
}

function selectJob(
  jobs: readonly OsJobRecord[],
  selector: string | undefined,
): { readonly job: OsJobRecord } | { readonly error: string } {
  if (jobs.length === 0) return { error: "no current job" };
  if (selector === undefined) return { job: jobs.at(-1)! };
  const jobMatch = /^%([1-9][0-9]*)$/u.exec(selector);
  const pidMatch = /^([1-9][0-9]*)$/u.exec(selector);
  if (jobMatch === null && pidMatch === null)
    return { error: `${selector}: invalid job specification` };
  const numeric = Number((jobMatch ?? pidMatch)![1]);
  const job =
    jobMatch === null
      ? jobs.find((candidate) => candidate.pid === numeric)
      : jobs.find((candidate) => candidate.jobId === numeric);
  return job === undefined ? { error: `${selector}: no such job` } : { job };
}

function parseSignalArguments(
  arguments_: readonly string[],
):
  | { readonly error: string }
  | { readonly pids: readonly number[]; readonly signal: OsProcessSignal } {
  if (arguments_.length === 0) return { error: "missing process ID" };
  let signal: OsProcessSignal = "SIGTERM";
  let cursor = 0;
  const first = arguments_[0] ?? "";
  if (first === "-s" || first === "--signal") {
    const requested = arguments_[1];
    if (requested === undefined) return { error: "missing signal name" };
    const parsed = parseSignal(requested);
    if (parsed === undefined) return { error: `${requested}: invalid signal` };
    signal = parsed;
    cursor = 2;
  } else if (first.startsWith("-") && first.length > 1) {
    const parsed = parseSignal(first.slice(1));
    if (parsed === undefined) return { error: `${first}: invalid signal` };
    signal = parsed;
    cursor = 1;
  }
  const values = arguments_.slice(cursor);
  if (values.length === 0) return { error: "missing process ID" };
  const pids: number[] = [];
  for (const value of values) {
    if (!/^[1-9][0-9]*$/u.test(value))
      return { error: `${value}: invalid process ID` };
    const pid = Number(value);
    if (!Number.isSafeInteger(pid) || pid > 32_767)
      return { error: `${value}: invalid process ID` };
    pids.push(pid);
  }
  return { pids, signal };
}

function parseSignal(value: string): OsProcessSignal | undefined {
  const normalized = value.toUpperCase().replace(/^SIG/u, "");
  switch (normalized) {
    case "1":
    case "HUP":
      return "SIGHUP";
    case "2":
    case "INT":
      return "SIGINT";
    case "9":
    case "KILL":
      return "SIGKILL";
    case "15":
    case "TERM":
      return "SIGTERM";
    case "18":
    case "CONT":
      return "SIGCONT";
    case "19":
    case "STOP":
      return "SIGSTOP";
    default:
      return undefined;
  }
}

function processName(process: OsProcessRecord): string {
  const head = process.command.split(" ", 1)[0] ?? process.command;
  const segments = head.split("/");
  return segments.at(-1) ?? head;
}

function matchesProcessName(
  process: OsProcessRecord,
  pattern: string,
  exact: boolean,
): boolean {
  const name = processName(process);
  return exact ? name === pattern : name.includes(pattern);
}

function parseSignalPatternArguments(arguments_: readonly string[]):
  | { readonly error: string }
  | {
      readonly exact: boolean;
      readonly pattern: string;
      readonly signal: OsProcessSignal;
    } {
  let signal: OsProcessSignal = "SIGTERM";
  let exact = false;
  const rest: string[] = [];
  for (const argument of arguments_) {
    if (argument === "-x") {
      exact = true;
    } else if (argument.startsWith("-") && argument.length > 1) {
      const parsed = parseSignal(argument.slice(1));
      if (parsed === undefined) return { error: `${argument}: invalid option` };
      signal = parsed;
    } else {
      rest.push(argument);
    }
  }
  if (rest.length !== 1) return { error: "missing pattern operand" };
  return { exact, pattern: rest[0]!, signal };
}

function parseSignalNamesArguments(
  arguments_: readonly string[],
):
  | { readonly error: string }
  | { readonly names: readonly string[]; readonly signal: OsProcessSignal } {
  let signal: OsProcessSignal = "SIGTERM";
  const rest: string[] = [];
  for (const argument of arguments_) {
    if (argument.startsWith("-") && argument.length > 1) {
      const parsed = parseSignal(argument.slice(1));
      if (parsed === undefined) return { error: `${argument}: invalid option` };
      signal = parsed;
    } else {
      rest.push(argument);
    }
  }
  if (rest.length === 0) return { error: "missing process name operand" };
  return { names: rest, signal };
}

function wrapAtWidth(value: string, width: number): string {
  if (value.length <= width) return value;
  const lines: string[] = [];
  for (let index = 0; index < value.length; index += width)
    lines.push(value.slice(index, index + width));
  return lines.join("\n");
}

function formatBinaryBytes(bytes: number): string {
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MiB`;
  if (bytes >= 1_024) return `${(bytes / 1_024).toFixed(1)} KiB`;
  return `${bytes} B`;
}

function formatCacheBytes(bytes: number): string {
  return bytes === 0 ? "none" : formatBinaryBytes(bytes).replace(".0", "");
}

function formatMicroarchitectureStats(
  stats: CpuMicroarchitectureStats,
): string {
  return `memory: L1 ${String(stats.l1Hits)} hit/${String(stats.l1Misses)} miss, L2 ${String(stats.l2Hits)} hit/${String(stats.l2Misses)} miss, ${String(stats.busTransfers)} bus transfers, ${String(stats.unalignedAccesses)} unaligned, ${String(stats.pipelineFlushes)} pipeline flushes`;
}

function globMatches(value: string, pattern: string): boolean {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/gu, "\\$&")
    .replaceAll("*", ".*")
    .replaceAll("?", ".");
  return new RegExp(`^${escaped}$`, "u").test(value);
}

function parseDosAttributeFilter(
  value: string,
): readonly (readonly [number, boolean])[] | undefined {
  if (value.length === 0 || value.length > 12) return undefined;
  const filters = new Map<number, boolean>();
  let negated = false;
  for (const token of value) {
    if (token === "-") {
      if (negated) return undefined;
      negated = true;
      continue;
    }
    const attribute =
      token === "R"
        ? dosFatAttribute.readOnly
        : token === "H"
          ? dosFatAttribute.hidden
          : token === "S"
            ? dosFatAttribute.system
            : token === "A"
              ? dosFatAttribute.archive
              : token === "D"
                ? dosFatAttribute.directory
                : undefined;
    if (attribute === undefined) return undefined;
    filters.set(attribute, !negated);
    negated = false;
  }
  if (negated || filters.size === 0) return undefined;
  return [...filters];
}

function dosAttributeForToken(token: string): number | undefined {
  switch (token) {
    case "R":
      return dosFatAttribute.readOnly;
    case "H":
      return dosFatAttribute.hidden;
    case "S":
      return dosFatAttribute.system;
    case "A":
      return dosFatAttribute.archive;
    default:
      return undefined;
  }
}

function archiveMemberName(path: string): string {
  const name = path.replaceAll("\\", "/").split("/").at(-1) ?? "";
  if (
    name.length === 0 ||
    name.length > 64 ||
    !/^[A-Za-z0-9_.+-]+$/u.test(name) ||
    name === "." ||
    name === ".."
  ) {
    throw new Error(`invalid archive member name: ${path}`);
  }
  return name;
}

function archiveWorkCycles(archive: Cs486Archive): number {
  return Math.min(
    1_000_000,
    Math.max(
      1,
      archive.members.length * 8 +
        archive.symbols.length * 4 +
        Math.ceil(serializeCs486Archive(archive).length / 16),
    ),
  );
}

function renderCompilerDependencies(
  target: string,
  paths: readonly string[],
): string {
  return `${escapeMakeDependency(target)}: ${paths
    .map(escapeMakeDependency)
    .join(" ")}\n`;
}

function escapeMakeDependency(path: string): string {
  return path
    .replaceAll("\\", "\\\\")
    .replaceAll("$", () => "$$")
    .replaceAll("#", "\\#")
    .replaceAll(" ", "\\ ");
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isExecutableCommand(command: string): boolean {
  return (
    command.startsWith(".") ||
    command.includes("/") ||
    command.includes("\\") ||
    /^[A-Za-z]:/u.test(command)
  );
}
