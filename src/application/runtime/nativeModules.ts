import { FilesystemError } from "../../domain/filesystem/inMemoryFilesystem.js";
import type { InMemoryFilesystem } from "../../domain/filesystem/inMemoryFilesystem.js";
import { VmRuntimeError } from "../../domain/runtime/errors.js";
import {
  namespace,
  nativeFunction,
  type NativeFunction,
  type RuntimeNamespace,
  type RuntimeValue,
  type VmWaitRequest,
  type VmWorkRequest,
} from "../../domain/runtime/value.js";
import { TerminalError } from "../../domain/terminal/terminalBuffer.js";
import type { TerminalBuffer } from "../../domain/terminal/terminalBuffer.js";
import {
  isRedstoneSide,
  type RedstoneSide,
  type RedstoneState,
} from "../../domain/redstone/redstoneState.js";
import { ShellSession } from "../os/shellSession.js";
import type { ShellResult } from "../os/shellSession.js";
import type { ShellForegroundRequest } from "../os/shellTypes.js";
import type { EditorScreen } from "../editor/editorScreen.js";
import type { ComputerOsProfile } from "../../domain/computer/computer.js";
import type { ShellClockSource } from "../os/clock.js";
import type { ComputerHardwareProfile } from "../../domain/computer/hardware.js";
import { formatOsIdentity, getOsIdentity } from "../os/osIdentity.js";
import type {
  SerialEndpoint,
  SerialLinkBroker,
} from "../io/serialLinkBroker.js";
import {
  createSerialVirtualDevices,
  serialFaceForPortIndex,
} from "../os/serialVirtualDevices.js";
import type { PeripheralBusBroker } from "../io/peripheralBusBroker.js";
import { createPeripheralVirtualDevices } from "../os/peripheralVirtualDevices.js";
import type { VirtualDevice } from "../os/osProfile.js";
import { decodeUtf8Chunk, encodeUtf8 } from "../../domain/text/utf8.js";
import type { ComputerWorkLane } from "./computerWorkMonitor.js";

export interface NativeModuleContext {
  readonly clock?: ShellClockSource;
  readonly computerId: number;
  readonly computerName?: string;
  readonly osProfile?: ComputerOsProfile;
  readonly filesystem: InMemoryFilesystem;
  readonly terminal: TerminalBuffer;
  readonly redstone?: RedstoneState;
  readonly currentTick?: () => number;
  readonly queueEvent?: (
    name: string,
    ...arguments_: readonly RuntimeValue[]
  ) => void;
  readonly startTimer?: (delayTicks: number) => number;
  readonly cancelTimer?: (timerId: number) => boolean;
  readonly shutdown?: () => void;
  readonly reboot?: () => void;
  readonly ticksPerSecond?: number;
  readonly hardware?: ComputerHardwareProfile;
  readonly memoryUsageBytes?: () => number;
  readonly requireLinuxLogin?: boolean;
  readonly shell?: ShellSession;
  readonly startForegroundProcess?: (
    request: ShellForegroundRequest,
  ) => ForegroundProcessStartResult;
  readonly serial?: SerialLinkBroker;
  readonly peripherals?: PeripheralBusBroker;
  readonly requestFilesystemIo?: (
    operation: "read" | "write",
    bytes: number,
  ) => string | undefined;
  readonly runHostWork?: <T>(
    lane: ComputerWorkLane,
    deterministicUnits: number,
    operation: () => T,
  ) => T;
}

export type ForegroundProcessStartResult =
  | { readonly completionEvent: string; readonly outcome: "started" }
  | {
      readonly cpuCycles?: number;
      readonly exitCode: number;
      readonly outcome: "failed";
      readonly stderr: string;
    };

export interface NativeEnvironment {
  readonly modules: ReadonlyMap<string, RuntimeNamespace>;
  readonly globals: ReadonlyMap<string, RuntimeValue>;
  readonly shell: ShellSession;
}

