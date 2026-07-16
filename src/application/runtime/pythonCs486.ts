import type {
  AssignmentTarget,
  Expression,
  FunctionDefinition,
  Statement,
} from "../../domain/language/ast.js";
import { LanguageSyntaxError } from "../../domain/language/errors.js";
import { parse } from "../../domain/language/parser.js";
import type { SourceSpan } from "../../domain/language/source.js";
import type { GuestFilesystem } from "../os/guestFilesystem.js";
import {
  Cs486Process,
  type Cs486Executable,
  type Cs486Instruction,
  type Cs486SyscallContext,
  type Cs486SyscallResult,
} from "../../domain/cpu/cs486.js";
import {
  cs486ObjectDataAlignment,
  validateCs486Object,
  type Cs486Object,
} from "../../domain/cpu/cs486Object.js";
import {
  VmLimitError,
  VmMemoryError,
  VmRuntimeError,
} from "../../domain/runtime/errors.js";
import {
  nativeFunction,
  type NativeFunction,
  type RuntimeIterator,
  type RuntimeNamespace,
  type RuntimeValue,
  type VmWaitRequest,
  type VmWorkRequest,
} from "../../domain/runtime/value.js";
import { utf8ByteLength } from "../../domain/text/utf8.js";
import { linkCs486Objects } from "../toolchain/cs486Linker.js";
import type { NativeEnvironment } from "./nativeModules.js";
import type { CpuModel } from "../../domain/cpu/models.js";
import {
  defaultPythonRuntimeLimits,
  type PythonRuntimeLimits,
} from "./pythonLimits.js";

const pythonSyscallName = "python";
const maximumModules = 64;
const maximumImportDepth = 16;
const maximumTotalSourceBytes = 512_000;

export interface PythonCs486Options {
  readonly cpuModel?: CpuModel;
  readonly environment: NativeEnvironment;
  readonly filesystem: GuestFilesystem;
  readonly memoryBytes: number;
  readonly path: string;
  readonly source: string;
  readonly limits?: PythonRuntimeLimits;
}

export interface PythonCs486Program {
  readonly executable: Cs486Executable;
  readonly process: Cs486Process;
  readonly runtime: PythonCs486Runtime;
}

/**
 * Compile Computer System Python to ordinary CS486 control-flow plus a small,
 * allowlisted managed-runtime syscall ABI. There is no Python instruction
 * pointer or Python scheduler: calls, returns, branches, waits, and cycle debt
 * are owned by Cs486Process.
 */
export function createPythonCs486Program(
  options: PythonCs486Options,
): PythonCs486Program {
  if (options.filesystem !== options.environment.filesystem) {
    throw new Error(
      "Python imports and native modules must share one guest filesystem",
    );
  }
  const graph = resolveModules(options);
  const compiler = new PythonCs486Compiler(graph);
  const compiled = compiler.compile();
  const executable = appendExtensionObjects(compiled, graph.extensions);
  const limits = options.limits ?? defaultPythonRuntimeLimits;
  const runtimeMemoryBytes = Math.min(
    options.memoryBytes,
    limits.maxMemoryBytes ?? options.memoryBytes,
  );
  const runtime = new PythonCs486Runtime({
    environment: options.environment,
    functions: compiled.functions,
    limits,
    memoryBytes: runtimeMemoryBytes,
    modules: compiled.modules,
    operations: compiled.operations,
    extensionModules: executable.extensionModules,
  });
  const process = new Cs486Process(executable.executable, {
    cpuModel: options.cpuModel,
    externalMemoryUsageBytes: (): number => runtime.memoryUsageBytes,
    memoryBytes: options.memoryBytes,
    syscallHandler: (name, context): Cs486SyscallResult =>
      runtime.syscall(name, context),
  });
  return { executable: executable.executable, process, runtime };
}

interface ResolvedModule {
  readonly id: number;
  readonly imports: ReadonlyMap<string, ResolvedImport>;
  readonly name: string;
  readonly path: string;
  readonly source: string;
  readonly statements: readonly Statement[];
}

type ResolvedImport =
  | { readonly kind: "builtin"; readonly name: string }
  | {
      readonly kind: "python";
      readonly moduleId: number;
      readonly name: string;
    }
  | {
      readonly extensionId: number;
      readonly kind: "extension";
      readonly name: string;
    }
  | { readonly kind: "missing"; readonly name: string };

interface ResolvedExtension {
  readonly id: number;
  readonly name: string;
  readonly object: Cs486Object;
  readonly path: string;
}

interface ResolvedGraph {
  readonly extensions: readonly ResolvedExtension[];
  readonly modules: readonly ResolvedModule[];
}

function resolveModules(options: PythonCs486Options): ResolvedGraph {
  const modules: ResolvedModule[] = [];
  const extensions: ResolvedExtension[] = [];
  const moduleByPath = new Map<string, ResolvedModule>();
  const extensionByPath = new Map<string, ResolvedExtension>();
  const active = new Set<string>();
  let totalSourceBytes = 0;

  const resolvePython = (
    name: string,
    path: string,
    source: string,
    depth: number,
  ): ResolvedModule => {
    if (depth > maximumImportDepth)
      throw new VmRuntimeError("ImportError", "import depth limit exceeded");
    const normalizedPath = options.filesystem.normalize(path);
    const existing = moduleByPath.get(normalizedPath);
    if (existing !== undefined) return existing;
    if (active.has(normalizedPath))
      throw new VmRuntimeError(
        "ImportError",
        `circular import involving ${normalizedPath}`,
      );
    if (modules.length >= maximumModules)
      throw new VmRuntimeError("ImportError", "module count limit exceeded");
    totalSourceBytes += utf8ByteLength(source);
    if (totalSourceBytes > maximumTotalSourceBytes)
      throw new VmRuntimeError("ImportError", "module source limit exceeded");

    active.add(normalizedPath);
    const parsed = parse(source);
    const importNames = collectImports(parsed.body);
    const imports = new Map<string, ResolvedImport>();
    const placeholder: ResolvedModule = {
      id: modules.length,
      imports,
      name,
      path: normalizedPath,
      source,
      statements: parsed.body,
    };
    modules.push(placeholder);
    moduleByPath.set(normalizedPath, placeholder);
    for (const importedName of importNames) {
      if (options.environment.modules.has(importedName)) {
        imports.set(importedName, {
          kind: "builtin",
          name: importedName,
        });
        continue;
      }
      const found = findModuleFile(
        options.filesystem,
        importedName,
        directory(normalizedPath),
      );
      if (found === undefined) {
        imports.set(importedName, { kind: "missing", name: importedName });
      } else if (found.kind === "python") {
        const child = resolvePython(
          importedName,
          found.path,
          options.filesystem.readFile(found.path),
          depth + 1,
        );
        imports.set(importedName, {
          kind: "python",
          moduleId: child.id,
          name: importedName,
        });
      } else {
        let extension = extensionByPath.get(found.path);
        if (extension === undefined) {
          if (extensions.length >= maximumModules)
            throw new VmRuntimeError(
              "ImportError",
              "extension module count limit exceeded",
            );
          extension = {
            id: extensions.length,
            name: importedName,
            object: decodeObject(
              options.filesystem.readFile(found.path),
              found.path,
            ),
            path: found.path,
          };
          extensions.push(extension);
          extensionByPath.set(found.path, extension);
        }
        imports.set(importedName, {
          extensionId: extension.id,
          kind: "extension",
          name: importedName,
        });
      }
    }
    active.delete(normalizedPath);
    return placeholder;
  };

  resolvePython("__main__", options.path, options.source, 0);
  return { extensions, modules };
}

function collectImports(statements: readonly Statement[]): string[] {
  const names = new Set<string>();
  const visit = (children: readonly Statement[]): void => {
    for (const statement of children) {
      switch (statement.kind) {
        case "ImportStatement":
          for (const imported of statement.imports) names.add(imported.module);
          break;
        case "ForStatement":
        case "WhileStatement":
        case "FunctionDefinition":
          visit(statement.body);
          break;
        case "IfStatement":
          for (const branch of statement.branches) visit(branch.body);
          visit(statement.elseBody ?? []);
          break;
        case "TryStatement":
          visit(statement.body);
          for (const handler of statement.handlers) visit(handler.body);
          visit(statement.elseBody ?? []);
          visit(statement.finallyBody ?? []);
          break;
        default:
          break;
      }
    }
  };
  visit(statements);
  return [...names];
}

