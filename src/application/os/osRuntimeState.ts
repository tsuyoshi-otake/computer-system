import { utf8ByteLength } from "../../domain/text/utf8.js";
import {
  OsNetworkState,
  type OsNetworkStateSnapshotV1,
} from "./osNetworkState.js";

const maximumComputerIdBytes = 64;
const maximumCommandBytes = 512;
const maximumReasonBytes = 256;
const maximumNameBytes = 64;
const maximumPathBytes = 512;
const maximumMountOptions = 16;
/**
 * How far past `maximumJournalEntries` a restored journal may still be
 * truncated instead of rejected. Rotation only ever writes within the cap, and
 * a reduced limit or an older build stays inside this multiple.
 */
const maximumRestoredJournalOvershoot = 4;

export type OsLifecyclePhase =
  "off" | "booting" | "running" | "stopping" | "rebooting" | "faulted";

export interface OsLifecycleState {
  readonly bootTick?: number;
  readonly changedTick: number;
  readonly phase: OsLifecyclePhase;
  readonly reason?: string;
}

export type OsLifecycleTransition =
  | { readonly kind: "begin_boot"; readonly tick: number }
  | { readonly kind: "boot_complete"; readonly tick: number }
  | {
      readonly kind: "begin_shutdown";
      readonly reason: string;
      readonly tick: number;
    }
  | { readonly kind: "shutdown_complete"; readonly tick: number }
  | {
      readonly kind: "begin_reboot";
      readonly reason: string;
      readonly tick: number;
    }
  | { readonly kind: "reboot_ready"; readonly tick: number }
  | { readonly kind: "fault"; readonly reason: string; readonly tick: number }
  | { readonly kind: "reset"; readonly tick: number };

export type OsProcessState =
  "ready" | "running" | "sleeping" | "waiting" | "stopped" | "zombie";

export type OsProcessSignal =
  "SIGHUP" | "SIGINT" | "SIGKILL" | "SIGSTOP" | "SIGCONT" | "SIGTERM";

export interface OsProcessRecord {
  readonly changedTick: number;
  readonly command: string;
  readonly cpuCycles: number;
  readonly exitStatus?: number;
  readonly gid: number;
  readonly lastSignal?: OsProcessSignal;
  readonly niceValue: number;
  readonly parentPid: number;
  readonly pid: number;
  /** Foreground job-control group; defaults to the process PID for old snapshots. */
  readonly processGroupId: number;
  readonly startTick: number;
  readonly state: OsProcessState;
  readonly uid: number;
  readonly waitReason?: string;
}

export interface OsProcessSpawn {
  readonly command: string;
  readonly gid: number;
  readonly niceValue?: number;
  readonly parentPid: number;
  readonly processGroupId?: number;
  readonly startTick: number;
  readonly state?: "ready" | "running";
  readonly uid: number;
}

export interface OsProcessMemoryObservation {
  readonly residentBytes: number;
  readonly virtualBytes: number;
}

export interface OsInitProcessSpawn {
  readonly command: string;
  readonly gid: number;
  readonly startTick: number;
  readonly state?: "ready" | "running";
  readonly uid: number;
}

export type OsProcessTransition =
  | { readonly kind: "ready"; readonly tick: number }
  | { readonly kind: "run"; readonly tick: number }
  | {
      readonly kind: "sleep";
      readonly reason: string;
      readonly tick: number;
    }
  | {
      readonly kind: "wait";
      readonly reason: string;
      readonly tick: number;
    }
  | {
      readonly kind: "stop";
      readonly reason: string;
      readonly tick: number;
    }
  | {
      readonly cycles: number;
      readonly kind: "account_cycles";
      readonly tick: number;
    }
  | {
      readonly expected?: boolean;
      readonly kind: "exit";
      readonly signal?: OsProcessSignal;
      readonly status: number;
      readonly tick: number;
    };

export type OsJobState = "running" | "stopped" | "done";

export interface OsJobRecord {
  readonly changedTick: number;
  readonly command: string;
  readonly exitStatus?: number;
  readonly jobId: number;
  readonly pid: number;
  readonly state: OsJobState;
  readonly uid: number;
}

export interface OsJobCreate {
  readonly command: string;
  readonly pid: number;
  readonly tick: number;
  readonly uid: number;
}

export type OsJobTransition =
  | { readonly kind: "continue"; readonly tick: number }
  | {
      readonly kind: "stop";
      readonly reason: string;
      readonly tick: number;
    }
  | {
      readonly expected?: boolean;
      readonly kind: "complete";
      readonly status: number;
      readonly tick: number;
    };

export interface OsLoginSessionRecord {
  readonly gid: number;
  readonly lastActivityTick: number;
  readonly loginTick: number;
  readonly loginWallMilliseconds?: number;
  readonly remote?: string;
  readonly sessionId: string;
  readonly terminal: string;
  readonly uid: number;
  readonly username: string;
}

export interface OsLoginSessionOpen {
  readonly gid: number;
  readonly remote?: string;
  readonly sessionId: string;
  readonly terminal: string;
  readonly tick: number;
  readonly uid: number;
  readonly username: string;
  readonly wallMilliseconds?: number;
}

export interface OsLastLoginRecord {
  readonly gid: number;
  readonly loginTick: number;
  readonly loginWallMilliseconds?: number;
  readonly logoutReason?: string;
  readonly logoutTick?: number;
  readonly logoutWallMilliseconds?: number;
  readonly remote?: string;
  readonly terminal: string;
  readonly uid: number;
  readonly username: string;
}

export interface OsLoginOpenResult {
  readonly previous?: OsLastLoginRecord;
  readonly session: OsLoginSessionRecord;
}

export type OsServiceState =
  "inactive" | "starting" | "running" | "stopping" | "failed";

export interface OsServiceRecord {
  readonly changedTick: number;
  readonly detail?: string;
  readonly enabled: boolean;
  readonly name: string;
  readonly pid?: number;
  readonly state: OsServiceState;
}

export interface OsServiceRegistration {
  readonly enabled: boolean;
  readonly name: string;
  readonly tick: number;
}

export type OsServiceTransition =
  | { readonly kind: "start"; readonly tick: number }
  | { readonly kind: "running"; readonly pid?: number; readonly tick: number }
  | { readonly kind: "stop"; readonly tick: number }
  | { readonly kind: "stopped"; readonly tick: number }
  | {
      readonly detail: string;
      readonly kind: "fail";
      readonly tick: number;
    }
  | {
      readonly enabled: boolean;
      readonly kind: "set_enabled";
      readonly tick: number;
    };

export interface OsMountRecord {
  readonly filesystemType: string;
  readonly mountedTick: number;
  readonly options: readonly string[];
  readonly readOnly: boolean;
  readonly source: string;
  readonly target: string;
}

export interface OsMountDefinition {
  readonly filesystemType: string;
  readonly options: readonly string[];
  readonly readOnly: boolean;
  readonly source: string;
  readonly target: string;
}

export interface OsMountRegistration extends OsMountDefinition {
  readonly mountedTick: number;
}

export type OsDeviceKind = "block" | "character" | "virtual";
export type OsDeviceState = "absent" | "available" | "offline";

export interface OsDeviceRecord {
  readonly changedTick: number;
  readonly driver?: string;
  readonly kind: OsDeviceKind;
  readonly major?: number;
  readonly minor?: number;
  readonly path: string;
  readonly readOnly: boolean;
  readonly state: OsDeviceState;
}

export interface OsDeviceRegistration {
  readonly driver?: string;
  readonly kind: OsDeviceKind;
  readonly major?: number;
  readonly minor?: number;
  readonly path: string;
  readonly readOnly?: boolean;
  readonly state: OsDeviceState;
  readonly tick: number;
}

export type OsJournalChannel = "auth" | "boot" | "system";
export type OsJournalSeverity =
  "debug" | "info" | "notice" | "warning" | "error" | "critical";

export interface OsJournalEntry {
  readonly bytes: number;
  readonly channel: OsJournalChannel;
  readonly message: string;
  readonly sequence: number;
  readonly severity: OsJournalSeverity;
  readonly tick: number;
}

export interface OsJournalAppend {
  readonly channel: OsJournalChannel;
  readonly message: string;
  readonly severity?: OsJournalSeverity;
  readonly tick: number;
}

export interface OsRuntimeStateLimits {
  readonly maximumDevices: number;
  readonly maximumJobs: number;
  readonly maximumJournalBytes: number;
  readonly maximumJournalEntries: number;
  readonly maximumJournalEntryBytes: number;
  readonly maximumLastLogins: number;
  readonly maximumLoginSessions: number;
  readonly maximumMounts: number;
  readonly maximumPid: number;
  readonly maximumProcesses: number;
  readonly maximumServices: number;
}

export const defaultOsRuntimeStateLimits: OsRuntimeStateLimits = Object.freeze({
  maximumDevices: 64,
  maximumJobs: 32,
  maximumJournalBytes: 32_768,
  maximumJournalEntries: 256,
  maximumJournalEntryBytes: 1_024,
  maximumLastLogins: 64,
  maximumLoginSessions: 8,
  maximumMounts: 16,
  maximumPid: 32_767,
  maximumProcesses: 64,
  maximumServices: 32,
});

export type OsRuntimeCapacity =
  | "devices"
  | "jobs"
  | "journal_bytes"
  | "journal_entries"
  | "last_logins"
  | "login_sessions"
  | "mounts"
  | "pid_space"
  | "processes"
  | "services";

export class OsRuntimeStateCapacityError extends Error {
  constructor(
    readonly resource: OsRuntimeCapacity,
    readonly maximum: number,
  ) {
    super(`OS runtime ${resource} capacity ${String(maximum)} exceeded`);
    this.name = "OsRuntimeStateCapacityError";
  }
}

export class OsRuntimeStateTransitionError extends Error {
  constructor(
    readonly entity: string,
    detail: string,
  ) {
    super(`${entity}: ${detail}`);
    this.name = "OsRuntimeStateTransitionError";
  }
}

export class OsRuntimeStateSnapshotError extends TypeError {
  constructor(detail: string) {
    super(`OS runtime snapshot: ${detail}`);
    this.name = "OsRuntimeStateSnapshotError";
  }
}

export interface OsRuntimeStateSnapshotV1 {
  readonly computerId: string;
  readonly devices: readonly OsDeviceRecord[];
  readonly jobs: readonly OsJobRecord[];
  readonly journal: readonly OsJournalEntry[];
  readonly journalBytes: number;
  readonly journalDropped: number;
  readonly lastLogins: readonly OsLastLoginRecord[];
  readonly lifecycle: OsLifecycleState;
  readonly loginSessions: readonly OsLoginSessionRecord[];
  readonly mountDefinitions: readonly OsMountDefinition[];
  readonly mounts: readonly OsMountRecord[];
  readonly network?: OsNetworkStateSnapshotV1;
  readonly nextJobId: number;
  readonly nextJournalSequence: number;
  readonly nextPid: number;
  readonly processes: readonly OsProcessRecord[];
  readonly revision: number;
  readonly schema: 1;
  readonly services: readonly OsServiceRecord[];
}

/**
 * Per-Computer application state for Linux-visible runtime presence.
 *
 * PID 1 is reserved for the init process. Dynamic PIDs use a cyclic next-fit
 * scan over 2..maximumPid. A zombie owns its PID until explicitly reaped, and
 * reaping never rewinds the cursor, so reuse is deterministic after restore.
 */
export class OsRuntimeState {
  readonly computerId: string;
  readonly limits: OsRuntimeStateLimits;

  private lifecycleValue: OsLifecycleState = Object.freeze({
    changedTick: 0,
    phase: "off",
  });
  private readonly processRecords = new Map<number, OsProcessRecord>();
  private readonly jobRecords = new Map<number, OsJobRecord>();
  private readonly loginSessionRecords = new Map<
    string,
    OsLoginSessionRecord
  >();
  private readonly lastLoginRecords = new Map<string, OsLastLoginRecord>();
  private readonly serviceRecords = new Map<string, OsServiceRecord>();
  private readonly mountDefinitionRecords = new Map<
    string,
    OsMountDefinition
  >();
  private readonly mountRecords = new Map<string, OsMountRecord>();
  private readonly deviceRecords = new Map<string, OsDeviceRecord>();
  private readonly journalRecords: OsJournalEntry[] = [];
  private networkStateValue: OsNetworkState;
  private currentRunlevelValue?: string;
  private previousRunlevelValue?: string;
  private journalBytesValue = 0;
  private journalDroppedValue = 0;
  private nextPidValue = 2;
  private nextJobIdValue = 1;
  private nextJournalSequenceValue = 1;
  private revisionValue = 0;

