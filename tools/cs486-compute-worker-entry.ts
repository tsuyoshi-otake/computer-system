import { parentPort, workerData } from "node:worker_threads";

import {
  Cs486Fault,
  Cs486Process,
  defaultCs486StackBytes,
  maximumCs486LinearAddressSpaceBytes,
  type Cs486Executable,
  type Cs486ProcessImageInitialization,
} from "../src/domain/cpu/cs486.js";
import { isCpuModel, type CpuModel } from "../src/domain/cpu/models.js";
import { isTerminalCpuProcessState } from "../src/domain/runtime/cpuProcess.js";
import { VmRuntimeError } from "../src/domain/runtime/errors.js";

const protocolVersion = 1;
const maximumProcessesPerWorker = 128;
const maximumInstructionsPerSlice = 1_650_000;
const maximumCpuCyclesPerSlice = 100_000_000;
const maximumOutputCharacters = 64_000;
const maximumReasonCharacters = 256;
const maximumFailureMessageCharacters = 500;
const maximumErrorMessageCharacters = 2_000;
const maximumIdentifierCharacters = 64;
const maximumRequestIdCharacters = 128;
const maximumProcessImageBytes = 32 * 1_024;
const maximumProcessImageEntries = 32;
const zeroMicroarchitectureStats = Object.freeze({
  busTransfers: 0,
  instructionFetches: 0,
  l1Hits: 0,
  l1Misses: 0,
  l2Hits: 0,
  l2Misses: 0,
  pipelineFlushes: 0,
  unalignedAccesses: 0,
});

type CommandName = "create" | "dispose" | "fail" | "slice" | "terminate";

interface WorkerConfiguration {
  readonly protocolVersion: 1;
  readonly workerCount: number;
  readonly workerIndex: number;
}

interface RequestEnvelope {
  readonly command: unknown;
  readonly correlationId: number;
  readonly protocolVersion: 1;
  readonly type: "request";
}

interface CommonCommand {
  readonly command: CommandName;
  readonly computerId: string;
  readonly processId: string;
  readonly protocolVersion: 1;
  readonly requestId: string;
}

interface CreateCommand extends CommonCommand {
  readonly command: "create";
  readonly executable: Cs486Executable;
  readonly options: {
    readonly collectMicroarchitectureStats: boolean;
    readonly cpuModel: CpuModel;
    readonly memoryBytes: number;
    readonly processImage?: Cs486ProcessImageInitialization;
  };
}

interface SliceCommand extends CommonCommand {
  readonly command: "slice";
  readonly cpuCycleBudget: number;
  readonly instructionBudget: number;
  readonly tick: number;
}

interface DisposeCommand extends CommonCommand {
  readonly command: "dispose";
}

interface TerminateCommand extends CommonCommand {
  readonly command: "terminate";
  readonly reason: string;
}

interface FailCommand extends CommonCommand {
  readonly command: "fail";
  readonly error: {
    readonly message: string;
    readonly typeName: string;
  };
}

interface OwnedProcess {
  readonly computerId: string;
  lastTick: number;
  readonly process: Cs486Process;
}

class ComputeWorkerRequestError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "Cs486ComputeWorkerRequestError";
  }
}

const configuration = parseWorkerConfiguration(workerData);
const port = parentPort;
if (port === null)
  throw new Error("CS486 compute worker requires a parent port");

const processes = new Map<string, OwnedProcess>();

port.on("message", (message: unknown) => {
  const correlationId = correlationIdFrom(message);
  const requestId = requestIdFrom(message);
  try {
    const envelope = parseEnvelope(message);
    const command = parseCommonCommand(envelope.command);
    const response = dispatch(command, envelope.command);
    port.postMessage({
      correlationId: envelope.correlationId,
      protocolVersion,
      response,
      type: "response",
      workerCount: configuration.workerCount,
      workerIndex: configuration.workerIndex,
    });
  } catch (error: unknown) {
    port.postMessage({
      code:
        error instanceof ComputeWorkerRequestError
          ? error.code
          : "PROCESS_OPERATION_FAILED",
      correlationId,
      error: boundedErrorMessage(error),
      protocolVersion,
      requestId,
      type: "error",
      workerCount: configuration.workerCount,
      workerIndex: configuration.workerIndex,
    });
  }
});