export function createNativeEnvironment(
  context: NativeModuleContext,
): NativeEnvironment {
  const virtualDevices = createVirtualDevices(context);
  const shell =
    context.shell ??
    new ShellSession(context.filesystem, {
      clock: context.clock,
      computerId: context.computerId,
      computerName: context.computerName,
      currentTick: context.currentTick,
      osProfile: context.osProfile,
      ticksPerSecond: context.ticksPerSecond,
      hardware: context.hardware,
      memoryUsageBytes: context.memoryUsageBytes,
      requireLogin: context.requireLinuxLogin,
      terminalHeight: context.terminal.height,
      terminalWidth: context.terminal.width,
      virtualDevices,
      peripherals: context.peripherals,
      deferGuestExecution: context.startForegroundProcess !== undefined,
      requestFilesystemIo: context.requestFilesystemIo,
    });
  const modules = new Map<string, RuntimeNamespace>([
    ["os", createOsModule(context)],
    ["term", createTermModule(context)],
    ["fs", createFsModule(context.filesystem)],
    ...(context.redstone === undefined
      ? []
      : ([["redstone", createRedstoneModule(context)]] as const)),
    ["shell", createShellModule(shell, context)],
  ]);
  if ((context.osProfile ?? "linux") === "linux") {
    if (context.serial !== undefined && context.computerName !== undefined) {
      modules.set("serial", createSerialModule(context));
    }
    if (
      context.peripherals !== undefined &&
      context.computerName !== undefined
    ) {
      modules.set("spi", createSpiModule(context));
      modules.set("i2c", createI2cModule(context));
    }
  }
  return {
    modules,
    globals: new Map([["print", createPrint(context)]]),
    shell,
  };
}

function createVirtualDevices(
  context: NativeModuleContext,
): ReadonlyMap<string, VirtualDevice> | undefined {
  if (context.computerName === undefined) return undefined;
  const devices = new Map<string, VirtualDevice>();
  if (context.serial !== undefined) {
    for (const [path, device] of createSerialVirtualDevices(
      context.osProfile ?? "linux",
      context.computerName,
      context.serial,
    )) {
      devices.set(path, device);
    }
  }
  if (context.peripherals !== undefined) {
    for (const [path, device] of createPeripheralVirtualDevices(
      context.osProfile ?? "linux",
      context.computerName,
      context.peripherals,
    )) {
      devices.set(path, device);
    }
  }
  return devices.size === 0 ? undefined : devices;
}

