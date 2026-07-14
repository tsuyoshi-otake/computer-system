import type { SourceSpan } from "../../domain/language/source.js";
import { pythonBytecodeCpuCycles } from "../../domain/cpu/timing.js";
import { utf8ByteLength } from "../../domain/text/utf8.js";
import type {
  CodeObject,
  ExceptionHandlerCode,
  Instruction,
} from "../../domain/runtime/bytecode.js";
import {
  VmLimitError,
  VmMemoryError,
  VmRuntimeError,
} from "../../domain/runtime/errors.js";
import {
  isObjectValue,
  type ModuleLoader,
  type NativeFunction,
  type RuntimeIterator,
  type RuntimeNamespace,
  type RuntimeProgram,
  type RuntimeValue,
  type UserFunction,
  type VmWaitRequest,
  type VmWorkRequest,
} from "../../domain/runtime/value.js";

export interface VmLimits {
  readonly maxCallDepth: number;
  readonly maxCollectionSize: number;
  readonly maxStackSize: number;
  readonly maxStringLength: number;
  readonly maxMemoryBytes?: number;
}

export const defaultVmLimits: VmLimits = {
  maxCallDepth: 64,
  maxCollectionSize: 4_096,
  maxStackSize: 4_096,
  maxStringLength: 65_536,
  maxMemoryBytes: 1_048_576,
};

export type VmState =
  | { readonly kind: "ready" }
  | { readonly kind: "completed"; readonly value: RuntimeValue }
  | { readonly kind: "crashed"; readonly error: VmRuntimeError }
  | { readonly kind: "sleeping"; readonly wakeTick: number }
  | { readonly kind: "terminated"; readonly reason: string }
  | { readonly kind: "waiting_event"; readonly filter?: string };

export interface VmSliceResult {
  readonly cpuCycles: number;
  readonly executedInstructions: number;
  readonly state: VmState;
}

export class StackVm {
  readonly globals: Map<string, RuntimeValue>;
  private readonly frames: Frame[];
  private stateValue: VmState = { kind: "ready" };
  private tick = 0;
  private allocationPressureBytes = 0;
  private measuredMemoryBytes = 0;
  private readonly maxMemoryBytes: number;
  private cycleDebt = 0;

  constructor(
    program: RuntimeProgram,
    private readonly moduleLoader: ModuleLoader = () => undefined,
    private readonly limits: VmLimits = defaultVmLimits,
  ) {
    this.maxMemoryBytes = limits.maxMemoryBytes ?? 1_048_576;
    if (!Number.isSafeInteger(this.maxMemoryBytes) || this.maxMemoryBytes <= 0)
      throw new RangeError("maxMemoryBytes must be a positive integer");
    this.globals = new Map(program.globals ?? []);
    this.frames = [this.createFrame(program.code, this.globals, this.globals)];
    this.measuredMemoryBytes = this.measureMemoryBytes();
    if (this.measuredMemoryBytes > this.maxMemoryBytes)
      throw new VmMemoryError();
  }

  get state(): VmState {
    return this.stateValue;
  }

  get memoryUsageBytes(): number {
    this.measuredMemoryBytes = this.measureMemoryBytes();
    this.allocationPressureBytes = 0;
    return this.measuredMemoryBytes;
  }

  get memoryLimitBytes(): number {
    return this.maxMemoryBytes;
  }

  get hasPendingCpuCycles(): boolean {
    return this.cycleDebt > 0;
  }

  runSlice(instructionBudget: number): VmSliceResult {
    if (!Number.isInteger(instructionBudget) || instructionBudget <= 0) {
      throw new RangeError("instructionBudget must be a positive integer");
    }
    if (this.stateValue.kind !== "ready") {
      return { cpuCycles: 0, executedInstructions: 0, state: this.stateValue };
    }

    let cpuCycles = 0;
    let executedInstructions = 0;
    while (
      executedInstructions < instructionBudget &&
      this.stateValue.kind === "ready"
    ) {
      const frame = this.frames.at(-1);
      if (frame === undefined) {
        this.stateValue = { kind: "completed", value: null };
        break;
      }
      const instruction = frame.code.instructions[frame.ip];
      if (instruction === undefined) {
        this.crash(
          new VmRuntimeError(
            "RuntimeError",
            "Instruction pointer escaped code",
          ),
        );
        break;
      }
      frame.ip += 1;
      executedInstructions += 1;
      try {
        this.execute(frame, instruction);
      } catch (error: unknown) {
        const fault = normalizeFault(error, instruction.span);
        if (!this.handleFault(fault)) this.crash(fault);
      }
      cpuCycles += pythonBytecodeCpuCycles(instruction) + this.cycleDebt;
      this.cycleDebt = 0;
    }
    return { cpuCycles, executedInstructions, state: this.stateValue };
  }

