/** Compiles bounded CS-Linux Perl control flow onto the sole CS486 process. */

import {
  Cs486Process,
  cs486ExecutableMemoryRequirements,
  createCs486Flat32MemoryMetadata,
  type Cs486ExecutableMemoryRequirements,
  type Cs486ExecutableV3,
  type Cs486Instruction,
  type Cs486SyscallContext,
  type Cs486SyscallResult,
} from "../../domain/cpu/cs486.js";
import type { CpuModel } from "../../domain/cpu/models.js";
import {
  PerlInterpreter,
  type LinuxPerlIo,
  type LinuxPerlOptions,
  type LinuxPerlResult,
  type PerlValue,
} from "../os/linuxPerl.js";
import {
  parsePerlProgram,
  type PerlBlock,
  type PerlExpression,
  type PerlProgram,
  type PerlStatement,
} from "../os/linuxPerlParser.js";
import {
  managedBinaryWorkCycles,
  managedCollectionWorkCycles,
  managedLoadWorkCycles,
  managedRuntimeCost,
  managedStoreWorkCycles,
  managedStringWorkCycles,
} from "./managedRuntimeCost.js";

const perlSyscallName = "cs.perl.operation";
const managedRuntimeBytes = 256 * 1_024;

type PerlOperation =
  | {
      readonly expression: PerlExpression;
      readonly dependencies: readonly PerlExpression[];
      readonly kind: "evaluate";
    }
  | { readonly kind: "begin" }
  | { readonly kind: "push_scope" | "pop_scope" }
  | { readonly kind: "input_begin" | "input_finish" }
  | { readonly kind: "discard" }
  | { readonly kind: "complete" }
  | { readonly kind: "statement"; readonly statement: PerlStatement }
  | {
      readonly kind:
        "foreach_begin" | "foreach_next" | "foreach_iteration" | "foreach_end";
      readonly statement: PerlStatement & { readonly kind: "foreach" };
    };

export interface PerlCs486Program {
  readonly executable: Cs486ExecutableV3;
  readonly process: Cs486Process;
  readonly result: () => LinuxPerlResult | undefined;
}

export interface PreparedPerlCs486Program {
  readonly executable: Cs486ExecutableV3;
  readonly requirements: Cs486ExecutableMemoryRequirements;
  create(memoryBytes: number): PerlCs486Program;
}

export interface PerlCs486PreparationOptions {
  readonly collectMicroarchitectureStats?: boolean;
  readonly cpuModel: CpuModel;
  readonly io: LinuxPerlIo;
  readonly options: LinuxPerlOptions;
  readonly scriptArguments: readonly string[];
  readonly stdin: string;
}

export function preparePerlCs486Program(
  options: PerlCs486PreparationOptions,
): PreparedPerlCs486Program {
  const program = parsePerlProgram(options.options.source);
  const compiler = new PerlCs486Compiler(program, options.options);
  const compilation = compiler.compile();
  const executable: Cs486ExecutableV3 = {
    format: "cs486-executable",
    instructions: compilation.instructions,
    memory: createCs486Flat32MemoryMetadata({
      auxiliaryResidentBytes: managedRuntimeBytes,
    }),
    version: 3,
  };
  const requirements = cs486ExecutableMemoryRequirements(executable);
  if (requirements.kind !== "declared")
    throw new Error("Perl compiler produced a legacy CS486 executable");
  return Object.freeze({
    executable,
    requirements,
    create(memoryBytes: number): PerlCs486Program {
      const interpreter = new PerlInterpreter(
        options.options,
        options.scriptArguments,
        options.stdin,
        options.io,
      );
      const runtime = new PerlCs486Runtime(
        interpreter,
        program.body,
        compilation.operations,
      );
      const process = new Cs486Process(executable, {
        collectMicroarchitectureStats: options.collectMicroarchitectureStats,
        cpuModel: options.cpuModel,
        externalMemoryUsageBytes: (): number => managedRuntimeBytes,
        memoryBytes,
        syscallHandler: (
          name: string,
          context: Cs486SyscallContext,
        ): Cs486SyscallResult => runtime.syscall(name, context),
      });
      return { executable, process, result: () => runtime.result };
    },
  });
}

interface PerlCompilation {
  readonly instructions: readonly Cs486Instruction[];
  readonly operations: readonly PerlOperation[];
}