port.postMessage({
  protocolVersion,
  type: "ready",
  workerCount: configuration.workerCount,
  workerIndex: configuration.workerIndex,
});

function dispatch(
  common: CommonCommand,
  rawCommand: unknown,
): Readonly<Record<string, unknown>> {
  switch (common.command) {
    case "create":
      return createProcess(parseCreateCommand(common, rawCommand));
    case "slice":
      return runSlice(parseSliceCommand(common, rawCommand));
    case "dispose":
      return disposeProcess(parseDisposeCommand(common, rawCommand));
    case "terminate":
      return terminateProcess(parseTerminateCommand(common, rawCommand));
    case "fail":
      return failProcess(parseFailCommand(common, rawCommand));
  }
}

function createProcess(
  command: CreateCommand,
): Readonly<Record<string, unknown>> {
  if (processes.has(command.processId))
    throw new ComputeWorkerRequestError(
      "DUPLICATE_PROCESS",
      "CS486 compute process already exists",
    );
  if (processes.size >= maximumProcessesPerWorker)
    throw new ComputeWorkerRequestError(
      "PROCESS_CAPACITY_EXCEEDED",
      `CS486 compute worker admits at most ${String(maximumProcessesPerWorker)} processes`,
    );

  // Cs486Process construction performs the authoritative executable validation.
  // The actor is published to the Map only after every constructor/image check
  // succeeds, so a rejected create cannot leave partial worker state.
  const process = new Cs486Process(command.executable, {
    collectMicroarchitectureStats:
      command.options.collectMicroarchitectureStats,
    cpuModel: command.options.cpuModel,
    memoryBytes: command.options.memoryBytes,
    syscallHandler: rejectingSyscallHandler,
  });
  if (command.options.processImage !== undefined)
    process.initializeProcessImage(command.options.processImage);
  processes.set(command.processId, {
    computerId: command.computerId,
    lastTick: 0,
    process,
  });

  return commonResponse(command, {
    view: processView(process),
  });
}

function runSlice(command: SliceCommand): Readonly<Record<string, unknown>> {
  const owned = requireOwnedProcess(command);
  if (command.tick < owned.lastTick)
    throw new ComputeWorkerRequestError(
      "NON_MONOTONIC_TICK",
      "CS486 compute process tick must advance monotonically",
    );

  owned.process.advanceTick(command.tick);
  owned.lastTick = command.tick;
  const result = owned.process.runCpuSlice(
    command.cpuCycleBudget,
    command.instructionBudget,
  );
  return commonResponse(command, {
    result: {
      cpuCycles: result.cpuCycles,
      executedInstructions: result.executedInstructions,
      state: processStateView(result.state),
    },
    view: processView(owned.process),
  });
}

function terminateProcess(
  command: TerminateCommand,
): Readonly<Record<string, unknown>> {
  const owned = requireOwnedProcess(command);
  owned.process.terminate(command.reason);
  return commonResponse(command, {
    view: processView(owned.process),
  });
}

function failProcess(command: FailCommand): Readonly<Record<string, unknown>> {
  const owned = requireOwnedProcess(command);
  owned.process.fail(
    new VmRuntimeError(command.error.typeName, command.error.message),
  );
  return commonResponse(command, {
    view: processView(owned.process),
  });
}

function disposeProcess(
  command: DisposeCommand,
): Readonly<Record<string, unknown>> {
  const owned = processes.get(command.processId);
  if (owned === undefined)
    return commonResponse(command, {
      disposed: true,
    });
  if (owned.computerId !== command.computerId)
    throw new ComputeWorkerRequestError(
      "PROCESS_IDENTITY_MISMATCH",
      "CS486 compute process belongs to a different Computer",
    );
  if (owned.process.hasPendingCpuCycles)
    throw new ComputeWorkerRequestError(
      "PROCESS_HAS_PENDING_CYCLES",
      "CS486 compute process must drain pending CPU cycles before disposal",
    );

  if (!isTerminalCpuProcessState(owned.process.state))
    owned.process.terminate("disposed");
  processes.delete(command.processId);
  return commonResponse(command, {
    disposed: true,
  });
}