  runCpuSlice(cpuCycleBudget: number): VmSliceResult {
    if (!Number.isSafeInteger(cpuCycleBudget) || cpuCycleBudget <= 0) {
      throw new RangeError("CPU cycle budget must be a positive safe integer");
    }
    if (this.stateValue.kind !== "ready" && this.cycleDebt === 0) {
      return { cpuCycles: 0, executedInstructions: 0, state: this.stateValue };
    }

    let cpuCycles = 0;
    let executedInstructions = 0;
    while (
      cpuCycles < cpuCycleBudget &&
      (this.stateValue.kind === "ready" || this.cycleDebt > 0)
    ) {
      if (this.cycleDebt > 0) {
        const paid = Math.min(this.cycleDebt, cpuCycleBudget - cpuCycles);
        this.cycleDebt -= paid;
        cpuCycles += paid;
        continue;
      }
      if (this.stateValue.kind !== "ready") break;
      const frame = this.frames.at(-1);
      if (frame === undefined) {
        this.stateValue = { kind: "completed", value: null };
        break;
      }
      const instruction = frame.code.instructions[frame.ip];
      if (instruction === undefined) {
        this.crash(
          new VmRuntimeError(
            "RuntimeError",
            "Instruction pointer escaped code",
          ),
        );
        break;
      }
      frame.ip += 1;
      executedInstructions += 1;
      try {
        this.execute(frame, instruction);
      } catch (error: unknown) {
        const fault = normalizeFault(error, instruction.span);
        if (!this.handleFault(fault)) this.crash(fault);
      }
      this.cycleDebt += pythonBytecodeCpuCycles(instruction);
    }
    return { cpuCycles, executedInstructions, state: this.stateValue };
  }

  advanceTick(tick = this.tick + 1): VmState {
    if (!Number.isInteger(tick) || tick < this.tick) {
      throw new RangeError("VM tick must advance monotonically");
    }
    this.tick = tick;
    if (
      this.stateValue.kind === "sleeping" &&
      tick >= this.stateValue.wakeTick
    ) {
      this.resume(null);
    }
    return this.stateValue;
  }

  deliverEvent(name: string, ...arguments_: readonly RuntimeValue[]): boolean {
    if (
      this.stateValue.kind !== "waiting_event" ||
      (this.stateValue.filter !== undefined && this.stateValue.filter !== name)
    ) {
      return false;
    }
    const event = { kind: "tuple" as const, values: [name, ...arguments_] };
    try {
      this.resume(event);
      this.noteAllocation(estimateRuntimeValue(event), undefined);
    } catch (error: unknown) {
      this.crash(normalizeFault(error));
      return false;
    }
    return true;
  }

  terminate(reason = "terminated"): VmState {
    if (!isTerminal(this.stateValue)) {
      this.frames.length = 0;
      this.stateValue = { kind: "terminated", reason };
    }
    return this.stateValue;
  }

  fail(error: VmRuntimeError): VmState {
    if (!isTerminal(this.stateValue)) this.crash(error);
    return this.stateValue;
  }

