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

export interface NativeModuleContext {
  readonly computerId: number;
  readonly filesystem: InMemoryFilesystem;
  readonly terminal: TerminalBuffer;
  readonly currentTick?: () => number;
  readonly queueEvent?: (
    name: string,
    ...arguments_: readonly RuntimeValue[]
  ) => void;
  readonly startTimer?: (delayTicks: number) => number;
  readonly cancelTimer?: (timerId: number) => boolean;
  readonly ticksPerSecond?: number;
}

export interface NativeEnvironment {
  readonly moduleLoader: ModuleLoader;
  readonly modules: ReadonlyMap<string, RuntimeNamespace>;
}

export function createNativeEnvironment(
  context: NativeModuleContext,
): NativeEnvironment {
  const modules = new Map<string, RuntimeNamespace>([
    ["os", createOsModule(context)],
    ["term", createTermModule(context.terminal)],
    ["fs", createFsModule(context.filesystem)],
  ]);
  return { modules, moduleLoader: (name) => modules.get(name) };
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