  constructor(computerId: string, limits: Partial<OsRuntimeStateLimits> = {}) {
    this.computerId = requireBoundedString(
      "computer ID",
      computerId,
      maximumComputerIdBytes,
    );
    this.limits = normalizeLimits(limits);
    this.networkStateValue = new OsNetworkState(this.computerId, {}, () => {
      this.bumpRevision();
    });
  }

  static restore(
    computerId: string,
    snapshot: unknown = undefined,
    limits: Partial<OsRuntimeStateLimits> = {},
  ): OsRuntimeState {
    const state = new OsRuntimeState(computerId, limits);
    if (snapshot === undefined) return state;
    state.restoreSnapshot(snapshot);
    return state;
  }

  get lifecycle(): OsLifecycleState {
    return this.lifecycleValue;
  }

  get journalBytes(): number {
    return this.journalBytesValue;
  }

  get network(): OsNetworkState {
    return this.networkStateValue;
  }

  get revision(): number {
    return this.revisionValue;
  }

  transitionLifecycle(event: OsLifecycleTransition): OsLifecycleState {
    requireTick(event.tick, "lifecycle tick");
    if (event.tick < this.lifecycleValue.changedTick) {
      throw new OsRuntimeStateTransitionError(
        "lifecycle",
        "tick moved backwards",
      );
    }
    const current = this.lifecycleValue;
    switch (event.kind) {
      case "begin_boot":
        this.requireLifecycle("off", event.kind);
        this.lifecycleValue = lifecycleState("booting", event.tick, event.tick);
        break;
      case "boot_complete": {
        this.requireLifecycle("booting", event.kind);
        const init = this.processRecords.get(1);
        if (
          init === undefined ||
          (init.state !== "ready" && init.state !== "running")
        ) {
          throw new OsRuntimeStateTransitionError(
            "lifecycle",
            "boot cannot complete without a live PID 1",
          );
        }
        this.lifecycleValue = lifecycleState(
          "running",
          event.tick,
          current.bootTick,
        );
        break;
      }
      case "begin_shutdown":
        if (
          current.phase !== "booting" &&
          current.phase !== "running" &&
          current.phase !== "faulted"
        ) {
          this.invalidLifecycle(event.kind);
        }
        this.lifecycleValue = lifecycleState(
          "stopping",
          event.tick,
          current.bootTick,
          event.reason,
        );
        break;
      case "shutdown_complete":
        this.requireLifecycle("stopping", event.kind);
        this.clearVolatileState(event.tick);
        this.lifecycleValue = lifecycleState("off", event.tick);
        break;
      case "begin_reboot":
        this.requireLifecycle("running", event.kind);
        this.lifecycleValue = lifecycleState(
          "rebooting",
          event.tick,
          current.bootTick,
          event.reason,
        );
        break;
      case "reboot_ready":
        this.requireLifecycle("rebooting", event.kind);
        this.clearVolatileState(event.tick);
        this.lifecycleValue = lifecycleState("booting", event.tick, event.tick);
        break;
      case "fault":
        if (current.phase === "off") this.invalidLifecycle(event.kind);
        this.lifecycleValue = lifecycleState(
          "faulted",
          event.tick,
          current.bootTick,
          event.reason,
        );
        break;
      case "reset":
        this.requireLifecycle("faulted", event.kind);
        this.clearVolatileState(event.tick);
        this.lifecycleValue = lifecycleState("off", event.tick);
        break;
    }
    this.bumpRevision();
    return this.lifecycleValue;
  }

  createInitProcess(input: OsInitProcessSpawn): OsProcessRecord {
    this.requireLifecycle("booting", "create init process");
    if (this.processRecords.has(1)) {
      throw new OsRuntimeStateTransitionError("process 1", "already exists");
    }
    this.requireMapCapacity(
      this.processRecords,
      this.limits.maximumProcesses,
      "processes",
    );
    const record = createProcessRecord(1, { ...input, parentPid: 0 });
    this.processRecords.set(1, record);
    this.bumpRevision();
    return record;
  }

  spawnProcess(input: OsProcessSpawn): OsProcessRecord {
    this.requirePresencePhase("spawn process");
    this.requireMapCapacity(
      this.processRecords,
      this.limits.maximumProcesses,
      "processes",
    );
    requireParentProcess(this.processRecords, input.parentPid);
    validateProcessSpawn(input);
    const pid = this.allocatePid();
    const record = createProcessRecord(pid, input);
    this.processRecords.set(pid, record);
    this.bumpRevision();
    return record;
  }

  process(pid: number): OsProcessRecord | undefined {
    requirePid(pid, this.limits.maximumPid);
    return this.processRecords.get(pid);
  }

  processes(): readonly OsProcessRecord[] {
    return sortedNumericValues(this.processRecords);
  }

  transitionProcess(pid: number, event: OsProcessTransition): OsProcessRecord {
    const current = this.requireProcess(pid);
    requireTick(event.tick, "process transition tick");
    if (event.tick < current.changedTick) {
      throw new OsRuntimeStateTransitionError(
        `process ${String(pid)}`,
        "tick moved backwards",
      );
    }
    if (current.state === "zombie") {
      throw new OsRuntimeStateTransitionError(
        `process ${String(pid)}`,
        "zombie must be reaped before further transitions",
      );
    }

    let updated: OsProcessRecord;
    switch (event.kind) {
      case "ready":
        updated = processState(current, "ready", event.tick);
        break;
      case "run":
        updated = processState(current, "running", event.tick);
        break;
      case "sleep":
        updated = processState(current, "sleeping", event.tick, event.reason);
        break;
      case "wait":
        updated = processState(current, "waiting", event.tick, event.reason);
        break;
      case "stop":
        updated = processState(current, "stopped", event.tick, event.reason);
        break;
      case "account_cycles": {
        requirePositiveSafeInteger(event.cycles, "process cycles");
        const cpuCycles = current.cpuCycles + event.cycles;
        if (!Number.isSafeInteger(cpuCycles)) {
          throw new OsRuntimeStateTransitionError(
            `process ${String(pid)}`,
            "CPU cycle counter overflow",
          );
        }
        updated = Object.freeze({
          ...current,
          changedTick: event.tick,
          cpuCycles,
        });
        break;
      }
      case "exit":
        requireExitStatus(event.status);
        updated = Object.freeze({
          ...current,
          changedTick: event.tick,
          exitStatus: event.status,
          ...(event.signal === undefined ? {} : { lastSignal: event.signal }),
          state: "zombie",
          waitReason: undefined,
        });
        break;
    }
    this.processRecords.set(pid, updated);
    this.synchronizeProcessDependents(updated, event);
    this.bumpRevision();
    return updated;
  }

  signalProcess(
    pid: number,
    signal: OsProcessSignal,
    tick: number,
  ): OsProcessRecord {
    let updated: OsProcessRecord;
    switch (signal) {
      case "SIGSTOP":
        updated = this.transitionProcess(pid, {
          kind: "stop",
          reason: signal,
          tick,
        });
        break;
      case "SIGCONT":
        updated = this.transitionProcess(pid, { kind: "ready", tick });
        break;
      case "SIGHUP":
        return this.transitionProcess(pid, {
          kind: "exit",
          signal,
          status: 129,
          tick,
        });
      case "SIGINT":
        return this.transitionProcess(pid, {
          kind: "exit",
          signal,
          status: 130,
          tick,
        });
      case "SIGKILL":
        return this.transitionProcess(pid, {
          kind: "exit",
          signal,
          status: 137,
          tick,
        });
      case "SIGTERM":
        return this.transitionProcess(pid, {
          kind: "exit",
          signal,
          status: 143,
          tick,
        });
    }
    updated = Object.freeze({ ...updated, lastSignal: signal });
    this.processRecords.set(pid, updated);
    return updated;
  }

  reapProcess(pid: number): OsProcessRecord {
    const process = this.requireProcess(pid);
    if (process.state !== "zombie") {
      throw new OsRuntimeStateTransitionError(
        `process ${String(pid)}`,
        "only a zombie can be reaped",
      );
    }
    this.processRecords.delete(pid);
    this.bumpRevision();
    return process;
  }

  createJob(input: OsJobCreate): OsJobRecord {
    this.requireLifecycle("running", "create job");
    this.requireMapCapacity(this.jobRecords, this.limits.maximumJobs, "jobs");
    const process = this.requireProcess(input.pid);
    if (process.state === "zombie") {
      throw new OsRuntimeStateTransitionError("job", "process is a zombie");
    }
    if (
      [...this.jobRecords.values()].some(
        ({ pid, state }) => pid === input.pid && state !== "done",
      )
    ) {
      throw new OsRuntimeStateTransitionError(
        "job",
        `process ${String(input.pid)} already has a job`,
      );
    }
    requireIdentityId(input.uid, "job UID");
    requireTick(input.tick, "job creation tick");
    const command = requireBoundedString(
      "job command",
      input.command,
      maximumCommandBytes,
    );
    const jobId = this.allocateJobId();
    const record: OsJobRecord = Object.freeze({
      changedTick: input.tick,
      command,
      jobId,
      pid: input.pid,
      state: process.state === "stopped" ? "stopped" : "running",
      uid: input.uid,
    });
    this.jobRecords.set(jobId, record);
    this.bumpRevision();
    return record;
  }

  job(jobId: number): OsJobRecord | undefined {
    requireJobId(jobId, this.limits.maximumJobs);
    return this.jobRecords.get(jobId);
  }

  jobs(uid?: number): readonly OsJobRecord[] {
    if (uid !== undefined) requireIdentityId(uid, "job UID");
    return sortedNumericValues(this.jobRecords).filter(
      (job) => uid === undefined || job.uid === uid,
    );
  }

  transitionJob(jobId: number, event: OsJobTransition): OsJobRecord {
    const job = this.requireJob(jobId);
    if (job.state === "done") {
      throw new OsRuntimeStateTransitionError(
        `job ${String(jobId)}`,
        "completed job must be removed before further transitions",
      );
    }
    switch (event.kind) {
      case "continue":
        this.transitionProcess(job.pid, { kind: "ready", tick: event.tick });
        break;
      case "stop":
        this.transitionProcess(job.pid, {
          kind: "stop",
          reason: event.reason,
          tick: event.tick,
        });
        break;
      case "complete":
        this.transitionProcess(job.pid, {
          ...(event.expected === undefined ? {} : { expected: event.expected }),
          kind: "exit",
          status: event.status,
          tick: event.tick,
        });
        break;
    }
    return this.requireJob(jobId);
  }

  removeJob(jobId: number): OsJobRecord {
    const job = this.requireJob(jobId);
    if (job.state !== "done") {
      throw new OsRuntimeStateTransitionError(
        `job ${String(jobId)}`,
        "only a completed job can be removed",
      );
    }
    this.jobRecords.delete(jobId);
    this.bumpRevision();
    return job;
  }

  openLoginSession(input: OsLoginSessionOpen): OsLoginOpenResult {
    this.requireLifecycle("running", "open login session");
    validateLoginSessionInput(input);
    const loginWallMilliseconds =
      input.wallMilliseconds === undefined
        ? undefined
        : requireWallMilliseconds(input.wallMilliseconds, "login wall time");
    if (this.loginSessionRecords.has(input.sessionId)) {
      throw new OsRuntimeStateTransitionError(
        `login session ${input.sessionId}`,
        "already exists",
      );
    }
    this.requireMapCapacity(
      this.loginSessionRecords,
      this.limits.maximumLoginSessions,
      "login_sessions",
    );
    const previous = this.lastLoginRecords.get(input.username);
    if (
      previous === undefined &&
      this.lastLoginRecords.size >= this.limits.maximumLastLogins
    ) {
      // Bounded login history is a record, not an admission gate. Refusing the
      // 65th distinct account would deny a valid login, so the oldest record
      // rotates out instead.
      this.evictOldestLastLogin();
    }
    const session: OsLoginSessionRecord = Object.freeze({
      gid: input.gid,
      lastActivityTick: input.tick,
      loginTick: input.tick,
      ...(loginWallMilliseconds === undefined ? {} : { loginWallMilliseconds }),
      ...(input.remote === undefined ? {} : { remote: input.remote }),
      sessionId: input.sessionId,
      terminal: input.terminal,
      uid: input.uid,
      username: input.username,
    });
    const lastLogin: OsLastLoginRecord = Object.freeze({
      gid: input.gid,
      loginTick: input.tick,
      ...(loginWallMilliseconds === undefined ? {} : { loginWallMilliseconds }),
      ...(input.remote === undefined ? {} : { remote: input.remote }),
      terminal: input.terminal,
      uid: input.uid,
      username: input.username,
    });
    this.loginSessionRecords.set(input.sessionId, session);
    this.lastLoginRecords.set(input.username, lastLogin);
    this.bumpRevision();
    return Object.freeze({
      ...(previous === undefined ? {} : { previous }),
      session,
    });
  }