function findModuleFile(
  filesystem: GuestFilesystem,
  name: string,
  importerDirectory: string,
):
  { readonly kind: "extension" | "python"; readonly path: string } | undefined {
  if (!/^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/u.test(name))
    return undefined;
  const relative = name.replaceAll(".", "/");
  const roots = [
    importerDirectory,
    "/lib/python",
    "/usr/lib/computer-system/python",
    "/drives/c/lib/python",
  ];
  for (const root of roots) {
    const prefix = root === "/" ? "" : root;
    const pythonPath = `${prefix}/${relative}.py`;
    if (filesystem.exists(pythonPath) && !filesystem.isDirectory(pythonPath))
      return { kind: "python", path: filesystem.normalize(pythonPath) };
    const objectPath = `${prefix}/${relative}.o`;
    if (filesystem.exists(objectPath) && !filesystem.isDirectory(objectPath))
      return { kind: "extension", path: filesystem.normalize(objectPath) };
  }
  return undefined;
}

function directory(path: string): string {
  return path.slice(0, path.lastIndexOf("/")) || "/";
}

function decodeObject(encoded: string, path: string): Cs486Object {
  if (!encoded.startsWith("CS486OBJ\n"))
    throw new VmRuntimeError("ImportError", `${path} is not a CS486 object`);
  try {
    const decoded: unknown = JSON.parse(encoded.slice("CS486OBJ\n".length));
    validateCs486Object(decoded);
    return decoded;
  } catch {
    throw new VmRuntimeError(
      "ImportError",
      `${path} contains invalid object data`,
    );
  }
}

type PythonOperation =
  | {
      readonly kind: "load_const";
      readonly span: SourceSpan;
      readonly value: RuntimeValue;
    }
  | {
      readonly kind: "load_name" | "store_name";
      readonly name: string;
      readonly span: SourceSpan;
    }
  | { readonly kind: "pop"; readonly span: SourceSpan }
  | {
      readonly count: number;
      readonly kind: "build_list" | "build_tuple" | "build_dict" | "format";
      readonly span: SourceSpan;
    }
  | {
      readonly kind: "binary";
      readonly operator: Extract<
        Expression,
        { kind: "BinaryExpression" }
      >["operator"];
      readonly span: SourceSpan;
    }
  | {
      readonly kind: "unary";
      readonly operator: Extract<
        Expression,
        { kind: "UnaryExpression" }
      >["operator"];
      readonly span: SourceSpan;
    }
  | {
      readonly kind: "compare";
      readonly operators: readonly Extract<
        Expression,
        { kind: "ComparisonExpression" }
      >["comparisons"][number]["operator"][];
      readonly span: SourceSpan;
    }
  | {
      readonly keep: boolean;
      readonly kind: "truthy";
      readonly span: SourceSpan;
    }
  | {
      readonly kind: "load_attribute" | "store_attribute";
      readonly name: string;
      readonly span: SourceSpan;
    }
  | {
      readonly kind: "load_subscript" | "store_subscript";
      readonly span: SourceSpan;
    }
  | { readonly kind: "get_iter" | "for_iter"; readonly span: SourceSpan }
  | {
      readonly argumentNames: readonly (string | undefined)[];
      readonly kind: "call";
      readonly span: SourceSpan;
    }
  | { readonly kind: "after_call"; readonly span: SourceSpan }
  | {
      readonly defaultCount: number;
      readonly functionId: number;
      readonly kind: "make_function";
      readonly span: SourceSpan;
    }
  | { readonly kind: "return"; readonly span: SourceSpan }
  | {
      readonly action:
        | { readonly kind: "return" }
        | { readonly kind: "jump"; readonly target: TargetReference };
      readonly finalizers: readonly TargetReference[];
      readonly kind: "begin_control";
      readonly span: SourceSpan;
    }
  | { readonly kind: "finish_finally"; readonly span: SourceSpan }
  | {
      readonly handlers: readonly CompiledExceptionHandler[];
      readonly finallyTarget?: TargetReference;
      readonly kind: "push_handler";
      readonly span: SourceSpan;
    }
  | {
      readonly finallyTarget: TargetReference;
      readonly kind: "push_finally_guard";
      readonly span: SourceSpan;
    }
  | {
      readonly kind: "pop_handler" | "leave_handler";
      readonly span: SourceSpan;
    }
  | {
      readonly hasValue: boolean;
      readonly kind: "raise";
      readonly span: SourceSpan;
    }
  | {
      readonly kind: "module_complete";
      readonly moduleId: number;
      readonly span: SourceSpan;
    }
  | {
      readonly alias: string;
      readonly imported: ResolvedImport;
      readonly kind: "import";
      readonly span: SourceSpan;
    };

interface TargetReference {
  target: number;
}

interface CompiledExceptionHandler {
  readonly name?: string;
  readonly target: TargetReference;
  readonly typeName?: string;
}

interface CompiledFunction {
  readonly id: number;
  readonly name: string;
  readonly parameters: readonly string[];
  readonly requiredParameters: number;
  target: number;
}

interface CompiledModule {
  readonly id: number;
  readonly name: string;
  readonly path: string;
  target: number;
}

interface PythonCompilation {
  readonly executable: Cs486Executable;
  readonly functions: readonly CompiledFunction[];
  readonly modules: readonly CompiledModule[];
  readonly operations: readonly PythonOperation[];
}

class PythonCs486Compiler {
  private readonly instructions: Cs486Instruction[] = [];
  private readonly operations: PythonOperation[] = [];
  private readonly functions: CompiledFunction[] = [];
  private readonly modules: CompiledModule[];
  private readonly pendingFunctions: {
    readonly descriptor: CompiledFunction;
    readonly definition: FunctionDefinition;
    readonly module: ResolvedModule;
  }[] = [];
  private readonly loops: {
    readonly breakTarget: TargetReference;
    readonly continueTarget: TargetReference;
  }[] = [];
  private readonly finalizers: TargetReference[] = [];
  private currentModule!: ResolvedModule;
  private inFunction = false;

  constructor(private readonly graph: ResolvedGraph) {
    this.modules = graph.modules.map((module) => ({
      id: module.id,
      name: module.name,
      path: module.path,
      target: -1,
    }));
  }

  compile(): PythonCompilation {
    for (const module of this.graph.modules) {
      this.currentModule = module;
      this.inFunction = false;
      this.modules[module.id]!.target = this.instructions.length;
      this.statements(module.statements);
      this.emitOperation({
        kind: "module_complete",
        moduleId: module.id,
        span: module.statements.at(-1)?.span ?? emptySpan(),
      });
    }
    for (let index = 0; index < this.pendingFunctions.length; index += 1) {
      const pending = this.pendingFunctions[index]!;
      this.currentModule = pending.module;
      this.inFunction = true;
      pending.descriptor.target = this.instructions.length;
      this.statements(pending.definition.body);
      this.emitOperation({
        kind: "load_const",
        span: pending.definition.span,
        value: null,
      });
      this.emitOperation({ kind: "return", span: pending.definition.span });
    }
    if (this.instructions.length > 4_096)
      throw new VmLimitError("compiled instruction");
    return {
      executable: {
        format: "cs486-executable",
        instructions: this.instructions,
        version: 1,
      },
      functions: this.functions,
      modules: this.modules,
      operations: this.operations,
    };
  }

  private statements(statements: readonly Statement[]): void {
    for (const statement of statements) this.statement(statement);
  }