  private execute(frame: Frame, instruction: Instruction): void {
    switch (instruction.op) {
      case "LOAD_CONST":
        this.push(frame, instruction.value, instruction.span);
        this.noteAllocation(
          shallowRuntimeValueSize(instruction.value),
          instruction.span,
        );
        return;
      case "LOAD_NAME":
        this.push(
          frame,
          this.loadName(frame, instruction.name, instruction.span),
          instruction.span,
        );
        return;
      case "STORE_NAME":
        frame.locals.set(instruction.name, this.pop(frame, instruction.span));
        return;
      case "POP_TOP":
        this.pop(frame, instruction.span);
        return;
      case "BUILD_LIST":
      case "BUILD_TUPLE": {
        this.checkCollection(instruction.count, instruction.span);
        const values = this.popMany(frame, instruction.count, instruction.span);
        const collection =
          instruction.op === "BUILD_LIST"
            ? ({ kind: "list", values } as const)
            : ({ kind: "tuple", values } as const);
        this.push(frame, collection, instruction.span);
        this.noteAllocation(32 + values.length * 8, instruction.span);
        return;
      }
      case "BUILD_DICT": {
        this.checkCollection(instruction.count, instruction.span);
        const values = this.popMany(
          frame,
          instruction.count * 2,
          instruction.span,
        );
        const entries = new Map<RuntimeValue, RuntimeValue>();
        for (let index = 0; index < values.length; index += 2) {
          entries.set(values[index]!, values[index + 1]!);
        }
        this.push(frame, { kind: "dictionary", entries }, instruction.span);
        this.noteAllocation(48 + entries.size * 24, instruction.span);
        return;
      }
      case "BINARY": {
        const right = this.pop(frame, instruction.span);
        const left = this.pop(frame, instruction.span);
        const result = this.binary(
          left,
          right,
          instruction.operator,
          instruction.span,
        );
        this.push(frame, result, instruction.span);
        this.noteAllocation(shallowRuntimeValueSize(result), instruction.span);
        return;
      }
      case "UNARY": {
        const value = this.pop(frame, instruction.span);
        const result =
          instruction.operator === "not"
            ? !truthy(value)
            : instruction.operator === "+"
              ? requireNumber(value, instruction.span)
              : -requireNumber(value, instruction.span);
        this.push(frame, result, instruction.span);
        return;
      }
      case "COMPARE_CHAIN": {
        const values = this.popMany(
          frame,
          instruction.operators.length + 1,
          instruction.span,
        );
        const result = instruction.operators.every((operator, index) =>
          compare(
            values[index]!,
            values[index + 1]!,
            operator,
            instruction.span,
          ),
        );
        this.push(frame, result, instruction.span);
        return;
      }
      case "JUMP":
        frame.ip = instruction.target;
        return;
      case "JUMP_IF_FALSE":
        if (!truthy(this.pop(frame, instruction.span)))
          frame.ip = instruction.target;
        return;
      case "JUMP_IF_FALSE_OR_POP":
        if (!truthy(this.peekStack(frame, instruction.span)))
          frame.ip = instruction.target;
        else this.pop(frame, instruction.span);
        return;
      case "JUMP_IF_TRUE_OR_POP":
        if (truthy(this.peekStack(frame, instruction.span)))
          frame.ip = instruction.target;
        else this.pop(frame, instruction.span);
        return;
      case "LOOP_CONTROL":
        this.handleControl({
          kind: "loop",
          target:
            instruction.action === "break"
              ? instruction.target.breakTarget
              : instruction.target.continueTarget,
        });
        return;
      case "LOAD_ATTRIBUTE": {
        const object = this.pop(frame, instruction.span);
        this.push(
          frame,
          loadAttribute(object, instruction.name, instruction.span),
          instruction.span,
        );
        return;
      }
      case "STORE_ATTRIBUTE": {
        const value = this.pop(frame, instruction.span);
        const object = this.pop(frame, instruction.span);
        if (
          typeof object !== "object" ||
          object === null ||
          object.kind !== "namespace"
        ) {
          throw new VmRuntimeError(
            "TypeError",
            "Object attributes are not writable",
            instruction.span,
          );
        }
        object.values.set(instruction.name, value);
        return;
      }
      case "LOAD_SUBSCRIPT": {
        const index = this.pop(frame, instruction.span);
        const object = this.pop(frame, instruction.span);
        this.push(
          frame,
          loadSubscript(object, index, instruction.span),
          instruction.span,
        );
        return;
      }
      case "STORE_SUBSCRIPT": {
        const value = this.pop(frame, instruction.span);
        const index = this.pop(frame, instruction.span);
        const object = this.pop(frame, instruction.span);
        const growsDictionary =
          typeof object === "object" &&
          object !== null &&
          object.kind === "dictionary" &&
          !object.entries.has(index);
        if (growsDictionary) {
          this.checkCollection(object.entries.size + 1, instruction.span);
        }
        storeSubscript(object, index, value, instruction.span);
        if (growsDictionary) this.noteAllocation(24, instruction.span);
        return;
      }
      case "FORMAT": {
        const parts = this.popMany(frame, instruction.count, instruction.span);
        const value = parts.map(formatValue).join("");
        this.checkString(value, instruction.span);
        this.push(frame, value, instruction.span);
        this.noteAllocation(shallowRuntimeValueSize(value), instruction.span);
        return;
      }
      case "GET_ITER": {
        const value = this.pop(frame, instruction.span);
        const iterator = iteratorValue(value, instruction.span);
        this.push(frame, iterator, instruction.span);
        this.noteAllocation(estimateRuntimeValue(iterator), instruction.span);
        return;
      }
      case "FOR_ITER": {
        const iterator = this.peekStack(frame, instruction.span);
        if (!isIterator(iterator)) {
          throw new VmRuntimeError(
            "TypeError",
            "FOR_ITER expected an iterator",
            instruction.span,
          );
        }
        if (iterator.index >= iterator.values.length) {
          this.pop(frame, instruction.span);
          frame.ip = instruction.target;
        } else {
          this.push(
            frame,
            iterator.values[iterator.index++]!,
            instruction.span,
          );
        }
        return;
      }
      case "MAKE_FUNCTION": {
        const defaults = this.popMany(
          frame,
          instruction.defaultCount,
          instruction.span,
        );
        const callable = {
          kind: "function" as const,
          prototype: instruction.prototype,
          defaults,
          globals: frame.globals,
        };
        this.push(frame, callable, instruction.span);
        this.noteAllocation(64 + defaults.length * 8, instruction.span);
        return;
      }
      case "CALL":
        this.call(frame, instruction);
        return;
      case "IMPORT": {
        const module = this.moduleLoader(instruction.module);
        if (module === undefined) {
          throw new VmRuntimeError(
            "ImportError",
            `Module ${instruction.module} is not allowlisted`,
            instruction.span,
          );
        }
        frame.locals.set(instruction.alias, module);
        return;
      }
      case "TRY":
        this.pushBlockFrame(frame, instruction.body, {
          kind: "try_body",
          parent: frame,
          handlers: instruction.handlers,
          elseCode: instruction.elseCode,
          finallyCode: instruction.finallyCode,
        });
        return;
      case "END_BLOCK":
        this.finishBlock(frame);
        return;
      case "RETURN": {
        const value =
          frame.stack.length === 0 ? null : this.pop(frame, instruction.span);
        this.returnFrom(frame, value);
        return;
      }
      case "RAISE": {
        const value = this.pop(frame, instruction.span);
        if (value === null && frame.activeException !== undefined)
          throw frame.activeException;
        if (
          value !== null &&
          typeof value === "object" &&
          value.kind === "namespace"
        ) {
          const message = value.values.get("message");
          throw new VmRuntimeError(
            value.name,
            typeof message === "string" ? message : formatValue(value),
            instruction.span,
            value,
          );
        }
        throw new VmRuntimeError(
          "RuntimeError",
          formatValue(value),
          instruction.span,
          value,
        );
      }
      case "BREAKPOINT":
        return;
    }
  }