function createShellModule(
  shell: ShellSession,
  context: NativeModuleContext,
): RuntimeNamespace {
  const applyResult = (
    result: ShellResult,
  ): RuntimeValue | VmWaitRequest | VmWorkRequest => {
    if (result.action === "shutdown") {
      requireCapability(context.shutdown, "shutdown")();
    } else if (result.action === "reboot") {
      requireCapability(context.reboot, "reboot")();
    }
    if (result.foreground !== undefined) {
      const started = requireCapability(
        context.startForegroundProcess,
        "foreground process",
      )(result.foreground);
      if (started.outcome === "failed") {
        shell.completeForegroundProcess(started.exitCode);
        writeTerminalLines(
          context.terminal,
          started.stderr.replaceAll("\r\n", "\n").trimEnd().split("\n"),
        );
        return {
          kind: "work",
          cycles: started.cpuCycles ?? 1,
          value: null,
        };
      }
      return { kind: "wait_event", filter: started.completionEvent };
    }
    if (result.ioWaitEvent !== undefined) {
      return { kind: "wait_event", filter: result.ioWaitEvent };
    }
    if (result.sleepTicks !== undefined) {
      return { kind: "sleep", ticks: result.sleepTicks };
    }
    return { kind: "work", cycles: result.cpuCycles ?? 1, value: null };
  };
  const executeShellOperation = (
    operation: () => ShellResult,
    echoedLine?: string,
  ): RuntimeValue | VmWaitRequest | VmWorkRequest => {
    const result = runHostWork(context, "terminal", 1, () => {
      if (echoedLine !== undefined) {
        writeTerminalLines(context.terminal, [echoedLine]);
      }
      const completed = operation();
      if (completed.terminalScreen !== undefined) {
        renderTerminalScreen(context.terminal, completed.terminalScreen);
      } else {
        if (completed.action === "clear" || completed.resetTerminal) {
          context.terminal.setTextColor(0);
          context.terminal.setBackgroundColor(15);
          context.terminal.clear();
          context.terminal.setCursorPosition(1, 1);
        }
        writeTerminalLines(context.terminal, completed.lines);
      }
      return completed;
    });
    return applyResult(result);
  };
  const banner = fn("banner", (positional, keywords) => {
    requireArity(positional, keywords, 0, 0);
    context.terminal.setTextColor(0);
    context.terminal.setBackgroundColor(15);
    context.terminal.clear();
    context.terminal.setCursorPosition(1, 1);
    const osProfile = context.osProfile ?? "linux";
    writeTerminalLines(
      context.terminal,
      osProfile === "dos"
        ? [
            formatOsIdentity(getOsIdentity(osProfile)),
            "",
            ...shell.takeStartupLines(),
          ]
        : [
            formatOsIdentity(getOsIdentity(osProfile)),
            "",
            ...shell.takeStartupLines(),
          ],
    );
    return null;
  });
  const prompt = fn("prompt", (positional, keywords) => {
    requireArity(positional, keywords, 0, 0);
    context.terminal.setTextColor(0);
    context.terminal.write(shell.prompt());
    return null;
  });
  const submit = fn("submit", (positional, keywords) => {
    requireArity(positional, keywords, 1, 1);
    const line = stringArgument(positional[0]);
    const secretInput = shell.isSecretInput();
    return executeShellOperation(
      () => shell.submit(line),
      secretInput ? "" : line,
    );
  });
  const keys = fn("keys", (positional, keywords) => {
    requireArity(positional, keywords, 1, 1);
    const encoded = stringArgument(positional[0]);
    let decoded: unknown;
    try {
      decoded = JSON.parse(encoded);
    } catch {
      throw new VmRuntimeError("ValueError", "Invalid terminal key batch");
    }
    if (
      !Array.isArray(decoded) ||
      decoded.length > 32 ||
      decoded.some((key) => typeof key !== "string" || key.length > 32)
    ) {
      throw new VmRuntimeError("ValueError", "Invalid terminal key batch");
    }
    return executeShellOperation(() => shell.keys(decoded));
  });
  return namespace("shell", { banner, prompt, submit, keys });
}

export function renderTerminalScreen(
  terminal: TerminalBuffer,
  screen: EditorScreen,
): void {
  terminal.setTextColor(0);
  terminal.setBackgroundColor(15);
  terminal.clear();
  for (let y = 0; y < Math.min(terminal.height, screen.rows.length); y += 1) {
    const row = screen.rows[y] ?? [];
    terminal.setCursorPosition(1, y + 1);
    for (const cell of row.slice(0, terminal.width)) {
      terminal.setTextColor(cell.foreground);
      terminal.setBackgroundColor(cell.background);
      terminal.write(cell.character);
    }
  }
  terminal.setTextColor(0);
  terminal.setBackgroundColor(15);
  terminal.setCursorPosition(screen.cursor.x, screen.cursor.y);
  terminal.setCursorBlink(true);
}

export function writeTerminalLines(
  terminal: TerminalBuffer,
  lines: readonly string[],
): void {
  for (const line of lines) {
    const characters = [...line];
    let offset = 0;
    while (offset < characters.length) {
      if (terminal.cursorX > terminal.width) advanceTerminalLine(terminal);
      const available = terminal.width - terminal.cursorX + 1;
      terminal.write(characters.slice(offset, offset + available).join(""));
      offset += available;
      if (offset < characters.length) advanceTerminalLine(terminal);
    }
    advanceTerminalLine(terminal);
  }
}

function advanceTerminalLine(terminal: TerminalBuffer): void {
  if (terminal.cursorY >= terminal.height) {
    terminal.scroll(1);
    terminal.setCursorPosition(1, terminal.height);
  } else terminal.setCursorPosition(1, terminal.cursorY + 1);
}