  /**
   * Removes the least recent login record over a bounded table.
   *
   * The oldest `loginTick` wins, ties break on the username, so the choice is
   * deterministic and survives restore in the same order.
   */
  private evictOldestLastLogin(): void {
    let oldest: OsLastLoginRecord | undefined;
    for (const record of this.lastLoginRecords.values()) {
      if (
        oldest === undefined ||
        record.loginTick < oldest.loginTick ||
        (record.loginTick === oldest.loginTick &&
          record.username < oldest.username)
      ) {
        oldest = record;
      }
    }
    if (oldest !== undefined) this.lastLoginRecords.delete(oldest.username);
  }

  touchLoginSession(sessionId: string, tick: number): OsLoginSessionRecord {
    const current = this.requireLoginSession(sessionId);
    requireTick(tick, "login activity tick");
    if (tick < current.lastActivityTick) {
      throw new OsRuntimeStateTransitionError(
        `login session ${sessionId}`,
        "tick moved backwards",
      );
    }
    const updated = Object.freeze({ ...current, lastActivityTick: tick });
    this.loginSessionRecords.set(sessionId, updated);
    this.bumpRevision();
    return updated;
  }

  closeLoginSession(
    sessionId: string,
    tick: number,
    reason = "logout",
    wallMilliseconds?: number,
  ): OsLoginSessionRecord {
    const session = this.requireLoginSession(sessionId);
    requireTick(tick, "logout tick");
    if (tick < session.lastActivityTick) {
      throw new OsRuntimeStateTransitionError(
        `login session ${sessionId}`,
        "tick moved backwards",
      );
    }
    const logoutReason = requireBoundedString(
      "logout reason",
      reason,
      maximumReasonBytes,
    );
    const logoutWallMilliseconds =
      wallMilliseconds === undefined
        ? undefined
        : requireWallMilliseconds(wallMilliseconds, "logout wall time");
    this.loginSessionRecords.delete(sessionId);
    const lastLogin = this.lastLoginRecords.get(session.username);
    if (lastLogin?.loginTick === session.loginTick) {
      this.lastLoginRecords.set(
        session.username,
        Object.freeze({
          ...lastLogin,
          logoutReason,
          logoutTick: tick,
          ...(logoutWallMilliseconds === undefined
            ? {}
            : { logoutWallMilliseconds }),
        }),
      );
    }
    this.bumpRevision();
    return session;
  }

  loginSession(sessionId: string): OsLoginSessionRecord | undefined {
    requireBoundedString("login session ID", sessionId, maximumNameBytes);
    return this.loginSessionRecords.get(sessionId);
  }

  loginSessions(): readonly OsLoginSessionRecord[] {
    return sortedStringValues(this.loginSessionRecords);
  }

  lastLogin(username: string): OsLastLoginRecord | undefined {
    requireBoundedString("username", username, maximumNameBytes);
    return this.lastLoginRecords.get(username);
  }

  registerService(input: OsServiceRegistration): OsServiceRecord {
    this.requirePresencePhase("register service");
    validateServiceName(input.name);
    requireTick(input.tick, "service registration tick");
    if (this.serviceRecords.has(input.name)) {
      throw new OsRuntimeStateTransitionError(
        `service ${input.name}`,
        "already exists",
      );
    }
    this.requireMapCapacity(
      this.serviceRecords,
      this.limits.maximumServices,
      "services",
    );
    const record: OsServiceRecord = Object.freeze({
      changedTick: input.tick,
      enabled: input.enabled,
      name: input.name,
      state: "inactive",
    });
    this.serviceRecords.set(input.name, record);
    this.bumpRevision();
    return record;
  }

  service(name: string): OsServiceRecord | undefined {
    validateServiceName(name);
    return this.serviceRecords.get(name);
  }

  services(): readonly OsServiceRecord[] {
    return sortedStringValues(this.serviceRecords);
  }

  transitionService(name: string, event: OsServiceTransition): OsServiceRecord {
    const current = this.requireService(name);
    requireTick(event.tick, "service transition tick");
    if (event.tick < current.changedTick) {
      throw new OsRuntimeStateTransitionError(
        `service ${name}`,
        "tick moved backwards",
      );
    }
    let updated: OsServiceRecord;
    switch (event.kind) {
      case "set_enabled":
        updated = Object.freeze({
          ...current,
          changedTick: event.tick,
          enabled: event.enabled,
        });
        break;
      case "start":
        if (current.state !== "inactive" && current.state !== "failed") {
          this.invalidServiceTransition(current, event.kind);
        }
        updated = Object.freeze({
          changedTick: event.tick,
          enabled: current.enabled,
          name,
          state: "starting",
        });
        break;
      case "running":
        if (current.state !== "starting") {
          this.invalidServiceTransition(current, event.kind);
        }
        if (event.pid !== undefined) {
          const process = this.requireProcess(event.pid);
          if (process.state === "zombie") {
            throw new OsRuntimeStateTransitionError(
              `service ${name}`,
              "cannot attach to a zombie process",
            );
          }
        }
        updated = Object.freeze({
          changedTick: event.tick,
          enabled: current.enabled,
          name,
          ...(event.pid === undefined ? {} : { pid: event.pid }),
          state: "running",
        });
        break;
      case "stop":
        if (
          current.state !== "starting" &&
          current.state !== "running" &&
          current.state !== "failed"
        ) {
          this.invalidServiceTransition(current, event.kind);
        }
        updated = Object.freeze({
          ...current,
          changedTick: event.tick,
          state: "stopping",
        });
        break;
      case "stopped":
        if (current.state !== "stopping") {
          this.invalidServiceTransition(current, event.kind);
        }
        updated = Object.freeze({
          changedTick: event.tick,
          enabled: current.enabled,
          name,
          state: "inactive",
        });
        break;
      case "fail":
        if (current.state === "inactive") {
          this.invalidServiceTransition(current, event.kind);
        }
        updated = Object.freeze({
          changedTick: event.tick,
          detail: requireBoundedString(
            "service failure detail",
            event.detail,
            maximumReasonBytes,
          ),
          enabled: current.enabled,
          name,
          ...(current.pid === undefined ? {} : { pid: current.pid }),
          state: "failed",
        });
        break;
    }
    this.serviceRecords.set(name, updated);
    this.bumpRevision();
    return updated;
  }

  /**
   * Runlevel is host-scoped, in-memory presentation state derived from
   * `/etc/inittab`'s `initdefault` entry on every boot. It never persists,
   * matching how real sysvinit re-derives it fresh rather than restoring it.
   */
  runlevel(): { readonly current?: string; readonly previous?: string } {
    return Object.freeze({
      ...(this.currentRunlevelValue === undefined
        ? {}
        : { current: this.currentRunlevelValue }),
      ...(this.previousRunlevelValue === undefined
        ? {}
        : { previous: this.previousRunlevelValue }),
    });
  }

  setRunlevel(
    next: string,
    tick: number,
  ): { readonly current: string; readonly previous?: string } {
    this.requirePresencePhase("set runlevel");
    requireTick(tick, "runlevel tick");
    validateRunlevelCharacter(next);
    const previous = this.currentRunlevelValue;
    this.previousRunlevelValue = previous;
    this.currentRunlevelValue = next;
    this.bumpRevision();
    return Object.freeze({
      current: next,
      ...(previous === undefined ? {} : { previous }),
    });
  }

  defineMount(input: OsMountDefinition): OsMountDefinition {
    this.requirePresencePhase("define mount");
    const definition = validateMountDefinition(input);
    if (
      !this.mountDefinitionRecords.has(definition.target) &&
      this.mountDefinitionRecords.size >= this.limits.maximumMounts
    ) {
      throw new OsRuntimeStateCapacityError(
        "mounts",
        this.limits.maximumMounts,
      );
    }
    if (this.mountRecords.has(definition.target)) {
      throw new OsRuntimeStateTransitionError(
        `mount ${definition.target}`,
        "cannot change the definition while mounted",
      );
    }
    this.mountDefinitionRecords.set(definition.target, definition);
    this.bumpRevision();
    return definition;
  }

  removeMountDefinition(target: string): OsMountDefinition {
    const normalized = requireAbsolutePath("mount target", target);
    if (this.mountRecords.has(normalized)) {
      throw new OsRuntimeStateTransitionError(
        `mount ${normalized}`,
        "cannot remove the definition while mounted",
      );
    }
    const definition = this.mountDefinitionRecords.get(normalized);
    if (definition === undefined) {
      throw new OsRuntimeStateTransitionError(
        `mount ${normalized}`,
        "definition does not exist",
      );
    }
    this.mountDefinitionRecords.delete(normalized);
    this.bumpRevision();
    return definition;
  }

  mountDefinitions(): readonly OsMountDefinition[] {
    return sortedStringValues(this.mountDefinitionRecords);
  }

  mount(input: OsMountRegistration): OsMountRecord {
    this.requirePresencePhase("mount filesystem");
    const record = validateMount(input);
    if (this.mountRecords.has(record.target)) {
      throw new OsRuntimeStateTransitionError(
        `mount ${record.target}`,
        "target is already mounted",
      );
    }
    this.requireMapCapacity(
      this.mountRecords,
      this.limits.maximumMounts,
      "mounts",
    );
    const definition = mountDefinition(record);
    const configured = this.mountDefinitionRecords.get(record.target);
    if (
      configured !== undefined &&
      !sameMountDefinition(configured, definition)
    ) {
      throw new OsRuntimeStateTransitionError(
        `mount ${record.target}`,
        "active mount does not match its stable definition",
      );
    }
    if (
      configured === undefined &&
      this.mountDefinitionRecords.size >= this.limits.maximumMounts
    ) {
      throw new OsRuntimeStateCapacityError(
        "mounts",
        this.limits.maximumMounts,
      );
    }
    this.mountDefinitionRecords.set(record.target, definition);
    this.mountRecords.set(record.target, record);
    this.bumpRevision();
    return record;
  }

  unmount(target: string): OsMountRecord {
    const normalized = requireAbsolutePath("mount target", target);
    const record = this.mountRecords.get(normalized);
    if (record === undefined) {
      throw new OsRuntimeStateTransitionError(
        `mount ${normalized}`,
        "not mounted",
      );
    }
    this.mountRecords.delete(normalized);
    this.bumpRevision();
    return record;
  }

  mounts(): readonly OsMountRecord[] {
    return sortedStringValues(this.mountRecords);
  }

  registerDevice(input: OsDeviceRegistration): OsDeviceRecord {
    this.requirePresencePhase("register device");
    const record = validateDevice(input);
    if (this.deviceRecords.has(record.path)) {
      throw new OsRuntimeStateTransitionError(
        `device ${record.path}`,
        "already exists",
      );
    }
    this.requireMapCapacity(
      this.deviceRecords,
      this.limits.maximumDevices,
      "devices",
    );
    this.deviceRecords.set(record.path, record);
    this.bumpRevision();
    return record;
  }

  setDeviceState(
    path: string,
    state: OsDeviceState,
    tick: number,
  ): OsDeviceRecord {
    const current = this.requireDevice(path);
    requireTick(tick, "device transition tick");
    if (tick < current.changedTick) {
      throw new OsRuntimeStateTransitionError(
        `device ${path}`,
        "tick moved backwards",
      );
    }
    const updated = Object.freeze({ ...current, changedTick: tick, state });
    this.deviceRecords.set(current.path, updated);
    this.bumpRevision();
    return updated;
  }

  removeDevice(path: string): OsDeviceRecord {
    const device = this.requireDevice(path);
    this.deviceRecords.delete(device.path);
    this.bumpRevision();
    return device;
  }

  devices(): readonly OsDeviceRecord[] {
    return sortedStringValues(this.deviceRecords);
  }