class PerlCs486Compiler {
  private readonly instructions: Cs486Instruction[] = [];
  private readonly operations: PerlOperation[] = [];
  private readonly loops: {
    readonly breakJumps: number[];
    readonly continueJumps: number[];
    continueTarget: number;
  }[] = [];

  constructor(
    private readonly program: PerlProgram,
    private readonly options: LinuxPerlOptions,
  ) {}

  compile(): PerlCompilation {
    this.emitOperation({ kind: "begin" });
    if (this.program.body.statements.length === 0) {
      this.emitOperation({ kind: "complete" });
      return { instructions: this.instructions, operations: this.operations };
    }
    if (this.options.loop === "none") {
      this.block(this.program.body);
    } else {
      const input = this.instructions.length;
      this.emitOperation({ kind: "input_begin" });
      this.emit({ op: "cmp", left: "eax", right: immediate(0) });
      const done = this.emitJump("je");
      const loop = {
        breakJumps: [] as number[],
        continueJumps: [] as number[],
        continueTarget: input,
      };
      this.loops.push(loop);
      this.block(this.program.body);
      this.loops.pop();
      this.emitOperation({ kind: "input_finish" });
      this.emit({ op: "jmp", target: input });
      this.patch(done, this.instructions.length);
      for (const jump of loop.breakJumps)
        this.patch(jump, this.instructions.length);
    }
    this.emitOperation({ kind: "complete" });
    if (this.instructions.length > 65_536)
      throw new RangeError("perl: compiled instruction limit exceeded");
    return { instructions: this.instructions, operations: this.operations };
  }

  private block(block: PerlBlock): void {
    for (const statement of block.statements) this.statement(statement);
  }

  private statement(statement: PerlStatement): void {
    switch (statement.kind) {
      case "expression":
        this.expression(statement.expression);
        this.emitOperation({ kind: "discard" });
        return;
      case "pragma":
      case "sub":
        return;
      case "block":
        this.scopedBlock(statement.body);
        return;
      case "if": {
        const done: number[] = [];
        for (const branch of statement.branches) {
          this.expression(branch.condition);
          this.emit({ op: "cmp", left: "eax", right: immediate(0) });
          const next = this.emitJump("je");
          this.emitOperation({ kind: "discard" });
          this.scopedBlock(branch.body);
          done.push(this.emitJump("jmp"));
          this.patch(next, this.instructions.length);
          this.emitOperation({ kind: "discard" });
        }
        if (statement.otherwise !== undefined)
          this.scopedBlock(statement.otherwise);
        for (const jump of done) this.patch(jump, this.instructions.length);
        return;
      }
      case "while": {
        const condition = this.instructions.length;
        this.expression(statement.condition);
        this.emit({ op: "cmp", left: "eax", right: immediate(0) });
        const done = this.emitJump("je");
        this.emitOperation({ kind: "discard" });
        const loop = {
          breakJumps: [] as number[],
          continueJumps: [] as number[],
          continueTarget: condition,
        };
        this.loops.push(loop);
        this.scopedBlock(statement.body);
        this.loops.pop();
        this.emit({ op: "jmp", target: condition });
        this.patch(done, this.instructions.length);
        this.emitOperation({ kind: "discard" });
        for (const jump of loop.breakJumps)
          this.patch(jump, this.instructions.length);
        return;
      }
      case "cFor": {
        this.emitOperation({ kind: "push_scope" });
        if (statement.initializer !== undefined) {
          this.expression(statement.initializer);
          this.emitOperation({ kind: "discard" });
        }
        const condition = this.instructions.length;
        let done: number | undefined;
        if (statement.condition !== undefined) {
          this.expression(statement.condition);
          this.emit({ op: "cmp", left: "eax", right: immediate(0) });
          done = this.emitJump("je");
          this.emitOperation({ kind: "discard" });
        }
        const loop = {
          breakJumps: [] as number[],
          continueJumps: [] as number[],
          continueTarget: -1,
        };
        this.loops.push(loop);
        this.scopedBlock(statement.body);
        loop.continueTarget = this.instructions.length;
        for (const jump of loop.continueJumps)
          this.patch(jump, loop.continueTarget);
        if (statement.step !== undefined) {
          this.expression(statement.step);
          this.emitOperation({ kind: "discard" });
        }
        this.loops.pop();
        this.emit({ op: "jmp", target: condition });
        if (done !== undefined) {
          this.patch(done, this.instructions.length);
          this.emitOperation({ kind: "discard" });
        }
        for (const jump of loop.breakJumps)
          this.patch(jump, this.instructions.length);
        this.emitOperation({ kind: "pop_scope" });
        return;
      }
      case "last": {
        const loop = this.loops.at(-1);
        if (loop === undefined || statement.label !== undefined) {
          this.emitOperation({ kind: "statement", statement });
          return;
        }
        loop.breakJumps.push(this.emitJump("jmp"));
        return;
      }
      case "next": {
        const loop = this.loops.at(-1);
        if (loop === undefined || statement.label !== undefined) {
          this.emitOperation({ kind: "statement", statement });
          return;
        }
        if (loop.continueTarget < 0)
          loop.continueJumps.push(this.emitJump("jmp"));
        else this.emit({ op: "jmp", target: loop.continueTarget });
        return;
      }
      case "foreach": {
        this.emitOperation({ kind: "foreach_begin", statement });
        const advance = this.instructions.length;
        this.emitOperation({ kind: "foreach_next", statement });
        this.emit({ op: "cmp", left: "eax", right: immediate(0) });
        const exhausted = this.emitJump("je");
        const loop = {
          breakJumps: [] as number[],
          continueJumps: [] as number[],
          continueTarget: -1,
        };
        this.loops.push(loop);
        this.block(statement.body);
        this.loops.pop();
        loop.continueTarget = this.instructions.length;
        for (const jump of loop.continueJumps)
          this.patch(jump, loop.continueTarget);
        this.emitOperation({ kind: "foreach_iteration", statement });
        this.emit({ op: "jmp", target: advance });
        this.patch(exhausted, this.instructions.length);
        this.emitOperation({ kind: "foreach_end", statement });
        const afterNormal = this.emitJump("jmp");
        const breakCleanup = this.instructions.length;
        this.emitOperation({ kind: "foreach_iteration", statement });
        this.emitOperation({ kind: "foreach_end", statement });
        for (const jump of loop.breakJumps) this.patch(jump, breakCleanup);
        this.patch(afterNormal, this.instructions.length);
        return;
      }
      case "return":
        this.emitOperation({ kind: "statement", statement });
        return;
    }
  }

