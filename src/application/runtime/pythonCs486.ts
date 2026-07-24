import type {
  AnnotatedAssignmentStatement,
  AnnotationScopeOwner,
  AssignmentTarget,
  CallArgumentKind,
  ClassDefinition,
  DeletionTarget,
  Expression,
  FormattedStringInterpolation,
  FormattedStringPart,
  FunctionDefinition,
  FunctionScopeNode,
  Module,
  ParameterKind,
  Pattern,
  Statement,
  TypeAliasStatement,
  TypeParameter,
} from "../../domain/language/ast.js";
import { LanguageSyntaxError } from "../../domain/language/errors.js";
import { parse } from "../../domain/language/parser.js";
import {
  analyzeScopes,
  comprehensionIteratorName,
  comprehensionResultName,
  isAsynchronousComprehension,
  type ScopeAnalysis,
  type ScopeBinding,
  type ScopeInfo,
} from "../../domain/language/scope.js";
import type { SourceSpan } from "../../domain/language/source.js";
import type { GuestFilesystem } from "../os/guestFilesystem.js";
import {
  cs486ExecutableMemoryRequirements,
  createCs486Flat32MemoryMetadata,
  Cs486Process,
  type Cs486ExecutableMemoryRequirements,
  type Cs486ExecutableV3,
  type Cs486ExecutableV4,
  type Cs486ExecutableV5,
  type Cs486ExecutableV6,
  type Cs486Flat32MemoryMetadata,
  type Cs486FunctionEntry,
  type Cs486Instruction,
  type Cs486SyscallContext,
  type Cs486SyscallResult,
} from "../../domain/cpu/cs486.js";
import {
  cs486ObjectDataAlignment,
  cs486ObjectDataModel,
  isCs486StructuredObject,
  validateCs486Object,
  type Cs486Object,
  type Cs486ObjectRelocation,
} from "../../domain/cpu/cs486Object.js";
import { cs486Word32DataModel } from "../../domain/cpu/cs486Compatibility.js";
import { VmLimitError, VmRuntimeError } from "../../domain/runtime/errors.js";
import {
  nativeFunction,
  type NativeFunction,
  type RuntimeAsyncGenerator,
  type RuntimeAsyncGeneratorOperation,
  type RuntimeBoundMethod,
  type RuntimeClass,
  type RuntimeCoroutine,
  type RuntimeDictionary,
  type RuntimeGenerator,
  type RuntimeInstance,
  type RuntimeIterator,
  type RuntimeList,
  type RuntimeNamespace,
  type RuntimeSequenceIterator,
  type RuntimeSet,
  type RuntimeTuple,
  type RuntimeValue,
  type VmWaitRequest,
  type VmWorkRequest,
} from "../../domain/runtime/value.js";
import { utf8ByteLength } from "../../domain/text/utf8.js";
import { objectDataLayout } from "../toolchain/cs486Assembler.js";
import {
  cs486NullGuardBytes,
  linkCs486Objects,
} from "../toolchain/cs486Linker.js";
import type { NativeEnvironment } from "./nativeModules.js";
import {
  PythonHeapAccounting,
  type PythonHeapRoots,
} from "./python/heapAccounting.js";
import {
  applyPythonBinaryNumeric,
  applyPythonUnaryNumeric,
  comparePythonNumbers,
  pythonIntegerBitLength,
  requireHostNumber,
} from "./python/numeric.js";
import type { CpuModel } from "../../domain/cpu/models.js";
import {
  defaultPythonRuntimeLimits,
  type PythonRuntimeLimits,
} from "./pythonLimits.js";

const pythonSyscallName = "python";
const maximumModules = 64;
const maximumImportDepth = 16;
const maximumTotalSourceBytes = 512_000;
const maximumClassInheritanceDepth = 64;
const maximumPatternNodes = 4_096;
const intrinsicPythonModules = new Set([
  "string",
  "string.templatelib",
  "typing",
]);
const callableIteratorSource = `
def __iter__(self):
    return self

def __next__(self):
    if self._exhausted:
        raise StopIteration
    try:
        value = self._callable()
    except StopIteration:
        self._exhausted = True
        raise
    if value == self._sentinel:
        self._exhausted = True
        raise StopIteration
    return value
`;

export interface PythonCs486Options {
  readonly collectMicroarchitectureStats?: boolean;
  readonly cpuModel?: CpuModel;
  readonly environment: NativeEnvironment;
  readonly filesystem: GuestFilesystem;
  readonly memoryBytes: number;
  readonly path: string;
  readonly source: string;
  readonly limits?: PythonRuntimeLimits;
}

export interface PythonCs486Program {
  readonly executable:
    Cs486ExecutableV3 | Cs486ExecutableV4 | Cs486ExecutableV5;
  readonly process: Cs486Process;
  readonly runtime: PythonCs486Runtime;
}

export interface PythonCs486PreparationOptions extends Omit<
  PythonCs486Options,
  "memoryBytes"
> {
  readonly managedRuntimeMemoryBytes?: number;
  /**
   * Physical bytes added to the CS486 linear grant for host-managed values.
   * Defaults to the full managed runtime quota. The built-in boot control loop
   * uses the base flat-process grant as its complete composite residency.
   */
  readonly managedRuntimeResidentBytes?: number;
}

export interface PreparedPythonCs486Program {
  readonly executable:
    Cs486ExecutableV3 | Cs486ExecutableV4 | Cs486ExecutableV5;
  readonly requirements: Extract<
    Cs486ExecutableMemoryRequirements,
    { readonly kind: "declared" }
  >;
  create(linearMemoryBytes: number): PythonCs486Program;
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
  const limits = options.limits ?? defaultPythonRuntimeLimits;
  const runtimeMemoryBytes = Math.min(
    options.memoryBytes,
    limits.maxMemoryBytes ?? options.memoryBytes,
  );
  const { memoryBytes, ...preparationOptions } = options;
  return preparePythonCs486Program({
    ...preparationOptions,
    managedRuntimeMemoryBytes: runtimeMemoryBytes,
  }).create(memoryBytes);
}

export function preparePythonCs486Program(
  options: PythonCs486PreparationOptions,
): PreparedPythonCs486Program {
  let preparationPhase = "option validation";
  try {
    return preparePythonCs486ProgramUnchecked(options, (phase) => {
      preparationPhase = phase;
    });
  } catch (error: unknown) {
    const normalized =
      error instanceof Error ? error : new Error(String(error));
    normalized.message = `${normalized.message} [Python preparation phase: ${preparationPhase}]`;
    throw normalized;
  }
}

function preparePythonCs486ProgramUnchecked(
  options: PythonCs486PreparationOptions,
  setPhase: (phase: string) => void,
): PreparedPythonCs486Program {
  const limits = options.limits ?? defaultPythonRuntimeLimits;
  const managedRuntimeMemoryBytes =
    options.managedRuntimeMemoryBytes ??
    limits.maxMemoryBytes ??
    defaultPythonRuntimeLimits.maxMemoryBytes;
  if (
    !Number.isSafeInteger(managedRuntimeMemoryBytes) ||
    managedRuntimeMemoryBytes === undefined ||
    managedRuntimeMemoryBytes <= 0
  )
    throw new RangeError(
      "managedRuntimeMemoryBytes must be a positive safe integer",
    );
  const managedRuntimeResidentBytes =
    options.managedRuntimeResidentBytes ?? managedRuntimeMemoryBytes;
  if (
    !Number.isSafeInteger(managedRuntimeResidentBytes) ||
    managedRuntimeResidentBytes < 0 ||
    managedRuntimeResidentBytes > managedRuntimeMemoryBytes
  )
    throw new RangeError(
      "managedRuntimeResidentBytes must be a nonnegative safe integer no larger than managedRuntimeMemoryBytes",
    );
  const memory = createCs486Flat32MemoryMetadata({
    auxiliaryResidentBytes: managedRuntimeResidentBytes,
  });
  if (options.filesystem !== options.environment.filesystem) {
    throw new Error(
      "Python imports and native modules must share one guest filesystem",
    );
  }
  setPhase("module resolution");
  const graph = resolveModules(options, setPhase);
  setPhase("compiler construction");
  const compiler = new PythonCs486Compiler(graph, memory);
  setPhase("CS486 compilation");
  const compiled = compiler.compile();
  setPhase("extension linking");
  const executable = appendExtensionObjects(compiled, graph.extensions);
  setPhase("memory requirement validation");
  const requirements = cs486ExecutableMemoryRequirements(executable.executable);
  if (requirements.kind !== "declared")
    throw new Error("Python compiler produced a legacy CS486 executable");
  return Object.freeze({
    executable: executable.executable,
    requirements,
    create(linearMemoryBytes: number): PythonCs486Program {
      const runtimeHolder: { runtime?: PythonCs486Runtime } = {};
      const process = new Cs486Process(executable.executable, {
        ...(options.collectMicroarchitectureStats === undefined
          ? {}
          : {
              collectMicroarchitectureStats:
                options.collectMicroarchitectureStats,
            }),
        cpuModel: options.cpuModel,
        externalMemoryUsageBytes: (): number =>
          runtimeHolder.runtime?.memoryUsageBytes ?? 0,
        memoryBytes: linearMemoryBytes,
        syscallHandler: (name, context): Cs486SyscallResult => {
          if (runtimeHolder.runtime === undefined)
            throw new Error("Python runtime is not initialized");
          return runtimeHolder.runtime.syscall(name, context);
        },
      });
      const runtime = new PythonCs486Runtime({
        callableIteratorFunctions: compiled.callableIteratorFunctions,
        classes: compiled.classes,
        environment: options.environment,
        functions: compiled.functions,
        limits,
        memoryBytes: managedRuntimeMemoryBytes,
        modules: compiled.modules,
        operations: compiled.operations,
        extensionModules: executable.extensionModules,
      });
      runtimeHolder.runtime = runtime;
      return { executable: executable.executable, process, runtime };
    },
  });
}

interface ResolvedModule {
  readonly ast: Module;
  readonly id: number;
  readonly imports: ReadonlyMap<string, ResolvedImport>;
  readonly isPackage: boolean;
  readonly name: string;
  readonly packageName: string;
  readonly parentModuleId?: number;
  readonly path: string;
  readonly scopes: ScopeAnalysis;
  readonly shortName: string;
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
  readonly parentModuleId?: number;
  readonly path: string;
  readonly shortName: string;
}

interface ImportRequest {
  readonly name: string;
  readonly required: boolean;
}

interface ResolvedGraph {
  readonly extensions: readonly ResolvedExtension[];
  readonly modules: readonly ResolvedModule[];
}

function resolveModules(
  options: PythonCs486PreparationOptions,
  setPhase: (phase: string) => void,
): ResolvedGraph {
  const modules: ResolvedModule[] = [];
  const extensions: ResolvedExtension[] = [];
  const moduleByPath = new Map<string, ResolvedModule>();
  const moduleByName = new Map<string, ResolvedModule>();
  const extensionByPath = new Map<string, ResolvedExtension>();
  let totalSourceBytes = 0;
  const mainRoot = directory(options.filesystem.normalize(options.path));

  const resolvePython = (
    name: string,
    path: string,
    source: string,
    depth: number,
    isPackage: boolean,
    parentModuleId?: number,
  ): ResolvedModule => {
    if (depth > maximumImportDepth)
      throw new VmRuntimeError("ImportError", "import depth limit exceeded");
    const normalizedPath = options.filesystem.normalize(path);
    const named = moduleByName.get(name);
    if (named !== undefined) return named;
    const existing = moduleByPath.get(normalizedPath);
    if (existing !== undefined) return existing;
    if (modules.length >= maximumModules)
      throw new VmRuntimeError("ImportError", "module count limit exceeded");
    totalSourceBytes += utf8ByteLength(source);
    if (totalSourceBytes > maximumTotalSourceBytes)
      throw new VmRuntimeError("ImportError", "module source limit exceeded");

    setPhase("module parsing");
    const parsed = parse(source);
    setPhase("scope analysis");
    const scopes = analyzeScopes(parsed);
    setPhase("import discovery");
    const packageName =
      name === "__main__"
        ? ""
        : isPackage
          ? name
          : name.includes(".")
            ? name.slice(0, name.lastIndexOf("."))
            : "";
    const importRequests = collectImports(parsed.body, packageName);
    const imports = new Map<string, ResolvedImport>();
    const placeholder: ResolvedModule = {
      ast: parsed,
      id: modules.length,
      imports,
      isPackage,
      name,
      packageName,
      parentModuleId,
      path: normalizedPath,
      scopes,
      shortName: name.split(".").at(-1)!,
      source,
      statements: parsed.body,
    };
    modules.push(placeholder);
    moduleByPath.set(normalizedPath, placeholder);
    moduleByName.set(name, placeholder);
    for (const request of importRequests) {
      setPhase("import resolution");
      const resolved = resolveNamedImport(request.name, depth + 1);
      if (resolved === undefined) {
        if (request.required) {
          imports.set(request.name, { kind: "missing", name: request.name });
        }
        continue;
      }
      imports.set(request.name, resolved);
    }
    return placeholder;
  };

  const resolveNamedImport = (
    name: string,
    depth: number,
  ): ResolvedImport | undefined => {
    if (
      intrinsicPythonModules.has(name) ||
      options.environment.modules.has(name)
    ) {
      return { kind: "builtin", name };
    }
    const parts = name.split(".");
    let parentModuleId: number | undefined;
    let leaf: ResolvedImport | undefined;
    for (let index = 0; index < parts.length; index += 1) {
      const qualifiedName = parts.slice(0, index + 1).join(".");
      const isLeaf = index === parts.length - 1;
      const existingModule = moduleByName.get(qualifiedName);
      if (existingModule !== undefined) {
        if (!isLeaf && !existingModule.isPackage) return undefined;
        parentModuleId = existingModule.id;
        leaf = {
          kind: "python",
          moduleId: existingModule.id,
          name: qualifiedName,
        };
        continue;
      }
      const found = findModuleFile(options.filesystem, qualifiedName, mainRoot);
      if (found === undefined || (!isLeaf && !found.isPackage))
        return undefined;
      if (found.kind === "python") {
        const child = resolvePython(
          qualifiedName,
          found.path,
          options.filesystem.readFile(found.path),
          depth + index,
          found.isPackage,
          parentModuleId,
        );
        parentModuleId = child.id;
        leaf = {
          kind: "python",
          moduleId: child.id,
          name: qualifiedName,
        };
        continue;
      }
      if (!isLeaf) return undefined;
      let extension = extensionByPath.get(found.path);
      if (extension === undefined) {
        if (extensions.length >= maximumModules)
          throw new VmRuntimeError(
            "ImportError",
            "extension module count limit exceeded",
          );
        extension = {
          id: extensions.length,
          name: qualifiedName,
          object: decodeObject(
            options.filesystem.readFile(found.path),
            found.path,
          ),
          parentModuleId,
          path: found.path,
          shortName: parts.at(-1)!,
        };
        extensions.push(extension);
        extensionByPath.set(found.path, extension);
      }
      leaf = {
        extensionId: extension.id,
        kind: "extension",
        name: qualifiedName,
      };
    }
    return leaf;
  };

  resolvePython("__main__", options.path, options.source, 0, false);
  return { extensions, modules };
}

function collectImports(
  statements: readonly Statement[],
  packageName: string,
): ImportRequest[] {
  const requests = new Map<string, boolean>();
  const add = (name: string, required: boolean): void => {
    requests.set(name, (requests.get(name) ?? false) || required);
  };
  const visit = (children: readonly Statement[]): void => {
    for (const statement of children) {
      switch (statement.kind) {
        case "ImportStatement":
          for (const imported of statement.imports) add(imported.module, true);
          break;
        case "FromImportStatement": {
          const base = absoluteFromImportName(
            packageName,
            statement.level,
            statement.module,
            statement.span,
          );
          add(base, true);
          if (!statement.wildcard) {
            for (const imported of statement.imports) {
              add(`${base}.${imported.name}`, false);
            }
          }
          break;
        }
        case "ForStatement":
        case "WhileStatement":
        case "FunctionDefinition":
        case "ClassDefinition":
        case "WithStatement":
          visit(statement.body);
          break;
        case "IfStatement":
          for (const branch of statement.branches) visit(branch.body);
          visit(statement.elseBody ?? []);
          break;
        case "MatchStatement":
          for (const matchCase of statement.cases) visit(matchCase.body);
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
  return [...requests].map(([name, required]) => ({ name, required }));
}

function findModuleFile(
  filesystem: GuestFilesystem,
  name: string,
  mainRoot: string,
):
  | {
      readonly isPackage: boolean;
      readonly kind: "extension" | "python";
      readonly path: string;
    }
  | undefined {
  if (!/^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/u.test(name))
    return undefined;
  const relative = name.replaceAll(".", "/");
  const roots = [mainRoot, "/lib/python", "/usr/lib/computer-system/python"];
  for (const root of roots) {
    const prefix = root === "/" ? "" : root;
    const packageDirectory = `${prefix}/${relative}`;
    if (
      filesystem.exists(packageDirectory) &&
      filesystem.isDirectory(packageDirectory)
    ) {
      const packagePath = `${packageDirectory}/__init__.py`;
      if (
        filesystem.exists(packagePath) &&
        !filesystem.isDirectory(packagePath)
      ) {
        return {
          isPackage: true,
          kind: "python",
          path: filesystem.normalize(packagePath),
        };
      }
    }
    const pythonPath = `${prefix}/${relative}.py`;
    if (filesystem.exists(pythonPath) && !filesystem.isDirectory(pythonPath))
      return {
        isPackage: false,
        kind: "python",
        path: filesystem.normalize(pythonPath),
      };
    const objectPath = `${prefix}/${relative}.o`;
    if (filesystem.exists(objectPath) && !filesystem.isDirectory(objectPath))
      return {
        isPackage: false,
        kind: "extension",
        path: filesystem.normalize(objectPath),
      };
  }
  return undefined;
}

function absoluteFromImportName(
  packageName: string,
  level: number,
  module: string | undefined,
  span: SourceSpan,
): string {
  if (level === 0) return module!;
  const parts = packageName === "" ? [] : packageName.split(".");
  if (parts.length === 0 || level > parts.length) {
    throw new VmRuntimeError(
      "ImportError",
      "attempted relative import beyond top-level package",
      span,
    );
  }
  const base = parts.slice(0, parts.length - level + 1);
  if (module !== undefined) base.push(...module.split("."));
  return base.join(".");
}

function directory(path: string): string {
  return path.slice(0, path.lastIndexOf("/")) || "/";
}

function initializeModuleGlobals(
  globals: Map<string, RuntimeValue>,
  module: CompiledModule,
): void {
  globals.set("__name__", module.name);
  globals.set("__package__", module.packageName);
  globals.set("__file__", module.path);
  if (module.isPackage) {
    globals.set("__path__", {
      kind: "list",
      values: [directory(module.path)],
    });
  }
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

interface PythonFormatInterpolationOperation {
  readonly conversion: "a" | "r" | "s" | null;
  readonly expression: string;
  readonly formatParts: readonly (
    string | PythonFormatInterpolationOperation
  )[];
}

type PythonOperation =
  | {
      readonly kind: "load_const";
      readonly span: SourceSpan;
      readonly value: RuntimeValue;
    }
  | {
      readonly binding: ScopeBinding;
      readonly kind:
        "delete_name" | "load_name" | "store_definition" | "store_name";
      readonly name: string;
      readonly span: SourceSpan;
    }
  | { readonly kind: "pop"; readonly span: SourceSpan }
  | {
      readonly kind: "prepare_async_context" | "prepare_context";
      readonly span: SourceSpan;
    }
  | { readonly kind: "context_fault_info"; readonly span: SourceSpan }
  | { readonly depth: number; readonly kind: "copy"; readonly span: SourceSpan }
  | {
      readonly count: number;
      readonly kind: "build_list" | "build_set" | "build_tuple";
      readonly starred: readonly boolean[];
      readonly span: SourceSpan;
    }
  | {
      readonly entries: readonly ("mapping_unpack" | "pair")[];
      readonly kind: "build_dict";
      readonly operandCount: number;
      readonly span: SourceSpan;
    }
  | {
      readonly containerKind: "dictionary" | "list" | "set";
      readonly kind: "comprehension_add";
      readonly span: SourceSpan;
    }
  | {
      readonly interpolations: readonly PythonFormatInterpolationOperation[];
      readonly kind: "format";
      readonly operandCount: number;
      readonly span: SourceSpan;
      readonly strings: readonly string[];
    }
  | {
      readonly interpolations: readonly PythonFormatInterpolationOperation[];
      readonly kind: "build_template";
      readonly operandCount: number;
      readonly span: SourceSpan;
      readonly strings: readonly string[];
    }
  | {
      readonly after: number;
      readonly before: number;
      readonly kind: "unpack";
      readonly span: SourceSpan;
      readonly starred: boolean;
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
      readonly kind:
        | "delete_attribute"
        | "load_attribute"
        | "store_attribute"
        | "store_attribute_rhs_first";
      readonly name: string;
      readonly span: SourceSpan;
    }
  | {
      readonly kind:
        | "delete_subscript"
        | "load_subscript"
        | "store_subscript"
        | "store_subscript_rhs_first";
      readonly span: SourceSpan;
    }
  | {
      readonly kind: "delete_slice" | "load_slice" | "store_slice_rhs_first";
      readonly span: SourceSpan;
    }
  | {
      readonly kind:
        "async_for_iter" | "await" | "for_iter" | "get_async_iter" | "get_iter";
      readonly span: SourceSpan;
    }
  | {
      readonly arguments: readonly CompiledCallArgument[];
      readonly kind: "call";
      readonly span: SourceSpan;
    }
  | {
      readonly kind: "compare_chain";
      readonly operator: Extract<
        Expression,
        { kind: "ComparisonExpression" }
      >["comparisons"][number]["operator"];
      readonly span: SourceSpan;
    }
  | {
      readonly kind: "after_call" | "dispatch_call";
      readonly span: SourceSpan;
    }
  | {
      readonly defaultCount: number;
      readonly functionId: number;
      readonly kind: "make_function";
      readonly span: SourceSpan;
    }
  | {
      readonly baseCount: number;
      readonly classId: number;
      readonly kind: "make_class";
      readonly span: SourceSpan;
    }
  | {
      readonly boundFunctionId?: number;
      readonly constraintsFunctionId?: number;
      readonly defaultFunctionId?: number;
      readonly kind: "make_type_parameter";
      readonly name: string;
      readonly parameterKind: TypeParameter["kind"];
      readonly span: SourceSpan;
    }
  | {
      readonly kind: "attach_type_parameters";
      readonly names: readonly string[];
      readonly span: SourceSpan;
    }
  | {
      readonly kind: "make_type_alias";
      readonly name: string;
      readonly span: SourceSpan;
      readonly typeParameterNames: readonly string[];
      readonly valueFunctionId: number;
    }
  | {
      readonly classId: number;
      readonly kind: "class_complete";
      readonly span: SourceSpan;
    }
  | {
      readonly kind: "class_return";
      readonly span: SourceSpan;
    }
  | {
      readonly classId: number;
      readonly doneTarget: TargetReference;
      readonly kind: "class_set_name_step";
      readonly span: SourceSpan;
    }
  | {
      readonly kind: "class_set_name_resume";
      readonly span: SourceSpan;
      readonly target: TargetReference;
    }
  | { readonly kind: "annotation_begin"; readonly span: SourceSpan }
  | {
      readonly kind: "annotation_add";
      readonly name: string;
      readonly span: SourceSpan;
    }
  | {
      readonly activeId: number;
      readonly kind: "annotation_is_active" | "record_annotation";
      readonly span: SourceSpan;
    }
  | {
      readonly kind: "yield";
      readonly resumeTarget: TargetReference;
      readonly span: SourceSpan;
    }
  | {
      readonly hasInput: boolean;
      readonly kind: "yield_from_step";
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
      readonly starExitTarget?: TargetReference;
      readonly stackDepthOffset?: number;
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
      readonly kind: "except_star_fault" | "except_star_leave";
      readonly span: SourceSpan;
    }
  | {
      readonly hasValue: boolean;
      readonly kind: "raise";
      readonly span: SourceSpan;
    }
  | {
      readonly hasMessage: boolean;
      readonly kind: "assert_fail";
      readonly span: SourceSpan;
    }
  | {
      readonly kind: "module_complete";
      readonly moduleId: number;
      readonly span: SourceSpan;
    }
  | {
      readonly alias?: string;
      readonly binding?: ScopeBinding;
      readonly bindBuiltinName?: string;
      readonly bindModuleId?: number;
      readonly imported: ResolvedImport;
      readonly kind: "import";
      readonly span: SourceSpan;
    }
  | {
      readonly imported: ResolvedImport;
      readonly kind: "module_has_attribute";
      readonly name: string;
      readonly span: SourceSpan;
    }
  | {
      readonly imported: ResolvedImport;
      readonly imports: readonly CompiledFromImport[];
      readonly kind: "bind_from";
      readonly span: SourceSpan;
      readonly wildcard: boolean;
    }
  | {
      readonly kind: "match_pattern";
      readonly nodeCount: number;
      readonly pattern: CompiledPattern;
      readonly span: SourceSpan;
    };

interface CompiledPatternBinding {
  readonly binding: ScopeBinding;
  readonly name: string;
}

interface PatternCapture extends CompiledPatternBinding {
  readonly value: RuntimeValue;
}

type CompiledPatternReference =
  | {
      readonly kind: "literal";
      readonly value: RuntimeValue;
    }
  | {
      readonly attributes: readonly string[];
      readonly binding: ScopeBinding;
      readonly kind: "name";
      readonly name: string;
    };

type CompiledPattern =
  | {
      readonly binding: CompiledPatternBinding;
      readonly kind: "capture";
      readonly span: SourceSpan;
    }
  | { readonly kind: "wildcard"; readonly span: SourceSpan }
  | {
      readonly kind: "literal";
      readonly span: SourceSpan;
      readonly value: RuntimeValue;
    }
  | {
      readonly kind: "value";
      readonly reference: CompiledPatternReference;
      readonly span: SourceSpan;
    }
  | {
      readonly binding: CompiledPatternBinding;
      readonly kind: "as";
      readonly pattern: CompiledPattern;
      readonly span: SourceSpan;
    }
  | {
      readonly alternatives: readonly CompiledPattern[];
      readonly kind: "or";
      readonly span: SourceSpan;
    }
  | {
      readonly elements: readonly CompiledPattern[];
      readonly kind: "sequence";
      readonly span: SourceSpan;
    }
  | {
      readonly binding?: CompiledPatternBinding;
      readonly kind: "star";
      readonly span: SourceSpan;
    }
  | {
      readonly entries: readonly {
        readonly key: CompiledPatternReference;
        readonly pattern: CompiledPattern;
      }[];
      readonly kind: "mapping";
      readonly rest?: CompiledPatternBinding;
      readonly span: SourceSpan;
    }
  | {
      readonly className: CompiledPatternReference;
      readonly keywords: readonly {
        readonly attribute: string;
        readonly pattern: CompiledPattern;
      }[];
      readonly kind: "class";
      readonly positional: readonly CompiledPattern[];
      readonly span: SourceSpan;
    };

interface TargetReference {
  target: number;
}

interface CompiledExceptionHandler {
  readonly binding?: ScopeBinding;
  readonly captureFault?: boolean;
  readonly name?: string;
  readonly starred?: boolean;
  readonly target: TargetReference;
  readonly typeNames?: readonly string[];
}

interface CompiledCallArgument {
  readonly kind: CallArgumentKind;
  readonly name?: string;
}

interface CompiledFromImport {
  readonly alias: string;
  readonly binding: ScopeBinding;
  readonly name: string;
}

interface CompiledParameter {
  readonly defaultIndex: number | undefined;
  readonly kind: ParameterKind;
  readonly name: string;
}

interface CompiledFunction {
  readonly annotationScope?: boolean;
  readonly annotationEntryCount: number;
  readonly annotationFunctionId?: number;
  readonly asyncGenerator: boolean;
  readonly cellNames: readonly string[];
  readonly coroutine: boolean;
  readonly freeNames: readonly string[];
  readonly generator: boolean;
  readonly id: number;
  readonly name: string;
  readonly parameters: readonly CompiledParameter[];
  target: number;
}

interface CompiledClass {
  readonly annotationEntryCount: number;
  readonly annotationFunctionId?: number;
  readonly freeNames: readonly string[];
  readonly id: number;
  readonly name: string;
  readonly needsClassCell: boolean;
  target: number;
}

interface CompiledModule {
  annotationEntryCount: number;
  annotationFunctionId?: number;
  readonly id: number;
  readonly isPackage: boolean;
  readonly name: string;
  readonly packageName: string;
  readonly parentModuleId?: number;
  readonly path: string;
  readonly shortName: string;
  target: number;
}

interface CompiledAnnotationEntry {
  readonly activeId?: number;
  readonly expression: Expression;
  readonly name: string;
  readonly span: SourceSpan;
}

interface AnnotationPlan {
  readonly entryIds: ReadonlyMap<AnnotatedAssignmentStatement, number>;
  readonly entries: readonly CompiledAnnotationEntry[];
  readonly functionId: number;
}

interface PythonCompilation {
  readonly callableIteratorFunctions: CallableIteratorFunctionIds;
  readonly classes: readonly CompiledClass[];
  readonly executable: Cs486ExecutableV3;
  readonly functions: readonly CompiledFunction[];
  readonly modules: readonly CompiledModule[];
  readonly operations: readonly PythonOperation[];
}

interface CallableIteratorFunctionIds {
  readonly iter: number;
  readonly next: number;
}

class PythonCs486Compiler {
  private readonly instructions: Cs486Instruction[] = [];
  private readonly operations: PythonOperation[] = [];
  private readonly functions: CompiledFunction[] = [];
  private readonly annotationPlans = new Map<number, AnnotationPlan>();
  private readonly classes: CompiledClass[] = [];
  private readonly modules: CompiledModule[];
  private readonly pendingCode: (
    | {
        readonly descriptor: CompiledFunction;
        readonly kind: "function";
        readonly node: FunctionScopeNode;
        readonly module: ResolvedModule;
      }
    | {
        readonly descriptor: CompiledClass;
        readonly kind: "class";
        readonly node: ClassDefinition;
        readonly module: ResolvedModule;
      }
    | {
        readonly descriptor: CompiledFunction;
        readonly entries: readonly CompiledAnnotationEntry[];
        readonly kind: "annotation";
        readonly module: ResolvedModule;
        readonly owner: AnnotationScopeOwner;
      }
    | {
        readonly descriptor: CompiledFunction;
        readonly expression: Expression;
        readonly kind: "lazy_type";
        readonly module: ResolvedModule;
        readonly owner: AnnotationScopeOwner;
      }
    | {
        readonly defaultCount: number;
        readonly descriptor: CompiledFunction;
        readonly kind: "type_scope";
        readonly module: ResolvedModule;
        readonly owner:
          ClassDefinition | FunctionDefinition | TypeAliasStatement;
      }
  )[] = [];
  private readonly loops: {
    readonly breakTarget: TargetReference;
    readonly continueTarget: TargetReference;
  }[] = [];
  private readonly finalizers: TargetReference[] = [];
  private currentModule!: ResolvedModule;
  private currentBindings = new Map<string, ScopeBinding>();
  private currentScopeKind: ScopeInfo["kind"] = "module";
  private currentAnnotationEntryIds:
    ReadonlyMap<AnnotatedAssignmentStatement, number> | undefined;

  constructor(
    private readonly graph: ResolvedGraph,
    private readonly memory: Cs486Flat32MemoryMetadata,
  ) {
    this.modules = graph.modules.map((module) => ({
      annotationEntryCount: 0,
      id: module.id,
      isPackage: module.isPackage,
      name: module.name,
      packageName: module.packageName,
      parentModuleId: module.parentModuleId,
      path: module.path,
      shortName: module.shortName,
      target: -1,
    }));
  }

  compile(): PythonCompilation {
    for (const module of this.graph.modules) {
      this.currentModule = module;
      this.selectScope(module.scopes.root);
      this.currentScopeKind = "module";
      const annotationPlan = this.annotationPlanForAssignments(
        module.ast,
        module.statements,
      );
      this.currentAnnotationEntryIds = annotationPlan?.entryIds;
      this.modules[module.id]!.annotationEntryCount =
        annotationPlan?.entries.length ?? 0;
      this.modules[module.id]!.annotationFunctionId =
        annotationPlan?.functionId;
      this.modules[module.id]!.target = this.instructions.length;
      this.statements(module.statements);
      this.emitOperation({
        kind: "module_complete",
        moduleId: module.id,
        span: module.statements.at(-1)?.span ?? emptySpan(),
      });
    }
    const callableIteratorFunctions = this.registerCallableIteratorFunctions();
    for (let index = 0; index < this.pendingCode.length; index += 1) {
      const pending = this.pendingCode[index]!;
      this.currentModule = pending.module;
      const scope =
        pending.kind === "function"
          ? pending.module.scopes.functionScopes.get(pending.node)
          : pending.kind === "class"
            ? pending.module.scopes.classScopes.get(pending.node)
            : pending.module.scopes.annotationScopes.get(pending.owner);
      if (scope === undefined) {
        throw new LanguageSyntaxError(
          `Missing scope analysis for ${pending.descriptor.name}`,
          pending.kind === "annotation" ||
            pending.kind === "lazy_type" ||
            pending.kind === "type_scope"
            ? pending.owner.span
            : pending.node.span,
        );
      }
      this.selectScope(scope);
      this.currentScopeKind =
        pending.kind === "function" || pending.kind === "class"
          ? pending.kind
          : "annotation";
      this.currentAnnotationEntryIds = undefined;
      pending.descriptor.target = this.instructions.length;
      if (pending.kind === "annotation") {
        this.emitOperation({
          kind: "annotation_begin",
          span: pending.owner.span,
        });
        for (const entry of pending.entries) {
          let inactive: number | undefined;
          if (entry.activeId !== undefined) {
            this.emitOperation({
              activeId: entry.activeId,
              kind: "annotation_is_active",
              span: entry.span,
            });
            this.emit({ op: "cmp", left: "eax", right: immediate(0) });
            inactive = this.emitJump("je");
          }
          this.expression(entry.expression);
          this.emitOperation({
            kind: "annotation_add",
            name: entry.name,
            span: entry.span,
          });
          if (inactive !== undefined) {
            this.patch(inactive, this.instructions.length);
          }
        }
        this.emitOperation({ kind: "return", span: pending.owner.span });
      } else if (pending.kind === "lazy_type") {
        this.expression(pending.expression);
        this.emitOperation({ kind: "return", span: pending.expression.span });
      } else if (pending.kind === "type_scope") {
        this.typeScopeBody(pending.owner, pending.defaultCount);
      } else if (pending.kind === "class") {
        this.currentAnnotationEntryIds = this.annotationPlanEntryIds(
          pending.descriptor.annotationFunctionId,
        );
        this.statements(pending.node.body);
        this.emitOperation({
          classId: pending.descriptor.id,
          kind: "class_complete",
          span: pending.node.span,
        });
        const setNameTarget = { target: this.instructions.length };
        const doneTarget = { target: -1 };
        this.emitOperation({
          classId: pending.descriptor.id,
          doneTarget,
          kind: "class_set_name_step",
          span: pending.node.span,
        });
        this.emitOperation({
          kind: "class_set_name_resume",
          span: pending.node.span,
          target: setNameTarget,
        });
        doneTarget.target = this.instructions.length;
        this.emitOperation({ kind: "class_return", span: pending.node.span });
      } else if (pending.node.kind === "FunctionDefinition") {
        this.statements(pending.node.body);
        this.emitOperation({
          kind: "load_const",
          span: pending.node.span,
          value: null,
        });
      } else if (pending.node.kind === "LambdaExpression") {
        this.expression(pending.node.body);
      } else {
        this.comprehensionBody(pending.node);
      }
      if (pending.kind === "function") {
        this.emitOperation({ kind: "return", span: pending.node.span });
      }
    }
    if (this.instructions.length > 4_096)
      throw new VmLimitError("compiled instruction");
    return {
      callableIteratorFunctions,
      classes: this.classes,
      executable: {
        format: "cs486-executable",
        instructions: this.instructions,
        memory: this.memory,
        version: 3,
      },
      functions: this.functions,
      modules: this.modules,
      operations: this.operations,
    };
  }

  private registerCallableIteratorFunctions(): CallableIteratorFunctionIds {
    const ast = parse(callableIteratorSource);
    const module: ResolvedModule = {
      ast,
      id: 0,
      imports: new Map(),
      isPackage: false,
      name: "<callable iterator>",
      packageName: "",
      path: "<callable iterator>",
      scopes: analyzeScopes(ast),
      shortName: "<callable iterator>",
      source: callableIteratorSource,
      statements: ast.body,
    };
    const ids = new Map<string, number>();
    for (const node of ast.body) {
      if (node.kind !== "FunctionDefinition") continue;
      const scope = module.scopes.functionScopes.get(node);
      if (scope === undefined) {
        throw new LanguageSyntaxError(
          `Missing scope analysis for internal function ${node.name}`,
          node.span,
        );
      }
      const descriptor: CompiledFunction = {
        annotationEntryCount: 0,
        asyncGenerator: false,
        cellNames: scope.symbols
          .filter(({ binding }) => binding === "cell")
          .map(({ name }) => name),
        freeNames: scope.freeNames,
        coroutine: false,
        generator: false,
        id: this.functions.length,
        name: `<callable_iterator.${node.name}>`,
        parameters: node.parameters.map(({ name, parameterKind }) => ({
          defaultIndex: undefined,
          kind: parameterKind,
          name,
        })),
        target: -1,
      };
      this.functions.push(descriptor);
      this.pendingCode.push({
        descriptor,
        kind: "function",
        module,
        node,
      });
      ids.set(node.name, descriptor.id);
    }
    const iter = ids.get("__iter__");
    const next = ids.get("__next__");
    if (iter === undefined || next === undefined) {
      throw new Error("callable iterator support functions are incomplete");
    }
    return { iter, next };
  }

  private statements(statements: readonly Statement[]): void {
    for (const statement of statements) this.statement(statement);
  }

  private selectScope(scope: ScopeInfo): void {
    this.currentBindings = new Map(
      scope.symbols.map(({ binding, name }) => [name, binding]),
    );
  }

  private annotationPlanForAssignments(
    owner: Module | ClassDefinition,
    statements: readonly Statement[],
  ): AnnotationPlan | undefined {
    const assignments = collectAnnotatedAssignments(statements);
    if (assignments.length === 0) return undefined;
    const entryIds = new Map<AnnotatedAssignmentStatement, number>();
    const entries = assignments.map((assignment, activeId) => {
      entryIds.set(assignment, activeId);
      return {
        activeId,
        expression: assignment.annotation,
        name: (
          assignment.target as Extract<
            AssignmentTarget,
            { readonly kind: "IdentifierExpression" }
          >
        ).name,
        span: assignment.annotation.span,
      } satisfies CompiledAnnotationEntry;
    });
    return this.createAnnotationPlan(owner, entries, entryIds);
  }

  private annotationPlanForFunction(
    node: Extract<FunctionScopeNode, { readonly kind: "FunctionDefinition" }>,
  ): AnnotationPlan | undefined {
    const entries: CompiledAnnotationEntry[] = [];
    for (const parameter of node.parameters) {
      if (parameter.annotation !== undefined) {
        entries.push({
          expression: parameter.annotation,
          name: parameter.name,
          span: parameter.annotation.span,
        });
      }
    }
    if (node.returnAnnotation !== undefined) {
      entries.push({
        expression: node.returnAnnotation,
        name: "return",
        span: node.returnAnnotation.span,
      });
    }
    return entries.length === 0
      ? undefined
      : this.createAnnotationPlan(node, entries, new Map());
  }

  private createAnnotationPlan(
    owner: AnnotationScopeOwner,
    entries: readonly CompiledAnnotationEntry[],
    entryIds: ReadonlyMap<AnnotatedAssignmentStatement, number>,
  ): AnnotationPlan {
    const scope = this.currentModule.scopes.annotationScopes.get(owner);
    if (scope === undefined) {
      throw new LanguageSyntaxError(
        "Missing annotation scope analysis",
        owner.span,
      );
    }
    const descriptor: CompiledFunction = {
      annotationEntryCount: 0,
      asyncGenerator: false,
      cellNames: scope.symbols
        .filter(({ binding }) => binding === "cell")
        .map(({ name }) => name),
      freeNames: [
        ...new Set([...scope.freeNames, ...typeParameterNames(owner)]),
      ],
      coroutine: false,
      generator: false,
      id: this.functions.length,
      name: scope.name,
      annotationScope: true,
      parameters: [],
      target: -1,
    };
    const plan: AnnotationPlan = {
      entries,
      entryIds,
      functionId: descriptor.id,
    };
    this.functions.push(descriptor);
    this.annotationPlans.set(descriptor.id, plan);
    this.pendingCode.push({
      descriptor,
      entries,
      kind: "annotation",
      module: this.currentModule,
      owner,
    });
    return plan;
  }

  private annotationPlanEntryIds(
    functionId: number | undefined,
  ): ReadonlyMap<AnnotatedAssignmentStatement, number> | undefined {
    return functionId === undefined
      ? undefined
      : this.annotationPlans.get(functionId)?.entryIds;
  }

  private registerLazyTypeEvaluator(
    owner: AnnotationScopeOwner,
    expression: Expression,
    label: string,
  ): number {
    const scope = this.currentModule.scopes.annotationScopes.get(owner);
    if (scope === undefined) {
      throw new LanguageSyntaxError(
        "Missing type-parameter annotation scope",
        owner.span,
      );
    }
    const descriptor: CompiledFunction = {
      annotationEntryCount: 0,
      asyncGenerator: false,
      annotationScope: true,
      cellNames: [],
      freeNames: [
        ...new Set([
          ...scope.freeNames,
          ...scope.symbols
            .filter(({ binding }) => binding === "cell")
            .map(({ name }) => name),
        ]),
      ],
      coroutine: false,
      generator: false,
      id: this.functions.length,
      name: `<${label}>`,
      parameters: [],
      target: -1,
    };
    this.functions.push(descriptor);
    this.pendingCode.push({
      descriptor,
      expression,
      kind: "lazy_type",
      module: this.currentModule,
      owner,
    });
    return descriptor.id;
  }

  private registerTypeScope(
    owner: ClassDefinition | FunctionDefinition | TypeAliasStatement,
    defaultCount: number,
  ): CompiledFunction {
    const scope = this.currentModule.scopes.annotationScopes.get(owner);
    if (scope === undefined) {
      throw new LanguageSyntaxError(
        `Missing type-parameter scope for ${owner.name}`,
        owner.span,
      );
    }
    const descriptor: CompiledFunction = {
      annotationEntryCount: 0,
      asyncGenerator: false,
      annotationScope: true,
      cellNames: scope.symbols
        .filter(({ binding }) => binding === "cell")
        .map(({ name }) => name),
      freeNames: scope.freeNames,
      coroutine: false,
      generator: false,
      id: this.functions.length,
      name: `<type parameters of ${owner.name}>`,
      parameters: Array.from({ length: defaultCount }, (_, index) => ({
        defaultIndex: undefined,
        kind: "positional_only" as const,
        name: typeScopeDefaultName(index),
      })),
      target: -1,
    };
    this.functions.push(descriptor);
    this.pendingCode.push({
      defaultCount,
      descriptor,
      kind: "type_scope",
      module: this.currentModule,
      owner,
    });
    return descriptor;
  }

  private emitTypeScopeCall(
    owner: ClassDefinition | FunctionDefinition | TypeAliasStatement,
    defaultValues: readonly Expression[],
  ): void {
    const descriptor = this.registerTypeScope(owner, defaultValues.length);
    this.emitOperation({
      defaultCount: 0,
      functionId: descriptor.id,
      kind: "make_function",
      span: owner.span,
    });
    for (const value of defaultValues) this.expression(value);
    this.emitOperation({
      arguments: defaultValues.map(() => ({ kind: "positional" as const })),
      kind: "call",
      span: owner.span,
    });
    this.emitOperation({ kind: "dispatch_call", span: owner.span });
    this.emitOperation({ kind: "after_call", span: owner.span });
  }

  private typeScopeBody(
    owner: ClassDefinition | FunctionDefinition | TypeAliasStatement,
    defaultCount: number,
  ): void {
    for (const parameter of owner.typeParameters) {
      const bound =
        parameter.kind === "TypeVariable" ? parameter.bound : undefined;
      const constraintExpression =
        bound?.kind === "TupleExpression" ? bound : undefined;
      const boundExpression =
        bound !== undefined && bound.kind !== "TupleExpression"
          ? bound
          : undefined;
      this.emitOperation({
        boundFunctionId:
          boundExpression === undefined
            ? undefined
            : this.registerLazyTypeEvaluator(
                owner,
                boundExpression,
                `bound of ${parameter.name}`,
              ),
        constraintsFunctionId:
          constraintExpression === undefined
            ? undefined
            : this.registerLazyTypeEvaluator(
                owner,
                constraintExpression,
                `constraints of ${parameter.name}`,
              ),
        defaultFunctionId:
          parameter.defaultValue === undefined
            ? undefined
            : this.registerLazyTypeEvaluator(
                owner,
                parameter.defaultValue,
                `default of ${parameter.name}`,
              ),
        kind: "make_type_parameter",
        name: parameter.name,
        parameterKind: parameter.kind,
        span: parameter.span,
      });
      this.emitOperation({
        binding: "cell",
        kind: "store_name",
        name: parameter.name,
        span: parameter.span,
      });
    }

    if (owner.kind === "FunctionDefinition") {
      for (let index = 0; index < defaultCount; index += 1) {
        this.emitOperation({
          binding: "local",
          kind: "load_name",
          name: typeScopeDefaultName(index),
          span: owner.span,
        });
      }
      this.emitRegisteredFunction(owner, defaultCount);
      this.emitOperation({
        kind: "attach_type_parameters",
        names: typeParameterNames(owner),
        span: owner.span,
      });
    } else if (owner.kind === "ClassDefinition") {
      for (const base of owner.bases) this.expression(base);
      const descriptor = this.registerClass(owner);
      this.emitOperation({
        baseCount: owner.bases.length,
        classId: descriptor.id,
        kind: "make_class",
        span: owner.span,
      });
      this.emitOperation({
        kind: "attach_type_parameters",
        names: typeParameterNames(owner),
        span: owner.span,
      });
    } else {
      const valueFunctionId = this.registerLazyTypeEvaluator(
        owner,
        owner.value,
        `value of ${owner.name}`,
      );
      this.emitOperation({
        kind: "make_type_alias",
        name: owner.name,
        span: owner.span,
        typeParameterNames: typeParameterNames(owner),
        valueFunctionId,
      });
    }
    this.emitOperation({ kind: "return", span: owner.span });
  }

  private bindingFor(name: string): ScopeBinding {
    return this.currentBindings.get(name) ?? "global";
  }

  private statement(statement: Statement): void {
    switch (statement.kind) {
      case "AnnotatedAssignmentStatement": {
        if (statement.value !== undefined) {
          this.assignment([statement.target], statement.value);
        } else if (!statement.simpleTarget) {
          this.evaluateBareAnnotatedTarget(statement.target);
        }
        if (
          statement.simpleTarget &&
          (this.currentScopeKind === "module" ||
            this.currentScopeKind === "class")
        ) {
          const activeId = this.currentAnnotationEntryIds?.get(statement);
          if (activeId === undefined) {
            throw new LanguageSyntaxError(
              "Missing compiled annotation entry",
              statement.span,
            );
          }
          this.emitOperation({
            activeId,
            kind: "record_annotation",
            span: statement.span,
          });
        }
        return;
      }
      case "AssertStatement": {
        this.expression(statement.test);
        this.emitOperation({
          keep: false,
          kind: "truthy",
          span: statement.test.span,
        });
        this.emit({ op: "cmp", left: "eax", right: immediate(0) });
        const passed = this.emitJump("jne");
        if (statement.message === undefined) {
          this.emitOperation({
            kind: "load_const",
            span: statement.span,
            value: null,
          });
        } else {
          this.expression(statement.message);
        }
        this.emitOperation({
          hasMessage: statement.message !== undefined,
          kind: "assert_fail",
          span: statement.span,
        });
        this.patch(passed, this.instructions.length);
        return;
      }
      case "AssignmentStatement":
        this.assignment(statement.targets, statement.value);
        return;
      case "AugmentedAssignmentStatement":
        this.augmentedAssignment(
          statement.target,
          statement.operator,
          statement.value,
        );
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
      case "ClassDefinition":
        this.classDefinition(statement);
        return;
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
      case "DeleteStatement":
        this.deleteTarget(statement.target);
        return;
      case "ExpressionStatement":
        this.expression(statement.expression);
        this.emitOperation({ kind: "pop", span: statement.span });
        return;
      case "ForStatement": {
        this.expression(statement.iterable);
        this.emitOperation({
          kind: statement.asynchronous ? "get_async_iter" : "get_iter",
          span: statement.iterable.span,
        });
        const start = this.instructions.length;
        this.emitOperation({
          kind: statement.asynchronous ? "async_for_iter" : "for_iter",
          span: statement.span,
        });
        this.emit({ op: "cmp", left: "eax", right: immediate(0) });
        const exit = this.emitJump("je");
        this.emitOperation({
          binding: this.bindingFor(statement.target.name),
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
        for (const decorator of statement.decorators) {
          this.expression(decorator);
        }
        if (statement.typeParameters.length > 0) {
          const defaultValues = statement.parameters.flatMap(
            ({ defaultValue }) =>
              defaultValue === undefined ? [] : [defaultValue],
          );
          this.emitTypeScopeCall(statement, defaultValues);
        } else {
          this.functionExpression(statement);
        }
        this.applyDecorators(statement.decorators);
        this.emitOperation({
          binding: this.bindingFor(statement.name),
          kind: "store_definition",
          name: statement.name,
          span: statement.span,
        });
        return;
      }
      case "GlobalStatement":
      case "NonlocalStatement":
        return;
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
          const resolved =
            this.currentModule.imports.get(imported.module) ??
            ({ kind: "missing", name: imported.module } as const);
          const alias = imported.alias ?? imported.module.split(".")[0]!;
          const bindModuleId =
            resolved.kind === "python"
              ? imported.alias === undefined
                ? this.importChain(resolved)[0]!.moduleId
                : resolved.moduleId
              : undefined;
          const bindBuiltinName =
            resolved.kind === "builtin" && imported.alias === undefined
              ? imported.module.split(".")[0]
              : undefined;
          this.emitImport(
            resolved,
            imported.span,
            alias,
            this.bindingFor(alias),
            bindModuleId,
            bindBuiltinName,
          );
        }
        return;
      case "FromImportStatement": {
        const baseName = absoluteFromImportName(
          this.currentModule.packageName,
          statement.level,
          statement.module,
          statement.span,
        );
        const base =
          this.currentModule.imports.get(baseName) ??
          ({ kind: "missing", name: baseName } as const);
        this.emitImport(base, statement.span);
        if (statement.wildcard) {
          this.emitOperation({
            imported: base,
            imports: [],
            kind: "bind_from",
            span: statement.span,
            wildcard: true,
          });
          return;
        }
        for (const imported of statement.imports) {
          const candidate = this.currentModule.imports.get(
            `${baseName}.${imported.name}`,
          );
          if (candidate !== undefined) {
            this.emitOperation({
              imported: base,
              kind: "module_has_attribute",
              name: imported.name,
              span: imported.span,
            });
            this.emit({ op: "cmp", left: "eax", right: immediate(0) });
            const skipFallback = this.emitJump("jne");
            this.emitImport(candidate, imported.span);
            this.patch(skipFallback, this.instructions.length);
          }
          const alias = imported.alias ?? imported.name;
          this.emitOperation({
            imported: base,
            imports: [
              {
                alias,
                binding: this.bindingFor(alias),
                name: imported.name,
              },
            ],
            kind: "bind_from",
            span: imported.span,
            wildcard: false,
          });
        }
        return;
      }
      case "MatchStatement": {
        this.expression(statement.subject);
        const exits: number[] = [];
        for (const matchCase of statement.cases) {
          const state = { count: 0 };
          const pattern = this.compilePattern(matchCase.pattern, state);
          this.emitOperation({
            depth: 0,
            kind: "copy",
            span: statement.subject.span,
          });
          this.emitOperation({
            kind: "match_pattern",
            nodeCount: state.count,
            pattern,
            span: matchCase.pattern.span,
          });
          this.emit({ op: "cmp", left: "eax", right: immediate(0) });
          const nextPattern = this.emitJump("je");
          let nextGuard: number | undefined;
          if (matchCase.guard !== undefined) {
            this.expression(matchCase.guard);
            this.emitOperation({
              keep: false,
              kind: "truthy",
              span: matchCase.guard.span,
            });
            this.emit({ op: "cmp", left: "eax", right: immediate(0) });
            nextGuard = this.emitJump("je");
          }
          this.emitOperation({ kind: "pop", span: statement.subject.span });
          this.statements(matchCase.body);
          exits.push(this.emitJump("jmp"));
          this.patch(nextPattern, this.instructions.length);
          if (nextGuard !== undefined) {
            this.patch(nextGuard, this.instructions.length);
          }
        }
        this.emitOperation({ kind: "pop", span: statement.subject.span });
        const end = this.instructions.length;
        for (const exit of exits) this.patch(exit, end);
        return;
      }
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
        if (this.currentScopeKind === "class") {
          throw new LanguageSyntaxError(
            "return outside function",
            statement.span,
          );
        }
        if (statement.value === undefined)
          this.emitOperation({
            kind: "load_const",
            span: statement.span,
            value: null,
          });
        else this.expression(statement.value);
        if (this.currentScopeKind === "function")
          this.emitControl({ kind: "return" }, statement.span);
        else
          this.emitOperation({
            kind: "module_complete",
            moduleId: this.currentModule.id,
            span: statement.span,
          });
        return;
      case "TypeAliasStatement":
        this.emitTypeScopeCall(statement, []);
        this.emitOperation({
          binding: this.bindingFor(statement.name),
          kind: "store_definition",
          name: statement.name,
          span: statement.span,
        });
        return;
      case "TryStatement":
        this.tryStatement(statement);
        return;
      case "WithStatement":
        this.withStatement(statement);
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
        return;
      }
      case "YieldStatement": {
        this.yieldValue(statement.value, statement.span, statement.delegate);
        this.emitOperation({ kind: "pop", span: statement.span });
        return;
      }
    }
  }

  private compilePattern(
    pattern: Pattern,
    state: { count: number },
  ): CompiledPattern {
    state.count += 1;
    if (state.count > maximumPatternNodes) {
      throw new VmLimitError("pattern node", pattern.span);
    }
    const binding = (name: string): CompiledPatternBinding => ({
      binding: this.bindingFor(name),
      name,
    });
    switch (pattern.kind) {
      case "CapturePattern":
        return {
          binding: binding(pattern.name),
          kind: "capture",
          span: pattern.span,
        };
      case "WildcardPattern":
        return { kind: "wildcard", span: pattern.span };
      case "LiteralPattern":
        return { kind: "literal", span: pattern.span, value: pattern.value };
      case "ValuePattern":
        return {
          kind: "value",
          reference: this.compilePatternReference(pattern.value),
          span: pattern.span,
        };
      case "AsPattern":
        return {
          binding: binding(pattern.name),
          kind: "as",
          pattern: this.compilePattern(pattern.pattern, state),
          span: pattern.span,
        };
      case "OrPattern":
        return {
          alternatives: pattern.alternatives.map((alternative) =>
            this.compilePattern(alternative, state),
          ),
          kind: "or",
          span: pattern.span,
        };
      case "SequencePattern":
        return {
          elements: pattern.elements.map((element) =>
            this.compilePattern(element, state),
          ),
          kind: "sequence",
          span: pattern.span,
        };
      case "StarPattern":
        return {
          binding:
            pattern.name === undefined ? undefined : binding(pattern.name),
          kind: "star",
          span: pattern.span,
        };
      case "MappingPattern":
        return {
          entries: pattern.entries.map((entry) => ({
            key: this.compilePatternReference(entry.key),
            pattern: this.compilePattern(entry.pattern, state),
          })),
          kind: "mapping",
          rest: pattern.rest === undefined ? undefined : binding(pattern.rest),
          span: pattern.span,
        };
      case "ClassPattern":
        return {
          className: this.compilePatternReference(pattern.className),
          keywords: pattern.keywords.map((keyword) => ({
            attribute: keyword.attribute,
            pattern: this.compilePattern(keyword.pattern, state),
          })),
          kind: "class",
          positional: pattern.positional.map((positional) =>
            this.compilePattern(positional, state),
          ),
          span: pattern.span,
        };
    }
  }

  private compilePatternReference(
    expression: Expression,
  ): CompiledPatternReference {
    if (expression.kind === "LiteralExpression") {
      return { kind: "literal", value: expression.value };
    }
    const attributes: string[] = [];
    let root: Expression = expression;
    while (root.kind === "AttributeExpression") {
      attributes.unshift(root.attribute);
      root = root.object;
    }
    if (root.kind !== "IdentifierExpression") {
      throw new LanguageSyntaxError("Invalid pattern value", expression.span);
    }
    return {
      attributes,
      binding: this.bindingFor(root.name),
      kind: "name",
      name: root.name,
    };
  }

  private emitImport(
    imported: ResolvedImport,
    span: SourceSpan,
    alias?: string,
    binding?: ScopeBinding,
    bindModuleId?: number,
    bindBuiltinName?: string,
  ): void {
    const chain = this.importChain(imported);
    if (chain.length === 0) {
      this.emitOperation({
        alias,
        binding,
        bindBuiltinName,
        imported,
        kind: "import",
        span,
      });
      this.emitOperation({ kind: "dispatch_call", span });
      this.emitOperation({ kind: "after_call", span });
      return;
    }
    chain.forEach((step, index) => {
      const final = index === chain.length - 1;
      this.emitOperation({
        alias: final ? alias : undefined,
        binding: final ? binding : undefined,
        bindBuiltinName: final ? bindBuiltinName : undefined,
        bindModuleId: final ? bindModuleId : undefined,
        imported: step,
        kind: "import",
        span,
      });
      this.emitOperation({ kind: "dispatch_call", span });
      this.emitOperation({ kind: "after_call", span });
    });
  }

  private importChain(
    imported: ResolvedImport,
  ): Extract<ResolvedImport, { kind: "python" }>[] {
    if (imported.kind !== "python") return [];
    const chain: Extract<ResolvedImport, { kind: "python" }>[] = [];
    let module = this.graph.modules[imported.moduleId];
    while (module !== undefined && module.id !== 0) {
      chain.push({ kind: "python", moduleId: module.id, name: module.name });
      module =
        module.parentModuleId === undefined
          ? undefined
          : this.graph.modules[module.parentModuleId];
    }
    return chain.reverse();
  }

  private tryStatement(
    statement: Extract<Statement, { kind: "TryStatement" }>,
  ): void {
    if (statement.handlers[0]?.starred === true) {
      this.exceptStarTryStatement(statement);
      return;
    }
    const finallyTarget =
      statement.finallyBody === undefined ? undefined : { target: -1 };
    const handlers: CompiledExceptionHandler[] = statement.handlers.map(
      (handler) => {
        return {
          binding:
            handler.name === undefined
              ? undefined
              : this.bindingFor(handler.name),
          name: handler.name,
          starred: false,
          target: { target: -1 },
          typeNames: this.exceptionTypeNames(handler.type),
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

  private exceptStarTryStatement(
    statement: Extract<Statement, { kind: "TryStatement" }>,
  ): void {
    const finallyTarget =
      statement.finallyBody === undefined ? undefined : { target: -1 };
    const starExitTarget: TargetReference = { target: -1 };
    const handlers: CompiledExceptionHandler[] = statement.handlers.map(
      (handler) => ({
        binding:
          handler.name === undefined
            ? undefined
            : this.bindingFor(handler.name),
        name: handler.name,
        starred: true,
        target: { target: -1 },
        typeNames: this.exceptionTypeNames(handler.type),
      }),
    );
    this.emitOperation({
      finallyTarget,
      handlers,
      kind: "push_handler",
      span: statement.span,
      starExitTarget,
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

    statement.handlers.forEach((handler, index) => {
      const compiled = handlers[index]!;
      compiled.target.target = this.instructions.length;
      const faultTarget: TargetReference = { target: -1 };
      this.emitOperation({
        handlers: [{ captureFault: true, target: faultTarget }],
        kind: "push_handler",
        span: handler.span,
      });
      this.statements(handler.body);
      this.emitOperation({ kind: "pop_handler", span: handler.span });
      this.emitOperation({ kind: "except_star_leave", span: handler.span });
      faultTarget.target = this.instructions.length;
      this.emitOperation({ kind: "except_star_fault", span: handler.span });
    });

    if (finallyTarget === undefined) {
      const end = this.instructions.length;
      this.patch(normalExit, end);
      starExitTarget.target = end;
      return;
    }

    this.finalizers.pop();
    finallyTarget.target = this.instructions.length;
    starExitTarget.target = finallyTarget.target;
    this.patch(normalExit, finallyTarget.target);
    this.statements(statement.finallyBody ?? []);
    this.emitOperation({ kind: "finish_finally", span: statement.span });
  }

  private exceptionTypeNames(
    expression: Expression | undefined,
  ): readonly string[] | undefined {
    if (expression === undefined) return undefined;
    if (expression.kind === "IdentifierExpression") return [expression.name];
    if (
      expression.kind === "TupleExpression" &&
      expression.elements.length > 0 &&
      expression.elements.every(
        (element) => element.kind === "IdentifierExpression",
      )
    ) {
      return expression.elements.map((element) => element.name);
    }
    throw new LanguageSyntaxError(
      "except type must be an exception name or exception-name list",
      expression.span,
    );
  }

  private withStatement(
    statement: Extract<Statement, { kind: "WithStatement" }>,
  ): void {
    this.withItem(statement, 0);
  }

  private withItem(
    statement: Extract<Statement, { kind: "WithStatement" }>,
    index: number,
  ): void {
    const item = statement.items[index];
    if (item === undefined) {
      this.statements(statement.body);
      return;
    }
    this.expression(item.context);
    this.emitOperation({
      kind: statement.asynchronous
        ? "prepare_async_context"
        : "prepare_context",
      span: item.span,
    });
    this.emitOperation({ arguments: [], kind: "call", span: item.span });
    this.emitOperation({ kind: "dispatch_call", span: item.span });
    this.emitOperation({ kind: "after_call", span: item.span });
    if (statement.asynchronous) {
      this.emitOperation({ kind: "await", span: item.span });
    }

    const handler: CompiledExceptionHandler = {
      captureFault: true,
      target: { target: -1 },
    };
    const finallyTarget: TargetReference = { target: -1 };
    this.emitOperation({
      finallyTarget,
      handlers: [handler],
      kind: "push_handler",
      span: item.span,
      stackDepthOffset: -1,
    });
    this.finalizers.push(finallyTarget);
    if (item.target === undefined) {
      this.emitOperation({ kind: "pop", span: item.span });
    } else {
      this.storeAssignmentTarget(item.target);
    }
    this.withItem(statement, index + 1);
    this.emitOperation({ kind: "pop_handler", span: item.span });
    const normalExit = this.emitJump("jmp");

    handler.target.target = this.instructions.length;
    this.emitOperation({ kind: "context_fault_info", span: item.span });
    this.emitOperation({
      arguments: [
        { kind: "positional" },
        { kind: "positional" },
        { kind: "positional" },
      ],
      kind: "call",
      span: item.span,
    });
    this.emitOperation({ kind: "dispatch_call", span: item.span });
    this.emitOperation({ kind: "after_call", span: item.span });
    if (statement.asynchronous) {
      this.emitOperation({ kind: "await", span: item.span });
    }
    this.emitOperation({ keep: false, kind: "truthy", span: item.span });
    this.emit({ op: "cmp", left: "eax", right: immediate(0) });
    const unsuppressed = this.emitJump("je");
    this.emitOperation({ kind: "pop", span: item.span });
    this.emitOperation({ kind: "leave_handler", span: item.span });
    const suppressedExit = this.emitJump("jmp");
    this.patch(unsuppressed, this.instructions.length);
    this.emitOperation({ kind: "leave_handler", span: item.span });
    this.emitOperation({ hasValue: true, kind: "raise", span: item.span });

    this.finalizers.pop();
    finallyTarget.target = this.instructions.length;
    this.patch(normalExit, finallyTarget.target);
    for (let none = 0; none < 3; none += 1) {
      this.emitOperation({ kind: "load_const", span: item.span, value: null });
    }
    this.emitOperation({
      arguments: [
        { kind: "positional" },
        { kind: "positional" },
        { kind: "positional" },
      ],
      kind: "call",
      span: item.span,
    });
    this.emitOperation({ kind: "dispatch_call", span: item.span });
    this.emitOperation({ kind: "after_call", span: item.span });
    if (statement.asynchronous) {
      this.emitOperation({ kind: "await", span: item.span });
    }
    this.emitOperation({ kind: "pop", span: item.span });
    this.emitOperation({ kind: "finish_finally", span: item.span });
    this.patch(suppressedExit, this.instructions.length);
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

  private assignment(
    targets: readonly AssignmentTarget[],
    value: Expression,
  ): void {
    this.expression(value);
    targets.forEach((target, index) => {
      if (index < targets.length - 1) {
        this.emitOperation({ depth: 0, kind: "copy", span: target.span });
      }
      this.storeAssignmentTarget(target);
    });
  }

  private augmentedAssignment(
    target: AssignmentTarget,
    operator: Extract<Expression, { kind: "BinaryExpression" }>["operator"],
    value: Expression,
  ): void {
    if (target.kind === "IdentifierExpression") {
      this.emitOperation({
        binding: this.bindingFor(target.name),
        kind: "load_name",
        name: target.name,
        span: target.span,
      });
      this.expression(value);
      this.emitOperation({ kind: "binary", operator, span: target.span });
      this.emitOperation({
        binding: this.bindingFor(target.name),
        kind: "store_name",
        name: target.name,
        span: target.span,
      });
    } else if (target.kind === "AttributeExpression") {
      this.expression(target.object);
      this.emitOperation({ depth: 0, kind: "copy", span: target.object.span });
      this.emitOperation({
        kind: "load_attribute",
        name: target.attribute,
        span: target.span,
      });
      this.expression(value);
      this.emitOperation({ kind: "binary", operator, span: target.span });
      this.emitOperation({
        kind: "store_attribute",
        name: target.attribute,
        span: target.span,
      });
    } else if (target.kind === "SubscriptExpression") {
      this.expression(target.object);
      this.expression(target.index);
      this.emitOperation({ depth: 1, kind: "copy", span: target.object.span });
      this.emitOperation({ depth: 1, kind: "copy", span: target.index.span });
      this.emitOperation({ kind: "load_subscript", span: target.span });
      this.expression(value);
      this.emitOperation({ kind: "binary", operator, span: target.span });
      this.emitOperation({ kind: "store_subscript", span: target.span });
    }
  }

  private storeAssignmentTarget(target: AssignmentTarget): void {
    if (target.kind === "IdentifierExpression") {
      this.emitOperation({
        binding: this.bindingFor(target.name),
        kind: "store_name",
        name: target.name,
        span: target.span,
      });
    } else if (target.kind === "AttributeExpression") {
      this.expression(target.object);
      this.emitOperation({
        kind: "store_attribute_rhs_first",
        name: target.attribute,
        span: target.span,
      });
    } else if (target.kind === "SubscriptExpression") {
      this.expression(target.object);
      this.expression(target.index);
      this.emitOperation({
        kind: "store_subscript_rhs_first",
        span: target.span,
      });
    } else if (target.kind === "SliceExpression") {
      this.expression(target.object);
      this.sliceComponent(target.start, target.span);
      this.sliceComponent(target.stop, target.span);
      this.sliceComponent(target.step, target.span);
      this.emitOperation({ kind: "store_slice_rhs_first", span: target.span });
    } else if (
      target.kind === "ListExpression" ||
      target.kind === "TupleExpression"
    ) {
      const starredIndex = target.elements.findIndex(
        ({ kind }) => kind === "StarredExpression",
      );
      this.emitOperation({
        after: starredIndex < 0 ? 0 : target.elements.length - starredIndex - 1,
        before: starredIndex < 0 ? target.elements.length : starredIndex,
        kind: "unpack",
        span: target.span,
        starred: starredIndex >= 0,
      });
      for (const element of target.elements) {
        this.storeAssignmentTarget(
          element.kind === "StarredExpression" ? element.value : element,
        );
      }
    } else {
      this.storeAssignmentTarget(target.value);
    }
  }

  private deleteTarget(target: DeletionTarget): void {
    if (target.kind === "IdentifierExpression") {
      this.emitOperation({
        binding: this.bindingFor(target.name),
        kind: "delete_name",
        name: target.name,
        span: target.span,
      });
      return;
    }
    if (target.kind === "AttributeExpression") {
      this.expression(target.object);
      this.emitOperation({
        kind: "delete_attribute",
        name: target.attribute,
        span: target.span,
      });
      return;
    }
    if (target.kind === "SubscriptExpression") {
      this.expression(target.object);
      this.expression(target.index);
      this.emitOperation({ kind: "delete_subscript", span: target.span });
      return;
    }
    if (target.kind === "SliceExpression") {
      this.expression(target.object);
      this.sliceComponent(target.start, target.span);
      this.sliceComponent(target.stop, target.span);
      this.sliceComponent(target.step, target.span);
      this.emitOperation({ kind: "delete_slice", span: target.span });
      return;
    }
    for (const element of target.elements) this.deleteTarget(element);
  }

  private sliceComponent(
    expression: Expression | undefined,
    span: SourceSpan,
  ): void {
    if (expression === undefined) {
      this.emitOperation({ kind: "load_const", span, value: null });
    } else {
      this.expression(expression);
    }
  }

  private evaluateBareAnnotatedTarget(target: AssignmentTarget): void {
    if (target.kind === "IdentifierExpression") {
      this.expression(target);
      this.emitOperation({ kind: "pop", span: target.span });
      return;
    }
    if (target.kind === "AttributeExpression") {
      this.expression(target.object);
      this.emitOperation({ kind: "pop", span: target.span });
      return;
    }
    if (target.kind === "SubscriptExpression") {
      this.expression(target.object);
      this.expression(target.index);
      this.emitOperation({ kind: "pop", span: target.span });
      this.emitOperation({ kind: "pop", span: target.span });
      return;
    }
    if (target.kind === "SliceExpression") {
      this.expression(target.object);
      this.sliceComponent(target.start, target.span);
      this.sliceComponent(target.stop, target.span);
      this.sliceComponent(target.step, target.span);
      for (let index = 0; index < 4; index += 1) {
        this.emitOperation({ kind: "pop", span: target.span });
      }
      return;
    }
    throw new LanguageSyntaxError(
      "Invalid annotated assignment target",
      target.span,
    );
  }

  private functionExpression(node: FunctionScopeNode): void {
    const parameters =
      node.kind === "ComprehensionExpression"
        ? ([
            {
              name: comprehensionIteratorName,
              parameterKind: "positional_only" as const,
              span: node.span,
            },
          ] as const)
        : node.parameters;
    const defaultValues = parameters.flatMap(({ defaultValue }) =>
      defaultValue === undefined ? [] : [defaultValue],
    );
    for (const value of defaultValues) this.expression(value);
    this.emitRegisteredFunction(node, defaultValues.length);
  }

  private emitRegisteredFunction(
    node: FunctionScopeNode,
    defaultCount: number,
  ): void {
    const functionScope = this.currentModule.scopes.functionScopes.get(node);
    const name =
      node.kind === "FunctionDefinition"
        ? node.name
        : node.kind === "LambdaExpression"
          ? "<lambda>"
          : node.containerKind === "generator"
            ? "<genexpr>"
            : `<${node.containerKind}comp>`;
    if (functionScope === undefined) {
      throw new LanguageSyntaxError(
        `Missing scope analysis for ${name}`,
        node.span,
      );
    }
    const parameters =
      node.kind === "ComprehensionExpression"
        ? ([
            {
              name: comprehensionIteratorName,
              parameterKind: "positional_only" as const,
              span: node.span,
            },
          ] as const)
        : node.parameters;
    const annotationPlan =
      node.kind === "FunctionDefinition"
        ? this.annotationPlanForFunction(node)
        : undefined;
    let defaultIndex = 0;
    const directYield =
      node.kind === "FunctionDefinition"
        ? statementsContainDirectYield(node.body)
        : node.kind === "LambdaExpression"
          ? expressionContainsDirectYield(node.body)
          : node.containerKind === "generator";
    const asynchronousComprehension =
      node.kind === "ComprehensionExpression" &&
      isAsynchronousComprehension(node);
    const asyncGenerator =
      (node.kind === "FunctionDefinition" &&
        node.asynchronous &&
        directYield) ||
      (node.kind === "ComprehensionExpression" &&
        node.containerKind === "generator" &&
        asynchronousComprehension);
    const descriptor: CompiledFunction = {
      annotationEntryCount: 0,
      annotationFunctionId: annotationPlan?.functionId,
      asyncGenerator,
      cellNames: functionScope.symbols
        .filter(({ binding }) => binding === "cell")
        .map(({ name: symbolName }) => symbolName),
      freeNames: functionScope.freeNames,
      coroutine:
        (node.kind === "FunctionDefinition" &&
          node.asynchronous &&
          !directYield) ||
        (node.kind === "ComprehensionExpression" &&
          node.containerKind !== "generator" &&
          asynchronousComprehension),
      generator: directYield && !asyncGenerator,
      id: this.functions.length,
      name,
      parameters: parameters.map(
        ({ defaultValue, name: parameterName, parameterKind }) => ({
          defaultIndex: defaultValue === undefined ? undefined : defaultIndex++,
          kind: parameterKind,
          name: parameterName,
        }),
      ),
      target: -1,
    };
    this.functions.push(descriptor);
    this.pendingCode.push({
      descriptor,
      kind: "function",
      node,
      module: this.currentModule,
    });
    this.emitOperation({
      defaultCount,
      functionId: descriptor.id,
      kind: "make_function",
      span: node.span,
    });
  }

  private classDefinition(node: ClassDefinition): void {
    if (node.typeParameters.length > 0) {
      for (const decorator of node.decorators) this.expression(decorator);
      this.emitTypeScopeCall(node, []);
      this.applyDecorators(node.decorators);
      this.emitOperation({
        binding: this.bindingFor(node.name),
        kind: "store_definition",
        name: node.name,
        span: node.span,
      });
      return;
    }
    const classScope = this.currentModule.scopes.classScopes.get(node);
    for (const decorator of node.decorators) this.expression(decorator);
    for (const base of node.bases) this.expression(base);
    const descriptor = this.registerClass(node, classScope);
    this.emitOperation({
      baseCount: node.bases.length,
      classId: descriptor.id,
      kind: "make_class",
      span: node.span,
    });
    this.applyDecorators(node.decorators);
    this.emitOperation({
      binding: this.bindingFor(node.name),
      kind: "store_definition",
      name: node.name,
      span: node.span,
    });
  }

  private registerClass(
    node: ClassDefinition,
    knownScope = this.currentModule.scopes.classScopes.get(node),
  ): CompiledClass {
    if (knownScope === undefined) {
      throw new LanguageSyntaxError(
        `Missing scope analysis for ${node.name}`,
        node.span,
      );
    }
    const annotationPlan = this.annotationPlanForAssignments(node, node.body);
    const descriptor: CompiledClass = {
      annotationEntryCount: annotationPlan?.entries.length ?? 0,
      annotationFunctionId: annotationPlan?.functionId,
      freeNames: knownScope.freeNames,
      id: this.classes.length,
      name: node.name,
      needsClassCell: knownScope.needsClassCell,
      target: -1,
    };
    this.classes.push(descriptor);
    this.pendingCode.push({
      descriptor,
      kind: "class",
      module: this.currentModule,
      node,
    });
    return descriptor;
  }

  private applyDecorators(decorators: readonly Expression[]): void {
    for (let index = decorators.length - 1; index >= 0; index -= 1) {
      const decorator = decorators[index]!;
      this.emitOperation({
        arguments: [{ kind: "positional" }],
        kind: "call",
        span: decorator.span,
      });
      this.emitOperation({ kind: "dispatch_call", span: decorator.span });
      this.emitOperation({ kind: "after_call", span: decorator.span });
    }
  }

  private comprehensionBody(
    node: Extract<FunctionScopeNode, { kind: "ComprehensionExpression" }>,
  ): void {
    if (node.containerKind === "generator") {
      this.comprehensionClause(node, 0);
      this.emitOperation({ kind: "load_const", span: node.span, value: null });
      return;
    }
    if (node.containerKind === "dictionary") {
      this.emitOperation({
        entries: [],
        kind: "build_dict",
        operandCount: 0,
        span: node.span,
      });
    } else {
      this.emitOperation({
        count: 0,
        kind: node.containerKind === "list" ? "build_list" : "build_set",
        starred: [],
        span: node.span,
      });
    }
    this.emitOperation({
      binding: this.bindingFor(comprehensionResultName),
      kind: "store_name",
      name: comprehensionResultName,
      span: node.span,
    });
    this.comprehensionClause(node, 0);
    this.emitOperation({
      binding: this.bindingFor(comprehensionResultName),
      kind: "load_name",
      name: comprehensionResultName,
      span: node.span,
    });
  }

  private comprehensionClause(
    node: Extract<FunctionScopeNode, { kind: "ComprehensionExpression" }>,
    index: number,
  ): void {
    const clause = node.clauses[index];
    if (clause === undefined) {
      if (node.containerKind === "generator") {
        this.yieldValue(node.element, node.span, false);
        this.emitOperation({ kind: "pop", span: node.span });
        return;
      }
      this.emitOperation({
        binding: this.bindingFor(comprehensionResultName),
        kind: "load_name",
        name: comprehensionResultName,
        span: node.span,
      });
      if (node.containerKind === "dictionary") {
        this.expression(node.key!);
        this.expression(node.value!);
      } else {
        this.expression(node.element!);
      }
      this.emitOperation({
        containerKind: node.containerKind,
        kind: "comprehension_add",
        span: node.span,
      });
      return;
    }
    if (clause.clauseKind === "if") {
      this.expression(clause.condition);
      this.emitOperation({
        keep: false,
        kind: "truthy",
        span: clause.condition.span,
      });
      this.emit({ op: "cmp", left: "eax", right: immediate(0) });
      const skipped = this.emitJump("je");
      this.comprehensionClause(node, index + 1);
      this.patch(skipped, this.instructions.length);
      return;
    }

    if (index === 0) {
      this.emitOperation({
        binding: this.bindingFor(comprehensionIteratorName),
        kind: "load_name",
        name: comprehensionIteratorName,
        span: clause.span,
      });
    } else {
      this.expression(clause.iterable);
    }
    if (!(index === 0 && node.containerKind === "generator")) {
      this.emitOperation({
        kind: clause.asynchronous ? "get_async_iter" : "get_iter",
        span: clause.iterable.span,
      });
    }
    const start = this.instructions.length;
    this.emitOperation({
      kind: clause.asynchronous ? "async_for_iter" : "for_iter",
      span: clause.span,
    });
    this.emit({ op: "cmp", left: "eax", right: immediate(0) });
    const exit = this.emitJump("je");
    this.storeAssignmentTarget(clause.target);
    this.comprehensionClause(node, index + 1);
    this.emit({ op: "jmp", target: start });
    this.patch(exit, this.instructions.length);
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
      case "AwaitExpression":
        this.expression(expression.value);
        this.emitOperation({ kind: "await", span: expression.span });
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
          arguments: expression.arguments.map(
            ({ argumentKind, name }): CompiledCallArgument => ({
              kind: argumentKind,
              name,
            }),
          ),
          kind: "call",
          span: expression.span,
        });
        this.emitOperation({ kind: "dispatch_call", span: expression.span });
        this.emitOperation({ kind: "after_call", span: expression.span });
        return;
      case "ComparisonExpression": {
        this.expression(expression.left);
        const exits: number[] = [];
        expression.comparisons.forEach((comparison, index) => {
          this.expression(comparison.right);
          const final = index === expression.comparisons.length - 1;
          if (final) {
            this.emitOperation({
              kind: "compare",
              operators: [comparison.operator],
              span: comparison.span,
            });
            return;
          }
          this.emitOperation({
            kind: "compare_chain",
            operator: comparison.operator,
            span: comparison.span,
          });
          this.emit({ op: "cmp", left: "eax", right: immediate(0) });
          exits.push(this.emitJump("je"));
        });
        const end = this.instructions.length;
        for (const exit of exits) this.patch(exit, end);
        return;
      }
      case "ComprehensionExpression": {
        const firstClause = expression.clauses[0];
        if (firstClause?.clauseKind !== "for") {
          throw new LanguageSyntaxError(
            "Comprehension requires a for clause",
            expression.span,
          );
        }
        this.functionExpression(expression);
        this.expression(firstClause.iterable);
        if (expression.containerKind === "generator") {
          this.emitOperation({
            kind: firstClause.asynchronous ? "get_async_iter" : "get_iter",
            span: firstClause.iterable.span,
          });
        }
        this.emitOperation({
          arguments: [{ kind: "positional" }],
          kind: "call",
          span: expression.span,
        });
        this.emitOperation({ kind: "dispatch_call", span: expression.span });
        this.emitOperation({ kind: "after_call", span: expression.span });
        if (
          expression.containerKind !== "generator" &&
          isAsynchronousComprehension(expression)
        ) {
          this.emitOperation({ kind: "await", span: expression.span });
        }
        return;
      }
      case "ConditionalExpression": {
        this.expression(expression.condition);
        this.emitOperation({
          keep: false,
          kind: "truthy",
          span: expression.condition.span,
        });
        this.emit({ op: "cmp", left: "eax", right: immediate(0) });
        const whenFalse = this.emitJump("je");
        this.expression(expression.whenTrue);
        const exit = this.emitJump("jmp");
        this.patch(whenFalse, this.instructions.length);
        this.expression(expression.whenFalse);
        this.patch(exit, this.instructions.length);
        return;
      }
      case "DictionaryExpression":
        for (const entry of expression.entries) {
          if (entry.entryKind === "pair") this.expression(entry.key);
          this.expression(entry.value);
        }
        this.emitOperation({
          entries: expression.entries.map(({ entryKind }) => entryKind),
          kind: "build_dict",
          operandCount: expression.entries.reduce(
            (count, { entryKind }) => count + (entryKind === "pair" ? 2 : 1),
            0,
          ),
          span: expression.span,
        });
        return;
      case "FormattedStringExpression": {
        let operandCount = 0;
        const interpolations = expression.interpolations.map(
          (interpolation) => {
            const lowered = this.formattedInterpolation(interpolation);
            operandCount += lowered.operandCount;
            return lowered.operation;
          },
        );
        this.emitOperation({
          interpolations,
          kind: "format",
          operandCount,
          span: expression.span,
          strings: expression.strings,
        });
        return;
      }
      case "TemplateStringExpression": {
        let operandCount = 0;
        const interpolations = expression.interpolations.map(
          (interpolation) => {
            const lowered = this.formattedInterpolation(interpolation);
            operandCount += lowered.operandCount;
            return lowered.operation;
          },
        );
        this.emitOperation({
          interpolations,
          kind: "build_template",
          operandCount,
          span: expression.span,
          strings: expression.strings,
        });
        return;
      }
      case "IdentifierExpression":
        this.emitOperation({
          binding: this.bindingFor(expression.name),
          kind: "load_name",
          name: expression.name,
          span: expression.span,
        });
        return;
      case "ListExpression":
      case "SetExpression":
      case "TupleExpression":
        for (const element of expression.elements) {
          this.expression(
            element.kind === "StarredExpression" ? element.value : element,
          );
        }
        this.emitOperation({
          count: expression.elements.length,
          kind:
            expression.kind === "ListExpression"
              ? "build_list"
              : expression.kind === "SetExpression"
                ? "build_set"
                : "build_tuple",
          starred: expression.elements.map(
            ({ kind }) => kind === "StarredExpression",
          ),
          span: expression.span,
        });
        return;
      case "StarredExpression":
        throw new LanguageSyntaxError(
          "Starred expression is not in a display or target",
          expression.span,
        );
      case "LambdaExpression":
        this.functionExpression(expression);
        return;
      case "LiteralExpression":
        this.emitOperation({
          kind: "load_const",
          span: expression.span,
          value: expression.value,
        });
        return;
      case "NamedExpression":
        this.expression(expression.value);
        this.emitOperation({ depth: 0, kind: "copy", span: expression.span });
        this.emitOperation({
          binding: this.bindingFor(expression.target.name),
          kind: "store_name",
          name: expression.target.name,
          span: expression.target.span,
        });
        return;
      case "SubscriptExpression":
        this.expression(expression.object);
        this.expression(expression.index);
        this.emitOperation({ kind: "load_subscript", span: expression.span });
        return;
      case "SliceExpression":
        this.expression(expression.object);
        this.sliceComponent(expression.start, expression.span);
        this.sliceComponent(expression.stop, expression.span);
        this.sliceComponent(expression.step, expression.span);
        this.emitOperation({ kind: "load_slice", span: expression.span });
        return;
      case "UnaryExpression":
        this.expression(expression.operand);
        this.emitOperation({
          kind: "unary",
          operator: expression.operator,
          span: expression.span,
        });
        return;
      case "YieldExpression":
        this.yieldValue(expression.value, expression.span, expression.delegate);
        return;
    }
  }

  private formattedInterpolation(interpolation: FormattedStringInterpolation): {
    readonly operandCount: number;
    readonly operation: PythonFormatInterpolationOperation;
  } {
    this.expression(interpolation.value);
    let operandCount = 1;
    const formatParts = interpolation.formatSpec.map((part) => {
      if (typeof part === "string") return part;
      const lowered = this.formattedInterpolation(part);
      operandCount += lowered.operandCount;
      return lowered.operation;
    });
    return {
      operandCount,
      operation: {
        conversion: interpolation.conversion,
        expression: interpolation.expression,
        formatParts,
      },
    };
  }

  private yieldValue(
    value: Expression | undefined,
    span: SourceSpan,
    delegate: boolean,
  ): void {
    if (this.currentScopeKind !== "function") {
      throw new LanguageSyntaxError("yield outside function", span);
    }
    if (delegate) {
      if (value === undefined) {
        throw new LanguageSyntaxError(
          "yield from requires an expression",
          span,
        );
      }
      this.yieldFrom(value, span);
      return;
    }
    if (value === undefined) {
      this.emitOperation({ kind: "load_const", span, value: null });
    } else {
      this.expression(value);
    }
    const resumeTarget: TargetReference = { target: -1 };
    this.emitOperation({ kind: "yield", resumeTarget, span });
    resumeTarget.target = this.instructions.length;
  }

  private yieldFrom(value: Expression, span: SourceSpan): void {
    this.expression(value);
    this.emitOperation({ kind: "get_iter", span });
    this.emitOperation({ hasInput: false, kind: "yield_from_step", span });
    this.emit({ op: "cmp", left: "eax", right: immediate(0) });
    const initialDone = this.emitJump("je");
    const yieldTarget = this.instructions.length;
    const resumeTarget: TargetReference = { target: -1 };
    this.emitOperation({ kind: "yield", resumeTarget, span });
    resumeTarget.target = this.instructions.length;
    this.emitOperation({ hasInput: true, kind: "yield_from_step", span });
    this.emit({ op: "cmp", left: "eax", right: immediate(0) });
    const resumedDone = this.emitJump("je");
    this.emit({ op: "jmp", target: yieldTarget });
    const doneTarget = this.instructions.length;
    this.patch(initialDone, doneTarget);
    this.patch(resumedDone, doneTarget);
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

function statementsContainDirectYield(
  statements: readonly Statement[],
): boolean {
  return statements.some((statement) => {
    switch (statement.kind) {
      case "AssertStatement":
        return (
          expressionContainsDirectYield(statement.test) ||
          (statement.message !== undefined &&
            expressionContainsDirectYield(statement.message))
        );
      case "AssignmentStatement":
      case "AugmentedAssignmentStatement":
        return expressionContainsDirectYield(statement.value);
      case "YieldStatement":
        return true;
      case "ExpressionStatement":
        return expressionContainsDirectYield(statement.expression);
      case "ForStatement":
        return (
          expressionContainsDirectYield(statement.iterable) ||
          statementsContainDirectYield(statement.body)
        );
      case "WhileStatement":
        return (
          expressionContainsDirectYield(statement.test) ||
          statementsContainDirectYield(statement.body)
        );
      case "IfStatement":
        return (
          statement.branches.some(
            (branch) =>
              expressionContainsDirectYield(branch.test) ||
              statementsContainDirectYield(branch.body),
          ) || statementsContainDirectYield(statement.elseBody ?? [])
        );
      case "TryStatement":
        return (
          statementsContainDirectYield(statement.body) ||
          statement.handlers.some((handler) =>
            statementsContainDirectYield(handler.body),
          ) ||
          statementsContainDirectYield(statement.elseBody ?? []) ||
          statementsContainDirectYield(statement.finallyBody ?? [])
        );
      case "WithStatement":
        return (
          statement.items.some(({ context }) =>
            expressionContainsDirectYield(context),
          ) || statementsContainDirectYield(statement.body)
        );
      case "RaiseStatement":
      case "ReturnStatement":
        return (
          statement.value !== undefined &&
          expressionContainsDirectYield(statement.value)
        );
      case "ClassDefinition":
        return (
          statement.decorators.some(expressionContainsDirectYield) ||
          statement.bases.some(expressionContainsDirectYield)
        );
      case "FunctionDefinition":
        return (
          statement.decorators.some(expressionContainsDirectYield) ||
          statement.parameters.some(
            ({ defaultValue }) =>
              defaultValue !== undefined &&
              expressionContainsDirectYield(defaultValue),
          )
        );
      default:
        return false;
    }
  });
}

function formattedPartsContainDirectYield(
  parts: readonly FormattedStringPart[],
): boolean {
  return parts.some(
    (part) =>
      typeof part !== "string" &&
      (expressionContainsDirectYield(part.value) ||
        formattedPartsContainDirectYield(part.formatSpec)),
  );
}

function expressionContainsDirectYield(expression: Expression): boolean {
  switch (expression.kind) {
    case "YieldExpression":
      return true;
    case "AttributeExpression":
      return expressionContainsDirectYield(expression.object);
    case "AwaitExpression":
      return expressionContainsDirectYield(expression.value);
    case "BinaryExpression":
      return (
        expressionContainsDirectYield(expression.left) ||
        expressionContainsDirectYield(expression.right)
      );
    case "BooleanExpression":
      return expression.values.some(expressionContainsDirectYield);
    case "CallExpression":
      return (
        expressionContainsDirectYield(expression.callee) ||
        expression.arguments.some(({ value }) =>
          expressionContainsDirectYield(value),
        )
      );
    case "ComparisonExpression":
      return (
        expressionContainsDirectYield(expression.left) ||
        expression.comparisons.some(({ right }) =>
          expressionContainsDirectYield(right),
        )
      );
    case "ConditionalExpression":
      return (
        expressionContainsDirectYield(expression.condition) ||
        expressionContainsDirectYield(expression.whenTrue) ||
        expressionContainsDirectYield(expression.whenFalse)
      );
    case "DictionaryExpression":
      return expression.entries.some(
        (entry) =>
          (entry.entryKind === "pair" &&
            expressionContainsDirectYield(entry.key)) ||
          expressionContainsDirectYield(entry.value),
      );
    case "FormattedStringExpression":
    case "TemplateStringExpression":
      return expression.interpolations.some(
        (interpolation) =>
          expressionContainsDirectYield(interpolation.value) ||
          formattedPartsContainDirectYield(interpolation.formatSpec),
      );
    case "ListExpression":
    case "SetExpression":
    case "TupleExpression":
      return expression.elements.some(expressionContainsDirectYield);
    case "NamedExpression":
      return expressionContainsDirectYield(expression.value);
    case "SliceExpression":
      return (
        expressionContainsDirectYield(expression.object) ||
        (expression.start !== undefined &&
          expressionContainsDirectYield(expression.start)) ||
        (expression.stop !== undefined &&
          expressionContainsDirectYield(expression.stop)) ||
        (expression.step !== undefined &&
          expressionContainsDirectYield(expression.step))
      );
    case "StarredExpression":
      return expressionContainsDirectYield(expression.value);
    case "SubscriptExpression":
      return (
        expressionContainsDirectYield(expression.object) ||
        expressionContainsDirectYield(expression.index)
      );
    case "UnaryExpression":
      return expressionContainsDirectYield(expression.operand);
    case "ComprehensionExpression": {
      const firstClause = expression.clauses[0];
      return (
        firstClause?.clauseKind === "for" &&
        expressionContainsDirectYield(firstClause.iterable)
      );
    }
    case "LambdaExpression":
    case "IdentifierExpression":
    case "LiteralExpression":
      return false;
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
  readonly parentModuleId?: number;
  readonly shortName: string;
}

function appendExtensionObjects(
  compilation: PythonCompilation,
  extensions: readonly ResolvedExtension[],
): {
  readonly executable:
    Cs486ExecutableV3 | Cs486ExecutableV4 | Cs486ExecutableV5;
  readonly extensionModules: readonly ExtensionModuleRuntime[];
} {
  if (extensions.length === 0)
    return { executable: compilation.executable, extensionModules: [] };
  const instructions = [...compilation.executable.instructions];
  const initialData = (compilation.executable.initialData ?? []).map(
    (segment) => ({ bytes: [...segment.bytes], offset: segment.offset }),
  );
  const extensionModules: ExtensionModuleRuntime[] = [];
  const functionEntries: Cs486FunctionEntry[] = [];
  let dataBytes = Math.max(
    compilation.executable.dataBytes ?? 0,
    cs486NullGuardBytes,
  );
  for (const extension of extensions) {
    if (cs486ObjectDataModel(extension.object) !== cs486Word32DataModel)
      throw new VmRuntimeError(
        "ImportError",
        `${extension.path}: Python extensions require ${cs486Word32DataModel}`,
      );
    const textFunctions = extension.object.symbols.filter(
      (symbol) =>
        symbol.binding === "global" &&
        symbol.section === "text" &&
        (symbol.type === undefined ||
          symbol.type === "function" ||
          symbol.type === "notype"),
    );
    const globals = textFunctions.filter(
      (symbol) =>
        symbol.functionSignature === undefined ||
        symbol.functionSignature === "()->i32",
    );
    const entry = globals[0]?.name;
    if (entry === undefined)
      throw new VmRuntimeError(
        "ImportError",
        textFunctions.some((symbol) => symbol.functionSignature !== undefined)
          ? `${extension.path} exports no zero-argument integer functions`
          : `${extension.path} exports no functions`,
      );
    let linked: Cs486ExecutableV6;
    try {
      linked = linkCs486Objects([extension.object], { entry });
    } catch (error: unknown) {
      throw new VmRuntimeError(
        "ImportError",
        `${extension.path}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (linked.dataBytes === undefined)
      throw new VmRuntimeError(
        "ImportError",
        `${extension.path}: linked extension has no declared data size`,
      );
    const bodyBase = instructions.length;
    const dataBase = align(
      dataBytes,
      cs486ObjectDataAlignment(extension.object),
    );
    const linkedDataBase = linked.dataBytes - extension.object.dataBytes;
    const dataDelta = dataBase - linkedDataBase;
    const relocationsByInstruction = new Map<number, Cs486ObjectRelocation[]>();
    for (const relocation of extension.object.relocations) {
      if (relocation.section !== "text" || relocation.offset === undefined)
        continue;
      const values = relocationsByInstruction.get(relocation.offset) ?? [];
      values.push(relocation);
      relocationsByInstruction.set(relocation.offset, values);
    }
    const body = linked.instructions
      .slice(2)
      .map((instruction, index) =>
        relocateExtensionInstruction(
          instruction,
          bodyBase,
          dataDelta,
          relocationsByInstruction.get(index) ?? [],
          extension.object,
        ),
      );
    instructions.push(...body);
    const layout = isCs486StructuredObject(extension.object)
      ? objectDataLayout(extension.object)
      : undefined;
    const relocatedInitialData = (linked.initialData ?? []).map((segment) => ({
      bytes: [...segment.bytes],
      offset: segment.offset - linkedDataBase,
    }));
    for (const relocation of extension.object.relocations) {
      if (
        (relocation.section !== "data" && relocation.section !== "rodata") ||
        relocation.offset === undefined
      )
        continue;
      if (layout === undefined)
        throw new VmRuntimeError(
          "ImportError",
          "legacy extension cannot contain structured data relocations",
        );
      const offset = layout.bases[relocation.section] + relocation.offset;
      relocateExtensionDataWord(
        relocatedInitialData,
        offset,
        extensionRelocationDelta(
          relocation,
          extension.object,
          bodyBase,
          dataDelta,
        ),
      );
    }
    for (const segment of relocatedInitialData) {
      initialData.push({
        bytes: [...segment.bytes],
        offset: dataBase + segment.offset,
      });
    }
    for (const entry of linked.functionEntries ?? [])
      functionEntries.push({
        address: bodyBase + entry.address - 2,
        functionSignature: entry.functionSignature,
      });
    const exports = new Map<string, number>();
    const functionNames = new Set(globals.map((symbol) => symbol.name));
    for (const symbol of linked.symbols ?? []) {
      if (
        functionNames.has(symbol.name) &&
        (symbol.section === undefined || symbol.section === "text") &&
        (symbol.type === undefined ||
          symbol.type === "function" ||
          symbol.type === "notype") &&
        (symbol.functionSignature === undefined ||
          symbol.functionSignature === "()->i32")
      )
        exports.set(symbol.name, bodyBase + symbol.address - 2);
    }
    extensionModules.push({
      id: extension.id,
      name: extension.name,
      exports,
      parentModuleId: extension.parentModuleId,
      shortName: extension.shortName,
    });
    dataBytes = dataBase + extension.object.dataBytes;
  }
  dataBytes = align(dataBytes, 4);
  if (instructions.length > 4_096) throw new VmLimitError("linked instruction");
  return {
    executable: {
      format: "cs486-executable",
      dataModel: cs486Word32DataModel,
      instructions,
      dataBytes,
      ...(initialData.length > 0 ? { initialData } : {}),
      ...(functionEntries.length > 0 ? { functionEntries } : {}),
      memory: compilation.executable.memory,
      version: 5,
    },
    extensionModules,
  };
}

function relocateExtensionInstruction(
  instruction: Cs486Instruction,
  textBase: number,
  dataDelta: number,
  relocations: readonly Cs486ObjectRelocation[],
  object: Cs486Object,
): Cs486Instruction {
  let relocated = instruction;
  if (
    ["jmp", "je", "jne", "jl", "jle", "jg", "jge", "call"].includes(
      instruction.op,
    )
  ) {
    const targeted = instruction as Extract<
      Cs486Instruction,
      { target: number }
    >;
    relocated = { ...targeted, target: textBase + targeted.target - 2 };
  }
  if (relocated.op === "load" || relocated.op === "store") {
    const instruction_ = relocated;
    const address = instruction_.address;
    if (address.kind === "immediate")
      relocated = {
        ...instruction_,
        address: immediate(address.value + dataDelta),
      };
  }
  for (const relocation of relocations) {
    if (
      relocation.type === "text-target" ||
      (relocation.type === "data-address" && relocation.field === "address")
    )
      continue;
    relocated = addExtensionInstructionRelocation(
      relocated,
      relocation,
      extensionRelocationDelta(relocation, object, textBase, dataDelta),
    );
  }
  return relocated;
}

function extensionRelocationDelta(
  relocation: Cs486ObjectRelocation,
  object: Cs486Object,
  textBase: number,
  dataDelta: number,
): number {
  if (
    relocation.type === "text-target" ||
    relocation.type === "function-address"
  )
    return textBase - 2;
  if (relocation.type === "data-address") return dataDelta;
  const symbol = object.symbols.find(
    (candidate) => candidate.name === relocation.symbol,
  );
  if (symbol === undefined)
    throw new VmRuntimeError(
      "ImportError",
      `extension relocation references unknown symbol ${relocation.symbol}`,
    );
  return symbol.section === "text" ? textBase - 2 : dataDelta;
}

function addExtensionInstructionRelocation(
  instruction: Cs486Instruction,
  relocation: Cs486ObjectRelocation,
  delta: number,
): Cs486Instruction {
  if (delta === 0) return instruction;
  if (
    relocation.field === "source" &&
    "source" in instruction &&
    typeof instruction.source !== "string" &&
    instruction.source.kind === "immediate"
  )
    return {
      ...instruction,
      source: immediate(instruction.source.value + delta),
    };
  if (
    relocation.field === "right" &&
    instruction.op === "cmp" &&
    instruction.right.kind === "immediate"
  )
    return {
      ...instruction,
      right: immediate(instruction.right.value + delta),
    };
  if (
    relocation.field === "address" &&
    (instruction.op === "load" || instruction.op === "store") &&
    instruction.address.kind === "immediate"
  )
    return {
      ...instruction,
      address: immediate(instruction.address.value + delta),
    };
  throw new VmRuntimeError(
    "ImportError",
    `extension relocation ${relocation.type} cannot patch ${String(relocation.field)}`,
  );
}

function relocateExtensionDataWord(
  segments: { bytes: number[]; offset: number }[],
  address: number,
  delta: number,
): void {
  if (delta === 0) return;
  const segment = segments.find(
    (candidate) =>
      address >= candidate.offset &&
      address + 4 <= candidate.offset + candidate.bytes.length,
  );
  if (segment === undefined)
    throw new VmRuntimeError(
      "ImportError",
      "extension data relocation is outside initialized data",
    );
  const offset = address - segment.offset;
  const current =
    (segment.bytes[offset]! |
      (segment.bytes[offset + 1]! << 8) |
      (segment.bytes[offset + 2]! << 16) |
      (segment.bytes[offset + 3]! << 24)) >>>
    0;
  const relocated = (current + delta) >>> 0;
  for (let index = 0; index < 4; index += 1)
    segment.bytes[offset + index] = (relocated >>> (index * 8)) & 0xff;
}

function align(value: number, alignment: number): number {
  return Math.ceil(value / alignment) * alignment;
}

interface PythonRuntimeOptions {
  readonly callableIteratorFunctions: CallableIteratorFunctionIds;
  readonly classes: readonly CompiledClass[];
  readonly environment: NativeEnvironment;
  readonly extensionModules: readonly ExtensionModuleRuntime[];
  readonly functions: readonly CompiledFunction[];
  readonly limits: PythonRuntimeLimits;
  readonly memoryBytes: number;
  readonly modules: readonly CompiledModule[];
  readonly operations: readonly PythonOperation[];
}

interface RuntimeFrame {
  readonly annotations?: ManagedAnnotations;
  readonly classCell?: RuntimeCell;
  readonly cells: Map<string, RuntimeCell>;
  readonly firstArgument?: RuntimeValue;
  readonly globals: Map<string, RuntimeValue>;
  readonly kind: "class" | "function" | "module";
  readonly locals: Map<string, RuntimeValue>;
  readonly moduleId: number;
  readonly stackBase: number;
}

interface RuntimeCell {
  initialized: boolean;
  value: RuntimeValue;
}

interface GeneratorRuntimeState {
  activeFaults: VmRuntimeError[];
  exceptionHandlers: SuspendedExceptionHandler[];
  frame: RuntimeFrame;
  pendingControl: PendingControl | undefined;
  resumeTarget: number;
  stackValues: RuntimeValue[];
}

interface SuspendedExceptionHandler {
  readonly activeFaultDepthOffset: number;
  readonly callMarkerDepthOffset: number;
  readonly finallyTarget?: TargetReference;
  readonly frameDepthOffset: number;
  readonly handlers: readonly CompiledExceptionHandler[];
  readonly machineStackPointerOffset: number;
  readonly starExitTarget?: TargetReference;
  readonly stackDepthOffset: number;
}

type GeneratorResumeOwner =
  | { readonly kind: "await" }
  | { readonly kind: "await_iterator" }
  | {
      readonly kind: "async_generator_operation";
      readonly operation: RuntimeAsyncGeneratorOperation;
    }
  | {
      readonly iterator: RuntimeAsyncGenerator | RuntimeInstance;
      readonly kind: "async_for_iter";
      readonly operation?: RuntimeAsyncGeneratorOperation;
      readonly span: SourceSpan;
    }
  | { readonly kind: "for_iter" }
  | {
      readonly defaultValue: RuntimeValue;
      readonly hasDefault: boolean;
      readonly kind: "next";
    }
  | { readonly kind: "throw" }
  | { readonly kind: "close" }
  | {
      readonly closingFault?: VmRuntimeError;
      readonly kind: "yield_from";
    }
  | {
      readonly kind: "materialize";
      readonly state: IterableMaterializationState;
    };

type ManagedCallable =
  | {
      readonly annotationLocals?: Map<string, RuntimeValue>;
      readonly annotationState?: ManagedAnnotations;
      readonly classCell?: RuntimeCell;
      readonly defaults: readonly RuntimeValue[];
      readonly descriptor: CompiledFunction;
      readonly closure: ReadonlyMap<string, RuntimeCell>;
      readonly globals: Map<string, RuntimeValue>;
      readonly kind: "python";
      readonly moduleId: number;
    }
  | {
      readonly kind: "extension";
      readonly name: string;
      readonly target: number;
    };

type IterableConsumer =
  | {
      readonly kind: "display";
      readonly operands: readonly RuntimeValue[];
      operandIndex: number;
      readonly operation: Extract<
        PythonOperation,
        { kind: "build_list" | "build_set" | "build_tuple" }
      >;
      readonly sequence: RuntimeList;
      readonly set: RuntimeSet;
    }
  | {
      argumentIndex: number;
      readonly argumentValues: readonly RuntimeValue[];
      readonly callee: RuntimeValue;
      readonly keywords: RuntimeDictionary;
      readonly kind: "call";
      readonly operation: Extract<PythonOperation, { kind: "call" }>;
      readonly positional: RuntimeList;
    }
  | {
      readonly kind: "set";
      readonly result: RuntimeSet;
    }
  | {
      readonly kind: "slice";
      readonly object: RuntimeValue;
      readonly replacement: RuntimeList;
      readonly span: SourceSpan;
      readonly start: RuntimeValue;
      readonly step: RuntimeValue;
      readonly stop: RuntimeValue;
    }
  | {
      readonly kind: "unpack";
      readonly operation: Extract<PythonOperation, { kind: "unpack" }>;
      readonly values: RuntimeList;
    };

interface IterableMaterializationState {
  readonly consumer: IterableConsumer;
  currentIterator?:
    | RuntimeGenerator
    | RuntimeInstance
    | RuntimeIterator
    | RuntimeSequenceIterator;
  emittedCount: number;
  readonly machineStackPointer: number;
  returnToCaller: boolean;
  readonly span: SourceSpan;
}

interface PendingCallDispatch {
  readonly callee: RuntimeValue;
  readonly keywords: RuntimeDictionary;
  readonly positional: RuntimeList;
  readonly span: SourceSpan;
}

interface ConstructorCallState {
  readonly classObject: RuntimeClass;
  readonly keywords: ReadonlyMap<string, RuntimeValue>;
  readonly positional: readonly RuntimeValue[];
  readonly span: SourceSpan;
}

interface PendingConstructorCompletion extends ConstructorCallState {
  readonly result: RuntimeValue;
}

type ManagedDescriptorWrapper =
  | {
      readonly callable: RuntimeValue;
      readonly kind: "classmethod" | "staticmethod";
    }
  | {
      readonly deleter: RuntimeValue;
      readonly getter: RuntimeValue;
      readonly kind: "property";
      readonly setter: RuntimeValue;
    };

interface SetNameState {
  readonly classCell?: RuntimeCell;
  readonly classId: number;
  readonly classObject: RuntimeClass;
  readonly entries: readonly (readonly [string, RuntimeValue])[];
  index: number;
  readonly span: SourceSpan;
}

type IteratorProtocolOwner =
  | {
      readonly descriptor: RuntimeValue;
      readonly fallbackDefault: RuntimeValue;
      readonly fallbackName?: string;
      readonly hasFallbackDefault: boolean;
      readonly instance: RuntimeValue;
      readonly kind: "attribute_get";
      readonly ownerClass: RuntimeClass;
      readonly span: SourceSpan;
    }
  | {
      readonly descriptor: RuntimeValue;
      readonly instance: RuntimeInstance;
      readonly kind: "attribute_set";
      readonly returnsValue: boolean;
      readonly span: SourceSpan;
      readonly value: RuntimeValue;
    }
  | {
      readonly descriptor: RuntimeValue;
      readonly instance: RuntimeInstance;
      readonly kind: "attribute_delete";
      readonly returnsValue: boolean;
      readonly span: SourceSpan;
    }
  | {
      readonly defaultValue: RuntimeValue;
      readonly hasDefault: boolean;
      readonly instance: RuntimeInstance;
      readonly kind: "attribute_hook_get";
      readonly name: string;
      readonly phase: "getattr" | "getattribute";
      readonly span: SourceSpan;
    }
  | {
      readonly instance: RuntimeInstance;
      readonly kind: "attribute_hook_set";
      readonly name: string;
      readonly returnsValue: boolean;
      readonly span: SourceSpan;
      readonly value: RuntimeValue;
    }
  | {
      readonly instance: RuntimeInstance;
      readonly kind: "attribute_hook_delete";
      readonly name: string;
      readonly returnsValue: boolean;
      readonly span: SourceSpan;
    }
  | {
      readonly kind: "set_name";
      readonly state: SetNameState;
    }
  | {
      readonly kind: "await_result";
      readonly machineStackPointer: number;
      readonly span: SourceSpan;
    }
  | {
      readonly kind: "async_get_iter";
      readonly span: SourceSpan;
    }
  | {
      readonly iterator: RuntimeInstance;
      readonly kind: "async_next_result";
      readonly machineStackPointer: number;
      readonly span: SourceSpan;
    }
  | {
      readonly kind: "annotations";
      readonly span: SourceSpan;
      readonly state: ManagedAnnotations;
    }
  | {
      readonly kind: "lazy_type";
      readonly span: SourceSpan;
      readonly state: ManagedLazyValue;
    }
  | {
      readonly kind: "generic_default";
      readonly state: PendingGenericSubscription;
    }
  | {
      readonly iterator: RuntimeInstance;
      readonly kind: "for_iter";
      readonly span: SourceSpan;
    }
  | {
      readonly defaultValue: RuntimeValue;
      readonly hasDefault: boolean;
      readonly kind: "next";
      readonly span: SourceSpan;
    }
  | {
      readonly iterator: RuntimeInstance;
      readonly kind: "yield_from";
      readonly span: SourceSpan;
    }
  | {
      readonly kind: "materialize_get_iter";
      readonly state: IterableMaterializationState;
    }
  | {
      readonly iterator: RuntimeInstance;
      readonly kind: "materialize_next";
      readonly state: IterableMaterializationState;
    }
  | {
      readonly consumer:
        | {
            readonly iterator: RuntimeSequenceIterator;
            readonly kind: "for_iter" | "yield_from";
            readonly span: SourceSpan;
          }
        | {
            readonly defaultValue: RuntimeValue;
            readonly hasDefault: boolean;
            readonly kind: "next";
            readonly span: SourceSpan;
          }
        | {
            readonly kind: "materialize";
            readonly state: IterableMaterializationState;
          };
      readonly iterator: RuntimeSequenceIterator;
      readonly kind: "sequence_next";
    }
  | {
      readonly kind: "exception_group_predicate";
      readonly state: ExceptionGroupPredicateState;
    }
  | { readonly kind: "get_iter"; readonly span: SourceSpan };

interface IteratorProtocolCall {
  readonly activeFaultBaseDepth: number;
  readonly exceptionHandlerBaseDepth: number;
  readonly frameBaseDepth: number;
  readonly machineStackPointer: number;
  readonly owner: IteratorProtocolOwner;
}

type CallMarker =
  | {
      readonly callerPendingControl: PendingControl | undefined;
      readonly constructor?: ConstructorCallState;
      readonly initializer?: RuntimeInstance;
      readonly kind: "python";
      readonly protocol?: IteratorProtocolCall;
    }
  | {
      readonly activeFaultBaseDepth: number;
      readonly callMarkerBaseDepth: number;
      readonly callerPendingControl: PendingControl | undefined;
      readonly exceptionHandlerBaseDepth: number;
      readonly frameBaseDepth: number;
      readonly generator:
        RuntimeAsyncGenerator | RuntimeCoroutine | RuntimeGenerator;
      injectedFault?: VmRuntimeError;
      readonly kind: "generator";
      readonly machineStackPointer: number;
      readonly owner: GeneratorResumeOwner;
    }
  | { readonly kind: "extension" }
  | {
      readonly bases: readonly RuntimeClass[];
      readonly callerPendingControl: PendingControl | undefined;
      readonly classId: number;
      readonly kind: "class";
    }
  | {
      readonly alias?: string;
      readonly binding?: ScopeBinding;
      readonly bindModuleId?: number;
      readonly caller: RuntimeFrame;
      readonly callerPendingControl: PendingControl | undefined;
      readonly kind: "module";
      readonly moduleId: number;
    };

type ModuleState =
  | { readonly kind: "unloaded" }
  | { readonly kind: "loading"; readonly namespace: RuntimeNamespace }
  | { readonly kind: "loaded"; readonly namespace: RuntimeNamespace };

interface RuntimeExceptionHandler {
  readonly activeFaultDepth: number;
  readonly callMarkerDepth: number;
  readonly finallyTarget?: TargetReference;
  readonly frameDepth: number;
  readonly handlers: readonly CompiledExceptionHandler[];
  readonly machineStackPointer: number;
  readonly starExitTarget?: TargetReference;
  readonly stackDepth: number;
}

interface ExceptStarMetadata {
  readonly activeFaultDepth: number;
  readonly finallyTarget?: TargetReference;
  readonly handlers: readonly CompiledExceptionHandler[];
  nextHandler: number;
  readonly span: SourceSpan;
  readonly starExitTarget: TargetReference;
}

interface ExceptionGroupPredicateState {
  readonly condition: RuntimeValue;
  current?: RuntimeNamespace;
  readonly decisions: WeakMap<RuntimeNamespace, boolean>;
  readonly machineStackPointer: number;
  readonly pair: boolean;
  readonly pending: RuntimeNamespace[];
  readonly receiver: RuntimeNamespace & {
    readonly name: "BaseExceptionGroup" | "ExceptionGroup";
  };
  readonly span: SourceSpan;
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
  private readonly classAnnotations = new WeakMap<
    RuntimeClass,
    ManagedAnnotations
  >();
  private readonly functionAnnotations = new WeakMap<
    NativeFunction,
    ManagedAnnotations
  >();
  private readonly namespaceAnnotations = new WeakMap<
    RuntimeNamespace,
    ManagedAnnotations
  >();
  private readonly typeParameterStates = new WeakMap<
    RuntimeNamespace,
    ManagedTypeParameter
  >();
  private readonly typeAliasStates = new WeakMap<
    RuntimeNamespace,
    ManagedTypeAlias
  >();
  private readonly genericAliasStates = new WeakMap<
    RuntimeNamespace,
    ManagedGenericAlias
  >();
  private readonly superStates = new WeakMap<RuntimeNamespace, ManagedSuper>();
  private readonly genericAliasCache = new Map<string, RuntimeNamespace>();
  private readonly runtimeIdentityIds = new WeakMap<object, number>();
  private readonly typingSpecialForms = new WeakMap<
    RuntimeNamespace,
    TypingSpecialForm
  >();
  private readonly typingReadOnlyObjects = new WeakSet<RuntimeNamespace>();
  private readonly descriptorWrappers = new WeakMap<
    RuntimeNamespace,
    ManagedDescriptorWrapper
  >();
  private nextRuntimeIdentityId = 1;
  private readonly functionTypeParameters = new WeakMap<
    NativeFunction,
    RuntimeTuple
  >();
  private readonly classTypeParameters = new WeakMap<
    RuntimeClass,
    RuntimeTuple
  >();
  private readonly noTypeParameterDefault: RuntimeNamespace = {
    kind: "namespace",
    name: "typing.NoDefault",
    values: new Map([["__name__", "NoDefault"]]),
  };
  private readonly typingModule: RuntimeNamespace;
  private readonly templatelibModule: RuntimeNamespace;
  private readonly stringModule: RuntimeNamespace;
  private readonly generators = new WeakMap<
    RuntimeGenerator,
    GeneratorRuntimeState
  >();
  private readonly asyncGenerators = new WeakMap<
    RuntimeAsyncGenerator,
    GeneratorRuntimeState
  >();
  private readonly coroutines = new WeakMap<
    RuntimeCoroutine,
    GeneratorRuntimeState
  >();
  private readonly iterBuiltin = iterFunction();
  private readonly callableIteratorClass: RuntimeClass;
  private readonly nextBuiltin = nextFunction();
  private readonly boolBuiltin = boolFunction();
  private readonly dictBuiltin: NativeFunction;
  private readonly intBuiltin: NativeFunction;
  private readonly listBuiltin: NativeFunction;
  private readonly setBuiltin: NativeFunction;
  private readonly strBuiltin: NativeFunction;
  private readonly tupleBuiltin: NativeFunction;
  private readonly propertyBuiltin = nativeFunction(
    "property",
    (positional, keywords) => this.createProperty(positional, keywords),
  );
  private readonly staticmethodBuiltin = nativeFunction(
    "staticmethod",
    (positional, keywords) =>
      this.createMethodWrapper("staticmethod", positional, keywords),
  );
  private readonly classmethodBuiltin = nativeFunction(
    "classmethod",
    (positional, keywords) =>
      this.createMethodWrapper("classmethod", positional, keywords),
  );
  private readonly propertyGetterBuiltin = nativeFunction(
    "getter",
    (positional, keywords) =>
      this.replacePropertyAccessor("getter", positional, keywords),
  );
  private readonly propertySetterBuiltin = nativeFunction(
    "setter",
    (positional, keywords) =>
      this.replacePropertyAccessor("setter", positional, keywords),
  );
  private readonly propertyDeleterBuiltin = nativeFunction(
    "deleter",
    (positional, keywords) =>
      this.replacePropertyAccessor("deleter", positional, keywords),
  );
  private readonly getattrBuiltin = nativeFunction("getattr", () => {
    throw new VmRuntimeError("RuntimeError", "getattr escaped CS486 call path");
  });
  private readonly setattrBuiltin = nativeFunction("setattr", () => {
    throw new VmRuntimeError("RuntimeError", "setattr escaped CS486 call path");
  });
  private readonly delattrBuiltin = nativeFunction("delattr", () => {
    throw new VmRuntimeError("RuntimeError", "delattr escaped CS486 call path");
  });
  private readonly objectGetattributeBuiltin = nativeFunction(
    "__getattribute__",
    () => {
      throw new VmRuntimeError(
        "RuntimeError",
        "object.__getattribute__ escaped CS486 call path",
      );
    },
  );
  private readonly objectSetattrBuiltin = nativeFunction("__setattr__", () => {
    throw new VmRuntimeError(
      "RuntimeError",
      "object.__setattr__ escaped CS486 call path",
    );
  });
  private readonly objectDelattrBuiltin = nativeFunction("__delattr__", () => {
    throw new VmRuntimeError(
      "RuntimeError",
      "object.__delattr__ escaped CS486 call path",
    );
  });
  private readonly objectInitBuiltin = nativeFunction(
    "__init__",
    (positional, keywords) => {
      if (
        keywords.size > 0 ||
        positional.length !== 1 ||
        !isInstance(positional[0]!)
      ) {
        throw new VmRuntimeError(
          "TypeError",
          "object.__init__ expects one instance receiver",
        );
      }
      return null;
    },
  );
  private readonly objectNewBuiltin = nativeFunction(
    "__new__",
    (positional, keywords) => this.callObjectNew(positional, keywords),
  );
  private readonly objectNewDescriptor: RuntimeNamespace = {
    kind: "namespace",
    name: "staticmethod",
    values: new Map([["__func__", this.objectNewBuiltin]]),
  };
  private readonly superBuiltin = nativeFunction("super", () => {
    throw new VmRuntimeError("RuntimeError", "super escaped CS486 call path");
  });
  private readonly sendBuiltin = generatorSendFunction();
  private readonly throwBuiltin = generatorThrowFunction();
  private readonly closeBuiltin = generatorCloseFunction();
  private readonly asyncGeneratorIterBuiltin = asyncGeneratorIterFunction();
  private readonly asyncGeneratorNextBuiltin = asyncGeneratorOperationFunction(
    "__anext__",
    "next",
    0,
    0,
  );
  private readonly asyncGeneratorSendBuiltin = asyncGeneratorOperationFunction(
    "asend",
    "send",
    1,
    1,
  );
  private readonly asyncGeneratorThrowBuiltin = asyncGeneratorOperationFunction(
    "athrow",
    "throw",
    1,
    3,
  );
  private readonly asyncGeneratorCloseBuiltin = asyncGeneratorOperationFunction(
    "aclose",
    "close",
    0,
    0,
  );
  private readonly exceptionGroupDeriveBuiltin = nativeFunction(
    "derive",
    (positional, keywords) => this.deriveExceptionGroup(positional, keywords),
  );
  private readonly exceptionGroupSplitBuiltin = nativeFunction(
    "split",
    (positional, keywords) =>
      this.splitExceptionGroup(positional, keywords, true),
  );
  private readonly exceptionGroupSubgroupBuiltin = nativeFunction(
    "subgroup",
    (positional, keywords) =>
      this.splitExceptionGroup(positional, keywords, false),
  );
  private readonly objectClass: RuntimeClass = createRootRuntimeClass(
    "object",
    new Map<string, RuntimeValue>([
      ["__getattribute__", this.objectGetattributeBuiltin],
      ["__setattr__", this.objectSetattrBuiltin],
      ["__delattr__", this.objectDelattrBuiltin],
      ["__new__", this.objectNewDescriptor],
      ["__init__", this.objectInitBuiltin],
    ]),
  );
  private readonly exceptionTypes = new Map<string, NativeFunction>(
    [...exceptionNames].map((name) => [name, exceptionConstructor(name)]),
  );
  private readonly exceptStarStates = new WeakMap<
    RuntimeNamespace,
    ExceptStarMetadata
  >();
  private readonly moduleStates: ModuleState[];
  private readonly extensionNamespaces = new Map<number, RuntimeNamespace>();
  private readonly exceptionHandlers: RuntimeExceptionHandler[] = [];
  private readonly activeFaults: VmRuntimeError[] = [];
  private readonly heapAccounting: PythonHeapAccounting;
  private pendingControl: PendingControl | undefined;
  private readonly loadedConstantStrings = new Set<string>();
  private readonly loadedConstantIntegers = new Set<bigint>();
  private readonly activeMaterializations =
    new Set<IterableMaterializationState>();
  private readonly classCompletionStack: SetNameState[] = [];
  private pendingCallDispatch: PendingCallDispatch | undefined;
  private pendingConstructorCompletion:
    PendingConstructorCompletion | undefined;

  constructor(private readonly options: PythonRuntimeOptions) {
    if (!Number.isSafeInteger(options.memoryBytes) || options.memoryBytes <= 0)
      throw new RangeError("memoryBytes must be a positive safe integer");
    if (
      !Number.isSafeInteger(options.limits.maxIntegerBits) ||
      options.limits.maxIntegerBits < 53
    ) {
      throw new RangeError(
        "maxIntegerBits must be a safe integer of at least 53",
      );
    }
    this.descriptorWrappers.set(this.objectNewDescriptor, {
      callable: this.objectNewBuiltin,
      kind: "staticmethod",
    });
    this.setBuiltin = setFunction(
      options.limits.maxCollectionSize,
      options.limits.maxStringLength,
    );
    this.intBuiltin = intFunction(options.limits.maxIntegerBits);
    this.strBuiltin = strFunction(options.limits.maxStringLength);
    this.listBuiltin = listFunction(options.limits.maxCollectionSize);
    this.tupleBuiltin = tupleFunction(options.limits.maxCollectionSize);
    this.dictBuiltin = dictFunction(options.limits.maxCollectionSize);
    this.exceptionTypes.set(
      "BaseExceptionGroup",
      this.exceptionGroupConstructor("BaseExceptionGroup"),
    );
    this.exceptionTypes.set(
      "ExceptionGroup",
      this.exceptionGroupConstructor("ExceptionGroup"),
    );
    this.typingModule = this.createTypingModule();
    this.templatelibModule = this.createTemplatelibModule();
    this.stringModule = {
      kind: "namespace",
      name: "string",
      values: new Map<string, RuntimeValue>([
        ["__name__", "string"],
        ["templatelib", this.templatelibModule],
      ]),
    };
    const rootGlobals = new Map<string, RuntimeValue>();
    const rootModule = options.modules[0];
    if (rootModule !== undefined)
      initializeModuleGlobals(rootGlobals, rootModule);
    const rootFrameBase: RuntimeFrame = {
      cells: new Map(),
      globals: rootGlobals,
      kind: "module",
      locals: rootGlobals,
      moduleId: 0,
      stackBase: 0,
    };
    const rootAnnotations =
      rootModule === undefined
        ? undefined
        : this.createManagedAnnotations(
            rootModule.annotationFunctionId,
            rootModule.annotationEntryCount,
            rootFrameBase,
            false,
          );
    const rootFrame: RuntimeFrame = {
      ...rootFrameBase,
      annotations: rootAnnotations,
    };
    const internalFunction = (functionId: number): NativeFunction => {
      const descriptor = options.functions[functionId];
      if (descriptor === undefined || descriptor.target < 0) {
        throw new VmRuntimeError(
          "ExecutableFormatError",
          "invalid callable iterator function target",
        );
      }
      const callable = nativeFunction(descriptor.name, () => {
        throw new VmRuntimeError(
          "RuntimeError",
          "managed function escaped CS486 call path",
        );
      });
      this.callables.set(callable, {
        closure: new Map(),
        defaults: [],
        descriptor,
        globals: rootGlobals,
        kind: "python",
        moduleId: 0,
      });
      return callable;
    };
    const callableIteratorMro: RuntimeClass[] = [];
    const callableIteratorClass: RuntimeClass = {
      base: this.objectClass,
      bases: [this.objectClass],
      basesValue: { kind: "tuple", values: [this.objectClass] },
      kind: "class",
      mro: callableIteratorMro,
      mroValue: { kind: "tuple", values: callableIteratorMro },
      name: "callable_iterator",
      values: new Map([
        ["__iter__", internalFunction(options.callableIteratorFunctions.iter)],
        ["__next__", internalFunction(options.callableIteratorFunctions.next)],
      ]),
    };
    callableIteratorMro.push(callableIteratorClass, ...this.objectClass.mro);
    this.callableIteratorClass = callableIteratorClass;
    this.frames = [rootFrame];
    this.moduleStates = options.modules.map((module, index) =>
      index === 0
        ? {
            kind: "loading",
            namespace: {
              kind: "namespace",
              name: module.name,
              values: rootGlobals,
            },
          }
        : { kind: "unloaded" },
    );
    const rootState = this.moduleStates[0];
    if (rootState?.kind === "loading" && rootAnnotations !== undefined) {
      this.namespaceAnnotations.set(rootState.namespace, rootAnnotations);
    }
    this.heapAccounting = new PythonHeapAccounting({
      managedChildren: (value): readonly RuntimeValue[] =>
        this.managedHeapChildren(value),
      maxBytes: options.memoryBytes,
      readRoots: (): PythonHeapRoots => ({
        additionalValues: [
          ...this.activeFaults.flatMap(managedFaultValues),
          ...pendingControlValues(this.pendingControl),
          ...[...this.activeMaterializations].flatMap((state) =>
            this.materializationRoots(state),
          ),
          ...(this.pendingCallDispatch === undefined
            ? []
            : [
                this.pendingCallDispatch.callee,
                this.pendingCallDispatch.positional,
                this.pendingCallDispatch.keywords,
              ]),
          ...(this.pendingConstructorCompletion === undefined
            ? []
            : this.constructorRoots(this.pendingConstructorCompletion)),
          ...this.genericAliasCache.values(),
          ...this.classCompletionStack.flatMap((state) => [
            state.classObject,
            ...state.entries.map(([, descriptor]) => descriptor),
          ]),
          ...this.frames.flatMap((frame) =>
            [...frame.cells.values()].flatMap((cell) =>
              cell.initialized ? [cell.value] : [],
            ),
          ),
          ...this.frames.flatMap((frame) =>
            frame.classCell?.initialized === true
              ? [frame.classCell.value]
              : [],
          ),
          ...this.frames.flatMap((frame) =>
            frame.annotations === undefined
              ? []
              : this.managedAnnotationRoots(frame.annotations),
          ),
          ...this.moduleStates.flatMap((state) => {
            if (state.kind === "unloaded") return [];
            const annotations = this.namespaceAnnotations.get(state.namespace);
            return annotations === undefined
              ? []
              : this.managedAnnotationRoots(annotations);
          }),
          ...this.callMarkers.flatMap((marker): readonly RuntimeValue[] =>
            marker.kind === "class"
              ? [
                  ...marker.bases,
                  ...pendingControlValues(marker.callerPendingControl),
                ]
              : marker.kind === "generator"
                ? [
                    marker.generator,
                    ...managedFaultValues(marker.injectedFault),
                    ...(marker.owner.kind === "yield_from"
                      ? managedFaultValues(marker.owner.closingFault)
                      : []),
                    ...(marker.owner.kind === "async_generator_operation"
                      ? [marker.owner.operation]
                      : marker.owner.kind === "async_for_iter" &&
                          marker.owner.operation !== undefined
                        ? [marker.owner.operation]
                        : []),
                    ...pendingControlValues(marker.callerPendingControl),
                  ]
                : marker.kind === "python"
                  ? [
                      ...(marker.constructor === undefined
                        ? []
                        : this.constructorRoots(marker.constructor)),
                      ...(marker.initializer === undefined
                        ? []
                        : [marker.initializer]),
                      ...(marker.protocol?.owner.kind ===
                      "exception_group_predicate"
                        ? this.exceptionGroupPredicateRoots(
                            marker.protocol.owner.state,
                          )
                        : marker.protocol?.owner.kind === "annotations"
                          ? this.managedAnnotationRoots(
                              marker.protocol.owner.state,
                            )
                          : marker.protocol?.owner.kind === "lazy_type"
                            ? this.managedLazyValueRoots(
                                marker.protocol.owner.state,
                              )
                            : marker.protocol?.owner.kind === "generic_default"
                              ? [
                                  marker.protocol.owner.state.origin,
                                  ...marker.protocol.owner.state.arguments,
                                  ...marker.protocol.owner.state.defaults.flatMap(
                                    (value) =>
                                      this.managedLazyValueRoots(value),
                                  ),
                                ]
                              : []),
                      ...(marker.protocol === undefined
                        ? []
                        : this.descriptorProtocolRoots(marker.protocol.owner)),
                      ...(marker.protocol?.owner.kind === "for_iter" ||
                      marker.protocol?.owner.kind === "yield_from"
                        ? [marker.protocol.owner.iterator]
                        : marker.protocol?.owner.kind === "next" &&
                            marker.protocol.owner.hasDefault
                          ? [marker.protocol.owner.defaultValue]
                          : []),
                      ...pendingControlValues(marker.callerPendingControl),
                    ]
                  : marker.kind === "module"
                    ? pendingControlValues(marker.callerPendingControl)
                    : [],
          ),
        ],
        frames: this.frames,
        moduleNamespaces: this.moduleStates.flatMap((state) =>
          state.kind === "unloaded" ? [] : [state.namespace.values],
        ),
        stack: this.stack,
      }),
    });
  }

  get memoryUsageBytes(): number {
    return this.heapAccounting.usageBytes;
  }

  private captureManagedClosure(
    descriptor: CompiledFunction,
    frame: RuntimeFrame,
    label: string,
  ): {
    readonly classCell?: RuntimeCell;
    readonly closure: Map<string, RuntimeCell>;
  } {
    const closure = new Map<string, RuntimeCell>();
    let classCell: RuntimeCell | undefined;
    for (const name of descriptor.freeNames) {
      const cell = this.closureCell(frame, name);
      if (cell === undefined) {
        throw new VmRuntimeError(
          "ExecutableFormatError",
          `missing ${label} closure cell ${name}`,
        );
      }
      if (name === "__class__" && frame.classCell === cell) {
        classCell = cell;
      } else {
        closure.set(name, cell);
      }
    }
    return { classCell, closure };
  }

  private closureCell(
    frame: RuntimeFrame,
    name: string,
  ): RuntimeCell | undefined {
    return name === "__class__" && frame.classCell !== undefined
      ? frame.classCell
      : frame.cells.get(name);
  }

  private bindingCell(
    frame: RuntimeFrame,
    name: string,
  ): RuntimeCell | undefined {
    return name === "__class__" &&
      frame.kind === "function" &&
      frame.classCell !== undefined
      ? frame.classCell
      : frame.cells.get(name);
  }

  private createManagedAnnotations(
    functionId: number | undefined,
    entryCount: number,
    frame: RuntimeFrame,
    cacheable: boolean,
  ): ManagedAnnotations {
    if (!Number.isSafeInteger(entryCount) || entryCount < 0) {
      throw new VmRuntimeError(
        "ExecutableFormatError",
        "invalid annotation entry count",
      );
    }
    const state: ManagedAnnotations = {
      activeIds: new Set(),
      cacheable,
      entryCount,
      evaluating: false,
    };
    if (functionId === undefined) return state;
    const descriptor = this.options.functions[functionId];
    if (descriptor === undefined || descriptor.target < 0) {
      throw new VmRuntimeError(
        "ExecutableFormatError",
        "invalid annotation function target",
      );
    }
    const { classCell, closure } = this.captureManagedClosure(
      descriptor,
      frame,
      "annotation",
    );
    state.evaluator = {
      annotationLocals:
        descriptor.annotationScope || frame.kind === "class"
          ? frame.locals
          : undefined,
      annotationState: state,
      classCell,
      closure,
      defaults: [],
      descriptor,
      globals: frame.globals,
      kind: "python",
      moduleId: frame.moduleId,
    };
    return state;
  }

  private createManagedLazyValue(
    functionId: number | undefined,
    fallback: RuntimeValue,
    frame: RuntimeFrame,
  ): ManagedLazyValue {
    const state: ManagedLazyValue = { evaluating: false, fallback };
    if (functionId === undefined) return state;
    const descriptor = this.options.functions[functionId];
    if (descriptor === undefined || descriptor.target < 0) {
      throw new VmRuntimeError(
        "ExecutableFormatError",
        "invalid lazy type evaluator target",
      );
    }
    const { classCell, closure } = this.captureManagedClosure(
      descriptor,
      frame,
      "lazy type",
    );
    state.evaluator = {
      annotationLocals: descriptor.annotationScope ? frame.locals : undefined,
      classCell,
      closure,
      defaults: [],
      descriptor,
      globals: frame.globals,
      kind: "python",
      moduleId: frame.moduleId,
    };
    return state;
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
      const marker = this.callMarkers.at(-1);
      if (
        marker?.kind === "generator" &&
        marker.injectedFault !== undefined &&
        operation.kind !== "yield_from_step"
      ) {
        const fault = marker.injectedFault;
        marker.injectedFault = undefined;
        return this.routeFault(fault, context);
      }
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
        if (
          typeof operation.value === "bigint" &&
          !this.loadedConstantIntegers.has(operation.value)
        ) {
          this.loadedConstantIntegers.add(operation.value);
          this.noteRuntimeValue(operation.value);
        }
        return continued(baseCycles);
      case "load_name": {
        if (
          operation.name === "__annotations__" &&
          !this.hasBoundName(operation.binding, operation.name)
        ) {
          const annotations = this.frame().annotations;
          if (annotations !== undefined) {
            return this.accessAnnotations(
              annotations,
              context,
              operation.span,
              baseCycles,
            );
          }
        }
        this.push(
          this.loadName(operation.binding, operation.name, operation.span),
          operation.span,
        );
        return continued(baseCycles);
      }
      case "store_name":
        this.storeName(
          operation.binding,
          operation.name,
          this.pop(operation.span),
          operation.span,
        );
        return continued(baseCycles);
      case "delete_name":
        this.deleteName(operation.binding, operation.name, operation.span);
        return continued(baseCycles);
      case "store_definition": {
        const value = this.pop(operation.span);
        const frame = this.frame();
        this.storeName(
          operation.binding,
          operation.name,
          value,
          operation.span,
          frame,
        );
        return continued(baseCycles);
      }
      case "pop":
        this.pop(operation.span);
        return continued(baseCycles);
      case "copy": {
        const index = this.stack.length - 1 - operation.depth;
        const value = this.stack[index];
        if (value === undefined) {
          throw new VmRuntimeError(
            "RuntimeError",
            "managed value stack copy underflow",
            operation.span,
          );
        }
        this.push(value, operation.span);
        return continued(baseCycles);
      }
      case "build_list":
      case "build_set":
      case "build_tuple": {
        const operands = this.popMany(operation.count, operation.span);
        if (
          operands.some(
            (operand, index) =>
              operation.starred[index] === true &&
              isManagedIterableSource(operand),
          )
        ) {
          return this.materializeDisplay(
            operation,
            operands,
            context,
            baseCycles,
          );
        }
        const values: RuntimeValue[] = [];
        const setEntries = new Map<string, RuntimeValue>();
        const append = (value: RuntimeValue): void => {
          if (operation.kind === "build_set") {
            const key = runtimeHashKey(
              value,
              operation.span,
              this.options.limits.maxStringLength,
            );
            if (setEntries.has(key)) return;
            this.checkCollection(setEntries.size + 1, operation.span);
            setEntries.set(key, value);
            return;
          }
          this.checkCollection(values.length + 1, operation.span);
          values.push(value);
        };
        operands.forEach((operand, index) => {
          if (operation.starred[index] === true) {
            for (const item of consumeIterable(operand, operation.span)) {
              append(item);
            }
          } else {
            append(operand);
          }
        });
        const value =
          operation.kind === "build_list"
            ? ({ kind: "list", values } as const)
            : operation.kind === "build_set"
              ? ({ entries: setEntries, kind: "set" } as const)
              : ({ kind: "tuple", values } as const);
        this.push(value, operation.span);
        this.noteAllocation(
          operation.kind === "build_set"
            ? 40 +
                [...setEntries.keys()].reduce(
                  (bytes, key) => bytes + setEntryBytes(key),
                  0,
                )
            : 32 + values.length * 8,
        );
        return continued(
          baseCycles +
            (operation.kind === "build_set" ? setEntries.size : values.length) *
              2,
        );
      }
      case "build_dict": {
        const values = this.popMany(operation.operandCount, operation.span);
        const entries = new Map<RuntimeValue, RuntimeValue>();
        let valueIndex = 0;
        for (const entryKind of operation.entries) {
          if (entryKind === "pair") {
            const key = values[valueIndex++]!;
            const value = values[valueIndex++]!;
            if (!entries.has(key)) {
              this.checkCollection(entries.size + 1, operation.span);
            }
            entries.set(key, value);
          } else {
            const mapping = values[valueIndex++]!;
            if (!isDictionary(mapping)) {
              throw new VmRuntimeError(
                "TypeError",
                "Dictionary unpacking requires a mapping",
                operation.span,
              );
            }
            for (const [key, value] of mapping.entries) {
              if (!entries.has(key)) {
                this.checkCollection(entries.size + 1, operation.span);
              }
              entries.set(key, value);
            }
          }
        }
        this.push({ kind: "dictionary", entries }, operation.span);
        this.noteAllocation(48 + entries.size * 24);
        return continued(baseCycles + entries.size * 4);
      }
      case "comprehension_add": {
        if (operation.containerKind === "dictionary") {
          const value = this.pop(operation.span);
          const key = this.pop(operation.span);
          const container = this.pop(operation.span);
          if (!isDictionary(container)) {
            throw new VmRuntimeError(
              "RuntimeError",
              "Dictionary comprehension result is invalid",
              operation.span,
            );
          }
          const added = !container.entries.has(key);
          if (added)
            this.checkCollection(container.entries.size + 1, operation.span);
          container.entries.set(key, value);
          if (added) this.noteAllocation(24);
        } else {
          const value = this.pop(operation.span);
          const container = this.pop(operation.span);
          if (operation.containerKind === "list") {
            if (
              typeof container !== "object" ||
              container === null ||
              container.kind !== "list"
            ) {
              throw new VmRuntimeError(
                "RuntimeError",
                "List comprehension result is invalid",
                operation.span,
              );
            }
            this.checkCollection(container.values.length + 1, operation.span);
            container.values.push(value);
            this.noteAllocation(8);
          } else {
            if (!isSet(container)) {
              throw new VmRuntimeError(
                "RuntimeError",
                "Set comprehension result is invalid",
                operation.span,
              );
            }
            const key = runtimeHashKey(
              value,
              operation.span,
              this.options.limits.maxStringLength,
            );
            if (!container.entries.has(key)) {
              this.checkCollection(container.entries.size + 1, operation.span);
              container.entries.set(key, value);
              this.noteAllocation(setEntryBytes(key));
            }
          }
        }
        return continued(baseCycles + 4);
      }
      case "unpack": {
        const source = this.pop(operation.span);
        if (isManagedIterableSource(source)) {
          return this.materializeUnpack(operation, source, context, baseCycles);
        }
        const values = consumeIterable(source, operation.span);
        const minimum = operation.before + operation.after;
        if (
          (operation.starred && values.length < minimum) ||
          (!operation.starred && values.length !== minimum)
        ) {
          throw new VmRuntimeError(
            "ValueError",
            operation.starred
              ? `not enough values to unpack (expected at least ${String(minimum)})`
              : `unpack requires exactly ${String(minimum)} values`,
            operation.span,
          );
        }
        const unpacked: RuntimeValue[] = [...values.slice(0, operation.before)];
        if (operation.starred) {
          const end = values.length - operation.after;
          const rest = values.slice(operation.before, end);
          this.checkCollection(rest.length, operation.span);
          unpacked.push({ kind: "list", values: rest });
          this.noteAllocation(32 + rest.length * 8);
        }
        if (operation.after > 0) {
          unpacked.push(...values.slice(values.length - operation.after));
        }
        for (let index = unpacked.length - 1; index >= 0; index -= 1) {
          this.push(unpacked[index]!, operation.span);
        }
        return continued(baseCycles + values.length * 2);
      }
      case "format": {
        const operands = this.popMany(operation.operandCount, operation.span);
        const cursor = { index: 0 };
        let value = operation.strings[0] ?? "";
        for (
          let index = 0;
          index < operation.interpolations.length;
          index += 1
        ) {
          value += renderFormattedInterpolation(
            operation.interpolations[index]!,
            operands,
            cursor,
            operation.span,
            this.options.limits.maxStringLength,
          );
          value += operation.strings[index + 1] ?? "";
          this.checkString(value, operation.span);
        }
        this.checkString(value, operation.span);
        this.push(value, operation.span);
        this.noteAllocation(16 + utf8ByteLength(value));
        return continued(baseCycles + Math.ceil(value.length / 4));
      }
      case "build_template": {
        this.checkCollection(operation.strings.length, operation.span);
        this.checkCollection(operation.interpolations.length, operation.span);
        const operands = this.popMany(operation.operandCount, operation.span);
        const interpolationValues: RuntimeNamespace[] = [];
        const values: RuntimeValue[] = [];
        const cursor = { index: 0 };
        for (const interpolation of operation.interpolations) {
          const value = operands[cursor.index++]!;
          values.push(value);
          let formatSpec = "";
          for (const part of interpolation.formatParts) {
            formatSpec +=
              typeof part === "string"
                ? part
                : renderFormattedInterpolation(
                    part,
                    operands,
                    cursor,
                    operation.span,
                    this.options.limits.maxStringLength,
                  );
            this.checkString(formatSpec, operation.span);
          }
          this.checkString(interpolation.expression, operation.span);
          this.checkString(formatSpec, operation.span);
          interpolationValues.push({
            kind: "namespace",
            name: "Interpolation",
            values: new Map<string, RuntimeValue>([
              ["value", value],
              ["expression", interpolation.expression],
              ["conversion", interpolation.conversion],
              ["format_spec", formatSpec],
            ]),
          });
        }
        const template: RuntimeNamespace = {
          kind: "namespace",
          name: "Template",
          values: new Map<string, RuntimeValue>([
            ["strings", { kind: "tuple", values: [...operation.strings] }],
            ["interpolations", { kind: "tuple", values: interpolationValues }],
            ["values", { kind: "tuple", values }],
          ]),
        };
        this.heapAccounting.preflightAdditionalValue(template, 96);
        this.push(template, operation.span);
        this.noteAllocation(
          96 +
            operation.strings.reduce(
              (bytes, text) => bytes + utf8ByteLength(text),
              0,
            ) +
            interpolationValues.length * 96,
        );
        return continued(baseCycles + operation.operandCount * 2);
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
        this.noteRuntimeValue(value);
        return continued(baseCycles + (operation.operator === "**" ? 20 : 4));
      }
      case "unary": {
        const value = this.pop(operation.span);
        const result =
          operation.operator === "not"
            ? !truthy(value)
            : applyPythonUnaryNumeric(
                value,
                operation.operator,
                this.options.limits.maxIntegerBits,
                operation.span,
              );
        this.push(result, operation.span);
        this.noteRuntimeValue(result);
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
              this.options.limits.maxStringLength,
            ),
          ),
          operation.span,
        );
        return continued(baseCycles + operation.operators.length * 4);
      }
      case "compare_chain": {
        const right = this.pop(operation.span);
        const left = this.pop(operation.span);
        const matched = compare(
          left,
          right,
          operation.operator,
          operation.span,
          this.options.limits.maxStringLength,
        );
        this.push(matched ? right : false, operation.span);
        context.writeRegister("eax", matched ? 1 : 0);
        return continued(baseCycles + 4);
      }
      case "truthy": {
        const value = operation.keep
          ? this.peek(operation.span)
          : this.pop(operation.span);
        context.writeRegister("eax", truthy(value) ? 1 : 0);
        return continued(baseCycles);
      }
      case "record_annotation": {
        const annotations = this.frame().annotations;
        if (
          annotations === undefined ||
          operation.activeId < 0 ||
          operation.activeId >= annotations.entryCount
        ) {
          throw new VmRuntimeError(
            "ExecutableFormatError",
            "invalid active annotation entry",
            operation.span,
          );
        }
        if (!annotations.activeIds.has(operation.activeId)) {
          const activeRoots: RuntimeList = annotations.activeRoots ?? {
            kind: "list",
            values: [],
          };
          activeRoots.values.push(null);
          try {
            this.noteAllocation(annotations.activeRoots === undefined ? 40 : 8);
          } catch (error: unknown) {
            activeRoots.values.pop();
            throw error;
          }
          annotations.activeRoots = activeRoots;
          annotations.activeIds.add(operation.activeId);
        }
        return continued(baseCycles + 2);
      }
      case "annotation_begin": {
        const dictionary: RuntimeDictionary = {
          entries: new Map(),
          kind: "dictionary",
        };
        this.push(dictionary, operation.span);
        this.noteAllocation(48);
        return continued(baseCycles);
      }
      case "annotation_is_active": {
        const annotations = this.frame().annotations;
        if (
          annotations === undefined ||
          operation.activeId < 0 ||
          operation.activeId >= annotations.entryCount
        ) {
          throw new VmRuntimeError(
            "ExecutableFormatError",
            "invalid annotation activity check",
            operation.span,
          );
        }
        context.writeRegister(
          "eax",
          annotations.activeIds.has(operation.activeId) ? 1 : 0,
        );
        return continued(baseCycles + 2);
      }
      case "annotation_add": {
        const value = this.pop(operation.span);
        const dictionary = this.peek(operation.span);
        if (!isDictionary(dictionary)) {
          throw new VmRuntimeError(
            "ExecutableFormatError",
            "annotation evaluator has no result dictionary",
            operation.span,
          );
        }
        const additionalBytes = dictionary.entries.has(operation.name)
          ? 0
          : 40 + utf8ByteLength(operation.name);
        if (
          !dictionary.entries.has(operation.name) &&
          dictionary.entries.size >= this.options.limits.maxCollectionSize
        ) {
          throw new VmLimitError("annotations", operation.span);
        }
        this.heapAccounting.preflightAdditionalValue(value, additionalBytes);
        dictionary.entries.set(operation.name, value);
        return continued(baseCycles + 4);
      }
      case "match_pattern": {
        const subject = this.pop(operation.span);
        const captures = new Map<string, PatternCapture>();
        const work = { steps: 0 };
        const matched = this.matchPattern(
          operation.pattern,
          subject,
          captures,
          work,
          0,
        );
        if (matched) this.commitPatternCaptures(captures, operation.span);
        context.writeRegister("eax", matched ? 1 : 0);
        return continued(
          baseCycles + Math.max(operation.nodeCount, work.steps) * 4,
        );
      }
      case "load_attribute": {
        const object = this.pop(operation.span);
        const lazyTypeValue = this.lazyTypeAttribute(object, operation.name);
        if (lazyTypeValue !== undefined) {
          return this.accessManagedLazyValue(
            lazyTypeValue,
            context,
            operation.span,
            baseCycles,
          );
        }
        if (operation.name === "__type_params__") {
          const typeParameters = this.typeParametersForObject(object);
          if (typeParameters !== undefined) {
            this.push(typeParameters, operation.span);
            return continued(baseCycles);
          }
        }
        if (
          operation.name === "__annotations__" &&
          !this.hasExplicitAnnotations(object)
        ) {
          const annotations = this.annotationsForObject(object);
          if (annotations !== undefined) {
            return this.accessAnnotations(
              annotations,
              context,
              operation.span,
              baseCycles,
            );
          }
        }
        return this.loadAttributeOperation(
          object,
          operation.name,
          context,
          operation.span,
          baseCycles,
        );
      }
      case "prepare_context":
        return this.prepareContext(operation.span, baseCycles, false);
      case "prepare_async_context":
        return this.prepareContext(operation.span, baseCycles, true);
      case "context_fault_info":
        return this.contextFaultInfo(operation.span, baseCycles);
      case "store_attribute": {
        const value = this.pop(operation.span);
        const object = this.pop(operation.span);
        return this.storeAttributeOperation(
          object,
          operation.name,
          value,
          context,
          operation.span,
          baseCycles,
        );
      }
      case "store_attribute_rhs_first": {
        const object = this.pop(operation.span);
        const value = this.pop(operation.span);
        return this.storeAttributeOperation(
          object,
          operation.name,
          value,
          context,
          operation.span,
          baseCycles,
        );
      }
      case "delete_attribute": {
        const object = this.pop(operation.span);
        return this.deleteAttributeOperation(
          object,
          operation.name,
          context,
          operation.span,
          baseCycles,
        );
      }
      case "load_subscript": {
        const index = this.pop(operation.span);
        const object = this.pop(operation.span);
        return this.loadSubscriptOperation(
          object,
          index,
          context,
          operation.span,
          baseCycles,
        );
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
      case "store_subscript_rhs_first": {
        const index = this.pop(operation.span);
        const object = this.pop(operation.span);
        const value = this.pop(operation.span);
        storeSubscript(
          object,
          index,
          value,
          operation.span,
          this.options.limits.maxCollectionSize,
        );
        return continued(baseCycles);
      }
      case "delete_subscript": {
        const index = this.pop(operation.span);
        const object = this.pop(operation.span);
        deleteSubscript(object, index, operation.span);
        return continued(baseCycles);
      }
      case "load_slice": {
        const step = this.pop(operation.span);
        const stop = this.pop(operation.span);
        const start = this.pop(operation.span);
        const object = this.pop(operation.span);
        const value = loadSlice(object, start, stop, step, operation.span);
        if (typeof value === "string") this.checkString(value, operation.span);
        if (isSequence(value)) {
          this.checkCollection(value.values.length, operation.span);
        }
        this.push(value, operation.span);
        this.noteRuntimeValue(value);
        return continued(baseCycles);
      }
      case "store_slice_rhs_first": {
        const step = this.pop(operation.span);
        const stop = this.pop(operation.span);
        const start = this.pop(operation.span);
        const object = this.pop(operation.span);
        const value = this.pop(operation.span);
        if (isManagedIterableSource(value)) {
          if (
            typeof object !== "object" ||
            object === null ||
            object.kind !== "list"
          ) {
            throw new VmRuntimeError(
              "TypeError",
              "Slice target is not writable",
              operation.span,
            );
          }
          normalizeSlice(
            start,
            stop,
            step,
            object.values.length,
            operation.span,
          );
          return this.materializeSlice(
            object,
            start,
            stop,
            step,
            value,
            operation.span,
            context,
            baseCycles,
          );
        }
        const allocationBytes = storeSlice(
          object,
          start,
          stop,
          step,
          value,
          operation.span,
          this.options.limits.maxCollectionSize,
        );
        if (allocationBytes > 0) this.noteAllocation(allocationBytes);
        return continued(baseCycles);
      }
      case "delete_slice": {
        const step = this.pop(operation.span);
        const stop = this.pop(operation.span);
        const start = this.pop(operation.span);
        const object = this.pop(operation.span);
        deleteSlice(object, start, stop, step, operation.span);
        return continued(baseCycles);
      }
      case "get_iter": {
        const source = this.pop(operation.span);
        if (isInstance(source)) {
          return this.acquireUserIterator(
            source,
            context,
            operation.span,
            baseCycles,
          );
        }
        const iterator = iteratorValue(source, operation.span);
        this.push(iterator, operation.span);
        if (iterator !== source && isIterator(iterator)) {
          this.noteAllocation(32 + iterator.values.length * 8);
        }
        return continued(baseCycles);
      }
      case "get_async_iter": {
        const source = this.pop(operation.span);
        if (isAsyncGenerator(source)) {
          this.push(source, operation.span);
          return continued(baseCycles);
        }
        if (!isInstance(source)) {
          throw new VmRuntimeError(
            "TypeError",
            "async for requires an object with __aiter__",
            operation.span,
          );
        }
        return this.acquireUserAsyncIterator(
          source,
          context,
          operation.span,
          baseCycles,
        );
      }
      case "await": {
        const value = this.pop(operation.span);
        if (isAsyncGeneratorOperation(value)) {
          return this.resumeAsyncGeneratorOperation(
            value,
            context,
            operation.span,
            baseCycles,
          );
        }
        if (isCoroutine(value)) {
          return this.resumeCoroutine(
            value,
            context,
            operation.span,
            baseCycles,
          );
        }
        if (isInstance(value)) {
          return this.acquireAwaitIterator(
            value,
            context,
            operation.span,
            baseCycles,
          );
        }
        throw new VmRuntimeError(
          "TypeError",
          "object cannot be used in an await expression",
          operation.span,
        );
      }
      case "for_iter": {
        const value = this.peek(operation.span);
        if (isGenerator(value)) {
          return this.resumeGenerator(
            value,
            { kind: "for_iter" },
            null,
            context,
            operation.span,
            baseCycles,
          );
        }
        if (isSequenceIterator(value)) {
          return this.callSequenceIteratorNext(
            value,
            {
              iterator: value,
              kind: "for_iter",
              span: operation.span,
            },
            context,
            operation.span,
            baseCycles,
          );
        }
        if (isInstance(value)) {
          return this.callUserIteratorNext(
            value,
            {
              iterator: value,
              kind: "for_iter",
              span: operation.span,
            },
            context,
            operation.span,
            baseCycles,
          );
        }
        if (!isIterator(value))
          throw new VmRuntimeError(
            "RuntimeError",
            "FOR_ITER requires an iterator",
            operation.span,
          );
        const step = nextIteratorValue(value);
        if (step.done) {
          this.pop(operation.span);
          context.writeRegister("eax", 0);
        } else {
          this.push(step.value, operation.span);
          context.writeRegister("eax", 1);
        }
        return continued(baseCycles);
      }
      case "async_for_iter": {
        const iterator = this.peek(operation.span);
        if (isAsyncGenerator(iterator)) {
          return this.resumeGenerator(
            iterator,
            { iterator, kind: "async_for_iter", span: operation.span },
            null,
            context,
            operation.span,
            baseCycles,
          );
        }
        if (!isInstance(iterator)) {
          throw new VmRuntimeError(
            "TypeError",
            "async iterator state is invalid",
            operation.span,
          );
        }
        return this.callUserAsyncIteratorNext(
          iterator,
          context,
          operation.span,
          baseCycles,
        );
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
        const { classCell, closure } = this.captureManagedClosure(
          descriptor,
          frame,
          "function",
        );
        const callable = nativeFunction(descriptor.name, () => {
          throw new VmRuntimeError(
            "RuntimeError",
            "managed function escaped CS486 call path",
          );
        });
        this.callables.set(callable, {
          annotationLocals: descriptor.annotationScope
            ? frame.locals
            : undefined,
          classCell,
          closure,
          defaults,
          descriptor,
          globals: frame.globals,
          kind: "python",
          moduleId: frame.moduleId,
        });
        this.functionAnnotations.set(
          callable,
          this.createManagedAnnotations(
            descriptor.annotationFunctionId,
            descriptor.annotationEntryCount,
            frame,
            true,
          ),
        );
        this.push(callable, operation.span);
        this.noteAllocation(
          64 +
            defaults.length * 8 +
            closure.size * 16 +
            (classCell === undefined ? 0 : 16),
        );
        return continued(baseCycles);
      }
      case "make_type_parameter": {
        const frame = this.frame();
        const value: RuntimeNamespace = {
          kind: "namespace",
          name: operation.name,
          values: new Map([["__name__", operation.name]]),
        };
        this.typeParameterStates.set(value, {
          bound: this.createManagedLazyValue(
            operation.boundFunctionId,
            null,
            frame,
          ),
          constraints: this.createManagedLazyValue(
            operation.constraintsFunctionId,
            { kind: "tuple", values: [] },
            frame,
          ),
          defaultValue: this.createManagedLazyValue(
            operation.defaultFunctionId,
            this.noTypeParameterDefault,
            frame,
          ),
          kind: operation.parameterKind,
        });
        this.push(value, operation.span);
        this.noteAllocation(96);
        return continued(baseCycles + 4);
      }
      case "attach_type_parameters": {
        const object = this.pop(operation.span);
        const parameters = this.typeParameterTuple(
          operation.names,
          operation.span,
        );
        if (isNativeFunction(object)) {
          this.functionTypeParameters.set(object, parameters);
        } else if (isClass(object)) {
          this.classTypeParameters.set(object, parameters);
        } else {
          throw new VmRuntimeError(
            "TypeError",
            "type parameters can attach only to a function or class",
            operation.span,
          );
        }
        this.push(object, operation.span);
        this.noteAllocation(32 + parameters.values.length * 8);
        return continued(baseCycles + operation.names.length * 2);
      }
      case "make_type_alias": {
        const frame = this.frame();
        const typeParameters = this.typeParameterTuple(
          operation.typeParameterNames,
          operation.span,
        );
        const alias: RuntimeNamespace = {
          kind: "namespace",
          name: operation.name,
          values: new Map<string, RuntimeValue>([
            ["__name__", operation.name],
            ["__type_params__", typeParameters],
          ]),
        };
        this.typeAliasStates.set(alias, {
          typeParameters,
          value: this.createManagedLazyValue(
            operation.valueFunctionId,
            null,
            frame,
          ),
        });
        this.push(alias, operation.span);
        this.noteAllocation(96 + typeParameters.values.length * 8);
        return continued(baseCycles + operation.typeParameterNames.length * 2);
      }
      case "make_class":
        return this.makeClass(operation, baseCycles);
      case "call":
        return this.call(
          operation,
          context,
          baseCycles + operation.arguments.length * 4,
        );
      case "dispatch_call": {
        const pending = this.pendingCallDispatch;
        if (pending === undefined) return continued(baseCycles);
        this.pendingCallDispatch = undefined;
        this.push(pending.callee, pending.span);
        for (const value of pending.positional.values)
          this.push(value, pending.span);
        const arguments_: CompiledCallArgument[] =
          pending.positional.values.map(() => ({ kind: "positional" }));
        for (const [name, value] of pending.keywords.entries) {
          if (typeof name !== "string") {
            throw new VmRuntimeError(
              "RuntimeError",
              "pending call contains a non-string keyword",
              pending.span,
            );
          }
          this.push(value, pending.span);
          arguments_.push({ kind: "keyword", name });
        }
        return this.call(
          {
            arguments: arguments_,
            kind: "call",
            span: pending.span,
          },
          context,
          baseCycles,
        );
      }
      case "after_call": {
        const constructor = this.pendingConstructorCompletion;
        if (constructor !== undefined) {
          this.pendingConstructorCompletion = undefined;
          return this.continueClassConstruction(constructor, baseCycles);
        }
        const marker = this.callMarkers.at(-1);
        if (marker?.kind === "extension") {
          this.callMarkers.pop();
          this.push(context.readRegister("eax"), operation.span);
        }
        return continued(baseCycles);
      }
      case "yield":
        return this.suspendGenerator(operation, context, baseCycles);
      case "yield_from_step":
        return this.stepYieldFrom(operation, context, baseCycles);
      case "return": {
        const value = this.pop(operation.span);
        return this.applyControlAction(
          { kind: "return", value },
          context,
          baseCycles,
        );
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
          return this.applyControlAction(action, context, baseCycles);
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
        return this.applyControlAction(pending.action, context, baseCycles);
      }
      case "push_handler":
        if (
          (operation.stackDepthOffset ?? 0) > 0 ||
          this.stack.length + (operation.stackDepthOffset ?? 0) < 0
        ) {
          throw new VmRuntimeError(
            "ExecutableFormatError",
            "invalid exception-handler stack depth offset",
            operation.span,
          );
        }
        this.exceptionHandlers.push({
          activeFaultDepth: this.activeFaults.length,
          callMarkerDepth: this.callMarkers.length,
          finallyTarget: operation.finallyTarget,
          frameDepth: this.frames.length,
          handlers: operation.handlers,
          machineStackPointer: context.readRegister("esp"),
          starExitTarget: operation.starExitTarget,
          stackDepth: this.stack.length + (operation.stackDepthOffset ?? 0),
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
      case "except_star_leave":
        return this.completeExceptStarHandler(
          false,
          operation.span,
          context,
          baseCycles,
        );
      case "except_star_fault":
        return this.completeExceptStarHandler(
          true,
          operation.span,
          context,
          baseCycles,
        );
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
      case "assert_fail": {
        const message = this.pop(operation.span);
        throw new VmRuntimeError(
          "AssertionError",
          operation.hasMessage ? formatValue(message) : "",
          operation.span,
        );
      }
      case "module_complete":
        return this.completeModule(operation, baseCycles);
      case "class_complete":
        return this.completeClass(operation, baseCycles);
      case "class_set_name_step":
        return this.stepSetName(operation, context, baseCycles);
      case "class_set_name_resume":
        return jumpTo(operation.target, baseCycles);
      case "class_return":
        return { cycles: baseCycles, kind: "return" };
      case "import":
        return this.importModule(operation, baseCycles);
      case "module_has_attribute": {
        const namespace = this.importedNamespace(
          operation.imported,
          operation.span,
        );
        context.writeRegister(
          "eax",
          namespace.values.has(operation.name) ? 1 : 0,
        );
        return continued(baseCycles);
      }
      case "bind_from":
        this.bindFromImport(operation);
        return continued(baseCycles);
    }
  }

  private materializeDisplay(
    operation: Extract<
      PythonOperation,
      { kind: "build_list" | "build_set" | "build_tuple" }
    >,
    operands: readonly RuntimeValue[],
    context: Cs486SyscallContext,
    cycles: number,
  ): Cs486SyscallResult {
    const state: IterableMaterializationState = {
      consumer: {
        kind: "display",
        operands,
        operandIndex: 0,
        operation,
        sequence: { kind: "list", values: [] },
        set: { entries: new Map(), kind: "set" },
      },
      emittedCount: 0,
      machineStackPointer: context.readRegister("esp") - 4,
      returnToCaller: false,
      span: operation.span,
    };
    return this.activateMaterialization(state, context, cycles);
  }

  private materializeUnpack(
    operation: Extract<PythonOperation, { kind: "unpack" }>,
    source: RuntimeValue,
    context: Cs486SyscallContext,
    cycles: number,
  ): Cs486SyscallResult {
    const state: IterableMaterializationState = {
      consumer: {
        kind: "unpack",
        operation,
        values: { kind: "list", values: [] },
      },
      emittedCount: 0,
      machineStackPointer: context.readRegister("esp") - 4,
      returnToCaller: false,
      span: operation.span,
    };
    return this.activateMaterialization(state, context, cycles, source);
  }

  private materializeSlice(
    object: RuntimeValue,
    start: RuntimeValue,
    stop: RuntimeValue,
    step: RuntimeValue,
    source: RuntimeValue,
    span: SourceSpan,
    context: Cs486SyscallContext,
    cycles: number,
  ): Cs486SyscallResult {
    if (
      typeof object !== "object" ||
      object === null ||
      object.kind !== "list"
    ) {
      throw new VmRuntimeError(
        "TypeError",
        "Slice target is not writable",
        span,
      );
    }
    const state: IterableMaterializationState = {
      consumer: {
        kind: "slice",
        object,
        replacement: { kind: "list", values: [] },
        span,
        start,
        step,
        stop,
      },
      emittedCount: 0,
      machineStackPointer: context.readRegister("esp") - 4,
      returnToCaller: false,
      span,
    };
    return this.activateMaterialization(state, context, cycles, source);
  }

  private materializeCall(
    operation: Extract<PythonOperation, { kind: "call" }>,
    callee: RuntimeValue,
    argumentValues: readonly RuntimeValue[],
    context: Cs486SyscallContext,
    cycles: number,
  ): Cs486SyscallResult {
    const state: IterableMaterializationState = {
      consumer: {
        argumentIndex: 0,
        argumentValues,
        callee,
        keywords: { entries: new Map(), kind: "dictionary" },
        kind: "call",
        operation,
        positional: { kind: "list", values: [] },
      },
      emittedCount: 0,
      machineStackPointer: context.readRegister("esp") - 4,
      returnToCaller: false,
      span: operation.span,
    };
    return this.activateMaterialization(state, context, cycles);
  }

  private materializeSet(
    source: RuntimeValue,
    span: SourceSpan,
    context: Cs486SyscallContext,
    cycles: number,
  ): Cs486SyscallResult {
    const state: IterableMaterializationState = {
      consumer: {
        kind: "set",
        result: { entries: new Map(), kind: "set" },
      },
      emittedCount: 0,
      machineStackPointer: context.readRegister("esp") - 4,
      returnToCaller: false,
      span,
    };
    return this.activateMaterialization(state, context, cycles, source);
  }

  private activateMaterialization(
    state: IterableMaterializationState,
    context: Cs486SyscallContext,
    cycles: number,
    source?: RuntimeValue,
  ): Cs486SyscallResult {
    this.activeMaterializations.add(state);
    try {
      this.noteAllocation(32);
      return source === undefined
        ? this.continueMaterializationConsumer(state, context, cycles)
        : this.beginMaterializationSource(state, source, context, cycles);
    } catch (error: unknown) {
      this.activeMaterializations.delete(state);
      throw error;
    }
  }

  private continueMaterializationConsumer(
    state: IterableMaterializationState,
    context: Cs486SyscallContext,
    cycles: number,
  ): Cs486SyscallResult {
    try {
      const consumer = state.consumer;
      if (consumer.kind === "display") {
        while (consumer.operandIndex < consumer.operands.length) {
          const index = consumer.operandIndex;
          const operand = consumer.operands[index]!;
          if (consumer.operation.starred[index] === true) {
            return this.beginMaterializationSource(
              state,
              operand,
              context,
              cycles,
            );
          }
          this.acceptMaterializedValue(state, operand);
          consumer.operandIndex += 1;
        }
        return this.finishMaterialization(state, context, cycles);
      }
      if (consumer.kind === "call") {
        while (consumer.argumentIndex < consumer.operation.arguments.length) {
          const index = consumer.argumentIndex;
          const argument = consumer.operation.arguments[index]!;
          const value = consumer.argumentValues[index]!;
          if (argument.kind === "iterable_unpack") {
            return this.beginMaterializationSource(
              state,
              value,
              context,
              cycles,
            );
          }
          if (argument.kind === "positional") {
            this.appendCallPositional(consumer, value, state.span);
          } else if (argument.kind === "keyword") {
            if (argument.name === undefined) {
              throw new VmRuntimeError(
                "ExecutableFormatError",
                "compiled keyword argument has no name",
                state.span,
              );
            }
            this.addCallKeyword(consumer, argument.name, value, state.span);
          } else {
            if (!isDictionary(value)) {
              throw new VmRuntimeError(
                "TypeError",
                "Mapping argument unpacking requires a dictionary",
                state.span,
              );
            }
            for (const [name, item] of value.entries) {
              if (typeof name !== "string") {
                throw new VmRuntimeError(
                  "TypeError",
                  "Mapping argument keys must be strings",
                  state.span,
                );
              }
              this.addCallKeyword(consumer, name, item, state.span);
            }
          }
          consumer.argumentIndex += 1;
        }
        return this.finishMaterialization(state, context, cycles);
      }
      throw new VmRuntimeError(
        "RuntimeError",
        "iterable consumer has no source continuation",
        state.span,
      );
    } catch (error: unknown) {
      this.activeMaterializations.delete(state);
      throw error;
    }
  }

  private beginMaterializationSource(
    state: IterableMaterializationState,
    source: RuntimeValue,
    context: Cs486SyscallContext,
    cycles: number,
  ): Cs486SyscallResult {
    try {
      if (isSequenceIterator(source)) {
        state.currentIterator = source;
        return this.advanceMaterializationIterator(state, context, cycles);
      }
      if (isInstance(source)) {
        if (
          lookupClassAttribute(source.classObject, "__iter__") === undefined
        ) {
          state.currentIterator = this.createSequenceIterator(
            source,
            state.span,
          );
          return this.advanceMaterializationIterator(state, context, cycles);
        }
        const callable = this.pythonSpecialMethod(
          source,
          "__iter__",
          state.span,
        );
        const result = this.callPython(
          callable,
          [source],
          new Map(),
          state.span,
          cycles,
          undefined,
          callable.descriptor.generator
            ? undefined
            : {
                machineStackPointer: state.machineStackPointer,
                owner: { kind: "materialize_get_iter", state },
              },
        );
        if (callable.descriptor.generator) {
          const iterator = this.pop(state.span);
          this.requireIterator(iterator, state.span);
          state.currentIterator = iterator;
          return this.advanceMaterializationIterator(state, context, cycles);
        }
        state.returnToCaller = true;
        return result;
      }
      const iterator = iteratorValue(source, state.span);
      state.currentIterator = iterator;
      if (iterator !== source && isIterator(iterator)) {
        this.noteAllocation(32 + iterator.values.length * 8);
      }
      return this.advanceMaterializationIterator(state, context, cycles);
    } catch (error: unknown) {
      this.activeMaterializations.delete(state);
      throw error;
    }
  }

  private advanceMaterializationIterator(
    state: IterableMaterializationState,
    context: Cs486SyscallContext,
    cycles: number,
  ): Cs486SyscallResult {
    try {
      const iterator = state.currentIterator;
      if (iterator === undefined) {
        throw new VmRuntimeError(
          "RuntimeError",
          "iterable materialization has no current iterator",
          state.span,
        );
      }
      if (isIterator(iterator)) {
        for (;;) {
          const step = nextIteratorValue(iterator);
          if (step.done)
            return this.completeMaterializationSource(state, context, cycles);
          this.acceptMaterializedValue(state, step.value);
          cycles += 2;
        }
      }
      if (isSequenceIterator(iterator)) {
        return this.callSequenceIteratorNext(
          iterator,
          { kind: "materialize", state },
          context,
          state.span,
          cycles,
          state.machineStackPointer,
        );
      }
      if (isGenerator(iterator)) {
        if (iterator.state === "closed") {
          return this.completeMaterializationSource(state, context, cycles);
        }
        const result = this.resumeGenerator(
          iterator,
          { kind: "materialize", state },
          null,
          context,
          state.span,
          cycles,
          undefined,
          state.machineStackPointer,
        );
        if (result.kind === "call") state.returnToCaller = true;
        return result;
      }
      const callable = this.pythonSpecialMethod(
        iterator,
        "__next__",
        state.span,
      );
      const result = this.callPython(
        callable,
        [iterator],
        new Map(),
        state.span,
        cycles,
        undefined,
        callable.descriptor.generator
          ? undefined
          : {
              machineStackPointer: state.machineStackPointer,
              owner: { iterator, kind: "materialize_next", state },
            },
      );
      if (callable.descriptor.generator) {
        this.acceptMaterializedValue(state, this.pop(state.span));
        return this.advanceMaterializationIterator(state, context, cycles);
      }
      state.returnToCaller = true;
      return result;
    } catch (error: unknown) {
      this.activeMaterializations.delete(state);
      throw error;
    }
  }

  private acceptMaterializedValue(
    state: IterableMaterializationState,
    value: RuntimeValue,
  ): void {
    state.emittedCount += 1;
    this.checkCollection(state.emittedCount, state.span);
    const consumer = state.consumer;
    if (consumer.kind === "display") {
      if (consumer.operation.kind === "build_set") {
        const key = runtimeHashKey(
          value,
          state.span,
          this.options.limits.maxStringLength,
        );
        if (consumer.set.entries.has(key)) return;
        this.checkCollection(consumer.set.entries.size + 1, state.span);
        consumer.set.entries.set(key, value);
        this.noteAllocation(setEntryBytes(key));
        return;
      }
      this.checkCollection(consumer.sequence.values.length + 1, state.span);
      consumer.sequence.values.push(value);
      this.noteAllocation(8);
      return;
    }
    if (consumer.kind === "call") {
      this.appendCallPositional(consumer, value, state.span);
      return;
    }
    if (consumer.kind === "set") {
      const key = runtimeHashKey(
        value,
        state.span,
        this.options.limits.maxStringLength,
      );
      if (consumer.result.entries.has(key)) return;
      this.checkCollection(consumer.result.entries.size + 1, state.span);
      consumer.result.entries.set(key, value);
      this.noteAllocation(setEntryBytes(key));
      return;
    }
    const values =
      consumer.kind === "unpack"
        ? consumer.values.values
        : consumer.replacement.values;
    this.checkCollection(values.length + 1, state.span);
    values.push(value);
    this.noteAllocation(8);
  }

  private appendCallPositional(
    consumer: Extract<IterableConsumer, { kind: "call" }>,
    value: RuntimeValue,
    span: SourceSpan,
  ): void {
    this.checkCollection(
      consumer.positional.values.length + consumer.keywords.entries.size + 1,
      span,
    );
    consumer.positional.values.push(value);
    this.noteAllocation(8);
  }

  private addCallKeyword(
    consumer: Extract<IterableConsumer, { kind: "call" }>,
    name: string,
    value: RuntimeValue,
    span: SourceSpan,
  ): void {
    if (consumer.keywords.entries.has(name)) {
      throw new VmRuntimeError(
        "TypeError",
        `Multiple values for keyword argument ${name}`,
        span,
      );
    }
    this.checkCollection(
      consumer.positional.values.length + consumer.keywords.entries.size + 1,
      span,
    );
    consumer.keywords.entries.set(name, value);
    this.noteAllocation(24);
  }

  private completeMaterializationSource(
    state: IterableMaterializationState,
    context: Cs486SyscallContext,
    cycles: number,
  ): Cs486SyscallResult {
    state.currentIterator = undefined;
    if (state.consumer.kind === "display") {
      state.consumer.operandIndex += 1;
      return this.continueMaterializationConsumer(state, context, cycles);
    }
    if (state.consumer.kind === "call") {
      state.consumer.argumentIndex += 1;
      return this.continueMaterializationConsumer(state, context, cycles);
    }
    return this.finishMaterialization(state, context, cycles);
  }

  private finishMaterialization(
    state: IterableMaterializationState,
    context: Cs486SyscallContext,
    cycles: number,
  ): Cs486SyscallResult {
    const consumer = state.consumer;
    if (consumer.kind === "display") {
      const result: RuntimeValue =
        consumer.operation.kind === "build_list"
          ? consumer.sequence
          : consumer.operation.kind === "build_set"
            ? consumer.set
            : { kind: "tuple", values: [...consumer.sequence.values] };
      this.push(result, state.span);
    } else if (consumer.kind === "unpack") {
      this.finishUnpack(consumer.operation, consumer.values.values);
    } else if (consumer.kind === "slice") {
      const allocationBytes = storeSliceValues(
        consumer.object,
        consumer.start,
        consumer.stop,
        consumer.step,
        consumer.replacement.values,
        consumer.span,
        this.options.limits.maxCollectionSize,
      );
      if (allocationBytes > 0) this.noteAllocation(allocationBytes);
    } else if (consumer.kind === "set") {
      this.push(consumer.result, state.span);
    } else if (state.returnToCaller) {
      this.pendingCallDispatch = {
        callee: consumer.callee,
        keywords: consumer.keywords,
        positional: consumer.positional,
        span: state.span,
      };
    } else {
      this.activeMaterializations.delete(state);
      this.push(consumer.callee, state.span);
      for (const value of consumer.positional.values)
        this.push(value, state.span);
      const arguments_: CompiledCallArgument[] = consumer.positional.values.map(
        () => ({ kind: "positional" }),
      );
      for (const [name, value] of consumer.keywords.entries) {
        if (typeof name !== "string") {
          throw new VmRuntimeError(
            "RuntimeError",
            "materialized call contains a non-string keyword",
            state.span,
          );
        }
        this.push(value, state.span);
        arguments_.push({ kind: "keyword", name });
      }
      return this.call(
        { arguments: arguments_, kind: "call", span: state.span },
        context,
        cycles,
      );
    }
    this.activeMaterializations.delete(state);
    return state.returnToCaller
      ? { cycles, kind: "return" }
      : continued(cycles);
  }

  private finishUnpack(
    operation: Extract<PythonOperation, { kind: "unpack" }>,
    values: readonly RuntimeValue[],
  ): void {
    const minimum = operation.before + operation.after;
    if (
      (operation.starred && values.length < minimum) ||
      (!operation.starred && values.length !== minimum)
    ) {
      throw new VmRuntimeError(
        "ValueError",
        operation.starred
          ? `not enough values to unpack (expected at least ${String(minimum)})`
          : `unpack requires exactly ${String(minimum)} values`,
        operation.span,
      );
    }
    const unpacked: RuntimeValue[] = [...values.slice(0, operation.before)];
    if (operation.starred) {
      const end = values.length - operation.after;
      const rest = values.slice(operation.before, end);
      this.checkCollection(rest.length, operation.span);
      unpacked.push({ kind: "list", values: rest });
      this.noteAllocation(32 + rest.length * 8);
    }
    if (operation.after > 0) {
      unpacked.push(...values.slice(values.length - operation.after));
    }
    for (let index = unpacked.length - 1; index >= 0; index -= 1) {
      this.push(unpacked[index]!, operation.span);
    }
  }

  private materializationRoots(
    state: IterableMaterializationState,
  ): readonly RuntimeValue[] {
    const iterator =
      state.currentIterator === undefined ? [] : [state.currentIterator];
    const consumer = state.consumer;
    if (consumer.kind === "display") {
      return [
        ...iterator,
        ...consumer.operands,
        consumer.sequence,
        consumer.set,
      ];
    }
    if (consumer.kind === "call") {
      return [
        ...iterator,
        consumer.callee,
        ...consumer.argumentValues,
        consumer.positional,
        consumer.keywords,
      ];
    }
    if (consumer.kind === "set") return [...iterator, consumer.result];
    if (consumer.kind === "unpack") return [...iterator, consumer.values];
    return [
      ...iterator,
      consumer.object,
      consumer.start,
      consumer.stop,
      consumer.step,
      consumer.replacement,
    ];
  }

  private call(
    operation: Extract<PythonOperation, { kind: "call" }>,
    _context: Cs486SyscallContext,
    cycles: number,
  ): Cs486SyscallResult {
    const values = this.popMany(operation.arguments.length, operation.span);
    let callee = this.pop(operation.span);
    if (
      operation.arguments.some(
        (argument, index) =>
          argument.kind === "iterable_unpack" &&
          isManagedIterableSource(values[index]!),
      )
    ) {
      return this.materializeCall(operation, callee, values, _context, cycles);
    }
    const positional: RuntimeValue[] = [];
    const keywords = new Map<string, RuntimeValue>();
    const addKeyword = (name: string, value: RuntimeValue): void => {
      if (keywords.has(name)) {
        throw new VmRuntimeError(
          "TypeError",
          `Multiple values for keyword argument ${name}`,
          operation.span,
        );
      }
      keywords.set(name, value);
    };
    operation.arguments.forEach((argument, index) => {
      const value = values[index]!;
      if (argument.kind === "positional") {
        positional.push(value);
      } else if (argument.kind === "keyword") {
        if (argument.name === undefined) {
          throw new VmRuntimeError(
            "ExecutableFormatError",
            "compiled keyword argument has no name",
            operation.span,
          );
        }
        addKeyword(argument.name, value);
      } else if (argument.kind === "iterable_unpack") {
        positional.push(...consumeIterable(value, operation.span));
      } else {
        if (!isDictionary(value)) {
          throw new VmRuntimeError(
            "TypeError",
            "Mapping argument unpacking requires a dictionary",
            operation.span,
          );
        }
        for (const [key, item] of value.entries) {
          if (typeof key !== "string") {
            throw new VmRuntimeError(
              "TypeError",
              "Mapping argument keys must be strings",
              operation.span,
            );
          }
          addKeyword(key, item);
        }
      }
      if (
        positional.length + keywords.size >
        this.options.limits.maxCollectionSize
      ) {
        throw new VmLimitError("expanded arguments", operation.span);
      }
    });
    cycles += (positional.length + keywords.size) * 2;
    if (isNamespace(callee)) {
      const genericAlias = this.genericAliasStates.get(callee);
      if (genericAlias !== undefined) {
        callee = genericAlias.origin;
        cycles += 2;
      }
    }
    if (
      callee === this.setBuiltin &&
      keywords.size === 0 &&
      positional.length === 1 &&
      isManagedIterableSource(positional[0]!)
    ) {
      return this.materializeSet(
        positional[0],
        operation.span,
        _context,
        cycles,
      );
    }
    if (
      callee === this.iterBuiltin &&
      keywords.size === 0 &&
      positional.length === 2
    ) {
      return this.createCallableIterator(
        positional[0]!,
        positional[1]!,
        operation.span,
        cycles,
      );
    }
    if (isClass(callee)) {
      return this.callClass(
        callee,
        positional,
        keywords,
        operation.span,
        cycles,
      );
    }
    let callable: RuntimeValue = callee;
    if (isBoundMethod(callable)) {
      if (
        positional.length + keywords.size >=
        this.options.limits.maxCollectionSize
      ) {
        throw new VmLimitError("expanded arguments", operation.span);
      }
      positional.unshift(callable.receiver);
      callable = callable.callable;
      cycles += 2;
    }
    if (
      typeof callable !== "object" ||
      callable === null ||
      callable.kind !== "native_function"
    )
      throw new VmRuntimeError(
        "TypeError",
        `${formatValue(callable)} is not callable`,
        operation.span,
      );
    if (callable === this.superBuiltin) {
      const value = this.createSuper(positional, keywords, operation.span);
      this.push(value, operation.span);
      return continued(cycles + 8);
    }
    if (
      callable === this.objectGetattributeBuiltin ||
      callable === this.getattrBuiltin
    ) {
      const builtin = callable === this.getattrBuiltin;
      const validCount = builtin
        ? positional.length === 2 || positional.length === 3
        : positional.length === 2;
      if (
        keywords.size > 0 ||
        !validCount ||
        (!builtin && !isInstance(positional[0]!)) ||
        typeof positional[1] !== "string"
      ) {
        throw new VmRuntimeError(
          "TypeError",
          builtin
            ? "getattr expects an object, attribute name, and optional default"
            : "object.__getattribute__ expects an instance and attribute name",
          operation.span,
        );
      }
      if (builtin) {
        return this.loadAttributeOperation(
          positional[0]!,
          positional[1],
          _context,
          operation.span,
          cycles,
          positional.length === 3
            ? { defaultValue: positional[2]!, hasDefault: true }
            : undefined,
        );
      }
      const receiver = positional[0]!;
      if (!isInstance(receiver)) {
        throw new VmRuntimeError(
          "RuntimeError",
          "validated object receiver was lost",
        );
      }
      return this.loadDefaultInstanceAttributeOperation(
        receiver,
        positional[1],
        _context,
        operation.span,
        cycles,
      );
    }
    if (
      callable === this.objectSetattrBuiltin ||
      callable === this.setattrBuiltin
    ) {
      if (
        keywords.size > 0 ||
        positional.length !== 3 ||
        (callable === this.objectSetattrBuiltin &&
          !isInstance(positional[0]!)) ||
        typeof positional[1] !== "string"
      ) {
        throw new VmRuntimeError(
          "TypeError",
          callable === this.setattrBuiltin
            ? "setattr expects an object, attribute name, and value"
            : "object.__setattr__ expects an instance, attribute name, and value",
          operation.span,
        );
      }
      if (callable === this.setattrBuiltin) {
        return this.storeAttributeOperation(
          positional[0]!,
          positional[1],
          positional[2]!,
          _context,
          operation.span,
          cycles,
          true,
        );
      }
      const receiver = positional[0]!;
      if (!isInstance(receiver)) {
        throw new VmRuntimeError(
          "RuntimeError",
          "validated object receiver was lost",
        );
      }
      return this.storeDefaultInstanceAttributeOperation(
        receiver,
        positional[1],
        positional[2]!,
        _context,
        operation.span,
        cycles,
        true,
      );
    }
    if (
      callable === this.objectDelattrBuiltin ||
      callable === this.delattrBuiltin
    ) {
      if (
        keywords.size > 0 ||
        positional.length !== 2 ||
        (callable === this.objectDelattrBuiltin &&
          !isInstance(positional[0]!)) ||
        typeof positional[1] !== "string"
      ) {
        throw new VmRuntimeError(
          "TypeError",
          callable === this.delattrBuiltin
            ? "delattr expects an object and attribute name"
            : "object.__delattr__ expects an instance and attribute name",
          operation.span,
        );
      }
      if (callable === this.delattrBuiltin) {
        return this.deleteAttributeOperation(
          positional[0]!,
          positional[1],
          _context,
          operation.span,
          cycles,
          true,
        );
      }
      const receiver = positional[0]!;
      if (!isInstance(receiver)) {
        throw new VmRuntimeError(
          "RuntimeError",
          "validated object receiver was lost",
        );
      }
      return this.deleteDefaultInstanceAttributeOperation(
        receiver,
        positional[1],
        _context,
        operation.span,
        cycles,
        true,
      );
    }
    const managed = this.callables.get(callable);
    if (
      callable === this.iterBuiltin &&
      keywords.size === 0 &&
      positional.length === 1 &&
      isInstance(positional[0]!)
    ) {
      return this.acquireUserIterator(
        positional[0],
        _context,
        operation.span,
        cycles,
      );
    }
    if (
      callable === this.nextBuiltin &&
      keywords.size === 0 &&
      positional.length >= 1 &&
      positional.length <= 2 &&
      isSequenceIterator(positional[0]!)
    ) {
      return this.callSequenceIteratorNext(
        positional[0],
        {
          defaultValue: positional[1] ?? null,
          hasDefault: positional.length === 2,
          kind: "next",
          span: operation.span,
        },
        _context,
        operation.span,
        cycles,
      );
    }
    if (callable === this.nextBuiltin && isGenerator(positional[0]!)) {
      if (keywords.size > 0 || positional.length < 1 || positional.length > 2) {
        throw new VmRuntimeError(
          "TypeError",
          "next expects one or two positional arguments",
          operation.span,
        );
      }
      return this.resumeGenerator(
        positional[0],
        {
          defaultValue: positional[1] ?? null,
          hasDefault: positional.length === 2,
          kind: "next",
        },
        null,
        _context,
        operation.span,
        cycles,
      );
    }
    if (
      callable === this.nextBuiltin &&
      keywords.size === 0 &&
      positional.length >= 1 &&
      positional.length <= 2 &&
      isInstance(positional[0]!)
    ) {
      return this.callUserIteratorNext(
        positional[0],
        {
          defaultValue: positional[1] ?? null,
          hasDefault: positional.length === 2,
          kind: "next",
          span: operation.span,
        },
        _context,
        operation.span,
        cycles,
      );
    }
    if (callable === this.sendBuiltin) {
      if (
        keywords.size > 0 ||
        positional.length !== 2 ||
        (!isGenerator(positional[0]!) && !isCoroutine(positional[0]!))
      ) {
        throw new VmRuntimeError(
          "TypeError",
          "send expects one positional argument",
          operation.span,
        );
      }
      return isCoroutine(positional[0])
        ? this.resumeCoroutine(
            positional[0],
            _context,
            operation.span,
            cycles,
            { defaultValue: null, hasDefault: false, kind: "next" },
            positional[1],
          )
        : this.resumeGenerator(
            positional[0],
            { defaultValue: null, hasDefault: false, kind: "next" },
            positional[1]!,
            _context,
            operation.span,
            cycles,
          );
    }
    if (callable === this.throwBuiltin) {
      if (
        keywords.size > 0 ||
        positional.length < 2 ||
        positional.length > 4 ||
        (!isGenerator(positional[0]!) && !isCoroutine(positional[0]!))
      ) {
        throw new VmRuntimeError(
          "TypeError",
          "throw expects one to three positional arguments",
          operation.span,
        );
      }
      const fault = generatorThrownFault(positional.slice(1), operation.span);
      return isCoroutine(positional[0])
        ? this.resumeCoroutine(
            positional[0],
            _context,
            operation.span,
            cycles,
            { kind: "throw" },
            null,
            undefined,
            fault,
          )
        : this.resumeGenerator(
            positional[0],
            { kind: "throw" },
            null,
            _context,
            operation.span,
            cycles,
            fault,
          );
    }
    if (callable === this.closeBuiltin) {
      if (
        keywords.size > 0 ||
        positional.length !== 1 ||
        (!isGenerator(positional[0]!) && !isCoroutine(positional[0]!))
      ) {
        throw new VmRuntimeError(
          "TypeError",
          "close expects no arguments",
          operation.span,
        );
      }
      if (isCoroutine(positional[0])) {
        return this.closeCoroutine(positional[0], operation.span, cycles);
      }
      const exitValue = exceptionValue("GeneratorExit", "");
      return this.resumeGenerator(
        positional[0],
        { kind: "close" },
        null,
        _context,
        operation.span,
        cycles,
        new VmRuntimeError("GeneratorExit", "", operation.span, exitValue),
      );
    }
    if (
      (callable === this.exceptionGroupSubgroupBuiltin ||
        callable === this.exceptionGroupSplitBuiltin) &&
      keywords.size === 0 &&
      positional.length === 2 &&
      isExceptionGroupValue(positional[0]!) &&
      !isExceptionTypeCondition(positional[1]!) &&
      this.isManagedExceptionGroupPredicate(positional[1]!)
    ) {
      return this.startExceptionGroupPredicate(
        positional[0],
        positional[1]!,
        callable === this.exceptionGroupSplitBuiltin,
        operation.span,
        _context,
        cycles,
      );
    }
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

    const result = callable.call(positional, keywords);
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

  private createSuper(
    positional: readonly RuntimeValue[],
    keywords: ReadonlyMap<string, RuntimeValue>,
    span: SourceSpan,
  ): RuntimeNamespace {
    if (keywords.size > 0 || positional.length > 2) {
      throw new VmRuntimeError(
        "TypeError",
        "super expects zero, one, or two positional arguments",
        span,
      );
    }
    let startClass: RuntimeValue | undefined;
    let receiver: RuntimeValue | undefined;
    if (positional.length === 0) {
      const frame = this.frame();
      const cell = frame.classCell;
      if (cell === undefined) {
        throw new VmRuntimeError(
          "RuntimeError",
          "super(): __class__ cell not found",
          span,
        );
      }
      if (!cell.initialized) {
        throw new VmRuntimeError(
          "RuntimeError",
          "super(): empty __class__ cell",
          span,
        );
      }
      if (frame.firstArgument === undefined) {
        throw new VmRuntimeError("RuntimeError", "super(): no arguments", span);
      }
      startClass = cell.value;
      receiver = frame.firstArgument;
    } else {
      startClass = positional[0];
      receiver = positional[1];
    }
    if (!isClass(startClass)) {
      throw new VmRuntimeError(
        "TypeError",
        "super first argument must be a class",
        span,
      );
    }
    let boundReceiver: RuntimeClass | RuntimeInstance | null = null;
    let receiverClass: RuntimeClass | null = null;
    if (receiver !== undefined) {
      if (isInstance(receiver)) {
        boundReceiver = receiver;
        receiverClass = receiver.classObject;
      } else if (isClass(receiver)) {
        boundReceiver = receiver;
        receiverClass = receiver;
      } else {
        throw new VmRuntimeError(
          "TypeError",
          "super second argument must be an instance or subclass",
          span,
        );
      }
      if (!classIsSubclass(receiverClass, startClass)) {
        throw new VmRuntimeError(
          "TypeError",
          "super second argument is not an instance or subclass of the first",
          span,
        );
      }
    }
    const value: RuntimeNamespace = {
      kind: "namespace",
      name: "super",
      values: new Map(),
    };
    this.superStates.set(value, {
      receiver: boundReceiver,
      receiverClass,
      startClass,
    });
    this.heapAccounting.preflightAdditionalValue(value);
    return value;
  }

  private callClass(
    classObject: RuntimeClass,
    positional: readonly RuntimeValue[],
    keywords: ReadonlyMap<string, RuntimeValue>,
    span: SourceSpan,
    cycles: number,
  ): Cs486SyscallResult {
    const descriptor = lookupClassAttribute(classObject, "__new__");
    if (descriptor === undefined) {
      throw new VmRuntimeError(
        "TypeError",
        `${classObject.name} has no __new__ constructor`,
        span,
      );
    }
    const wrapper = isNamespace(descriptor)
      ? this.descriptorWrappers.get(descriptor)
      : undefined;
    if (wrapper?.kind === "property") {
      throw new VmRuntimeError(
        "TypeError",
        `${classObject.name}.__new__ is not callable`,
        span,
      );
    }
    const constructor = wrapper?.callable ?? descriptor;
    if (constructor === this.objectNewBuiltin) {
      return this.initializeConstructedInstance(
        this.allocateInstance(classObject),
        positional,
        keywords,
        span,
        cycles + 2,
        false,
      );
    }
    if (!isNativeFunction(constructor)) {
      throw new VmRuntimeError(
        "TypeError",
        `${classObject.name}.__new__ is not callable`,
        span,
      );
    }
    const managed = this.callables.get(constructor);
    if (managed?.kind !== "python") {
      throw new VmRuntimeError(
        "TypeError",
        `${classObject.name}.__new__ must be a Python method in this profile`,
        span,
      );
    }
    const constructorState: ConstructorCallState = {
      classObject,
      keywords,
      positional,
      span,
    };
    const constructorArguments =
      wrapper?.kind === "classmethod"
        ? [classObject, classObject, ...positional]
        : [classObject, ...positional];
    return this.callPython(
      managed,
      constructorArguments,
      keywords,
      span,
      cycles,
      undefined,
      undefined,
      constructorState,
    );
  }

  private allocateInstance(classObject: RuntimeClass): RuntimeInstance {
    const instance: RuntimeInstance = {
      classObject,
      kind: "instance",
      values: new Map(),
    };
    this.heapAccounting.preflightAdditionalValue(instance);
    this.noteAllocation(48);
    return instance;
  }

  private callObjectNew(
    positional: readonly RuntimeValue[],
    keywords: ReadonlyMap<string, RuntimeValue>,
  ): RuntimeInstance {
    if (
      keywords.size > 0 ||
      positional.length !== 1 ||
      !isClass(positional[0])
    ) {
      throw new VmRuntimeError(
        "TypeError",
        "object.__new__ expects exactly one class argument",
      );
    }
    return this.allocateInstance(positional[0]);
  }

  private constructorRoots(
    state: ConstructorCallState | PendingConstructorCompletion,
  ): readonly RuntimeValue[] {
    return [
      state.classObject,
      ...state.positional,
      ...[...state.keywords].flatMap(([name, value]) => [name, value]),
      ...("result" in state ? [state.result] : []),
    ];
  }

  private continueClassConstruction(
    state: PendingConstructorCompletion,
    cycles: number,
  ): Cs486SyscallResult {
    if (
      !isInstance(state.result) ||
      !classIsSubclass(state.result.classObject, state.classObject)
    ) {
      this.push(state.result, state.span);
      return continued(cycles + 2);
    }
    return this.initializeConstructedInstance(
      state.result,
      state.positional,
      state.keywords,
      state.span,
      cycles + 2,
      true,
    );
  }

  private initializeConstructedInstance(
    instance: RuntimeInstance,
    positional: readonly RuntimeValue[],
    keywords: ReadonlyMap<string, RuntimeValue>,
    span: SourceSpan,
    cycles: number,
    customNew: boolean,
  ): Cs486SyscallResult {
    const initializer = lookupClassAttribute(instance.classObject, "__init__");
    if (initializer === undefined) {
      if (!customNew && (positional.length > 0 || keywords.size > 0)) {
        throw new VmRuntimeError(
          "TypeError",
          `${instance.classObject.name} accepts no arguments`,
          span,
        );
      }
      this.push(instance, span);
      return continued(cycles);
    }
    if (initializer === this.objectInitBuiltin) {
      if (!customNew && (positional.length > 0 || keywords.size > 0)) {
        throw new VmRuntimeError(
          "TypeError",
          `${instance.classObject.name} accepts no arguments`,
          span,
        );
      }
      this.push(instance, span);
      return continued(cycles + 2);
    }
    if (
      typeof initializer !== "object" ||
      initializer === null ||
      initializer.kind !== "native_function"
    ) {
      throw new VmRuntimeError(
        "TypeError",
        `${instance.classObject.name}.__init__ is not callable`,
        span,
      );
    }
    const managed = this.callables.get(initializer);
    if (managed?.kind !== "python") {
      throw new VmRuntimeError(
        "TypeError",
        `${instance.classObject.name}.__init__ must be a Python method in this profile`,
        span,
      );
    }
    const result = this.callPython(
      managed,
      [instance, ...positional],
      keywords,
      span,
      cycles,
      instance,
    );
    return result;
  }

  private createCallableIterator(
    callable: RuntimeValue,
    sentinel: RuntimeValue,
    span: SourceSpan,
    cycles: number,
  ): Cs486SyscallResult {
    const target = isBoundMethod(callable) ? callable.callable : callable;
    if (!isClass(callable) && !isNativeFunction(target)) {
      throw new VmRuntimeError(
        "TypeError",
        "iter(callable, sentinel) requires a callable first argument",
        span,
      );
    }
    const iterator: RuntimeInstance = {
      classObject: this.callableIteratorClass,
      kind: "instance",
      values: new Map([
        ["_callable", callable],
        ["_sentinel", sentinel],
        ["_exhausted", false],
      ]),
    };
    this.heapAccounting.preflightAdditionalValue(iterator);
    this.push(iterator, span);
    return continued(cycles + 6);
  }

  private routeFault(
    fault: VmRuntimeError,
    context: Cs486SyscallContext,
    cycles = 16,
  ): Cs486SyscallResult {
    this.pendingControl = undefined;
    let routedFault = fault;
    for (;;) {
      const generatorMarkerIndex = this.callMarkers.findLastIndex(
        (marker) => marker.kind === "generator",
      );
      const generatorMarker = this.callMarkers[generatorMarkerIndex];
      const protocolMarkerIndex = this.callMarkers.findLastIndex(
        (marker) => marker.kind === "python" && marker.protocol !== undefined,
      );
      const protocolMarker = this.callMarkers[protocolMarkerIndex];
      const nextHandler = this.exceptionHandlers.at(-1);
      if (
        protocolMarker?.kind === "python" &&
        protocolMarker.protocol !== undefined &&
        protocolMarkerIndex > generatorMarkerIndex &&
        (nextHandler === undefined ||
          nextHandler.callMarkerDepth <= protocolMarkerIndex)
      ) {
        const escaped = this.escapeIteratorProtocolFault(
          protocolMarkerIndex,
          protocolMarker,
          routedFault,
          context,
          cycles,
        );
        if (escaped.result !== undefined) return escaped.result;
        routedFault = escaped.fault;
        continue;
      }
      if (
        generatorMarker?.kind === "generator" &&
        (nextHandler === undefined ||
          nextHandler.callMarkerDepth <= generatorMarkerIndex)
      ) {
        const escaped = this.escapeGeneratorFault(
          generatorMarkerIndex,
          generatorMarker,
          routedFault,
          context,
          cycles,
        );
        if (escaped.result !== undefined) return escaped.result;
        routedFault = escaped.fault;
        continue;
      }
      if (nextHandler === undefined) break;
      const handler = this.exceptionHandlers.pop()!;
      this.rollbackCalls(handler.callMarkerDepth);
      this.stack.length = handler.stackDepth;
      this.frames.length = handler.frameDepth;
      this.callMarkers.length = handler.callMarkerDepth;
      this.activeFaults.length = handler.activeFaultDepth;
      context.writeRegister("esp", handler.machineStackPointer);
      if (handler.starExitTarget !== undefined) {
        return this.beginExceptStar(handler, routedFault, context, cycles);
      }
      const matched = handler.handlers.find(({ typeNames }) =>
        exceptionMatchesAny(typeNames, routedFault.typeName),
      );
      if (matched !== undefined) {
        this.activeFaults.push(routedFault);
        if (matched.captureFault === true) {
          this.push(caughtFaultValue(routedFault));
        }
        if (matched.name !== undefined && matched.binding !== undefined) {
          this.storeName(
            matched.binding,
            matched.name,
            caughtFaultValue(routedFault),
            undefined,
          );
        }
        return jumpTo(matched.target, cycles);
      }
      if (handler.finallyTarget !== undefined) {
        this.pendingControl = { error: routedFault, kind: "fault" };
        return jumpTo(handler.finallyTarget, cycles);
      }
    }
    this.rollbackCalls(0);
    throw routedFault;
  }

  private beginExceptStar(
    handler: RuntimeExceptionHandler,
    fault: VmRuntimeError,
    context: Cs486SyscallContext,
    cycles: number,
  ): Cs486SyscallResult {
    const value = caughtFaultValue(fault);
    const wrappedOrdinary = !isExceptionGroupValue(value);
    const remaining = !wrappedOrdinary
      ? value
      : createExceptionGroupValue(
          "BaseExceptionGroup",
          "",
          [value],
          this.options.limits.maxCollectionSize,
        );
    const state: RuntimeNamespace = {
      kind: "namespace",
      name: "<except* state>",
      values: new Map<string, RuntimeValue>([
        ["original", remaining],
        ["raised", { kind: "list", values: [] }],
        ["reraised", { kind: "list", values: [] }],
        ["remaining", remaining],
        ["wrappedOrdinary", wrappedOrdinary],
      ]),
    };
    this.heapAccounting.preflightAdditionalValue(state);
    this.exceptStarStates.set(state, {
      activeFaultDepth: handler.activeFaultDepth,
      finallyTarget: handler.finallyTarget,
      handlers: handler.handlers,
      nextHandler: 0,
      span: fault.span ?? emptySpan(),
      starExitTarget: handler.starExitTarget!,
    });
    this.noteAllocation(160);
    return this.dispatchExceptStar(state, context, cycles + 8);
  }

  private completeExceptStarHandler(
    faulted: boolean,
    span: SourceSpan,
    context: Cs486SyscallContext,
    cycles: number,
  ): Cs486SyscallResult {
    const raised = faulted ? this.pop(span) : undefined;
    const state = this.pop(span);
    if (!isNamespace(state) || !this.exceptStarStates.has(state)) {
      throw new VmRuntimeError(
        "RuntimeError",
        "except* handler lost its continuation state",
        span,
      );
    }
    const metadata = this.exceptStarStates.get(state)!;
    this.activeFaults.length = metadata.activeFaultDepth;
    if (raised !== undefined) {
      const current = state.values.get("current");
      const values =
        raised === current
          ? requireExceptStarList(state, "reraised", span)
          : requireExceptStarList(state, "raised", span);
      this.checkCollection(values.length + 1, span);
      values.push(raised);
      try {
        this.heapAccounting.preflightAdditionalValue(state);
      } catch (error) {
        values.pop();
        throw error;
      }
    }
    state.values.delete("current");
    return this.dispatchExceptStar(state, context, cycles + 8);
  }

  private dispatchExceptStar(
    state: RuntimeNamespace,
    context: Cs486SyscallContext,
    cycles: number,
  ): Cs486SyscallResult {
    const metadata = this.exceptStarStates.get(state);
    if (metadata === undefined) {
      throw new VmRuntimeError(
        "RuntimeError",
        "except* continuation state is not active",
        emptySpan(),
      );
    }
    while (metadata.nextHandler < metadata.handlers.length) {
      const handler = metadata.handlers[metadata.nextHandler++]!;
      const remaining = state.values.get("remaining") ?? null;
      if (remaining === null) continue;
      const typeNames = handler.typeNames ?? [];
      if (
        typeNames.includes("BaseExceptionGroup") ||
        typeNames.includes("ExceptionGroup")
      ) {
        const invalid = exceptionValue(
          "TypeError",
          "catching ExceptionGroup with except* is not allowed; use except instead",
        );
        const invalidFaults = requireExceptStarList(
          state,
          "raised",
          metadata.span,
        );
        this.checkCollection(invalidFaults.length + 1, metadata.span);
        const previousRemaining = state.values.get("remaining") ?? null;
        state.values.set("remaining", null);
        invalidFaults.push(invalid);
        try {
          this.heapAccounting.preflightAdditionalValue(state);
        } catch (error) {
          invalidFaults.pop();
          state.values.set("remaining", previousRemaining);
          throw error;
        }
        continue;
      }
      const [matched, rest] = splitExceptionValue(
        remaining,
        typeNames,
        this.options.limits.maxCollectionSize,
      );
      const previousRemaining = state.values.get("remaining") ?? null;
      state.values.set("remaining", rest);
      if (matched === null) continue;
      state.values.set("current", matched);
      try {
        this.heapAccounting.preflightAdditionalValue(state);
      } catch (error) {
        state.values.delete("current");
        state.values.set("remaining", previousRemaining);
        throw error;
      }
      this.push(state, metadata.span);
      const matchedFault = faultFromValue(matched, metadata.span);
      this.activeFaults.push(matchedFault);
      if (handler.name !== undefined && handler.binding !== undefined) {
        this.storeName(handler.binding, handler.name, matched, metadata.span);
      }
      return jumpTo(handler.target, cycles + 12);
    }

    this.exceptStarStates.delete(state);
    this.activeFaults.length = metadata.activeFaultDepth;
    const raised = requireExceptStarList(state, "raised", metadata.span);
    const reraised = requireExceptStarList(state, "reraised", metadata.span);
    const remaining = state.values.get("remaining") ?? null;
    const original = state.values.get("original") ?? null;
    let preserved =
      original === null
        ? remaining
        : mergeOriginalExceptionSubgroups(
            original,
            remaining === null ? reraised : [...reraised, remaining],
            this.options.limits.maxCollectionSize,
          );
    if (state.values.get("wrappedOrdinary") === true && preserved !== null) {
      preserved = unwrapSingleExceptionGroup(preserved);
    }
    const faults = preserved === null ? [...raised] : [...raised, preserved];
    if (faults.length === 0) {
      return jumpTo(metadata.starExitTarget, cycles + 4);
    }
    const merged =
      faults.length === 1
        ? faults[0]!
        : createExceptionGroupValue(
            "BaseExceptionGroup",
            "",
            faults,
            this.options.limits.maxCollectionSize,
          );
    this.heapAccounting.preflightAdditionalValue(merged);
    const mergedFault = faultFromValue(merged, metadata.span);
    if (metadata.finallyTarget !== undefined) {
      this.pendingControl = { error: mergedFault, kind: "fault" };
      return jumpTo(metadata.finallyTarget, cycles + faults.length * 4);
    }
    return this.routeFault(mergedFault, context, cycles + faults.length * 4);
  }

  private escapeIteratorProtocolFault(
    markerIndex: number,
    marker: Extract<CallMarker, { kind: "python" }>,
    fault: VmRuntimeError,
    context: Cs486SyscallContext,
    cycles: number,
  ): { readonly fault: VmRuntimeError; readonly result?: Cs486SyscallResult } {
    const protocol = marker.protocol;
    if (protocol === undefined) return { fault };
    this.rollbackCalls(markerIndex + 1);
    const frame = this.frames[protocol.frameBaseDepth];
    if (frame?.kind !== "function") {
      throw new VmRuntimeError(
        "RuntimeError",
        "escaping iterator protocol call has no active frame",
      );
    }
    this.stack.length = frame.stackBase;
    this.frames.length = protocol.frameBaseDepth;
    this.callMarkers.length = markerIndex;
    this.exceptionHandlers.length = protocol.exceptionHandlerBaseDepth;
    this.activeFaults.length = protocol.activeFaultBaseDepth;
    this.pendingControl = marker.callerPendingControl;
    context.writeRegister("esp", protocol.machineStackPointer);
    if (protocol.owner.kind === "set_name") {
      if (this.classCompletionStack.at(-1) !== protocol.owner.state) {
        throw new VmRuntimeError(
          "RuntimeError",
          "faulting class name notification lost its completion owner",
        );
      }
      this.abandonClassCompletion(protocol.owner.state);
      this.classCompletionStack.pop();
      return { fault };
    }
    if (
      protocol.owner.kind === "annotations" ||
      protocol.owner.kind === "lazy_type"
    ) {
      protocol.owner.state.evaluating = false;
      return { fault };
    }
    if (protocol.owner.kind === "generic_default") {
      const current =
        protocol.owner.state.defaults[protocol.owner.state.defaultIndex];
      if (current !== undefined) current.evaluating = false;
      return { fault };
    }
    if (
      protocol.owner.kind === "attribute_hook_get" &&
      fault.typeName === "AttributeError"
    ) {
      if (protocol.owner.phase === "getattr" && protocol.owner.hasDefault) {
        this.push(protocol.owner.defaultValue, protocol.owner.span);
        return { fault, result: { cycles, kind: "return" } };
      }
      if (protocol.owner.phase === "getattribute") {
        const result = this.startAttributeFallback(
          protocol.owner.instance,
          protocol.owner.name,
          {
            defaultValue: protocol.owner.defaultValue,
            hasDefault: protocol.owner.hasDefault,
          },
          context,
          protocol.owner.span,
          cycles,
          protocol.machineStackPointer,
          true,
        );
        return result === undefined ? { fault } : { fault, result };
      }
    }
    if (
      protocol.owner.kind === "attribute_get" &&
      protocol.owner.fallbackName !== undefined &&
      fault.typeName === "AttributeError"
    ) {
      if (!isInstance(protocol.owner.instance)) {
        if (protocol.owner.hasFallbackDefault) {
          this.push(protocol.owner.fallbackDefault, protocol.owner.span);
          return { fault, result: { cycles, kind: "return" } };
        }
        return { fault };
      }
      const result = this.startAttributeFallback(
        protocol.owner.instance,
        protocol.owner.fallbackName,
        {
          defaultValue: protocol.owner.fallbackDefault,
          hasDefault: protocol.owner.hasFallbackDefault,
        },
        context,
        protocol.owner.span,
        cycles,
        protocol.machineStackPointer,
        true,
      );
      return result === undefined ? { fault } : { fault, result };
    }
    if (
      protocol.owner.kind === "sequence_next" &&
      (fault.typeName === "IndexError" || fault.typeName === "StopIteration")
    ) {
      protocol.owner.iterator.exhausted = true;
      const result = this.completeSequenceIteratorExhaustion(
        protocol.owner.consumer,
        context,
        cycles,
        true,
      );
      return result === undefined
        ? {
            fault: new VmRuntimeError(
              "StopIteration",
              "",
              "span" in protocol.owner.consumer
                ? protocol.owner.consumer.span
                : protocol.owner.consumer.state.span,
            ),
          }
        : { fault, result };
    }
    if (
      protocol.owner.kind === "sequence_next" &&
      protocol.owner.consumer.kind === "materialize"
    ) {
      this.activeMaterializations.delete(protocol.owner.consumer.state);
      return { fault };
    }
    if (
      protocol.owner.kind === "materialize_get_iter" ||
      (protocol.owner.kind === "materialize_next" &&
        fault.typeName !== "StopIteration")
    ) {
      this.activeMaterializations.delete(protocol.owner.state);
      return { fault };
    }
    if (
      protocol.owner.kind === "materialize_next" &&
      fault.typeName === "StopIteration"
    ) {
      return {
        fault,
        result: this.completeMaterializationSource(
          protocol.owner.state,
          context,
          cycles,
        ),
      };
    }
    if (fault.typeName !== "StopIteration") return { fault };
    if (protocol.owner.kind === "sequence_next") return { fault };
    if (protocol.owner.kind === "for_iter") {
      if (this.peek(protocol.owner.span) !== protocol.owner.iterator) {
        throw new VmRuntimeError(
          "RuntimeError",
          "completed user iterator loop cursor is missing",
          protocol.owner.span,
        );
      }
      this.pop(protocol.owner.span);
      context.writeRegister("eax", 0);
      return { fault, result: { cycles, kind: "return" } };
    }
    if (protocol.owner.kind === "yield_from") {
      if (this.peek(protocol.owner.span) !== protocol.owner.iterator) {
        throw new VmRuntimeError(
          "RuntimeError",
          "completed yield-from iterator is missing",
          protocol.owner.span,
        );
      }
      this.pop(protocol.owner.span);
      this.push(stopIterationResult(fault), protocol.owner.span);
      context.writeRegister("eax", 0);
      return { fault, result: { cycles, kind: "return" } };
    }
    if (protocol.owner.kind === "next" && protocol.owner.hasDefault) {
      this.push(protocol.owner.defaultValue, protocol.owner.span);
      return { fault, result: { cycles, kind: "return" } };
    }
    return { fault };
  }

  private escapeGeneratorFault(
    markerIndex: number,
    marker: Extract<CallMarker, { kind: "generator" }>,
    fault: VmRuntimeError,
    context: Cs486SyscallContext,
    cycles: number,
  ): { readonly fault: VmRuntimeError; readonly result?: Cs486SyscallResult } {
    this.rollbackCalls(markerIndex + 1);
    this.callMarkers.length = markerIndex + 1;
    this.frames.length = marker.frameBaseDepth + 1;
    const frame = this.frames[marker.frameBaseDepth];
    if (frame?.kind !== "function") {
      throw new VmRuntimeError(
        "RuntimeError",
        "escaping generator fault has no active frame",
      );
    }
    this.exceptionHandlers.length = marker.exceptionHandlerBaseDepth;
    this.stack.length = frame.stackBase;
    this.frames.length = marker.frameBaseDepth;
    this.callMarkers.length = markerIndex;
    this.activeFaults.length = marker.activeFaultBaseDepth;
    marker.generator.state = "closed";
    this.deleteSuspendedState(marker.generator);
    if (marker.owner.kind === "materialize") {
      this.activeMaterializations.delete(marker.owner.state);
    }
    if (isAsyncGenerator(marker.generator)) {
      this.pendingControl = marker.callerPendingControl;
      context.writeRegister("esp", marker.machineStackPointer);
      if (
        marker.owner.kind === "async_for_iter" &&
        marker.owner.operation !== undefined
      ) {
        marker.owner.operation.state = "closed";
      }
      if (marker.owner.kind === "async_generator_operation") {
        marker.owner.operation.state = "closed";
        if (
          marker.owner.operation.operation === "close" &&
          fault.typeName === "GeneratorExit"
        ) {
          this.push(null);
          return { fault, result: { cycles, kind: "return" } };
        }
      }
      if (
        fault.typeName === "StopIteration" ||
        fault.typeName === "StopAsyncIteration"
      ) {
        const message = `async generator raised ${fault.typeName}`;
        return {
          fault: new VmRuntimeError(
            "RuntimeError",
            message,
            fault.span,
            exceptionValue("RuntimeError", message),
          ),
        };
      }
      return { fault };
    }
    if (marker.owner.kind === "close" && fault.typeName === "GeneratorExit") {
      this.pendingControl = marker.callerPendingControl;
      this.push(null);
      context.writeRegister("esp", marker.machineStackPointer);
      return { fault, result: { cycles, kind: "return" } };
    }
    if (
      marker.owner.kind === "async_for_iter" &&
      fault.typeName === "StopAsyncIteration"
    ) {
      if (this.peek(marker.owner.span) !== marker.owner.iterator) {
        throw new VmRuntimeError(
          "RuntimeError",
          "completed async iterator loop cursor is missing",
          marker.owner.span,
        );
      }
      this.pop(marker.owner.span);
      this.pendingControl = marker.callerPendingControl;
      context.writeRegister("esp", marker.machineStackPointer);
      context.writeRegister("eax", 0);
      return { fault, result: { cycles, kind: "return" } };
    }
    this.pendingControl = undefined;
    if (fault.typeName !== "StopIteration") return { fault };
    const message = isCoroutine(marker.generator)
      ? "coroutine raised StopIteration"
      : "generator raised StopIteration";
    const convertedValue = exceptionValue("RuntimeError", message);
    return {
      fault: new VmRuntimeError(
        "RuntimeError",
        message,
        fault.span,
        convertedValue,
      ),
    };
  }

  private rollbackCalls(retainedMarkerCount: number): void {
    for (const marker of this.callMarkers.slice(retainedMarkerCount)) {
      if (
        marker.kind === "python" &&
        (marker.protocol?.owner.kind === "materialize_get_iter" ||
          marker.protocol?.owner.kind === "materialize_next")
      ) {
        this.activeMaterializations.delete(marker.protocol.owner.state);
      }
      if (marker.kind === "generator") {
        if (marker.owner.kind === "materialize") {
          this.activeMaterializations.delete(marker.owner.state);
        }
        marker.generator.state = "closed";
        this.deleteSuspendedState(marker.generator);
        continue;
      }
      if (marker.kind !== "module") continue;
      this.moduleStates[marker.moduleId] = { kind: "unloaded" };
    }
  }

  private applyControlAction(
    action:
      | { readonly kind: "return"; readonly value: RuntimeValue }
      | { readonly kind: "jump"; readonly target: TargetReference },
    context: Cs486SyscallContext,
    cycles: number,
  ): Cs486SyscallResult {
    if (action.kind === "jump") return jumpTo(action.target, cycles);
    const frameDepth = this.frames.length;
    const frame = this.frames.pop();
    const marker = this.callMarkers.pop();
    if (
      frame?.kind !== "function" ||
      (marker?.kind !== "python" && marker?.kind !== "generator")
    )
      throw new VmRuntimeError("RuntimeError", "function return has no caller");
    while (
      this.exceptionHandlers.at(-1)?.frameDepth !== undefined &&
      this.exceptionHandlers.at(-1)!.frameDepth >= frameDepth
    )
      this.exceptionHandlers.pop();
    this.stack.length = frame.stackBase;
    if (marker.kind === "generator") {
      this.activeFaults.length = marker.activeFaultBaseDepth;
      this.pendingControl = marker.callerPendingControl;
      marker.generator.state = "closed";
      this.deleteSuspendedState(marker.generator);
      if (isAsyncGenerator(marker.generator)) {
        context.writeRegister("esp", marker.machineStackPointer);
        if (marker.owner.kind === "async_for_iter") {
          if (marker.owner.operation !== undefined) {
            marker.owner.operation.state = "closed";
          }
          if (this.peek(marker.owner.span) !== marker.owner.iterator) {
            throw new VmRuntimeError(
              "RuntimeError",
              "completed async generator loop cursor is missing",
              marker.owner.span,
            );
          }
          this.pop(marker.owner.span);
          context.writeRegister("eax", 0);
          return { cycles, kind: "return" };
        }
        if (marker.owner.kind === "async_generator_operation") {
          marker.owner.operation.state = "closed";
          if (marker.owner.operation.operation === "close") {
            this.push(null);
            return { cycles, kind: "return" };
          }
          throw new VmRuntimeError("StopAsyncIteration", "");
        }
        throw new VmRuntimeError(
          "RuntimeError",
          "async generator completion has no asynchronous owner",
        );
      }
      if (marker.owner.kind === "await") {
        if (!isCoroutine(marker.generator)) {
          throw new VmRuntimeError(
            "RuntimeError",
            "await completion does not own a coroutine",
          );
        }
        this.push(action.value);
        context.writeRegister("esp", marker.machineStackPointer);
        return { cycles, kind: "return" };
      }
      if (marker.owner.kind === "await_iterator") {
        if (!isGenerator(marker.generator)) {
          throw new VmRuntimeError(
            "RuntimeError",
            "custom await completion does not own an iterator",
          );
        }
        this.push(action.value);
        context.writeRegister("esp", marker.machineStackPointer);
        return { cycles, kind: "return" };
      }
      if (marker.owner.kind === "async_for_iter") {
        if (!isCoroutine(marker.generator)) {
          throw new VmRuntimeError(
            "RuntimeError",
            "async iterator completion does not own a coroutine",
          );
        }
        if (this.peek(marker.owner.span) !== marker.owner.iterator) {
          throw new VmRuntimeError(
            "RuntimeError",
            "async iterator loop cursor is missing",
            marker.owner.span,
          );
        }
        this.push(action.value, marker.owner.span);
        context.writeRegister("esp", marker.machineStackPointer);
        context.writeRegister("eax", 1);
        return { cycles, kind: "return" };
      }
      if (marker.owner.kind === "materialize") {
        context.writeRegister("esp", marker.owner.state.machineStackPointer);
        return this.completeMaterializationSource(
          marker.owner.state,
          context,
          cycles,
        );
      }
      if (marker.owner.kind === "close") {
        this.push(action.value);
        return { cycles, kind: "return" };
      }
      if (marker.owner.kind === "yield_from") {
        if (marker.owner.closingFault !== undefined) {
          throw marker.owner.closingFault;
        }
        if (this.peek() !== marker.generator) {
          throw new VmRuntimeError(
            "RuntimeError",
            "completed yield-from delegate is missing",
          );
        }
        this.pop();
        this.push(action.value);
        context.writeRegister("eax", 0);
        return { cycles, kind: "return" };
      }
      if (marker.owner.kind === "for_iter") {
        if (this.peek() !== marker.generator) {
          throw new VmRuntimeError(
            "RuntimeError",
            "completed generator loop cursor is missing",
          );
        }
        this.pop();
        context.writeRegister("eax", 0);
        return { cycles, kind: "return" };
      }
      if (marker.owner.kind === "next" && marker.owner.hasDefault) {
        this.push(marker.owner.defaultValue);
        return { cycles, kind: "return" };
      }
      throw new VmRuntimeError(
        "StopIteration",
        action.value === null ? "" : formatValue(action.value),
        undefined,
        action.value,
      );
    }
    this.pendingControl = marker.callerPendingControl;
    if (marker.initializer !== undefined && action.value !== null) {
      throw new VmRuntimeError("TypeError", "__init__() should return None");
    }
    if (marker.constructor !== undefined) {
      this.pendingConstructorCompletion = {
        ...marker.constructor,
        result: action.value,
      };
      return { cycles, kind: "return" };
    }
    if (marker.protocol !== undefined) {
      return this.completeIteratorProtocol(
        marker.protocol.owner,
        action.value,
        context,
        cycles,
      );
    }
    this.push(marker.initializer ?? action.value);
    return { cycles, kind: "return" };
  }

  private callPython(
    callable: Extract<ManagedCallable, { kind: "python" }>,
    positional: readonly RuntimeValue[],
    keywords: ReadonlyMap<string, RuntimeValue>,
    span: SourceSpan,
    cycles: number,
    initializer?: RuntimeInstance,
    iteratorProtocol?: {
      readonly machineStackPointer: number;
      readonly owner: IteratorProtocolOwner;
    },
    constructor?: ConstructorCallState,
  ): Cs486SyscallResult {
    const { parameters } = callable.descriptor;
    const positionalParameters = parameters.filter(
      ({ kind }) =>
        kind === "positional_only" || kind === "positional_or_keyword",
    );
    const keywordParameters = new Map(
      parameters
        .filter(
          ({ kind }) =>
            kind === "positional_or_keyword" || kind === "keyword_only",
        )
        .map((parameter) => [parameter.name, parameter]),
    );
    const positionalOnlyNames = new Set(
      parameters
        .filter(({ kind }) => kind === "positional_only")
        .map(({ name }) => name),
    );
    const variadicPositional = parameters.find(
      ({ kind }) => kind === "variadic_positional",
    );
    const variadicKeyword = parameters.find(
      ({ kind }) => kind === "variadic_keyword",
    );
    if (
      positional.length > positionalParameters.length &&
      variadicPositional === undefined
    )
      throw new VmRuntimeError(
        "TypeError",
        "Too many positional arguments",
        span,
      );
    const locals = new Map<string, RuntimeValue>(
      callable.annotationLocals?.entries(),
    );
    const cells = new Map(callable.closure);
    const cellNames = new Set(callable.descriptor.cellNames);
    for (const name of cellNames) {
      if (!cells.has(name))
        cells.set(name, { initialized: false, value: null });
    }
    const boundParameters = new Set<string>();
    const bindParameter = (name: string, value: RuntimeValue): void => {
      if (cellNames.has(name)) {
        const cell = cells.get(name)!;
        cell.initialized = true;
        cell.value = value;
      } else {
        locals.set(name, value);
      }
      boundParameters.add(name);
    };
    positional
      .slice(0, positionalParameters.length)
      .forEach((value, index) =>
        bindParameter(positionalParameters[index]!.name, value),
      );
    let bindingAllocationBytes = 0;
    if (variadicPositional !== undefined) {
      const values = positional.slice(positionalParameters.length);
      bindParameter(variadicPositional.name, { kind: "tuple", values });
      bindingAllocationBytes += 32 + values.length * 8;
    }
    const keywordRemainder = new Map<RuntimeValue, RuntimeValue>();
    for (const [name, value] of keywords) {
      const parameter = keywordParameters.get(name);
      if (parameter !== undefined) {
        if (boundParameters.has(name)) {
          throw new VmRuntimeError(
            "TypeError",
            `Multiple values for argument ${name}`,
            span,
          );
        }
        bindParameter(name, value);
      } else if (variadicKeyword !== undefined) {
        keywordRemainder.set(name, value);
      } else if (positionalOnlyNames.has(name)) {
        throw new VmRuntimeError(
          "TypeError",
          `Positional-only argument ${name} was passed by keyword`,
          span,
        );
      } else {
        throw new VmRuntimeError(
          "TypeError",
          `Unexpected keyword argument ${name}`,
          span,
        );
      }
    }
    if (variadicKeyword !== undefined) {
      bindParameter(variadicKeyword.name, {
        entries: keywordRemainder,
        kind: "dictionary",
      });
      bindingAllocationBytes += 48 + keywordRemainder.size * 24;
    }
    parameters.forEach((parameter) => {
      if (
        !boundParameters.has(parameter.name) &&
        parameter.defaultIndex !== undefined
      ) {
        bindParameter(
          parameter.name,
          callable.defaults[parameter.defaultIndex]!,
        );
      }
    });
    const missing = parameters.find(
      ({ kind, name }) =>
        kind !== "variadic_positional" &&
        kind !== "variadic_keyword" &&
        !boundParameters.has(name),
    );
    if (missing !== undefined)
      throw new VmRuntimeError(
        "TypeError",
        `Missing required argument ${missing.name}`,
        span,
      );
    const frame: RuntimeFrame = {
      annotations: callable.annotationState,
      classCell: callable.classCell,
      cells,
      firstArgument: positional[0],
      globals: callable.globals,
      kind: "function",
      locals,
      moduleId: callable.moduleId,
      stackBase: this.stack.length,
    };
    if (callable.descriptor.asyncGenerator) {
      if (initializer !== undefined) {
        throw new VmRuntimeError(
          "TypeError",
          "__init__ cannot be an async generator function in this profile",
          span,
        );
      }
      const generator: RuntimeAsyncGenerator = {
        kind: "async_generator",
        name: callable.descriptor.name,
        state: "created",
      };
      this.asyncGenerators.set(generator, {
        activeFaults: [],
        exceptionHandlers: [],
        frame: { ...frame, stackBase: 0 },
        pendingControl: undefined,
        resumeTarget: callable.descriptor.target,
        stackValues: [],
      });
      this.push(generator, span);
      this.noteAllocation(64 + bindingAllocationBytes);
      return continued(cycles);
    }
    if (callable.descriptor.coroutine) {
      if (initializer !== undefined) {
        throw new VmRuntimeError(
          "TypeError",
          "__init__ cannot be a coroutine function in this profile",
          span,
        );
      }
      const coroutine: RuntimeCoroutine = {
        kind: "coroutine",
        name: callable.descriptor.name,
        state: "created",
      };
      this.coroutines.set(coroutine, {
        activeFaults: [],
        exceptionHandlers: [],
        frame: { ...frame, stackBase: 0 },
        pendingControl: undefined,
        resumeTarget: callable.descriptor.target,
        stackValues: [],
      });
      this.push(coroutine, span);
      this.noteAllocation(64 + bindingAllocationBytes);
      return continued(cycles);
    }
    if (callable.descriptor.generator) {
      if (initializer !== undefined) {
        throw new VmRuntimeError(
          "TypeError",
          "__init__ cannot be a generator function in this profile",
          span,
        );
      }
      const generator: RuntimeGenerator = {
        kind: "generator",
        name: callable.descriptor.name,
        state: "created",
      };
      this.generators.set(generator, {
        activeFaults: [],
        exceptionHandlers: [],
        frame: { ...frame, stackBase: 0 },
        pendingControl: undefined,
        resumeTarget: callable.descriptor.target,
        stackValues: [],
      });
      this.push(generator, span);
      this.noteAllocation(64 + bindingAllocationBytes);
      return continued(cycles);
    }
    if (
      this.frames.filter(({ kind }) => kind === "function").length >=
      this.options.limits.maxCallDepth
    ) {
      throw new VmLimitError("call depth", span);
    }
    this.frames.push(frame);
    const callerPendingControl = this.pendingControl;
    this.pendingControl = undefined;
    this.callMarkers.push({
      callerPendingControl,
      constructor,
      initializer,
      kind: "python",
      protocol:
        iteratorProtocol === undefined
          ? undefined
          : {
              activeFaultBaseDepth: this.activeFaults.length,
              exceptionHandlerBaseDepth: this.exceptionHandlers.length,
              frameBaseDepth: this.frames.length - 1,
              machineStackPointer: iteratorProtocol.machineStackPointer,
              owner: iteratorProtocol.owner,
            },
    });
    this.noteAllocation(bindingAllocationBytes);
    return { cycles, kind: "call", target: callable.descriptor.target };
  }

  private callUserIterator(
    instance: RuntimeInstance,
    context: Cs486SyscallContext,
    span: SourceSpan,
    cycles: number,
  ): Cs486SyscallResult {
    const callable = this.pythonSpecialMethod(instance, "__iter__", span);
    const result = this.callPython(
      callable,
      [instance],
      new Map(),
      span,
      cycles,
      undefined,
      callable.descriptor.generator
        ? undefined
        : {
            machineStackPointer: context.readRegister("esp") - 4,
            owner: { kind: "get_iter", span },
          },
    );
    if (callable.descriptor.generator) {
      this.requireIterator(this.peek(span), span);
    }
    return result;
  }

  private acquireUserIterator(
    instance: RuntimeInstance,
    context: Cs486SyscallContext,
    span: SourceSpan,
    cycles: number,
  ): Cs486SyscallResult {
    if (lookupClassAttribute(instance.classObject, "__iter__") !== undefined) {
      return this.callUserIterator(instance, context, span, cycles);
    }
    const iterator = this.createSequenceIterator(instance, span);
    this.push(iterator, span);
    return continued(cycles);
  }

  private acquireUserAsyncIterator(
    instance: RuntimeInstance,
    context: Cs486SyscallContext,
    span: SourceSpan,
    cycles: number,
  ): Cs486SyscallResult {
    const callable = this.pythonSpecialMethod(instance, "__aiter__", span);
    if (callable.descriptor.coroutine || callable.descriptor.generator) {
      throw new VmRuntimeError(
        "TypeError",
        "__aiter__ must return an asynchronous iterator directly",
        span,
      );
    }
    return this.callPython(
      callable,
      [instance],
      new Map(),
      span,
      cycles,
      undefined,
      {
        machineStackPointer: context.readRegister("esp") - 4,
        owner: { kind: "async_get_iter", span },
      },
    );
  }

  private acquireAwaitIterator(
    instance: RuntimeInstance,
    context: Cs486SyscallContext,
    span: SourceSpan,
    cycles: number,
  ): Cs486SyscallResult {
    const callable = this.pythonSpecialMethod(instance, "__await__", span);
    if (callable.descriptor.coroutine) {
      throw new VmRuntimeError(
        "TypeError",
        "__await__ returned a coroutine instead of an iterator",
        span,
      );
    }
    const machineStackPointer = context.readRegister("esp") - 4;
    const result = this.callPython(
      callable,
      [instance],
      new Map(),
      span,
      cycles,
      undefined,
      callable.descriptor.generator
        ? undefined
        : {
            machineStackPointer,
            owner: { kind: "await_result", machineStackPointer, span },
          },
    );
    if (!callable.descriptor.generator) return result;
    const iterator = this.pop(span);
    if (!isGenerator(iterator)) {
      throw new VmRuntimeError(
        "TypeError",
        "__await__ returned a non-iterator",
        span,
      );
    }
    return this.resumeGenerator(
      iterator,
      { kind: "await_iterator" },
      null,
      context,
      span,
      cycles,
      undefined,
      machineStackPointer,
    );
  }

  private callUserAsyncIteratorNext(
    iterator: RuntimeInstance,
    context: Cs486SyscallContext,
    span: SourceSpan,
    cycles: number,
  ): Cs486SyscallResult {
    const callable = this.pythonSpecialMethod(iterator, "__anext__", span);
    const machineStackPointer = context.readRegister("esp") - 4;
    const result = this.callPython(
      callable,
      [iterator],
      new Map(),
      span,
      cycles,
      undefined,
      callable.descriptor.coroutine
        ? undefined
        : {
            machineStackPointer,
            owner: {
              iterator,
              kind: "async_next_result",
              machineStackPointer,
              span,
            },
          },
    );
    if (!callable.descriptor.coroutine) return result;
    const awaitable = this.pop(span);
    if (!isCoroutine(awaitable)) {
      throw new VmRuntimeError(
        "TypeError",
        "__anext__ returned a non-awaitable",
        span,
      );
    }
    return this.resumeCoroutine(
      awaitable,
      context,
      span,
      cycles,
      { iterator, kind: "async_for_iter", span },
      null,
      machineStackPointer,
    );
  }

  private createSequenceIterator(
    instance: RuntimeInstance,
    span: SourceSpan,
  ): RuntimeSequenceIterator {
    if (
      lookupClassAttribute(instance.classObject, "__getitem__") === undefined
    ) {
      throw new VmRuntimeError(
        "TypeError",
        `${instance.classObject.name} is not iterable`,
        span,
      );
    }
    const iterator: RuntimeSequenceIterator = {
      exhausted: false,
      index: 0n,
      kind: "sequence_iterator",
      sequence: instance,
    };
    this.noteAllocation(48);
    return iterator;
  }

  private callSequenceIteratorNext(
    iterator: RuntimeSequenceIterator,
    consumer: Extract<
      IteratorProtocolOwner,
      { kind: "sequence_next" }
    >["consumer"],
    context: Cs486SyscallContext,
    span: SourceSpan,
    cycles: number,
    machineStackPointer = context.readRegister("esp") - 4,
  ): Cs486SyscallResult {
    if (iterator.exhausted) {
      const result = this.completeSequenceIteratorExhaustion(
        consumer,
        context,
        cycles,
        false,
      );
      if (result !== undefined) return result;
      throw new VmRuntimeError("StopIteration", "", span);
    }
    const callable = this.pythonSpecialMethod(
      iterator.sequence,
      "__getitem__",
      span,
    );
    const result = this.callPython(
      callable,
      [iterator.sequence, iterator.index],
      new Map(),
      span,
      cycles,
      undefined,
      callable.descriptor.generator
        ? undefined
        : {
            machineStackPointer,
            owner: { consumer, iterator, kind: "sequence_next" },
          },
    );
    if (callable.descriptor.generator) {
      const value = this.pop(span);
      iterator.index += 1n;
      return this.completeSequenceIteratorValue(
        consumer,
        value,
        context,
        cycles,
        false,
      );
    }
    if (consumer.kind === "materialize" && result.kind === "call") {
      consumer.state.returnToCaller = true;
    }
    return result;
  }

  private completeSequenceIteratorValue(
    consumer: Extract<
      IteratorProtocolOwner,
      { kind: "sequence_next" }
    >["consumer"],
    value: RuntimeValue,
    context: Cs486SyscallContext,
    cycles: number,
    returnToCaller = true,
  ): Cs486SyscallResult {
    if (consumer.kind === "materialize") {
      this.acceptMaterializedValue(consumer.state, value);
      return this.advanceMaterializationIterator(
        consumer.state,
        context,
        cycles,
      );
    }
    this.push(value, consumer.span);
    if (consumer.kind === "for_iter" || consumer.kind === "yield_from") {
      context.writeRegister("eax", 1);
    }
    return returnToCaller ? { cycles, kind: "return" } : continued(cycles);
  }

  private completeSequenceIteratorExhaustion(
    consumer: Extract<
      IteratorProtocolOwner,
      { kind: "sequence_next" }
    >["consumer"],
    context: Cs486SyscallContext,
    cycles: number,
    returnToCaller: boolean,
  ): Cs486SyscallResult | undefined {
    if (consumer.kind === "materialize") {
      return this.completeMaterializationSource(
        consumer.state,
        context,
        cycles,
      );
    }
    if (consumer.kind === "next") {
      if (consumer.hasDefault) {
        this.push(consumer.defaultValue, consumer.span);
        return returnToCaller ? { cycles, kind: "return" } : continued(cycles);
      }
      return undefined;
    }
    if (this.peek(consumer.span) !== consumer.iterator) {
      throw new VmRuntimeError(
        "RuntimeError",
        "completed sequence iterator cursor is missing",
        consumer.span,
      );
    }
    this.pop(consumer.span);
    if (consumer.kind === "yield_from") this.push(null, consumer.span);
    context.writeRegister("eax", 0);
    return returnToCaller ? { cycles, kind: "return" } : continued(cycles);
  }

  private callUserIteratorNext(
    instance: RuntimeInstance,
    owner: Extract<
      IteratorProtocolOwner,
      { kind: "for_iter" | "next" | "yield_from" }
    >,
    context: Cs486SyscallContext,
    span: SourceSpan,
    cycles: number,
  ): Cs486SyscallResult {
    const callable = this.pythonSpecialMethod(instance, "__next__", span);
    const result = this.callPython(
      callable,
      [instance],
      new Map(),
      span,
      cycles,
      undefined,
      callable.descriptor.generator
        ? undefined
        : {
            machineStackPointer: context.readRegister("esp") - 4,
            owner,
          },
    );
    if (
      callable.descriptor.generator &&
      (owner.kind === "for_iter" || owner.kind === "yield_from")
    ) {
      context.writeRegister("eax", 1);
    }
    return result;
  }

  private pythonSpecialMethod(
    instance: RuntimeInstance,
    name:
      | "__aiter__"
      | "__anext__"
      | "__await__"
      | "__getitem__"
      | "__iter__"
      | "__next__",
    span: SourceSpan,
  ): Extract<ManagedCallable, { kind: "python" }> {
    const value = lookupClassAttribute(instance.classObject, name);
    if (
      typeof value !== "object" ||
      value === null ||
      value.kind !== "native_function"
    ) {
      throw new VmRuntimeError(
        "TypeError",
        `${instance.classObject.name} does not define callable ${name}`,
        span,
      );
    }
    const callable = this.callables.get(value);
    if (callable?.kind !== "python") {
      throw new VmRuntimeError(
        "TypeError",
        `${instance.classObject.name} does not define callable ${name}`,
        span,
      );
    }
    return callable;
  }

  private requireIterator(
    value: RuntimeValue,
    span: SourceSpan,
  ): asserts value is
    | RuntimeGenerator
    | RuntimeInstance
    | RuntimeIterator
    | RuntimeSequenceIterator {
    if (isGenerator(value) || isIterator(value) || isSequenceIterator(value))
      return;
    if (isInstance(value)) {
      this.pythonSpecialMethod(value, "__next__", span);
      return;
    }
    throw new VmRuntimeError(
      "TypeError",
      "__iter__ returned a non-iterator",
      span,
    );
  }

  private completeIteratorProtocol(
    owner: IteratorProtocolOwner,
    value: RuntimeValue,
    context: Cs486SyscallContext,
    cycles: number,
  ): Cs486SyscallResult {
    if (owner.kind === "attribute_get") {
      this.push(value, owner.span);
      return { cycles, kind: "return" };
    }
    if (owner.kind === "attribute_hook_get") {
      this.push(value, owner.span);
      return { cycles, kind: "return" };
    }
    if (owner.kind === "attribute_set") {
      if (owner.returnsValue) this.push(null, owner.span);
      return { cycles, kind: "return" };
    }
    if (owner.kind === "attribute_delete") {
      if (owner.returnsValue) this.push(null, owner.span);
      return { cycles, kind: "return" };
    }
    if (owner.kind === "attribute_hook_set") {
      if (owner.returnsValue) this.push(null, owner.span);
      return { cycles, kind: "return" };
    }
    if (owner.kind === "attribute_hook_delete") {
      if (owner.returnsValue) this.push(null, owner.span);
      return { cycles, kind: "return" };
    }
    if (owner.kind === "set_name") {
      return { cycles: cycles + 4, kind: "return" };
    }
    if (owner.kind === "exception_group_predicate") {
      return this.completeExceptionGroupPredicate(
        owner.state,
        value,
        context,
        cycles,
      );
    }
    if (owner.kind === "await_result") {
      if (!isGenerator(value)) {
        throw new VmRuntimeError(
          "TypeError",
          "__await__ returned a non-iterator",
          owner.span,
        );
      }
      return this.resumeGenerator(
        value,
        { kind: "await_iterator" },
        null,
        context,
        owner.span,
        cycles,
        undefined,
        owner.machineStackPointer,
      );
    }
    if (owner.kind === "async_get_iter") {
      if (
        !isAsyncGenerator(value) &&
        (!isInstance(value) ||
          lookupClassAttribute(value.classObject, "__anext__") === undefined)
      ) {
        throw new VmRuntimeError(
          "TypeError",
          "__aiter__ returned a non-asynchronous iterator",
          owner.span,
        );
      }
      this.push(value, owner.span);
      return { cycles, kind: "return" };
    }
    if (owner.kind === "async_next_result") {
      if (!isCoroutine(value) && !isAsyncGeneratorOperation(value)) {
        throw new VmRuntimeError(
          "TypeError",
          "__anext__ returned a non-awaitable",
          owner.span,
        );
      }
      return isCoroutine(value)
        ? this.resumeCoroutine(
            value,
            context,
            owner.span,
            cycles,
            {
              iterator: owner.iterator,
              kind: "async_for_iter",
              span: owner.span,
            },
            null,
            owner.machineStackPointer,
          )
        : this.resumeAsyncGeneratorOperation(
            value,
            context,
            owner.span,
            cycles,
            {
              iterator: owner.iterator,
              kind: "async_for_iter",
              span: owner.span,
            },
            owner.machineStackPointer,
          );
    }
    if (owner.kind === "generic_default") {
      const current = owner.state.defaults[owner.state.defaultIndex];
      if (current === undefined) {
        throw new VmRuntimeError(
          "RuntimeError",
          "generic default completion has no active evaluator",
          owner.state.span,
        );
      }
      current.evaluating = false;
      this.heapAccounting.preflightAdditionalValue(value);
      current.cache = value;
      return this.evaluateNextGenericDefault(owner.state, context, cycles + 4);
    }
    if (owner.kind === "lazy_type") {
      owner.state.evaluating = false;
      this.heapAccounting.preflightAdditionalValue(value);
      owner.state.cache = value;
      this.push(value, owner.span);
      return { cycles, kind: "return" };
    }
    if (owner.kind === "annotations") {
      owner.state.evaluating = false;
      if (!isDictionary(value)) {
        throw new VmRuntimeError(
          "TypeError",
          "annotation evaluator must return a dictionary",
          owner.span,
        );
      }
      this.heapAccounting.preflightAdditionalValue(value);
      this.push(value, owner.span);
      if (owner.state.cacheable) owner.state.cache = value;
      return { cycles, kind: "return" };
    }
    if (owner.kind === "sequence_next") {
      owner.iterator.index += 1n;
      return this.completeSequenceIteratorValue(
        owner.consumer,
        value,
        context,
        cycles,
      );
    }
    const span = "span" in owner ? owner.span : owner.state.span;
    if (owner.kind === "materialize_get_iter") {
      this.requireIterator(value, span);
      owner.state.currentIterator = value;
      return this.advanceMaterializationIterator(owner.state, context, cycles);
    }
    if (owner.kind === "materialize_next") {
      this.acceptMaterializedValue(owner.state, value);
      return this.advanceMaterializationIterator(owner.state, context, cycles);
    }
    if (owner.kind === "get_iter") this.requireIterator(value, span);
    this.push(value, span);
    if (owner.kind === "for_iter" || owner.kind === "yield_from")
      context.writeRegister("eax", 1);
    return { cycles, kind: "return" };
  }

  private deleteSuspendedState(
    value: RuntimeAsyncGenerator | RuntimeCoroutine | RuntimeGenerator,
  ): void {
    if (isCoroutine(value)) this.coroutines.delete(value);
    else if (isAsyncGenerator(value)) this.asyncGenerators.delete(value);
    else this.generators.delete(value);
  }

  private closeCoroutine(
    coroutine: RuntimeCoroutine,
    span: SourceSpan,
    cycles: number,
  ): Cs486SyscallResult {
    if (coroutine.state === "running") {
      throw new VmRuntimeError(
        "RuntimeError",
        "cannot close a running coroutine",
        span,
      );
    }
    coroutine.state = "closed";
    this.coroutines.delete(coroutine);
    this.push(null, span);
    return continued(cycles);
  }

  private resumeCoroutine(
    coroutine: RuntimeCoroutine,
    context: Cs486SyscallContext,
    span: SourceSpan,
    cycles: number,
    owner: GeneratorResumeOwner = { kind: "await" },
    sentValue: RuntimeValue = null,
    callerMachineStackPointer?: number,
    injectedFault?: VmRuntimeError,
  ): Cs486SyscallResult {
    if (coroutine.state === "running") {
      throw new VmRuntimeError(
        "RuntimeError",
        "coroutine is already being awaited",
        span,
      );
    }
    if (coroutine.state === "closed") {
      throw new VmRuntimeError(
        "RuntimeError",
        "cannot reuse already awaited coroutine",
        span,
      );
    }
    if (sentValue !== null) {
      throw new VmRuntimeError(
        "TypeError",
        "can't send non-None value to a just-started coroutine",
        span,
      );
    }
    const state = this.coroutines.get(coroutine);
    if (state === undefined) {
      throw new VmRuntimeError(
        "RuntimeError",
        "coroutine has no resumable state",
        span,
      );
    }
    if (
      this.frames.filter(({ kind }) => kind === "function").length >=
      this.options.limits.maxCallDepth
    ) {
      throw new VmLimitError("call depth", span);
    }
    const frameBaseDepth = this.frames.length;
    const callMarkerBaseDepth = this.callMarkers.length;
    const exceptionHandlerBaseDepth = this.exceptionHandlers.length;
    const activeFaultBaseDepth = this.activeFaults.length;
    const callerPendingControl = this.pendingControl;
    const frame: RuntimeFrame = {
      ...state.frame,
      stackBase: this.stack.length,
    };
    try {
      state.frame = frame;
      coroutine.state = "running";
      this.frames.push(frame);
      this.callMarkers.push({
        activeFaultBaseDepth,
        callMarkerBaseDepth,
        callerPendingControl,
        exceptionHandlerBaseDepth,
        frameBaseDepth,
        generator: coroutine,
        injectedFault,
        kind: "generator",
        machineStackPointer:
          callerMachineStackPointer ?? context.readRegister("esp") - 4,
        owner,
      });
      this.pendingControl = state.pendingControl;
      state.pendingControl = undefined;
      return { cycles, kind: "call", target: state.resumeTarget };
    } catch (error: unknown) {
      this.stack.length = frame.stackBase;
      this.frames.length = frameBaseDepth;
      this.callMarkers.length = callMarkerBaseDepth;
      this.exceptionHandlers.length = exceptionHandlerBaseDepth;
      this.activeFaults.length = activeFaultBaseDepth;
      this.pendingControl = callerPendingControl;
      state.frame = { ...frame, stackBase: 0 };
      coroutine.state = "created";
      throw error;
    }
  }

  private resumeAsyncGeneratorOperation(
    operation: RuntimeAsyncGeneratorOperation,
    context: Cs486SyscallContext,
    span: SourceSpan,
    cycles: number,
    owner: GeneratorResumeOwner = {
      kind: "async_generator_operation",
      operation,
    },
    callerMachineStackPointer?: number,
  ): Cs486SyscallResult {
    if (operation.state === "running") {
      throw new VmRuntimeError(
        "RuntimeError",
        "async generator operation is already being awaited",
        span,
      );
    }
    if (operation.state === "closed") {
      throw new VmRuntimeError(
        "RuntimeError",
        "cannot reuse already awaited async generator operation",
        span,
      );
    }
    const sentValue =
      operation.operation === "send" ? operation.arguments[0]! : null;
    const injectedFault =
      operation.operation === "throw"
        ? generatorThrownFault(operation.arguments, span)
        : operation.operation === "close"
          ? new VmRuntimeError(
              "GeneratorExit",
              "",
              span,
              exceptionValue("GeneratorExit", ""),
            )
          : undefined;
    operation.state = "running";
    try {
      const resumeOwner =
        owner.kind === "async_for_iter" ? { ...owner, operation } : owner;
      return this.resumeGenerator(
        operation.generator,
        resumeOwner,
        sentValue,
        context,
        span,
        cycles,
        injectedFault,
        callerMachineStackPointer,
      );
    } catch (error: unknown) {
      if (operation.state === "running") operation.state = "created";
      throw error;
    }
  }

  private resumeGenerator(
    generator: RuntimeAsyncGenerator | RuntimeGenerator,
    owner: GeneratorResumeOwner,
    sentValue: RuntimeValue,
    context: Cs486SyscallContext,
    span: SourceSpan,
    cycles: number,
    injectedFault?: VmRuntimeError,
    callerMachineStackPointer?: number,
  ): Cs486SyscallResult {
    const asynchronous = isAsyncGenerator(generator);
    if (generator.state === "running") {
      throw new VmRuntimeError(
        "ValueError",
        asynchronous
          ? "async generator already executing"
          : "generator already executing",
        span,
      );
    }
    if (generator.state === "created" && sentValue !== null) {
      throw new VmRuntimeError(
        "TypeError",
        asynchronous
          ? "can't send non-None value to a just-started async generator"
          : "can't send non-None value to a just-started generator",
        span,
      );
    }
    if (
      owner.kind === "close" &&
      (generator.state === "created" || generator.state === "closed")
    ) {
      generator.state = "closed";
      this.deleteSuspendedState(generator);
      this.push(null, span);
      return continued(cycles);
    }
    if (
      owner.kind === "async_generator_operation" &&
      owner.operation.operation === "close" &&
      asynchronous &&
      (generator.state === "created" || generator.state === "closed")
    ) {
      generator.state = "closed";
      owner.operation.state = "closed";
      this.asyncGenerators.delete(generator);
      this.push(null, span);
      return continued(cycles);
    }
    if (generator.state === "closed") {
      if (owner.kind === "async_for_iter" && asynchronous) {
        if (owner.operation !== undefined) owner.operation.state = "closed";
        if (this.peek(span) !== generator) {
          throw new VmRuntimeError(
            "RuntimeError",
            "closed async generator loop cursor is missing",
            span,
          );
        }
        this.pop(span);
        context.writeRegister("eax", 0);
        return continued(cycles);
      }
      if (owner.kind === "async_generator_operation" && asynchronous) {
        owner.operation.state = "closed";
        if (owner.operation.operation === "close") {
          this.push(null, span);
          return continued(cycles);
        }
        throw new VmRuntimeError("StopAsyncIteration", "", span);
      }
      if (owner.kind === "throw") {
        if (injectedFault === undefined) {
          throw new VmRuntimeError(
            "RuntimeError",
            "generator.throw has no exception to inject",
            span,
          );
        }
        throw injectedFault;
      }
      if (owner.kind === "for_iter") {
        if (this.peek(span) !== generator) {
          throw new VmRuntimeError(
            "RuntimeError",
            "closed generator loop cursor is missing",
            span,
          );
        }
        this.pop(span);
        context.writeRegister("eax", 0);
        return continued(cycles);
      }
      if (owner.kind === "yield_from") {
        if (owner.closingFault !== undefined) throw owner.closingFault;
        if (injectedFault !== undefined) throw injectedFault;
        if (this.peek(span) !== generator) {
          throw new VmRuntimeError(
            "RuntimeError",
            "closed yield-from delegate is missing",
            span,
          );
        }
        this.pop(span);
        this.push(null, span);
        context.writeRegister("eax", 0);
        return continued(cycles);
      }
      if (owner.kind === "materialize") {
        return this.completeMaterializationSource(owner.state, context, cycles);
      }
      if (owner.kind === "next" && owner.hasDefault) {
        this.push(owner.defaultValue, span);
        return continued(cycles);
      }
      throw new VmRuntimeError("StopIteration", "", span);
    }
    const state = asynchronous
      ? this.asyncGenerators.get(generator)
      : this.generators.get(generator);
    if (state === undefined) {
      throw new VmRuntimeError(
        "RuntimeError",
        "generator has no resumable state",
        span,
      );
    }
    if (
      this.frames.filter(({ kind }) => kind === "function").length >=
      this.options.limits.maxCallDepth
    ) {
      throw new VmLimitError("call depth", span);
    }
    const wasSuspended = generator.state === "suspended";
    const previousGeneratorState = generator.state;
    const frameBaseDepth = this.frames.length;
    const callMarkerBaseDepth = this.callMarkers.length;
    const exceptionHandlerBaseDepth = this.exceptionHandlers.length;
    const activeFaultBaseDepth = this.activeFaults.length;
    const callerPendingControl = this.pendingControl;
    const savedStackValues = state.stackValues;
    const savedActiveFaults = state.activeFaults;
    const savedHandlers = state.exceptionHandlers;
    const savedPendingControl = state.pendingControl;
    const frame: RuntimeFrame = {
      ...state.frame,
      stackBase: this.stack.length,
    };
    try {
      state.frame = frame;
      generator.state = "running";
      this.frames.push(frame);
      this.callMarkers.push({
        activeFaultBaseDepth,
        callMarkerBaseDepth,
        callerPendingControl,
        exceptionHandlerBaseDepth,
        frameBaseDepth,
        generator,
        injectedFault,
        kind: "generator",
        machineStackPointer:
          callerMachineStackPointer ?? context.readRegister("esp") - 4,
        owner,
      });
      this.activeFaults.push(...savedActiveFaults);
      this.pendingControl = savedPendingControl;
      const resumedMachineStackPointer = context.readRegister("esp") - 4;
      for (const handler of savedHandlers) {
        this.exceptionHandlers.push({
          activeFaultDepth:
            activeFaultBaseDepth + handler.activeFaultDepthOffset,
          callMarkerDepth: callMarkerBaseDepth + handler.callMarkerDepthOffset,
          finallyTarget: handler.finallyTarget,
          frameDepth: frameBaseDepth + handler.frameDepthOffset,
          handlers: handler.handlers,
          machineStackPointer:
            resumedMachineStackPointer + handler.machineStackPointerOffset,
          starExitTarget: handler.starExitTarget,
          stackDepth: frame.stackBase + handler.stackDepthOffset,
        });
      }
      for (const value of savedStackValues) this.push(value, span);
      if (wasSuspended && injectedFault === undefined) {
        this.push(sentValue, span);
      }
      state.stackValues = [];
      state.activeFaults = [];
      state.exceptionHandlers = [];
      state.pendingControl = undefined;
      return { cycles, kind: "call", target: state.resumeTarget };
    } catch (error: unknown) {
      this.stack.length = frame.stackBase;
      this.frames.length = frameBaseDepth;
      this.callMarkers.length = callMarkerBaseDepth;
      this.exceptionHandlers.length = exceptionHandlerBaseDepth;
      this.activeFaults.length = activeFaultBaseDepth;
      this.pendingControl = callerPendingControl;
      state.frame = { ...frame, stackBase: 0 };
      state.stackValues = savedStackValues;
      state.activeFaults = savedActiveFaults;
      state.exceptionHandlers = savedHandlers;
      state.pendingControl = savedPendingControl;
      generator.state = previousGeneratorState;
      throw error;
    }
  }

  private stepYieldFrom(
    operation: Extract<PythonOperation, { kind: "yield_from_step" }>,
    context: Cs486SyscallContext,
    cycles: number,
  ): Cs486SyscallResult {
    const marker = this.callMarkers.at(-1);
    if (marker?.kind !== "generator" || marker.generator.state !== "running") {
      throw new VmRuntimeError(
        "RuntimeError",
        "yield from has no running generator",
        operation.span,
      );
    }
    const injectedFault = operation.hasInput ? marker.injectedFault : undefined;
    if (operation.hasInput) marker.injectedFault = undefined;
    const sentValue =
      operation.hasInput && injectedFault === undefined
        ? this.pop(operation.span)
        : null;
    const delegate = this.peek(operation.span);
    if (isGenerator(delegate)) {
      const delegatedFault =
        injectedFault?.typeName === "GeneratorExit"
          ? new VmRuntimeError(
              "GeneratorExit",
              injectedFault.message,
              operation.span,
              exceptionValue("GeneratorExit", injectedFault.message),
            )
          : injectedFault;
      const owner: GeneratorResumeOwner = {
        ...(injectedFault?.typeName === "GeneratorExit"
          ? { closingFault: injectedFault }
          : {}),
        kind: "yield_from",
      };
      return this.resumeGenerator(
        delegate,
        owner,
        sentValue,
        context,
        operation.span,
        cycles,
        delegatedFault,
      );
    }
    if (isInstance(delegate)) {
      if (injectedFault !== undefined) {
        this.pop(operation.span);
        throw injectedFault;
      }
      if (operation.hasInput && sentValue !== null) {
        this.pop(operation.span);
        throw new VmRuntimeError(
          "AttributeError",
          "iterator has no attribute send",
          operation.span,
        );
      }
      return this.callUserIteratorNext(
        delegate,
        {
          iterator: delegate,
          kind: "yield_from",
          span: operation.span,
        },
        context,
        operation.span,
        cycles,
      );
    }
    if (isSequenceIterator(delegate)) {
      if (injectedFault !== undefined) {
        this.pop(operation.span);
        throw injectedFault;
      }
      if (operation.hasInput && sentValue !== null) {
        this.pop(operation.span);
        throw new VmRuntimeError(
          "AttributeError",
          "iterator has no attribute send",
          operation.span,
        );
      }
      return this.callSequenceIteratorNext(
        delegate,
        {
          iterator: delegate,
          kind: "yield_from",
          span: operation.span,
        },
        context,
        operation.span,
        cycles,
      );
    }
    if (!isIterator(delegate)) {
      throw new VmRuntimeError(
        "RuntimeError",
        "yield from delegate is not an iterator",
        operation.span,
      );
    }
    if (injectedFault !== undefined) {
      this.pop(operation.span);
      throw injectedFault;
    }
    if (operation.hasInput && sentValue !== null) {
      this.pop(operation.span);
      throw new VmRuntimeError(
        "AttributeError",
        "iterator has no attribute send",
        operation.span,
      );
    }
    const step = nextIteratorValue(delegate);
    if (step.done) {
      this.pop(operation.span);
      this.push(null, operation.span);
      context.writeRegister("eax", 0);
    } else {
      this.push(step.value, operation.span);
      context.writeRegister("eax", 1);
    }
    return continued(cycles);
  }

  private suspendGenerator(
    operation: Extract<PythonOperation, { kind: "yield" }>,
    context: Cs486SyscallContext,
    cycles: number,
  ): Cs486SyscallResult {
    const yielded = this.pop(operation.span);
    const frame = this.frames.at(-1);
    const marker = this.callMarkers.at(-1);
    if (
      frame?.kind !== "function" ||
      marker?.kind !== "generator" ||
      (!isGenerator(marker.generator) && !isAsyncGenerator(marker.generator)) ||
      marker.generator.state !== "running"
    ) {
      throw new VmRuntimeError(
        "RuntimeError",
        "yield has no running generator",
        operation.span,
      );
    }
    if (
      !Number.isSafeInteger(operation.resumeTarget.target) ||
      operation.resumeTarget.target < 0
    ) {
      throw new VmRuntimeError(
        "ExecutableFormatError",
        "generator yield has no resume target",
        operation.span,
      );
    }
    const state = isAsyncGenerator(marker.generator)
      ? this.asyncGenerators.get(marker.generator)
      : this.generators.get(marker.generator);
    if (state === undefined) {
      throw new VmRuntimeError(
        "RuntimeError",
        "running generator has no state",
        operation.span,
      );
    }
    state.frame = { ...frame, stackBase: 0 };
    state.resumeTarget = operation.resumeTarget.target;
    state.stackValues = this.stack.slice(frame.stackBase);
    state.activeFaults = this.activeFaults.slice(marker.activeFaultBaseDepth);
    state.exceptionHandlers = this.exceptionHandlers
      .slice(marker.exceptionHandlerBaseDepth)
      .map((handler) => ({
        activeFaultDepthOffset:
          handler.activeFaultDepth - marker.activeFaultBaseDepth,
        callMarkerDepthOffset:
          handler.callMarkerDepth - marker.callMarkerBaseDepth,
        finallyTarget: handler.finallyTarget,
        frameDepthOffset: handler.frameDepth - marker.frameBaseDepth,
        handlers: handler.handlers,
        machineStackPointerOffset:
          handler.machineStackPointer - context.readRegister("esp"),
        starExitTarget: handler.starExitTarget,
        stackDepthOffset: handler.stackDepth - frame.stackBase,
      }));
    state.pendingControl = this.pendingControl;
    this.exceptionHandlers.length = marker.exceptionHandlerBaseDepth;
    this.activeFaults.length = marker.activeFaultBaseDepth;
    this.pendingControl = marker.callerPendingControl;
    this.frames.pop();
    this.callMarkers.pop();
    this.stack.length = frame.stackBase;
    marker.generator.state = "suspended";
    if (isAsyncGenerator(marker.generator)) {
      if (marker.owner.kind === "async_generator_operation") {
        marker.owner.operation.state = "closed";
        if (marker.owner.operation.operation === "close") {
          marker.generator.state = "closed";
          this.asyncGenerators.delete(marker.generator);
          throw new VmRuntimeError(
            "RuntimeError",
            "async generator ignored GeneratorExit",
            operation.span,
          );
        }
        this.push(yielded, operation.span);
        context.writeRegister("esp", marker.machineStackPointer);
        return { cycles, kind: "return" };
      }
      if (marker.owner.kind === "async_for_iter") {
        if (marker.owner.operation !== undefined) {
          marker.owner.operation.state = "closed";
        }
        this.push(yielded, operation.span);
        context.writeRegister("esp", marker.machineStackPointer);
        context.writeRegister("eax", 1);
        return { cycles, kind: "return" };
      }
      marker.generator.state = "closed";
      this.asyncGenerators.delete(marker.generator);
      throw new VmRuntimeError(
        "RuntimeError",
        "async generator resumed without an asynchronous owner",
        operation.span,
      );
    }
    if (marker.owner.kind === "materialize") {
      try {
        this.acceptMaterializedValue(marker.owner.state, yielded);
        return this.advanceMaterializationIterator(
          marker.owner.state,
          context,
          cycles,
        );
      } catch (error: unknown) {
        this.activeMaterializations.delete(marker.owner.state);
        context.writeRegister("esp", marker.owner.state.machineStackPointer);
        throw error;
      }
    }
    if (
      marker.owner.kind === "close" ||
      (marker.owner.kind === "yield_from" &&
        marker.owner.closingFault !== undefined)
    ) {
      marker.generator.state = "closed";
      this.generators.delete(marker.generator);
      throw new VmRuntimeError(
        "RuntimeError",
        "generator ignored GeneratorExit",
        operation.span,
      );
    }
    if (marker.owner.kind === "await_iterator") {
      marker.generator.state = "closed";
      this.generators.delete(marker.generator);
      throw new VmRuntimeError(
        "RuntimeError",
        "custom awaitable yielded without an asynchronous scheduler",
        operation.span,
      );
    }
    this.push(yielded, operation.span);
    if (marker.owner.kind === "for_iter" || marker.owner.kind === "yield_from")
      context.writeRegister("eax", 1);
    return { cycles, kind: "return" };
  }

  private makeClass(
    operation: Extract<PythonOperation, { kind: "make_class" }>,
    cycles: number,
  ): Cs486SyscallResult {
    const descriptor = this.options.classes[operation.classId];
    if (descriptor === undefined || descriptor.target < 0) {
      throw new VmRuntimeError(
        "ExecutableFormatError",
        "invalid Python class target",
        operation.span,
      );
    }
    if (operation.baseCount < 0) {
      throw new VmRuntimeError(
        "ExecutableFormatError",
        "invalid Python class base count",
        operation.span,
      );
    }
    if (operation.baseCount > maximumClassInheritanceDepth - 1) {
      throw new VmLimitError("class direct bases", operation.span);
    }
    const baseValues =
      operation.baseCount === 0
        ? [this.objectClass]
        : this.popMany(operation.baseCount, operation.span);
    const bases: RuntimeClass[] = [];
    for (const base of baseValues) {
      if (!isClass(base)) {
        throw new VmRuntimeError(
          "TypeError",
          "Class base must be a class",
          operation.span,
        );
      }
      bases.push(base);
    }
    const caller = this.frame();
    const cells = new Map<string, RuntimeCell>();
    for (const name of descriptor.freeNames) {
      const cell = this.closureCell(caller, name);
      if (cell === undefined) {
        throw new VmRuntimeError(
          "ExecutableFormatError",
          `missing class closure cell ${name}`,
          operation.span,
        );
      }
      cells.set(name, cell);
    }
    const locals = new Map<string, RuntimeValue>();
    const callerPendingControl = this.pendingControl;
    this.pendingControl = undefined;
    const classCell: RuntimeCell | undefined = descriptor.needsClassCell
      ? { initialized: false, value: null }
      : undefined;
    const classFrameBase: RuntimeFrame = {
      classCell,
      cells,
      globals: caller.globals,
      kind: "class",
      locals,
      moduleId: caller.moduleId,
      stackBase: this.stack.length,
    };
    const annotations = this.createManagedAnnotations(
      descriptor.annotationFunctionId,
      descriptor.annotationEntryCount,
      classFrameBase,
      false,
    );
    this.frames.push({ ...classFrameBase, annotations });
    this.callMarkers.push({
      bases,
      callerPendingControl,
      classId: operation.classId,
      kind: "class",
    });
    this.noteAllocation(
      32 + cells.size * 16 + (classCell === undefined ? 0 : 16),
    );
    return { cycles, kind: "call", target: descriptor.target };
  }

  private completeClass(
    operation: Extract<PythonOperation, { kind: "class_complete" }>,
    cycles: number,
  ): Cs486SyscallResult {
    const descriptor = this.options.classes[operation.classId];
    const frame = this.frames.at(-1);
    const marker = this.callMarkers.at(-1);
    if (
      descriptor === undefined ||
      frame?.kind !== "class" ||
      marker?.kind !== "class" ||
      marker.classId !== operation.classId
    ) {
      throw new VmRuntimeError(
        "RuntimeError",
        "class completion has no definition",
        operation.span,
      );
    }
    const bases = [...marker.bases];
    let automaticNewWrapperBytes = 0;
    const authoredNew = frame.locals.get("__new__");
    if (
      authoredNew !== undefined &&
      isNativeFunction(authoredNew) &&
      this.callables.get(authoredNew)?.kind === "python"
    ) {
      const wrapper: RuntimeNamespace = {
        kind: "namespace",
        name: "staticmethod",
        values: new Map([["__func__", authoredNew]]),
      };
      this.descriptorWrappers.set(wrapper, {
        callable: authoredNew,
        kind: "staticmethod",
      });
      frame.locals.set("__new__", wrapper);
      automaticNewWrapperBytes = 64;
    }
    const mro: RuntimeClass[] = [];
    const classObject: RuntimeClass = {
      base: bases[0] ?? null,
      bases,
      basesValue: { kind: "tuple", values: bases },
      kind: "class",
      mro,
      mroValue: { kind: "tuple", values: mro },
      name: descriptor.name,
      values: frame.locals,
    };
    mro.push(classObject, ...computeClassMroTail(bases, operation.span));
    if (frame.annotations !== undefined) {
      frame.annotations.cacheable = true;
      this.classAnnotations.set(classObject, frame.annotations);
    }
    this.frames.pop();
    this.callMarkers.pop();
    this.stack.length = frame.stackBase;
    try {
      this.heapAccounting.preflightAdditionalValue(classObject);
    } catch (error: unknown) {
      this.frames.push(frame);
      this.callMarkers.push(marker);
      throw error;
    }
    if (frame.classCell !== undefined) {
      frame.classCell.initialized = true;
      frame.classCell.value = classObject;
    }
    if (automaticNewWrapperBytes > 0)
      this.noteAllocation(automaticNewWrapperBytes);
    this.pendingControl = marker.callerPendingControl;
    this.classCompletionStack.push({
      classCell: frame.classCell,
      classId: operation.classId,
      classObject,
      entries: [...classObject.values.entries()],
      index: 0,
      span: operation.span,
    });
    return continued(cycles);
  }

  private descriptorProtocolRoots(
    owner: IteratorProtocolOwner,
  ): readonly RuntimeValue[] {
    if (owner.kind === "attribute_get") {
      return [
        owner.descriptor,
        owner.instance,
        owner.ownerClass,
        owner.fallbackDefault,
      ];
    }
    if (owner.kind === "attribute_set") {
      return [owner.descriptor, owner.instance, owner.value];
    }
    if (owner.kind === "attribute_delete") {
      return [owner.descriptor, owner.instance];
    }
    if (owner.kind === "attribute_hook_get") {
      return [owner.instance, owner.name, owner.defaultValue];
    }
    if (owner.kind === "attribute_hook_set") {
      return [owner.instance, owner.name, owner.value];
    }
    if (owner.kind === "attribute_hook_delete") {
      return [owner.instance, owner.name];
    }
    if (owner.kind === "set_name") {
      return [
        owner.state.classObject,
        ...owner.state.entries.map(([, descriptor]) => descriptor),
      ];
    }
    return [];
  }

  private stepSetName(
    operation: Extract<PythonOperation, { kind: "class_set_name_step" }>,
    context: Cs486SyscallContext,
    cycles: number,
  ): Cs486SyscallResult {
    const state = this.classCompletionStack.at(-1);
    if (state?.classId !== operation.classId) {
      throw new VmRuntimeError(
        "RuntimeError",
        "class name notification has no pending definition",
        operation.span,
      );
    }
    while (state.index < state.entries.length) {
      const [name, descriptor] = state.entries[state.index++]!;
      if (!isInstance(descriptor)) continue;
      const setName = lookupClassAttribute(
        descriptor.classObject,
        "__set_name__",
      );
      if (setName === undefined) continue;
      try {
        return this.callManagedProtocol(
          setName,
          [descriptor, state.classObject, name],
          { kind: "set_name", state },
          context,
          state.span,
          cycles + 6,
          context.readRegister("esp"),
        );
      } catch (error: unknown) {
        if (this.classCompletionStack.at(-1) === state) {
          this.abandonClassCompletion(state);
          this.classCompletionStack.pop();
        }
        throw error;
      }
    }
    this.classCompletionStack.pop();
    this.push(state.classObject, state.span);
    return jumpTo(operation.doneTarget, cycles);
  }

  private abandonClassCompletion(state: SetNameState): void {
    if (
      state.classCell?.initialized === true &&
      state.classCell.value === state.classObject
    ) {
      state.classCell.initialized = false;
      state.classCell.value = null;
    }
  }

  private importModule(
    operation: Extract<PythonOperation, { kind: "import" }>,
    cycles: number,
  ): Cs486SyscallResult {
    const imported = operation.imported;
    if (imported.kind === "builtin") {
      const module = this.builtinModule(imported.name);
      if (module === undefined)
        throw new VmRuntimeError(
          "ImportError",
          `Module ${imported.name} is unavailable`,
          operation.span,
        );
      this.storeImportBinding(operation, module);
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
      if (extension.parentModuleId !== undefined) {
        this.publishChildModule(
          extension.parentModuleId,
          extension.shortName,
          namespace,
          operation.span,
        );
      }
      this.storeImportBinding(operation, namespace);
      return continued(cycles + namespace.values.size * 2);
    }

    const state = this.moduleStates[imported.moduleId];
    if (state?.kind === "loaded" || state?.kind === "loading") {
      this.storeImportBinding(
        operation,
        this.boundPythonNamespace(operation, state.namespace),
      );
      return continued(cycles);
    }
    const module = this.options.modules[imported.moduleId];
    if (state === undefined || module === undefined || module.target < 0)
      throw new VmRuntimeError(
        "ImportError",
        `Module ${imported.name} is unavailable`,
        operation.span,
      );
    const caller = this.frame();
    const callerPendingControl = this.pendingControl;
    this.pendingControl = undefined;
    const globals = new Map<string, RuntimeValue>();
    initializeModuleGlobals(globals, module);
    const namespace: RuntimeNamespace = {
      kind: "namespace",
      name: module.name,
      values: globals,
    };
    this.moduleStates[imported.moduleId] = { kind: "loading", namespace };
    const moduleFrameBase: RuntimeFrame = {
      cells: new Map(),
      globals,
      kind: "module",
      locals: globals,
      moduleId: imported.moduleId,
      stackBase: this.stack.length,
    };
    const annotations = this.createManagedAnnotations(
      module.annotationFunctionId,
      module.annotationEntryCount,
      moduleFrameBase,
      false,
    );
    this.frames.push({ ...moduleFrameBase, annotations });
    this.namespaceAnnotations.set(namespace, annotations);
    this.callMarkers.push({
      alias: operation.alias,
      binding: operation.binding,
      bindModuleId: operation.bindModuleId,
      caller,
      callerPendingControl,
      kind: "module",
      moduleId: imported.moduleId,
    });
    return { cycles, kind: "call", target: module.target };
  }

  private completeModule(
    operation: Extract<PythonOperation, { kind: "module_complete" }>,
    cycles: number,
  ): Cs486SyscallResult {
    if (operation.moduleId === 0) {
      const state = this.moduleStates[0];
      if (state?.kind !== "loading") {
        throw new VmRuntimeError(
          "RuntimeError",
          "main module completion has no loading namespace",
          operation.span,
        );
      }
      this.moduleStates[0] = {
        kind: "loaded",
        namespace: state.namespace,
      };
      const annotations = this.namespaceAnnotations.get(state.namespace);
      if (annotations !== undefined) annotations.cacheable = true;
      return { cycles, kind: "complete", value: null };
    }
    const frame = this.frames.at(-1);
    const marker = this.callMarkers.at(-1);
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
    const state = this.moduleStates[operation.moduleId];
    if (state?.kind !== "loading" || state.namespace.values !== frame.globals) {
      throw new VmRuntimeError(
        "RuntimeError",
        "module completion has no loading namespace",
        operation.span,
      );
    }
    const namespace = state.namespace;
    if (module.parentModuleId !== undefined) {
      this.preflightChildModule(
        module.parentModuleId,
        module.shortName,
        operation.span,
      );
    }
    this.frames.pop();
    this.callMarkers.pop();
    this.moduleStates[operation.moduleId] = { kind: "loaded", namespace };
    const annotations = this.namespaceAnnotations.get(namespace);
    if (annotations !== undefined) annotations.cacheable = true;
    if (module.parentModuleId !== undefined) {
      this.publishChildModule(
        module.parentModuleId,
        module.shortName,
        namespace,
        operation.span,
      );
    }
    this.stack.length = frame.stackBase;
    this.pendingControl = marker.callerPendingControl;
    if (marker.alias !== undefined && marker.binding !== undefined) {
      const bound =
        marker.bindModuleId === undefined
          ? namespace
          : this.pythonModuleNamespace(marker.bindModuleId, operation.span);
      this.storeName(
        marker.binding,
        marker.alias,
        bound,
        operation.span,
        marker.caller,
      );
    }
    return { cycles, kind: "return" };
  }

  private importedNamespace(
    imported: ResolvedImport,
    span: SourceSpan,
  ): RuntimeNamespace {
    if (imported.kind === "builtin") {
      const namespace = this.builtinModule(imported.name);
      if (namespace !== undefined) return namespace;
    } else if (imported.kind === "extension") {
      const namespace = this.extensionNamespaces.get(imported.extensionId);
      if (namespace !== undefined) return namespace;
    } else if (imported.kind === "python") {
      return this.pythonModuleNamespace(imported.moduleId, span);
    }
    throw new VmRuntimeError(
      "ImportError",
      `No module named ${imported.name}`,
      span,
    );
  }

  private builtinModule(name: string): RuntimeNamespace | undefined {
    if (name === "typing") return this.typingModule;
    if (name === "string") return this.stringModule;
    if (name === "string.templatelib") return this.templatelibModule;
    return this.options.environment.modules.get(name);
  }

  private pythonModuleNamespace(
    moduleId: number,
    span: SourceSpan,
  ): RuntimeNamespace {
    const state = this.moduleStates[moduleId];
    if (state?.kind !== "unloaded" && state !== undefined) {
      return state.namespace;
    }
    throw new VmRuntimeError(
      "ImportError",
      `Module ${String(moduleId)} is unavailable`,
      span,
    );
  }

  private boundPythonNamespace(
    operation: Extract<PythonOperation, { kind: "import" }>,
    fallback: RuntimeNamespace,
  ): RuntimeNamespace {
    return operation.bindModuleId === undefined
      ? fallback
      : this.pythonModuleNamespace(operation.bindModuleId, operation.span);
  }

  private storeImportBinding(
    operation: Extract<PythonOperation, { kind: "import" }>,
    namespace: RuntimeNamespace,
  ): void {
    if (operation.alias === undefined || operation.binding === undefined)
      return;
    const boundNamespace =
      operation.bindBuiltinName === undefined
        ? namespace
        : this.builtinModule(operation.bindBuiltinName);
    if (boundNamespace === undefined) {
      throw new VmRuntimeError(
        "ImportError",
        `Module ${operation.bindBuiltinName} is unavailable`,
        operation.span,
      );
    }
    this.storeName(
      operation.binding,
      operation.alias,
      boundNamespace,
      operation.span,
    );
  }

  private preflightChildModule(
    parentModuleId: number,
    shortName: string,
    span: SourceSpan,
  ): RuntimeNamespace {
    const parent = this.pythonModuleNamespace(parentModuleId, span);
    if (
      !parent.values.has(shortName) &&
      parent.values.size >= this.options.limits.maxCollectionSize
    ) {
      throw new VmLimitError("module namespace", span);
    }
    return parent;
  }

  private publishChildModule(
    parentModuleId: number,
    shortName: string,
    namespace: RuntimeNamespace,
    span: SourceSpan,
  ): void {
    this.preflightChildModule(parentModuleId, shortName, span).values.set(
      shortName,
      namespace,
    );
  }

  private bindFromImport(
    operation: Extract<PythonOperation, { kind: "bind_from" }>,
  ): void {
    const namespace = this.importedNamespace(
      operation.imported,
      operation.span,
    );
    if (!operation.wildcard) {
      for (const imported of operation.imports) {
        if (!namespace.values.has(imported.name)) {
          throw new VmRuntimeError(
            "ImportError",
            `cannot import name ${imported.name} from ${namespace.name}`,
            operation.span,
          );
        }
        this.storeName(
          imported.binding,
          imported.alias,
          namespace.values.get(imported.name)!,
          operation.span,
        );
      }
      return;
    }

    const exported = namespace.values.get("__all__");
    let names: string[];
    if (exported === undefined) {
      names = [...namespace.values.keys()].filter(
        (name) => !name.startsWith("_"),
      );
    } else if (isSequence(exported)) {
      if (!exported.values.every((name) => typeof name === "string")) {
        throw new VmRuntimeError(
          "TypeError",
          "__all__ must contain only strings",
          operation.span,
        );
      }
      names = exported.values as string[];
    } else {
      throw new VmRuntimeError(
        "TypeError",
        "__all__ must be a list or tuple in this profile",
        operation.span,
      );
    }
    this.checkCollection(names.length, operation.span);
    const frame = this.frame();
    const target = frame.globals;
    const additions = new Set(names.filter((name) => !target.has(name)));
    if (target.size + additions.size > this.options.limits.maxCollectionSize) {
      throw new VmLimitError("module namespace", operation.span);
    }
    for (const name of names) {
      if (!namespace.values.has(name)) {
        throw new VmRuntimeError(
          "AttributeError",
          `module ${namespace.name} has no attribute ${name}`,
          operation.span,
        );
      }
    }
    for (const name of names) {
      this.storeName(
        "global",
        name,
        namespace.values.get(name)!,
        operation.span,
      );
    }
  }

  private loadName(
    binding: ScopeBinding,
    name: string,
    span: SourceSpan,
  ): RuntimeValue {
    const frame = this.frame();
    if (binding === "local") {
      if (frame.locals.has(name)) return frame.locals.get(name)!;
      if (frame.kind !== "class") {
        throw new VmRuntimeError(
          "UnboundLocalError",
          `Local name ${name} is not associated with a value`,
          span,
        );
      }
      const enclosing = frame.cells.get(name);
      if (enclosing?.initialized === true) return enclosing.value;
    }
    if (binding === "cell" || binding === "free") {
      const cell = this.requireCell(frame, name, span);
      if (cell.initialized) return cell.value;
      throw new VmRuntimeError(
        binding === "cell" ? "UnboundLocalError" : "NameError",
        binding === "cell"
          ? `Local name ${name} is not associated with a value`
          : `Free name ${name} is not associated with a value in an enclosing scope`,
        span,
      );
    }
    if (name === "__debug__") return true;
    if (frame.globals.has(name)) return frame.globals.get(name)!;
    const global = this.options.environment.globals.get(name);
    if (global !== undefined) return global;
    if (name === "range")
      return rangeFunction(this.options.limits.maxCollectionSize);
    if (name === "iter") return this.iterBuiltin;
    if (name === "next") return this.nextBuiltin;
    if (name === "len") return lenFunction();
    if (name === "bool") return this.boolBuiltin;
    if (name === "dict") return this.dictBuiltin;
    if (name === "int") return this.intBuiltin;
    if (name === "list") return this.listBuiltin;
    if (name === "property") return this.propertyBuiltin;
    if (name === "set") return this.setBuiltin;
    if (name === "staticmethod") return this.staticmethodBuiltin;
    if (name === "classmethod") return this.classmethodBuiltin;
    if (name === "str") return this.strBuiltin;
    if (name === "tuple") return this.tupleBuiltin;
    if (name === "getattr") return this.getattrBuiltin;
    if (name === "setattr") return this.setattrBuiltin;
    if (name === "delattr") return this.delattrBuiltin;
    if (name === "super") return this.superBuiltin;
    if (name === "object") return this.objectClass;
    if (name === "isinstance")
      return isinstanceFunction(this.objectClass, this.templatelibModule);
    if (name === "issubclass") return issubclassFunction();
    const exceptionType = this.exceptionTypes.get(name);
    if (exceptionType !== undefined) return exceptionType;
    throw new VmRuntimeError("NameError", `Name ${name} is not defined`, span);
  }

  private hasBoundName(binding: ScopeBinding, name: string): boolean {
    const frame = this.frame();
    if (binding === "local") return frame.locals.has(name);
    if (binding === "cell" || binding === "free") {
      return this.bindingCell(frame, name)?.initialized === true;
    }
    return (
      frame.globals.has(name) || this.options.environment.globals.has(name)
    );
  }

  private storeName(
    binding: ScopeBinding,
    name: string,
    value: RuntimeValue,
    span?: SourceSpan,
    frame = this.frame(),
  ): void {
    const bindingBytes = this.nameBindingAllocationBytes(binding, name, frame);
    if (binding === "global") {
      if (bindingBytes > 0)
        this.heapAccounting.preflightAdditionalValue(value, bindingBytes);
      frame.globals.set(name, value);
      return;
    }
    if (binding === "local") {
      if (
        frame.kind === "class" &&
        !frame.locals.has(name) &&
        frame.locals.size >= this.options.limits.maxCollectionSize
      ) {
        throw new VmLimitError("class namespace", span);
      }
      if (bindingBytes > 0)
        this.heapAccounting.preflightAdditionalValue(value, bindingBytes);
      frame.locals.set(name, value);
      return;
    }
    const cell = this.requireCell(frame, name, span);
    cell.initialized = true;
    cell.value = value;
  }

  private deleteName(
    binding: ScopeBinding,
    name: string,
    span: SourceSpan,
  ): void {
    const frame = this.frame();
    if (binding === "global") {
      if (!frame.globals.delete(name)) {
        throw new VmRuntimeError(
          "NameError",
          `Name ${name} is not defined`,
          span,
        );
      }
      return;
    }
    if (binding === "local") {
      if (!frame.locals.delete(name)) {
        throw new VmRuntimeError(
          "UnboundLocalError",
          `Local name ${name} is not associated with a value`,
          span,
        );
      }
      return;
    }
    const cell = this.requireCell(frame, name, span);
    if (!cell.initialized) {
      throw new VmRuntimeError(
        binding === "cell" ? "UnboundLocalError" : "NameError",
        binding === "cell"
          ? `Local name ${name} is not associated with a value`
          : `Free name ${name} is not associated with a value in an enclosing scope`,
        span,
      );
    }
    cell.initialized = false;
    cell.value = null;
  }

  private requireCell(
    frame: RuntimeFrame,
    name: string,
    span?: SourceSpan,
  ): RuntimeCell {
    const cell = this.bindingCell(frame, name);
    if (cell === undefined) {
      throw new VmRuntimeError(
        "ExecutableFormatError",
        `Missing runtime cell ${name}`,
        span,
      );
    }
    return cell;
  }

  private createMethodWrapper(
    kind: "classmethod" | "staticmethod",
    positional: readonly RuntimeValue[],
    keywords: ReadonlyMap<string, RuntimeValue>,
  ): RuntimeNamespace {
    if (keywords.size > 0 || positional.length !== 1) {
      throw new VmRuntimeError(
        "TypeError",
        `${kind} expects exactly one positional argument`,
      );
    }
    const callable = positional[0]!;
    const wrapper: RuntimeNamespace = {
      kind: "namespace",
      name: kind,
      values: new Map([["__func__", callable]]),
    };
    this.descriptorWrappers.set(wrapper, { callable, kind });
    this.noteAllocation(64);
    return wrapper;
  }

  private createProperty(
    positional: readonly RuntimeValue[],
    keywords: ReadonlyMap<string, RuntimeValue>,
  ): RuntimeNamespace {
    const names = ["fget", "fset", "fdel", "doc"] as const;
    if (positional.length > names.length) {
      throw new VmRuntimeError(
        "TypeError",
        "property expects at most four positional arguments",
      );
    }
    const values = new Map<(typeof names)[number], RuntimeValue>();
    positional.forEach((value, index) => values.set(names[index]!, value));
    for (const [name, value] of keywords) {
      if (!names.includes(name as (typeof names)[number])) {
        throw new VmRuntimeError(
          "TypeError",
          `property got an unexpected keyword argument ${name}`,
        );
      }
      const typedName = name as (typeof names)[number];
      if (values.has(typedName)) {
        throw new VmRuntimeError(
          "TypeError",
          `property got multiple values for ${name}`,
        );
      }
      values.set(typedName, value);
    }
    return this.makeProperty(
      values.get("fget") ?? null,
      values.get("fset") ?? null,
      values.get("fdel") ?? null,
      values.get("doc") ?? null,
    );
  }

  private makeProperty(
    getter: RuntimeValue,
    setter: RuntimeValue,
    deleter: RuntimeValue,
    doc: RuntimeValue,
  ): RuntimeNamespace {
    const property: RuntimeNamespace = {
      kind: "namespace",
      name: "property",
      values: new Map<string, RuntimeValue>([
        ["fget", getter],
        ["fset", setter],
        ["fdel", deleter],
        ["__doc__", doc],
      ]),
    };
    this.descriptorWrappers.set(property, {
      deleter,
      getter,
      kind: "property",
      setter,
    });
    this.noteAllocation(112);
    return property;
  }

  private replacePropertyAccessor(
    accessor: "deleter" | "getter" | "setter",
    positional: readonly RuntimeValue[],
    keywords: ReadonlyMap<string, RuntimeValue>,
  ): RuntimeNamespace {
    if (keywords.size > 0 || positional.length !== 2) {
      throw new VmRuntimeError(
        "TypeError",
        `${accessor} expects exactly one positional argument`,
      );
    }
    const [property, replacement] = positional;
    if (!isNamespace(property!)) {
      throw new VmRuntimeError(
        "TypeError",
        `${accessor} receiver is not a property`,
      );
    }
    const state = this.descriptorWrappers.get(property);
    if (state?.kind !== "property") {
      throw new VmRuntimeError(
        "TypeError",
        `${accessor} receiver is not a property`,
      );
    }
    return this.makeProperty(
      accessor === "getter" ? replacement! : state.getter,
      accessor === "setter" ? replacement! : state.setter,
      accessor === "deleter" ? replacement! : state.deleter,
      property.values.get("__doc__") ?? null,
    );
  }

  private loadAttributeOperation(
    object: RuntimeValue,
    name: string,
    context: Cs486SyscallContext,
    span: SourceSpan,
    cycles: number,
    fallback?: {
      readonly defaultValue: RuntimeValue;
      readonly hasDefault: boolean;
    },
  ): Cs486SyscallResult {
    if (isBoundMethod(object)) {
      if (name === "__self__") {
        this.push(object.receiver, span);
        return continued(cycles);
      }
      if (name === "__func__") {
        this.push(object.callable, span);
        return continued(cycles);
      }
    }
    if (isNamespace(object)) {
      const superState = this.superStates.get(object);
      if (superState !== undefined) {
        return this.loadSuperAttributeOperation(
          superState,
          name,
          context,
          span,
          cycles,
          fallback,
        );
      }
      const wrapper = this.descriptorWrappers.get(object);
      if (wrapper?.kind === "property") {
        const accessor =
          name === "getter"
            ? this.propertyGetterBuiltin
            : name === "setter"
              ? this.propertySetterBuiltin
              : name === "deleter"
                ? this.propertyDeleterBuiltin
                : undefined;
        if (accessor !== undefined) {
          const method: RuntimeBoundMethod = {
            callable: accessor,
            kind: "bound_method",
            receiver: object,
          };
          this.push(method, span);
          this.noteAllocation(48);
          return continued(cycles + 2);
        }
      }
    }
    if (isClass(object)) {
      if (name === "__name__") {
        this.push(object.name, span);
        return continued(cycles);
      }
      if (name === "__base__") {
        this.push(object.base, span);
        return continued(cycles);
      }
      if (name === "__bases__") {
        this.push(object.basesValue, span);
        return continued(cycles);
      }
      if (name === "__mro__") {
        this.push(object.mroValue, span);
        return continued(cycles);
      }
      const descriptor = lookupClassAttribute(object, name);
      if (descriptor === undefined) {
        if (fallback?.hasDefault === true) {
          this.push(fallback.defaultValue, span);
          return continued(cycles);
        }
        throw new VmRuntimeError(
          "AttributeError",
          `Attribute ${name} does not exist`,
          span,
        );
      }
      return this.resolveDescriptorGet(
        descriptor,
        null,
        object,
        context,
        span,
        cycles,
        fallback === undefined
          ? undefined
          : { ...fallback, fallbackName: name },
      );
    }
    if (isInstance(object)) {
      const hook = lookupClassAttribute(object.classObject, "__getattribute__");
      if (hook !== undefined && hook !== this.objectGetattributeBuiltin) {
        return this.callManagedProtocol(
          hook,
          [object, name],
          {
            defaultValue: fallback?.defaultValue ?? null,
            hasDefault: fallback?.hasDefault ?? false,
            instance: object,
            kind: "attribute_hook_get",
            name,
            phase: "getattribute",
            span,
          },
          context,
          span,
          cycles + 4,
        );
      }
      try {
        return this.loadDefaultInstanceAttributeOperation(
          object,
          name,
          context,
          span,
          cycles,
          fallback,
        );
      } catch (error: unknown) {
        if (
          !(error instanceof VmRuntimeError) ||
          error.typeName !== "AttributeError"
        ) {
          throw error;
        }
        const result = this.startAttributeFallback(
          object,
          name,
          fallback,
          context,
          span,
          cycles,
          context.readRegister("esp") - 4,
          false,
        );
        if (result !== undefined) return result;
        throw error;
      }
    }
    try {
      const value = this.loadAttribute(object, name, span);
      this.push(value, span);
      return continued(cycles);
    } catch (error: unknown) {
      if (
        fallback?.hasDefault === true &&
        error instanceof VmRuntimeError &&
        error.typeName === "AttributeError"
      ) {
        this.push(fallback.defaultValue, span);
        return continued(cycles);
      }
      throw error;
    }
  }

  private loadSuperAttributeOperation(
    state: ManagedSuper,
    name: string,
    context: Cs486SyscallContext,
    span: SourceSpan,
    cycles: number,
    fallback?: {
      readonly defaultValue: RuntimeValue;
      readonly hasDefault: boolean;
    },
  ): Cs486SyscallResult {
    const reflection =
      name === "__thisclass__"
        ? state.startClass
        : name === "__self__"
          ? state.receiver
          : name === "__self_class__"
            ? state.receiverClass
            : undefined;
    if (reflection !== undefined) {
      this.push(reflection, span);
      return continued(cycles + 2);
    }
    if (state.receiverClass !== null) {
      const startIndex = state.receiverClass.mro.indexOf(state.startClass);
      if (startIndex < 0) {
        throw new VmRuntimeError(
          "RuntimeError",
          "super start class is absent from the receiver MRO",
          span,
        );
      }
      for (
        let index = startIndex + 1;
        index < state.receiverClass.mro.length;
        index += 1
      ) {
        const descriptor = state.receiverClass.mro[index]!.values.get(name);
        if (descriptor === undefined) continue;
        return this.resolveDescriptorGet(
          descriptor,
          isInstance(state.receiver) ? state.receiver : null,
          state.receiverClass,
          context,
          span,
          cycles + index - startIndex,
          fallback === undefined
            ? undefined
            : { ...fallback, fallbackName: name },
        );
      }
    }
    if (fallback?.hasDefault === true) {
      this.push(fallback.defaultValue, span);
      return continued(cycles);
    }
    throw new VmRuntimeError(
      "AttributeError",
      `Attribute ${name} does not exist after ${state.startClass.name} in the MRO`,
      span,
    );
  }

  private loadDefaultInstanceAttributeOperation(
    object: RuntimeInstance,
    name: string,
    context: Cs486SyscallContext,
    span: SourceSpan,
    cycles: number,
    fallback?: {
      readonly defaultValue: RuntimeValue;
      readonly hasDefault: boolean;
    },
  ): Cs486SyscallResult {
    if (name === "__class__") {
      this.push(object.classObject, span);
      return continued(cycles);
    }
    const descriptor = lookupClassAttribute(object.classObject, name);
    if (descriptor !== undefined && this.isDataDescriptor(descriptor)) {
      return this.resolveDescriptorGet(
        descriptor,
        object,
        object.classObject,
        context,
        span,
        cycles,
        {
          defaultValue: fallback?.defaultValue ?? null,
          fallbackName: name,
          hasDefault: fallback?.hasDefault ?? false,
        },
      );
    }
    const own = object.values.get(name);
    if (own !== undefined) {
      this.push(own, span);
      return continued(cycles);
    }
    if (descriptor !== undefined) {
      return this.resolveDescriptorGet(
        descriptor,
        object,
        object.classObject,
        context,
        span,
        cycles,
        {
          defaultValue: fallback?.defaultValue ?? null,
          fallbackName: name,
          hasDefault: fallback?.hasDefault ?? false,
        },
      );
    }
    throw new VmRuntimeError(
      "AttributeError",
      `Attribute ${name} does not exist`,
      span,
    );
  }

  private startAttributeFallback(
    instance: RuntimeInstance,
    name: string,
    fallback:
      | { readonly defaultValue: RuntimeValue; readonly hasDefault: boolean }
      | undefined,
    context: Cs486SyscallContext,
    span: SourceSpan,
    cycles: number,
    machineStackPointer: number,
    returnFromProtocol: boolean,
  ): Cs486SyscallResult | undefined {
    const hook = lookupClassAttribute(instance.classObject, "__getattr__");
    if (hook !== undefined) {
      const result = this.callManagedProtocol(
        hook,
        [instance, name],
        {
          defaultValue: fallback?.defaultValue ?? null,
          hasDefault: fallback?.hasDefault ?? false,
          instance,
          kind: "attribute_hook_get",
          name,
          phase: "getattr",
          span,
        },
        context,
        span,
        cycles + 4,
        machineStackPointer,
      );
      return returnFromProtocol && result.kind === "call"
        ? { ...result, kind: "jump" }
        : result;
    }
    if (fallback?.hasDefault === true) {
      this.push(fallback.defaultValue, span);
      return returnFromProtocol
        ? { cycles, kind: "return" }
        : continued(cycles);
    }
    return undefined;
  }

  private resolveDescriptorGet(
    descriptor: RuntimeValue,
    instance: RuntimeInstance | null,
    ownerClass: RuntimeClass,
    context: Cs486SyscallContext,
    span: SourceSpan,
    cycles: number,
    fallback?: {
      readonly defaultValue: RuntimeValue;
      readonly fallbackName: string;
      readonly hasDefault: boolean;
    },
  ): Cs486SyscallResult {
    if (isNamespace(descriptor)) {
      const wrapper = this.descriptorWrappers.get(descriptor);
      if (wrapper?.kind === "staticmethod") {
        this.push(wrapper.callable, span);
        return continued(cycles + 2);
      }
      if (wrapper?.kind === "classmethod") {
        if (!isNativeFunction(wrapper.callable)) {
          throw new VmRuntimeError(
            "TypeError",
            "classmethod wrapped object is not a supported callable",
            span,
          );
        }
        const method: RuntimeBoundMethod = {
          callable: wrapper.callable,
          kind: "bound_method",
          receiver: ownerClass,
        };
        this.push(method, span);
        this.noteAllocation(48);
        return continued(cycles + 2);
      }
      if (wrapper?.kind === "property") {
        if (instance === null) {
          this.push(descriptor, span);
          return continued(cycles + 2);
        }
        if (wrapper.getter === null) {
          throw new VmRuntimeError(
            "AttributeError",
            "property has no getter",
            span,
          );
        }
        return this.callManagedProtocol(
          wrapper.getter,
          [instance],
          {
            descriptor,
            fallbackDefault: fallback?.defaultValue ?? null,
            fallbackName: fallback?.fallbackName,
            hasFallbackDefault: fallback?.hasDefault ?? false,
            instance,
            kind: "attribute_get",
            ownerClass,
            span,
          },
          context,
          span,
          cycles + 4,
        );
      }
    }
    if (
      isNativeFunction(descriptor) &&
      (this.callables.get(descriptor)?.kind === "python" ||
        descriptor === this.objectGetattributeBuiltin ||
        descriptor === this.objectSetattrBuiltin ||
        descriptor === this.objectDelattrBuiltin ||
        descriptor === this.objectInitBuiltin)
    ) {
      if (instance === null) {
        this.push(descriptor, span);
      } else {
        const method: RuntimeBoundMethod = {
          callable: descriptor,
          kind: "bound_method",
          receiver: instance,
        };
        this.push(method, span);
        this.noteAllocation(48);
      }
      return continued(cycles + 2);
    }
    if (isInstance(descriptor)) {
      const getter = lookupClassAttribute(descriptor.classObject, "__get__");
      if (getter !== undefined) {
        return this.callManagedProtocol(
          getter,
          [descriptor, instance, ownerClass],
          {
            descriptor,
            fallbackDefault: fallback?.defaultValue ?? null,
            fallbackName: fallback?.fallbackName,
            hasFallbackDefault: fallback?.hasDefault ?? false,
            instance,
            kind: "attribute_get",
            ownerClass,
            span,
          },
          context,
          span,
          cycles + 6,
        );
      }
    }
    this.push(descriptor, span);
    return continued(cycles);
  }

  private isDataDescriptor(value: RuntimeValue): boolean {
    if (isNamespace(value)) {
      return this.descriptorWrappers.get(value)?.kind === "property";
    }
    return (
      isInstance(value) &&
      lookupClassAttribute(value.classObject, "__get__") !== undefined &&
      (lookupClassAttribute(value.classObject, "__set__") !== undefined ||
        lookupClassAttribute(value.classObject, "__delete__") !== undefined)
    );
  }

  private callManagedProtocol(
    callable: RuntimeValue,
    positional: readonly RuntimeValue[],
    owner: IteratorProtocolOwner,
    context: Cs486SyscallContext,
    span: SourceSpan,
    cycles: number,
    machineStackPointer = context.readRegister("esp") - 4,
  ): Cs486SyscallResult {
    if (!isNativeFunction(callable)) {
      throw new VmRuntimeError(
        "TypeError",
        "descriptor protocol method is not callable",
        span,
      );
    }
    const managed = this.callables.get(callable);
    if (
      managed?.kind !== "python" ||
      managed.descriptor.generator ||
      managed.descriptor.coroutine ||
      managed.descriptor.asyncGenerator
    ) {
      throw new VmRuntimeError(
        "TypeError",
        "descriptor protocol method must be a synchronous Python function",
        span,
      );
    }
    return this.callPython(
      managed,
      positional,
      new Map(),
      span,
      cycles,
      undefined,
      { machineStackPointer, owner },
    );
  }

  private loadAttribute(
    object: RuntimeValue,
    name: string,
    span: SourceSpan,
  ): RuntimeValue {
    if (isNamespace(object)) {
      const value = object.values.get(name);
      if (value !== undefined) return value;
      if (
        isExceptionGroupValue(object) &&
        (name === "derive" || name === "split" || name === "subgroup")
      ) {
        const callable =
          name === "derive"
            ? this.exceptionGroupDeriveBuiltin
            : name === "split"
              ? this.exceptionGroupSplitBuiltin
              : this.exceptionGroupSubgroupBuiltin;
        const method: RuntimeBoundMethod = {
          callable,
          kind: "bound_method",
          receiver: object,
        };
        this.noteAllocation(48);
        return method;
      }
    } else if (isClass(object)) {
      if (name === "__name__") return object.name;
      if (name === "__base__") return object.base;
      if (name === "__bases__") return object.basesValue;
      if (name === "__mro__") return object.mroValue;
      const value = lookupClassAttribute(object, name);
      if (value !== undefined) return value;
    } else if (isInstance(object)) {
      if (name === "__class__") return object.classObject;
      const own = object.values.get(name);
      if (own !== undefined) return own;
      const value = lookupClassAttribute(object.classObject, name);
      if (value !== undefined) {
        if (
          typeof value === "object" &&
          value !== null &&
          value.kind === "native_function" &&
          this.callables.get(value)?.kind === "python"
        ) {
          const method: RuntimeBoundMethod = {
            callable: value,
            kind: "bound_method",
            receiver: object,
          };
          this.noteAllocation(48);
          return method;
        }
        return value;
      }
    } else if (
      (isGenerator(object) &&
        (name === "send" || name === "throw" || name === "close")) ||
      (isCoroutine(object) &&
        (name === "send" || name === "throw" || name === "close"))
    ) {
      const callable =
        name === "send"
          ? this.sendBuiltin
          : name === "throw"
            ? this.throwBuiltin
            : this.closeBuiltin;
      const method: RuntimeBoundMethod = {
        callable,
        kind: "bound_method",
        receiver: object,
      };
      this.noteAllocation(48);
      return method;
    } else if (
      isAsyncGenerator(object) &&
      (name === "__aiter__" ||
        name === "__anext__" ||
        name === "asend" ||
        name === "athrow" ||
        name === "aclose")
    ) {
      const callable =
        name === "__aiter__"
          ? this.asyncGeneratorIterBuiltin
          : name === "__anext__"
            ? this.asyncGeneratorNextBuiltin
            : name === "asend"
              ? this.asyncGeneratorSendBuiltin
              : name === "athrow"
                ? this.asyncGeneratorThrowBuiltin
                : this.asyncGeneratorCloseBuiltin;
      const method: RuntimeBoundMethod = {
        callable,
        kind: "bound_method",
        receiver: object,
      };
      this.noteAllocation(48);
      return method;
    }
    throw new VmRuntimeError(
      "AttributeError",
      `Attribute ${name} does not exist`,
      span,
    );
  }

  private exceptionGroupConstructor(
    requestedType: "BaseExceptionGroup" | "ExceptionGroup",
  ): NativeFunction {
    return nativeFunction(requestedType, (positional, keywords) => {
      if (keywords.size > 0 || positional.length !== 2) {
        throw new VmRuntimeError(
          "TypeError",
          `${requestedType} expects message and exceptions`,
        );
      }
      const [message, source] = positional;
      if (typeof message !== "string") {
        throw new VmRuntimeError(
          "TypeError",
          `${requestedType} message must be a string`,
        );
      }
      if (!isSequence(source!)) {
        throw new VmRuntimeError(
          "TypeError",
          `${requestedType} exceptions must be a list or tuple`,
        );
      }
      this.checkCollection(source.values.length);
      const value = createExceptionGroupValue(
        requestedType,
        message,
        source.values,
        this.options.limits.maxCollectionSize,
      );
      this.noteAllocation(96 + source.values.length * 8);
      return value;
    });
  }

  private deriveExceptionGroup(
    positional: readonly RuntimeValue[],
    keywords: ReadonlyMap<string, RuntimeValue>,
  ): RuntimeValue {
    if (keywords.size > 0 || positional.length !== 2) {
      throw new VmRuntimeError(
        "TypeError",
        "derive expects one exceptions argument",
      );
    }
    const [receiver, source] = positional;
    if (!isExceptionGroupValue(receiver!)) {
      throw new VmRuntimeError(
        "TypeError",
        "derive receiver must be an exception group",
      );
    }
    if (!isSequence(source!)) {
      throw new VmRuntimeError(
        "TypeError",
        "derive exceptions must be a list or tuple",
      );
    }
    const message = receiver.values.get("message");
    const derived = createExceptionGroupValue(
      receiver.name,
      typeof message === "string" ? message : "",
      source.values,
      this.options.limits.maxCollectionSize,
    );
    copyExceptionGroupMetadata(receiver, derived);
    this.noteAllocation(96 + source.values.length * 8);
    return derived;
  }

  private splitExceptionGroup(
    positional: readonly RuntimeValue[],
    keywords: ReadonlyMap<string, RuntimeValue>,
    pair: boolean,
  ): RuntimeValue {
    if (keywords.size > 0 || positional.length !== 2) {
      throw new VmRuntimeError(
        "TypeError",
        `${pair ? "split" : "subgroup"} expects one condition`,
      );
    }
    const [receiver, condition] = positional;
    if (!isExceptionGroupValue(receiver!)) {
      throw new VmRuntimeError(
        "TypeError",
        `${pair ? "split" : "subgroup"} receiver must be an exception group`,
      );
    }
    const typeNames = exceptionConditionNames(
      condition!,
      this.options.limits.maxCollectionSize,
    );
    const [matched, rest] = splitExceptionValue(
      receiver,
      typeNames,
      this.options.limits.maxCollectionSize,
      true,
    );
    if (!pair) return matched;
    this.noteAllocation(32);
    return { kind: "tuple", values: [matched, rest] };
  }

  private isManagedExceptionGroupPredicate(value: RuntimeValue): boolean {
    const callable = isBoundMethod(value) ? value.callable : value;
    if (
      typeof callable !== "object" ||
      callable === null ||
      callable.kind !== "native_function"
    ) {
      return false;
    }
    const managed = this.callables.get(callable);
    return (
      managed?.kind === "python" &&
      !managed.descriptor.generator &&
      !managed.descriptor.coroutine
    );
  }

  private startExceptionGroupPredicate(
    receiver: RuntimeNamespace & {
      readonly name: "BaseExceptionGroup" | "ExceptionGroup";
    },
    condition: RuntimeValue,
    pair: boolean,
    span: SourceSpan,
    context: Cs486SyscallContext,
    cycles: number,
  ): Cs486SyscallResult {
    const state: ExceptionGroupPredicateState = {
      condition,
      decisions: new WeakMap(),
      machineStackPointer: context.readRegister("esp") - 4,
      pair,
      pending: [receiver],
      receiver,
      span,
    };
    return this.continueExceptionGroupPredicate(state, context, cycles + 4);
  }

  private continueExceptionGroupPredicate(
    state: ExceptionGroupPredicateState,
    context: Cs486SyscallContext,
    cycles: number,
  ): Cs486SyscallResult {
    const current = state.pending.pop();
    if (current === undefined) {
      const [matched, rest] = splitExceptionValueByPredicate(
        state.receiver,
        state.decisions,
        this.options.limits.maxCollectionSize,
      );
      const result: RuntimeValue = state.pair
        ? { kind: "tuple", values: [matched, rest] }
        : matched;
      this.push(result, state.span);
      this.noteRuntimeValue(result);
      return { cycles: cycles + 4, kind: "return" };
    }
    state.current = current;
    const callable = isBoundMethod(state.condition)
      ? state.condition.callable
      : state.condition;
    const managed =
      typeof callable === "object" &&
      callable !== null &&
      callable.kind === "native_function"
        ? this.callables.get(callable)
        : undefined;
    if (managed?.kind !== "python") {
      throw new VmRuntimeError(
        "TypeError",
        "exception group callable condition must be a managed Python function",
        state.span,
      );
    }
    const positional = isBoundMethod(state.condition)
      ? [state.condition.receiver, current]
      : [current];
    return this.callPython(
      managed,
      positional,
      new Map(),
      state.span,
      cycles + 4,
      undefined,
      {
        machineStackPointer: state.machineStackPointer,
        owner: { kind: "exception_group_predicate", state },
      },
    );
  }

  private completeExceptionGroupPredicate(
    state: ExceptionGroupPredicateState,
    value: RuntimeValue,
    context: Cs486SyscallContext,
    cycles: number,
  ): Cs486SyscallResult {
    const current = state.current;
    if (current === undefined) {
      throw new VmRuntimeError(
        "RuntimeError",
        "exception group predicate completed without an active node",
        state.span,
      );
    }
    context.writeRegister("esp", state.machineStackPointer);
    state.current = undefined;
    const matched = truthy(value);
    state.decisions.set(current, matched);
    if (!matched && isExceptionGroupValue(current)) {
      const children = current.values.get("exceptions");
      if (!isTupleValue(children)) {
        throw new VmRuntimeError(
          "ValueError",
          "exception group has invalid exceptions",
          state.span,
        );
      }
      if (
        state.pending.length + children.values.length >
        this.options.limits.maxCollectionSize
      ) {
        throw new VmLimitError("exception group predicate", state.span);
      }
      for (let index = children.values.length - 1; index >= 0; index -= 1) {
        const child = children.values[index]!;
        if (!isExceptionValue(child)) {
          throw new VmRuntimeError(
            "TypeError",
            "exception group contains a non-exception value",
            state.span,
          );
        }
        state.pending.push(child);
      }
    }
    return this.continueExceptionGroupPredicate(state, context, cycles + 4);
  }

  private exceptionGroupPredicateRoots(
    state: ExceptionGroupPredicateState,
  ): readonly RuntimeValue[] {
    return [
      state.condition,
      state.receiver,
      ...state.pending,
      ...(state.current === undefined ? [] : [state.current]),
    ];
  }

  private createTemplatelibModule(): RuntimeNamespace {
    const templateConstructor = nativeFunction(
      "Template",
      (positional, keywords) => this.constructTemplate(positional, keywords),
    );
    const interpolationConstructor = nativeFunction(
      "Interpolation",
      (positional, keywords) =>
        this.constructInterpolation(positional, keywords),
    );
    const convert = nativeFunction("convert", (positional, keywords) => {
      requireNativeArity("convert", positional, keywords, 2);
      const value = positional[0]!;
      const conversion = positional[1];
      if (conversion === null) return value;
      if (conversion !== "a" && conversion !== "r" && conversion !== "s") {
        throw new VmRuntimeError(
          "ValueError",
          "conversion must be None, 'a', 'r', or 's'",
        );
      }
      const converted = templateConversion(value, conversion);
      this.checkString(converted);
      return converted;
    });
    return {
      kind: "namespace",
      name: "string.templatelib",
      values: new Map<string, RuntimeValue>([
        [
          "__all__",
          { kind: "list", values: ["Template", "Interpolation", "convert"] },
        ],
        ["__name__", "string.templatelib"],
        ["Interpolation", interpolationConstructor],
        ["Template", templateConstructor],
        ["convert", convert],
      ]),
    };
  }

  private constructInterpolation(
    positional: readonly RuntimeValue[],
    keywords: ReadonlyMap<string, RuntimeValue>,
  ): RuntimeNamespace {
    if (positional.length > 4) {
      throw new VmRuntimeError(
        "TypeError",
        "Interpolation expects value, expression, optional conversion, and optional format_spec",
      );
    }
    const parameterNames = [
      "value",
      "expression",
      "conversion",
      "format_spec",
    ] as const;
    const argumentsByName = new Map<string, RuntimeValue>();
    positional.forEach((argument, index) => {
      argumentsByName.set(parameterNames[index]!, argument);
    });
    for (const name of keywords.keys()) {
      if (!parameterNames.includes(name as (typeof parameterNames)[number])) {
        throw new VmRuntimeError(
          "TypeError",
          `Interpolation got an unexpected keyword ${name}`,
        );
      }
      if (argumentsByName.has(name)) {
        throw new VmRuntimeError(
          "TypeError",
          `Interpolation received multiple values for argument '${name}'`,
        );
      }
      argumentsByName.set(name, keywords.get(name)!);
    }
    if (!argumentsByName.has("value") || !argumentsByName.has("expression")) {
      throw new VmRuntimeError(
        "TypeError",
        "Interpolation requires value and expression",
      );
    }
    const value = argumentsByName.get("value")!;
    const expression = argumentsByName.get("expression");
    const conversion = argumentsByName.get("conversion") ?? null;
    const formatSpec = argumentsByName.get("format_spec") ?? "";
    if (typeof expression !== "string") {
      throw new VmRuntimeError("TypeError", "expression must be text");
    }
    if (
      conversion !== null &&
      conversion !== "a" &&
      conversion !== "r" &&
      conversion !== "s"
    ) {
      throw new VmRuntimeError(
        "ValueError",
        "conversion must be None, 'a', 'r', or 's'",
      );
    }
    if (typeof formatSpec !== "string") {
      throw new VmRuntimeError("TypeError", "format_spec must be text");
    }
    this.checkString(expression);
    this.checkString(formatSpec);
    const interpolation: RuntimeNamespace = {
      kind: "namespace",
      name: "Interpolation",
      values: new Map<string, RuntimeValue>([
        ["value", value],
        ["expression", expression],
        ["conversion", conversion],
        ["format_spec", formatSpec],
      ]),
    };
    this.heapAccounting.preflightAdditionalValue(interpolation, 64);
    return interpolation;
  }

  private constructTemplate(
    positional: readonly RuntimeValue[],
    keywords: ReadonlyMap<string, RuntimeValue>,
  ): RuntimeNamespace {
    if (keywords.size > 0) {
      throw new VmRuntimeError("TypeError", "Template accepts no keywords");
    }
    this.checkCollection(positional.length);
    const strings = [""];
    const interpolations: RuntimeNamespace[] = [];
    for (const part of positional) {
      if (typeof part === "string") {
        const combined = strings.at(-1)! + part;
        this.checkString(combined);
        strings[strings.length - 1] = combined;
      } else if (isTemplateInterpolationValue(part)) {
        interpolations.push(part);
        strings.push("");
      } else {
        throw new VmRuntimeError(
          "TypeError",
          "Template parts must be strings or Interpolation values",
        );
      }
    }
    return this.makeTemplateValue(strings, interpolations);
  }

  private makeTemplateValue(
    strings: readonly string[],
    interpolations: readonly RuntimeNamespace[],
  ): RuntimeNamespace {
    this.checkCollection(strings.length);
    this.checkCollection(interpolations.length);
    const values = interpolations.map((interpolation) =>
      interpolation.values.get("value")!,
    );
    const template: RuntimeNamespace = {
      kind: "namespace",
      name: "Template",
      values: new Map<string, RuntimeValue>([
        ["strings", { kind: "tuple", values: [...strings] }],
        ["interpolations", { kind: "tuple", values: [...interpolations] }],
        ["values", { kind: "tuple", values }],
      ]),
    };
    this.heapAccounting.preflightAdditionalValue(template, 96);
    return template;
  }

  private createTypingModule(): RuntimeNamespace {
    const values = new Map<string, RuntimeValue>();
    this.typingReadOnlyObjects.add(this.noTypeParameterDefault);
    const token = (name: string): RuntimeNamespace => {
      const value: RuntimeNamespace = {
        kind: "namespace",
        name: `typing.${name}`,
        values: new Map(["__name__"].map((key) => [key, name])),
      };
      this.typingReadOnlyObjects.add(value);
      values.set(name, value);
      return value;
    };
    const form = (
      name: string,
      arity: number | { readonly minimum: number },
      options: Omit<TypingSpecialForm, "arity" | "name"> = {},
    ): RuntimeNamespace => {
      const value = token(name);
      this.typingSpecialForms.set(value, { arity, name, ...options });
      return value;
    };

    token("Any");
    token("Never");
    token("NoReturn");
    token("Self");
    token("LiteralString");
    token("TypeAlias");
    const noneType = token("NoneType");
    const union = form("Union", { minimum: 1 });
    form("Optional", 1, {
      canonicalOrigin: union,
      transformArguments: (arguments_) => [arguments_[0]!, noneType],
    });
    form("Literal", { minimum: 1 });
    form("Annotated", { minimum: 2 });
    form("Callable", 2);
    form("ClassVar", 1);
    form("Final", 1);
    form("Required", 1);
    form("NotRequired", 1);
    form("ReadOnly", 1);
    form("TypeGuard", 1);
    form("TypeIs", 1);
    form("Unpack", 1);
    form("Concatenate", { minimum: 2 });

    values.set("NoDefault", this.noTypeParameterDefault);
    values.set(
      "TypeVar",
      nativeFunction("TypeVar", (positional, keywords) =>
        this.createTypingTypeParameter("TypeVariable", positional, keywords),
      ),
    );
    values.set(
      "ParamSpec",
      nativeFunction("ParamSpec", (positional, keywords) =>
        this.createTypingTypeParameter(
          "ParameterSpecification",
          positional,
          keywords,
        ),
      ),
    );
    values.set(
      "TypeVarTuple",
      nativeFunction("TypeVarTuple", (positional, keywords) =>
        this.createTypingTypeParameter(
          "TypeVariableTuple",
          positional,
          keywords,
        ),
      ),
    );
    values.set(
      "get_origin",
      nativeFunction("get_origin", (positional, keywords) => {
        requireNativeArity("get_origin", positional, keywords, 1);
        const value = positional[0]!;
        if (isNamespace(value)) {
          const alias = this.genericAliasStates.get(value);
          if (alias !== undefined) return alias.origin;
          return value.values.get("__origin__") ?? null;
        }
        return null;
      }),
    );
    values.set(
      "get_args",
      nativeFunction("get_args", (positional, keywords) => {
        requireNativeArity("get_args", positional, keywords, 1);
        const value = positional[0]!;
        if (isNamespace(value)) {
          const alias = this.genericAliasStates.get(value);
          if (alias !== undefined) return alias.arguments;
          const arguments_ = value.values.get("__args__");
          if (
            typeof arguments_ === "object" &&
            arguments_ !== null &&
            arguments_.kind === "tuple"
          ) {
            return arguments_;
          }
        }
        return { kind: "tuple", values: [] };
      }),
    );
    values.set(
      "cast",
      nativeFunction("cast", (positional, keywords) => {
        requireNativeArity("cast", positional, keywords, 2);
        return positional[1]!;
      }),
    );
    values.set(
      "assert_type",
      nativeFunction("assert_type", (positional, keywords) => {
        requireNativeArity("assert_type", positional, keywords, 2);
        return positional[0]!;
      }),
    );
    values.set(
      "assert_never",
      nativeFunction("assert_never", (positional, keywords) => {
        requireNativeArity("assert_never", positional, keywords, 1);
        throw new VmRuntimeError(
          "AssertionError",
          `Expected code to be unreachable, received ${formatValue(positional[0]!)}`,
        );
      }),
    );
    values.set(
      "reveal_type",
      nativeFunction("reveal_type", (positional, keywords) => {
        requireNativeArity("reveal_type", positional, keywords, 1);
        return positional[0]!;
      }),
    );
    values.set("__all__", {
      kind: "list",
      values: [...values.keys()].filter((name) => !name.startsWith("__")),
    });
    values.set("__name__", "typing");
    return { kind: "namespace", name: "typing", values };
  }

  private createTypingTypeParameter(
    kind: TypeParameter["kind"],
    positional: readonly RuntimeValue[],
    keywords: ReadonlyMap<string, RuntimeValue>,
  ): RuntimeNamespace {
    const name = positional[0];
    if (typeof name !== "string" || name.length === 0) {
      throw new VmRuntimeError(
        "TypeError",
        "type parameter name must be non-empty text",
      );
    }
    this.checkString(name);
    const allowedKeywords = new Set([
      "bound",
      "default",
      "covariant",
      "contravariant",
      "infer_variance",
    ]);
    for (const keyword of keywords.keys()) {
      if (!allowedKeywords.has(keyword)) {
        throw new VmRuntimeError(
          "TypeError",
          `unexpected type parameter keyword ${keyword}`,
        );
      }
    }
    const constraints = positional.slice(1);
    if (kind !== "TypeVariable" && constraints.length > 0) {
      throw new VmRuntimeError(
        "TypeError",
        `${kind} accepts only its name as a positional argument`,
      );
    }
    if (constraints.length === 1) {
      throw new VmRuntimeError(
        "TypeError",
        "a constrained TypeVar requires at least two constraints",
      );
    }
    if (constraints.length > 0 && keywords.has("bound")) {
      throw new VmRuntimeError(
        "TypeError",
        "TypeVar cannot combine constraints with a bound",
      );
    }
    this.checkCollection(constraints.length);
    const covariant = truthy(keywords.get("covariant") ?? false);
    const contravariant = truthy(keywords.get("contravariant") ?? false);
    if (covariant && contravariant) {
      throw new VmRuntimeError(
        "ValueError",
        "type parameter cannot be both covariant and contravariant",
      );
    }
    const parameter: RuntimeNamespace = {
      kind: "namespace",
      name,
      values: new Map<string, RuntimeValue>([
        ["__name__", name],
        ["__covariant__", covariant],
        ["__contravariant__", contravariant],
        ["__infer_variance__", truthy(keywords.get("infer_variance") ?? false)],
      ]),
    };
    this.typingReadOnlyObjects.add(parameter);
    this.typeParameterStates.set(parameter, {
      bound: this.immediateManagedLazyValue(keywords.get("bound") ?? null),
      constraints: this.immediateManagedLazyValue({
        kind: "tuple",
        values: constraints,
      }),
      defaultValue: this.immediateManagedLazyValue(
        keywords.get("default") ?? this.noTypeParameterDefault,
      ),
      kind,
    });
    if (kind === "ParameterSpecification") {
      parameter.values.set("args", this.parameterProjection(parameter, "args"));
      parameter.values.set(
        "kwargs",
        this.parameterProjection(parameter, "kwargs"),
      );
    }
    this.heapAccounting.preflightAdditionalValue(parameter);
    return parameter;
  }

  private immediateManagedLazyValue(value: RuntimeValue): ManagedLazyValue {
    return { evaluating: false, fallback: value };
  }

  private parameterProjection(
    parameter: RuntimeNamespace,
    projection: "args" | "kwargs",
  ): RuntimeNamespace {
    const value: RuntimeNamespace = {
      kind: "namespace",
      name: `${parameter.name}.${projection}`,
      values: new Map<string, RuntimeValue>([
        ["__name__", projection],
        ["__origin__", parameter],
      ]),
    };
    this.typingReadOnlyObjects.add(value);
    return value;
  }

  private loadSubscriptOperation(
    origin: RuntimeValue,
    index: RuntimeValue,
    context: Cs486SyscallContext,
    span: SourceSpan,
    cycles: number,
  ): Cs486SyscallResult {
    const prepared = this.prepareGenericSubscription(origin, index, span);
    if (prepared === undefined) {
      this.push(loadSubscript(origin, index, span), span);
      return continued(cycles);
    }
    if (prepared.defaults.length === 0) {
      this.push(
        this.publishPreparedGenericAlias(prepared, prepared.arguments, span),
        span,
      );
      return continued(cycles + prepared.arguments.length * 2);
    }
    const state: PendingGenericSubscription = {
      arguments: prepared.arguments,
      defaultIndex: 0,
      defaults: prepared.defaults,
      machineStackPointer: context.readRegister("esp") - 4,
      origin: prepared.publishOrigin,
      span,
      template: prepared.template,
    };
    while (this.appendCachedGenericDefault(state)) {
      // Consume already evaluated defaults without entering another call frame.
    }
    if (state.defaultIndex >= state.defaults.length) {
      this.push(this.publishPendingGenericAlias(state), span);
      return continued(cycles + state.arguments.length * 2);
    }
    return this.evaluateNextGenericDefault(state, context, cycles + 4);
  }

  private prepareGenericSubscription(
    origin: RuntimeValue,
    index: RuntimeValue,
    span: SourceSpan,
  ): PreparedGenericSubscription | undefined {
    const template = isNamespace(origin)
      ? this.genericAliasStates.get(origin)
      : undefined;
    const typingForm =
      template === undefined && isNamespace(origin)
        ? this.typingSpecialForms.get(origin)
        : undefined;
    const declaredParameters =
      template?.parameters ?? this.typeParametersForObject(origin);
    const publishOrigin =
      template?.origin ?? typingForm?.canonicalOrigin ?? origin;
    const builtinArity =
      template === undefined ? this.genericBuiltinArity(origin) : undefined;
    if (declaredParameters === undefined && builtinArity === undefined) {
      return undefined;
    }

    const argumentValues =
      typeof index === "object" && index !== null && index.kind === "tuple"
        ? [...index.values]
        : [index];
    this.checkCollection(argumentValues.length, span);
    if (declaredParameters !== undefined) {
      const prepared = this.prepareDeclaredGenericArguments(
        declaredParameters,
        argumentValues,
        span,
      );
      return { ...prepared, publishOrigin, template };
    } else if (builtinArity !== undefined) {
      const valid =
        typeof builtinArity === "number"
          ? argumentValues.length === builtinArity
          : argumentValues.length >= builtinArity.minimum;
      if (!valid) {
        throw new VmRuntimeError(
          "TypeError",
          `${this.genericOriginName(origin)} received the wrong number of type arguments`,
          span,
        );
      }
    }

    const transformedArguments = [
      ...(typingForm?.transformArguments?.(argumentValues) ?? argumentValues),
    ];
    this.checkCollection(transformedArguments.length, span);
    return {
      arguments: transformedArguments,
      defaults: [],
      publishOrigin,
    };
  }

  private publishPreparedGenericAlias(
    prepared: PreparedGenericSubscription,
    subscriptionArguments: readonly RuntimeValue[],
    span: SourceSpan,
  ): RuntimeNamespace {
    const arguments_ =
      prepared.template === undefined
        ? subscriptionArguments
        : this.substituteGenericAliasArguments(
            prepared.template,
            subscriptionArguments,
            span,
          );
    return this.publishGenericAlias(prepared.publishOrigin, arguments_, span);
  }

  private publishPendingGenericAlias(
    state: PendingGenericSubscription,
  ): RuntimeNamespace {
    const arguments_ =
      state.template === undefined
        ? state.arguments
        : this.substituteGenericAliasArguments(
            state.template,
            state.arguments,
            state.span,
          );
    return this.publishGenericAlias(state.origin, arguments_, state.span);
  }

  private substituteGenericAliasArguments(
    template: ManagedGenericAlias,
    subscriptionArguments: readonly RuntimeValue[],
    span: SourceSpan,
  ): readonly RuntimeValue[] {
    const parameters = template.parameters.values;
    const variadicIndex = parameters.findIndex(
      (value) =>
        isNamespace(value) &&
        this.typeParameterStates.get(value)?.kind === "TypeVariableTuple",
    );
    const bindings = new Map<RuntimeNamespace, readonly RuntimeValue[]>();
    for (let index = 0; index < parameters.length; index += 1) {
      const parameter = parameters[index];
      if (parameter === undefined || !isNamespace(parameter)) continue;
      if (index === variadicIndex) {
        const suffix = parameters.length - index - 1;
        bindings.set(
          parameter,
          subscriptionArguments.slice(
            index,
            subscriptionArguments.length - suffix,
          ),
        );
      } else {
        const argumentIndex =
          variadicIndex >= 0 && index > variadicIndex
            ? subscriptionArguments.length - (parameters.length - index)
            : index;
        bindings.set(parameter, [subscriptionArguments[argumentIndex]!]);
      }
    }
    const substitute = (
      value: RuntimeValue,
      depth: number,
    ): readonly RuntimeValue[] => {
      if (depth > 64) throw new VmLimitError("generic alias nesting", span);
      if (isNamespace(value)) {
        const replacement = bindings.get(value);
        if (replacement !== undefined) return replacement;
        const nested = this.genericAliasStates.get(value);
        if (nested !== undefined) {
          const nestedArguments = nested.arguments.values.flatMap((argument) =>
            substitute(argument, depth + 1),
          );
          return [
            this.publishGenericAlias(nested.origin, nestedArguments, span),
          ];
        }
      }
      if (
        typeof value === "object" &&
        value !== null &&
        value.kind === "tuple"
      ) {
        const values = value.values.flatMap((item) =>
          substitute(item, depth + 1),
        );
        this.checkCollection(values.length, span);
        return [{ kind: "tuple", values }];
      }
      return [value];
    };
    const result = template.arguments.values.flatMap((value) =>
      substitute(value, 0),
    );
    this.checkCollection(result.length, span);
    return result;
  }

  private publishGenericAlias(
    origin: RuntimeValue,
    argumentValues: readonly RuntimeValue[],
    span: SourceSpan,
  ): RuntimeNamespace {
    const cacheKey = this.genericAliasCacheKey(origin, argumentValues);
    const cached = this.genericAliasCache.get(cacheKey);
    if (cached !== undefined) return cached;
    if (this.genericAliasCache.size >= this.options.limits.maxCollectionSize) {
      throw new VmLimitError("generic alias cache", span);
    }

    const argumentsTuple: RuntimeTuple = {
      kind: "tuple",
      values: argumentValues,
    };
    const parametersTuple: RuntimeTuple = {
      kind: "tuple",
      values: this.collectGenericAliasParameters(argumentValues, span),
    };
    const metadataTuple: RuntimeTuple | undefined =
      isNamespace(origin) &&
      this.typingSpecialForms.get(origin)?.name === "Annotated"
        ? { kind: "tuple", values: argumentValues.slice(1) }
        : undefined;
    const alias: RuntimeNamespace = {
      kind: "namespace",
      name: `${this.genericOriginName(origin)}[generic]`,
      values: new Map<string, RuntimeValue>([
        ["__origin__", origin],
        ["__args__", argumentsTuple],
        ["__parameters__", parametersTuple],
        ...(metadataTuple === undefined
          ? []
          : ([["__metadata__", metadataTuple]] as const)),
      ]),
    };
    this.checkString(alias.name, span);
    this.heapAccounting.preflightAdditionalValue(alias);
    this.genericAliasStates.set(alias, {
      arguments: argumentsTuple,
      origin,
      parameters: parametersTuple,
    });
    this.genericAliasCache.set(cacheKey, alias);
    return alias;
  }

  private prepareDeclaredGenericArguments(
    parameters: RuntimeTuple,
    providedArguments: readonly RuntimeValue[],
    span: SourceSpan,
  ): Pick<PreparedGenericSubscription, "arguments" | "defaults"> {
    let variadicCount = 0;
    const states: ManagedTypeParameter[] = [];
    for (const value of parameters.values) {
      if (!isNamespace(value)) {
        throw new VmRuntimeError(
          "ExecutableFormatError",
          "generic owner contains an invalid type parameter",
          span,
        );
      }
      const state = this.typeParameterStates.get(value);
      if (state === undefined) {
        throw new VmRuntimeError(
          "ExecutableFormatError",
          "generic owner contains an unmanaged type parameter",
          span,
        );
      }
      states.push(state);
      if (state.kind === "TypeVariableTuple") variadicCount += 1;
    }
    if (states.length === 1 && states[0]!.kind === "ParameterSpecification") {
      const normalized = this.normalizeSoleParamSpecArguments(
        providedArguments,
        span,
      );
      return { arguments: [normalized], defaults: [] };
    }
    if (variadicCount > 1) {
      throw new VmRuntimeError(
        "TypeError",
        "generic subscription supports at most one TypeVarTuple",
        span,
      );
    }
    const required = parameters.values.length - variadicCount;
    if (variadicCount === 1) {
      if (providedArguments.length < required) {
        throw new VmRuntimeError(
          "TypeError",
          `generic received ${String(providedArguments.length)} type arguments but requires ${String(required)} or more`,
          span,
        );
      }
      return {
        arguments: this.normalizeProvidedParamSpecs(states, providedArguments),
        defaults: [],
      };
    }
    if (providedArguments.length > parameters.values.length) {
      throw new VmRuntimeError(
        "TypeError",
        `generic received ${String(providedArguments.length)} type arguments but accepts ${String(parameters.values.length)}`,
        span,
      );
    }
    const defaults: ManagedLazyValue[] = [];
    for (
      let index = providedArguments.length;
      index < states.length;
      index += 1
    ) {
      const defaultValue = states[index]!.defaultValue;
      if (
        defaultValue.cache === undefined &&
        defaultValue.evaluator === undefined &&
        defaultValue.fallback === this.noTypeParameterDefault
      ) {
        throw new VmRuntimeError(
          "TypeError",
          `generic received ${String(providedArguments.length)} type arguments but requires ${String(parameters.values.length - defaults.length)}`,
          span,
        );
      }
      defaults.push(defaultValue);
    }
    return {
      arguments: this.normalizeProvidedParamSpecs(states, providedArguments),
      defaults,
    };
  }

  private normalizeSoleParamSpecArguments(
    providedArguments: readonly RuntimeValue[],
    span: SourceSpan,
  ): RuntimeTuple {
    if (providedArguments.length === 0) {
      return { kind: "tuple", values: [] };
    }
    if (providedArguments.length > 1) {
      this.checkCollection(providedArguments.length, span);
      return { kind: "tuple", values: [...providedArguments] };
    }
    const argument = providedArguments[0]!;
    if (
      typeof argument === "object" &&
      argument !== null &&
      (argument.kind === "list" || argument.kind === "tuple")
    ) {
      this.checkCollection(argument.values.length, span);
      return { kind: "tuple", values: [...argument.values] };
    }
    throw new VmRuntimeError(
      "TypeError",
      "a sole ParamSpec argument must be a list, tuple, or expanded argument list",
      span,
    );
  }

  private normalizeProvidedParamSpecs(
    states: readonly ManagedTypeParameter[],
    providedArguments: readonly RuntimeValue[],
  ): RuntimeValue[] {
    return providedArguments.map((argument, index): RuntimeValue => {
      if (states[index]?.kind !== "ParameterSpecification") return argument;
      if (
        typeof argument === "object" &&
        argument !== null &&
        argument.kind === "list"
      ) {
        return { kind: "tuple", values: [...argument.values] };
      }
      return argument;
    });
  }

  private appendCachedGenericDefault(
    state: PendingGenericSubscription,
  ): boolean {
    const current = state.defaults[state.defaultIndex];
    if (current === undefined) return false;
    const value =
      current.cache ??
      (current.evaluator === undefined &&
      current.fallback !== this.noTypeParameterDefault
        ? current.fallback
        : undefined);
    if (value === undefined) return false;
    this.checkCollection(state.arguments.length + 1, state.span);
    state.arguments.push(value);
    state.defaultIndex += 1;
    return true;
  }

  private evaluateNextGenericDefault(
    state: PendingGenericSubscription,
    context: Cs486SyscallContext,
    cycles: number,
  ): Cs486SyscallResult {
    while (this.appendCachedGenericDefault(state)) {
      // A prior reflection access may already have populated several defaults.
    }
    if (state.defaultIndex >= state.defaults.length) {
      this.push(this.publishPendingGenericAlias(state), state.span);
      return { cycles: cycles + state.arguments.length * 2, kind: "return" };
    }
    const current = state.defaults[state.defaultIndex]!;
    if (current.evaluator === undefined) {
      throw new VmRuntimeError(
        "RuntimeError",
        "generic default evaluator is unavailable",
        state.span,
      );
    }
    if (current.evaluating) {
      throw new VmRuntimeError(
        "RuntimeError",
        "lazy type evaluation is already in progress",
        state.span,
      );
    }
    current.evaluating = true;
    return this.callPython(
      current.evaluator,
      [],
      new Map(),
      state.span,
      cycles,
      undefined,
      {
        machineStackPointer: state.machineStackPointer,
        owner: { kind: "generic_default", state },
      },
    );
  }

  private collectGenericAliasParameters(
    values: readonly RuntimeValue[],
    span: SourceSpan,
  ): readonly RuntimeValue[] {
    const collected: RuntimeValue[] = [];
    const seen = new Set<RuntimeNamespace>();
    const visit = (value: RuntimeValue, depth: number): void => {
      if (depth > 64) throw new VmLimitError("generic alias nesting", span);
      if (isNamespace(value)) {
        if (this.typeParameterStates.has(value)) {
          if (!seen.has(value)) {
            this.checkCollection(collected.length + 1, span);
            seen.add(value);
            collected.push(value);
          }
          return;
        }
        const nested = this.genericAliasStates.get(value);
        if (nested !== undefined) {
          for (const parameter of nested.parameters.values) {
            visit(parameter, depth + 1);
          }
        }
        return;
      }
      if (
        typeof value === "object" &&
        value !== null &&
        value.kind === "tuple"
      ) {
        for (const item of value.values) visit(item, depth + 1);
      }
    };
    for (const value of values) visit(value, 0);
    return collected;
  }

  private genericBuiltinArity(
    origin: RuntimeValue,
  ): number | { readonly minimum: number } | undefined {
    if (isNamespace(origin)) {
      const typingForm = this.typingSpecialForms.get(origin);
      if (typingForm !== undefined) return typingForm.arity;
    }
    if (origin === this.listBuiltin || origin === this.setBuiltin) return 1;
    if (origin === this.dictBuiltin) return 2;
    if (origin === this.tupleBuiltin) return { minimum: 1 };
    return undefined;
  }

  private genericAliasCacheKey(
    origin: RuntimeValue,
    arguments_: readonly RuntimeValue[],
  ): string {
    return `${this.runtimeIdentityKey(origin)}(${arguments_
      .map((value) => this.runtimeIdentityKey(value))
      .join(",")})`;
  }

  private runtimeIdentityKey(value: RuntimeValue): string {
    if (value === null) return "null";
    if (typeof value === "string") return `s${String(value.length)}:${value}`;
    if (typeof value === "bigint") return `i${value.toString()}`;
    if (typeof value === "number") {
      if (Number.isNaN(value)) return "nNaN";
      if (Object.is(value, -0)) return "n-0";
      return `n${String(value)}`;
    }
    if (typeof value === "boolean") return value ? "b1" : "b0";
    let id = this.runtimeIdentityIds.get(value);
    if (id === undefined) {
      id = this.nextRuntimeIdentityId;
      this.nextRuntimeIdentityId += 1;
      this.runtimeIdentityIds.set(value, id);
    }
    return `o${String(id)}`;
  }

  private genericOriginName(origin: RuntimeValue): string {
    if (isClass(origin) || isNativeFunction(origin) || isNamespace(origin)) {
      return origin.name;
    }
    return "generic";
  }

  private typeParameterTuple(
    names: readonly string[],
    span: SourceSpan,
  ): RuntimeTuple {
    this.checkCollection(names.length, span);
    const frame = this.frame();
    const values = names.map((name) => {
      const cell = frame.cells.get(name);
      if (cell?.initialized !== true || !isNamespace(cell.value)) {
        throw new VmRuntimeError(
          "ExecutableFormatError",
          `missing type parameter ${name}`,
          span,
        );
      }
      if (!this.typeParameterStates.has(cell.value)) {
        throw new VmRuntimeError(
          "ExecutableFormatError",
          `${name} is not a managed type parameter`,
          span,
        );
      }
      return cell.value;
    });
    return { kind: "tuple", values };
  }

  private lazyTypeAttribute(
    object: RuntimeValue,
    name: string,
  ): ManagedLazyValue | undefined {
    if (!isNamespace(object)) return undefined;
    const parameter = this.typeParameterStates.get(object);
    if (parameter !== undefined) {
      if (parameter.kind === "TypeVariable") {
        if (name === "__bound__") return parameter.bound;
        if (name === "__constraints__") return parameter.constraints;
      }
      if (name === "__default__") return parameter.defaultValue;
    }
    const alias = this.typeAliasStates.get(object);
    return alias !== undefined && name === "__value__"
      ? alias.value
      : undefined;
  }

  private typeParametersForObject(
    object: RuntimeValue,
  ): RuntimeTuple | undefined {
    if (isNativeFunction(object)) {
      return this.functionTypeParameters.get(object);
    }
    if (isClass(object)) return this.classTypeParameters.get(object);
    if (isNamespace(object)) {
      return this.typeAliasStates.get(object)?.typeParameters;
    }
    return undefined;
  }

  private accessManagedLazyValue(
    state: ManagedLazyValue,
    context: Cs486SyscallContext,
    span: SourceSpan,
    cycles: number,
  ): Cs486SyscallResult {
    if (state.cache !== undefined) {
      this.push(state.cache, span);
      return continued(cycles);
    }
    if (state.evaluator === undefined) {
      this.push(state.fallback, span);
      return continued(cycles);
    }
    if (state.evaluating) {
      throw new VmRuntimeError(
        "RuntimeError",
        "lazy type evaluation is already in progress",
        span,
      );
    }
    state.evaluating = true;
    try {
      return this.callPython(
        state.evaluator,
        [],
        new Map(),
        span,
        cycles + 4,
        undefined,
        {
          machineStackPointer: context.readRegister("esp") - 4,
          owner: { kind: "lazy_type", span, state },
        },
      );
    } catch (error: unknown) {
      state.evaluating = false;
      throw error;
    }
  }

  private annotationsForObject(
    object: RuntimeValue,
  ): ManagedAnnotations | undefined {
    if (isNamespace(object)) return this.namespaceAnnotations.get(object);
    if (isClass(object)) return this.classAnnotations.get(object);
    if (
      typeof object === "object" &&
      object !== null &&
      object.kind === "native_function"
    ) {
      return this.functionAnnotations.get(object);
    }
    return undefined;
  }

  private hasExplicitAnnotations(object: RuntimeValue): boolean {
    return (
      (isNamespace(object) || isClass(object)) &&
      object.values.has("__annotations__")
    );
  }

  private accessAnnotations(
    state: ManagedAnnotations,
    context: Cs486SyscallContext,
    span: SourceSpan,
    cycles: number,
  ): Cs486SyscallResult {
    if (state.cache !== undefined) {
      this.push(state.cache, span);
      return continued(cycles);
    }
    if (state.evaluator === undefined) {
      const empty: RuntimeDictionary = {
        entries: new Map(),
        kind: "dictionary",
      };
      this.heapAccounting.preflightAdditionalValue(empty);
      this.push(empty, span);
      if (state.cacheable) state.cache = empty;
      return continued(cycles + 2);
    }
    if (state.evaluating) {
      throw new VmRuntimeError(
        "RuntimeError",
        "annotation evaluation is already in progress",
        span,
      );
    }
    state.evaluating = true;
    try {
      return this.callPython(
        state.evaluator,
        [],
        new Map(),
        span,
        cycles + 4,
        undefined,
        {
          machineStackPointer: context.readRegister("esp") - 4,
          owner: { kind: "annotations", span, state },
        },
      );
    } catch (error: unknown) {
      state.evaluating = false;
      throw error;
    }
  }

  private matchPattern(
    pattern: CompiledPattern,
    subject: RuntimeValue,
    captures: Map<string, PatternCapture>,
    work: { steps: number },
    depth: number,
  ): boolean {
    if (depth > 64) throw new VmLimitError("pattern nesting", pattern.span);
    work.steps += 1;
    const capture = (
      target: CompiledPatternBinding,
      value: RuntimeValue,
    ): void => {
      captures.set(target.name, { ...target, value });
    };
    switch (pattern.kind) {
      case "capture":
        capture(pattern.binding, subject);
        return true;
      case "wildcard":
        return true;
      case "literal":
        return pattern.value === null || typeof pattern.value === "boolean"
          ? subject === pattern.value
          : compare(
              subject,
              pattern.value,
              "==",
              pattern.span,
              this.options.limits.maxStringLength,
            );
      case "value":
        return compare(
          subject,
          this.resolvePatternReference(pattern.reference, pattern.span),
          "==",
          pattern.span,
          this.options.limits.maxStringLength,
        );
      case "as":
        if (
          !this.matchPattern(
            pattern.pattern,
            subject,
            captures,
            work,
            depth + 1,
          )
        ) {
          return false;
        }
        capture(pattern.binding, subject);
        return true;
      case "or":
        for (const alternative of pattern.alternatives) {
          const alternativeCaptures = new Map<string, PatternCapture>();
          if (
            this.matchPattern(
              alternative,
              subject,
              alternativeCaptures,
              work,
              depth + 1,
            )
          ) {
            for (const [name, value] of alternativeCaptures) {
              captures.set(name, value);
            }
            return true;
          }
        }
        return false;
      case "sequence":
        return this.matchSequencePattern(
          pattern,
          subject,
          captures,
          work,
          depth,
        );
      case "star":
        if (pattern.binding !== undefined) capture(pattern.binding, subject);
        return true;
      case "mapping":
        return this.matchMappingPattern(
          pattern,
          subject,
          captures,
          work,
          depth,
        );
      case "class":
        return this.matchClassPattern(pattern, subject, captures, work, depth);
    }
  }

  private matchSequencePattern(
    pattern: Extract<CompiledPattern, { kind: "sequence" }>,
    subject: RuntimeValue,
    captures: Map<string, PatternCapture>,
    work: { steps: number },
    depth: number,
  ): boolean {
    if (!isSequence(subject)) return false;
    const starIndex = pattern.elements.findIndex(
      (element) => element.kind === "star",
    );
    if (
      starIndex < 0
        ? subject.values.length !== pattern.elements.length
        : subject.values.length < pattern.elements.length - 1
    ) {
      return false;
    }
    const fixedAfter =
      starIndex < 0 ? 0 : pattern.elements.length - starIndex - 1;
    for (let index = 0; index < pattern.elements.length; index += 1) {
      const element = pattern.elements[index]!;
      if (element.kind === "star") {
        if (element.binding !== undefined) {
          const values = subject.values.slice(
            starIndex,
            subject.values.length - fixedAfter,
          );
          captures.set(element.binding.name, {
            ...element.binding,
            value: { kind: "list", values },
          });
          work.steps += values.length;
        }
        continue;
      }
      const subjectIndex =
        starIndex >= 0 && index > starIndex
          ? subject.values.length - (pattern.elements.length - index)
          : index;
      if (
        !this.matchPattern(
          element,
          subject.values[subjectIndex]!,
          captures,
          work,
          depth + 1,
        )
      ) {
        return false;
      }
    }
    return true;
  }

  private matchMappingPattern(
    pattern: Extract<CompiledPattern, { kind: "mapping" }>,
    subject: RuntimeValue,
    captures: Map<string, PatternCapture>,
    work: { steps: number },
    depth: number,
  ): boolean {
    if (!isDictionary(subject)) return false;
    const matchedKeys = new Set<RuntimeValue>();
    for (const entry of pattern.entries) {
      const requested = this.resolvePatternReference(entry.key, pattern.span);
      const found = findDictionaryPatternEntry(subject, requested);
      if (found === undefined) return false;
      if (matchedKeys.has(found.key)) {
        throw new VmRuntimeError(
          "ValueError",
          "mapping pattern checks duplicate key",
          pattern.span,
        );
      }
      matchedKeys.add(found.key);
      if (
        !this.matchPattern(
          entry.pattern,
          found.value,
          captures,
          work,
          depth + 1,
        )
      ) {
        return false;
      }
    }
    if (pattern.rest !== undefined) {
      const entries = new Map<RuntimeValue, RuntimeValue>();
      for (const [key, value] of subject.entries) {
        work.steps += 1;
        if (!matchedKeys.has(key)) entries.set(key, value);
      }
      captures.set(pattern.rest.name, {
        ...pattern.rest,
        value: { entries, kind: "dictionary" },
      });
    }
    return true;
  }

  private matchClassPattern(
    pattern: Extract<CompiledPattern, { kind: "class" }>,
    subject: RuntimeValue,
    captures: Map<string, PatternCapture>,
    work: { steps: number },
    depth: number,
  ): boolean {
    const expected = this.resolvePatternReference(
      pattern.className,
      pattern.span,
    );
    const templateClass = this.templatelibModule.values.get("Template");
    const interpolationClass =
      this.templatelibModule.values.get("Interpolation");
    const intrinsicTemplateName =
      expected === templateClass
        ? "Template"
        : expected === interpolationClass
          ? "Interpolation"
          : undefined;
    const expectedClass = isClass(expected) ? expected : undefined;
    if (expectedClass === undefined && intrinsicTemplateName === undefined) {
      throw new VmRuntimeError(
        "TypeError",
        "called match pattern must be a class",
        pattern.span,
      );
    }
    if (intrinsicTemplateName !== undefined) {
      if (!isNamespace(subject) || subject.name !== intrinsicTemplateName) {
        return false;
      }
    } else if (
      expectedClass !== this.objectClass &&
      (!isInstance(subject) ||
        !classIsSubclass(subject.classObject, expectedClass!))
    ) {
      return false;
    }
    const attributes: string[] = [];
    if (pattern.positional.length > 0) {
      const matchArguments =
        intrinsicTemplateName === "Interpolation"
          ? {
              kind: "tuple" as const,
              values: ["value", "expression", "conversion", "format_spec"],
            }
          : intrinsicTemplateName === "Template"
            ? { kind: "tuple" as const, values: [] }
            : lookupClassAttribute(expectedClass!, "__match_args__");
      if (
        matchArguments === undefined ||
        !isSequence(matchArguments) ||
        matchArguments.kind !== "tuple"
      ) {
        throw new VmRuntimeError(
          "TypeError",
          `${intrinsicTemplateName ?? expectedClass!.name}() accepts 0 positional sub-patterns`,
          pattern.span,
        );
      }
      if (pattern.positional.length > matchArguments.values.length) {
        throw new VmRuntimeError(
          "TypeError",
          `${intrinsicTemplateName ?? expectedClass!.name}() accepts ${String(matchArguments.values.length)} positional sub-patterns`,
          pattern.span,
        );
      }
      for (const value of matchArguments.values.slice(
        0,
        pattern.positional.length,
      )) {
        if (typeof value !== "string") {
          throw new VmRuntimeError(
            "TypeError",
            "__match_args__ elements must be strings",
            pattern.span,
          );
        }
        attributes.push(value);
      }
    }
    for (const keyword of pattern.keywords) {
      if (attributes.includes(keyword.attribute)) {
        throw new VmRuntimeError(
          "TypeError",
          `${intrinsicTemplateName ?? expectedClass!.name}() got multiple sub-patterns for attribute ${keyword.attribute}`,
          pattern.span,
        );
      }
      attributes.push(keyword.attribute);
    }
    const patterns = [
      ...pattern.positional,
      ...pattern.keywords.map((keyword) => keyword.pattern),
    ];
    for (let index = 0; index < patterns.length; index += 1) {
      const attribute = this.tryLoadPatternAttribute(
        subject,
        attributes[index]!,
        pattern.span,
      );
      if (!attribute.found) return false;
      if (
        !this.matchPattern(
          patterns[index]!,
          attribute.value,
          captures,
          work,
          depth + 1,
        )
      ) {
        return false;
      }
    }
    return true;
  }

  private resolvePatternReference(
    reference: CompiledPatternReference,
    span: SourceSpan,
  ): RuntimeValue {
    if (reference.kind === "literal") return reference.value;
    let value = this.loadName(reference.binding, reference.name, span);
    for (const attribute of reference.attributes) {
      value = this.loadAttribute(value, attribute, span);
    }
    return value;
  }

  private tryLoadPatternAttribute(
    subject: RuntimeValue,
    name: string,
    span: SourceSpan,
  ):
    | { readonly found: false }
    | { readonly found: true; readonly value: RuntimeValue } {
    try {
      return { found: true, value: this.loadAttribute(subject, name, span) };
    } catch (error: unknown) {
      if (
        error instanceof VmRuntimeError &&
        error.typeName === "AttributeError"
      ) {
        return { found: false };
      }
      throw error;
    }
  }

  private commitPatternCaptures(
    captures: ReadonlyMap<string, PatternCapture>,
    span: SourceSpan,
  ): void {
    if (captures.size === 0) return;
    const frame = this.frame();
    let bindingBytes = 0;
    let newClassLocals = 0;
    for (const capture of captures.values()) {
      bindingBytes += this.nameBindingAllocationBytes(
        capture.binding,
        capture.name,
        frame,
      );
      if (
        capture.binding === "local" &&
        frame.kind === "class" &&
        !frame.locals.has(capture.name)
      ) {
        newClassLocals += 1;
      }
      if (capture.binding === "cell" || capture.binding === "free") {
        this.requireCell(frame, capture.name, span);
      }
    }
    if (
      frame.kind === "class" &&
      frame.locals.size + newClassLocals > this.options.limits.maxCollectionSize
    ) {
      throw new VmLimitError("class namespace", span);
    }
    this.heapAccounting.preflightAdditionalValues(
      [...captures.values()].map((capture) => capture.value),
      bindingBytes,
    );
    for (const capture of captures.values()) {
      this.storeName(capture.binding, capture.name, capture.value, span, frame);
    }
  }

  private prepareContext(
    span: SourceSpan,
    cycles: number,
    asynchronous: boolean,
  ): Cs486SyscallResult {
    if (this.options.limits.maxCollectionSize < 4) {
      throw new VmLimitError("context manager bound exit arguments", span);
    }
    const manager = this.pop(span);
    if (!isInstance(manager)) {
      throw new VmRuntimeError(
        "TypeError",
        "context manager must be a class instance",
        span,
      );
    }
    const bind = (
      name: "__aenter__" | "__aexit__" | "__enter__" | "__exit__",
    ): RuntimeBoundMethod => {
      const callable = lookupClassAttribute(manager.classObject, name);
      if (
        typeof callable !== "object" ||
        callable === null ||
        callable.kind !== "native_function" ||
        this.callables.get(callable)?.kind !== "python"
      ) {
        throw new VmRuntimeError(
          "TypeError",
          `${manager.classObject.name} does not define callable ${name}`,
          span,
        );
      }
      return { callable, kind: "bound_method", receiver: manager };
    };
    const enter = bind(asynchronous ? "__aenter__" : "__enter__");
    const exit = bind(asynchronous ? "__aexit__" : "__exit__");
    this.push(exit, span);
    this.push(enter, span);
    this.noteAllocation(96);
    return continued(cycles + 8);
  }

  private contextFaultInfo(
    span: SourceSpan,
    cycles: number,
  ): Cs486SyscallResult {
    const fault = this.pop(span);
    const exit = this.pop(span);
    if (!isNamespace(fault) || !exceptionNames.has(fault.name)) {
      throw new VmRuntimeError(
        "RuntimeError",
        "with handler received an invalid exception value",
        span,
      );
    }
    const type = this.exceptionTypes.get(fault.name);
    if (type === undefined) {
      throw new VmRuntimeError(
        "ExecutableFormatError",
        `missing exception type ${fault.name}`,
        span,
      );
    }
    this.push(fault, span);
    this.push(exit, span);
    this.push(type, span);
    this.push(fault, span);
    this.push(null, span);
    return continued(cycles + 8);
  }

  private storeAttributeOperation(
    object: RuntimeValue,
    name: string,
    value: RuntimeValue,
    context: Cs486SyscallContext,
    span: SourceSpan,
    cycles: number,
    returnsValue = false,
  ): Cs486SyscallResult {
    if (isInstance(object)) {
      const hook = lookupClassAttribute(object.classObject, "__setattr__");
      if (hook !== undefined && hook !== this.objectSetattrBuiltin) {
        return this.callManagedProtocol(
          hook,
          [object, name, value],
          {
            instance: object,
            kind: "attribute_hook_set",
            name,
            returnsValue,
            span,
            value,
          },
          context,
          span,
          cycles + 4,
        );
      }
      return this.storeDefaultInstanceAttributeOperation(
        object,
        name,
        value,
        context,
        span,
        cycles,
        returnsValue,
      );
    }
    this.storeAttribute(object, name, value, span);
    if (returnsValue) this.push(null, span);
    return continued(cycles);
  }

  private storeDefaultInstanceAttributeOperation(
    object: RuntimeInstance,
    name: string,
    value: RuntimeValue,
    context: Cs486SyscallContext,
    span: SourceSpan,
    cycles: number,
    returnsValue: boolean,
  ): Cs486SyscallResult {
    const descriptor = lookupClassAttribute(object.classObject, name);
    if (isNamespace(descriptor!)) {
      const wrapper = this.descriptorWrappers.get(descriptor);
      if (wrapper?.kind === "property") {
        if (wrapper.setter === null) {
          throw new VmRuntimeError(
            "AttributeError",
            "property has no setter",
            span,
          );
        }
        return this.callManagedProtocol(
          wrapper.setter,
          [object, value],
          {
            descriptor,
            instance: object,
            kind: "attribute_set",
            returnsValue,
            span,
            value,
          },
          context,
          span,
          cycles + 4,
        );
      }
    }
    if (isInstance(descriptor!)) {
      const setter = lookupClassAttribute(descriptor.classObject, "__set__");
      if (setter !== undefined) {
        return this.callManagedProtocol(
          setter,
          [descriptor, object, value],
          {
            descriptor,
            instance: object,
            kind: "attribute_set",
            returnsValue,
            span,
            value,
          },
          context,
          span,
          cycles + 6,
        );
      }
    }
    this.storeAttribute(object, name, value, span);
    if (returnsValue) this.push(null, span);
    return continued(cycles);
  }

  private deleteAttributeOperation(
    object: RuntimeValue,
    name: string,
    context: Cs486SyscallContext,
    span: SourceSpan,
    cycles: number,
    returnsValue = false,
  ): Cs486SyscallResult {
    if (isInstance(object)) {
      const hook = lookupClassAttribute(object.classObject, "__delattr__");
      if (hook !== undefined && hook !== this.objectDelattrBuiltin) {
        return this.callManagedProtocol(
          hook,
          [object, name],
          {
            instance: object,
            kind: "attribute_hook_delete",
            name,
            returnsValue,
            span,
          },
          context,
          span,
          cycles + 4,
        );
      }
      return this.deleteDefaultInstanceAttributeOperation(
        object,
        name,
        context,
        span,
        cycles,
        returnsValue,
      );
    }
    if (isClass(object)) {
      if (["__base__", "__bases__", "__mro__"].includes(name)) {
        throw new VmRuntimeError(
          "AttributeError",
          `Attribute ${name} is read-only`,
          span,
        );
      }
      if (object.values.delete(name)) {
        if (returnsValue) this.push(null, span);
        return continued(cycles);
      }
      throw new VmRuntimeError(
        "AttributeError",
        `Attribute ${name} does not exist`,
        span,
      );
    }
    if (isNamespace(object)) {
      if (this.superStates.has(object)) {
        throw new VmRuntimeError(
          "AttributeError",
          `Attribute ${name} is read-only`,
          span,
        );
      }
      if (object.values.delete(name)) {
        if (returnsValue) this.push(null, span);
        return continued(cycles);
      }
      throw new VmRuntimeError(
        "AttributeError",
        `Attribute ${name} does not exist`,
        span,
      );
    }
    throw new VmRuntimeError(
      "TypeError",
      "Value has no deletable attributes",
      span,
    );
  }

  private deleteDefaultInstanceAttributeOperation(
    object: RuntimeInstance,
    name: string,
    context: Cs486SyscallContext,
    span: SourceSpan,
    cycles: number,
    returnsValue: boolean,
  ): Cs486SyscallResult {
    const descriptor = lookupClassAttribute(object.classObject, name);
    if (isNamespace(descriptor!)) {
      const wrapper = this.descriptorWrappers.get(descriptor);
      if (wrapper?.kind === "property") {
        if (wrapper.deleter === null) {
          throw new VmRuntimeError(
            "AttributeError",
            "property has no deleter",
            span,
          );
        }
        return this.callManagedProtocol(
          wrapper.deleter,
          [object],
          {
            descriptor,
            instance: object,
            kind: "attribute_delete",
            returnsValue,
            span,
          },
          context,
          span,
          cycles + 4,
        );
      }
    }
    if (isInstance(descriptor!)) {
      const deleter = lookupClassAttribute(
        descriptor.classObject,
        "__delete__",
      );
      if (deleter !== undefined) {
        return this.callManagedProtocol(
          deleter,
          [descriptor, object],
          {
            descriptor,
            instance: object,
            kind: "attribute_delete",
            returnsValue,
            span,
          },
          context,
          span,
          cycles + 4,
        );
      }
    }
    if (object.values.delete(name)) {
      if (returnsValue) this.push(null, span);
      return continued(cycles);
    }
    throw new VmRuntimeError(
      "AttributeError",
      `Attribute ${name} does not exist`,
      span,
    );
  }

  private storeAttribute(
    object: RuntimeValue,
    name: string,
    value: RuntimeValue,
    span: SourceSpan,
  ): void {
    if (isNamespace(object) && this.superStates.has(object)) {
      throw new VmRuntimeError(
        "AttributeError",
        `Attribute ${name} is read-only`,
        span,
      );
    }
    const readOnlyTypeAttribute =
      (isClass(object) &&
        (["__base__", "__bases__", "__mro__"].includes(name) ||
          (this.classTypeParameters.has(object) &&
            name === "__type_params__"))) ||
      (isNamespace(object) &&
        this.typeParameterStates.has(object) &&
        [
          "__name__",
          "__bound__",
          "__constraints__",
          "__default__",
          "__covariant__",
          "__contravariant__",
          "__infer_variance__",
          "args",
          "kwargs",
        ].includes(name)) ||
      (isNamespace(object) &&
        this.typeAliasStates.has(object) &&
        ["__name__", "__type_params__", "__value__"].includes(name)) ||
      (isNamespace(object) &&
        this.genericAliasStates.has(object) &&
        ["__origin__", "__args__", "__parameters__", "__metadata__"].includes(
          name,
        )) ||
      (isNamespace(object) &&
        this.typingReadOnlyObjects.has(object) &&
        ["__name__", "__origin__"].includes(name)) ||
      (isNamespace(object) &&
        object.name === "Template" &&
        ["interpolations", "strings", "values"].includes(name)) ||
      (isNamespace(object) &&
        object.name === "Interpolation" &&
        ["conversion", "expression", "format_spec", "value"].includes(name)) ||
      (isNamespace(object) &&
        this.descriptorWrappers.has(object) &&
        ["__doc__", "__func__", "fdel", "fget", "fset"].includes(name)) ||
      (isExceptionGroupValue(object) &&
        ["args", "exceptions", "message", "type"].includes(name));
    if (readOnlyTypeAttribute) {
      throw new VmRuntimeError(
        "AttributeError",
        `Attribute ${name} is read-only`,
        span,
      );
    }
    const values =
      isNamespace(object) || isClass(object) || isInstance(object)
        ? object.values
        : undefined;
    if (values === undefined) {
      throw new VmRuntimeError(
        "TypeError",
        "Object attributes are not writable",
        span,
      );
    }
    if (
      !values.has(name) &&
      values.size >= this.options.limits.maxCollectionSize
    ) {
      throw new VmLimitError("attribute namespace", span);
    }
    const isNew = !values.has(name);
    if (isNew) {
      this.heapAccounting.preflightAdditionalValue(
        value,
        16 + utf8ByteLength(name),
      );
    }
    values.set(name, value);
  }

  private nameBindingAllocationBytes(
    binding: ScopeBinding,
    name: string,
    frame: RuntimeFrame,
  ): number {
    const values =
      binding === "global"
        ? frame.globals
        : binding === "local"
          ? frame.locals
          : undefined;
    return values !== undefined && !values.has(name)
      ? 16 + utf8ByteLength(name)
      : 0;
  }

  private binary(
    left: RuntimeValue,
    right: RuntimeValue,
    operator: Extract<PythonOperation, { kind: "binary" }>["operator"],
    span: SourceSpan,
  ): RuntimeValue {
    if (operator === "+" && isTemplateValue(left) && isTemplateValue(right)) {
      const leftParts = templateValueParts(left);
      const rightParts = templateValueParts(right);
      const strings = [
        ...leftParts.strings.slice(0, -1),
        leftParts.strings.at(-1)! + rightParts.strings[0]!,
        ...rightParts.strings.slice(1),
      ];
      return this.makeTemplateValue(strings, [
        ...leftParts.interpolations,
        ...rightParts.interpolations,
      ]);
    }
    if (operator === "+" && (isTemplateValue(left) || isTemplateValue(right))) {
      throw new VmRuntimeError(
        "TypeError",
        "Template values may only be concatenated with Template values",
        span,
      );
    }
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
    return applyPythonBinaryNumeric(
      left,
      right,
      operator,
      this.options.limits.maxIntegerBits,
      span,
    );
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
    if (
      typeof value === "bigint" &&
      pythonIntegerBitLength(value) > this.options.limits.maxIntegerBits
    ) {
      throw new VmLimitError("integer bits", span);
    }
    if (isSequence(value)) this.checkCollection(value.values.length, span);
    if (isDictionary(value)) this.checkCollection(value.entries.size, span);
    if (isSet(value)) this.checkCollection(value.entries.size, span);
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
    this.heapAccounting.noteRuntimeValue(value);
  }

  private managedHeapChildren(value: RuntimeValue): readonly RuntimeValue[] {
    if (isSequenceIterator(value)) return [value.sequence];
    if (isAsyncGeneratorOperation(value)) {
      return [value.generator, ...value.arguments];
    }
    if (isAsyncGenerator(value) || isGenerator(value) || isCoroutine(value)) {
      const state = isCoroutine(value)
        ? this.coroutines.get(value)
        : isAsyncGenerator(value)
          ? this.asyncGenerators.get(value)
          : this.generators.get(value);
      if (state === undefined || value.state === "running") return [];
      const values = new Map(state.frame.locals);
      for (const [name, cell] of state.frame.cells) {
        if (cell.initialized) values.set(name, cell.value);
      }
      return [
        {
          kind: "namespace",
          name: `<${value.kind} ${value.name} frame>`,
          values,
        },
        { kind: "tuple", values: state.stackValues },
        ...(state.frame.classCell?.initialized === true
          ? [state.frame.classCell.value]
          : []),
        ...state.activeFaults.flatMap(managedFaultValues),
        ...pendingControlValues(state.pendingControl),
      ];
    }
    const annotationRoots = this.annotationsForObject(value);
    const hiddenAnnotationValues =
      annotationRoots === undefined
        ? []
        : this.managedAnnotationRoots(annotationRoots);
    const hiddenTypeValues: RuntimeValue[] = [];
    const objectTypeParameters = this.typeParametersForObject(value);
    if (objectTypeParameters !== undefined) {
      hiddenTypeValues.push(objectTypeParameters);
    }
    if (isNamespace(value)) {
      const superState = this.superStates.get(value);
      if (superState !== undefined) {
        hiddenTypeValues.push(
          superState.startClass,
          ...(superState.receiver === null ? [] : [superState.receiver]),
          ...(superState.receiverClass === null
            ? []
            : [superState.receiverClass]),
        );
      }
      const parameter = this.typeParameterStates.get(value);
      if (parameter !== undefined) {
        hiddenTypeValues.push(
          ...this.managedLazyValueRoots(parameter.bound),
          ...this.managedLazyValueRoots(parameter.constraints),
          ...this.managedLazyValueRoots(parameter.defaultValue),
        );
      }
      const alias = this.typeAliasStates.get(value);
      if (alias !== undefined) {
        hiddenTypeValues.push(...this.managedLazyValueRoots(alias.value));
      }
    }
    const hiddenValues = [...hiddenAnnotationValues, ...hiddenTypeValues];
    if (
      typeof value !== "object" ||
      value === null ||
      value.kind !== "native_function"
    )
      return hiddenValues;
    const callable = this.callables.get(value);
    if (callable?.kind !== "python") return hiddenValues;
    return [
      ...hiddenValues,
      ...callable.defaults,
      ...(callable.classCell?.initialized === true
        ? [callable.classCell.value]
        : []),
      ...[...callable.closure.values()].flatMap((cell) =>
        cell.initialized ? [cell.value] : [],
      ),
    ];
  }

  private managedAnnotationRoots(
    state: ManagedAnnotations,
  ): readonly RuntimeValue[] {
    const roots: RuntimeValue[] =
      state.activeRoots === undefined ? [] : [state.activeRoots];
    if (state.cache !== undefined) roots.push(state.cache);
    if (state.evaluator !== undefined) {
      roots.push(
        ...(state.evaluator.classCell?.initialized === true
          ? [state.evaluator.classCell.value]
          : []),
        ...[...state.evaluator.closure.values()].flatMap((cell) =>
          cell.initialized ? [cell.value] : [],
        ),
      );
      if (state.evaluator.annotationLocals !== undefined) {
        roots.push({
          kind: "namespace",
          name: "<annotation locals>",
          values: state.evaluator.annotationLocals,
        });
      }
    }
    return roots;
  }

  private managedLazyValueRoots(
    state: ManagedLazyValue,
  ): readonly RuntimeValue[] {
    const roots: RuntimeValue[] = [state.fallback];
    if (state.cache !== undefined) roots.push(state.cache);
    if (state.evaluator !== undefined) {
      roots.push(
        ...(state.evaluator.classCell?.initialized === true
          ? [state.evaluator.classCell.value]
          : []),
        ...[...state.evaluator.closure.values()].flatMap((cell) =>
          cell.initialized ? [cell.value] : [],
        ),
      );
      if (state.evaluator.annotationLocals !== undefined) {
        roots.push({
          kind: "namespace",
          name: "<lazy type locals>",
          values: state.evaluator.annotationLocals,
        });
      }
    }
    return roots;
  }

  private noteAllocation(bytes: number): void {
    this.heapAccounting.noteAllocation(bytes);
  }
}

function continued(cycles: number): Cs486SyscallResult {
  return { cycles, kind: "continue" };
}

function requireNativeArity(
  name: string,
  positional: readonly RuntimeValue[],
  keywords: ReadonlyMap<string, RuntimeValue>,
  expected: number,
): void {
  if (keywords.size > 0 || positional.length !== expected) {
    throw new VmRuntimeError(
      "TypeError",
      `${name}() takes exactly ${String(expected)} positional argument${expected === 1 ? "" : "s"}`,
    );
  }
}

interface ManagedAnnotations {
  readonly activeIds: Set<number>;
  activeRoots?: RuntimeList;
  cache?: RuntimeDictionary;
  cacheable: boolean;
  readonly entryCount: number;
  evaluating: boolean;
  evaluator?: Extract<ManagedCallable, { kind: "python" }>;
}

interface ManagedLazyValue {
  cache?: RuntimeValue;
  evaluating: boolean;
  evaluator?: Extract<ManagedCallable, { kind: "python" }>;
  readonly fallback: RuntimeValue;
}

interface ManagedTypeParameter {
  readonly bound: ManagedLazyValue;
  readonly constraints: ManagedLazyValue;
  readonly defaultValue: ManagedLazyValue;
  readonly kind: TypeParameter["kind"];
}

interface ManagedTypeAlias {
  readonly typeParameters: RuntimeTuple;
  readonly value: ManagedLazyValue;
}

interface ManagedGenericAlias {
  readonly arguments: RuntimeTuple;
  readonly origin: RuntimeValue;
  readonly parameters: RuntimeTuple;
}

interface ManagedSuper {
  readonly receiver: RuntimeClass | RuntimeInstance | null;
  readonly receiverClass: RuntimeClass | null;
  readonly startClass: RuntimeClass;
}

interface TypingSpecialForm {
  readonly arity: number | { readonly minimum: number };
  readonly canonicalOrigin?: RuntimeNamespace;
  readonly name: string;
  readonly transformArguments?: (
    arguments_: readonly RuntimeValue[],
  ) => readonly RuntimeValue[];
}

interface PreparedGenericSubscription {
  readonly arguments: RuntimeValue[];
  readonly defaults: readonly ManagedLazyValue[];
  readonly publishOrigin: RuntimeValue;
  readonly template?: ManagedGenericAlias;
}

interface PendingGenericSubscription {
  readonly arguments: RuntimeValue[];
  defaultIndex: number;
  readonly defaults: readonly ManagedLazyValue[];
  readonly machineStackPointer: number;
  readonly origin: RuntimeValue;
  readonly span: SourceSpan;
  readonly template?: ManagedGenericAlias;
}

function typeParameterNames(owner: AnnotationScopeOwner): readonly string[] {
  return "typeParameters" in owner
    ? owner.typeParameters.map(({ name }) => name)
    : [];
}

function typeScopeDefaultName(index: number): string {
  return `<type-default-${String(index)}>`;
}

function collectAnnotatedAssignments(
  statements: readonly Statement[],
  collected: AnnotatedAssignmentStatement[] = [],
): AnnotatedAssignmentStatement[] {
  for (const statement of statements) {
    switch (statement.kind) {
      case "AnnotatedAssignmentStatement":
        if (
          statement.simpleTarget &&
          statement.target.kind === "IdentifierExpression"
        ) {
          collected.push(statement);
        }
        break;
      case "ForStatement":
      case "WhileStatement":
      case "WithStatement":
        collectAnnotatedAssignments(statement.body, collected);
        break;
      case "IfStatement":
        for (const branch of statement.branches) {
          collectAnnotatedAssignments(branch.body, collected);
        }
        collectAnnotatedAssignments(statement.elseBody ?? [], collected);
        break;
      case "MatchStatement":
        for (const matchCase of statement.cases) {
          collectAnnotatedAssignments(matchCase.body, collected);
        }
        break;
      case "TryStatement":
        collectAnnotatedAssignments(statement.body, collected);
        for (const handler of statement.handlers) {
          collectAnnotatedAssignments(handler.body, collected);
        }
        collectAnnotatedAssignments(statement.elseBody ?? [], collected);
        collectAnnotatedAssignments(statement.finallyBody ?? [], collected);
        break;
      case "AssertStatement":
      case "AssignmentStatement":
      case "AugmentedAssignmentStatement":
      case "BreakStatement":
      case "ClassDefinition":
      case "ContinueStatement":
      case "ExpressionStatement":
      case "FromImportStatement":
      case "FunctionDefinition":
      case "GlobalStatement":
      case "ImportStatement":
      case "NonlocalStatement":
      case "PassStatement":
      case "RaiseStatement":
      case "ReturnStatement":
      case "YieldStatement":
        break;
    }
  }
  return collected;
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
  if (typeof value === "bigint") return value !== 0n;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") return value.length > 0;
  if (isSequence(value)) return value.values.length > 0;
  if (isDictionary(value)) return value.entries.size > 0;
  if (isSet(value)) return value.entries.size > 0;
  return true;
}

function renderFormattedInterpolation(
  interpolation: PythonFormatInterpolationOperation,
  operands: readonly RuntimeValue[],
  cursor: { index: number },
  span: SourceSpan,
  maximumStringLength: number,
): string {
  if (cursor.index >= operands.length) {
    throw new VmRuntimeError(
      "RuntimeError",
      "formatted string operand stack is incomplete",
      span,
    );
  }
  const value = operands[cursor.index++]!;
  let formatSpec = "";
  for (const part of interpolation.formatParts) {
    formatSpec +=
      typeof part === "string"
        ? part
        : renderFormattedInterpolation(
            part,
            operands,
            cursor,
            span,
            maximumStringLength,
          );
    if (formatSpec.length > maximumStringLength) {
      throw new VmLimitError("formatted string", span);
    }
  }
  const converted: RuntimeValue =
    interpolation.conversion === null
      ? value
      : templateConversion(value, interpolation.conversion);
  return formatPythonValue(converted, formatSpec, span, maximumStringLength);
}

function formatPythonValue(
  value: RuntimeValue,
  formatSpec: string,
  span: SourceSpan,
  maximumStringLength: number,
): string {
  if (formatSpec === "") return formatValue(value);
  const parsed =
    /^(?:(.)([<>=^])|([<>=^]))?([+\- ])?(#)?(0)?(\d+)?(?:\.(\d+))?([bcdeEfFgGnosxX%])?$/u.exec(
      formatSpec,
    );
  if (parsed === null) {
    throw new VmRuntimeError(
      "ValueError",
      `Invalid format specifier '${formatSpec}'`,
      span,
    );
  }
  const fill = parsed[1] ?? (parsed[6] === "0" ? "0" : " ");
  const align = parsed[2] ?? parsed[3] ?? (parsed[6] === "0" ? "=" : ">");
  const sign = parsed[4] ?? "";
  const alternate = parsed[5] === "#";
  const width = parsed[7] === undefined ? 0 : Number(parsed[7]);
  const precision = parsed[8] === undefined ? undefined : Number(parsed[8]);
  const type = parsed[9] ?? "";
  if (
    !Number.isSafeInteger(width) ||
    width > maximumStringLength ||
    (precision !== undefined &&
      (!Number.isSafeInteger(precision) || precision > maximumStringLength))
  ) {
    throw new VmLimitError("formatted string", span);
  }

  if (typeof value === "string") {
    if (sign !== "" || alternate || !["", "s"].includes(type)) {
      throw new VmRuntimeError(
        "ValueError",
        `Invalid format specifier '${formatSpec}' for object of type 'str'`,
        span,
      );
    }
    const text = precision === undefined ? value : value.slice(0, precision);
    return applyFormatWidth(
      text,
      "",
      width,
      fill,
      align,
      maximumStringLength,
      span,
    );
  }

  if (typeof value !== "number" && typeof value !== "bigint") {
    throw new VmRuntimeError(
      "TypeError",
      `unsupported format string passed to ${
        value === null
          ? "NoneType"
          : typeof value === "boolean"
            ? "bool"
            : value.kind
      }`,
      span,
    );
  }

  const negative = value < 0;
  const magnitude = negative
    ? typeof value === "bigint"
      ? -value
      : -value
    : value;
  let prefix = negative ? "-" : sign === "+" ? "+" : sign === " " ? " " : "";
  let text: string;
  const integerValue = typeof value === "bigint" || Number.isInteger(value);
  if (
    ["b", "c", "d", "n", "o", "x", "X"].includes(type) ||
    (type === "" && integerValue)
  ) {
    if (!integerValue) {
      throw new VmRuntimeError(
        "ValueError",
        `Unknown format code '${type || "d"}' for object of type 'float'`,
        span,
      );
    }
    const integer =
      typeof magnitude === "bigint" ? magnitude : BigInt(magnitude);
    if (type === "c") {
      if (negative) {
        throw new VmRuntimeError(
          "OverflowError",
          "%c arg not in range(0x110000)",
          span,
        );
      }
      const codePoint = Number(integer);
      if (
        !Number.isSafeInteger(codePoint) ||
        codePoint < 0 ||
        codePoint > 0x10ffff
      ) {
        throw new VmRuntimeError(
          "OverflowError",
          "%c arg not in range(0x110000)",
          span,
        );
      }
      text = String.fromCodePoint(codePoint);
      prefix = "";
    } else {
      const radix =
        type === "b"
          ? 2
          : type === "o"
            ? 8
            : type === "x" || type === "X"
              ? 16
              : 10;
      text = integer.toString(radix);
      if (type === "X") text = text.toUpperCase();
      if (alternate && radix !== 10) {
        prefix +=
          radix === 2 ? "0b" : radix === 8 ? "0o" : type === "X" ? "0X" : "0x";
      }
    }
  } else if (type === "") {
    text = String(magnitude);
  } else {
    const numeric = Number(magnitude);
    const digits = precision ?? 6;
    if (type === "f" || type === "F") text = numeric.toFixed(digits);
    else if (type === "e" || type === "E") text = numeric.toExponential(digits);
    else if (type === "%") text = `${(numeric * 100).toFixed(digits)}%`;
    else if (type === "g" || type === "G") text = numeric.toPrecision(digits);
    else {
      throw new VmRuntimeError(
        "ValueError",
        `Unknown format code '${type}'`,
        span,
      );
    }
    if (type === "E" || type === "F" || type === "G") text = text.toUpperCase();
  }
  return applyFormatWidth(
    text,
    prefix,
    width,
    fill,
    align,
    maximumStringLength,
    span,
  );
}

function applyFormatWidth(
  text: string,
  prefix: string,
  width: number,
  fill: string,
  align: string,
  maximumStringLength: number,
  span: SourceSpan,
): string {
  const length = prefix.length + text.length;
  if (length > maximumStringLength) {
    throw new VmLimitError("formatted string", span);
  }
  const paddingLength = Math.max(0, width - length);
  const padding = fill.repeat(paddingLength);
  if (align === "<") return prefix + text + padding;
  if (align === "^") {
    const left = Math.floor(paddingLength / 2);
    return (
      fill.repeat(left) + prefix + text + fill.repeat(paddingLength - left)
    );
  }
  if (align === "=") return prefix + padding + text;
  return padding + prefix + text;
}

function formatValue(value: RuntimeValue): string {
  if (value === null) return "None";
  if (value === true) return "True";
  if (value === false) return "False";
  if (
    typeof value === "bigint" ||
    typeof value === "string" ||
    typeof value === "number"
  )
    return String(value);
  if (isSequence(value)) return value.values.map(formatValue).join(", ");
  if (isDictionary(value))
    return `{${[...value.entries]
      .map(([key, item]) => `${formatValue(key)}: ${formatValue(item)}`)
      .join(", ")}}`;
  if (isSet(value)) {
    return value.entries.size === 0
      ? "set()"
      : `{${[...value.entries.values()].map(formatValue).join(", ")}}`;
  }
  if (isClass(value)) return `<class '${value.name}'>`;
  if (isInstance(value)) return `<${value.classObject.name} object>`;
  if (isBoundMethod(value)) return `<bound method ${value.callable.name}>`;
  return `<${value.kind}>`;
}

function compare(
  left: RuntimeValue,
  right: RuntimeValue,
  operator: Extract<PythonOperation, { kind: "compare" }>["operators"][number],
  span: SourceSpan,
  maximumHashCodeUnits: number,
): boolean {
  const numericComparison = comparePythonNumbers(left, right);
  if (operator === "is") return left === right;
  if (operator === "is not") return left !== right;
  if (operator === "==")
    return isSet(left) && isSet(right)
      ? setEquals(left, right)
      : numericComparison === undefined
        ? left === right
        : numericComparison === 0;
  if (operator === "!=")
    return isSet(left) && isSet(right)
      ? !setEquals(left, right)
      : numericComparison === undefined
        ? left !== right
        : numericComparison !== 0;
  if (operator === "in" || operator === "not in") {
    const contained = contains(right, left, span, maximumHashCodeUnits);
    return operator === "in" ? contained : !contained;
  }
  if (numericComparison !== undefined) {
    if (operator === "<") return numericComparison < 0;
    if (operator === "<=") return numericComparison <= 0;
    if (operator === ">") return numericComparison > 0;
    return numericComparison >= 0;
  }
  if (!(typeof left === "string" && typeof right === "string"))
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
  maximumHashCodeUnits: number,
): boolean {
  if (typeof container === "string" && typeof item === "string")
    return container.includes(item);
  if (isSequence(container)) return container.values.includes(item);
  if (isDictionary(container)) return container.entries.has(item);
  if (isSet(container)) {
    return container.entries.has(
      runtimeHashKey(item, span, maximumHashCodeUnits),
    );
  }
  throw new VmRuntimeError("TypeError", "Value is not a container", span);
}

function lookupClassAttribute(
  classObject: RuntimeClass,
  name: string,
): RuntimeValue | undefined {
  for (const current of classObject.mro) {
    const value = current.values.get(name);
    if (value !== undefined) return value;
  }
  return undefined;
}

function createRootRuntimeClass(
  name: string,
  values: Map<string, RuntimeValue>,
): RuntimeClass {
  const bases: RuntimeClass[] = [];
  const mro: RuntimeClass[] = [];
  const classObject: RuntimeClass = {
    base: null,
    bases,
    basesValue: { kind: "tuple", values: bases },
    kind: "class",
    mro,
    mroValue: { kind: "tuple", values: mro },
    name,
    values,
  };
  mro.push(classObject);
  return classObject;
}

function computeClassMroTail(
  bases: readonly RuntimeClass[],
  span: SourceSpan,
): readonly RuntimeClass[] {
  const directBases = new Set<RuntimeClass>();
  for (const base of bases) {
    if (directBases.has(base)) {
      throw new VmRuntimeError(
        "TypeError",
        `duplicate base class ${base.name}`,
        span,
      );
    }
    directBases.add(base);
  }

  const sequences = [...bases.map((base) => [...base.mro]), [...bases]];
  const merged: RuntimeClass[] = [];
  while (true) {
    const active = sequences.filter((sequence) => sequence.length > 0);
    if (active.length === 0) return merged;
    let candidate: RuntimeClass | undefined;
    for (const sequence of active) {
      const head = sequence[0]!;
      if (
        active.every((other) => !other.slice(1).some((value) => value === head))
      ) {
        candidate = head;
        break;
      }
    }
    if (candidate === undefined) {
      throw new VmRuntimeError(
        "TypeError",
        "Cannot create a consistent method resolution order (MRO)",
        span,
      );
    }
    if (merged.length >= maximumClassInheritanceDepth - 1) {
      throw new VmLimitError("class method resolution order", span);
    }
    merged.push(candidate);
    for (const sequence of active) {
      if (sequence[0] === candidate) sequence.shift();
    }
  }
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

function deleteSubscript(
  object: RuntimeValue,
  index: RuntimeValue,
  span: SourceSpan,
): void {
  if (typeof object === "object" && object !== null && object.kind === "list") {
    object.values.splice(normalizeIndex(index, object.values.length, span), 1);
    return;
  }
  if (isDictionary(object)) {
    if (!object.entries.delete(index)) {
      throw new VmRuntimeError("KeyError", formatValue(index), span);
    }
    return;
  }
  throw new VmRuntimeError("TypeError", "Subscript is not deletable", span);
}

interface NormalizedSlice {
  readonly indices: readonly number[];
  readonly start: number;
  readonly stop: number;
  readonly step: number;
}

function loadSlice(
  object: RuntimeValue,
  start: RuntimeValue,
  stop: RuntimeValue,
  step: RuntimeValue,
  span: SourceSpan,
): RuntimeValue {
  if (typeof object === "string") {
    const characters = [...object];
    const slice = normalizeSlice(start, stop, step, characters.length, span);
    return slice.indices.map((index) => characters[index]!).join("");
  }
  if (isSequence(object)) {
    const slice = normalizeSlice(start, stop, step, object.values.length, span);
    const values = slice.indices.map((index) => object.values[index]!);
    return object.kind === "list"
      ? { kind: "list", values }
      : { kind: "tuple", values };
  }
  throw new VmRuntimeError("TypeError", "Value is not sliceable", span);
}

function storeSlice(
  object: RuntimeValue,
  start: RuntimeValue,
  stop: RuntimeValue,
  step: RuntimeValue,
  value: RuntimeValue,
  span: SourceSpan,
  maximumCollectionSize: number,
): number {
  if (typeof object !== "object" || object === null || object.kind !== "list") {
    throw new VmRuntimeError("TypeError", "Slice target is not writable", span);
  }
  normalizeSlice(start, stop, step, object.values.length, span);
  const replacement = consumeIterable(value, span);
  return storeSliceValues(
    object,
    start,
    stop,
    step,
    replacement,
    span,
    maximumCollectionSize,
  );
}

function storeSliceValues(
  object: RuntimeValue,
  start: RuntimeValue,
  stop: RuntimeValue,
  step: RuntimeValue,
  replacement: readonly RuntimeValue[],
  span: SourceSpan,
  maximumCollectionSize: number,
): number {
  if (typeof object !== "object" || object === null || object.kind !== "list") {
    throw new VmRuntimeError("TypeError", "Slice target is not writable", span);
  }
  const slice = normalizeSlice(start, stop, step, object.values.length, span);
  if (slice.step === 1) {
    const removed = Math.max(0, slice.stop - slice.start);
    const finalLength = object.values.length - removed + replacement.length;
    if (finalLength > maximumCollectionSize) {
      throw new VmLimitError("collection", span);
    }
    object.values.splice(slice.start, removed, ...replacement);
    return Math.max(0, replacement.length - removed) * 8;
  }
  if (replacement.length !== slice.indices.length) {
    throw new VmRuntimeError(
      "ValueError",
      `attempt to assign ${String(replacement.length)} values to extended slice of size ${String(slice.indices.length)}`,
      span,
    );
  }
  slice.indices.forEach((index, replacementIndex) => {
    object.values[index] = replacement[replacementIndex]!;
  });
  return 0;
}

function deleteSlice(
  object: RuntimeValue,
  start: RuntimeValue,
  stop: RuntimeValue,
  step: RuntimeValue,
  span: SourceSpan,
): void {
  if (typeof object !== "object" || object === null || object.kind !== "list") {
    throw new VmRuntimeError(
      "TypeError",
      "Slice target is not deletable",
      span,
    );
  }
  const slice = normalizeSlice(start, stop, step, object.values.length, span);
  if (slice.step === 1) {
    object.values.splice(slice.start, Math.max(0, slice.stop - slice.start));
    return;
  }
  for (const index of [...slice.indices].sort((left, right) => right - left)) {
    object.values.splice(index, 1);
  }
}

function normalizeSlice(
  startValue: RuntimeValue,
  stopValue: RuntimeValue,
  stepValue: RuntimeValue,
  length: number,
  span: SourceSpan,
): NormalizedSlice {
  const readIndex = (value: RuntimeValue): number | undefined => {
    if (value === null) return undefined;
    if (typeof value === "bigint") {
      if (value > BigInt(Number.MAX_SAFE_INTEGER))
        return Number.POSITIVE_INFINITY;
      if (value < BigInt(Number.MIN_SAFE_INTEGER))
        return Number.NEGATIVE_INFINITY;
      return Number(value);
    }
    const number = requireHostNumber(value, span);
    if (!Number.isInteger(number)) {
      throw new VmRuntimeError(
        "TypeError",
        "Slice indices must be integers",
        span,
      );
    }
    return number;
  };
  const step = readIndex(stepValue) ?? 1;
  if (step === 0) {
    throw new VmRuntimeError("ValueError", "slice step cannot be zero", span);
  }
  const requestedStart = readIndex(startValue);
  const requestedStop = readIndex(stopValue);
  let start: number;
  let stop: number;
  if (step > 0) {
    start = normalizeSliceBound(requestedStart, length, 0, step);
    stop = normalizeSliceBound(requestedStop, length, length, step);
  } else {
    start = normalizeSliceBound(requestedStart, length, length - 1, step);
    stop = normalizeSliceBound(requestedStop, length, -1, step);
  }
  const indices: number[] = [];
  if (step > 0) {
    for (let index = start; index < stop; index += step) indices.push(index);
  } else {
    for (let index = start; index > stop; index += step) indices.push(index);
  }
  return { indices, start, stop, step };
}

function normalizeSliceBound(
  requested: number | undefined,
  length: number,
  omitted: number,
  step: number,
): number {
  if (requested === undefined) return omitted;
  let value = requested < 0 ? requested + length : requested;
  if (step > 0) value = Math.max(0, Math.min(length, value));
  else value = Math.max(-1, Math.min(length - 1, value));
  return value;
}

function normalizeIndex(
  index: RuntimeValue,
  length: number,
  span: SourceSpan,
): number {
  const number = requireHostNumber(index, span);
  if (!Number.isInteger(number))
    throw new VmRuntimeError("TypeError", "Index must be an integer", span);
  const normalized = number < 0 ? length + number : number;
  if (normalized < 0 || normalized >= length)
    throw new VmRuntimeError("IndexError", "index out of range", span);
  return normalized;
}

function isTemplateInterpolationValue(
  value: RuntimeValue,
): value is RuntimeNamespace {
  return isNamespace(value) && value.name === "Interpolation";
}

function isTemplateValue(value: RuntimeValue): value is RuntimeNamespace {
  return isNamespace(value) && value.name === "Template";
}

function templateValueParts(template: RuntimeNamespace): {
  readonly interpolations: readonly RuntimeNamespace[];
  readonly strings: readonly string[];
} {
  const stringsValue = template.values.get("strings");
  const interpolationsValue = template.values.get("interpolations");
  if (
    stringsValue === undefined ||
    !isSequence(stringsValue) ||
    !stringsValue.values.every(
      (value): value is string => typeof value === "string",
    ) ||
    interpolationsValue === undefined ||
    !isSequence(interpolationsValue) ||
    !interpolationsValue.values.every(isTemplateInterpolationValue)
  ) {
    throw new VmRuntimeError("RuntimeError", "Invalid Template value");
  }
  return {
    interpolations: interpolationsValue.values as readonly RuntimeNamespace[],
    strings: stringsValue.values as readonly string[],
  };
}

function templateConversion(
  value: RuntimeValue,
  conversion: "a" | "r" | "s",
): string {
  if (conversion === "s") return formatValue(value);
  const represented =
    typeof value === "string"
      ? pythonStringRepresentation(value, conversion === "a")
      : value === null
        ? "None"
        : value === true
          ? "True"
          : value === false
            ? "False"
            : formatValue(value);
  if (conversion === "r" || typeof value === "string") return represented;
  return asciiEscape(represented);
}

function pythonStringRepresentation(value: string, asciiOnly: boolean): string {
  let represented = "'";
  for (const character of value) {
    const codePoint = character.codePointAt(0)!;
    if (character === "\\") represented += "\\\\";
    else if (character === "'") represented += "\\'";
    else if (character === "\n") represented += "\\n";
    else if (character === "\r") represented += "\\r";
    else if (character === "\t") represented += "\\t";
    else if (
      codePoint < 0x20 ||
      codePoint === 0x7f ||
      (asciiOnly && codePoint > 0x7e)
    ) {
      represented += escapePythonCodePoint(codePoint);
    } else represented += character;
  }
  return `${represented}'`;
}

function asciiEscape(value: string): string {
  return [...value]
    .map((character) => {
      const codePoint = character.codePointAt(0)!;
      return codePoint >= 0x20 && codePoint <= 0x7e
        ? character
        : escapePythonCodePoint(codePoint);
    })
    .join("");
}

function escapePythonCodePoint(codePoint: number): string {
  if (codePoint <= 0xff) return `\\x${codePoint.toString(16).padStart(2, "0")}`;
  return codePoint <= 0xffff
    ? `\\u${codePoint.toString(16).padStart(4, "0")}`
    : `\\U${codePoint.toString(16).padStart(8, "0")}`;
}

function iteratorValue(
  value: RuntimeValue,
  span: SourceSpan,
): RuntimeGenerator | RuntimeIterator | RuntimeSequenceIterator {
  if (isGenerator(value) || isIterator(value) || isSequenceIterator(value))
    return value;
  let values: readonly RuntimeValue[];
  if (typeof value === "string") values = [...value];
  else if (isTemplateValue(value)) {
    const parts = templateValueParts(value);
    values = parts.interpolations.flatMap((interpolation, index) => [
      ...(parts.strings[index] === "" ? [] : [parts.strings[index]!]),
      interpolation,
    ]);
    if (parts.strings.at(-1) !== "")
      values = [...values, parts.strings.at(-1)!];
  } else if (isSequence(value)) values = value.values;
  else if (isDictionary(value)) values = [...value.entries.keys()];
  else if (isSet(value)) values = [...value.entries.values()];
  else throw new VmRuntimeError("TypeError", "Value is not iterable", span);
  return { index: 0, kind: "iterator", values };
}

type RuntimeIteratorStep =
  | { readonly done: true }
  | { readonly done: false; readonly value: RuntimeValue };

function nextIteratorValue(iterator: RuntimeIterator): RuntimeIteratorStep {
  if (iterator.index >= iterator.values.length) return { done: true };
  const value = iterator.values[iterator.index]!;
  iterator.index += 1;
  return { done: false, value };
}

function consumeIterable(
  value: RuntimeValue,
  span: SourceSpan,
): RuntimeValue[] {
  const iterator = iteratorValue(value, span);
  if (!isIterator(iterator)) {
    throw new VmRuntimeError(
      "TypeError",
      "Generator consumption outside for/next is not available in this phase",
      span,
    );
  }
  const values = iterator.values.slice(iterator.index);
  iterator.index = iterator.values.length;
  return [...values];
}

function isIterator(value: RuntimeValue): value is RuntimeIterator {
  return (
    typeof value === "object" && value !== null && value.kind === "iterator"
  );
}

function isManagedIterableSource(
  value: RuntimeValue,
): value is RuntimeGenerator | RuntimeInstance | RuntimeSequenceIterator {
  return isGenerator(value) || isInstance(value) || isSequenceIterator(value);
}

function isSequenceIterator(
  value: RuntimeValue,
): value is RuntimeSequenceIterator {
  return (
    typeof value === "object" &&
    value !== null &&
    value.kind === "sequence_iterator"
  );
}

function isGenerator(value: RuntimeValue): value is RuntimeGenerator {
  return (
    typeof value === "object" && value !== null && value.kind === "generator"
  );
}

function isAsyncGenerator(value: RuntimeValue): value is RuntimeAsyncGenerator {
  return (
    typeof value === "object" &&
    value !== null &&
    value.kind === "async_generator"
  );
}

function isAsyncGeneratorOperation(
  value: RuntimeValue,
): value is RuntimeAsyncGeneratorOperation {
  return (
    typeof value === "object" &&
    value !== null &&
    value.kind === "async_generator_operation"
  );
}

function isCoroutine(value: RuntimeValue): value is RuntimeCoroutine {
  return (
    typeof value === "object" && value !== null && value.kind === "coroutine"
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

function findDictionaryPatternEntry(
  dictionary: RuntimeDictionary,
  requested: RuntimeValue,
): { readonly key: RuntimeValue; readonly value: RuntimeValue } | undefined {
  const candidates: RuntimeValue[] = [requested];
  if (typeof requested === "boolean") {
    candidates.push(requested ? 1 : 0, requested ? 1n : 0n);
  } else if (typeof requested === "number" && Number.isSafeInteger(requested)) {
    candidates.push(BigInt(requested));
    if (requested === 0 || requested === 1) candidates.push(requested === 1);
  } else if (
    typeof requested === "bigint" &&
    requested >= BigInt(Number.MIN_SAFE_INTEGER) &&
    requested <= BigInt(Number.MAX_SAFE_INTEGER)
  ) {
    const numeric = Number(requested);
    candidates.push(numeric);
    if (requested === 0n || requested === 1n) candidates.push(requested === 1n);
  }
  for (const candidate of candidates) {
    if (dictionary.entries.has(candidate)) {
      return { key: candidate, value: dictionary.entries.get(candidate)! };
    }
  }
  return undefined;
}

function isSet(
  value: RuntimeValue,
): value is Extract<RuntimeValue, { kind: "set" }> {
  return typeof value === "object" && value !== null && value.kind === "set";
}

function setEquals(
  left: Extract<RuntimeValue, { kind: "set" }>,
  right: Extract<RuntimeValue, { kind: "set" }>,
): boolean {
  return (
    left.entries.size === right.entries.size &&
    [...left.entries.keys()].every((key) => right.entries.has(key))
  );
}

function runtimeHashKey(
  value: RuntimeValue,
  span?: SourceSpan,
  maximumCodeUnits = defaultPythonRuntimeLimits.maxStringLength,
): string {
  const chunks: string[] = [];
  const activeTuples = new Set<object>();
  let length = 0;
  const append = (chunk: string): void => {
    if (length + chunk.length > maximumCodeUnits) {
      throw new VmLimitError("set hash", span);
    }
    chunks.push(chunk);
    length += chunk.length;
  };
  const visit = (item: RuntimeValue, depth: number): void => {
    if (item === null) {
      append("N;");
    } else if (typeof item === "boolean") {
      append(item ? "I1;" : "I0;");
    } else if (typeof item === "bigint") {
      append(`I${item.toString()};`);
    } else if (typeof item === "number") {
      if (Number.isFinite(item) && Number.isInteger(item)) {
        append(`I${BigInt(item).toString()};`);
      } else {
        append(`F${String(item)};`);
      }
    } else if (typeof item === "string") {
      append(`S${String(item.length)}:`);
      append(item);
    } else if (item.kind === "tuple") {
      if (depth >= 64) throw new VmLimitError("set hash nesting", span);
      if (activeTuples.has(item)) {
        throw new VmRuntimeError(
          "ValueError",
          "recursive tuple is unhashable",
          span,
        );
      }
      activeTuples.add(item);
      append(`T${String(item.values.length)}[`);
      for (const nested of item.values) visit(nested, depth + 1);
      append("]");
      activeTuples.delete(item);
    } else {
      throw new VmRuntimeError(
        "TypeError",
        `unhashable type: ${item.kind}`,
        span,
      );
    }
  };
  visit(value, 0);
  return chunks.join("");
}

function setEntryBytes(key: string): number {
  return utf8ByteLength(key) + 16;
}

function isNamespace(value: RuntimeValue): value is RuntimeNamespace {
  return (
    typeof value === "object" && value !== null && value.kind === "namespace"
  );
}

function isClass(value: RuntimeValue | undefined): value is RuntimeClass {
  return typeof value === "object" && value !== null && value.kind === "class";
}

function isInstance(value: RuntimeValue): value is RuntimeInstance {
  return (
    typeof value === "object" && value !== null && value.kind === "instance"
  );
}

function isBoundMethod(value: RuntimeValue): value is RuntimeBoundMethod {
  return (
    typeof value === "object" && value !== null && value.kind === "bound_method"
  );
}

function isNativeFunction(value: RuntimeValue): value is NativeFunction {
  return (
    typeof value === "object" &&
    value !== null &&
    value.kind === "native_function"
  );
}

function boolFunction(): NativeFunction {
  return nativeFunction("bool", (positional, keywords) => {
    if (keywords.size > 0 || positional.length > 1) {
      throw new VmRuntimeError(
        "TypeError",
        "bool expects at most one positional argument",
      );
    }
    return positional.length === 0 ? false : truthy(positional[0]!);
  });
}

function intFunction(maxIntegerBits: number): NativeFunction {
  return nativeFunction("int", (positional, keywords) => {
    if (keywords.size > 0 || positional.length > 1) {
      throw new VmRuntimeError(
        "TypeError",
        "int expects at most one positional argument",
      );
    }
    const value = positional[0];
    if (value === undefined) return 0;
    if (typeof value === "boolean") return value ? 1 : 0;
    if (typeof value === "bigint") return value;
    if (typeof value === "number") {
      if (!Number.isFinite(value)) {
        throw new VmRuntimeError(
          "OverflowError",
          "cannot convert non-finite float to integer",
        );
      }
      return Math.trunc(value);
    }
    if (typeof value === "string") {
      const stripped = value.trim();
      if (!/^[+-]?\d+$/.test(stripped)) {
        throw new VmRuntimeError("ValueError", "invalid literal for int");
      }
      const result = BigInt(stripped);
      if (pythonIntegerBitLength(result) > maxIntegerBits) {
        throw new VmLimitError("integer bits");
      }
      const number = Number(result);
      return Number.isSafeInteger(number) ? number : result;
    }
    throw new VmRuntimeError(
      "TypeError",
      "int argument must be numeric or text",
    );
  });
}

function strFunction(maxStringLength: number): NativeFunction {
  return nativeFunction("str", (positional, keywords) => {
    if (keywords.size > 0 || positional.length > 1) {
      throw new VmRuntimeError(
        "TypeError",
        "str expects at most one positional argument",
      );
    }
    const value = positional[0];
    const result =
      value === undefined
        ? ""
        : typeof value === "string"
          ? value
          : formatValue(value);
    if (result.length > maxStringLength) throw new VmLimitError("string");
    return result;
  });
}

function listFunction(maximumCollectionSize: number): NativeFunction {
  return nativeFunction("list", (positional, keywords) => {
    if (keywords.size > 0 || positional.length > 1) {
      throw new VmRuntimeError(
        "TypeError",
        "list expects at most one positional argument",
      );
    }
    const values =
      positional.length === 0
        ? []
        : consumeIterable(positional[0]!, emptySpan());
    if (values.length > maximumCollectionSize) {
      throw new VmLimitError("collection");
    }
    return { kind: "list", values };
  });
}

function tupleFunction(maximumCollectionSize: number): NativeFunction {
  return nativeFunction("tuple", (positional, keywords) => {
    if (keywords.size > 0 || positional.length > 1) {
      throw new VmRuntimeError(
        "TypeError",
        "tuple expects at most one positional argument",
      );
    }
    const values =
      positional.length === 0
        ? []
        : consumeIterable(positional[0]!, emptySpan());
    if (values.length > maximumCollectionSize) {
      throw new VmLimitError("collection");
    }
    return { kind: "tuple", values };
  });
}

function dictFunction(maximumCollectionSize: number): NativeFunction {
  return nativeFunction("dict", (positional, keywords) => {
    if (positional.length > 1) {
      throw new VmRuntimeError(
        "TypeError",
        "dict expects at most one positional argument",
      );
    }
    const entries = new Map<RuntimeValue, RuntimeValue>();
    if (positional.length === 1) {
      const source = positional[0]!;
      if (!isDictionary(source)) {
        throw new VmRuntimeError(
          "TypeError",
          "dict positional argument must be a dictionary in this CS Profile",
        );
      }
      for (const [key, value] of source.entries) entries.set(key, value);
    }
    for (const [key, value] of keywords) entries.set(key, value);
    if (entries.size > maximumCollectionSize) {
      throw new VmLimitError("collection");
    }
    return { entries, kind: "dictionary" };
  });
}

function iterFunction(): NativeFunction {
  return nativeFunction("iter", (positional, keywords) => {
    if (keywords.size > 0 || positional.length !== 1) {
      throw new VmRuntimeError(
        "TypeError",
        "iter expects one or two positional arguments",
      );
    }
    return iteratorValue(positional[0]!, emptySpan());
  });
}

function nextFunction(): NativeFunction {
  return nativeFunction("next", (positional, keywords) => {
    if (keywords.size > 0 || positional.length < 1 || positional.length > 2) {
      throw new VmRuntimeError(
        "TypeError",
        "next expects one or two positional arguments",
      );
    }
    const iterator = positional[0]!;
    if (isGenerator(iterator)) {
      throw new VmRuntimeError(
        "RuntimeError",
        "managed generator escaped the CS486 resume path",
      );
    }
    if (isSequenceIterator(iterator)) {
      throw new VmRuntimeError(
        "RuntimeError",
        "managed sequence iterator escaped the CS486 call path",
      );
    }
    if (!isIterator(iterator)) {
      throw new VmRuntimeError("TypeError", "next requires an iterator");
    }
    const step = nextIteratorValue(iterator);
    if (!step.done) return step.value;
    if (positional.length === 2) return positional[1]!;
    throw new VmRuntimeError("StopIteration", "");
  });
}

function generatorSendFunction(): NativeFunction {
  return nativeFunction("send", () => {
    throw new VmRuntimeError(
      "RuntimeError",
      "managed generator send escaped the CS486 resume path",
    );
  });
}

function generatorThrowFunction(): NativeFunction {
  return nativeFunction("throw", () => {
    throw new VmRuntimeError(
      "RuntimeError",
      "managed generator throw escaped the CS486 resume path",
    );
  });
}

function generatorCloseFunction(): NativeFunction {
  return nativeFunction("close", () => {
    throw new VmRuntimeError(
      "RuntimeError",
      "managed generator close escaped the CS486 resume path",
    );
  });
}

function asyncGeneratorIterFunction(): NativeFunction {
  return nativeFunction("__aiter__", (positional, keywords) => {
    if (
      keywords.size > 0 ||
      positional.length !== 1 ||
      !isAsyncGenerator(positional[0]!)
    ) {
      throw new VmRuntimeError(
        "TypeError",
        "async generator __aiter__ expects no arguments",
      );
    }
    return positional[0];
  });
}

function asyncGeneratorOperationFunction(
  name: string,
  operation: RuntimeAsyncGeneratorOperation["operation"],
  minimumArguments: number,
  maximumArguments: number,
): NativeFunction {
  return nativeFunction(name, (positional, keywords) => {
    if (
      keywords.size > 0 ||
      positional.length < minimumArguments + 1 ||
      positional.length > maximumArguments + 1 ||
      !isAsyncGenerator(positional[0]!)
    ) {
      throw new VmRuntimeError(
        "TypeError",
        `${name} expects ${minimumArguments === maximumArguments ? String(minimumArguments) : `${minimumArguments} to ${maximumArguments}`} positional arguments`,
      );
    }
    return {
      arguments: positional.slice(1),
      generator: positional[0],
      kind: "async_generator_operation",
      operation,
      state: "created",
    };
  });
}

function rangeFunction(maximumCollectionSize: number): NativeFunction {
  return nativeFunction("range", (positional, keywords) => {
    if (keywords.size > 0 || positional.length < 1 || positional.length > 3)
      throw new VmRuntimeError(
        "TypeError",
        "range expects one to three positional arguments",
      );
    const numbers = positional.map((value) => requireHostNumber(value));
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

function setFunction(
  maximumCollectionSize: number,
  maximumHashCodeUnits: number,
): NativeFunction {
  return nativeFunction("set", (positional, keywords) => {
    if (keywords.size > 0 || positional.length > 1) {
      throw new VmRuntimeError(
        "TypeError",
        "set expects zero or one positional argument",
      );
    }
    const entries = new Map<string, RuntimeValue>();
    if (positional.length === 1) {
      for (const value of consumeIterable(positional[0]!, emptySpan())) {
        const key = runtimeHashKey(value, undefined, maximumHashCodeUnits);
        if (entries.has(key)) continue;
        if (entries.size >= maximumCollectionSize) {
          throw new VmLimitError("collection");
        }
        entries.set(key, value);
      }
    }
    return { entries, kind: "set" };
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
    if (isSet(value)) return value.entries.size;
    throw new VmRuntimeError("TypeError", "object has no len");
  });
}

function isinstanceFunction(
  objectClass: RuntimeClass,
  templatelibModule: RuntimeNamespace,
): NativeFunction {
  return nativeFunction("isinstance", (positional, keywords) => {
    if (keywords.size > 0 || positional.length !== 2) {
      throw new VmRuntimeError(
        "TypeError",
        "isinstance expects two positional arguments",
      );
    }
    const expected = positional[1];
    const exceptionType =
      typeof expected === "object" &&
      expected !== null &&
      expected.kind === "native_function" &&
      exceptionNames.has(expected.name)
        ? expected.name
        : undefined;
    const templateType =
      expected === templatelibModule.values.get("Template")
        ? "Template"
        : expected === templatelibModule.values.get("Interpolation")
          ? "Interpolation"
          : undefined;
    if (
      !isClass(expected) &&
      exceptionType === undefined &&
      templateType === undefined
    ) {
      throw new VmRuntimeError(
        "TypeError",
        "isinstance second argument must be a class",
      );
    }
    if (expected === objectClass) return true;
    const value = positional[0]!;
    if (templateType !== undefined) {
      return isNamespace(value) && value.name === templateType;
    }
    if (exceptionType !== undefined) {
      return (
        isExceptionValue(value) && exceptionMatches(exceptionType, value.name)
      );
    }
    if (!isClass(expected)) {
      throw new VmRuntimeError(
        "TypeError",
        "isinstance second argument must be a class",
      );
    }
    return isInstance(value) && classIsSubclass(value.classObject, expected);
  });
}

function issubclassFunction(): NativeFunction {
  return nativeFunction("issubclass", (positional, keywords) => {
    if (keywords.size > 0 || positional.length !== 2) {
      throw new VmRuntimeError(
        "TypeError",
        "issubclass expects two positional arguments",
      );
    }
    const candidate = positional[0];
    const expected = positional[1];
    const candidateException =
      typeof candidate === "object" &&
      candidate !== null &&
      candidate.kind === "native_function" &&
      exceptionNames.has(candidate.name)
        ? candidate.name
        : undefined;
    const expectedException =
      typeof expected === "object" &&
      expected !== null &&
      expected.kind === "native_function" &&
      exceptionNames.has(expected.name)
        ? expected.name
        : undefined;
    if (candidateException !== undefined && expectedException !== undefined) {
      return exceptionMatches(expectedException, candidateException);
    }
    if (!isClass(candidate) || !isClass(expected)) {
      throw new VmRuntimeError(
        "TypeError",
        "issubclass arguments must be classes",
      );
    }
    return classIsSubclass(candidate, expected);
  });
}

function classIsSubclass(
  candidate: RuntimeClass,
  expected: RuntimeClass,
): boolean {
  return candidate.mro.some((current) => current === expected);
}

const exceptionNames = new Set([
  "AssertionError",
  "AttributeError",
  "BaseException",
  "BaseExceptionGroup",
  "Exception",
  "ExceptionGroup",
  "GeneratorExit",
  "RuntimeError",
  "StopAsyncIteration",
  "StopIteration",
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
    const value = exceptionValue(
      typeName,
      positional.length === 0 ? "" : formatValue(positional[0]!),
    );
    if (typeName === "StopIteration") {
      value.values.set("value", positional[0] ?? null);
    }
    return value;
  });
}

function exceptionValue(typeName: string, message: string): RuntimeNamespace {
  return {
    kind: "namespace",
    name: typeName,
    values: new Map([
      ["type", typeName],
      ["message", message],
    ]),
  };
}

function generatorThrownFault(
  positional: readonly RuntimeValue[],
  span: SourceSpan,
): VmRuntimeError {
  const [exceptionOrType, value, traceback] = positional;
  if (traceback !== undefined && traceback !== null) {
    throw new VmRuntimeError(
      "TypeError",
      "generator.throw traceback must be None in this profile",
      span,
    );
  }
  if (
    isNamespace(exceptionOrType!) &&
    exceptionNames.has(exceptionOrType.name)
  ) {
    if (positional.length !== 1) {
      throw new VmRuntimeError(
        "TypeError",
        "generator.throw exception instances accept no separate value",
        span,
      );
    }
    return faultFromValue(exceptionOrType, span);
  }
  if (
    typeof exceptionOrType === "object" &&
    exceptionOrType !== null &&
    exceptionOrType.kind === "native_function" &&
    exceptionNames.has(exceptionOrType.name)
  ) {
    let instance: RuntimeNamespace;
    if (isNamespace(value!) && exceptionNames.has(value.name)) {
      if (value.name !== exceptionOrType.name) {
        throw new VmRuntimeError(
          "TypeError",
          "generator.throw value must match the exception type",
          span,
        );
      }
      instance = value;
    } else {
      instance = exceptionValue(
        exceptionOrType.name,
        value === undefined ? "" : formatValue(value),
      );
    }
    const message = instance.values.get("message");
    return new VmRuntimeError(
      exceptionOrType.name,
      typeof message === "string" ? message : formatValue(message ?? ""),
      span,
      instance,
    );
  }
  throw new VmRuntimeError(
    "TypeError",
    "exceptions must derive from BaseException",
    span,
  );
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
  if (
    typeof value === "object" &&
    value !== null &&
    value.kind === "native_function" &&
    exceptionNames.has(value.name)
  ) {
    const instance = exceptionValue(value.name, "");
    return new VmRuntimeError(value.name, "", span, instance);
  }
  throw new VmRuntimeError("RuntimeError", formatValue(value), span, value);
}

function faultValue(fault: VmRuntimeError): RuntimeNamespace {
  const value = exceptionValue(fault.typeName, fault.message);
  if (fault.typeName === "StopIteration") {
    value.values.set("value", fault.value ?? null);
  }
  return value;
}

function stopIterationResult(fault: VmRuntimeError): RuntimeValue {
  if (isNamespace(fault.value!) && fault.value.name === "StopIteration") {
    return fault.value.values.get("value") ?? null;
  }
  return fault.value ?? null;
}

function caughtFaultValue(fault: VmRuntimeError): RuntimeValue {
  return isNamespace(fault.value!) && fault.value.name === fault.typeName
    ? fault.value
    : faultValue(fault);
}

function managedFaultValues(
  fault: VmRuntimeError | undefined,
): readonly RuntimeValue[] {
  return fault?.value === undefined ? [] : [fault.value];
}

function pendingControlValues(
  pending: PendingControl | undefined,
): readonly RuntimeValue[] {
  if (pending === undefined) return [];
  if (pending.kind === "fault") return managedFaultValues(pending.error);
  return pending.action.kind === "return" ? [pending.action.value] : [];
}

function exceptionMatchesAny(
  expected: readonly string[] | undefined,
  actual: string,
): boolean {
  return (
    expected === undefined ||
    expected.some((typeName) => exceptionMatches(typeName, actual))
  );
}

function exceptionMatches(expected: string, actual: string): boolean {
  return (
    expected === "BaseException" ||
    expected === actual ||
    (expected === "BaseExceptionGroup" && actual === "ExceptionGroup") ||
    (expected === "Exception" &&
      actual !== "BaseException" &&
      actual !== "BaseExceptionGroup" &&
      actual !== "GeneratorExit")
  );
}

function requireExceptStarList(
  state: RuntimeNamespace,
  name: "raised" | "reraised",
  span: SourceSpan,
): RuntimeValue[] {
  const raised = state.values.get(name);
  if (typeof raised !== "object" || raised === null || raised.kind !== "list") {
    throw new VmRuntimeError(
      "RuntimeError",
      `except* continuation lost ${name} exceptions`,
      span,
    );
  }
  return raised.values;
}

function mergeOriginalExceptionSubgroups(
  original: RuntimeValue,
  subgroups: readonly RuntimeValue[],
  maximumNodes: number,
): RuntimeValue | null {
  const selected = new Map<RuntimeNamespace, number>();
  let nodes = 0;
  const collect = (value: RuntimeValue, depth: number): void => {
    nodes += 1;
    if (nodes > maximumNodes) throw new VmLimitError("exception group nodes");
    if (depth > 64) throw new VmLimitError("exception group depth");
    if (!isExceptionValue(value)) {
      throw new VmRuntimeError(
        "TypeError",
        "except* merge received a non-exception value",
      );
    }
    if (!isExceptionGroupValue(value)) {
      selected.set(value, (selected.get(value) ?? 0) + 1);
      return;
    }
    const children = value.values.get("exceptions");
    if (!isTupleValue(children)) {
      throw new VmRuntimeError(
        "ValueError",
        "exception group has invalid exceptions",
      );
    }
    for (const child of children.values) collect(child, depth + 1);
  };
  for (const subgroup of subgroups) collect(subgroup, 1);

  nodes = 0;
  const rebuild = (value: RuntimeValue, depth: number): RuntimeValue | null => {
    nodes += 1;
    if (nodes > maximumNodes) throw new VmLimitError("exception group nodes");
    if (depth > 64) throw new VmLimitError("exception group depth");
    if (!isExceptionValue(value)) {
      throw new VmRuntimeError(
        "TypeError",
        "except* original tree contains a non-exception value",
      );
    }
    if (!isExceptionGroupValue(value)) {
      const count = selected.get(value) ?? 0;
      if (count === 0) return null;
      if (count === 1) selected.delete(value);
      else selected.set(value, count - 1);
      return value;
    }
    const source = value.values.get("exceptions");
    if (!isTupleValue(source)) {
      throw new VmRuntimeError(
        "ValueError",
        "exception group has invalid exceptions",
      );
    }
    const children = source.values
      .map((child) => rebuild(child, depth + 1))
      .filter((child): child is RuntimeValue => child !== null);
    if (children.length === 0) return null;
    if (
      children.length === source.values.length &&
      children.every((child, index) => child === source.values[index])
    ) {
      return value;
    }
    return deriveExceptionGroupValue(
      value,
      value.values.get("message"),
      children,
    );
  };
  return rebuild(original, 1);
}

function isExceptionGroupValue(
  value: RuntimeValue,
): value is RuntimeNamespace & {
  readonly name: "BaseExceptionGroup" | "ExceptionGroup";
} {
  return (
    isNamespace(value) &&
    (value.name === "BaseExceptionGroup" || value.name === "ExceptionGroup")
  );
}

function isExceptionValue(value: RuntimeValue): value is RuntimeNamespace {
  return isNamespace(value) && exceptionNames.has(value.name);
}

function isTupleValue(value: RuntimeValue | undefined): value is RuntimeTuple {
  return typeof value === "object" && value !== null && value.kind === "tuple";
}

function createExceptionGroupValue(
  requestedType: "BaseExceptionGroup" | "ExceptionGroup",
  message: string,
  exceptions: readonly RuntimeValue[],
  maximumNodes: number,
): RuntimeNamespace {
  if (exceptions.length === 0) {
    throw new VmRuntimeError(
      "ValueError",
      "exception group must contain at least one exception",
    );
  }
  if (exceptions.length > maximumNodes) {
    throw new VmLimitError("exception group nodes");
  }
  validateExceptionGroupTree(exceptions, maximumNodes);
  if (
    requestedType === "ExceptionGroup" &&
    !exceptions.every(exceptionDerivesFromException)
  ) {
    throw new VmRuntimeError(
      "TypeError",
      "ExceptionGroup cannot contain BaseException values",
    );
  }
  const actualType =
    requestedType === "BaseExceptionGroup" &&
    exceptions.every(exceptionDerivesFromException)
      ? "ExceptionGroup"
      : requestedType;
  return makeExceptionGroupValue(actualType, message, exceptions);
}

function makeExceptionGroupValue(
  typeName: "BaseExceptionGroup" | "ExceptionGroup",
  message: string,
  exceptions: readonly RuntimeValue[],
): RuntimeNamespace {
  const items: RuntimeTuple = { kind: "tuple", values: [...exceptions] };
  return {
    kind: "namespace",
    name: typeName,
    values: new Map<string, RuntimeValue>([
      ["args", { kind: "tuple", values: [message, items] }],
      ["exceptions", items],
      ["message", message],
      ["type", typeName],
    ]),
  };
}

function validateExceptionGroupTree(
  roots: readonly RuntimeValue[],
  maximumNodes: number,
): void {
  const active = new Set<RuntimeNamespace>();
  const stack: {
    readonly depth: number;
    readonly leaving: boolean;
    readonly value: RuntimeValue;
  }[] = roots
    .slice()
    .reverse()
    .map((value) => ({ depth: 1, leaving: false, value }));
  let nodes = 0;
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (current.leaving) {
      active.delete(current.value as RuntimeNamespace);
      continue;
    }
    nodes += 1;
    if (nodes > maximumNodes) throw new VmLimitError("exception group nodes");
    if (current.depth > 64) throw new VmLimitError("exception group depth");
    if (!isExceptionValue(current.value)) {
      throw new VmRuntimeError(
        "TypeError",
        "exception group items must derive from BaseException",
      );
    }
    if (!isExceptionGroupValue(current.value)) continue;
    if (active.has(current.value)) {
      throw new VmRuntimeError(
        "ValueError",
        "exception group cannot contain a cycle",
      );
    }
    const children = current.value.values.get("exceptions");
    if (!isSequence(children!) || children.values.length === 0) {
      throw new VmRuntimeError(
        "ValueError",
        "exception group has invalid exceptions",
      );
    }
    active.add(current.value);
    stack.push({ ...current, leaving: true });
    for (let index = children.values.length - 1; index >= 0; index -= 1) {
      stack.push({
        depth: current.depth + 1,
        leaving: false,
        value: children.values[index]!,
      });
    }
  }
}

function exceptionDerivesFromException(value: RuntimeValue): boolean {
  if (!isExceptionValue(value)) return false;
  if (value.name === "ExceptionGroup") return true;
  if (value.name === "BaseExceptionGroup") return false;
  return value.name !== "BaseException" && value.name !== "GeneratorExit";
}

function exceptionConditionNames(
  condition: RuntimeValue,
  maximumItems: number,
): readonly string[] {
  const names: string[] = [];
  const pending: RuntimeValue[] = [condition];
  while (pending.length > 0) {
    const value = pending.pop()!;
    if (isTupleValue(value)) {
      for (let index = value.values.length - 1; index >= 0; index -= 1) {
        pending.push(value.values[index]!);
      }
      continue;
    }
    if (
      typeof value !== "object" ||
      value === null ||
      value.kind !== "native_function" ||
      !exceptionNames.has(value.name)
    ) {
      throw new VmRuntimeError(
        "TypeError",
        "exception group condition must be an exception type or tuple",
      );
    }
    names.push(value.name);
    if (names.length > maximumItems) {
      throw new VmLimitError("exception group condition");
    }
  }
  if (names.length === 0) {
    throw new VmRuntimeError(
      "TypeError",
      "exception group condition tuple cannot be empty",
    );
  }
  return names;
}

function isExceptionTypeCondition(condition: RuntimeValue): boolean {
  if (isTupleValue(condition)) {
    return (
      condition.values.length > 0 &&
      condition.values.every(isExceptionTypeCondition)
    );
  }
  return (
    typeof condition === "object" &&
    condition !== null &&
    condition.kind === "native_function" &&
    exceptionNames.has(condition.name)
  );
}

function splitExceptionValue(
  value: RuntimeValue,
  typeNames: readonly string[],
  maximumNodes: number,
  matchGroups = false,
): readonly [RuntimeValue | null, RuntimeValue | null] {
  const work = { nodes: 0 };
  return splitExceptionValueRecursive(
    value,
    typeNames,
    maximumNodes,
    matchGroups,
    work,
    1,
  );
}

function splitExceptionValueRecursive(
  value: RuntimeValue,
  typeNames: readonly string[],
  maximumNodes: number,
  matchGroups: boolean,
  work: { nodes: number },
  depth: number,
): readonly [RuntimeValue | null, RuntimeValue | null] {
  work.nodes += 1;
  if (work.nodes > maximumNodes)
    throw new VmLimitError("exception group nodes");
  if (depth > 64) throw new VmLimitError("exception group depth");
  if (!isExceptionValue(value)) {
    throw new VmRuntimeError(
      "TypeError",
      "exception group contains a non-exception value",
    );
  }
  if (!isExceptionGroupValue(value)) {
    return exceptionMatchesAny(typeNames, value.name)
      ? [value, null]
      : [null, value];
  }
  if (matchGroups && exceptionMatchesAny(typeNames, value.name)) {
    return [value, null];
  }
  const source = value.values.get("exceptions");
  if (!isTupleValue(source)) {
    throw new VmRuntimeError(
      "ValueError",
      "exception group has invalid exceptions",
    );
  }
  const matched: RuntimeValue[] = [];
  const rest: RuntimeValue[] = [];
  for (const child of source.values) {
    const [childMatch, childRest] = splitExceptionValueRecursive(
      child,
      typeNames,
      maximumNodes,
      matchGroups,
      work,
      depth + 1,
    );
    if (childMatch !== null) matched.push(childMatch);
    if (childRest !== null) rest.push(childRest);
  }
  if (matched.length === 0) return [null, value];
  if (rest.length === 0) return [value, null];
  const message = value.values.get("message");
  return [
    deriveExceptionGroupValue(value, message, matched),
    deriveExceptionGroupValue(value, message, rest),
  ];
}

function deriveExceptionGroupValue(
  template: RuntimeNamespace,
  message: RuntimeValue | undefined,
  children: readonly RuntimeValue[],
): RuntimeNamespace {
  const typeName =
    template.name === "BaseExceptionGroup" &&
    children.every(exceptionDerivesFromException)
      ? "ExceptionGroup"
      : template.name;
  const derived = makeExceptionGroupValue(
    typeName as "BaseExceptionGroup" | "ExceptionGroup",
    typeof message === "string" ? message : "",
    children,
  );
  copyExceptionGroupMetadata(template, derived);
  return derived;
}

function copyExceptionGroupMetadata(
  source: RuntimeNamespace,
  target: RuntimeNamespace,
): void {
  for (const name of [
    "__cause__",
    "__context__",
    "__notes__",
    "__traceback__",
  ]) {
    const metadata = source.values.get(name);
    if (metadata !== undefined) target.values.set(name, metadata);
  }
}

function splitExceptionValueByPredicate(
  value: RuntimeValue,
  decisions: WeakMap<RuntimeNamespace, boolean>,
  maximumNodes: number,
): readonly [RuntimeValue | null, RuntimeValue | null] {
  const work = { nodes: 0 };
  const split = (
    current: RuntimeValue,
    depth: number,
  ): readonly [RuntimeValue | null, RuntimeValue | null] => {
    work.nodes += 1;
    if (work.nodes > maximumNodes)
      throw new VmLimitError("exception group predicate");
    if (depth > 64) throw new VmLimitError("exception group depth");
    if (!isExceptionValue(current)) {
      throw new VmRuntimeError(
        "TypeError",
        "exception group predicate received a non-exception value",
      );
    }
    const decision = decisions.get(current);
    if (decision === undefined) {
      throw new VmRuntimeError(
        "RuntimeError",
        "exception group predicate has no decision for a node",
      );
    }
    if (decision) return [current, null];
    if (!isExceptionGroupValue(current)) return [null, current];
    const source = current.values.get("exceptions");
    if (!isTupleValue(source)) {
      throw new VmRuntimeError(
        "ValueError",
        "exception group has invalid exceptions",
      );
    }
    const matched: RuntimeValue[] = [];
    const rest: RuntimeValue[] = [];
    for (const child of source.values) {
      const [childMatch, childRest] = split(child, depth + 1);
      if (childMatch !== null) matched.push(childMatch);
      if (childRest !== null) rest.push(childRest);
    }
    if (matched.length === 0) return [null, current];
    if (rest.length === 0) return [current, null];
    const message = current.values.get("message");
    return [
      deriveExceptionGroupValue(current, message, matched),
      deriveExceptionGroupValue(current, message, rest),
    ];
  };
  return split(value, 1);
}

function unwrapSingleExceptionGroup(value: RuntimeValue): RuntimeValue {
  if (!isExceptionGroupValue(value)) return value;
  const children = value.values.get("exceptions");
  return isTupleValue(children) && children.values.length === 1
    ? children.values[0]!
    : value;
}

function emptySpan(): SourceSpan {
  const position = { column: 1, line: 1, offset: 0 };
  return { end: position, start: position };
}