function requireOwnedProcess(command: CommonCommand): OwnedProcess {
  const owned = processes.get(command.processId);
  if (owned === undefined)
    throw new ComputeWorkerRequestError(
      "PROCESS_NOT_FOUND",
      "CS486 compute process does not exist",
    );
  if (owned.computerId !== command.computerId)
    throw new ComputeWorkerRequestError(
      "PROCESS_IDENTITY_MISMATCH",
      "CS486 compute process belongs to a different Computer",
    );
  return owned;
}

function commonResponse(
  command: CommonCommand,
  fields: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  return {
    command: command.command,
    computerId: command.computerId,
    processId: command.processId,
    protocolVersion,
    requestId: command.requestId,
    workerCount: configuration.workerCount,
    workerIndex: configuration.workerIndex,
    ...fields,
  };
}

function processView(process: Cs486Process): Readonly<Record<string, unknown>> {
  const output = process.output;
  if (output.length > maximumOutputCharacters)
    throw new ComputeWorkerRequestError(
      "INVALID_PROCESS_SNAPSHOT",
      "CS486 compute process output exceeded its snapshot bound",
    );
  return {
    hasPendingCpuCycles: process.hasPendingCpuCycles,
    memoryLimitBytes: process.memoryLimitBytes,
    memoryUsageBytes: process.memoryUsageBytes,
    microarchitectureStats: process.microarchitectureStatsEnabled
      ? { ...process.microarchitectureStats }
      : zeroMicroarchitectureStats,
    microarchitectureStatsEnabled: process.microarchitectureStatsEnabled,
    output,
    state: processStateView(process.state),
  };
}

function processStateView(
  state: Cs486Process["state"],
): Readonly<Record<string, unknown>> {
  switch (state.kind) {
    case "ready":
      return { kind: "ready" };
    case "completed":
      return { kind: "completed", value: state.value };
    case "crashed":
      return {
        error: {
          message: state.error.message.slice(0, maximumErrorMessageCharacters),
          typeName: state.error.typeName,
        },
        kind: "crashed",
      };
    case "sleeping":
      return { kind: "sleeping", wakeTick: state.wakeTick };
    case "terminated":
      return { kind: "terminated", reason: state.reason };
    case "waiting_event":
      return state.filter === undefined
        ? { kind: "waiting_event" }
        : { filter: state.filter, kind: "waiting_event" };
  }
}

function parseEnvelope(value: unknown): RequestEnvelope {
  if (!isRecord(value))
    throw invalidRequest("invalid CS486 compute worker envelope");
  assertOnlyKeys(value, [
    "command",
    "correlationId",
    "protocolVersion",
    "type",
  ]);
  if (
    value.protocolVersion !== protocolVersion ||
    value.type !== "request" ||
    !isPositiveSafeInteger(value.correlationId)
  )
    throw invalidRequest("invalid CS486 compute worker envelope");
  return value as unknown as RequestEnvelope;
}

function parseCommonCommand(value: unknown): CommonCommand {
  if (!isRecord(value)) throw invalidRequest("invalid CS486 compute command");
  if (
    value.protocolVersion !== protocolVersion ||
    !isCommandName(value.command) ||
    !isBoundedIdentifier(value.processId) ||
    !isBoundedIdentifier(value.computerId) ||
    !isBoundedRequestId(value.requestId)
  )
    throw invalidRequest("invalid CS486 compute command");
  return value as unknown as CommonCommand;
}