  private scopedBlock(block: PerlBlock): void {
    this.emitOperation({ kind: "push_scope" });
    this.block(block);
    this.emitOperation({ kind: "pop_scope" });
  }

  private expression(expression: PerlExpression): void {
    if (expression.kind === "logical") {
      this.expression(expression.left);
      this.emit({ op: "cmp", left: "eax", right: immediate(0) });
      const skip = this.emitJump(expression.operator === "&&" ? "je" : "jne");
      this.emitOperation({ kind: "discard" });
      this.expression(expression.right);
      this.patch(skip, this.instructions.length);
      return;
    }
    if (expression.kind === "ternary") {
      this.expression(expression.condition);
      this.emit({ op: "cmp", left: "eax", right: immediate(0) });
      const otherwise = this.emitJump("je");
      this.emitOperation({ kind: "discard" });
      this.expression(expression.whenTrue);
      const done = this.emitJump("jmp");
      this.patch(otherwise, this.instructions.length);
      this.emitOperation({ kind: "discard" });
      this.expression(expression.whenFalse);
      this.patch(done, this.instructions.length);
      return;
    }
    const dependencies = expressionDependencies(expression);
    for (const dependency of dependencies) this.expression(dependency);
    this.emitOperation({ dependencies, expression, kind: "evaluate" });
  }

  private emitOperation(operation: PerlOperation): void {
    const index = this.operations.push(operation) - 1;
    this.emit({ op: "mov", destination: "ebx", source: immediate(index) });
    this.emit({ op: "syscall", name: perlSyscallName });
  }

  private emit(instruction: Cs486Instruction): void {
    this.instructions.push(instruction);
  }
  private emitJump(op: "je" | "jne" | "jmp"): number {
    const index = this.instructions.length;
    this.emit({ op, target: -1 });
    return index;
  }
  private patch(index: number, target: number): void {
    const instruction = this.instructions[index];
    if (instruction === undefined || !("target" in instruction))
      throw new Error("invalid Perl jump patch");
    this.instructions[index] = { ...instruction, target };
  }
}