function createRedstoneModule(context: NativeModuleContext): RuntimeNamespace {
  const redstone = context.redstone!;
  const getInput = fn("get_input", (positional, keywords) => {
    requireArity(positional, keywords, 1, 1);
    return runHostWork(context, "redstone_input", 1, () =>
      redstone.getInput(redstoneSideArgument(positional[0])),
    );
  });
  const getAnalogInput = fn("get_analog_input", (positional, keywords) => {
    requireArity(positional, keywords, 1, 1);
    return runHostWork(context, "redstone_input", 1, () =>
      redstone.getAnalogInput(redstoneSideArgument(positional[0])),
    );
  });
  const getOutput = fn("get_output", (positional, keywords) => {
    requireArity(positional, keywords, 1, 1);
    return runHostWork(context, "redstone_input", 1, () =>
      redstone.getOutput(redstoneSideArgument(positional[0])),
    );
  });
  const setOutput = fn("set_output", (positional, keywords) => {
    requireArity(positional, keywords, 2, 2);
    runHostWork(context, "redstone_output", 1, () =>
      redstone.setOutput(
        redstoneSideArgument(positional[0]),
        booleanArgument(positional[1]),
      ),
    );
    return null;
  });
  return namespace("redstone", {
    get_input: getInput,
    getInput,
    get_analog_input: getAnalogInput,
    getAnalogInput,
    get_output: getOutput,
    getOutput,
    set_output: setOutput,
    setOutput,
  });
}

function createSerialModule(context: NativeModuleContext): RuntimeNamespace {
  const serial = requireCapability(context.serial, "serial");
  const computerId = requireCapability(context.computerName, "computer name");
  const pending = new Map<number, Uint8Array>();
  const observedResetEpochs = new Map<number, number>();
  const endpoint = (port: RuntimeValue | undefined): SerialEndpoint => ({
    computerId,
    face: serialFaceForPortIndex(integerArgument(port)),
  });
  const write = fn("write", (positional, keywords) => {
    requireArity(positional, keywords, 2, 2);
    const result = serial.write(
      endpoint(positional[0]),
      encodeUtf8(stringArgument(positional[1])),
    );
    if (result.outcome !== "accepted") {
      throw deviceError("serial", result.outcome);
    }
    return result.bytes;
  });
  const read = fn("read", (positional, keywords) => {
    requireArity(positional, keywords, 1, 2);
    const port = integerArgument(positional[0]);
    const portStatus = serial.status(endpoint(port));
    if (portStatus === undefined) {
      throw deviceError("serial", "device_unavailable");
    }
    const observedResetEpoch = observedResetEpochs.get(port);
    if (
      observedResetEpoch !== undefined &&
      observedResetEpoch !== portStatus.port.resetEpoch
    ) {
      pending.delete(port);
    }
    observedResetEpochs.set(port, portStatus.port.resetEpoch);
    const maximum =
      positional.length === 2 ? integerArgument(positional[1]) : undefined;
    const result = serial.read(endpoint(port), maximum);
    if (result.outcome !== "read") {
      throw deviceError("serial", result.outcome);
    }
    const prior = pending.get(port) ?? new Uint8Array();
    const combined = concatenateBytes(prior, result.bytes);
    const decoded = decodeUtf8Chunk(combined);
    pending.set(port, decoded.remainder);
    return decoded.value;
  });
  const status = fn("status", (positional, keywords) => {
    requireArity(positional, keywords, 1, 1);
    const result = serial.status(endpoint(positional[0]));
    if (result === undefined) throw deviceError("serial", "device_unavailable");
    return tuple(
      result.link,
      result.peer?.computerId ?? "",
      result.peer?.face ?? "",
      result.port.receiveBytes,
      result.port.transmitBytes,
    );
  });
  return namespace("serial", { read, status, write });
}

function createSpiModule(context: NativeModuleContext): RuntimeNamespace {
  const peripherals = requireCapability(context.peripherals, "spi");
  const computerId = requireCapability(context.computerName, "computer name");
  const transfer = fn("transfer", (positional, keywords) => {
    requireArity(positional, keywords, 3, 3);
    const result = peripherals.transferSpi(
      {
        computerId,
        face: serialFaceForPortIndex(integerArgument(positional[0])),
      },
      integerArgument(positional[1]),
      byteArrayArgument(positional[2]),
    );
    if (result.outcome !== "completed") {
      throw deviceError(
        "spi",
        result.outcome,
        "message" in result ? result.message : undefined,
      );
    }
    return byteList(result.receive);
  });
  return namespace("spi", { transfer });
}