  private call(
    frame: Frame,
    instruction: Extract<Instruction, { op: "CALL" }>,
  ): void {
    const values = this.popMany(
      frame,
      instruction.argumentNames.length,
      instruction.span,
    );
    const callee = this.pop(frame, instruction.span);
    const positional: RuntimeValue[] = [];
    const keywords = new Map<string, RuntimeValue>();
    instruction.argumentNames.forEach((name, index) => {
      const value = values[index]!;
      if (name === undefined) positional.push(value);
      else if (keywords.has(name)) {
        throw new VmRuntimeError(
          "TypeError",
          `Multiple values for argument ${name}`,
          instruction.span,
        );
      } else keywords.set(name, value);
    });
    if (!isObjectValue(callee)) {
      throw new VmRuntimeError(
        "TypeError",
        `${formatValue(callee)} is not callable`,
        instruction.span,
      );
    }
    if (callee.kind === "native_function") {
      const result = callee.call(positional, keywords);
      if (isWaitRequest(result)) this.wait(frame, result, instruction.span);
      else {
        const value = isWorkRequest(result) ? result.value : result;
        this.push(frame, value, instruction.span);
        this.noteAllocation(estimateRuntimeValue(value), instruction.span);
        if (isWorkRequest(result)) {
          if (!Number.isSafeInteger(result.cycles) || result.cycles <= 0) {
            throw new VmRuntimeError(
              "ValueError",
              "Native work cycles must be a positive safe integer",
              instruction.span,
            );
          }
          this.cycleDebt += result.cycles;
        }
      }
      return;
    }
    if (callee.kind !== "function") {
      throw new VmRuntimeError(
        "TypeError",
        `${callee.kind} is not callable`,
        instruction.span,
      );
    }
    this.callUserFunction(callee, positional, keywords, instruction.span);
  }

  private callUserFunction(
    callable: UserFunction,
    positional: readonly RuntimeValue[],
    keywords: ReadonlyMap<string, RuntimeValue>,
    span: SourceSpan,
  ): void {
    if (
      this.frames.filter(({ code }) => code.kind === "function").length >=
      this.limits.maxCallDepth
    ) {
      throw new VmLimitError("call depth", span);
    }
    const { parameters, requiredParameters } = callable.prototype;
    if (positional.length > parameters.length) {
      throw new VmRuntimeError(
        "TypeError",
        "Too many positional arguments",
        span,
      );
    }
    const locals = new Map<string, RuntimeValue>();
    positional.forEach((value, index) => locals.set(parameters[index]!, value));
    for (const [name, value] of keywords) {
      if (!parameters.includes(name) || locals.has(name)) {
        throw new VmRuntimeError(
          "TypeError",
          `Unexpected or duplicate argument ${name}`,
          span,
        );
      }
      locals.set(name, value);
    }
    parameters.forEach((name, index) => {
      if (!locals.has(name) && index >= requiredParameters) {
        locals.set(name, callable.defaults[index - requiredParameters]!);
      }
    });
    const missing = parameters.find((name) => !locals.has(name));
    if (missing !== undefined) {
      throw new VmRuntimeError(
        "TypeError",
        `Missing required argument ${missing}`,
        span,
      );
    }
    this.frames.push(
      this.createFrame(callable.prototype.code, locals, callable.globals),
    );
  }

  private wait(frame: Frame, request: VmWaitRequest, span: SourceSpan): void {
    if (request.kind === "sleep") {
      if (!Number.isInteger(request.ticks) || request.ticks < 0) {
        throw new VmRuntimeError(
          "ValueError",
          "Sleep ticks must be non-negative",
          span,
        );
      }
      this.stateValue = {
        kind: "sleeping",
        wakeTick: this.tick + request.ticks,
      };
    } else {
      this.stateValue = { kind: "waiting_event", filter: request.filter };
    }
    frame.awaitingResume = true;
  }

  private resume(value: RuntimeValue): void {
    const frame = this.frames.at(-1);
    if (frame === undefined || !frame.awaitingResume) {
      this.crash(
        new VmRuntimeError("RuntimeError", "No suspended call owns the resume"),
      );
      return;
    }
    frame.awaitingResume = false;
    this.stateValue = { kind: "ready" };
    this.push(
      frame,
      value,
      frame.code.instructions[Math.max(0, frame.ip - 1)]?.span,
    );
  }

  private returnFrom(frame: Frame, value: RuntimeValue): void {
    if (frame.code.kind === "block") {
      this.handleControl({ kind: "return", value });
      return;
    }
    this.frames.pop();
    const parent = this.frames.at(-1);
    if (parent === undefined) this.stateValue = { kind: "completed", value };
    else this.push(parent, value);
  }

  private noteAllocation(bytes: number, span?: SourceSpan): void {
    this.allocationPressureBytes += Math.max(0, Math.ceil(bytes));
    if (
      this.measuredMemoryBytes + this.allocationPressureBytes <=
      this.maxMemoryBytes
    ) {
      return;
    }
    this.measuredMemoryBytes = this.measureMemoryBytes();
    this.allocationPressureBytes = 0;
    if (this.measuredMemoryBytes > this.maxMemoryBytes)
      throw new VmMemoryError(span);
  }