  appendJournal(input: OsJournalAppend): OsJournalEntry {
    requireTick(input.tick, "journal tick");
    requireJournalChannel(input.channel);
    const severity = input.severity ?? "info";
    requireJournalSeverity(severity);
    const message = requireBoundedString(
      "journal message",
      input.message,
      this.limits.maximumJournalEntryBytes,
    );
    if (/\r|\n/u.test(message)) {
      throw new RangeError("journal message must contain exactly one line");
    }
    const bytes = utf8ByteLength(message);
    if (
      !Number.isSafeInteger(this.nextJournalSequenceValue) ||
      this.nextJournalSequenceValue === Number.MAX_SAFE_INTEGER
    ) {
      throw new OsRuntimeStateTransitionError(
        "journal",
        "sequence counter overflow",
      );
    }
    this.evictOldestJournalRecords(bytes);
    const entry: OsJournalEntry = Object.freeze({
      bytes,
      channel: input.channel,
      message,
      sequence: this.nextJournalSequenceValue,
      severity,
      tick: input.tick,
    });
    this.journalRecords.push(entry);
    this.journalBytesValue += bytes;
    this.nextJournalSequenceValue += 1;
    this.bumpRevision();
    return entry;
  }

  /**
   * Number of records this journal has dropped to stay inside its caps.
   *
   * Rotation must never be silent: the journal carries authentication records,
   * so the count is persisted and rendered as one leading notice line.
   */
  journalDropped(): number {
    return this.journalDroppedValue;
  }

  /**
   * Rotates oldest-first until one more record of `incomingBytes` fits.
   *
   * A diagnostic log reaching its documented cap must not fail the operation
   * that reported the event, so both the entry cap and the byte cap evict
   * instead of throwing. `normalizeLimits` keeps `maximumJournalEntryBytes`
   * within `maximumJournalBytes`, so a validated message always fits and this
   * loop always terminates. Eviction is oldest-first in one bounded splice,
   * which also keeps `nextJournalSequence` above every retained sequence.
   */
  private evictOldestJournalRecords(incomingBytes: number): void {
    let dropped = 0;
    let droppedBytes = 0;
    while (
      dropped < this.journalRecords.length &&
      (this.journalRecords.length - dropped >=
        this.limits.maximumJournalEntries ||
        this.journalBytesValue - droppedBytes + incomingBytes >
          this.limits.maximumJournalBytes)
    ) {
      droppedBytes += this.journalRecords[dropped]?.bytes ?? 0;
      dropped += 1;
    }
    if (dropped === 0) return;
    this.journalRecords.splice(0, dropped);
    this.journalBytesValue -= droppedBytes;
    this.journalDroppedValue = saturatingCount(
      this.journalDroppedValue,
      dropped,
    );
  }

  appendBootJournal(
    tick: number,
    message: string,
    severity: OsJournalSeverity = "info",
  ): OsJournalEntry {
    return this.appendJournal({ channel: "boot", message, severity, tick });
  }

  appendAuthJournal(
    tick: number,
    message: string,
    severity: OsJournalSeverity = "notice",
  ): OsJournalEntry {
    return this.appendJournal({ channel: "auth", message, severity, tick });
  }

  appendSystemJournal(
    tick: number,
    message: string,
    severity: OsJournalSeverity = "info",
  ): OsJournalEntry {
    return this.appendJournal({ channel: "system", message, severity, tick });
  }

  journalEntries(channel?: OsJournalChannel): readonly OsJournalEntry[] {
    if (channel !== undefined) requireJournalChannel(channel);
    return this.journalRecords.filter(
      (entry) => channel === undefined || entry.channel === channel,
    );
  }

  /**
   * Removes only entries returned by this state's append methods.
   *
   * Final-persistence precommit records use this bounded rollback when the
   * persistence callback fails. Identity matching preserves unrelated records
   * that a synchronous callback may have appended after the provisional ones.
   *
   * An entry rotation already evicted is skipped rather than rejected. Refusing
   * it would replace the caller's real failure with a rollback error and hide
   * the reason the transaction was abandoned.
   */
  rollbackJournalEntries(entries: readonly OsJournalEntry[]): void {
    if (entries.length === 0) return;
    if (entries.length > this.limits.maximumJournalEntries) {
      throw new OsRuntimeStateTransitionError(
        "journal rollback",
        "entry count exceeds the journal limit",
      );
    }
    const requested = new Set(entries);
    if (requested.size !== entries.length) {
      throw new OsRuntimeStateTransitionError(
        "journal rollback",
        "entry list contains duplicates",
      );
    }
    let bytes = 0;
    let found = 0;
    let firstRemovedSequence = Number.MAX_SAFE_INTEGER;
    let lastRemovedSequence = 0;
    for (const entry of this.journalRecords) {
      if (!requested.has(entry)) continue;
      found += 1;
      bytes += entry.bytes;
      firstRemovedSequence = Math.min(firstRemovedSequence, entry.sequence);
      lastRemovedSequence = Math.max(lastRemovedSequence, entry.sequence);
    }
    if (found === 0) return;
    if (bytes > this.journalBytesValue) {
      throw new OsRuntimeStateTransitionError(
        "journal rollback",
        "byte accounting underflow",
      );
    }

    for (let index = this.journalRecords.length - 1; index >= 0; index -= 1) {
      const entry = this.journalRecords[index];
      if (entry !== undefined && requested.has(entry)) {
        this.journalRecords.splice(index, 1);
      }
    }
    this.journalBytesValue -= bytes;

    const finalSequence = this.journalRecords.at(-1)?.sequence ?? 0;
    if (
      finalSequence < firstRemovedSequence &&
      lastRemovedSequence + 1 === this.nextJournalSequenceValue &&
      lastRemovedSequence - firstRemovedSequence + 1 === found
    ) {
      this.nextJournalSequenceValue = firstRemovedSequence;
    }
    this.bumpRevision();
  }

  renderJournal(channel?: OsJournalChannel): string {
    return renderJournalEntries(
      this.journalEntries(channel),
      this.journalDroppedValue,
    );
  }

  renderMessagesLog(): string {
    return renderJournalEntries(
      this.journalRecords.filter(({ channel }) => channel !== "auth"),
      this.journalDroppedValue,
    );
  }

  renderAuthLog(): string {
    return renderJournalEntries(
      this.journalEntries("auth"),
      this.journalDroppedValue,
    );
  }

  procDevicePaths(): readonly string[] {
    const paths = [
      "/proc/devices",
      "/proc/loadavg",
      "/proc/mounts",
      "/proc/services",
    ];
    for (const { pid } of this.processes()) {
      paths.push(
        `/proc/${String(pid)}/cmdline`,
        `/proc/${String(pid)}/stat`,
        `/proc/${String(pid)}/status`,
      );
    }
    return paths.sort();
  }

  readProc(path: string): string | undefined {
    if (path === "/proc/devices") return this.renderProcDevices();
    if (path === "/proc/loadavg") return this.renderProcLoadAverage();
    if (path === "/proc/mounts") return this.renderProcMounts();
    if (path === "/proc/services") return this.renderProcServices();
    const match = /^\/proc\/([1-9][0-9]*)\/(cmdline|stat)$/u.exec(path);
    if (match === null) return undefined;
    const pid = Number(match[1]);
    if (!Number.isSafeInteger(pid) || !this.processRecords.has(pid)) {
      return undefined;
    }
    switch (match[2]) {
      case "cmdline":
        return this.renderProcCmdline(pid);
      case "stat":
        return this.renderProcStat(pid);
      default:
        return undefined;
    }
  }

  renderProcCmdline(pid: number): string {
    const { command } = this.requireProcess(pid);
    const arguments_ = command.trim().split(/\s+/u);
    return `${arguments_.join("\0")}\0`;
  }

  renderProcStat(pid: number): string {
    const process = this.requireProcess(pid);
    const name = processName(process.command).replaceAll(/[()]/gu, "_");
    const state = procStateCode(process.state);
    return `${String(process.pid)} (${name}) ${state} ${String(process.parentPid)} 0 0 0 0 0 0 0 0 0 ${String(process.cpuCycles)} 0 0 0 0 0 0 ${String(process.startTick)} 0 0\n`;
  }

  renderProcStatus(pid: number, memory: OsProcessMemoryObservation): string {
    const process = this.requireProcess(pid);
    const state = `${procStateCode(process.state)} (${process.state})`;
    const lines = [
      `Name:\t${processName(process.command)}`,
      `State:\t${state}`,
      `Pid:\t${String(process.pid)}`,
      `PPid:\t${String(process.parentPid)}`,
      `Uid:\t${String(process.uid)}\t${String(process.uid)}\t${String(process.uid)}\t${String(process.uid)}`,
      `Gid:\t${String(process.gid)}\t${String(process.gid)}\t${String(process.gid)}\t${String(process.gid)}`,
      `VmSize:\t${String(memory.virtualBytes)} B`,
      `VmRSS:\t${String(memory.residentBytes)} B`,
      `CSStartTick:\t${String(process.startTick)}`,
      `CSCycles:\t${String(process.cpuCycles)}`,
    ];
    if (process.waitReason !== undefined) {
      lines.push(`CSWait:\t${process.waitReason}`);
    }
    if (process.exitStatus !== undefined) {
      lines.push(`CSExitStatus:\t${String(process.exitStatus)}`);
    }
    return `${lines.join("\n")}\n`;
  }

  renderProcLoadAverage(): string {
    const active = [...this.processRecords.values()].filter(
      ({ state }) => state !== "zombie",
    );
    const runnable = active.filter(
      ({ state }) => state === "ready" || state === "running",
    ).length;
    const lastPid = Math.max(1, ...this.processRecords.keys());
    return `0.00 0.00 0.00 ${String(runnable)}/${String(active.length)} ${String(lastPid)}\n`;
  }

  renderProcMounts(): string {
    return this.mounts()
      .map((mount) => {
        const options = [
          mount.readOnly ? "ro" : "rw",
          ...mount.options.filter(
            (option) => option !== "ro" && option !== "rw",
          ),
        ];
        return `${mount.source} ${mount.target} ${mount.filesystemType} ${options.join(",")} 0 0\n`;
      })
      .join("");
  }

  renderProcDevices(): string {
    const character = this.devices().filter(
      ({ kind, major }) => kind === "character" && major !== undefined,
    );
    const block = this.devices().filter(
      ({ kind, major }) => kind === "block" && major !== undefined,
    );
    const render = (devices: readonly OsDeviceRecord[]): string =>
      devices
        .map(
          ({ major, path }) =>
            `${String(major).padStart(3)} ${baseName(path)}\n`,
        )
        .join("");
    return `Character devices:\n${render(character)}Block devices:\n${render(block)}`;
  }

  renderProcServices(): string {
    return this.services()
      .map(
        ({ enabled, name, pid, state }) =>
          `${name}\t${state}\t${enabled ? "enabled" : "disabled"}${pid === undefined ? "" : `\t${String(pid)}`}\n`,
      )
      .join("");
  }

  snapshot(): OsRuntimeStateSnapshotV1 {
    return Object.freeze({
      computerId: this.computerId,
      devices: Object.freeze([...this.devices()]),
      jobs: Object.freeze([...this.jobs()]),
      journal: Object.freeze([...this.journalRecords]),
      journalBytes: this.journalBytesValue,
      journalDropped: this.journalDroppedValue,
      lastLogins: Object.freeze(sortedStringValues(this.lastLoginRecords)),
      lifecycle: this.lifecycleValue,
      loginSessions: Object.freeze([...this.loginSessions()]),
      mountDefinitions: Object.freeze([...this.mountDefinitions()]),
      mounts: Object.freeze([...this.mounts()]),
      ...(this.networkStateValue.isEmpty
        ? {}
        : { network: this.networkStateValue.snapshot() }),
      nextJobId: this.nextJobIdValue,
      nextJournalSequence: this.nextJournalSequenceValue,
      nextPid: this.nextPidValue,
      processes: Object.freeze([...this.processes()]),
      revision: this.revisionValue,
      schema: 1,
      services: Object.freeze([...this.services()]),
    });
  }