function createI2cModule(context: NativeModuleContext): RuntimeNamespace {
  const peripherals = requireCapability(context.peripherals, "i2c");
  const computerId = requireCapability(context.computerName, "computer name");
  const scan = fn("scan", (positional, keywords) => {
    requireArity(positional, keywords, 1, 1);
    const result = peripherals.scanI2c({
      computerId,
      face: serialFaceForPortIndex(integerArgument(positional[0])),
    });
    if (result.outcome !== "completed") {
      throw deviceError("i2c", result.outcome);
    }
    if (result.conflicts.length > 0) {
      throw deviceError("i2c", "address_conflict");
    }
    return byteList(Uint8Array.from(result.addresses));
  });
  const transfer = fn("transfer", (positional, keywords) => {
    requireArity(positional, keywords, 4, 4);
    const result = peripherals.transactI2c(
      {
        computerId,
        face: serialFaceForPortIndex(integerArgument(positional[0])),
      },
      integerArgument(positional[1]),
      byteArrayArgument(positional[2]),
      integerArgument(positional[3]),
    );
    if (result.outcome !== "completed") {
      throw deviceError(
        "i2c",
        result.outcome,
        "message" in result ? result.message : undefined,
      );
    }
    return byteList(result.read);
  });
  return namespace("i2c", { scan, transfer });
}

function createOsModule(context: NativeModuleContext): RuntimeNamespace {
  const ticksPerSecond = context.ticksPerSecond ?? 20;
  if (!Number.isFinite(ticksPerSecond) || ticksPerSecond <= 0) {
    throw new RangeError("ticksPerSecond must be positive");
  }
  const getComputerId = fn("get_computer_id", (positional, keywords) => {
    requireArity(positional, keywords, 0, 0);
    return context.computerId;
  });
  const clock = fn("clock", (positional, keywords) => {
    requireArity(positional, keywords, 0, 0);
    return (context.currentTick?.() ?? 0) / ticksPerSecond;
  });
  const sleep = fn("sleep", (positional, keywords) => {
    requireArity(positional, keywords, 1, 1);
    return {
      kind: "sleep",
      ticks: secondsToTicks(numberArgument(positional[0]), ticksPerSecond),
    };
  });
  const pullEvent = fn("pull_event", (positional, keywords) => {
    requireArity(positional, keywords, 0, 1);
    return {
      kind: "wait_event",
      filter:
        positional.length === 0 ? undefined : stringArgument(positional[0]),
    };
  });
  const queueEvent = fn("queue_event", (positional, keywords) => {
    requireArity(positional, keywords, 1, Number.POSITIVE_INFINITY);
    const callback = requireCapability(context.queueEvent, "queue_event");
    callback(stringArgument(positional[0]), ...positional.slice(1));
    return null;
  });
  const startTimer = fn("start_timer", (positional, keywords) => {
    requireArity(positional, keywords, 1, 1);
    const callback = requireCapability(context.startTimer, "start_timer");
    return callback(
      secondsToTicks(numberArgument(positional[0]), ticksPerSecond),
    );
  });
  const cancelTimer = fn("cancel_timer", (positional, keywords) => {
    requireArity(positional, keywords, 1, 1);
    const callback = requireCapability(context.cancelTimer, "cancel_timer");
    return callback(integerArgument(positional[0]));
  });
  const shutdown = fn("shutdown", (positional, keywords) => {
    requireArity(positional, keywords, 0, 0);
    requireCapability(context.shutdown, "shutdown")();
    return null;
  });
  const reboot = fn("reboot", (positional, keywords) => {
    requireArity(positional, keywords, 0, 0);
    requireCapability(context.reboot, "reboot")();
    return null;
  });
  return namespace("os", {
    get_computer_id: getComputerId,
    getComputerID: getComputerId,
    clock,
    sleep,
    pull_event: pullEvent,
    pullEvent,
    queue_event: queueEvent,
    queueEvent,
    start_timer: startTimer,
    startTimer,
    cancel_timer: cancelTimer,
    cancelTimer,
    shutdown,
    reboot,
  });
}