function parseCreateCommand(
  common: CommonCommand,
  value: unknown,
): CreateCommand {
  if (!isRecord(value)) throw invalidRequest("invalid CS486 create command");
  assertOnlyKeys(value, [
    "command",
    "computerId",
    "executable",
    "options",
    "processId",
    "protocolVersion",
    "requestId",
  ]);
  if (!isRecord(value.options))
    throw invalidRequest("invalid CS486 create options");
  assertOnlyKeys(value.options, [
    "collectMicroarchitectureStats",
    "cpuModel",
    "memoryBytes",
    "processImage",
  ]);
  const collectMicroarchitectureStats =
    value.options.collectMicroarchitectureStats ?? false;
  if (
    typeof collectMicroarchitectureStats !== "boolean" ||
    !isCpuModel(value.options.cpuModel) ||
    !isSafeIntegerInRange(
      value.options.memoryBytes,
      defaultCs486StackBytes,
      maximumCs486LinearAddressSpaceBytes,
    )
  )
    throw invalidRequest("invalid CS486 create options");
  const processImage =
    value.options.processImage === undefined
      ? undefined
      : parseProcessImage(value.options.processImage);
  return {
    ...common,
    command: "create",
    executable: value.executable as Cs486Executable,
    options: {
      collectMicroarchitectureStats,
      cpuModel: value.options.cpuModel,
      memoryBytes: value.options.memoryBytes,
      ...(processImage === undefined ? {} : { processImage }),
    },
  };
}

function parseSliceCommand(
  common: CommonCommand,
  value: unknown,
): SliceCommand {
  if (!isRecord(value)) throw invalidRequest("invalid CS486 slice command");
  assertOnlyKeys(value, [
    "command",
    "computerId",
    "cpuCycleBudget",
    "instructionBudget",
    "processId",
    "protocolVersion",
    "requestId",
    "tick",
  ]);
  if (
    !isSafeIntegerInRange(value.tick, 0, Number.MAX_SAFE_INTEGER) ||
    !isSafeIntegerInRange(value.cpuCycleBudget, 1, maximumCpuCyclesPerSlice) ||
    !isSafeIntegerInRange(
      value.instructionBudget,
      1,
      maximumInstructionsPerSlice,
    )
  )
    throw invalidRequest("invalid CS486 slice limits");
  return {
    ...common,
    command: "slice",
    cpuCycleBudget: value.cpuCycleBudget,
    instructionBudget: value.instructionBudget,
    tick: value.tick,
  };
}

function parseDisposeCommand(
  common: CommonCommand,
  value: unknown,
): DisposeCommand {
  if (!isRecord(value)) throw invalidRequest("invalid CS486 dispose command");
  assertOnlyKeys(value, [
    "command",
    "computerId",
    "processId",
    "protocolVersion",
    "requestId",
  ]);
  return { ...common, command: "dispose" };
}

function parseTerminateCommand(
  common: CommonCommand,
  value: unknown,
): TerminateCommand {
  if (!isRecord(value)) throw invalidRequest("invalid CS486 terminate command");
  assertOnlyKeys(value, [
    "command",
    "computerId",
    "processId",
    "protocolVersion",
    "reason",
    "requestId",
  ]);
  if (
    typeof value.reason !== "string" ||
    value.reason.length < 1 ||
    value.reason.length > maximumReasonCharacters
  )
    throw invalidRequest("invalid CS486 termination reason");
  return { ...common, command: "terminate", reason: value.reason };
}

function parseFailCommand(common: CommonCommand, value: unknown): FailCommand {
  if (!isRecord(value)) throw invalidRequest("invalid CS486 fail command");
  assertOnlyKeys(value, [
    "command",
    "computerId",
    "error",
    "processId",
    "protocolVersion",
    "requestId",
  ]);
  if (!isRecord(value.error)) throw invalidRequest("invalid CS486 failure");
  assertOnlyKeys(value.error, ["message", "typeName"]);
  if (
    !isErrorTypeName(value.error.typeName) ||
    typeof value.error.message !== "string" ||
    value.error.message.length < 1 ||
    value.error.message.length > maximumFailureMessageCharacters
  )
    throw invalidRequest("invalid CS486 failure");
  return {
    ...common,
    command: "fail",
    error: {
      message: value.error.message,
      typeName: value.error.typeName,
    },
  };
}