class PerlCs486Runtime {
  private readonly values: PerlValue[] = [];
  result: LinuxPerlResult | undefined;

  constructor(
    private readonly interpreter: PerlInterpreter,
    private readonly body: PerlBlock,
    private readonly operations: readonly PerlOperation[],
  ) {}

  syscall(name: string, context: Cs486SyscallContext): Cs486SyscallResult {
    if (name !== perlSyscallName)
      throw new Error(`syscall ${name} is unavailable`);
    const operation = this.operations[context.readRegister("ebx")];
    if (operation === undefined) throw new Error("invalid Perl operation");
    let cycles = managedRuntimeCost.dispatch;
    try {
      switch (operation.kind) {
        case "begin":
          this.interpreter.beginCompiled(this.body);
          break;
        case "push_scope":
          this.interpreter.pushCompiledScope();
          break;
        case "pop_scope":
          this.interpreter.popCompiledScope();
          break;
        case "discard":
          this.values.pop();
          break;
        case "input_begin":
          context.writeRegister(
            "eax",
            this.interpreter.beginCompiledInputRecord() ? 1 : 0,
          );
          break;
        case "input_finish":
          this.interpreter.finishCompiledInputRecord();
          break;
        case "statement":
          this.interpreter.executeCompiledStatement(operation.statement);
          break;
        case "foreach_begin":
          cycles +=
            this.interpreter.beginCompiledForeach(operation.statement) *
            managedRuntimeCost.collectionElement;
          break;
        case "foreach_next": {
          const advanced = this.interpreter.advanceCompiledForeach(
            operation.statement,
          );
          context.writeRegister("eax", advanced ? 1 : 0);
          if (advanced)
            cycles +=
              managedRuntimeCost.iteratorStep + managedRuntimeCost.store;
          break;
        }
        case "foreach_iteration":
          this.interpreter.finishCompiledForeachIteration(operation.statement);
          break;
        case "foreach_end":
          this.interpreter.endCompiledForeach(operation.statement);
          break;
        case "evaluate": {
          const map = new Map<PerlExpression, PerlValue>();
          for (
            let index = operation.dependencies.length - 1;
            index >= 0;
            index -= 1
          ) {
            const value = this.values.pop();
            if (value === undefined)
              throw new Error("Perl value stack underflow");
            map.set(operation.dependencies[index]!, value);
          }
          const value = this.interpreter.executeCompiledExpression(
            operation.expression,
            map,
          );
          this.values.push(value);
          context.writeRegister("eax", perlValueIsTrue(value) ? 1 : 0);
          for (const dependency of operation.dependencies) {
            const dependencyValue = map.get(dependency);
            if (dependencyValue !== undefined) {
              cycles += managedLoadWorkCycles(
                perlScalar(dependencyValue),
                "perl_scalar",
              );
            }
          }
          cycles += perlExpressionWorkCycles(
            operation.expression,
            operation.dependencies,
            map,
            value,
          );
          break;
        }
        case "complete":
          this.result = this.interpreter.completeCompiled();
          return { cycles, kind: "complete", value: this.result.exitCode };
      }
      return { cycles, kind: "continue" };
    } catch (error: unknown) {
      this.result = this.interpreter.completeCompiled(error);
      return { cycles, kind: "complete", value: this.result.exitCode };
    }
  }
}