function createPrint(context: NativeModuleContext): NativeFunction {
  const terminal = context.terminal;
  return terminalFunction(
    "print",
    (positional, keywords) => {
      if (keywords.size > 0) {
        throw new VmRuntimeError(
          "TypeError",
          "print accepts positional arguments only",
        );
      }
      terminal.write(positional.map(displayValue).join(" "));
      if (terminal.cursorY >= terminal.height) {
        terminal.scroll(1);
        terminal.setCursorPosition(1, terminal.height);
      } else {
        terminal.setCursorPosition(1, terminal.cursorY + 1);
      }
      return null;
    },
    context.runHostWork,
  );
}

function createTermModule(context: NativeModuleContext): RuntimeNamespace {
  const terminal = context.terminal;
  const termFn = (name: string, call: NativeFunction["call"]): NativeFunction =>
    terminalFunction(name, call, context.runHostWork);
  const clear = termFn("clear", (positional, keywords) => {
    requireArity(positional, keywords, 0, 0);
    terminal.clear();
    return null;
  });
  const clearLine = termFn("clear_line", (positional, keywords) => {
    requireArity(positional, keywords, 0, 0);
    terminal.clearLine();
    return null;
  });
  const write = termFn("write", (positional, keywords) => {
    requireArity(positional, keywords, 1, 1);
    terminal.write(stringArgument(positional[0]));
    return null;
  });
  const setCursorPos = termFn("set_cursor_pos", (positional, keywords) => {
    requireArity(positional, keywords, 2, 2);
    terminal.setCursorPosition(
      integerArgument(positional[0]),
      integerArgument(positional[1]),
    );
    return null;
  });
  const getCursorPos = termFn("get_cursor_pos", (positional, keywords) => {
    requireArity(positional, keywords, 0, 0);
    return tuple(terminal.cursorX, terminal.cursorY);
  });
  const setCursorBlink = termFn("set_cursor_blink", (positional, keywords) => {
    requireArity(positional, keywords, 1, 1);
    terminal.setCursorBlink(booleanArgument(positional[0]));
    return null;
  });
  const getSize = termFn("get_size", (positional, keywords) => {
    requireArity(positional, keywords, 0, 0);
    return tuple(terminal.width, terminal.height);
  });
  const scroll = termFn("scroll", (positional, keywords) => {
    requireArity(positional, keywords, 1, 1);
    terminal.scroll(integerArgument(positional[0]));
    return null;
  });
  const setTextColor = termFn("set_text_color", (positional, keywords) => {
    requireArity(positional, keywords, 1, 1);
    terminal.setTextColor(colorIndex(positional[0]));
    return null;
  });
  const getTextColor = termFn("get_text_color", (positional, keywords) => {
    requireArity(positional, keywords, 0, 0);
    return 2 ** terminal.foreground;
  });
  const setBackgroundColor = termFn(
    "set_background_color",
    (positional, keywords) => {
      requireArity(positional, keywords, 1, 1);
      terminal.setBackgroundColor(colorIndex(positional[0]));
      return null;
    },
  );
  const getBackgroundColor = termFn(
    "get_background_color",
    (positional, keywords) => {
      requireArity(positional, keywords, 0, 0);
      return 2 ** terminal.background;
    },
  );
  const isColor = termFn("is_color", (positional, keywords) => {
    requireArity(positional, keywords, 0, 0);
    return true;
  });
  return namespace("term", {
    clear,
    clear_line: clearLine,
    clearLine,
    write,
    set_cursor_pos: setCursorPos,
    setCursorPos,
    get_cursor_pos: getCursorPos,
    getCursorPos,
    set_cursor_blink: setCursorBlink,
    setCursorBlink,
    get_size: getSize,
    getSize,
    scroll,
    set_text_color: setTextColor,
    setTextColor,
    setTextColour: setTextColor,
    get_text_color: getTextColor,
    getTextColor,
    getTextColour: getTextColor,
    set_background_color: setBackgroundColor,
    setBackgroundColor,
    setBackgroundColour: setBackgroundColor,
    get_background_color: getBackgroundColor,
    getBackgroundColor,
    getBackgroundColour: getBackgroundColor,
    is_color: isColor,
    isColor,
    isColour: isColor,
  });
}