  private statement(statement: Statement): void {
    switch (statement.kind) {
      case "AssignmentStatement":
        this.assignment(statement.target, statement.value);
        return;
      case "BreakStatement": {
        const loop = this.loops.at(-1);
        if (loop === undefined)
          throw new LanguageSyntaxError("break outside loop", statement.span);
        this.emitControl(
          { kind: "jump", target: loop.breakTarget },
          statement.span,
        );
        return;
      }
      case "ContinueStatement": {
        const loop = this.loops.at(-1);
        if (loop === undefined)
          throw new LanguageSyntaxError(
            "continue outside loop",
            statement.span,
          );
        this.emitControl(
          { kind: "jump", target: loop.continueTarget },
          statement.span,
        );
        return;
      }
      case "ExpressionStatement":
        this.expression(statement.expression);
        this.emitOperation({ kind: "pop", span: statement.span });
        return;
      case "ForStatement": {
        this.expression(statement.iterable);
        this.emitOperation({ kind: "get_iter", span: statement.iterable.span });
        const start = this.instructions.length;
        this.emitOperation({ kind: "for_iter", span: statement.span });
        this.emit({ op: "cmp", left: "eax", right: immediate(0) });
        const exit = this.emitJump("je");
        this.emitOperation({
          kind: "store_name",
          name: statement.target.name,
          span: statement.target.span,
        });
        const loop = {
          breakTarget: { target: -1 },
          continueTarget: { target: start },
        };
        this.loops.push(loop);
        this.statements(statement.body);
        this.loops.pop();
        this.emit({ op: "jmp", target: start });
        const end = this.instructions.length;
        this.patch(exit, end);
        loop.breakTarget.target = end;
        return;
      }
      case "FunctionDefinition": {
        const defaultValues = statement.parameters.flatMap(
          ({ defaultValue }) =>
            defaultValue === undefined ? [] : [defaultValue],
        );
        for (const value of defaultValues) this.expression(value);
        const firstDefault = statement.parameters.findIndex(
          ({ defaultValue }) => defaultValue !== undefined,
        );
        const descriptor: CompiledFunction = {
          id: this.functions.length,
          name: statement.name,
          parameters: statement.parameters.map(({ name }) => name),
          requiredParameters:
            firstDefault < 0 ? statement.parameters.length : firstDefault,
          target: -1,
        };
        this.functions.push(descriptor);
        this.pendingFunctions.push({
          descriptor,
          definition: statement,
          module: this.currentModule,
        });
        this.emitOperation({
          defaultCount: defaultValues.length,
          functionId: descriptor.id,
          kind: "make_function",
          span: statement.span,
        });
        this.emitOperation({
          kind: "store_name",
          name: statement.name,
          span: statement.span,
        });
        return;
      }
      case "IfStatement": {
        const exits: number[] = [];
        for (const branch of statement.branches) {
          this.expression(branch.test);
          this.emitOperation({
            keep: false,
            kind: "truthy",
            span: branch.test.span,
          });
          this.emit({ op: "cmp", left: "eax", right: immediate(0) });
          const next = this.emitJump("je");
          this.statements(branch.body);
          exits.push(this.emitJump("jmp"));
          this.patch(next, this.instructions.length);
        }
        this.statements(statement.elseBody ?? []);
        const end = this.instructions.length;
        for (const jump of exits) this.patch(jump, end);
        return;
      }
      case "ImportStatement":
        for (const imported of statement.imports) {
          this.emitOperation({
            alias: imported.alias ?? imported.module.split(".")[0]!,
            imported:
              this.currentModule.imports.get(imported.module) ??
              ({ kind: "missing", name: imported.module } as const),
            kind: "import",
            span: imported.span,
          });
          this.emitOperation({ kind: "after_call", span: imported.span });
        }
        return;
      case "PassStatement":
        return;
      case "RaiseStatement":
        if (statement.value !== undefined) this.expression(statement.value);
        this.emitOperation({
          hasValue: statement.value !== undefined,
          kind: "raise",
          span: statement.span,
        });
        return;
      case "ReturnStatement":
        if (statement.value === undefined)
          this.emitOperation({
            kind: "load_const",
            span: statement.span,
            value: null,
          });
        else this.expression(statement.value);
        if (this.inFunction)
          this.emitControl({ kind: "return" }, statement.span);
        else
          this.emitOperation({
            kind: "module_complete",
            moduleId: this.currentModule.id,
            span: statement.span,
          });
        return;
      case "TryStatement":
        this.tryStatement(statement);
        return;
      case "WhileStatement": {
        const start = this.instructions.length;
        this.expression(statement.test);
        this.emitOperation({
          keep: false,
          kind: "truthy",
          span: statement.test.span,
        });
        this.emit({ op: "cmp", left: "eax", right: immediate(0) });
        const exit = this.emitJump("je");
        const loop = {
          breakTarget: { target: -1 },
          continueTarget: { target: start },
        };
        this.loops.push(loop);
        this.statements(statement.body);
        this.loops.pop();
        this.emit({ op: "jmp", target: start });
        const end = this.instructions.length;
        this.patch(exit, end);
        loop.breakTarget.target = end;
      }
    }
  }

  private tryStatement(
    statement: Extract<Statement, { kind: "TryStatement" }>,
  ): void {
    const finallyTarget =
      statement.finallyBody === undefined ? undefined : { target: -1 };
    const handlers: CompiledExceptionHandler[] = statement.handlers.map(
      (handler) => {
        if (
          handler.type !== undefined &&
          handler.type.kind !== "IdentifierExpression"
        )
          throw new LanguageSyntaxError(
            "except type must be an exception name",
            handler.type.span,
          );
        return {
          name: handler.name,
          target: { target: -1 },
          typeName: handler.type?.name,
        };
      },
    );
    this.emitOperation({
      handlers,
      finallyTarget,
      kind: "push_handler",
      span: statement.span,
    });
    if (finallyTarget !== undefined) this.finalizers.push(finallyTarget);
    this.statements(statement.body);
    this.emitOperation({ kind: "pop_handler", span: statement.span });

    if (statement.elseBody !== undefined) {
      if (finallyTarget !== undefined)
        this.emitOperation({
          finallyTarget,
          kind: "push_finally_guard",
          span: statement.span,
        });
      this.statements(statement.elseBody);
      if (finallyTarget !== undefined)
        this.emitOperation({ kind: "pop_handler", span: statement.span });
    }
    const normalExit = this.emitJump("jmp");

    const handlerExits: number[] = [];
    statement.handlers.forEach((handler, index) => {
      handlers[index]!.target.target = this.instructions.length;
      if (finallyTarget !== undefined)
        this.emitOperation({
          finallyTarget,
          kind: "push_finally_guard",
          span: handler.span,
        });
      this.statements(handler.body);
      if (finallyTarget !== undefined)
        this.emitOperation({ kind: "pop_handler", span: handler.span });
      this.emitOperation({ kind: "leave_handler", span: handler.span });
      handlerExits.push(this.emitJump("jmp"));
    });

    if (finallyTarget === undefined) {
      const end = this.instructions.length;
      this.patch(normalExit, end);
      for (const exit of handlerExits) this.patch(exit, end);
      return;
    }

    this.finalizers.pop();
    finallyTarget.target = this.instructions.length;
    this.patch(normalExit, finallyTarget.target);
    for (const exit of handlerExits) this.patch(exit, finallyTarget.target);
    this.statements(statement.finallyBody ?? []);
    this.emitOperation({ kind: "finish_finally", span: statement.span });
  }

  private emitControl(
    action:
      | { readonly kind: "return" }
      | { readonly kind: "jump"; readonly target: TargetReference },
    span: SourceSpan,
  ): void {
    if (this.finalizers.length === 0) {
      if (action.kind === "return")
        this.emitOperation({ kind: "return", span });
      else
        this.emitOperation({
          action,
          finalizers: [],
          kind: "begin_control",
          span,
        });
      return;
    }
    this.emitOperation({
      action,
      finalizers: [...this.finalizers].reverse(),
      kind: "begin_control",
      span,
    });
  }

  private assignment(target: AssignmentTarget, value: Expression): void {
    if (target.kind === "IdentifierExpression") {
      this.expression(value);
      this.emitOperation({
        kind: "store_name",
        name: target.name,
        span: target.span,
      });
    } else if (target.kind === "AttributeExpression") {
      this.expression(target.object);
      this.expression(value);
      this.emitOperation({
        kind: "store_attribute",
        name: target.attribute,
        span: target.span,
      });
    } else {
      this.expression(target.object);
      this.expression(target.index);
      this.expression(value);
      this.emitOperation({ kind: "store_subscript", span: target.span });
    }
  }