/** Uses the same managed-runtime tariff as Python on the sole CS486 process. */
function perlExpressionWorkCycles(
  expression: PerlExpression,
  dependencies: readonly PerlExpression[],
  values: ReadonlyMap<PerlExpression, PerlValue>,
  result: PerlValue,
): number {
  switch (expression.kind) {
    case "binary":
      return perlBinaryWorkCycles(
        expression.operator,
        dependencies,
        values,
        result,
      );
    case "assign": {
      const operator = expression.operator.slice(0, -1);
      return (
        managedStoreWorkCycles(perlScalar(result), "perl_scalar") +
        (expression.operator === "="
          ? 0
          : perlBinaryWorkCycles(operator, dependencies, values, result))
      );
    }
    case "step":
    case "element":
    case "undefine":
      return managedRuntimeCost.load;
    case "declaration":
      return expression.targets.length * managedRuntimeCost.store;
    case "list":
    case "range":
    case "slice":
      return managedCollectionWorkCycles(result.items.length);
    case "concat":
      return managedStringWorkCycles(perlValueCharacters(result));
    case "call":
      return (
        expression.arguments.length * managedRuntimeCost.load +
        result.items.length * managedRuntimeCost.store
      );
    case "output":
      return managedStringWorkCycles(
        dependencyCharacters(dependencies, values),
      );
    case "match":
    case "substitute":
    case "transliterate":
      return managedStringWorkCycles(
        dependencyCharacters(dependencies, values),
      );
    case "readline":
      return managedStringWorkCycles(perlValueCharacters(result));
    default:
      return 0;
  }
}

function perlBinaryWorkCycles(
  operator: string,
  dependencies: readonly PerlExpression[],
  values: ReadonlyMap<PerlExpression, PerlValue>,
  result: PerlValue,
): number {
  const left =
    dependencies[0] === undefined ? undefined : values.get(dependencies[0]);
  const right =
    dependencies[1] === undefined ? undefined : values.get(dependencies[1]);
  const workCycles = managedBinaryWorkCycles(
    operator,
    left === undefined ? undefined : perlScalar(left),
    right === undefined ? undefined : perlScalar(right),
    operator === "x" ? result.items.join("") : perlScalar(result),
    "perl_scalar",
  );
  return operator === "x"
    ? workCycles + managedCollectionWorkCycles(result.items.length)
    : workCycles;
}

function perlScalar(value: PerlValue): string | number | undefined {
  return value.items.length === 1 ? value.items[0] : undefined;
}

function dependencyCharacters(
  dependencies: readonly PerlExpression[],
  values: ReadonlyMap<PerlExpression, PerlValue>,
): number {
  let characters = 0;
  for (const dependency of dependencies) {
    const value = values.get(dependency);
    if (value !== undefined) characters += perlValueCharacters(value);
  }
  return characters;
}

function perlValueCharacters(value: PerlValue): number {
  let characters = 0;
  for (const item of value.items) {
    if (typeof item === "string") characters += item.length;
    else if (typeof item === "number") characters += String(item).length;
  }
  return characters;
}

function expressionDependencies(
  expression: PerlExpression,
): readonly PerlExpression[] {
  switch (expression.kind) {
    case "concat":
      return expression.parts;
    case "element":
      return [expression.index];
    case "slice":
      return [expression.keys];
    case "list":
      return expression.items;
    case "range":
      return [expression.from, expression.to];
    case "unary":
      return [expression.operand];
    case "binary":
      return [expression.left, expression.right];
    case "assign":
      return [...lvalueDependencies(expression.target), expression.value];
    case "step":
      return lvalueDependencies(expression.target);
    case "call":
      return expression.arguments;
    case "output":
      return [
        ...(expression.handle === undefined ? [] : [expression.handle]),
        ...expression.arguments,
      ];
    case "match":
      return [expression.target, expression.regex.pattern];
    case "substitute":
      return [
        expression.target,
        expression.regex.pattern,
        expression.replacement,
      ];
    case "transliterate":
      return [expression.target];
    case "readline":
      return expression.handle === undefined ? [] : [expression.handle];
    case "fileTest":
      return [expression.path];
    default:
      return [];
  }
}

function lvalueDependencies(
  expression: PerlExpression,
): readonly PerlExpression[] {
  if (expression.kind === "element") return [expression.index];
  if (expression.kind === "slice") return [expression.keys];
  if (expression.kind === "list")
    return expression.items.flatMap(lvalueDependencies);
  if (expression.kind === "call") return expression.arguments;
  return [];
}

function perlValueIsTrue(value: PerlValue): boolean {
  const scalar =
    value.kind === "aggregate"
      ? value.items.length
      : value.kind === "scalar"
        ? value.items[0]
        : value.items.at(-1);
  if (scalar === undefined) return false;
  return typeof scalar === "number"
    ? scalar !== 0
    : scalar.length > 0 && scalar !== "0";
}

function immediate(value: number): {
  readonly kind: "immediate";
  readonly value: number;
} {
  return { kind: "immediate", value };
}