  /**
   * Returns the canonical disk projection. Volatile owners are deliberately
   * absent, while bounded history and stable boot definitions survive.
   */
  persistentSnapshot(): OsRuntimeStateSnapshotV1 {
    const services = this.services().map<OsServiceRecord>(({ enabled, name }) =>
      Object.freeze({
        changedTick: 0,
        enabled,
        name,
        state: "inactive",
      }),
    );
    const devices = this.devices().map<OsDeviceRecord>((device) =>
      Object.freeze({
        ...device,
        changedTick: 0,
        state: device.state === "absent" ? "absent" : "offline",
      }),
    );
    return Object.freeze({
      computerId: this.computerId,
      devices: Object.freeze(devices),
      jobs: Object.freeze([]),
      journal: Object.freeze([...this.journalRecords]),
      journalBytes: this.journalBytesValue,
      journalDropped: this.journalDroppedValue,
      lastLogins: Object.freeze(sortedStringValues(this.lastLoginRecords)),
      lifecycle: lifecycleState("off", 0),
      loginSessions: Object.freeze([]),
      mountDefinitions: Object.freeze([...this.mountDefinitions()]),
      mounts: Object.freeze([]),
      ...(this.networkStateValue.isEmpty
        ? {}
        : { network: this.networkStateValue.persistentSnapshot() }),
      nextJobId: 1,
      nextJournalSequence: this.nextJournalSequenceValue,
      nextPid: 2,
      processes: Object.freeze([]),
      revision: this.revisionValue,
      schema: 1,
      services: Object.freeze(services),
    });
  }

  private restoreSnapshot(snapshot: unknown): void {
    const root = requireSnapshotRecord(snapshot, "root");
    const schema = root.schema;
    if (schema === undefined || schema === 0) {
      requireOnlyKeys(root, ["schema", "computerId"], "legacy root");
      if (
        root.computerId !== undefined &&
        root.computerId !== this.computerId
      ) {
        throw new OsRuntimeStateSnapshotError("Computer ID does not match");
      }
      return;
    }
    if (schema !== 1) {
      throw new OsRuntimeStateSnapshotError("unsupported schema");
    }
    requireOnlyKeys(
      root,
      [
        "schema",
        "computerId",
        "lifecycle",
        "processes",
        "jobs",
        "loginSessions",
        "lastLogins",
        "services",
        "mountDefinitions",
        "mounts",
        "network",
        "devices",
        "journal",
        "journalBytes",
        "journalDropped",
        "nextPid",
        "nextJobId",
        "nextJournalSequence",
        "revision",
      ],
      "root",
    );
    if (root.computerId !== undefined && root.computerId !== this.computerId) {
      throw new OsRuntimeStateSnapshotError("Computer ID does not match");
    }

    if (root.network !== undefined) {
      try {
        this.networkStateValue = OsNetworkState.restore(
          this.computerId,
          root.network,
          {},
          () => {
            this.bumpRevision();
          },
        );
      } catch (error) {
        throw new OsRuntimeStateSnapshotError(
          error instanceof Error
            ? `network state is invalid: ${error.message}`
            : "network state is invalid",
        );
      }
    }

    this.lifecycleValue = parseLifecycle(root.lifecycle);
    restoreMap(
      this.processRecords,
      root.processes,
      this.limits.maximumProcesses,
      "processes",
      parseProcess,
      ({ pid }) => pid,
      () =>
        new OsRuntimeStateCapacityError(
          "processes",
          this.limits.maximumProcesses,
        ),
    );
    restoreMap(
      this.jobRecords,
      root.jobs,
      this.limits.maximumJobs,
      "jobs",
      parseJob,
      ({ jobId }) => jobId,
      () => new OsRuntimeStateCapacityError("jobs", this.limits.maximumJobs),
    );
    restoreMap(
      this.loginSessionRecords,
      root.loginSessions,
      this.limits.maximumLoginSessions,
      "login sessions",
      parseLoginSession,
      ({ sessionId }) => sessionId,
      () =>
        new OsRuntimeStateCapacityError(
          "login_sessions",
          this.limits.maximumLoginSessions,
        ),
    );
    restoreMap(
      this.lastLoginRecords,
      root.lastLogins,
      this.limits.maximumLastLogins,
      "last logins",
      parseLastLogin,
      ({ username }) => username,
      () =>
        new OsRuntimeStateCapacityError(
          "last_logins",
          this.limits.maximumLastLogins,
        ),
    );
    restoreMap(
      this.serviceRecords,
      root.services,
      this.limits.maximumServices,
      "services",
      parseService,
      ({ name }) => name,
      () =>
        new OsRuntimeStateCapacityError(
          "services",
          this.limits.maximumServices,
        ),
    );
    restoreMap(
      this.mountDefinitionRecords,
      root.mountDefinitions,
      this.limits.maximumMounts,
      "mount definitions",
      parseMountDefinition,
      ({ target }) => target,
      () =>
        new OsRuntimeStateCapacityError("mounts", this.limits.maximumMounts),
    );
    restoreMap(
      this.mountRecords,
      root.mounts,
      this.limits.maximumMounts,
      "mounts",
      parseMount,
      ({ target }) => target,
      () =>
        new OsRuntimeStateCapacityError("mounts", this.limits.maximumMounts),
    );
    for (const mount of this.mountRecords.values()) {
      const definition = mountDefinition(mount);
      const configured = this.mountDefinitionRecords.get(mount.target);
      if (configured === undefined) {
        if (this.mountDefinitionRecords.size >= this.limits.maximumMounts) {
          throw new OsRuntimeStateCapacityError(
            "mounts",
            this.limits.maximumMounts,
          );
        }
        this.mountDefinitionRecords.set(mount.target, definition);
      } else if (!sameMountDefinition(configured, definition)) {
        throw new OsRuntimeStateSnapshotError(
          `active mount ${mount.target} differs from its definition`,
        );
      }
    }
    restoreMap(
      this.deviceRecords,
      root.devices,
      this.limits.maximumDevices,
      "devices",
      parseDevice,
      ({ path }) => path,
      () =>
        new OsRuntimeStateCapacityError("devices", this.limits.maximumDevices),
    );
    this.restoreJournal(root.journal, root.journalBytes, root.journalDropped);

    this.nextPidValue =
      root.nextPid === undefined
        ? nextAvailableCursor(this.processRecords, 2, this.limits.maximumPid)
        : requireIntegerInRange(
            root.nextPid,
            2,
            this.limits.maximumPid,
            "next PID",
          );
    this.nextJobIdValue =
      root.nextJobId === undefined
        ? nextAvailableCursor(this.jobRecords, 1, this.limits.maximumJobs)
        : requireIntegerInRange(
            root.nextJobId,
            1,
            this.limits.maximumJobs,
            "next job ID",
          );
    const lastSequence = this.journalRecords.at(-1)?.sequence ?? 0;
    this.nextJournalSequenceValue =
      root.nextJournalSequence === undefined
        ? lastSequence + 1
        : requireIntegerInRange(
            root.nextJournalSequence,
            lastSequence + 1,
            Number.MAX_SAFE_INTEGER,
            "next journal sequence",
          );
    this.revisionValue = requireNonNegativeSafeInteger(
      root.revision ?? 0,
      "revision",
    );
    this.validateRestoredRelations();
  }

  /**
   * Restores the journal, truncating oldest-first when a snapshot exceeds a
   * cap. A snapshot written before rotation existed, or under a larger limit,
   * must not make its Computer unbootable.
   *
   * The order is load bearing. Every entry is validated first, then the
   * persisted byte total is checked against the full parsed sum, and only then
   * are the oldest records dropped and the retained byte count assigned.
   * Dropping newest instead would invalidate the `nextJournalSequence` lower
   * bound taken from the last retained record.
   */
  private restoreJournal(
    value: unknown,
    byteCount: unknown,
    droppedCount: unknown,
  ): void {
    const candidates =
      value === undefined ? [] : requireSnapshotArray(value, "journal");
    // Truncation recovers a legitimately over-cap snapshot; input this far out
    // of range is malformed rather than rotated, and stays an explicit failure
    // so the parser itself remains bounded.
    if (
      candidates.length >
      this.limits.maximumJournalEntries * maximumRestoredJournalOvershoot
    ) {
      throw new OsRuntimeStateCapacityError(
        "journal_entries",
        this.limits.maximumJournalEntries,
      );
    }
    const parsed: OsJournalEntry[] = [];
    let bytes = 0;
    let lastSequence = 0;
    for (const candidate of candidates) {
      const entry = parseJournalEntry(
        candidate,
        this.limits.maximumJournalEntryBytes,
      );
      if (entry.sequence <= lastSequence) {
        throw new OsRuntimeStateSnapshotError(
          "journal sequences must be strictly increasing",
        );
      }
      lastSequence = entry.sequence;
      bytes += entry.bytes;
      parsed.push(entry);
    }
    if (
      byteCount !== undefined &&
      requireNonNegativeSafeInteger(byteCount, "journal byte count") !== bytes
    ) {
      throw new OsRuntimeStateSnapshotError(
        "journal byte count does not match",
      );
    }
    let dropped =
      droppedCount === undefined
        ? 0
        : requireNonNegativeSafeInteger(droppedCount, "journal dropped count");
    let retained = 0;
    while (
      retained < parsed.length &&
      (parsed.length - retained > this.limits.maximumJournalEntries ||
        bytes > this.limits.maximumJournalBytes)
    ) {
      bytes -= parsed[retained]?.bytes ?? 0;
      retained += 1;
      dropped = saturatingCount(dropped, 1);
    }
    for (let index = retained; index < parsed.length; index += 1) {
      const entry = parsed[index];
      if (entry !== undefined) this.journalRecords.push(entry);
    }
    this.journalBytesValue = bytes;
    this.journalDroppedValue = dropped;
  }

  private validateRestoredRelations(): void {
    for (const process of this.processRecords.values()) {
      if (
        process.parentPid !== 0 &&
        !this.processRecords.has(process.parentPid)
      ) {
        throw new OsRuntimeStateSnapshotError(
          `process ${String(process.pid)} has a missing parent`,
        );
      }
      if (process.pid > this.limits.maximumPid) {
        throw new OsRuntimeStateSnapshotError(
          "process PID exceeds configured range",
        );
      }
    }
    for (const job of this.jobRecords.values()) {
      const process = this.processRecords.get(job.pid);
      if (job.state !== "done" && process === undefined) {
        throw new OsRuntimeStateSnapshotError(
          `job ${String(job.jobId)} has a missing live process`,
        );
      }
      if (job.state === "done" && job.exitStatus === undefined) {
        throw new OsRuntimeStateSnapshotError(
          `completed job ${String(job.jobId)} lacks an exit status`,
        );
      }
    }
    for (const service of this.serviceRecords.values()) {
      if (
        service.pid !== undefined &&
        !this.processRecords.has(service.pid) &&
        service.state !== "failed"
      ) {
        throw new OsRuntimeStateSnapshotError(
          `service ${service.name} has a missing process`,
        );
      }
    }
    if (
      (this.lifecycleValue.phase === "running" ||
        this.lifecycleValue.phase === "booting") &&
      this.lifecycleValue.phase === "running" &&
      this.processRecords.get(1)?.state !== "ready" &&
      this.processRecords.get(1)?.state !== "running"
    ) {
      throw new OsRuntimeStateSnapshotError("running state lacks PID 1");
    }
    if (
      this.lifecycleValue.phase === "off" &&
      (this.processRecords.size > 0 ||
        this.jobRecords.size > 0 ||
        this.loginSessionRecords.size > 0 ||
        this.mountRecords.size > 0)
    ) {
      throw new OsRuntimeStateSnapshotError(
        "off state contains volatile state",
      );
    }
  }

  private allocatePid(): number {
    const pid = nextFreeIdentifier(
      this.processRecords,
      this.nextPidValue,
      2,
      this.limits.maximumPid,
    );
    if (pid === undefined) {
      throw new OsRuntimeStateCapacityError(
        "pid_space",
        this.limits.maximumPid - 1,
      );
    }
    this.nextPidValue = pid === this.limits.maximumPid ? 2 : pid + 1;
    return pid;
  }

  private allocateJobId(): number {
    const jobId = nextFreeIdentifier(
      this.jobRecords,
      this.nextJobIdValue,
      1,
      this.limits.maximumJobs,
    );
    if (jobId === undefined) {
      throw new OsRuntimeStateCapacityError("jobs", this.limits.maximumJobs);
    }
    this.nextJobIdValue = jobId === this.limits.maximumJobs ? 1 : jobId + 1;
    return jobId;
  }