  private measureMemoryBytes(): number {
    const seen = new Set<object>();
    let bytes = 0;
    for (const frame of this.frames) {
      bytes += 128 + frame.stack.length * 8 + frame.locals.size * 24;
      for (const [name, value] of frame.locals) {
        bytes += utf8Bytes(name) + estimateRuntimeValue(value, seen);
      }
      for (const value of frame.stack)
        bytes += estimateRuntimeValue(value, seen);
    }
    if (this.stateValue.kind === "completed")
      bytes += estimateRuntimeValue(this.stateValue.value, seen);
    return bytes;
  }

  private finishBlock(frame: Frame): void {
    const continuation = frame.continuation;
    if (continuation === undefined) {
      throw new VmRuntimeError("RuntimeError", "Block has no continuation");
    }
    this.frames.pop();
    if (continuation.kind === "try_body") {
      if (continuation.elseCode !== undefined) {
        this.pushBlockFrame(continuation.parent, continuation.elseCode, {
          kind: "try_else",
          parent: continuation.parent,
          finallyCode: continuation.finallyCode,
        });
      } else {
        this.runFinallyOrContinue(
          continuation.parent,
          continuation.finallyCode,
        );
      }
    } else if (
      continuation.kind === "try_handler" ||
      continuation.kind === "try_else"
    ) {
      this.runFinallyOrContinue(continuation.parent, continuation.finallyCode);
    } else if (
      continuation.kind === "try_finally" &&
      continuation.pendingControl !== undefined
    ) {
      this.handleControl(continuation.pendingControl);
    } else if (
      continuation.kind === "try_finally" &&
      continuation.pendingFault !== undefined
    ) {
      if (!this.handleFault(continuation.pendingFault))
        this.crash(continuation.pendingFault);
    }
  }

  private runFinallyOrContinue(parent: Frame, finallyCode?: CodeObject): void {
    if (finallyCode !== undefined) {
      this.pushBlockFrame(parent, finallyCode, { kind: "try_finally", parent });
    }
  }

  private handleFault(fault: VmRuntimeError): boolean {
    while (this.frames.length > 0) {
      const frame = this.frames.at(-1)!;
      const continuation = frame.continuation;
      if (continuation?.kind === "try_body") {
        this.frames.pop();
        const handler = continuation.handlers.find(({ typeName }) =>
          handlerMatches(typeName, fault.typeName),
        );
        if (handler !== undefined) {
          if (handler.name !== undefined)
            continuation.parent.locals.set(handler.name, faultValue(fault));
          const handlerFrame = this.pushBlockFrame(
            continuation.parent,
            handler.code,
            {
              kind: "try_handler",
              parent: continuation.parent,
              finallyCode: continuation.finallyCode,
            },
          );
          handlerFrame.activeException = fault;
          return true;
        }
        if (continuation.finallyCode !== undefined) {
          this.pushBlockFrame(continuation.parent, continuation.finallyCode, {
            kind: "try_finally",
            parent: continuation.parent,
            pendingFault: fault,
          });
          return true;
        }
        continue;
      }
      if (
        continuation !== undefined &&
        (continuation.kind === "try_handler" ||
          continuation.kind === "try_else") &&
        continuation.finallyCode !== undefined
      ) {
        this.frames.pop();
        this.pushBlockFrame(continuation.parent, continuation.finallyCode, {
          kind: "try_finally",
          parent: continuation.parent,
          pendingFault: fault,
        });
        return true;
      }
      this.frames.pop();
    }
    return false;
  }

  private handleControl(control: Control): void {
    while (this.frames.length > 0) {
      const frame = this.frames.at(-1)!;
      const continuation = frame.continuation;
      if (
        continuation !== undefined &&
        continuation.kind !== "try_finally" &&
        continuation.finallyCode !== undefined
      ) {
        this.frames.pop();
        this.pushBlockFrame(continuation.parent, continuation.finallyCode, {
          kind: "try_finally",
          parent: continuation.parent,
          pendingControl: control,
        });
        return;
      }
      if (control.kind === "loop") {
        if (frame.code.kind !== "block") {
          if (control.target < 0) {
            this.crash(
              new VmRuntimeError(
                "RuntimeError",
                "Loop target was not finalized",
              ),
            );
          } else {
            frame.ip = control.target;
          }
          return;
        }
        this.frames.pop();
        continue;
      }
      this.frames.pop();
      if (frame.code.kind === "function" || frame.code.kind === "module") {
        const parent = this.frames.at(-1);
        if (parent === undefined)
          this.stateValue = { kind: "completed", value: control.value };
        else this.push(parent, control.value);
        return;
      }
    }
    if (control.kind === "loop") {
      this.crash(
        new VmRuntimeError(
          "RuntimeError",
          "Loop control escaped its owning frame",
        ),
      );
    } else {
      this.stateValue = { kind: "completed", value: control.value };
    }
  }

  private pushBlockFrame(
    parent: Frame,
    code: CodeObject,
    continuation: Continuation,
  ): Frame {
    const frame = this.createFrame(
      code,
      parent.locals,
      parent.globals,
      continuation,
    );
    frame.activeException = parent.activeException;
    this.frames.push(frame);
    return frame;
  }

  private createFrame(
    code: CodeObject,
    locals: Map<string, RuntimeValue>,
    globals: Map<string, RuntimeValue>,
    continuation?: Continuation,
  ): Frame {
    return {
      code,
      ip: 0,
      stack: [],
      locals,
      globals,
      continuation,
      awaitingResume: false,
    };
  }