  private expression(expression: Expression): void {
    switch (expression.kind) {
      case "AttributeExpression":
        this.expression(expression.object);
        this.emitOperation({
          kind: "load_attribute",
          name: expression.attribute,
          span: expression.span,
        });
        return;
      case "BinaryExpression":
        this.expression(expression.left);
        this.expression(expression.right);
        this.emitOperation({
          kind: "binary",
          operator: expression.operator,
          span: expression.span,
        });
        return;
      case "BooleanExpression": {
        this.expression(expression.values[0]!);
        const exits: number[] = [];
        for (const value of expression.values.slice(1)) {
          this.emitOperation({ keep: true, kind: "truthy", span: value.span });
          this.emit({ op: "cmp", left: "eax", right: immediate(0) });
          exits.push(
            this.emitJump(expression.operator === "and" ? "je" : "jne"),
          );
          this.emitOperation({ kind: "pop", span: value.span });
          this.expression(value);
        }
        const end = this.instructions.length;
        for (const jump of exits) this.patch(jump, end);
        return;
      }
      case "CallExpression":
        this.expression(expression.callee);
        for (const argument of expression.arguments)
          this.expression(argument.value);
        this.emitOperation({
          argumentNames: expression.arguments.map(({ name }) => name),
          kind: "call",
          span: expression.span,
        });
        this.emitOperation({ kind: "after_call", span: expression.span });
        return;
      case "ComparisonExpression":
        this.expression(expression.left);
        for (const comparison of expression.comparisons)
          this.expression(comparison.right);
        this.emitOperation({
          kind: "compare",
          operators: expression.comparisons.map(({ operator }) => operator),
          span: expression.span,
        });
        return;
      case "DictionaryExpression":
        for (const entry of expression.entries) {
          this.expression(entry.key);
          this.expression(entry.value);
        }
        this.emitOperation({
          count: expression.entries.length,
          kind: "build_dict",
          span: expression.span,
        });
        return;
      case "FormattedStringExpression":
        for (const part of expression.parts) {
          if (typeof part === "string")
            this.emitOperation({
              kind: "load_const",
              span: expression.span,
              value: part,
            });
          else this.expression(part);
        }
        this.emitOperation({
          count: expression.parts.length,
          kind: "format",
          span: expression.span,
        });
        return;
      case "IdentifierExpression":
        this.emitOperation({
          kind: "load_name",
          name: expression.name,
          span: expression.span,
        });
        return;
      case "ListExpression":
      case "TupleExpression":
        for (const element of expression.elements) this.expression(element);
        this.emitOperation({
          count: expression.elements.length,
          kind:
            expression.kind === "ListExpression" ? "build_list" : "build_tuple",
          span: expression.span,
        });
        return;
      case "LiteralExpression":
        this.emitOperation({
          kind: "load_const",
          span: expression.span,
          value: expression.value,
        });
        return;
      case "SubscriptExpression":
        this.expression(expression.object);
        this.expression(expression.index);
        this.emitOperation({ kind: "load_subscript", span: expression.span });
        return;
      case "UnaryExpression":
        this.expression(expression.operand);
        this.emitOperation({
          kind: "unary",
          operator: expression.operator,
          span: expression.span,
        });
    }
  }

  private emitOperation(operation: PythonOperation): void {
    const index = this.operations.length;
    this.operations.push(operation);
    this.emit({ op: "mov", destination: "ebx", source: immediate(index) });
    this.emit({ op: "syscall", name: pythonSyscallName });
  }

  private emit(instruction: Cs486Instruction): number {
    this.instructions.push(instruction);
    return this.instructions.length - 1;
  }

  private emitJump(op: "je" | "jne" | "jmp"): number {
    return this.emit({ op, target: -1 });
  }

  private patch(index: number, target: number): void {
    const instruction = this.instructions[index];
    if (
      instruction === undefined ||
      !["je", "jne", "jmp"].includes(instruction.op)
    )
      throw new Error(`Instruction ${String(index)} is not patchable`);
    this.instructions[index] = { ...instruction, target } as Cs486Instruction;
  }
}

function immediate(value: number): {
  readonly kind: "immediate";
  readonly value: number;
} {
  return { kind: "immediate", value };
}

interface ExtensionModuleRuntime {
  readonly id: number;
  readonly name: string;
  readonly exports: ReadonlyMap<string, number>;
}