  private synchronizeProcessDependents(
    process: OsProcessRecord,
    event: OsProcessTransition,
  ): void {
    if (process.state === "stopped") {
      for (const [jobId, job] of this.jobRecords) {
        if (job.pid !== process.pid || job.state === "done") continue;
        this.jobRecords.set(
          jobId,
          Object.freeze({
            ...job,
            changedTick: process.changedTick,
            state: "stopped",
          }),
        );
      }
      return;
    }
    if (process.state === "ready" || process.state === "running") {
      for (const [jobId, job] of this.jobRecords) {
        if (job.pid !== process.pid || job.state === "done") continue;
        this.jobRecords.set(
          jobId,
          Object.freeze({
            ...job,
            changedTick: process.changedTick,
            state: "running",
          }),
        );
      }
      return;
    }
    if (process.state !== "zombie" || event.kind !== "exit") return;
    for (const [jobId, job] of this.jobRecords) {
      if (job.pid !== process.pid || job.state === "done") continue;
      this.jobRecords.set(
        jobId,
        Object.freeze({
          ...job,
          changedTick: process.changedTick,
          exitStatus: process.exitStatus,
          state: "done",
        }),
      );
    }
    for (const [name, service] of this.serviceRecords) {
      if (service.pid !== process.pid) continue;
      const expected = event.expected === true || service.state === "stopping";
      this.serviceRecords.set(
        name,
        expected
          ? Object.freeze({
              changedTick: Math.max(service.changedTick, process.changedTick),
              enabled: service.enabled,
              name,
              state: "inactive",
            })
          : Object.freeze({
              changedTick: Math.max(service.changedTick, process.changedTick),
              detail: `process exited with status ${String(process.exitStatus)}`,
              enabled: service.enabled,
              name,
              pid: process.pid,
              state: "failed",
            }),
      );
    }
    const initParent = process.pid !== 1 && this.processRecords.has(1) ? 1 : 0;
    for (const [pid, child] of this.processRecords) {
      if (child.parentPid !== process.pid) continue;
      this.processRecords.set(
        pid,
        Object.freeze({ ...child, parentPid: initParent }),
      );
    }
    if (
      process.pid === 1 &&
      event.expected !== true &&
      this.lifecycleValue.phase !== "stopping" &&
      this.lifecycleValue.phase !== "rebooting"
    ) {
      this.lifecycleValue = lifecycleState(
        "faulted",
        Math.max(this.lifecycleValue.changedTick, process.changedTick),
        this.lifecycleValue.bootTick,
        `PID 1 exited with status ${String(process.exitStatus)}`,
      );
    }
  }

  private clearVolatileState(tick: number): void {
    this.processRecords.clear();
    this.jobRecords.clear();
    this.loginSessionRecords.clear();
    this.mountRecords.clear();
    this.currentRunlevelValue = undefined;
    this.previousRunlevelValue = undefined;
    for (const [name, service] of this.serviceRecords) {
      this.serviceRecords.set(
        name,
        Object.freeze({
          changedTick: Math.max(tick, service.changedTick),
          enabled: service.enabled,
          name,
          state: "inactive",
        }),
      );
    }
    for (const [path, device] of this.deviceRecords) {
      this.deviceRecords.set(
        path,
        Object.freeze({
          ...device,
          changedTick: Math.max(tick, device.changedTick),
          state: device.state === "absent" ? "absent" : "offline",
        }),
      );
    }
  }

  private requireProcess(pid: number): OsProcessRecord {
    requirePid(pid, this.limits.maximumPid);
    const process = this.processRecords.get(pid);
    if (process === undefined) {
      throw new OsRuntimeStateTransitionError(
        `process ${String(pid)}`,
        "does not exist",
      );
    }
    return process;
  }

  private requireJob(jobId: number): OsJobRecord {
    requireJobId(jobId, this.limits.maximumJobs);
    const job = this.jobRecords.get(jobId);
    if (job === undefined) {
      throw new OsRuntimeStateTransitionError(
        `job ${String(jobId)}`,
        "does not exist",
      );
    }
    return job;
  }

  private requireLoginSession(sessionId: string): OsLoginSessionRecord {
    requireBoundedString("login session ID", sessionId, maximumNameBytes);
    const session = this.loginSessionRecords.get(sessionId);
    if (session === undefined) {
      throw new OsRuntimeStateTransitionError(
        `login session ${sessionId}`,
        "does not exist",
      );
    }
    return session;
  }

  private requireService(name: string): OsServiceRecord {
    validateServiceName(name);
    const service = this.serviceRecords.get(name);
    if (service === undefined) {
      throw new OsRuntimeStateTransitionError(
        `service ${name}`,
        "does not exist",
      );
    }
    return service;
  }

  private requireDevice(path: string): OsDeviceRecord {
    const normalized = requireDevicePath(path);
    const device = this.deviceRecords.get(normalized);
    if (device === undefined) {
      throw new OsRuntimeStateTransitionError(
        `device ${normalized}`,
        "does not exist",
      );
    }
    return device;
  }

  private requireLifecycle(
    expected: OsLifecyclePhase,
    operation: string,
  ): void {
    if (this.lifecycleValue.phase !== expected)
      this.invalidLifecycle(operation);
  }

  private requirePresencePhase(operation: string): void {
    if (
      this.lifecycleValue.phase !== "booting" &&
      this.lifecycleValue.phase !== "running"
    ) {
      this.invalidLifecycle(operation);
    }
  }

  private invalidLifecycle(operation: string): never {
    throw new OsRuntimeStateTransitionError(
      "lifecycle",
      `${operation} is invalid while ${this.lifecycleValue.phase}`,
    );
  }

  private invalidServiceTransition(
    service: OsServiceRecord,
    event: string,
  ): never {
    throw new OsRuntimeStateTransitionError(
      `service ${service.name}`,
      `${event} is invalid while ${service.state}`,
    );
  }

  private requireMapCapacity<K, V>(
    map: ReadonlyMap<K, V>,
    maximum: number,
    resource: OsRuntimeCapacity,
  ): void {
    if (map.size >= maximum) {
      throw new OsRuntimeStateCapacityError(resource, maximum);
    }
  }

  private bumpRevision(): void {
    this.revisionValue =
      this.revisionValue === Number.MAX_SAFE_INTEGER
        ? 1
        : this.revisionValue + 1;
  }
}

/**
 * Renders journal lines, preceded by the rotation notice when records were
 * dropped. A rendered line carries no sequence number, so the count is the
 * only way a reader can tell that earlier records existed.
 */
function renderJournalEntries(
  entries: readonly OsJournalEntry[],
  dropped: number,
): string {
  const notice =
    dropped > 0
      ? `-- ${String(dropped)} earlier record(s) dropped by journal rotation --\n`
      : "";
  return (
    notice +
    entries
      .map(
        ({ channel, message, severity, tick }) =>
          `[${String(tick).padStart(10)}] ${channel}.${severity}: ${message}\n`,
      )
      .join("")
  );
}

/** Adds bounded counts without ever reporting an unsafe integer. */
function saturatingCount(current: number, added: number): number {
  return current > Number.MAX_SAFE_INTEGER - added
    ? Number.MAX_SAFE_INTEGER
    : current + added;
}

function normalizeLimits(
  overrides: Partial<OsRuntimeStateLimits>,
): OsRuntimeStateLimits {
  const limits = { ...defaultOsRuntimeStateLimits, ...overrides };
  for (const [name, value] of Object.entries(limits)) {
    requirePositiveSafeInteger(value, name);
  }
  if (limits.maximumPid < 2) {
    throw new RangeError(
      "maximumPid must reserve PID 1 and at least one dynamic PID",
    );
  }
  if (limits.maximumProcesses > limits.maximumPid) {
    throw new RangeError("maximumProcesses cannot exceed the PID space");
  }
  if (limits.maximumJournalEntryBytes > limits.maximumJournalBytes) {
    throw new RangeError(
      "maximumJournalEntryBytes cannot exceed maximumJournalBytes",
    );
  }
  return Object.freeze(limits);
}

function lifecycleState(
  phase: OsLifecyclePhase,
  changedTick: number,
  bootTick?: number,
  reason?: string,
): OsLifecycleState {
  return Object.freeze({
    ...(bootTick === undefined ? {} : { bootTick }),
    changedTick,
    phase,
    ...(reason === undefined
      ? {}
      : {
          reason: requireBoundedString(
            "lifecycle reason",
            reason,
            maximumReasonBytes,
          ),
        }),
  });
}

function createProcessRecord(
  pid: number,
  input: OsProcessSpawn,
): OsProcessRecord {
  validateProcessSpawn(input);
  requirePid(pid, Number.MAX_SAFE_INTEGER);
  const state = input.state ?? "ready";
  return Object.freeze({
    changedTick: input.startTick,
    command: requireBoundedString(
      "process command",
      input.command,
      maximumCommandBytes,
    ),
    cpuCycles: 0,
    gid: input.gid,
    niceValue: input.niceValue ?? 0,
    parentPid: input.parentPid,
    pid,
    processGroupId: input.processGroupId ?? pid,
    startTick: input.startTick,
    state,
    uid: input.uid,
  });
}

function validateProcessSpawn(input: OsProcessSpawn): void {
  requirePidOrKernel(input.parentPid);
  if (input.processGroupId !== undefined) {
    requirePid(input.processGroupId, Number.MAX_SAFE_INTEGER);
  }
  requireIdentityId(input.uid, "process UID");
  requireIdentityId(input.gid, "process GID");
  if (
    input.niceValue !== undefined &&
    (!Number.isSafeInteger(input.niceValue) ||
      input.niceValue < -20 ||
      input.niceValue > 19)
  ) {
    throw new RangeError(
      "process nice value must be an integer from -20 to 19",
    );
  }
  requireTick(input.startTick, "process start tick");
  requireBoundedString("process command", input.command, maximumCommandBytes);
  if (
    input.state !== undefined &&
    input.state !== "ready" &&
    input.state !== "running"
  ) {
    throw new RangeError("new process state must be ready or running");
  }
}

function processState(
  process: OsProcessRecord,
  state: Exclude<OsProcessState, "zombie">,
  tick: number,
  waitReason?: string,
): OsProcessRecord {
  const requiresReason =
    state === "sleeping" || state === "waiting" || state === "stopped";
  return Object.freeze({
    ...process,
    changedTick: tick,
    exitStatus: undefined,
    state,
    waitReason: requiresReason
      ? requireBoundedString(
          "process wait reason",
          waitReason ?? "",
          maximumReasonBytes,
        )
      : undefined,
  });
}

function requireParentProcess(
  processes: ReadonlyMap<number, OsProcessRecord>,
  parentPid: number,
): void {
  requirePidOrKernel(parentPid);
  if (parentPid === 0) return;
  const parent = processes.get(parentPid);
  if (parent === undefined || parent.state === "zombie") {
    throw new OsRuntimeStateTransitionError(
      "process parent",
      `PID ${String(parentPid)} is not live`,
    );
  }
}

function validateLoginSessionInput(input: OsLoginSessionOpen): void {
  requireBoundedString("login session ID", input.sessionId, maximumNameBytes);
  requireBoundedString("username", input.username, maximumNameBytes);
  requireBoundedString("terminal", input.terminal, maximumNameBytes);
  if (input.remote !== undefined) {
    requireBoundedString("remote", input.remote, maximumPathBytes);
  }
  requireIdentityId(input.uid, "login UID");
  requireIdentityId(input.gid, "login GID");
  requireTick(input.tick, "login tick");
}

function validateServiceName(name: string): string {
  const value = requireBoundedString("service name", name, maximumNameBytes);
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/u.test(value)) {
    throw new RangeError(`invalid service name: ${name}`);
  }
  return value;
}

const runlevelCharacters = new Set(["0", "1", "2", "3", "4", "5", "6", "S"]);

function validateRunlevelCharacter(value: string): string {
  if (!runlevelCharacters.has(value)) {
    throw new RangeError(`invalid runlevel: ${value}`);
  }
  return value;
}

function validateMount(input: OsMountRegistration): OsMountRecord {
  requireTick(input.mountedTick, "mount tick");
  const definition = validateMountDefinition(input);
  return Object.freeze({ ...definition, mountedTick: input.mountedTick });
}