function createFsModule(filesystem: InMemoryFilesystem): RuntimeNamespace {
  const exists = filesystemFunction("exists", (positional, keywords) => {
    requireArity(positional, keywords, 1, 1);
    return filesystem.exists(stringArgument(positional[0]));
  });
  const isDir = filesystemFunction("is_dir", (positional, keywords) => {
    requireArity(positional, keywords, 1, 1);
    return filesystem.isDirectory(stringArgument(positional[0]));
  });
  const list = filesystemFunction("list", (positional, keywords) => {
    requireArity(positional, keywords, 1, 1);
    return {
      kind: "list",
      values: filesystem.list(stringArgument(positional[0])),
    };
  });
  const makeDir = filesystemFunction("make_dir", (positional, keywords) => {
    requireArity(positional, keywords, 1, 1);
    filesystem.makeDirectory(stringArgument(positional[0]));
    return null;
  });
  const readFile = filesystemFunction("read_file", (positional, keywords) => {
    requireArity(positional, keywords, 1, 1);
    return filesystem.readFile(stringArgument(positional[0]));
  });
  const writeFile = filesystemFunction("write_file", (positional, keywords) => {
    requireArity(positional, keywords, 2, 2);
    filesystem.writeFile(
      stringArgument(positional[0]),
      stringArgument(positional[1]),
    );
    return null;
  });
  const appendFile = filesystemFunction(
    "append_file",
    (positional, keywords) => {
      requireArity(positional, keywords, 2, 2);
      filesystem.appendFile(
        stringArgument(positional[0]),
        stringArgument(positional[1]),
      );
      return null;
    },
  );
  const delete_ = filesystemFunction("delete", (positional, keywords) => {
    requireArity(positional, keywords, 1, 1);
    filesystem.delete(stringArgument(positional[0]));
    return null;
  });
  const copy = filesystemFunction("copy", (positional, keywords) => {
    requireArity(positional, keywords, 2, 2);
    filesystem.copy(
      stringArgument(positional[0]),
      stringArgument(positional[1]),
    );
    return null;
  });
  const move = filesystemFunction("move", (positional, keywords) => {
    requireArity(positional, keywords, 2, 2);
    filesystem.move(
      stringArgument(positional[0]),
      stringArgument(positional[1]),
    );
    return null;
  });
  const getSize = filesystemFunction("get_size", (positional, keywords) => {
    requireArity(positional, keywords, 1, 1);
    return filesystem.getSize(stringArgument(positional[0]));
  });
  const getFreeSpace = filesystemFunction(
    "get_free_space",
    (positional, keywords) => {
      requireArity(positional, keywords, 0, 1);
      if (positional.length === 1)
        filesystem.normalize(stringArgument(positional[0]));
      return filesystem.getFreeSpace();
    },
  );
  return namespace("fs", {
    exists,
    is_dir: isDir,
    isDir,
    list,
    make_dir: makeDir,
    makeDir,
    read_file: readFile,
    readFile,
    write_file: writeFile,
    writeFile,
    append_file: appendFile,
    appendFile,
    delete: delete_,
    copy,
    move,
    get_size: getSize,
    getSize,
    get_free_space: getFreeSpace,
    getFreeSpace,
  });
}

function fn(name: string, call: NativeFunction["call"]): NativeFunction {
  return nativeFunction(name, call);
}

function runHostWork<T>(
  context: NativeModuleContext,
  lane: ComputerWorkLane,
  deterministicUnits: number,
  operation: () => T,
): T {
  return context.runHostWork === undefined
    ? operation()
    : context.runHostWork(lane, deterministicUnits, operation);
}

function terminalFunction(
  name: string,
  call: NativeFunction["call"],
  work?: NativeModuleContext["runHostWork"],
): NativeFunction {
  return fn(name, (positional, keywords) => {
    try {
      return work === undefined
        ? call(positional, keywords)
        : work("terminal", 1, () => call(positional, keywords));
    } catch (error: unknown) {
      if (error instanceof TerminalError)
        throw new VmRuntimeError("TerminalError", error.message);
      throw error;
    }
  });
}

