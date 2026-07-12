import { FilesystemError } from "../../domain/filesystem/inMemoryFilesystem.js";
import type { InMemoryFilesystem } from "../../domain/filesystem/inMemoryFilesystem.js";
import { VmRuntimeError } from "../../domain/runtime/errors.js";
import {
  namespace,
  nativeFunction,
  type ModuleLoader,
  type NativeFunction,
  type RuntimeNamespace,
  type RuntimeValue,
} from "../../domain/runtime/value.js";
import { TerminalError } from "../../domain/terminal/terminalBuffer.js";
import type { TerminalBuffer } from "../../domain/terminal/terminalBuffer.js";
import {
  isRedstoneSide,
  type RedstoneSide,
  type RedstoneState,
} from "../../domain/redstone/redstoneState.js";
import { ShellSession } from "../os/shellSession.js";

export interface NativeModuleContext {
  readonly computerId: number;
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
}

export interface NativeEnvironment {
  readonly moduleLoader: ModuleLoader;
  readonly modules: ReadonlyMap<string, RuntimeNamespace>;
  readonly globals: ReadonlyMap<string, RuntimeValue>;
}

export function createNativeEnvironment(
  context: NativeModuleContext,
): NativeEnvironment {
  const shell = new ShellSession(context.filesystem);
  const modules = new Map<string, RuntimeNamespace>([
    ["os", createOsModule(context)],
    ["term", createTermModule(context.terminal)],
    ["fs", createFsModule(context.filesystem)],
    ...(context.redstone === undefined
      ? []
      : ([["redstone", createRedstoneModule(context.redstone)]] as const)),
    ["shell", createShellModule(shell, context)],
  ]);
  return {
    modules,
    moduleLoader: (name) => modules.get(name),
    globals: new Map([["print", createPrint(context.terminal)]]),
  };
}

function createShellModule(
  shell: ShellSession,
  context: NativeModuleContext,
): RuntimeNamespace {
  const banner = fn("banner", (positional, keywords) => {
    requireArity(positional, keywords, 0, 0);
    writeTerminalLines(context.terminal, ["Computer System OS"]);
    return null;
  });
  const prompt = fn("prompt", (positional, keywords) => {
    requireArity(positional, keywords, 0, 0);
    context.terminal.write(shell.prompt());
    return null;
  });
  const submit = fn("submit", (positional, keywords) => {
    requireArity(positional, keywords, 1, 1);
    const line = stringArgument(positional[0]);
    writeTerminalLines(context.terminal, [line]);
    const result = shell.submit(line);
    if (result.action === "clear") {
      context.terminal.clear();
      context.terminal.setCursorPosition(1, 1);
    } else {
      writeTerminalLines(context.terminal, result.lines);
    }
    if (result.action === "shutdown") {
      requireCapability(context.shutdown, "shutdown")();
    } else if (result.action === "reboot") {
      requireCapability(context.reboot, "reboot")();
    }
    return null;
  });
  return namespace("shell", { banner, prompt, submit });
}

function writeTerminalLines(
  terminal: TerminalBuffer,
  lines: readonly string[],
): void {
  for (const line of lines) {
    terminal.write(line);
    if (terminal.cursorY >= terminal.height) {
      terminal.scroll(1);
      terminal.setCursorPosition(1, terminal.height);
    } else {
      terminal.setCursorPosition(1, terminal.cursorY + 1);
    }
  }
}

function createRedstoneModule(redstone: RedstoneState): RuntimeNamespace {
  const getInput = fn("get_input", (positional, keywords) => {
    requireArity(positional, keywords, 1, 1);
    return redstone.getInput(redstoneSideArgument(positional[0]));
  });
  const getAnalogInput = fn("get_analog_input", (positional, keywords) => {
    requireArity(positional, keywords, 1, 1);
    return redstone.getAnalogInput(redstoneSideArgument(positional[0]));
  });
  const getOutput = fn("get_output", (positional, keywords) => {
    requireArity(positional, keywords, 1, 1);
    return redstone.getOutput(redstoneSideArgument(positional[0]));
  });
  const setOutput = fn("set_output", (positional, keywords) => {
    requireArity(positional, keywords, 2, 2);
    redstone.setOutput(
      redstoneSideArgument(positional[0]),
      booleanArgument(positional[1]),
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

function createPrint(terminal: TerminalBuffer): NativeFunction {
  return terminalFunction("print", (positional, keywords) => {
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
  });
}

function createTermModule(terminal: TerminalBuffer): RuntimeNamespace {
  const clear = terminalFunction("clear", (positional, keywords) => {
    requireArity(positional, keywords, 0, 0);
    terminal.clear();
    return null;
  });
  const clearLine = terminalFunction("clear_line", (positional, keywords) => {
    requireArity(positional, keywords, 0, 0);
    terminal.clearLine();
    return null;
  });
  const write = terminalFunction("write", (positional, keywords) => {
    requireArity(positional, keywords, 1, 1);
    terminal.write(stringArgument(positional[0]));
    return null;
  });
  const setCursorPos = terminalFunction(
    "set_cursor_pos",
    (positional, keywords) => {
      requireArity(positional, keywords, 2, 2);
      terminal.setCursorPosition(
        integerArgument(positional[0]),
        integerArgument(positional[1]),
      );
      return null;
    },
  );
  const getCursorPos = terminalFunction(
    "get_cursor_pos",
    (positional, keywords) => {
      requireArity(positional, keywords, 0, 0);
      return tuple(terminal.cursorX, terminal.cursorY);
    },
  );
  const setCursorBlink = terminalFunction(
    "set_cursor_blink",
    (positional, keywords) => {
      requireArity(positional, keywords, 1, 1);
      terminal.setCursorBlink(booleanArgument(positional[0]));
      return null;
    },
  );
  const getSize = terminalFunction("get_size", (positional, keywords) => {
    requireArity(positional, keywords, 0, 0);
    return tuple(terminal.width, terminal.height);
  });
  const scroll = terminalFunction("scroll", (positional, keywords) => {
    requireArity(positional, keywords, 1, 1);
    terminal.scroll(integerArgument(positional[0]));
    return null;
  });
  const setTextColor = terminalFunction(
    "set_text_color",
    (positional, keywords) => {
      requireArity(positional, keywords, 1, 1);
      terminal.setTextColor(colorIndex(positional[0]));
      return null;
    },
  );
  const getTextColor = terminalFunction(
    "get_text_color",
    (positional, keywords) => {
      requireArity(positional, keywords, 0, 0);
      return 2 ** terminal.foreground;
    },
  );
  const setBackgroundColor = terminalFunction(
    "set_background_color",
    (positional, keywords) => {
      requireArity(positional, keywords, 1, 1);
      terminal.setBackgroundColor(colorIndex(positional[0]));
      return null;
    },
  );
  const getBackgroundColor = terminalFunction(
    "get_background_color",
    (positional, keywords) => {
      requireArity(positional, keywords, 0, 0);
      return 2 ** terminal.background;
    },
  );
  const isColor = terminalFunction("is_color", (positional, keywords) => {
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

function terminalFunction(
  name: string,
  call: NativeFunction["call"],
): NativeFunction {
  return fn(name, (positional, keywords) => {
    try {
      return call(positional, keywords);
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