function validateMountDefinition(input: OsMountDefinition): OsMountDefinition {
  if (input.options.length > maximumMountOptions) {
    throw new RangeError(
      `mount options exceed ${String(maximumMountOptions)} entries`,
    );
  }
  const options = Object.freeze(
    input.options.map((option) => {
      const value = requireBoundedString(
        "mount option",
        option,
        maximumNameBytes,
      );
      if (/,|\s/u.test(value)) throw new RangeError("invalid mount option");
      return value;
    }),
  );
  return Object.freeze({
    filesystemType: requireBoundedString(
      "filesystem type",
      input.filesystemType,
      maximumNameBytes,
    ),
    options,
    readOnly: input.readOnly,
    source: requireBoundedString(
      "mount source",
      input.source,
      maximumPathBytes,
    ),
    target: requireAbsolutePath("mount target", input.target),
  });
}

function mountDefinition(mount: OsMountRecord): OsMountDefinition {
  return Object.freeze({
    filesystemType: mount.filesystemType,
    options: mount.options,
    readOnly: mount.readOnly,
    source: mount.source,
    target: mount.target,
  });
}

function sameMountDefinition(
  left: OsMountDefinition,
  right: OsMountDefinition,
): boolean {
  return (
    left.filesystemType === right.filesystemType &&
    left.readOnly === right.readOnly &&
    left.source === right.source &&
    left.target === right.target &&
    left.options.length === right.options.length &&
    left.options.every((option, index) => option === right.options[index])
  );
}

function validateDevice(input: OsDeviceRegistration): OsDeviceRecord {
  requireTick(input.tick, "device registration tick");
  if ((input.major === undefined) !== (input.minor === undefined)) {
    throw new RangeError("device major and minor must be provided together");
  }
  if (input.kind !== "virtual" && input.major === undefined) {
    throw new RangeError("block and character devices require major and minor");
  }
  if (input.major !== undefined)
    requireDeviceNumber(input.major, "device major");
  if (input.minor !== undefined)
    requireDeviceNumber(input.minor, "device minor");
  return Object.freeze({
    changedTick: input.tick,
    ...(input.driver === undefined
      ? {}
      : {
          driver: requireBoundedString(
            "device driver",
            input.driver,
            maximumNameBytes,
          ),
        }),
    kind: input.kind,
    ...(input.major === undefined ? {} : { major: input.major }),
    ...(input.minor === undefined ? {} : { minor: input.minor }),
    path: requireDevicePath(input.path),
    readOnly: input.readOnly ?? false,
    state: input.state,
  });
}

function nextFreeIdentifier<T>(
  records: ReadonlyMap<number, T>,
  cursor: number,
  minimum: number,
  maximum: number,
): number | undefined {
  const range = maximum - minimum + 1;
  for (let offset = 0; offset < range; offset += 1) {
    const candidate = minimum + ((cursor - minimum + offset) % range);
    if (!records.has(candidate)) return candidate;
  }
  return undefined;
}

function nextAvailableCursor<T>(
  records: ReadonlyMap<number, T>,
  minimum: number,
  maximum: number,
): number {
  return nextFreeIdentifier(records, minimum, minimum, maximum) ?? minimum;
}

function sortedNumericValues<T>(map: ReadonlyMap<number, T>): readonly T[] {
  return [...map]
    .sort(([left], [right]) => left - right)
    .map(([, value]) => value);
}

function sortedStringValues<T>(map: ReadonlyMap<string, T>): readonly T[] {
  return [...map]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, value]) => value);
}

function procStateCode(state: OsProcessState): string {
  switch (state) {
    case "ready":
    case "running":
      return "R";
    case "sleeping":
    case "waiting":
      return "S";
    case "stopped":
      return "T";
    case "zombie":
      return "Z";
  }
}

function processName(command: string): string {
  return command.trim().split(/\s+/u)[0] ?? "unknown";
}

function baseName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

function requireBoundedString(
  label: string,
  value: string,
  maximumBytes: number,
): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  if (utf8ByteLength(value) > maximumBytes) {
    throw new RangeError(
      `${label} exceeds ${String(maximumBytes)} UTF-8 bytes`,
    );
  }
  return value;
}

function requireAbsolutePath(label: string, value: string): string {
  const path = requireBoundedString(label, value, maximumPathBytes);
  if (!path.startsWith("/") || path.includes("\0")) {
    throw new RangeError(`${label} must be an absolute guest path`);
  }
  return path;
}

function requireDevicePath(value: string): string {
  const path = requireAbsolutePath("device path", value);
  if (!path.startsWith("/dev/")) {
    throw new RangeError("device path must be below /dev");
  }
  return path;
}

function requireTick(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative safe integer`);
  }
  return value;
}

function requireWallMilliseconds(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative safe integer`);
  }
  return value;
}

function requirePid(value: number, maximum: number): number {
  return requireIntegerInRange(value, 1, maximum, "PID");
}

function requirePidOrKernel(value: number): number {
  return requireIntegerInRange(value, 0, Number.MAX_SAFE_INTEGER, "parent PID");
}

function requireJobId(value: number, maximum: number): number {
  return requireIntegerInRange(value, 1, maximum, "job ID");
}

function requireIdentityId(value: number, label: string): number {
  return requireIntegerInRange(value, 0, 65_535, label);
}

function requireDeviceNumber(value: number, label: string): number {
  return requireIntegerInRange(value, 0, 4_095, label);
}

function requireExitStatus(value: number): number {
  return requireIntegerInRange(value, 0, 255, "exit status");
}

function requirePositiveSafeInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError(`${label} must be a positive safe integer`);
  }
  return value;
}

function requireNonNegativeSafeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new OsRuntimeStateSnapshotError(
      `${label} must be a non-negative safe integer`,
    );
  }
  return value as number;
}

function requireIntegerInRange(
  value: unknown,
  minimum: number,
  maximum: number,
  label: string,
): number {
  if (
    !Number.isSafeInteger(value) ||
    (value as number) < minimum ||
    (value as number) > maximum
  ) {
    throw new RangeError(
      `${label} must be an integer from ${String(minimum)} to ${String(maximum)}`,
    );
  }
  return value as number;
}

function requireJournalChannel(
  value: unknown,
): asserts value is OsJournalChannel {
  if (value !== "auth" && value !== "boot" && value !== "system") {
    throw new RangeError("invalid journal channel");
  }
}

function requireJournalSeverity(
  value: unknown,
): asserts value is OsJournalSeverity {
  if (
    value !== "debug" &&
    value !== "info" &&
    value !== "notice" &&
    value !== "warning" &&
    value !== "error" &&
    value !== "critical"
  ) {
    throw new RangeError("invalid journal severity");
  }
}