function filesystemFunction(
  name: string,
  call: NativeFunction["call"],
): NativeFunction {
  return fn(name, (positional, keywords) => {
    try {
      return call(positional, keywords);
    } catch (error: unknown) {
      if (error instanceof FilesystemError)
        throw new VmRuntimeError("FilesystemError", error.message);
      throw error;
    }
  });
}

function requireArity(
  positional: readonly RuntimeValue[],
  keywords: ReadonlyMap<string, RuntimeValue>,
  minimum: number,
  maximum: number,
): void {
  if (
    keywords.size > 0 ||
    positional.length < minimum ||
    positional.length > maximum
  ) {
    const expected =
      minimum === maximum ? String(minimum) : `${minimum}..${maximum}`;
    throw new VmRuntimeError(
      "TypeError",
      `Expected ${expected} positional arguments`,
    );
  }
}

function stringArgument(value: RuntimeValue | undefined): string {
  if (typeof value !== "string")
    throw new VmRuntimeError("TypeError", "Expected string argument");
  return value;
}

function redstoneSideArgument(value: RuntimeValue | undefined): RedstoneSide {
  const side = stringArgument(value);
  if (!isRedstoneSide(side)) {
    throw new VmRuntimeError("ValueError", `Unknown redstone side ${side}`);
  }
  return side;
}

function numberArgument(value: RuntimeValue | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new VmRuntimeError("TypeError", "Expected finite number argument");
  }
  return value;
}

function integerArgument(value: RuntimeValue | undefined): number {
  const number = numberArgument(value);
  if (!Number.isInteger(number))
    throw new VmRuntimeError("TypeError", "Expected integer argument");
  return number;
}

function booleanArgument(value: RuntimeValue | undefined): boolean {
  if (typeof value !== "boolean")
    throw new VmRuntimeError("TypeError", "Expected boolean argument");
  return value;
}

function byteArrayArgument(value: RuntimeValue | undefined): Uint8Array {
  if (
    value === null ||
    typeof value !== "object" ||
    (value.kind !== "list" && value.kind !== "tuple")
  ) {
    throw new VmRuntimeError("TypeError", "Expected a list or tuple of bytes");
  }
  const bytes = value.values.map((entry) => integerArgument(entry));
  if (bytes.some((byte) => byte < 0 || byte > 255)) {
    throw new VmRuntimeError(
      "ValueError",
      "Byte values must be between 0 and 255",
    );
  }
  return Uint8Array.from(bytes);
}

function byteList(bytes: Uint8Array): RuntimeValue {
  return { kind: "list", values: [...bytes] };
}

function concatenateBytes(left: Uint8Array, right: Uint8Array): Uint8Array {
  const result = new Uint8Array(left.length + right.length);
  result.set(left);
  result.set(right, left.length);
  return result;
}

function deviceError(
  protocol: string,
  outcome: string,
  detail?: string,
): VmRuntimeError {
  return new VmRuntimeError(
    "DeviceError",
    `${protocol}: ${detail ?? outcome.replaceAll("_", " ")}`,
  );
}

function colorIndex(value: RuntimeValue | undefined): number {
  const mask = integerArgument(value);
  if (mask <= 0 || mask > 32_768 || (mask & (mask - 1)) !== 0) {
    throw new VmRuntimeError(
      "ValueError",
      "Color must be a ComputerCraft color bit",
    );
  }
  return Math.log2(mask);
}

function secondsToTicks(seconds: number, ticksPerSecond: number): number {
  if (seconds < 0)
    throw new VmRuntimeError("ValueError", "Duration must be non-negative");
  return Math.ceil(seconds * ticksPerSecond);
}

function requireCapability<T>(capability: T | undefined, name: string): T {
  if (capability === undefined) {
    throw new VmRuntimeError(
      "UnsupportedError",
      `${name} is unavailable in this host`,
    );
  }
  return capability;
}

function tuple(...values: readonly RuntimeValue[]): RuntimeValue {
  return { kind: "tuple", values };
}

function displayValue(value: RuntimeValue): string {
  if (value === null) return "None";
  if (value === true) return "True";
  if (value === false) return "False";
  if (typeof value === "string" || typeof value === "number")
    return String(value);
  if (value.kind === "list" || value.kind === "tuple") {
    return value.values.map(displayValue).join(", ");
  }
  return `<${value.kind}>`;
}