  private loadName(frame: Frame, name: string, span: SourceSpan): RuntimeValue {
    if (frame.locals.has(name)) return frame.locals.get(name)!;
    if (frame.globals.has(name)) return frame.globals.get(name)!;
    if (name === "range") return this.rangeFunction();
    if (exceptionNames.has(name)) return exceptionConstructor(name);
    const builtin = builtins.get(name);
    if (builtin !== undefined) return builtin;
    throw new VmRuntimeError("NameError", `Name ${name} is not defined`, span);
  }

  private rangeFunction(): NativeFunction {
    return native("range", (positional, keywords) => {
      if (keywords.size > 0 || positional.length < 1 || positional.length > 3) {
        throw new VmRuntimeError(
          "TypeError",
          "range expects one to three positional arguments",
        );
      }
      const numbers = positional.map((value) => requireNumber(value));
      const [start, stop, step] =
        numbers.length === 1
          ? [0, numbers[0]!, 1]
          : [numbers[0]!, numbers[1]!, numbers[2] ?? 1];
      if (step === 0)
        throw new VmRuntimeError("ValueError", "range step cannot be zero");
      const values: RuntimeValue[] = [];
      for (
        let value = start;
        step > 0 ? value < stop : value > stop;
        value += step
      ) {
        values.push(value);
        this.checkCollection(values.length);
      }
      return { kind: "list", values };
    });
  }

  private binary(
    left: RuntimeValue,
    right: RuntimeValue,
    operator: Extract<Instruction, { op: "BINARY" }>["operator"],
    span: SourceSpan,
  ): RuntimeValue {
    if (
      operator === "+" &&
      typeof left === "string" &&
      typeof right === "string"
    ) {
      const value = left + right;
      this.checkString(value, span);
      return value;
    }
    if (
      operator === "+" &&
      isSequence(left) &&
      isSequence(right) &&
      left.kind === right.kind
    ) {
      this.checkCollection(left.values.length + right.values.length, span);
      return left.kind === "list"
        ? { kind: "list", values: [...left.values, ...right.values] }
        : { kind: "tuple", values: [...left.values, ...right.values] };
    }
    const leftNumber = requireNumber(left, span);
    const rightNumber = requireNumber(right, span);
    if (
      (operator === "/" || operator === "//" || operator === "%") &&
      rightNumber === 0
    ) {
      throw new VmRuntimeError("ZeroDivisionError", "division by zero", span);
    }
    if (operator === "+") return leftNumber + rightNumber;
    if (operator === "-") return leftNumber - rightNumber;
    if (operator === "*") return leftNumber * rightNumber;
    if (operator === "/") return leftNumber / rightNumber;
    if (operator === "//") return Math.floor(leftNumber / rightNumber);
    if (operator === "%")
      return ((leftNumber % rightNumber) + rightNumber) % rightNumber;
    return leftNumber ** rightNumber;
  }

  private push(frame: Frame, value: RuntimeValue, span?: SourceSpan): void {
    if (typeof value === "string") this.checkString(value, span);
    if (isSequence(value)) this.checkCollection(value.values.length, span);
    if (
      typeof value === "object" &&
      value !== null &&
      value.kind === "dictionary"
    ) {
      this.checkCollection(value.entries.size, span);
    }
    if (frame.stack.length >= this.limits.maxStackSize)
      throw new VmLimitError("stack", span);
    frame.stack.push(value);
  }

  private pop(frame: Frame, span?: SourceSpan): RuntimeValue {
    const value = frame.stack.pop();
    if (value === undefined)
      throw new VmRuntimeError("RuntimeError", "Stack underflow", span);
    return value;
  }

  private popMany(
    frame: Frame,
    count: number,
    span?: SourceSpan,
  ): RuntimeValue[] {
    if (count === 0) return [];
    if (frame.stack.length < count)
      throw new VmRuntimeError("RuntimeError", "Stack underflow", span);
    return frame.stack.splice(frame.stack.length - count, count);
  }

  private peekStack(frame: Frame, span?: SourceSpan): RuntimeValue {
    const value = frame.stack.at(-1);
    if (value === undefined)
      throw new VmRuntimeError("RuntimeError", "Stack underflow", span);
    return value;
  }

  private checkCollection(size: number, span?: SourceSpan): void {
    if (size > this.limits.maxCollectionSize)
      throw new VmLimitError("collection", span);
  }

  private checkString(value: string, span?: SourceSpan): void {
    if (value.length > this.limits.maxStringLength)
      throw new VmLimitError("string", span);
  }

  private crash(error: VmRuntimeError): void {
    this.frames.length = 0;
    this.stateValue = { kind: "crashed", error };
  }
}

interface Frame {
  readonly code: CodeObject;
  ip: number;
  readonly stack: RuntimeValue[];
  readonly locals: Map<string, RuntimeValue>;
  readonly globals: Map<string, RuntimeValue>;
  readonly continuation?: Continuation;
  awaitingResume: boolean;
  activeException?: VmRuntimeError;
}

type Continuation =
  | {
      readonly kind: "try_body";
      readonly parent: Frame;
      readonly handlers: readonly ExceptionHandlerCode[];
      readonly elseCode?: CodeObject;
      readonly finallyCode?: CodeObject;
    }
  | {
      readonly kind: "try_else" | "try_handler";
      readonly parent: Frame;
      readonly finallyCode?: CodeObject;
    }
  | {
      readonly kind: "try_finally";
      readonly parent: Frame;
      readonly pendingFault?: VmRuntimeError;
      readonly pendingControl?: Control;
    };