function requireSnapshotRecord(
  value: unknown,
  label: string,
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new OsRuntimeStateSnapshotError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function requireSnapshotArray(
  value: unknown,
  label: string,
): readonly unknown[] {
  if (!Array.isArray(value)) {
    throw new OsRuntimeStateSnapshotError(`${label} must be an array`);
  }
  return value;
}

function requireOnlyKeys(
  value: Readonly<Record<string, unknown>>,
  allowed: readonly string[],
  label: string,
): void {
  const keys = new Set(allowed);
  if (Object.keys(value).some((key) => !keys.has(key))) {
    throw new OsRuntimeStateSnapshotError(`${label} contains unknown fields`);
  }
}

function restoreMap<K, T>(
  destination: Map<K, T>,
  value: unknown,
  maximum: number,
  label: string,
  parse: (candidate: unknown) => T,
  keyOf: (record: T) => K,
  capacityError: () => Error,
): void {
  const records = value === undefined ? [] : requireSnapshotArray(value, label);
  if (records.length > maximum) throw capacityError();
  for (const candidate of records) {
    const record = parse(candidate);
    const key = keyOf(record);
    if (destination.has(key)) {
      throw new OsRuntimeStateSnapshotError(`${label} contains duplicate keys`);
    }
    destination.set(key, record);
  }
}

function parseLifecycle(value: unknown): OsLifecycleState {
  if (value === undefined) return lifecycleState("off", 0);
  const record = requireSnapshotRecord(value, "lifecycle");
  requireOnlyKeys(
    record,
    ["phase", "changedTick", "bootTick", "reason"],
    "lifecycle",
  );
  if (
    record.phase !== "off" &&
    record.phase !== "booting" &&
    record.phase !== "running" &&
    record.phase !== "stopping" &&
    record.phase !== "rebooting" &&
    record.phase !== "faulted"
  ) {
    throw new OsRuntimeStateSnapshotError("invalid lifecycle phase");
  }
  const changedTick = requireNonNegativeSafeInteger(
    record.changedTick ?? 0,
    "lifecycle changed tick",
  );
  const bootTick =
    record.bootTick === undefined
      ? undefined
      : requireNonNegativeSafeInteger(record.bootTick, "lifecycle boot tick");
  if (bootTick !== undefined && bootTick > changedTick) {
    throw new OsRuntimeStateSnapshotError(
      "lifecycle boot tick is in the future",
    );
  }
  if (record.phase === "off" && bootTick !== undefined) {
    throw new OsRuntimeStateSnapshotError(
      "off lifecycle cannot have a boot tick",
    );
  }
  const reason =
    record.reason === undefined
      ? undefined
      : requireSnapshotString(
          record.reason,
          "lifecycle reason",
          maximumReasonBytes,
        );
  return lifecycleState(record.phase, changedTick, bootTick, reason);
}

function parseProcess(value: unknown): OsProcessRecord {
  const record = requireSnapshotRecord(value, "process");
  requireOnlyKeys(
    record,
    [
      "pid",
      "parentPid",
      "processGroupId",
      "uid",
      "gid",
      "command",
      "startTick",
      "changedTick",
      "state",
      "waitReason",
      "exitStatus",
      "cpuCycles",
      "lastSignal",
      "niceValue",
    ],
    "process",
  );
  const pid = requireIntegerInRange(
    record.pid,
    1,
    Number.MAX_SAFE_INTEGER,
    "PID",
  );
  const state = record.state;
  if (
    state !== "ready" &&
    state !== "running" &&
    state !== "sleeping" &&
    state !== "waiting" &&
    state !== "stopped" &&
    state !== "zombie"
  ) {
    throw new OsRuntimeStateSnapshotError("invalid process state");
  }
  const startTick = requireNonNegativeSafeInteger(
    record.startTick,
    "process start tick",
  );
  const changedTick = requireNonNegativeSafeInteger(
    record.changedTick ?? startTick,
    "process changed tick",
  );
  if (changedTick < startTick) {
    throw new OsRuntimeStateSnapshotError("process changed before it started");
  }
  const waitReason =
    record.waitReason === undefined
      ? undefined
      : requireSnapshotString(
          record.waitReason,
          "process wait reason",
          maximumReasonBytes,
        );
  const exitStatus =
    record.exitStatus === undefined
      ? undefined
      : requireIntegerInRange(record.exitStatus, 0, 255, "exit status");
  const waiting =
    state === "sleeping" || state === "waiting" || state === "stopped";
  if (waiting !== (waitReason !== undefined)) {
    throw new OsRuntimeStateSnapshotError(
      "process wait reason does not match state",
    );
  }
  if ((state === "zombie") !== (exitStatus !== undefined)) {
    throw new OsRuntimeStateSnapshotError(
      "process exit status does not match state",
    );
  }
  if (record.lastSignal !== undefined && !isProcessSignal(record.lastSignal)) {
    throw new OsRuntimeStateSnapshotError("invalid process signal");
  }
  return Object.freeze({
    changedTick,
    command: requireSnapshotString(
      record.command,
      "process command",
      maximumCommandBytes,
    ),
    cpuCycles: requireNonNegativeSafeInteger(
      record.cpuCycles ?? 0,
      "process CPU cycles",
    ),
    ...(exitStatus === undefined ? {} : { exitStatus }),
    gid: requireIntegerInRange(record.gid, 0, 65_535, "process GID"),
    ...(record.lastSignal === undefined
      ? {}
      : { lastSignal: record.lastSignal }),
    parentPid: requireIntegerInRange(
      record.parentPid,
      0,
      Number.MAX_SAFE_INTEGER,
      "parent PID",
    ),
    niceValue: requireIntegerInRange(
      record.niceValue ?? 0,
      -20,
      19,
      "process nice value",
    ),
    pid,
    processGroupId:
      record.processGroupId === undefined
        ? pid
        : requireIntegerInRange(
            record.processGroupId,
            1,
            Number.MAX_SAFE_INTEGER,
            "process group ID",
          ),
    startTick,
    state,
    uid: requireIntegerInRange(record.uid, 0, 65_535, "process UID"),
    ...(waitReason === undefined ? {} : { waitReason }),
  });
}

function parseJob(value: unknown): OsJobRecord {
  const record = requireSnapshotRecord(value, "job");
  requireOnlyKeys(
    record,
    ["jobId", "pid", "uid", "command", "state", "changedTick", "exitStatus"],
    "job",
  );
  if (
    record.state !== "running" &&
    record.state !== "stopped" &&
    record.state !== "done"
  ) {
    throw new OsRuntimeStateSnapshotError("invalid job state");
  }
  const exitStatus =
    record.exitStatus === undefined
      ? undefined
      : requireIntegerInRange(record.exitStatus, 0, 255, "job exit status");
  if ((record.state === "done") !== (exitStatus !== undefined)) {
    throw new OsRuntimeStateSnapshotError(
      "job exit status does not match state",
    );
  }
  return Object.freeze({
    changedTick: requireNonNegativeSafeInteger(
      record.changedTick ?? 0,
      "job changed tick",
    ),
    command: requireSnapshotString(
      record.command,
      "job command",
      maximumCommandBytes,
    ),
    ...(exitStatus === undefined ? {} : { exitStatus }),
    jobId: requireIntegerInRange(
      record.jobId,
      1,
      Number.MAX_SAFE_INTEGER,
      "job ID",
    ),
    pid: requireIntegerInRange(
      record.pid,
      1,
      Number.MAX_SAFE_INTEGER,
      "job PID",
    ),
    state: record.state,
    uid: requireIntegerInRange(record.uid, 0, 65_535, "job UID"),
  });
}

function parseLoginSession(value: unknown): OsLoginSessionRecord {
  const record = requireSnapshotRecord(value, "login session");
  requireOnlyKeys(
    record,
    [
      "sessionId",
      "username",
      "uid",
      "gid",
      "terminal",
      "remote",
      "loginTick",
      "loginWallMilliseconds",
      "lastActivityTick",
    ],
    "login session",
  );
  const loginTick = requireNonNegativeSafeInteger(
    record.loginTick,
    "login tick",
  );
  const lastActivityTick = requireNonNegativeSafeInteger(
    record.lastActivityTick ?? loginTick,
    "last activity tick",
  );
  if (lastActivityTick < loginTick) {
    throw new OsRuntimeStateSnapshotError("login activity predates login");
  }
  return Object.freeze({
    gid: requireIntegerInRange(record.gid, 0, 65_535, "login GID"),
    lastActivityTick,
    loginTick,
    ...(record.loginWallMilliseconds === undefined
      ? {}
      : {
          loginWallMilliseconds: requireNonNegativeSafeInteger(
            record.loginWallMilliseconds,
            "login wall time",
          ),
        }),
    ...(record.remote === undefined
      ? {}
      : {
          remote: requireSnapshotString(
            record.remote,
            "remote",
            maximumPathBytes,
          ),
        }),
    sessionId: requireSnapshotString(
      record.sessionId,
      "session ID",
      maximumNameBytes,
    ),
    terminal: requireSnapshotString(
      record.terminal,
      "terminal",
      maximumNameBytes,
    ),
    uid: requireIntegerInRange(record.uid, 0, 65_535, "login UID"),
    username: requireSnapshotString(
      record.username,
      "username",
      maximumNameBytes,
    ),
  });
}

function parseLastLogin(value: unknown): OsLastLoginRecord {
  const record = requireSnapshotRecord(value, "last login");
  requireOnlyKeys(
    record,
    [
      "username",
      "uid",
      "gid",
      "terminal",
      "remote",
      "loginTick",
      "loginWallMilliseconds",
      "logoutTick",
      "logoutWallMilliseconds",
      "logoutReason",
    ],
    "last login",
  );
  const loginTick = requireNonNegativeSafeInteger(
    record.loginTick,
    "last login tick",
  );
  const logoutTick =
    record.logoutTick === undefined
      ? undefined
      : requireNonNegativeSafeInteger(record.logoutTick, "logout tick");
  if (logoutTick !== undefined && logoutTick < loginTick) {
    throw new OsRuntimeStateSnapshotError("logout predates login");
  }
  if ((logoutTick === undefined) !== (record.logoutReason === undefined)) {
    throw new OsRuntimeStateSnapshotError(
      "logout tick and reason must be paired",
    );
  }
  return Object.freeze({
    gid: requireIntegerInRange(record.gid, 0, 65_535, "last login GID"),
    loginTick,
    ...(record.loginWallMilliseconds === undefined
      ? {}
      : {
          loginWallMilliseconds: requireNonNegativeSafeInteger(
            record.loginWallMilliseconds,
            "last login wall time",
          ),
        }),
    ...(record.logoutReason === undefined
      ? {}
      : {
          logoutReason: requireSnapshotString(
            record.logoutReason,
            "logout reason",
            maximumReasonBytes,
          ),
        }),
    ...(logoutTick === undefined ? {} : { logoutTick }),
    ...(record.logoutWallMilliseconds === undefined
      ? {}
      : {
          logoutWallMilliseconds: requireNonNegativeSafeInteger(
            record.logoutWallMilliseconds,
            "logout wall time",
          ),
        }),
    ...(record.remote === undefined
      ? {}
      : {
          remote: requireSnapshotString(
            record.remote,
            "remote",
            maximumPathBytes,
          ),
        }),
    terminal: requireSnapshotString(
      record.terminal,
      "terminal",
      maximumNameBytes,
    ),
    uid: requireIntegerInRange(record.uid, 0, 65_535, "last login UID"),
    username: requireSnapshotString(
      record.username,
      "username",
      maximumNameBytes,
    ),
  });
}

function parseService(value: unknown): OsServiceRecord {
  const record = requireSnapshotRecord(value, "service");
  requireOnlyKeys(
    record,
    ["name", "enabled", "state", "pid", "detail", "changedTick"],
    "service",
  );
  if (
    record.state !== "inactive" &&
    record.state !== "starting" &&
    record.state !== "running" &&
    record.state !== "stopping" &&
    record.state !== "failed"
  ) {
    throw new OsRuntimeStateSnapshotError("invalid service state");
  }
  if (typeof record.enabled !== "boolean") {
    throw new OsRuntimeStateSnapshotError("service enabled must be boolean");
  }
  if (record.state === "failed" && record.detail === undefined) {
    throw new OsRuntimeStateSnapshotError("failed service lacks detail");
  }
  return Object.freeze({
    changedTick: requireNonNegativeSafeInteger(
      record.changedTick ?? 0,
      "service changed tick",
    ),
    ...(record.detail === undefined
      ? {}
      : {
          detail: requireSnapshotString(
            record.detail,
            "service detail",
            maximumReasonBytes,
          ),
        }),
    enabled: record.enabled,
    name: validateServiceName(
      requireSnapshotString(record.name, "service name", maximumNameBytes),
    ),
    ...(record.pid === undefined
      ? {}
      : {
          pid: requireIntegerInRange(
            record.pid,
            1,
            Number.MAX_SAFE_INTEGER,
            "service PID",
          ),
        }),
    state: record.state,
  });
}

function parseMountDefinition(value: unknown): OsMountDefinition {
  const record = requireSnapshotRecord(value, "mount definition");
  requireOnlyKeys(
    record,
    ["source", "target", "filesystemType", "options", "readOnly"],
    "mount definition",
  );
  if (typeof record.readOnly !== "boolean") {
    throw new OsRuntimeStateSnapshotError(
      "mount definition readOnly must be boolean",
    );
  }
  const options = requireSnapshotArray(
    record.options ?? [],
    "mount definition options",
  ).map((option) =>
    requireSnapshotString(option, "mount option", maximumNameBytes),
  );
  return validateMountDefinition({
    filesystemType: requireSnapshotString(
      record.filesystemType,
      "filesystem type",
      maximumNameBytes,
    ),
    options,
    readOnly: record.readOnly,
    source: requireSnapshotString(
      record.source,
      "mount source",
      maximumPathBytes,
    ),
    target: requireSnapshotString(
      record.target,
      "mount target",
      maximumPathBytes,
    ),
  });
}

function parseMount(value: unknown): OsMountRecord {
  const record = requireSnapshotRecord(value, "mount");
  requireOnlyKeys(
    record,
    [
      "source",
      "target",
      "filesystemType",
      "options",
      "readOnly",
      "mountedTick",
    ],
    "mount",
  );
  if (typeof record.readOnly !== "boolean") {
    throw new OsRuntimeStateSnapshotError("mount readOnly must be boolean");
  }
  const definition = parseMountDefinition({
    filesystemType: record.filesystemType,
    options: record.options ?? [],
    readOnly: record.readOnly,
    source: record.source,
    target: record.target,
  });
  return validateMount({
    ...definition,
    mountedTick: requireNonNegativeSafeInteger(
      record.mountedTick,
      "mount tick",
    ),
  });
}

function parseDevice(value: unknown): OsDeviceRecord {
  const record = requireSnapshotRecord(value, "device");
  requireOnlyKeys(
    record,
    [
      "path",
      "kind",
      "state",
      "major",
      "minor",
      "driver",
      "readOnly",
      "changedTick",
    ],
    "device",
  );
  if (
    record.kind !== "block" &&
    record.kind !== "character" &&
    record.kind !== "virtual"
  ) {
    throw new OsRuntimeStateSnapshotError("invalid device kind");
  }
  if (
    record.state !== "absent" &&
    record.state !== "available" &&
    record.state !== "offline"
  ) {
    throw new OsRuntimeStateSnapshotError("invalid device state");
  }
  if (typeof record.readOnly !== "boolean") {
    throw new OsRuntimeStateSnapshotError("device readOnly must be boolean");
  }
  return validateDevice({
    ...(record.driver === undefined
      ? {}
      : {
          driver: requireSnapshotString(
            record.driver,
            "device driver",
            maximumNameBytes,
          ),
        }),
    kind: record.kind,
    ...(record.major === undefined
      ? {}
      : {
          major: requireIntegerInRange(record.major, 0, 4_095, "device major"),
        }),
    ...(record.minor === undefined
      ? {}
      : {
          minor: requireIntegerInRange(record.minor, 0, 4_095, "device minor"),
        }),
    path: requireSnapshotString(record.path, "device path", maximumPathBytes),
    readOnly: record.readOnly,
    state: record.state,
    tick: requireNonNegativeSafeInteger(
      record.changedTick ?? 0,
      "device changed tick",
    ),
  });
}

function parseJournalEntry(
  value: unknown,
  maximumBytes: number,
): OsJournalEntry {
  const record = requireSnapshotRecord(value, "journal entry");
  requireOnlyKeys(
    record,
    ["sequence", "channel", "severity", "tick", "message", "bytes"],
    "journal entry",
  );
  requireJournalChannel(record.channel);
  requireJournalSeverity(record.severity);
  const message = requireSnapshotString(
    record.message,
    "journal message",
    maximumBytes,
  );
  if (/\r|\n/u.test(message)) {
    throw new OsRuntimeStateSnapshotError(
      "journal entry contains multiple lines",
    );
  }
  const bytes = utf8ByteLength(message);
  if (
    record.bytes !== undefined &&
    requireNonNegativeSafeInteger(record.bytes, "journal entry bytes") !== bytes
  ) {
    throw new OsRuntimeStateSnapshotError(
      "journal entry byte count does not match",
    );
  }
  return Object.freeze({
    bytes,
    channel: record.channel,
    message,
    sequence: requireIntegerInRange(
      record.sequence,
      1,
      Number.MAX_SAFE_INTEGER,
      "journal sequence",
    ),
    severity: record.severity,
    tick: requireNonNegativeSafeInteger(record.tick, "journal tick"),
  });
}

function requireSnapshotString(
  value: unknown,
  label: string,
  maximumBytes: number,
): string {
  if (typeof value !== "string") {
    throw new OsRuntimeStateSnapshotError(`${label} must be a string`);
  }
  try {
    return requireBoundedString(label, value, maximumBytes);
  } catch (error: unknown) {
    throw new OsRuntimeStateSnapshotError(
      error instanceof Error ? error.message : String(error),
    );
  }
}

function isProcessSignal(value: unknown): value is OsProcessSignal {
  return (
    value === "SIGHUP" ||
    value === "SIGINT" ||
    value === "SIGKILL" ||
    value === "SIGSTOP" ||
    value === "SIGCONT" ||
    value === "SIGTERM"
  );
}