function appendExtensionObjects(
  compilation: PythonCompilation,
  extensions: readonly ResolvedExtension[],
): {
  readonly executable: Cs486Executable;
  readonly extensionModules: readonly ExtensionModuleRuntime[];
} {
  const instructions = [...compilation.executable.instructions];
  const initialData = (compilation.executable.initialData ?? []).map(
    (segment) => ({ bytes: [...segment.bytes], offset: segment.offset }),
  );
  const extensionModules: ExtensionModuleRuntime[] = [];
  let dataBytes = compilation.executable.dataBytes ?? 0;
  for (const extension of extensions) {
    const textFunctions = extension.object.symbols.filter(
      (symbol) =>
        symbol.binding === "global" &&
        symbol.section === "text" &&
        (symbol.type === undefined ||
          symbol.type === "function" ||
          symbol.type === "notype"),
    );
    const globals = textFunctions.filter(
      (symbol) => symbol.functionSignature !== "()->void",
    );
    const entry = globals[0]?.name;
    if (entry === undefined)
      throw new VmRuntimeError(
        "ImportError",
        textFunctions.some((symbol) => symbol.functionSignature === "()->void")
          ? `${extension.path} exports no zero-argument integer functions`
          : `${extension.path} exports no functions`,
      );
    let linked: Cs486Executable;
    try {
      linked = linkCs486Objects([extension.object], { entry });
    } catch (error: unknown) {
      throw new VmRuntimeError(
        "ImportError",
        `${extension.path}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    const bodyBase = instructions.length;
    const dataBase = align(
      dataBytes,
      cs486ObjectDataAlignment(extension.object),
    );
    const body = linked.instructions
      .slice(2)
      .map((instruction) =>
        relocateExtensionInstruction(instruction, bodyBase, dataBase),
      );
    instructions.push(...body);
    for (const segment of linked.initialData ?? []) {
      initialData.push({
        bytes: [...segment.bytes],
        offset: dataBase + segment.offset,
      });
    }
    const exports = new Map<string, number>();
    const functionNames = new Set(globals.map((symbol) => symbol.name));
    for (const symbol of linked.symbols ?? []) {
      if (
        functionNames.has(symbol.name) &&
        (symbol.section === undefined || symbol.section === "text") &&
        (symbol.type === undefined ||
          symbol.type === "function" ||
          symbol.type === "notype") &&
        symbol.functionSignature !== "()->void"
      )
        exports.set(symbol.name, bodyBase + symbol.address - 2);
    }
    extensionModules.push({ id: extension.id, name: extension.name, exports });
    dataBytes = dataBase + (linked.dataBytes ?? 0);
  }
  dataBytes = align(dataBytes, 4);
  if (instructions.length > 4_096) throw new VmLimitError("linked instruction");
  const version =
    compilation.executable.version === 2 || extensions.length > 0 ? 2 : 1;
  return {
    executable: {
      format: "cs486-executable",
      instructions,
      dataBytes,
      ...(initialData.length > 0 ? { initialData } : {}),
      version,
    },
    extensionModules,
  };
}

function relocateExtensionInstruction(
  instruction: Cs486Instruction,
  textBase: number,
  dataBase: number,
): Cs486Instruction {
  if (
    ["jmp", "je", "jne", "jl", "jle", "jg", "jge", "call"].includes(
      instruction.op,
    )
  ) {
    const targeted = instruction as Extract<
      Cs486Instruction,
      { target: number }
    >;
    return { ...targeted, target: textBase + targeted.target - 2 };
  }
  if (instruction.op === "load" || instruction.op === "store") {
    const address = instruction.address;
    return address.kind === "immediate"
      ? { ...instruction, address: immediate(address.value + dataBase) }
      : instruction;
  }
  return instruction;
}

function align(value: number, alignment: number): number {
  return Math.ceil(value / alignment) * alignment;
}

interface PythonRuntimeOptions {
  readonly environment: NativeEnvironment;
  readonly extensionModules: readonly ExtensionModuleRuntime[];
  readonly functions: readonly CompiledFunction[];
  readonly limits: PythonRuntimeLimits;
  readonly memoryBytes: number;
  readonly modules: readonly CompiledModule[];
  readonly operations: readonly PythonOperation[];
}

interface RuntimeFrame {
  readonly globals: Map<string, RuntimeValue>;
  readonly kind: "function" | "module";
  readonly locals: Map<string, RuntimeValue>;
  readonly moduleId: number;
  readonly stackBase: number;
}

type ManagedCallable =
  | {
      readonly defaults: readonly RuntimeValue[];
      readonly descriptor: CompiledFunction;
      readonly globals: Map<string, RuntimeValue>;
      readonly kind: "python";
      readonly moduleId: number;
    }
  | {
      readonly kind: "extension";
      readonly name: string;
      readonly target: number;
    };

type CallMarker =
  | { readonly kind: "python" }
  | { readonly kind: "extension" }
  | { readonly kind: "module"; readonly moduleId: number };

type ModuleState =
  | { readonly kind: "unloaded" }
  | { readonly kind: "loading" }
  | { readonly kind: "loaded"; readonly namespace: RuntimeNamespace };

interface RuntimeExceptionHandler {
  readonly activeFaultDepth: number;
  readonly callMarkerDepth: number;
  readonly finallyTarget?: TargetReference;
  readonly frameDepth: number;
  readonly handlers: readonly CompiledExceptionHandler[];
  readonly machineStackPointer: number;
  readonly stackDepth: number;
}

type PendingControl =
  | {
      readonly action:
        | { readonly kind: "return"; readonly value: RuntimeValue }
        | { readonly kind: "jump"; readonly target: TargetReference };
      readonly kind: "control";
      readonly remainingFinalizers: readonly TargetReference[];
    }
  | { readonly error: VmRuntimeError; readonly kind: "fault" };

export class PythonCs486Runtime {
  private readonly stack: RuntimeValue[] = [];
  private readonly frames: RuntimeFrame[];
  private readonly callMarkers: CallMarker[] = [];
  private readonly callables = new WeakMap<NativeFunction, ManagedCallable>();
  private readonly moduleStates: ModuleState[];
  private readonly extensionNamespaces = new Map<number, RuntimeNamespace>();
  private readonly exceptionHandlers: RuntimeExceptionHandler[] = [];
  private readonly activeFaults: VmRuntimeError[] = [];
  private pendingControl: PendingControl | undefined;
  private memoryUsageValue = 32;
  private allocationPressureBytes = 0;
  private readonly loadedConstantStrings = new Set<string>();

  constructor(private readonly options: PythonRuntimeOptions) {
    if (!Number.isSafeInteger(options.memoryBytes) || options.memoryBytes <= 0)
      throw new RangeError("memoryBytes must be a positive safe integer");
    const rootGlobals = new Map<string, RuntimeValue>();
    this.frames = [
      {
        globals: rootGlobals,
        kind: "module",
        locals: rootGlobals,
        moduleId: 0,
        stackBase: 0,
      },
    ];
    this.moduleStates = options.modules.map((_module, index) =>
      index === 0 ? { kind: "loading" } : { kind: "unloaded" },
    );
    this.memoryUsageValue = this.measureMemoryUsage();
    this.checkMemory();
  }

  get memoryUsageBytes(): number {
    this.memoryUsageValue = this.measureMemoryUsage();
    this.allocationPressureBytes = 0;
    return this.memoryUsageValue;
  }

  get globals(): ReadonlyMap<string, RuntimeValue> {
    return this.frames[0]?.globals ?? new Map();
  }

  syscall(name: string, context: Cs486SyscallContext): Cs486SyscallResult {
    if (name !== pythonSyscallName)
      throw new VmRuntimeError(
        "UnsupportedError",
        `syscall ${name} is unavailable`,
      );
    const operationIndex = context.readRegister("ebx");
    const operation = this.options.operations[operationIndex];
    if (operation === undefined)
      throw new VmRuntimeError(
        "ExecutableFormatError",
        `invalid Python operation ${String(operationIndex)}`,
      );
    try {
      return this.execute(operation, context);
    } catch (error: unknown) {
      const fault =
        error instanceof VmRuntimeError
          ? error
          : new VmRuntimeError(
              "RuntimeError",
              error instanceof Error ? error.message : String(error),
              operation.span,
            );
      return this.routeFault(fault, context);
    }
  }

  private execute(
    operation: PythonOperation,
    context: Cs486SyscallContext,
  ): Cs486SyscallResult {
    const baseCycles = 16;
    switch (operation.kind) {
      case "load_const":
        this.push(operation.value, operation.span);
        if (
          typeof operation.value === "string" &&
          !this.loadedConstantStrings.has(operation.value)
        ) {
          this.loadedConstantStrings.add(operation.value);
          this.noteAllocation(16 + utf8ByteLength(operation.value));
        }
        return continued(baseCycles);
      case "load_name":
        this.push(
          this.loadName(operation.name, operation.span),
          operation.span,
        );
        return continued(baseCycles);
      case "store_name":
        this.frame().locals.set(operation.name, this.pop(operation.span));
        return continued(baseCycles);
      case "pop":
        this.pop(operation.span);
        return continued(baseCycles);
      case "build_list":
      case "build_tuple": {
        this.checkCollection(operation.count, operation.span);
        const values = this.popMany(operation.count, operation.span);
        const value =
          operation.kind === "build_list"
            ? ({ kind: "list", values } as const)
            : ({ kind: "tuple", values } as const);
        this.push(value, operation.span);
        this.noteAllocation(32 + values.length * 8);
        return continued(baseCycles + values.length * 2);
      }
      case "build_dict": {
        this.checkCollection(operation.count, operation.span);
        const values = this.popMany(operation.count * 2, operation.span);
        const entries = new Map<RuntimeValue, RuntimeValue>();
        for (let index = 0; index < values.length; index += 2)
          entries.set(values[index]!, values[index + 1]!);
        this.push({ kind: "dictionary", entries }, operation.span);
        this.noteAllocation(48 + entries.size * 24);
        return continued(baseCycles + entries.size * 4);
      }
      case "format": {
        const values = this.popMany(operation.count, operation.span);
        const value = values.map(formatValue).join("");
        this.checkString(value, operation.span);
        this.push(value, operation.span);
        this.noteAllocation(16 + utf8ByteLength(value));
        return continued(baseCycles + Math.ceil(value.length / 4));
      }
      case "binary": {
        const right = this.pop(operation.span);
        const left = this.pop(operation.span);
        const value = this.binary(
          left,
          right,
          operation.operator,
          operation.span,
        );
        this.push(value, operation.span);
        if (typeof value === "string")
          this.noteAllocation(16 + utf8ByteLength(value));
        return continued(baseCycles + (operation.operator === "**" ? 20 : 4));
      }
      case "unary": {
        const value = this.pop(operation.span);
        this.push(
          operation.operator === "not"
            ? !truthy(value)
            : operation.operator === "+"
              ? requireNumber(value, operation.span)
              : -requireNumber(value, operation.span),
          operation.span,
        );
        return continued(baseCycles);
      }
      case "compare": {
        const values = this.popMany(
          operation.operators.length + 1,
          operation.span,
        );
        this.push(
          operation.operators.every((operator, index) =>
            compare(
              values[index]!,
              values[index + 1]!,
              operator,
              operation.span,
            ),
          ),
          operation.span,
        );
        return continued(baseCycles + operation.operators.length * 4);
      }
      case "truthy": {
        const value = operation.keep
          ? this.peek(operation.span)
          : this.pop(operation.span);
        context.writeRegister("eax", truthy(value) ? 1 : 0);
        return continued(baseCycles);
      }
      case "load_attribute":
        this.push(
          loadAttribute(
            this.pop(operation.span),
            operation.name,
            operation.span,
          ),
          operation.span,
        );
        return continued(baseCycles);
      case "store_attribute": {
        const value = this.pop(operation.span);
        const object = this.pop(operation.span);
        if (!isNamespace(object))
          throw new VmRuntimeError(
            "TypeError",
            "Object attributes are not writable",
            operation.span,
          );
        object.values.set(operation.name, value);
        return continued(baseCycles);
      }
      case "load_subscript": {
        const index = this.pop(operation.span);
        const object = this.pop(operation.span);
        this.push(loadSubscript(object, index, operation.span), operation.span);
        return continued(baseCycles);
      }
      case "store_subscript": {
        const value = this.pop(operation.span);
        const index = this.pop(operation.span);
        const object = this.pop(operation.span);
        storeSubscript(
          object,
          index,
          value,
          operation.span,
          this.options.limits.maxCollectionSize,
        );
        return continued(baseCycles);
      }
      case "get_iter": {
        const iterator = iteratorValue(
          this.pop(operation.span),
          operation.span,
        );
        this.push(iterator, operation.span);
        this.noteAllocation(32 + iterator.values.length * 8);
        return continued(baseCycles);
      }
      case "for_iter": {
        const value = this.peek(operation.span);
        if (!isIterator(value))
          throw new VmRuntimeError(
            "RuntimeError",
            "FOR_ITER requires an iterator",
            operation.span,
          );
        if (value.index >= value.values.length) {
          this.pop(operation.span);
          context.writeRegister("eax", 0);
        } else {
          this.push(value.values[value.index++]!, operation.span);
          context.writeRegister("eax", 1);
        }
        return continued(baseCycles);
      }
      case "make_function": {
        const descriptor = this.options.functions[operation.functionId];
        if (descriptor === undefined || descriptor.target < 0)
          throw new VmRuntimeError(
            "ExecutableFormatError",
            "invalid Python function target",
            operation.span,
          );
        const defaults = this.popMany(operation.defaultCount, operation.span);
        const frame = this.frame();
        const callable = nativeFunction(descriptor.name, () => {
          throw new VmRuntimeError(
            "RuntimeError",
            "managed function escaped CS486 call path",
          );
        });
        this.callables.set(callable, {
          defaults,
          descriptor,
          globals: frame.globals,
          kind: "python",
          moduleId: frame.moduleId,
        });
        this.push(callable, operation.span);
        this.noteAllocation(64 + defaults.length * 8);
        return continued(baseCycles);
      }
      case "call":
        return this.call(
          operation,
          context,
          baseCycles + operation.argumentNames.length * 4,
        );
      case "after_call": {
        const marker = this.callMarkers.at(-1);
        if (marker?.kind === "extension") {
          this.callMarkers.pop();
          this.push(context.readRegister("eax"), operation.span);
        }
        return continued(baseCycles);
      }
      case "return": {
        const value = this.pop(operation.span);
        return this.applyControlAction({ kind: "return", value }, baseCycles);
      }
      case "begin_control": {
        const action =
          operation.action.kind === "return"
            ? {
                kind: "return" as const,
                value: this.pop(operation.span),
              }
            : operation.action;
        const [first, ...remainingFinalizers] = operation.finalizers;
        for (const finalizer of operation.finalizers) {
          const index = this.exceptionHandlers.findLastIndex(
            ({ finallyTarget }) => finallyTarget === finalizer,
          );
          if (index >= 0) this.exceptionHandlers.splice(index, 1);
        }
        if (first === undefined)
          return this.applyControlAction(action, baseCycles);
        this.pendingControl = {
          action,
          kind: "control",
          remainingFinalizers,
        };
        return jumpTo(first, baseCycles);
      }
      case "finish_finally": {
        const pending = this.pendingControl;
        this.pendingControl = undefined;
        if (pending === undefined) return continued(baseCycles);
        if (pending.kind === "fault")
          return this.routeFault(pending.error, context, baseCycles);
        const [next, ...remainingFinalizers] = pending.remainingFinalizers;
        if (next !== undefined) {
          this.pendingControl = {
            ...pending,
            remainingFinalizers,
          };
          return jumpTo(next, baseCycles);
        }
        return this.applyControlAction(pending.action, baseCycles);
      }
      case "push_handler":
        this.exceptionHandlers.push({
          activeFaultDepth: this.activeFaults.length,
          callMarkerDepth: this.callMarkers.length,
          finallyTarget: operation.finallyTarget,
          frameDepth: this.frames.length,
          handlers: operation.handlers,
          machineStackPointer: context.readRegister("esp"),
          stackDepth: this.stack.length,
        });
        return continued(baseCycles);
      case "push_finally_guard":
        this.exceptionHandlers.push({
          activeFaultDepth: this.activeFaults.length,
          callMarkerDepth: this.callMarkers.length,
          finallyTarget: operation.finallyTarget,
          frameDepth: this.frames.length,
          handlers: [],
          machineStackPointer: context.readRegister("esp"),
          stackDepth: this.stack.length,
        });
        return continued(baseCycles);
      case "pop_handler":
        if (this.exceptionHandlers.pop() === undefined)
          throw new VmRuntimeError(
            "RuntimeError",
            "exception handler stack underflow",
            operation.span,
          );
        return continued(baseCycles);
      case "leave_handler":
        if (this.activeFaults.pop() === undefined)
          throw new VmRuntimeError(
            "RuntimeError",
            "active exception stack underflow",
            operation.span,
          );
        return continued(baseCycles);
      case "raise": {
        if (!operation.hasValue) {
          const active = this.activeFaults.at(-1);
          if (active === undefined)
            throw new VmRuntimeError(
              "RuntimeError",
              "No active exception to reraise",
              operation.span,
            );
          throw active;
        }
        throw faultFromValue(this.pop(operation.span), operation.span);
      }
      case "module_complete":
        return this.completeModule(operation, baseCycles);
      case "import":
        return this.importModule(operation, baseCycles);
    }
  }

  private call(
    operation: Extract<PythonOperation, { kind: "call" }>,
    _context: Cs486SyscallContext,
    cycles: number,
  ): Cs486SyscallResult {
    const values = this.popMany(operation.argumentNames.length, operation.span);
    const callee = this.pop(operation.span);
    const positional: RuntimeValue[] = [];
    const keywords = new Map<string, RuntimeValue>();
    operation.argumentNames.forEach((name, index) => {
      if (name === undefined) positional.push(values[index]!);
      else if (keywords.has(name))
        throw new VmRuntimeError(
          "TypeError",
          `Multiple values for argument ${name}`,
          operation.span,
        );
      else keywords.set(name, values[index]!);
    });
    if (
      typeof callee !== "object" ||
      callee === null ||
      callee.kind !== "native_function"
    )
      throw new VmRuntimeError(
        "TypeError",
        `${formatValue(callee)} is not callable`,
        operation.span,
      );
    const managed = this.callables.get(callee);
    if (managed?.kind === "python")
      return this.callPython(
        managed,
        positional,
        keywords,
        operation.span,
        cycles,
      );
    if (managed?.kind === "extension") {
      if (positional.length > 0 || keywords.size > 0)
        throw new VmRuntimeError(
          "TypeError",
          `${managed.name} currently accepts no arguments`,
          operation.span,
        );
      this.callMarkers.push({ kind: "extension" });
      return { cycles, kind: "call", target: managed.target };
    }

    const result = callee.call(positional, keywords);
    if (isWaitRequest(result)) {
      return {
        ...result,
        cycles,
        resume: (value) => this.push(value, operation.span),
      };
    }
    const value = isWorkRequest(result) ? result.value : result;
    this.push(value, operation.span);
    this.noteRuntimeValue(value);
    return continued(
      cycles + (isWorkRequest(result) ? checkedWorkCycles(result) : 0),
    );
  }

  private routeFault(
    fault: VmRuntimeError,
    context: Cs486SyscallContext,
    cycles = 16,
  ): Cs486SyscallResult {
    this.pendingControl = undefined;
    while (this.exceptionHandlers.length > 0) {
      const handler = this.exceptionHandlers.pop()!;
      this.stack.length = handler.stackDepth;
      this.frames.length = handler.frameDepth;
      this.callMarkers.length = handler.callMarkerDepth;
      this.activeFaults.length = handler.activeFaultDepth;
      context.writeRegister("esp", handler.machineStackPointer);
      const matched = handler.handlers.find(({ typeName }) =>
        exceptionMatches(typeName, fault.typeName),
      );
      if (matched !== undefined) {
        this.activeFaults.push(fault);
        if (matched.name !== undefined)
          this.frame().locals.set(matched.name, faultValue(fault));
        return jumpTo(matched.target, cycles);
      }
      if (handler.finallyTarget !== undefined) {
        this.pendingControl = { error: fault, kind: "fault" };
        return jumpTo(handler.finallyTarget, cycles);
      }
    }
    throw fault;
  }

  private applyControlAction(
    action:
      | { readonly kind: "return"; readonly value: RuntimeValue }
      | { readonly kind: "jump"; readonly target: TargetReference },
    cycles: number,
  ): Cs486SyscallResult {
    if (action.kind === "jump") return jumpTo(action.target, cycles);
    const frameDepth = this.frames.length;
    const frame = this.frames.pop();
    const marker = this.callMarkers.pop();
    if (frame?.kind !== "function" || marker?.kind !== "python")
      throw new VmRuntimeError("RuntimeError", "function return has no caller");
    while (
      this.exceptionHandlers.at(-1)?.frameDepth !== undefined &&
      this.exceptionHandlers.at(-1)!.frameDepth >= frameDepth
    )
      this.exceptionHandlers.pop();
    this.stack.length = frame.stackBase;
    this.push(action.value);
    return { cycles, kind: "return" };
  }

  private callPython(
    callable: Extract<ManagedCallable, { kind: "python" }>,
    positional: readonly RuntimeValue[],
    keywords: ReadonlyMap<string, RuntimeValue>,
    span: SourceSpan,
    cycles: number,
  ): Cs486SyscallResult {
    if (
      this.frames.filter(({ kind }) => kind === "function").length >=
      this.options.limits.maxCallDepth
    )
      throw new VmLimitError("call depth", span);
    const { parameters, requiredParameters } = callable.descriptor;
    if (positional.length > parameters.length)
      throw new VmRuntimeError(
        "TypeError",
        "Too many positional arguments",
        span,
      );
    const locals = new Map<string, RuntimeValue>();
    positional.forEach((value, index) => locals.set(parameters[index]!, value));
    for (const [name, value] of keywords) {
      if (!parameters.includes(name) || locals.has(name))
        throw new VmRuntimeError(
          "TypeError",
          `Unexpected or duplicate argument ${name}`,
          span,
        );
      locals.set(name, value);
    }
    parameters.forEach((name, index) => {
      if (!locals.has(name) && index >= requiredParameters)
        locals.set(name, callable.defaults[index - requiredParameters]!);
    });
    const missing = parameters.find((name) => !locals.has(name));
    if (missing !== undefined)
      throw new VmRuntimeError(
        "TypeError",
        `Missing required argument ${missing}`,
        span,
      );
    this.frames.push({
      globals: callable.globals,
      kind: "function",
      locals,
      moduleId: callable.moduleId,
      stackBase: this.stack.length,
    });
    this.callMarkers.push({ kind: "python" });
    return { cycles, kind: "call", target: callable.descriptor.target };
  }

  private importModule(
    operation: Extract<PythonOperation, { kind: "import" }>,
    cycles: number,
  ): Cs486SyscallResult {
    const imported = operation.imported;
    if (imported.kind === "builtin") {
      const module = this.options.environment.modules.get(imported.name);
      if (module === undefined)
        throw new VmRuntimeError(
          "ImportError",
          `Module ${imported.name} is unavailable`,
          operation.span,
        );
      this.frame().locals.set(operation.alias, module);
      return continued(cycles);
    }
    if (imported.kind === "missing")
      throw new VmRuntimeError(
        "ImportError",
        `No module named ${imported.name}`,
        operation.span,
      );
    if (imported.kind === "extension") {
      const extension = this.options.extensionModules[imported.extensionId];
      if (extension === undefined)
        throw new VmRuntimeError(
          "ImportError",
          `Extension ${imported.name} is unavailable`,
          operation.span,
        );
      let namespace = this.extensionNamespaces.get(imported.extensionId);
      if (namespace === undefined) {
        const values = new Map<string, RuntimeValue>();
        for (const [name, target] of extension.exports) {
          const callable = nativeFunction(name, () => {
            throw new VmRuntimeError(
              "RuntimeError",
              "extension escaped CS486 call path",
            );
          });
          this.callables.set(callable, { kind: "extension", name, target });
          values.set(name, callable);
        }
        namespace = {
          kind: "namespace",
          name: imported.name,
          values,
        };
        this.extensionNamespaces.set(imported.extensionId, namespace);
      }
      this.frame().locals.set(operation.alias, namespace);
      return continued(cycles + namespace.values.size * 2);
    }

    const state = this.moduleStates[imported.moduleId];
    if (state?.kind === "loaded") {
      this.frame().locals.set(operation.alias, state.namespace);
      return continued(cycles);
    }
    if (state?.kind === "loading")
      throw new VmRuntimeError(
        "ImportError",
        `circular import of ${imported.name}`,
        operation.span,
      );
    const module = this.options.modules[imported.moduleId];
    if (state === undefined || module === undefined || module.target < 0)
      throw new VmRuntimeError(
        "ImportError",
        `Module ${imported.name} is unavailable`,
        operation.span,
      );
    this.moduleStates[imported.moduleId] = { kind: "loading" };
    const globals = new Map<string, RuntimeValue>();
    this.frames.push({
      globals,
      kind: "module",
      locals: globals,
      moduleId: imported.moduleId,
      stackBase: this.stack.length,
    });
    this.callMarkers.push({ kind: "module", moduleId: imported.moduleId });
    this.frame(-2).locals.set(
      operation.alias,
      pendingModuleNamespace(imported.name),
    );
    return { cycles, kind: "call", target: module.target };
  }

  private completeModule(
    operation: Extract<PythonOperation, { kind: "module_complete" }>,
    cycles: number,
  ): Cs486SyscallResult {
    if (operation.moduleId === 0) {
      this.moduleStates[0] = {
        kind: "loaded",
        namespace: {
          kind: "namespace",
          name: "__main__",
          values: this.frames[0]!.globals,
        },
      };
      return { cycles, kind: "complete", value: null };
    }
    const frame = this.frames.pop();
    const marker = this.callMarkers.pop();
    if (
      frame?.kind !== "module" ||
      marker?.kind !== "module" ||
      marker.moduleId !== operation.moduleId
    )
      throw new VmRuntimeError(
        "RuntimeError",
        "module completion has no importer",
        operation.span,
      );
    const module = this.options.modules[operation.moduleId]!;
    const namespace: RuntimeNamespace = {
      kind: "namespace",
      name: module.name,
      values: frame.globals,
    };
    this.moduleStates[operation.moduleId] = { kind: "loaded", namespace };
    this.stack.length = frame.stackBase;
    const caller = this.frame();
    for (const [name, value] of caller.locals) {
      if (isPendingModuleNamespace(value, module.name))
        caller.locals.set(name, namespace);
    }
    return { cycles, kind: "return" };
  }

  private loadName(name: string, span: SourceSpan): RuntimeValue {
    const frame = this.frame();
    if (frame.locals.has(name)) return frame.locals.get(name)!;
    if (frame.globals.has(name)) return frame.globals.get(name)!;
    const global = this.options.environment.globals.get(name);
    if (global !== undefined) return global;
    if (name === "range")
      return rangeFunction(this.options.limits.maxCollectionSize);
    if (name === "len") return lenFunction();
    if (exceptionNames.has(name)) return exceptionConstructor(name);
    throw new VmRuntimeError("NameError", `Name ${name} is not defined`, span);
  }

  private binary(
    left: RuntimeValue,
    right: RuntimeValue,
    operator: Extract<PythonOperation, { kind: "binary" }>["operator"],
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
    if (["/", "//", "%"].includes(operator) && rightNumber === 0)
      throw new VmRuntimeError("ZeroDivisionError", "division by zero", span);
    if (operator === "+") return leftNumber + rightNumber;
    if (operator === "-") return leftNumber - rightNumber;
    if (operator === "*") return leftNumber * rightNumber;
    if (operator === "/") return leftNumber / rightNumber;
    if (operator === "//") return Math.floor(leftNumber / rightNumber);
    if (operator === "%")
      return ((leftNumber % rightNumber) + rightNumber) % rightNumber;
    return leftNumber ** rightNumber;
  }

  private frame(offset = -1): RuntimeFrame {
    const frame = this.frames.at(offset);
    if (frame === undefined)
      throw new VmRuntimeError(
        "RuntimeError",
        "Python runtime has no active frame",
      );
    return frame;
  }

  private push(value: RuntimeValue, span?: SourceSpan): void {
    if (this.stack.length >= this.options.limits.maxStackSize)
      throw new VmLimitError("stack", span);
    if (typeof value === "string") this.checkString(value, span);
    if (isSequence(value)) this.checkCollection(value.values.length, span);
    if (isDictionary(value)) this.checkCollection(value.entries.size, span);
    this.stack.push(value);
  }

  private pop(span?: SourceSpan): RuntimeValue {
    const value = this.stack.pop();
    if (value === undefined)
      throw new VmRuntimeError("RuntimeError", "Stack underflow", span);
    return value;
  }

  private peek(span?: SourceSpan): RuntimeValue {
    const value = this.stack.at(-1);
    if (value === undefined)
      throw new VmRuntimeError("RuntimeError", "Stack underflow", span);
    return value;
  }

  private popMany(count: number, span?: SourceSpan): RuntimeValue[] {
    if (count === 0) return [];
    if (this.stack.length < count)
      throw new VmRuntimeError("RuntimeError", "Stack underflow", span);
    return this.stack.splice(this.stack.length - count, count);
  }

  private checkCollection(size: number, span?: SourceSpan): void {
    if (size > this.options.limits.maxCollectionSize)
      throw new VmLimitError("collection", span);
  }

  private checkString(value: string, span?: SourceSpan): void {
    if (value.length > this.options.limits.maxStringLength)
      throw new VmLimitError("string", span);
  }

  private noteRuntimeValue(value: RuntimeValue): void {
    if (typeof value === "string")
      this.noteAllocation(16 + utf8ByteLength(value));
    else if (isSequence(value))
      this.noteAllocation(32 + value.values.length * 8);
    else if (isDictionary(value))
      this.noteAllocation(48 + value.entries.size * 24);
  }

  private noteAllocation(bytes: number): void {
    this.allocationPressureBytes += Math.max(0, Math.ceil(bytes));
    if (
      this.memoryUsageValue + this.allocationPressureBytes >
      this.options.memoryBytes
    ) {
      this.memoryUsageValue = this.measureMemoryUsage();
      this.allocationPressureBytes = 0;
      this.checkMemory();
    }
  }

  private checkMemory(): void {
    if (
      this.memoryUsageValue + this.allocationPressureBytes >
      this.options.memoryBytes
    )
      throw new VmMemoryError();
  }

  private measureMemoryUsage(): number {
    const seenObjects = new Set<object>();
    const seenMaps = new Set<Map<string, RuntimeValue>>();
    let bytes = 32 + this.stack.length * 8 + this.frames.length * 32;
    const measureMap = (values: Map<string, RuntimeValue>): void => {
      if (seenMaps.has(values)) return;
      seenMaps.add(values);
      bytes += 32;
      for (const [name, value] of values) {
        bytes += utf8ByteLength(name) + 16;
        bytes += estimateRuntimeValue(value, seenObjects);
      }
    };
    for (const value of this.stack)
      bytes += estimateRuntimeValue(value, seenObjects);
    for (const frame of this.frames) {
      measureMap(frame.locals);
      measureMap(frame.globals);
    }
    for (const state of this.moduleStates) {
      if (state.kind === "loaded") measureMap(state.namespace.values);
    }
    return bytes;
  }
}

function continued(cycles: number): Cs486SyscallResult {
  return { cycles, kind: "continue" };
}

function jumpTo(target: TargetReference, cycles: number): Cs486SyscallResult {
  if (!Number.isSafeInteger(target.target) || target.target < 0)
    throw new VmRuntimeError(
      "ExecutableFormatError",
      "unresolved Python control-flow target",
    );
  return { cycles, kind: "jump", target: target.target };
}

function checkedWorkCycles(work: VmWorkRequest): number {
  if (!Number.isSafeInteger(work.cycles) || work.cycles <= 0)
    throw new VmRuntimeError(
      "ValueError",
      "Native work cycles must be a positive safe integer",
    );
  return work.cycles;
}

function isWaitRequest(
  value: RuntimeValue | VmWaitRequest | VmWorkRequest,
): value is VmWaitRequest {
  return (
    typeof value === "object" &&
    value !== null &&
    (value.kind === "sleep" || value.kind === "wait_event")
  );
}

function isWorkRequest(
  value: RuntimeValue | VmWaitRequest | VmWorkRequest,
): value is VmWorkRequest {
  return typeof value === "object" && value !== null && value.kind === "work";
}

function truthy(value: RuntimeValue): boolean {
  if (value === null || value === false) return false;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") return value.length > 0;
  if (isSequence(value)) return value.values.length > 0;
  if (isDictionary(value)) return value.entries.size > 0;
  return true;
}

function requireNumber(value: RuntimeValue, span?: SourceSpan): number {
  if (typeof value !== "number")
    throw new VmRuntimeError(
      "TypeError",
      `Expected number, got ${formatValue(value)}`,
      span,
    );
  return value;
}

function formatValue(value: RuntimeValue): string {
  if (value === null) return "None";
  if (value === true) return "True";
  if (value === false) return "False";
  if (typeof value === "string" || typeof value === "number")
    return String(value);
  if (isSequence(value)) return value.values.map(formatValue).join(", ");
  if (isDictionary(value))
    return `{${[...value.entries]
      .map(([key, item]) => `${formatValue(key)}: ${formatValue(item)}`)
      .join(", ")}}`;
  return `<${value.kind}>`;
}

function estimateRuntimeValue(value: RuntimeValue, seen: Set<object>): number {
  if (typeof value === "string") return 16 + utf8ByteLength(value);
  if (typeof value !== "object" || value === null) return 8;
  if (seen.has(value)) return 8;
  seen.add(value);
  switch (value.kind) {
    case "list":
    case "tuple":
    case "iterator": {
      let bytes = 32 + value.values.length * 8;
      for (const item of value.values)
        bytes += estimateRuntimeValue(item, seen);
      return bytes;
    }
    case "dictionary": {
      let bytes = 48 + value.entries.size * 24;
      for (const [key, item] of value.entries) {
        bytes += estimateRuntimeValue(key, seen);
        bytes += estimateRuntimeValue(item, seen);
      }
      return bytes;
    }
    case "namespace": {
      let bytes = 48 + utf8ByteLength(value.name);
      for (const [name, item] of value.values) {
        bytes += utf8ByteLength(name) + 16;
        bytes += estimateRuntimeValue(item, seen);
      }
      return bytes;
    }
    case "native_function":
      return 48 + utf8ByteLength(value.name);
  }
}

function compare(
  left: RuntimeValue,
  right: RuntimeValue,
  operator: Extract<PythonOperation, { kind: "compare" }>["operators"][number],
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
  ))
    throw new VmRuntimeError("TypeError", "Values are not orderable", span);
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
  if (isDictionary(container)) return container.entries.has(item);
  throw new VmRuntimeError("TypeError", "Value is not a container", span);
}

function loadAttribute(
  object: RuntimeValue,
  name: string,
  span: SourceSpan,
): RuntimeValue {
  if (isNamespace(object)) {
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
  if (isDictionary(object)) {
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
  maximumCollectionSize: number,
): void {
  if (typeof object === "object" && object !== null && object.kind === "list") {
    object.values[normalizeIndex(index, object.values.length, span)] = value;
    return;
  }
  if (isDictionary(object)) {
    if (
      !object.entries.has(index) &&
      object.entries.size >= maximumCollectionSize
    )
      throw new VmLimitError("collection", span);
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
  if (typeof index !== "number" || !Number.isInteger(index))
    throw new VmRuntimeError("TypeError", "Index must be an integer", span);
  const normalized = index < 0 ? length + index : index;
  if (normalized < 0 || normalized >= length)
    throw new VmRuntimeError("IndexError", "index out of range", span);
  return normalized;
}

function iteratorValue(value: RuntimeValue, span: SourceSpan): RuntimeIterator {
  let values: readonly RuntimeValue[];
  if (typeof value === "string") values = [...value];
  else if (isSequence(value)) values = value.values;
  else if (isDictionary(value)) values = [...value.entries.keys()];
  else throw new VmRuntimeError("TypeError", "Value is not iterable", span);
  return { index: 0, kind: "iterator", values };
}

function isIterator(value: RuntimeValue): value is RuntimeIterator {
  return (
    typeof value === "object" && value !== null && value.kind === "iterator"
  );
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

function isDictionary(
  value: RuntimeValue,
): value is Extract<RuntimeValue, { kind: "dictionary" }> {
  return (
    typeof value === "object" && value !== null && value.kind === "dictionary"
  );
}

function isNamespace(value: RuntimeValue): value is RuntimeNamespace {
  return (
    typeof value === "object" && value !== null && value.kind === "namespace"
  );
}

function rangeFunction(maximumCollectionSize: number): NativeFunction {
  return nativeFunction("range", (positional, keywords) => {
    if (keywords.size > 0 || positional.length < 1 || positional.length > 3)
      throw new VmRuntimeError(
        "TypeError",
        "range expects one to three positional arguments",
      );
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
      if (values.length > maximumCollectionSize)
        throw new VmLimitError("collection");
    }
    return { kind: "list", values };
  });
}

function lenFunction(): NativeFunction {
  return nativeFunction("len", (positional) => {
    if (positional.length !== 1)
      throw new VmRuntimeError("TypeError", "len expects one argument");
    const value = positional[0]!;
    if (typeof value === "string") return value.length;
    if (isSequence(value)) return value.values.length;
    if (isDictionary(value)) return value.entries.size;
    throw new VmRuntimeError("TypeError", "object has no len");
  });
}

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
  return nativeFunction(typeName, (positional, keywords) => {
    if (keywords.size > 0 || positional.length > 1)
      throw new VmRuntimeError(
        "TypeError",
        `${typeName} expects zero or one positional argument`,
      );
    return {
      kind: "namespace",
      name: typeName,
      values: new Map([
        ["message", positional.length === 0 ? "" : formatValue(positional[0]!)],
      ]),
    };
  });
}

function faultFromValue(value: RuntimeValue, span: SourceSpan): VmRuntimeError {
  if (isNamespace(value) && exceptionNames.has(value.name)) {
    const message = value.values.get("message");
    return new VmRuntimeError(
      value.name,
      typeof message === "string" ? message : formatValue(message ?? ""),
      span,
      value,
    );
  }
  throw new VmRuntimeError("RuntimeError", formatValue(value), span, value);
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

function exceptionMatches(
  expected: string | undefined,
  actual: string,
): boolean {
  return (
    expected === undefined || expected === "Exception" || expected === actual
  );
}

function pendingModuleNamespace(name: string): RuntimeNamespace {
  return {
    kind: "namespace",
    name: `__loading__:${name}`,
    values: new Map(),
  };
}

function isPendingModuleNamespace(value: RuntimeValue, name: string): boolean {
  return isNamespace(value) && value.name === `__loading__:${name}`;
}

function emptySpan(): SourceSpan {
  const position = { column: 1, line: 1, offset: 0 };
  return { end: position, start: position };
}