interface ReturnControl {
  readonly kind: "return";
  readonly value: RuntimeValue;
}

interface LoopControl {
  readonly kind: "loop";
  readonly target: number;
}

type Control = ReturnControl | LoopControl;

const builtins = new Map<string, RuntimeValue>([
  [
    "len",
    native("len", (positional) => {
      if (positional.length !== 1)
        throw new VmRuntimeError("TypeError", "len expects one argument");
      const value = positional[0]!;
      if (typeof value === "string") return value.length;
      if (isSequence(value)) return value.values.length;
      if (
        typeof value === "object" &&
        value !== null &&
        value.kind === "dictionary"
      ) {
        return value.entries.size;
      }
      throw new VmRuntimeError("TypeError", "object has no len");
    }),
  ],
]);

const exceptionNames = new Set([
  "Exception",
  "RuntimeError",
  "TypeError",
  "ValueError",
  "NameError",
  "IndexError",
  "KeyError",
  "ImportError",
]);

function exceptionConstructor(typeName: string): NativeFunction {
  return native(typeName, (positional, keywords) => {
    if (keywords.size > 0 || positional.length > 1) {
      throw new VmRuntimeError(
        "TypeError",
        `${typeName} expects zero or one positional argument`,
      );
    }
    return {
      kind: "namespace",
      name: typeName,
      values: new Map([
        ["message", positional.length === 0 ? "" : formatValue(positional[0]!)],
      ]),
    };
  });
}

function native(name: string, call: NativeFunction["call"]): NativeFunction {
  return { kind: "native_function", name, call };
}

function normalizeFault(error: unknown, span?: SourceSpan): VmRuntimeError {
  if (error instanceof VmRuntimeError) return error;
  return new VmRuntimeError(
    "RuntimeError",
    error instanceof Error ? error.message : String(error),
    span,
  );
}

function faultValue(fault: VmRuntimeError): RuntimeNamespace {
  return {
    kind: "namespace",
    name: fault.typeName,
    values: new Map([
      ["type", fault.typeName],
      ["message", fault.message],
    ]),
  };
}

function handlerMatches(
  typeName: string | undefined,
  faultTypeName: string,
): boolean {
  return (
    typeName === undefined ||
    typeName === "Exception" ||
    typeName === faultTypeName
  );
}

function truthy(value: RuntimeValue): boolean {
  if (value === null || value === false) return false;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") return value.length !== 0;
  if (isSequence(value)) return value.values.length !== 0;
  if (typeof value === "object" && value.kind === "dictionary")
    return value.entries.size !== 0;
  return true;
}

function requireNumber(value: RuntimeValue, span?: SourceSpan): number {
  if (typeof value !== "number") {
    throw new VmRuntimeError(
      "TypeError",
      `Expected number, got ${formatValue(value)}`,
      span,
    );
  }
  return value;
}

function formatValue(value: RuntimeValue): string {
  if (value === null) return "None";
  if (value === true) return "True";
  if (value === false) return "False";
  if (typeof value === "string" || typeof value === "number")
    return String(value);
  if (isSequence(value)) return value.values.map(formatValue).join(", ");
  if (value.kind === "dictionary")
    return `{${[...value.entries].map(([key, item]) => `${formatValue(key)}: ${formatValue(item)}`).join(", ")}}`;
  return `<${value.kind}>`;
}

function compare(
  left: RuntimeValue,
  right: RuntimeValue,
  operator: Extract<Instruction, { op: "COMPARE_CHAIN" }>["operators"][number],
  span: SourceSpan,
): boolean {
  if (operator === "==" || operator === "is") return left === right;
  if (operator === "!=" || operator === "is not") return left !== right;
  if (operator === "in" || operator === "not in") {
    const contained = contains(right, left, span);
    return operator === "in" ? contained : !contained;
  }
  if (!(
    (typeof left === "number" && typeof right === "number") ||
    (typeof left === "string" && typeof right === "string")
  )) {
    throw new VmRuntimeError("TypeError", "Values are not orderable", span);
  }
  if (operator === "<") return left < right;
  if (operator === "<=") return left <= right;
  if (operator === ">") return left > right;
  return left >= right;
}

function contains(
  container: RuntimeValue,
  item: RuntimeValue,
  span: SourceSpan,
): boolean {
  if (typeof container === "string" && typeof item === "string")
    return container.includes(item);
  if (isSequence(container)) return container.values.includes(item);
  if (
    typeof container === "object" &&
    container !== null &&
    container.kind === "dictionary"
  ) {
    return container.entries.has(item);
  }
  throw new VmRuntimeError("TypeError", "Value is not a container", span);
}

function loadAttribute(
  object: RuntimeValue,
  name: string,
  span: SourceSpan,
): RuntimeValue {
  if (
    typeof object === "object" &&
    object !== null &&
    object.kind === "namespace"
  ) {
    const value = object.values.get(name);
    if (value !== undefined) return value;
  }
  throw new VmRuntimeError(
    "AttributeError",
    `Attribute ${name} does not exist`,
    span,
  );
}