function parseProcessImage(value: unknown): Cs486ProcessImageInitialization {
  if (!isRecord(value)) throw invalidRequest("invalid CS486 process image");
  assertOnlyKeys(value, ["segments", "stackArguments"]);
  if (
    !Array.isArray(value.segments) ||
    value.segments.length > maximumProcessImageEntries ||
    !Array.isArray(value.stackArguments) ||
    value.stackArguments.length > maximumProcessImageEntries
  )
    throw invalidRequest("invalid CS486 process image");

  let initializedBytes = 0;
  const segments = value.segments.map((segment: unknown) => {
    if (!isRecord(segment))
      throw invalidRequest("invalid CS486 process image segment");
    assertOnlyKeys(segment, ["address", "bytes", "words"]);
    if (
      !isSafeIntegerInRange(segment.address, 0, Number.MAX_SAFE_INTEGER) ||
      !Array.isArray(segment.words)
    )
      throw invalidRequest("invalid CS486 process image segment");
    const words = segment.words;
    const bytes = segment.bytes;
    if (
      words.some((word) => !isWord(word)) ||
      (bytes !== undefined &&
        (!Array.isArray(bytes) ||
          words.length !== 0 ||
          bytes.some((byte) => !isSafeIntegerInRange(byte, 0, 0xff))))
    )
      throw invalidRequest("invalid CS486 process image segment");
    initializedBytes +=
      bytes === undefined
        ? words.length * Int32Array.BYTES_PER_ELEMENT
        : bytes.length;
    if (initializedBytes > maximumProcessImageBytes)
      throw invalidRequest("CS486 process image byte limit exceeded");
    return {
      address: segment.address,
      ...(bytes === undefined ? {} : { bytes: [...bytes] }),
      words: [...words],
    };
  });
  if (value.stackArguments.some((argument) => !isWord(argument)))
    throw invalidRequest("invalid CS486 process image stack arguments");
  return {
    segments,
    stackArguments: [...value.stackArguments],
  };
}

function rejectingSyscallHandler(name: string): never {
  throw new Cs486Fault(
    "UnsupportedOperationError",
    `CS486 compute worker rejects syscall ${name}`,
  );
}

function parseWorkerConfiguration(value: unknown): WorkerConfiguration {
  if (
    !isRecord(value) ||
    value.protocolVersion !== protocolVersion ||
    !isSafeIntegerInRange(value.workerCount, 1, 16) ||
    !isSafeIntegerInRange(value.workerIndex, 1, value.workerCount)
  )
    throw new Error("invalid CS486 compute worker configuration");
  return value as unknown as WorkerConfiguration;
}

function assertOnlyKeys(
  value: Readonly<Record<string, unknown>>,
  keys: readonly string[],
): void {
  const allowed = new Set(keys);
  if (Object.keys(value).some((key) => !allowed.has(key)))
    throw invalidRequest("CS486 compute command contains unsupported fields");
}

function invalidRequest(message: string): ComputeWorkerRequestError {
  return new ComputeWorkerRequestError("INVALID_REQUEST", message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCommandName(value: unknown): value is CommandName {
  return (
    value === "create" ||
    value === "slice" ||
    value === "dispose" ||
    value === "terminate" ||
    value === "fail"
  );
}

function isBoundedIdentifier(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 1 &&
    value.length <= maximumIdentifierCharacters &&
    /^[A-Za-z0-9][A-Za-z0-9._:@-]*$/u.test(value)
  );
}

function isBoundedRequestId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 1 &&
    value.length <= maximumRequestIdCharacters &&
    /^[A-Za-z0-9][A-Za-z0-9._:@/-]*$/u.test(value)
  );
}

function isErrorTypeName(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 1 &&
    value.length <= maximumIdentifierCharacters &&
    /^[A-Za-z][A-Za-z0-9_]*$/u.test(value)
  );
}

function isPositiveSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function isSafeIntegerInRange(
  value: unknown,
  minimum: number,
  maximum: number,
): value is number {
  return (
    Number.isSafeInteger(value) &&
    (value as number) >= minimum &&
    (value as number) <= maximum
  );
}

function isWord(value: unknown): value is number {
  return isSafeIntegerInRange(value, -0x80_00_00_00, 0xff_ff_ff_ff);
}

function correlationIdFrom(value: unknown): number | null {
  if (!isRecord(value)) return null;
  return isPositiveSafeInteger(value.correlationId)
    ? value.correlationId
    : null;
}

function requestIdFrom(value: unknown): string | null {
  if (!isRecord(value) || !isRecord(value.command)) return null;
  return isBoundedRequestId(value.command.requestId)
    ? value.command.requestId
    : null;
}

function boundedErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, maximumErrorMessageCharacters);
}