function loadSubscript(
  object: RuntimeValue,
  index: RuntimeValue,
  span: SourceSpan,
): RuntimeValue {
  if (typeof object === "string")
    return object[normalizeIndex(index, object.length, span)] ?? "";
  if (isSequence(object)) {
    const value =
      object.values[normalizeIndex(index, object.values.length, span)];
    if (value === undefined)
      throw new VmRuntimeError("IndexError", "index out of range", span);
    return value;
  }
  if (
    typeof object === "object" &&
    object !== null &&
    object.kind === "dictionary"
  ) {
    if (!object.entries.has(index))
      throw new VmRuntimeError("KeyError", formatValue(index), span);
    return object.entries.get(index)!;
  }
  throw new VmRuntimeError("TypeError", "Value is not subscriptable", span);
}

function storeSubscript(
  object: RuntimeValue,
  index: RuntimeValue,
  value: RuntimeValue,
  span: SourceSpan,
): void {
  if (typeof object === "object" && object !== null && object.kind === "list") {
    object.values[normalizeIndex(index, object.values.length, span)] = value;
    return;
  }
  if (
    typeof object === "object" &&
    object !== null &&
    object.kind === "dictionary"
  ) {
    object.entries.set(index, value);
    return;
  }
  throw new VmRuntimeError("TypeError", "Subscript is not writable", span);
}

function normalizeIndex(
  index: RuntimeValue,
  length: number,
  span: SourceSpan,
): number {
  if (typeof index !== "number" || !Number.isInteger(index)) {
    throw new VmRuntimeError("TypeError", "Index must be an integer", span);
  }
  const normalized = index < 0 ? length + index : index;
  if (normalized < 0 || normalized >= length) {
    throw new VmRuntimeError("IndexError", "index out of range", span);
  }
  return normalized;
}

function iteratorValue(value: RuntimeValue, span: SourceSpan): RuntimeIterator {
  let sequence: readonly RuntimeValue[];
  if (typeof value === "string") sequence = [...value];
  else if (isSequence(value)) sequence = value.values;
  else if (
    typeof value === "object" &&
    value !== null &&
    value.kind === "dictionary"
  ) {
    sequence = [...value.entries.keys()];
  } else throw new VmRuntimeError("TypeError", "Value is not iterable", span);
  return { kind: "iterator", values: sequence, index: 0 };
}

function isIterator(value: RuntimeValue): value is RuntimeIterator {
  return (
    typeof value === "object" && value !== null && value.kind === "iterator"
  );
}

function shallowRuntimeValueSize(value: RuntimeValue): number {
  if (typeof value === "string") return 16 + utf8Bytes(value);
  if (typeof value !== "object" || value === null) return 8;
  switch (value.kind) {
    case "list":
    case "tuple":
    case "iterator":
      return 32 + value.values.length * 8;
    case "dictionary":
      return 48 + value.entries.size * 24;
    case "namespace":
      return 48 + value.values.size * 24 + utf8Bytes(value.name);
    case "function":
      return 64 + value.defaults.length * 8;
    case "native_function":
      return 48 + utf8Bytes(value.name);
  }
}

function estimateRuntimeValue(
  value: RuntimeValue,
  seen: Set<object> = new Set(),
): number {
  if (typeof value === "string") return 16 + utf8Bytes(value);
  if (typeof value !== "object" || value === null) return 8;
  if (seen.has(value)) return 8;
  seen.add(value);
  let bytes = shallowRuntimeValueSize(value);
  switch (value.kind) {
    case "list":
    case "tuple":
    case "iterator":
      for (const item of value.values)
        bytes += estimateRuntimeValue(item, seen);
      return bytes;
    case "dictionary":
      for (const [key, item] of value.entries) {
        bytes += estimateRuntimeValue(key, seen);
        bytes += estimateRuntimeValue(item, seen);
      }
      return bytes;
    case "namespace":
      for (const [name, item] of value.values) {
        bytes += utf8Bytes(name) + estimateRuntimeValue(item, seen);
      }
      return bytes;
    case "function":
      for (const item of value.defaults)
        bytes += estimateRuntimeValue(item, seen);
      for (const [name, item] of value.globals) {
        bytes += utf8Bytes(name) + estimateRuntimeValue(item, seen);
      }
      return bytes;
    case "native_function":
      return bytes;
  }
}

function utf8Bytes(value: string): number {
  return utf8ByteLength(value);
}

function isSequence(
  value: RuntimeValue,
): value is Extract<RuntimeValue, { kind: "list" | "tuple" }> {
  return (
    typeof value === "object" &&
    value !== null &&
    (value.kind === "list" || value.kind === "tuple")
  );
}

function isWaitRequest(
  value: RuntimeValue | VmWaitRequest | VmWorkRequest,
): value is VmWaitRequest {
  return (
    typeof value === "object" &&
    value !== null &&
    "kind" in value &&
    (value.kind === "sleep" || value.kind === "wait_event")
  );
}

function isWorkRequest(
  value: RuntimeValue | VmWaitRequest | VmWorkRequest,
): value is VmWorkRequest {
  return (
    typeof value === "object" &&
    value !== null &&
    "kind" in value &&
    value.kind === "work"
  );
}

function isTerminal(state: VmState): boolean {
  return (
    state.kind === "completed" ||
    state.kind === "crashed" ||
    state.kind === "terminated"
  );
}
