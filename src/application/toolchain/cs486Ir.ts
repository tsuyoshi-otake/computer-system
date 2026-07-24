import type { Cs486Register } from "../../domain/cpu/instructionSet.js";
import {
  isCs486DataModel,
  type Cs486DataModel,
} from "../../domain/cpu/cs486Compatibility.js";
import {
  cs486FunctionValueWordCount,
  parseCs486FunctionSignature,
  type Cs486FunctionSignature,
} from "../../domain/cpu/cs486.js";
import type { Cs486SourceSpan } from "./cs486AsmDiagnostics.js";

/** Integer value types understood by the CS486 intermediate representation. */
export type Cs486IrValueType = "i1" | "i32";
export type Cs486IrReturnType = Cs486IrValueType | "void";
export type Cs486IrValueId = number;
export type Cs486IrBlockId = string;

export interface Cs486IrParameter {
  readonly id: Cs486IrValueId;
  readonly name: string;
  readonly span?: Cs486SourceSpan;
  readonly type: Cs486IrValueType;
}

export interface Cs486IrLocal {
  readonly name: string;
  readonly span?: Cs486SourceSpan;
  readonly type: Cs486IrValueType;
}

export interface Cs486IrExternalFunction {
  /** Optional canonical source ABI; values remain lowered to physical i32 words. */
  readonly abiSignature?: Cs486FunctionSignature;
  readonly name: string;
  readonly parameterTypes: readonly Cs486IrValueType[];
  readonly returnType: Cs486IrReturnType;
  readonly span?: Cs486SourceSpan;
  readonly variadic?: boolean;
  readonly wideReturn?: true;
}

export interface Cs486IrPhiIncoming {
  readonly block: Cs486IrBlockId;
  readonly value: Cs486IrValueId;
}

export interface Cs486IrPhi {
  readonly incoming: readonly Cs486IrPhiIncoming[];
  readonly kind: "phi";
  readonly result: Cs486IrValueId;
  readonly span?: Cs486SourceSpan;
  readonly type: Cs486IrValueType;
}

export interface Cs486IrConstantInstruction {
  readonly kind: "constant";
  readonly result: Cs486IrValueId;
  readonly span?: Cs486SourceSpan;
  readonly type: Cs486IrValueType;
  readonly value: number;
}

export interface Cs486IrCopyInstruction {
  readonly kind: "copy";
  readonly result: Cs486IrValueId;
  readonly span?: Cs486SourceSpan;
  readonly type: Cs486IrValueType;
  readonly value: Cs486IrValueId;
}

export type Cs486IrUnaryOperator =
  "bit-not" | "logical-not" | "neg" | "zero-extend";

export interface Cs486IrUnaryInstruction {
  readonly kind: "unary";
  readonly operand: Cs486IrValueId;
  readonly operator: Cs486IrUnaryOperator;
  readonly result: Cs486IrValueId;
  readonly span?: Cs486SourceSpan;
  readonly type: Cs486IrValueType;
}

export type Cs486IrBinaryOperator =
  | "add"
  | "and"
  | "div"
  | "eq"
  | "ge"
  | "gt"
  | "le"
  | "logical-and"
  | "logical-or"
  | "lt"
  | "mod"
  | "mul"
  | "ne"
  | "or"
  | "shl"
  | "shr"
  | "sub"
  | "udiv"
  | "uge"
  | "ugt"
  | "ule"
  | "ult"
  | "umod"
  | "ushr"
  | "xor";

export interface Cs486IrBinaryInstruction {
  readonly kind: "binary";
  readonly left: Cs486IrValueId;
  readonly operator: Cs486IrBinaryOperator;
  readonly result: Cs486IrValueId;
  readonly right: Cs486IrValueId;
  readonly span?: Cs486SourceSpan;
  readonly type: Cs486IrValueType;
}

export interface Cs486IrLoadLocalInstruction {
  readonly kind: "load-local";
  readonly local: string;
  readonly result: Cs486IrValueId;
  readonly span?: Cs486SourceSpan;
  readonly type: Cs486IrValueType;
  readonly volatile?: true;
}

export interface Cs486IrStoreLocalInstruction {
  readonly kind: "store-local";
  readonly local: string;
  readonly span?: Cs486SourceSpan;
  readonly value: Cs486IrValueId;
  readonly volatile?: true;
}

export interface Cs486IrAddressLocalInstruction {
  readonly kind: "address-local";
  readonly local: string;
  readonly result: Cs486IrValueId;
  readonly span?: Cs486SourceSpan;
  readonly type: "i32";
}

export interface Cs486IrAddressSymbolInstruction {
  readonly kind: "address-symbol";
  readonly result: Cs486IrValueId;
  readonly span?: Cs486SourceSpan;
  readonly symbol: string;
  readonly type: "i32";
}

export interface Cs486IrLoadMemoryInstruction {
  readonly address: Cs486IrValueId;
  readonly kind: "load-memory";
  readonly result: Cs486IrValueId;
  readonly span?: Cs486SourceSpan;
  readonly type: "i32";
  /** Serialized memory width; omitted legacy IR means 32 bits. */
  readonly width?: 1 | 2 | 4;
  /** Applies only to 8/16-bit loads. */
  readonly signed?: true;
  readonly volatile?: true;
}

export interface Cs486IrStoreMemoryInstruction {
  readonly address: Cs486IrValueId;
  readonly kind: "store-memory";
  readonly span?: Cs486SourceSpan;
  readonly value: Cs486IrValueId;
  /** Serialized memory width; omitted legacy IR means 32 bits. */
  readonly width?: 1 | 2 | 4;
  readonly volatile?: true;
}

export interface Cs486IrCallInstruction {
  readonly arguments: readonly Cs486IrValueId[];
  readonly callee: string;
  readonly kind: "call";
  readonly result?: Cs486IrValueId;
  readonly span?: Cs486SourceSpan;
  readonly type?: Cs486IrValueType;
  readonly wideResultLocal?: string;
}

export interface Cs486IrIndirectCallInstruction {
  readonly arguments: readonly Cs486IrValueId[];
  readonly functionSignature: Cs486FunctionSignature;
  readonly kind: "indirect-call";
  readonly result?: Cs486IrValueId;
  readonly span?: Cs486SourceSpan;
  readonly target: Cs486IrValueId;
  readonly type?: Cs486IrValueType;
  readonly wideResultLocal?: string;
}

export type Cs486IrInstruction =
  | Cs486IrAddressLocalInstruction
  | Cs486IrAddressSymbolInstruction
  | Cs486IrBinaryInstruction
  | Cs486IrCallInstruction
  | Cs486IrIndirectCallInstruction
  | Cs486IrConstantInstruction
  | Cs486IrCopyInstruction
  | Cs486IrLoadLocalInstruction
  | Cs486IrLoadMemoryInstruction
  | Cs486IrStoreLocalInstruction
  | Cs486IrStoreMemoryInstruction
  | Cs486IrUnaryInstruction;

export interface Cs486IrJumpTerminator {
  readonly kind: "jump";
  readonly span?: Cs486SourceSpan;
  readonly target: Cs486IrBlockId;
}

export interface Cs486IrBranchTerminator {
  readonly condition: Cs486IrValueId;
  readonly falseTarget: Cs486IrBlockId;
  readonly kind: "branch";
  readonly span?: Cs486SourceSpan;
  readonly trueTarget: Cs486IrBlockId;
}

export interface Cs486IrReturnTerminator {
  readonly kind: "return";
  readonly span?: Cs486SourceSpan;
  readonly value?: Cs486IrValueId;
  readonly valueHigh?: Cs486IrValueId;
}

export type Cs486IrTerminator =
  Cs486IrBranchTerminator | Cs486IrJumpTerminator | Cs486IrReturnTerminator;

export interface Cs486IrBasicBlock {
  readonly id: Cs486IrBlockId;
  readonly instructions: readonly Cs486IrInstruction[];
  readonly phis: readonly Cs486IrPhi[];
  readonly span?: Cs486SourceSpan;
  /** Missing terminators are representable so imported IR can fail verification. */
  readonly terminator?: Cs486IrTerminator;
}

export interface Cs486IrFunction {
  /** Optional canonical source ABI; values remain lowered to physical i32 words. */
  readonly abiSignature?: Cs486FunctionSignature;
  readonly blocks: readonly Cs486IrBasicBlock[];
  readonly entry: Cs486IrBlockId;
  readonly locals: readonly Cs486IrLocal[];
  readonly name: string;
  readonly parameters: readonly Cs486IrParameter[];
  readonly returnType: Cs486IrReturnType;
  readonly span?: Cs486SourceSpan;
  readonly variadic?: boolean;
  readonly wideReturn?: true;
}

export interface Cs486IrProgram {
  /** Missing legacy CSIR is interpreted as `cs-word32-v1`. */
  readonly dataModel?: Cs486DataModel;
  readonly externals?: readonly Cs486IrExternalFunction[];
  readonly functions: readonly Cs486IrFunction[];
}

export interface Cs486IrLimits {
  readonly maxBlocksPerFunction: number;
  readonly maxCallArguments: number;
  readonly maxDiagnostics: number;
  readonly maxExternals: number;
  readonly maxFunctions: number;
  readonly maxIdentifierLength: number;
  readonly maxInlineCalleeBlocks: number;
  readonly maxInlineCalleeInstructions: number;
  readonly maxInlinedInstructionsPerFunction: number;
  readonly maxInstructionsPerFunction: number;
  readonly maxLocalsPerFunction: number;
  readonly maxOptimizationPasses: number;
  readonly maxParametersPerFunction: number;
  readonly maxPhiInputs: number;
  readonly maxRegisterAllocationValues: number;
  readonly maxValuesPerFunction: number;
}

export const DEFAULT_CS486_IR_LIMITS: Readonly<Cs486IrLimits> = Object.freeze({
  maxBlocksPerFunction: 256,
  maxCallArguments: 32,
  maxDiagnostics: 256,
  maxExternals: 2_048,
  maxFunctions: 1_024,
  maxIdentifierLength: 128,
  maxInlineCalleeBlocks: 16,
  maxInlineCalleeInstructions: 24,
  maxInlinedInstructionsPerFunction: 192,
  maxInstructionsPerFunction: 8_192,
  maxLocalsPerFunction: 1_024,
  maxOptimizationPasses: 8,
  maxParametersPerFunction: 32,
  maxPhiInputs: 256,
  maxRegisterAllocationValues: 8_192,
  maxValuesPerFunction: 16_384,
});

export interface Cs486IrDiagnostic {
  readonly block?: Cs486IrBlockId;
  readonly code: string;
  readonly functionName?: string;
  readonly message: string;
  readonly span?: Cs486SourceSpan;
  readonly value?: Cs486IrValueId;
}

export class Cs486IrVerificationError extends Error {
  constructor(readonly diagnostics: readonly Cs486IrDiagnostic[]) {
    super(
      diagnostics.length === 0
        ? "invalid CS486 IR"
        : diagnostics.map((diagnostic) => diagnostic.message).join("; "),
    );
    this.name = "Cs486IrVerificationError";
  }
}

interface Cs486IrFunctionSignature {
  readonly abiSignature?: Cs486FunctionSignature;
  readonly parameterTypes: readonly Cs486IrValueType[];
  readonly returnType: Cs486IrReturnType;
  readonly variadic: boolean;
  readonly wideReturn: boolean;
}

interface Cs486IrDefinition {
  readonly block?: Cs486IrBlockId;
  readonly kind: "instruction" | "parameter" | "phi";
  readonly position: number;
  readonly span?: Cs486SourceSpan;
  readonly type: Cs486IrValueType;
}

interface Cs486IrUse {
  readonly block: Cs486IrBlockId;
  readonly position: number;
  readonly predecessor?: Cs486IrBlockId;
  readonly span?: Cs486SourceSpan;
  readonly value: Cs486IrValueId;
}

interface Cs486IrDiagnosticContext {
  readonly block?: Cs486IrBlockId;
  readonly functionName?: string;
  readonly span?: Cs486SourceSpan;
  readonly value?: Cs486IrValueId;
}

const namePattern = /^[A-Za-z_.$][A-Za-z0-9_.$]*$/u;
const valueTypes = new Set<Cs486IrValueType>(["i1", "i32"]);
const returnTypes = new Set<Cs486IrReturnType>(["i1", "i32", "void"]);

/**
 * Verifies a complete CSIR program without trusting frontend construction.
 * Diagnostics and all fixed-point analyses are capped by the supplied limits.
 */
export function verifyCs486Ir(
  program: Cs486IrProgram,
  overrides: Partial<Cs486IrLimits> = {},
): readonly Cs486IrDiagnostic[] {
  const limits = resolveLimits(overrides);
  const diagnostics: Cs486IrDiagnostic[] = [];
  const add = (
    code: string,
    message: string,
    context: Cs486IrDiagnosticContext = {},
  ): void => {
    if (diagnostics.length >= limits.maxDiagnostics) return;
    diagnostics.push({ code, message, ...context });
  };
  const signatures = new Map<string, Cs486IrFunctionSignature>();
  const externals = program.externals ?? [];

  if (program.dataModel !== undefined && !isCs486DataModel(program.dataModel))
    add("CSIR_DATA_MODEL", "invalid CSIR data model");

  if (program.functions.length > limits.maxFunctions)
    add(
      "CSIR_LIMIT",
      `function limit exceeded: ${String(program.functions.length)} > ${String(limits.maxFunctions)}`,
    );
  if (externals.length > limits.maxExternals)
    add(
      "CSIR_LIMIT",
      `external function limit exceeded: ${String(externals.length)} > ${String(limits.maxExternals)}`,
    );

  for (
    let index = 0;
    index < Math.min(externals.length, limits.maxExternals);
    index += 1
  ) {
    const external = externals[index]!;
    validateName(external.name, "external function", limits, add, {
      span: external.span,
    });
    if (!isReturnType(external.returnType))
      add("CSIR_TYPE", `invalid return type for ${external.name}`, {
        span: external.span,
      });
    if (external.parameterTypes.length > limits.maxParametersPerFunction)
      add("CSIR_LIMIT", `parameter limit exceeded for ${external.name}`, {
        span: external.span,
      });
    for (
      let parameterIndex = 0;
      parameterIndex <
      Math.min(external.parameterTypes.length, limits.maxParametersPerFunction);
      parameterIndex += 1
    ) {
      if (!isValueType(external.parameterTypes[parameterIndex]))
        add("CSIR_TYPE", `invalid parameter type for ${external.name}`, {
          span: external.span,
        });
    }
    if (signatures.has(external.name))
      add("CSIR_DUPLICATE_FUNCTION", `duplicate function ${external.name}`, {
        span: external.span,
      });
    else
      signatures.set(external.name, {
        ...(external.abiSignature === undefined
          ? {}
          : { abiSignature: external.abiSignature }),
        parameterTypes: external.parameterTypes,
        returnType: external.returnType,
        variadic: external.variadic === true,
        wideReturn: external.wideReturn === true,
      });
    verifyPhysicalAbi(
      external.name,
      external.abiSignature,
      external.parameterTypes.length,
      external.returnType,
      external.wideReturn === true,
      external.span,
      add,
    );
  }

  const boundedFunctions = program.functions.slice(0, limits.maxFunctions);
  for (const function_ of boundedFunctions) {
    validateName(function_.name, "function", limits, add, {
      functionName: function_.name,
      span: function_.span,
    });
    if (signatures.has(function_.name))
      add("CSIR_DUPLICATE_FUNCTION", `duplicate function ${function_.name}`, {
        functionName: function_.name,
        span: function_.span,
      });
    else
      signatures.set(function_.name, {
        ...(function_.abiSignature === undefined
          ? {}
          : { abiSignature: function_.abiSignature }),
        parameterTypes: function_.parameters
          .slice(0, limits.maxParametersPerFunction)
          .map((parameter) => parameter.type),
        returnType: function_.returnType,
        variadic: function_.variadic === true,
        wideReturn: function_.wideReturn === true,
      });
    verifyPhysicalAbi(
      function_.name,
      function_.abiSignature,
      function_.parameters.length,
      function_.returnType,
      function_.wideReturn === true,
      function_.span,
      add,
    );
  }

  for (const function_ of boundedFunctions)
    verifyFunction(function_, signatures, limits, add);
  return diagnostics;
}

/** Throws one aggregate error when the program violates any CSIR invariant. */
export function assertValidCs486Ir(
  program: Cs486IrProgram,
  overrides: Partial<Cs486IrLimits> = {},
): void {
  const diagnostics = verifyCs486Ir(program, overrides);
  if (diagnostics.length > 0) throw new Cs486IrVerificationError(diagnostics);
}

function verifyPhysicalAbi(
  name: string,
  abiSignature: Cs486FunctionSignature | undefined,
  physicalParameters: number,
  physicalReturn: Cs486IrReturnType,
  wideReturn: boolean,
  span: Cs486SourceSpan | undefined,
  add: (
    code: string,
    message: string,
    context?: Cs486IrDiagnosticContext,
  ) => void,
): void {
  if (abiSignature === undefined) return;
  const parsed = parseCs486FunctionSignature(abiSignature);
  if (parsed === undefined) {
    add("CSIR_ABI_SIGNATURE", `invalid ABI signature for ${name}`, { span });
    return;
  }
  const words = parsed.parameterTypes.reduce(
    (count, type) => count + cs486FunctionValueWordCount(type),
    0,
  );
  const expectedWide =
    parsed.returnType === "f64" || parsed.returnType === "i64";
  if (words !== physicalParameters)
    add(
      "CSIR_ABI_SIGNATURE",
      `ABI signature for ${name} declares ${String(words)} words, physical IR has ${String(physicalParameters)}`,
      { span },
    );
  if (
    (parsed.returnType === "void") !== (physicalReturn === "void") ||
    (parsed.returnType !== "void" && physicalReturn !== "i32") ||
    expectedWide !== wideReturn
  )
    add(
      "CSIR_ABI_SIGNATURE",
      `ABI return for ${name} is inconsistent with physical IR`,
      { span },
    );
}

function verifyFunction(
  function_: Cs486IrFunction,
  signatures: ReadonlyMap<string, Cs486IrFunctionSignature>,
  limits: Cs486IrLimits,
  add: (
    code: string,
    message: string,
    context?: Cs486IrDiagnosticContext,
  ) => void,
): void {
  const functionContext = {
    functionName: function_.name,
    span: function_.span,
  };
  if (!isReturnType(function_.returnType))
    add(
      "CSIR_TYPE",
      `invalid return type for ${function_.name}`,
      functionContext,
    );
  if (function_.parameters.length > limits.maxParametersPerFunction)
    add(
      "CSIR_LIMIT",
      `parameter limit exceeded for ${function_.name}`,
      functionContext,
    );
  if (function_.locals.length > limits.maxLocalsPerFunction)
    add(
      "CSIR_LIMIT",
      `local limit exceeded for ${function_.name}`,
      functionContext,
    );
  if (function_.blocks.length === 0)
    add(
      "CSIR_CFG",
      `function ${function_.name} has no basic blocks`,
      functionContext,
    );
  if (function_.blocks.length > limits.maxBlocksPerFunction)
    add(
      "CSIR_LIMIT",
      `basic block limit exceeded for ${function_.name}`,
      functionContext,
    );

  const parameterNames = new Set<string>();
  for (
    let index = 0;
    index <
    Math.min(function_.parameters.length, limits.maxParametersPerFunction);
    index += 1
  ) {
    const parameter = function_.parameters[index]!;
    validateName(parameter.name, "parameter", limits, add, {
      functionName: function_.name,
      span: parameter.span,
      value: parameter.id,
    });
    if (parameterNames.has(parameter.name))
      add("CSIR_DUPLICATE_LOCAL", `duplicate parameter ${parameter.name}`, {
        functionName: function_.name,
        span: parameter.span,
        value: parameter.id,
      });
    parameterNames.add(parameter.name);
    if (!isValueType(parameter.type))
      add("CSIR_TYPE", `invalid parameter type for ${parameter.name}`, {
        functionName: function_.name,
        span: parameter.span,
        value: parameter.id,
      });
  }

  const locals = new Map<string, Cs486IrLocal>();
  for (
    let index = 0;
    index < Math.min(function_.locals.length, limits.maxLocalsPerFunction);
    index += 1
  ) {
    const local = function_.locals[index]!;
    validateName(local.name, "local", limits, add, {
      functionName: function_.name,
      span: local.span,
    });
    if (locals.has(local.name) || parameterNames.has(local.name))
      add("CSIR_DUPLICATE_LOCAL", `duplicate local ${local.name}`, {
        functionName: function_.name,
        span: local.span,
      });
    else locals.set(local.name, local);
    if (!isValueType(local.type))
      add("CSIR_TYPE", `invalid local type for ${local.name}`, {
        functionName: function_.name,
        span: local.span,
      });
  }

  const blocks = function_.blocks.slice(0, limits.maxBlocksPerFunction);
  const blockMap = new Map<Cs486IrBlockId, Cs486IrBasicBlock>();
  for (const block of blocks) {
    validateName(block.id, "basic block", limits, add, {
      block: block.id,
      functionName: function_.name,
      span: block.span,
    });
    if (blockMap.has(block.id))
      add("CSIR_DUPLICATE_BLOCK", `duplicate basic block ${block.id}`, {
        block: block.id,
        functionName: function_.name,
        span: block.span,
      });
    else blockMap.set(block.id, block);
  }
  if (!blockMap.has(function_.entry))
    add(
      "CSIR_CFG_TARGET",
      `entry block ${function_.entry} does not exist`,
      functionContext,
    );

  let operationCount = 0;
  for (const block of blocks) {
    operationCount += block.phis.length + block.instructions.length + 1;
    if (operationCount > limits.maxInstructionsPerFunction) {
      add("CSIR_LIMIT", `instruction limit exceeded for ${function_.name}`, {
        block: block.id,
        functionName: function_.name,
        span: block.span,
      });
      break;
    }
  }

  const definitions = new Map<Cs486IrValueId, Cs486IrDefinition>();
  let valueLimitReported = false;
  const define = (
    id: Cs486IrValueId,
    type: Cs486IrValueType,
    definition: Omit<Cs486IrDefinition, "type">,
  ): void => {
    const context = {
      block: definition.block,
      functionName: function_.name,
      span: definition.span,
      value: id,
    };
    if (!isValueId(id)) {
      add("CSIR_VALUE_ID", `invalid SSA value id ${String(id)}`, context);
      return;
    }
    if (!isValueType(type)) {
      add("CSIR_TYPE", `invalid type for SSA value ${String(id)}`, context);
      return;
    }
    if (definitions.has(id)) {
      add(
        "CSIR_DUPLICATE_VALUE",
        `SSA value ${String(id)} is defined more than once`,
        context,
      );
      return;
    }
    if (definitions.size >= limits.maxValuesPerFunction) {
      if (!valueLimitReported) {
        valueLimitReported = true;
        add(
          "CSIR_LIMIT",
          `SSA value limit exceeded for ${function_.name}`,
          context,
        );
      }
      return;
    }
    definitions.set(id, { ...definition, type });
  };

  for (
    let index = 0;
    index <
    Math.min(function_.parameters.length, limits.maxParametersPerFunction);
    index += 1
  ) {
    const parameter = function_.parameters[index]!;
    define(parameter.id, parameter.type, {
      kind: "parameter",
      position: -1,
      span: parameter.span,
    });
  }
  let visitedOperations = 0;
  for (const block of blocks) {
    for (const phi of block.phis) {
      if (visitedOperations >= limits.maxInstructionsPerFunction) break;
      visitedOperations += 1;
      define(phi.result, phi.type, {
        block: block.id,
        kind: "phi",
        position: 0,
        span: phi.span,
      });
    }
    for (let index = 0; index < block.instructions.length; index += 1) {
      if (visitedOperations >= limits.maxInstructionsPerFunction) break;
      visitedOperations += 1;
      const instruction = block.instructions[index]!;
      const result = instructionResult(instruction);
      if (result !== undefined)
        define(result.id, result.type, {
          block: block.id,
          kind: "instruction",
          position: index + 1,
          span: instruction.span,
        });
    }
  }

  const predecessors = new Map<Cs486IrBlockId, Set<Cs486IrBlockId>>();
  for (const block of blocks) predecessors.set(block.id, new Set());
  for (const block of blocks) {
    if (block.terminator === undefined) {
      add("CSIR_TERMINATOR", `basic block ${block.id} has no terminator`, {
        block: block.id,
        functionName: function_.name,
        span: block.span,
      });
      continue;
    }
    for (const target of terminatorTargets(block.terminator)) {
      const incoming = predecessors.get(target);
      if (incoming === undefined)
        add(
          "CSIR_CFG_TARGET",
          `basic block ${block.id} targets missing block ${target}`,
          {
            block: block.id,
            functionName: function_.name,
            span: block.terminator.span,
          },
        );
      else incoming.add(block.id);
    }
  }

  const uses: Cs486IrUse[] = [];
  const use = (
    id: Cs486IrValueId,
    expectedType: Cs486IrValueType | undefined,
    block: Cs486IrBasicBlock,
    position: number,
    span: Cs486SourceSpan | undefined,
    predecessor?: Cs486IrBlockId,
  ): Cs486IrValueType | undefined => {
    const context = {
      block: block.id,
      functionName: function_.name,
      span,
      value: id,
    };
    if (!isValueId(id)) {
      add("CSIR_VALUE_ID", `invalid SSA value use ${String(id)}`, context);
      return undefined;
    }
    const definition = definitions.get(id);
    if (definition === undefined) {
      add(
        "CSIR_UNDEFINED_VALUE",
        `SSA value ${String(id)} is not defined`,
        context,
      );
      return undefined;
    }
    if (expectedType !== undefined && definition.type !== expectedType)
      add(
        "CSIR_TYPE",
        `SSA value ${String(id)} has type ${definition.type}, expected ${expectedType}`,
        context,
      );
    uses.push({ block: block.id, position, predecessor, span, value: id });
    return definition.type;
  };

  let validatedOperations = 0;
  for (const block of blocks) {
    const expectedPredecessors = predecessors.get(block.id) ?? new Set();
    if (block.id === function_.entry && block.phis.length > 0)
      add("CSIR_PHI_PREDECESSOR", "entry block cannot contain phi nodes", {
        block: block.id,
        functionName: function_.name,
        span: block.phis[0]?.span ?? block.span,
      });
    for (
      let phiIndex = 0;
      phiIndex < block.phis.length &&
      validatedOperations < limits.maxInstructionsPerFunction;
      phiIndex += 1
    ) {
      validatedOperations += 1;
      const phi = block.phis[phiIndex]!;
      if (phi.incoming.length === 0)
        add(
          "CSIR_PHI_PREDECESSOR",
          `phi ${String(phi.result)} has no incoming values`,
          {
            block: block.id,
            functionName: function_.name,
            span: phi.span,
            value: phi.result,
          },
        );
      if (phi.incoming.length > limits.maxPhiInputs)
        add(
          "CSIR_LIMIT",
          `phi input limit exceeded for SSA value ${String(phi.result)}`,
          {
            block: block.id,
            functionName: function_.name,
            span: phi.span,
            value: phi.result,
          },
        );
      const incomingBlocks = new Set<Cs486IrBlockId>();
      for (
        let index = 0;
        index < Math.min(phi.incoming.length, limits.maxPhiInputs);
        index += 1
      ) {
        const incoming = phi.incoming[index]!;
        if (incomingBlocks.has(incoming.block))
          add(
            "CSIR_PHI_PREDECESSOR",
            `phi ${String(phi.result)} repeats predecessor ${incoming.block}`,
            {
              block: block.id,
              functionName: function_.name,
              span: phi.span,
              value: phi.result,
            },
          );
        incomingBlocks.add(incoming.block);
        if (!expectedPredecessors.has(incoming.block))
          add(
            "CSIR_PHI_PREDECESSOR",
            `phi ${String(phi.result)} has non-predecessor input ${incoming.block}`,
            {
              block: block.id,
              functionName: function_.name,
              span: phi.span,
              value: phi.result,
            },
          );
        use(incoming.value, phi.type, block, 0, phi.span, incoming.block);
      }
      for (const predecessor of expectedPredecessors)
        if (!incomingBlocks.has(predecessor))
          add(
            "CSIR_PHI_PREDECESSOR",
            `phi ${String(phi.result)} is missing predecessor ${predecessor}`,
            {
              block: block.id,
              functionName: function_.name,
              span: phi.span,
              value: phi.result,
            },
          );
    }

    for (
      let index = 0;
      index < block.instructions.length &&
      validatedOperations < limits.maxInstructionsPerFunction;
      index += 1
    ) {
      validatedOperations += 1;
      const instruction = block.instructions[index]!;
      verifyInstruction(
        instruction,
        block,
        index + 1,
        locals,
        signatures,
        limits,
        use,
        add,
        function_.name,
      );
    }
    if (block.terminator !== undefined)
      verifyTerminator(
        block.terminator,
        block,
        block.instructions.length + 1,
        function_.returnType,
        function_.wideReturn === true,
        use,
        add,
        function_.name,
      );
  }

  verifyDominance(function_, blocks, blockMap, definitions, uses, add);
}

function verifyInstruction(
  instruction: Cs486IrInstruction,
  block: Cs486IrBasicBlock,
  position: number,
  locals: ReadonlyMap<string, Cs486IrLocal>,
  signatures: ReadonlyMap<string, Cs486IrFunctionSignature>,
  limits: Cs486IrLimits,
  use: (
    id: Cs486IrValueId,
    expectedType: Cs486IrValueType | undefined,
    block: Cs486IrBasicBlock,
    position: number,
    span: Cs486SourceSpan | undefined,
  ) => Cs486IrValueType | undefined,
  add: (
    code: string,
    message: string,
    context?: Cs486IrDiagnosticContext,
  ) => void,
  functionName: string,
): void {
  const context = {
    block: block.id,
    functionName,
    span: instruction.span,
    value: instructionResult(instruction)?.id,
  };
  switch (instruction.kind) {
    case "constant":
      if (
        !Number.isInteger(instruction.value) ||
        !fitsType(instruction.value, instruction.type)
      )
        add(
          "CSIR_CONSTANT",
          `constant ${String(instruction.value)} does not fit ${instruction.type}`,
          context,
        );
      return;
    case "copy":
      use(
        instruction.value,
        instruction.type,
        block,
        position,
        instruction.span,
      );
      return;
    case "unary": {
      const operandType =
        instruction.operator === "logical-not" ||
        instruction.operator === "zero-extend"
          ? "i1"
          : "i32";
      const resultType =
        instruction.operator === "zero-extend" ? "i32" : operandType;
      if (instruction.type !== resultType)
        add(
          "CSIR_TYPE",
          `unary ${instruction.operator} must produce ${resultType}`,
          context,
        );
      use(instruction.operand, operandType, block, position, instruction.span);
      return;
    }
    case "binary":
      verifyBinaryInstruction(
        instruction,
        block,
        position,
        use,
        add,
        functionName,
      );
      return;
    case "load-local": {
      const local = locals.get(instruction.local);
      if (local === undefined)
        add(
          "CSIR_UNKNOWN_LOCAL",
          `unknown local ${instruction.local}`,
          context,
        );
      else if (local.type !== instruction.type)
        add(
          "CSIR_TYPE",
          `local ${instruction.local} has type ${local.type}, expected ${instruction.type}`,
          context,
        );
      return;
    }
    case "address-local": {
      const local = locals.get(instruction.local);
      if (local === undefined)
        add(
          "CSIR_UNKNOWN_LOCAL",
          `unknown local ${instruction.local}`,
          context,
        );
      if (instruction.type !== "i32")
        add("CSIR_TYPE", "local address must produce i32", context);
      return;
    }
    case "address-symbol":
      validateName(instruction.symbol, "data symbol", limits, add, context);
      if (instruction.type !== "i32")
        add("CSIR_TYPE", "symbol address must produce i32", context);
      return;
    case "load-memory":
      use(instruction.address, "i32", block, position, instruction.span);
      if (instruction.type !== "i32")
        add("CSIR_TYPE", "memory load must produce i32", context);
      if (
        instruction.width !== undefined &&
        instruction.width !== 1 &&
        instruction.width !== 2 &&
        instruction.width !== 4
      )
        add("CSIR_MEMORY_WIDTH", "invalid memory load width", context);
      if (instruction.signed === true && (instruction.width ?? 4) === 4)
        add(
          "CSIR_MEMORY_WIDTH",
          "signed extension requires an 8- or 16-bit load",
          context,
        );
      return;
    case "store-memory":
      use(instruction.address, "i32", block, position, instruction.span);
      use(instruction.value, "i32", block, position, instruction.span);
      if (
        instruction.width !== undefined &&
        instruction.width !== 1 &&
        instruction.width !== 2 &&
        instruction.width !== 4
      )
        add("CSIR_MEMORY_WIDTH", "invalid memory store width", context);
      return;
    case "store-local": {
      const local = locals.get(instruction.local);
      if (local === undefined)
        add(
          "CSIR_UNKNOWN_LOCAL",
          `unknown local ${instruction.local}`,
          context,
        );
      use(instruction.value, local?.type, block, position, instruction.span);
      return;
    }
    case "call": {
      validateName(instruction.callee, "callee", limits, add, context);
      if (instruction.arguments.length > limits.maxCallArguments)
        add(
          "CSIR_LIMIT",
          `call argument limit exceeded for ${instruction.callee}`,
          context,
        );
      const signature = signatures.get(instruction.callee);
      if (signature === undefined)
        add(
          "CSIR_UNKNOWN_FUNCTION",
          `unknown function ${instruction.callee}`,
          context,
        );
      else if (
        instruction.arguments.length < signature.parameterTypes.length ||
        (!signature.variadic &&
          instruction.arguments.length !== signature.parameterTypes.length)
      )
        add(
          "CSIR_CALL_SIGNATURE",
          `function ${instruction.callee} expects ${signature.variadic ? "at least " : ""}${String(signature.parameterTypes.length)} arguments, received ${String(instruction.arguments.length)}`,
          context,
        );
      for (
        let index = 0;
        index < Math.min(instruction.arguments.length, limits.maxCallArguments);
        index += 1
      )
        use(
          instruction.arguments[index]!,
          signature?.parameterTypes[index] ??
            (signature?.variadic === true ? "i32" : undefined),
          block,
          position,
          instruction.span,
        );
      if (signature?.returnType === "void") {
        if (
          instruction.result !== undefined ||
          instruction.type !== undefined ||
          instruction.wideResultLocal !== undefined
        )
          add(
            "CSIR_CALL_SIGNATURE",
            `void function ${instruction.callee} cannot define a value`,
            context,
          );
      } else if (signature !== undefined) {
        if (instruction.result === undefined || instruction.type === undefined)
          add(
            "CSIR_CALL_SIGNATURE",
            `function ${instruction.callee} must define a ${signature.returnType} value`,
            context,
          );
        else if (instruction.type !== signature.returnType)
          add(
            "CSIR_CALL_SIGNATURE",
            `function ${instruction.callee} returns ${signature.returnType}, not ${instruction.type}`,
            context,
          );
        if (signature.wideReturn && instruction.wideResultLocal === undefined)
          add(
            "CSIR_CALL_SIGNATURE",
            `function ${instruction.callee} must define a high-word local`,
            context,
          );
        if (!signature.wideReturn && instruction.wideResultLocal !== undefined)
          add(
            "CSIR_CALL_SIGNATURE",
            `function ${instruction.callee} cannot define a high-word local`,
            context,
          );
      } else if (
        (instruction.result === undefined) !==
        (instruction.type === undefined)
      )
        add(
          "CSIR_CALL_SIGNATURE",
          `call result and type must either both be present or both be absent`,
          context,
        );
      verifyWideResultLocal(instruction, locals, add, context);
      return;
    }
    case "indirect-call": {
      use(instruction.target, "i32", block, position, instruction.span);
      if (instruction.arguments.length > limits.maxCallArguments)
        add("CSIR_LIMIT", "indirect call argument limit exceeded", context);
      const signature = parseCs486FunctionSignature(
        instruction.functionSignature,
      );
      const physicalParameterTypes = signature?.parameterTypes.flatMap(
        (type) =>
          type === "i64" || type === "f64"
            ? (["i32", "i32"] as const)
            : (["i32"] as const),
      );
      if (signature === undefined)
        add(
          "CSIR_CALL_SIGNATURE",
          "indirect call has an invalid function signature",
          context,
        );
      else if (
        instruction.arguments.length < physicalParameterTypes!.length ||
        (!signature.variadic &&
          instruction.arguments.length !== physicalParameterTypes!.length)
      )
        add(
          "CSIR_CALL_SIGNATURE",
          `indirect function expects ${signature.variadic ? "at least " : ""}${String(physicalParameterTypes!.length)} argument words, received ${String(instruction.arguments.length)}`,
          context,
        );
      for (
        let index = 0;
        index < Math.min(instruction.arguments.length, limits.maxCallArguments);
        index += 1
      )
        use(
          instruction.arguments[index]!,
          physicalParameterTypes?.[index] ??
            (signature?.variadic === true ? "i32" : undefined),
          block,
          position,
          instruction.span,
        );
      if (signature?.returnType === "void") {
        if (
          instruction.result !== undefined ||
          instruction.type !== undefined ||
          instruction.wideResultLocal !== undefined
        )
          add(
            "CSIR_CALL_SIGNATURE",
            "void indirect function cannot define a value",
            context,
          );
      } else if (signature !== undefined) {
        if (instruction.result === undefined || instruction.type === undefined)
          add(
            "CSIR_CALL_SIGNATURE",
            "indirect function must define an i32 value",
            context,
          );
        else if (instruction.type !== "i32")
          add(
            "CSIR_CALL_SIGNATURE",
            `indirect function low word must be i32, not ${instruction.type}`,
            context,
          );
        if (
          (signature.returnType === "i64" || signature.returnType === "f64") &&
          instruction.wideResultLocal === undefined
        )
          add(
            "CSIR_CALL_SIGNATURE",
            `${signature.returnType} indirect function must define a high-word local`,
            context,
          );
        if (
          (signature.returnType === "i32" || signature.returnType === "f32") &&
          instruction.wideResultLocal !== undefined
        )
          add(
            "CSIR_CALL_SIGNATURE",
            `${signature.returnType} indirect function cannot define a high-word local`,
            context,
          );
      } else if (
        (instruction.result === undefined) !==
        (instruction.type === undefined)
      )
        add(
          "CSIR_CALL_SIGNATURE",
          "indirect call result and type must either both be present or both be absent",
          context,
        );
      verifyWideResultLocal(instruction, locals, add, context);
      return;
    }
  }
}

function verifyWideResultLocal(
  instruction: Cs486IrCallInstruction | Cs486IrIndirectCallInstruction,
  locals: ReadonlyMap<string, Cs486IrLocal>,
  add: (
    code: string,
    message: string,
    context?: Cs486IrDiagnosticContext,
  ) => void,
  context: Cs486IrDiagnosticContext,
): void {
  if (instruction.wideResultLocal === undefined) return;
  const local = locals.get(instruction.wideResultLocal);
  if (local === undefined)
    add(
      "CSIR_UNKNOWN_LOCAL",
      `unknown wide-result local ${instruction.wideResultLocal}`,
      context,
    );
  else if (local.type !== "i32")
    add(
      "CSIR_TYPE",
      `wide-result local ${instruction.wideResultLocal} must be i32`,
      context,
    );
  if (instruction.result === undefined || instruction.type !== "i32")
    add(
      "CSIR_CALL_SIGNATURE",
      "wide call result requires an i32 low word",
      context,
    );
}

function verifyBinaryInstruction(
  instruction: Cs486IrBinaryInstruction,
  block: Cs486IrBasicBlock,
  position: number,
  use: (
    id: Cs486IrValueId,
    expectedType: Cs486IrValueType | undefined,
    block: Cs486IrBasicBlock,
    position: number,
    span: Cs486SourceSpan | undefined,
  ) => Cs486IrValueType | undefined,
  add: (
    code: string,
    message: string,
    context?: Cs486IrDiagnosticContext,
  ) => void,
  functionName: string,
): void {
  const comparison = [
    "eq",
    "ge",
    "gt",
    "le",
    "lt",
    "ne",
    "uge",
    "ugt",
    "ule",
    "ult",
  ].includes(instruction.operator);
  const logical = ["logical-and", "logical-or"].includes(instruction.operator);
  const operandType = logical ? "i1" : "i32";
  const resultType = comparison || logical ? "i1" : "i32";
  if (instruction.type !== resultType)
    add(
      "CSIR_TYPE",
      `binary ${instruction.operator} must produce ${resultType}`,
      {
        block: block.id,
        functionName,
        span: instruction.span,
        value: instruction.result,
      },
    );
  use(instruction.left, operandType, block, position, instruction.span);
  use(instruction.right, operandType, block, position, instruction.span);
}

function verifyTerminator(
  terminator: Cs486IrTerminator,
  block: Cs486IrBasicBlock,
  position: number,
  returnType: Cs486IrReturnType,
  wideReturn: boolean,
  use: (
    id: Cs486IrValueId,
    expectedType: Cs486IrValueType | undefined,
    block: Cs486IrBasicBlock,
    position: number,
    span: Cs486SourceSpan | undefined,
  ) => Cs486IrValueType | undefined,
  add: (
    code: string,
    message: string,
    context?: Cs486IrDiagnosticContext,
  ) => void,
  functionName: string,
): void {
  const context = {
    block: block.id,
    functionName,
    span: terminator.span,
  };
  switch (terminator.kind) {
    case "jump":
      return;
    case "branch":
      use(terminator.condition, "i1", block, position, terminator.span);
      return;
    case "return":
      if (returnType === "void") {
        if (
          terminator.value !== undefined ||
          terminator.valueHigh !== undefined
        )
          add(
            "CSIR_RETURN_TYPE",
            `void function ${functionName} returns a value`,
            context,
          );
      } else if (terminator.value === undefined)
        add(
          "CSIR_RETURN_TYPE",
          `function ${functionName} must return ${returnType}`,
          context,
        );
      else {
        use(terminator.value, returnType, block, position, terminator.span);
        if (wideReturn) {
          if (terminator.valueHigh === undefined)
            add(
              "CSIR_RETURN_TYPE",
              "wide function return is missing its high word",
              context,
            );
          else
            use(terminator.valueHigh, "i32", block, position, terminator.span);
        } else if (terminator.valueHigh !== undefined)
          add(
            "CSIR_RETURN_TYPE",
            "one-word function return cannot define a high word",
            context,
          );
      }
  }
}

function verifyDominance(
  function_: Cs486IrFunction,
  blocks: readonly Cs486IrBasicBlock[],
  blockMap: ReadonlyMap<Cs486IrBlockId, Cs486IrBasicBlock>,
  definitions: ReadonlyMap<Cs486IrValueId, Cs486IrDefinition>,
  uses: readonly Cs486IrUse[],
  add: (
    code: string,
    message: string,
    context?: Cs486IrDiagnosticContext,
  ) => void,
): void {
  if (!blockMap.has(function_.entry)) return;
  const reachable = new Set<Cs486IrBlockId>();
  const queue: Cs486IrBlockId[] = [function_.entry];
  for (let index = 0; index < queue.length; index += 1) {
    const id = queue[index]!;
    if (reachable.has(id)) continue;
    reachable.add(id);
    const block = blockMap.get(id);
    if (block?.terminator === undefined) continue;
    for (const target of terminatorTargets(block.terminator))
      if (blockMap.has(target) && !reachable.has(target)) queue.push(target);
  }

  const predecessors = new Map<Cs486IrBlockId, Cs486IrBlockId[]>();
  for (const id of reachable) predecessors.set(id, []);
  for (const block of blocks) {
    if (!reachable.has(block.id) || block.terminator === undefined) continue;
    for (const target of terminatorTargets(block.terminator))
      if (reachable.has(target)) {
        const entries = predecessors.get(target)!;
        if (!entries.includes(block.id)) entries.push(block.id);
      }
  }
  const reachableOrder = blocks
    .map((block) => block.id)
    .filter((id) => reachable.has(id));
  const dominators = new Map<Cs486IrBlockId, Set<Cs486IrBlockId>>();
  for (const id of reachableOrder)
    dominators.set(
      id,
      id === function_.entry ? new Set([id]) : new Set(reachableOrder),
    );
  for (let pass = 0; pass < reachableOrder.length; pass += 1) {
    let changed = false;
    for (const id of reachableOrder) {
      if (id === function_.entry) continue;
      const incoming = predecessors.get(id) ?? [];
      let next =
        incoming.length === 0
          ? new Set<Cs486IrBlockId>()
          : new Set(dominators.get(incoming[0]!) ?? []);
      for (let index = 1; index < incoming.length; index += 1)
        next = intersect(next, dominators.get(incoming[index]!) ?? new Set());
      next.add(id);
      if (!sameSet(next, dominators.get(id)!)) {
        dominators.set(id, next);
        changed = true;
      }
    }
    if (!changed) break;
  }

  for (const use of uses) {
    const definition = definitions.get(use.value);
    if (definition === undefined || definition.kind === "parameter") continue;
    const useBlock = use.predecessor ?? use.block;
    if (definition.block === useBlock) {
      const usePosition =
        use.predecessor === undefined
          ? use.position
          : (blockMap.get(useBlock)?.instructions.length ?? 0) + 1;
      if (definition.position >= usePosition)
        add(
          "CSIR_DOMINANCE",
          `SSA value ${String(use.value)} is used before its definition`,
          {
            block: use.block,
            functionName: function_.name,
            span: use.span,
            value: use.value,
          },
        );
      continue;
    }
    if (!reachable.has(useBlock) || definition.block === undefined) continue;
    if (
      !reachable.has(definition.block) ||
      !(dominators.get(useBlock)?.has(definition.block) ?? false)
    )
      add(
        "CSIR_DOMINANCE",
        `SSA value ${String(use.value)} does not dominate its use in ${use.block}`,
        {
          block: use.block,
          functionName: function_.name,
          span: use.span,
          value: use.value,
        },
      );
  }
}

function validateName(
  name: string,
  kind: string,
  limits: Cs486IrLimits,
  add: (
    code: string,
    message: string,
    context?: Cs486IrDiagnosticContext,
  ) => void,
  context: Cs486IrDiagnosticContext,
): void {
  if (
    name.length === 0 ||
    name.length > limits.maxIdentifierLength ||
    !namePattern.test(name)
  )
    add("CSIR_NAME", `invalid ${kind} name ${JSON.stringify(name)}`, context);
}

function resolveLimits(overrides: Partial<Cs486IrLimits>): Cs486IrLimits {
  const limits = { ...DEFAULT_CS486_IR_LIMITS, ...overrides };
  for (const [name, value] of Object.entries(limits))
    if (!Number.isSafeInteger(value) || value <= 0)
      throw new RangeError(
        `CS486 IR limit ${name} must be a positive safe integer`,
      );
  return limits;
}

function isValueId(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function isValueType(value: unknown): value is Cs486IrValueType {
  return valueTypes.has(value as Cs486IrValueType);
}

function isReturnType(value: unknown): value is Cs486IrReturnType {
  return returnTypes.has(value as Cs486IrReturnType);
}

function fitsType(value: number, type: Cs486IrValueType): boolean {
  return type === "i1"
    ? value === 0 || value === 1
    : value >= -2_147_483_648 && value <= 2_147_483_647;
}

function instructionResult(
  instruction: Cs486IrInstruction,
):
  { readonly id: Cs486IrValueId; readonly type: Cs486IrValueType } | undefined {
  switch (instruction.kind) {
    case "store-local":
    case "store-memory":
      return undefined;
    case "call":
    case "indirect-call":
      return instruction.result === undefined || instruction.type === undefined
        ? undefined
        : { id: instruction.result, type: instruction.type };
    default:
      return { id: instruction.result, type: instruction.type };
  }
}

function instructionOperands(
  instruction: Cs486IrInstruction,
): readonly Cs486IrValueId[] {
  switch (instruction.kind) {
    case "constant":
    case "address-local":
    case "address-symbol":
    case "load-local":
      return [];
    case "copy":
      return [instruction.value];
    case "unary":
      return [instruction.operand];
    case "binary":
      return [instruction.left, instruction.right];
    case "store-local":
      return [instruction.value];
    case "load-memory":
      return [instruction.address];
    case "store-memory":
      return [instruction.address, instruction.value];
    case "call":
      return instruction.arguments;
    case "indirect-call":
      return [instruction.target, ...instruction.arguments];
  }
}

function terminatorOperands(
  terminator: Cs486IrTerminator,
): readonly Cs486IrValueId[] {
  switch (terminator.kind) {
    case "jump":
      return [];
    case "branch":
      return [terminator.condition];
    case "return":
      return terminator.value === undefined
        ? []
        : [
            terminator.value,
            ...(terminator.valueHigh === undefined
              ? []
              : [terminator.valueHigh]),
          ];
  }
}

function terminatorTargets(
  terminator: Cs486IrTerminator,
): readonly Cs486IrBlockId[] {
  switch (terminator.kind) {
    case "jump":
      return [terminator.target];
    case "branch":
      return terminator.trueTarget === terminator.falseTarget
        ? [terminator.trueTarget]
        : [terminator.trueTarget, terminator.falseTarget];
    case "return":
      return [];
  }
}

function sameSet<T>(left: ReadonlySet<T>, right: ReadonlySet<T>): boolean {
  if (left.size !== right.size) return false;
  for (const value of left) if (!right.has(value)) return false;
  return true;
}

function intersect<T>(left: ReadonlySet<T>, right: ReadonlySet<T>): Set<T> {
  const result = new Set<T>();
  for (const value of left) if (right.has(value)) result.add(value);
  return result;
}

interface Cs486IrFunctionPassResult {
  readonly changed: boolean;
  readonly function: Cs486IrFunction;
}

export interface Cs486IrOptimizationResult {
  /** False means the deterministic pass cap was reached; the returned IR is still valid. */
  readonly converged: boolean;
  readonly passes: number;
  readonly program: Cs486IrProgram;
}

/**
 * Runs bounded, deterministic integer optimizations and returns only the IR.
 * Use optimizeCs486IrWithReport when convergence telemetry is required.
 */
export function optimizeCs486Ir(
  program: Cs486IrProgram,
  overrides: Partial<Cs486IrLimits> = {},
): Cs486IrProgram {
  return optimizeCs486IrWithReport(program, overrides).program;
}

/**
 * Runs bounded leaf inlining, algebraic simplification, constant folding, copy
 * propagation, block-local CSE, pure DCE, and CFG cleanup.
 */
export function optimizeCs486IrWithReport(
  program: Cs486IrProgram,
  overrides: Partial<Cs486IrLimits> = {},
): Cs486IrOptimizationResult {
  const limits = resolveLimits(overrides);
  assertValidCs486Ir(program, limits);
  let current: Cs486IrProgram = inlineLeafFunctionCallsWithLimits(
    program,
    limits,
  ).program;
  let converged = false;
  let passes = 0;
  for (let pass = 0; pass < limits.maxOptimizationPasses; pass += 1) {
    passes = pass + 1;
    let changed = false;
    const functions = current.functions.map((function_) => {
      let result = removeUnreachableBlocks(function_);
      changed ||= result.changed;
      result = simplifyValues(result.function, limits);
      changed ||= result.changed;
      result = foldConstants(result.function, limits);
      changed ||= result.changed;
      result = propagateCopies(result.function);
      changed ||= result.changed;
      result = eliminateCommonSubexpressions(result.function);
      changed ||= result.changed;
      result = eliminateDeadPureValues(result.function);
      changed ||= result.changed;
      return result.function;
    });
    current = { ...current, functions };
    if (!changed) {
      converged = true;
      break;
    }
  }

  // A final CFG normalization keeps phi/predecessor agreement valid even when
  // the last allowed pass folded a branch.
  let finalCleanupChanged = false;
  const functions = current.functions.map((function_) => {
    let result = removeUnreachableBlocks(function_);
    finalCleanupChanged ||= result.changed;
    result = propagateCopies(result.function);
    finalCleanupChanged ||= result.changed;
    result = eliminateDeadPureValues(result.function);
    finalCleanupChanged ||= result.changed;
    return result.function;
  });
  current = { ...current, functions };
  if (finalCleanupChanged) converged = false;
  assertValidCs486Ir(current, limits);
  return { converged, passes, program: current };
}

function removeUnreachableBlocks(
  function_: Cs486IrFunction,
): Cs486IrFunctionPassResult {
  const blocks = new Map(function_.blocks.map((block) => [block.id, block]));
  const reachable = new Set<Cs486IrBlockId>();
  const queue: Cs486IrBlockId[] = [function_.entry];
  for (let index = 0; index < queue.length; index += 1) {
    const id = queue[index]!;
    if (reachable.has(id)) continue;
    reachable.add(id);
    const terminator = blocks.get(id)?.terminator;
    if (terminator === undefined) continue;
    for (const target of terminatorTargets(terminator))
      if (!reachable.has(target)) queue.push(target);
  }
  const predecessors = new Map<Cs486IrBlockId, Set<Cs486IrBlockId>>();
  for (const block of function_.blocks)
    if (reachable.has(block.id)) predecessors.set(block.id, new Set());
  for (const block of function_.blocks) {
    if (!reachable.has(block.id) || block.terminator === undefined) continue;
    for (const target of terminatorTargets(block.terminator))
      predecessors.get(target)?.add(block.id);
  }

  let changed = reachable.size !== function_.blocks.length;
  const result: Cs486IrBasicBlock[] = [];
  for (const block of function_.blocks) {
    if (!reachable.has(block.id)) continue;
    const expected = predecessors.get(block.id) ?? new Set();
    const phis = block.phis.map((phi) => {
      const incoming = phi.incoming.filter((entry) =>
        expected.has(entry.block),
      );
      if (incoming.length !== phi.incoming.length) changed = true;
      return incoming.length === phi.incoming.length
        ? phi
        : { ...phi, incoming };
    });
    result.push(
      phis.every((phi, index) => phi === block.phis[index])
        ? block
        : { ...block, phis },
    );
  }
  return {
    changed,
    function: changed ? { ...function_, blocks: result } : function_,
  };
}

function foldConstants(
  function_: Cs486IrFunction,
  limits: Cs486IrLimits,
): Cs486IrFunctionPassResult {
  const constants = new Map<Cs486IrValueId, number>();
  let valueCount = function_.parameters.length;
  for (const block of function_.blocks) {
    valueCount += block.phis.length;
    for (const instruction of block.instructions) {
      const result = instructionResult(instruction);
      if (result !== undefined) valueCount += 1;
      if (instruction.kind === "constant")
        constants.set(instruction.result, instruction.value);
    }
  }

  for (
    let pass = 0;
    pass < Math.min(valueCount + 1, limits.maxValuesPerFunction + 1);
    pass += 1
  ) {
    let changed = false;
    for (const block of function_.blocks) {
      for (const phi of block.phis) {
        if (constants.has(phi.result)) continue;
        let candidate: number | undefined;
        let known = false;
        let mismatch = false;
        for (const incoming of phi.incoming) {
          if (incoming.value === phi.result) continue;
          const value = constants.get(incoming.value);
          if (value === undefined) {
            mismatch = true;
            break;
          }
          if (!known) {
            candidate = value;
            known = true;
          } else if (candidate !== value) {
            mismatch = true;
            break;
          }
        }
        if (known && !mismatch) {
          constants.set(phi.result, candidate!);
          changed = true;
        }
      }
      for (const instruction of block.instructions) {
        const result = instructionResult(instruction);
        if (result === undefined || constants.has(result.id)) continue;
        const value = evaluateConstantInstruction(instruction, constants);
        if (value !== undefined) {
          constants.set(result.id, value);
          changed = true;
        }
      }
    }
    if (!changed) break;
  }

  let changed = false;
  const blocks = function_.blocks.map((block) => {
    const foldedPhis: Cs486IrConstantInstruction[] = [];
    const phis = block.phis.filter((phi) => {
      const value = constants.get(phi.result);
      if (value === undefined) return true;
      changed = true;
      foldedPhis.push({
        kind: "constant",
        result: phi.result,
        span: phi.span,
        type: phi.type,
        value,
      });
      return false;
    });
    const instructions = block.instructions.map((instruction) => {
      const result = instructionResult(instruction);
      const value = result === undefined ? undefined : constants.get(result.id);
      if (
        result === undefined ||
        value === undefined ||
        instruction.kind === "constant" ||
        instruction.kind === "call" ||
        instruction.kind === "indirect-call" ||
        instruction.kind === "load-local"
      )
        return instruction;
      changed = true;
      return {
        kind: "constant",
        result: result.id,
        span: instruction.span,
        type: result.type,
        value,
      } satisfies Cs486IrConstantInstruction;
    });
    let terminator = block.terminator;
    if (terminator?.kind === "branch") {
      const condition = constants.get(terminator.condition);
      if (condition !== undefined) {
        terminator = {
          kind: "jump",
          span: terminator.span,
          target:
            condition === 0 ? terminator.falseTarget : terminator.trueTarget,
        };
        changed = true;
      }
    }
    if (
      foldedPhis.length === 0 &&
      phis.length === block.phis.length &&
      instructions.every(
        (instruction, index) => instruction === block.instructions[index],
      ) &&
      terminator === block.terminator
    )
      return block;
    return {
      ...block,
      instructions: [...foldedPhis, ...instructions],
      phis,
      terminator,
    };
  });
  return {
    changed,
    function: changed ? { ...function_, blocks } : function_,
  };
}

function evaluateConstantInstruction(
  instruction: Cs486IrInstruction,
  constants: ReadonlyMap<Cs486IrValueId, number>,
): number | undefined {
  switch (instruction.kind) {
    case "constant":
      return instruction.value;
    case "copy":
      return constants.get(instruction.value);
    case "unary": {
      const operand = constants.get(instruction.operand);
      if (operand === undefined) return undefined;
      switch (instruction.operator) {
        case "neg":
          return -operand | 0;
        case "bit-not":
          return ~operand;
        case "logical-not":
          return operand === 0 ? 1 : 0;
        case "zero-extend":
          return operand === 0 ? 0 : 1;
      }
      return undefined;
    }
    case "binary": {
      const left = constants.get(instruction.left);
      const right = constants.get(instruction.right);
      if (left === undefined || right === undefined) return undefined;
      return evaluateBinary(instruction.operator, left, right);
    }
    case "call":
    case "indirect-call":
    case "load-local":
    case "store-local":
      return undefined;
  }
}

function evaluateBinary(
  operator: Cs486IrBinaryOperator,
  left: number,
  right: number,
): number | undefined {
  switch (operator) {
    case "add":
      return (left + right) | 0;
    case "sub":
      return (left - right) | 0;
    case "mul":
      return Math.imul(left, right);
    case "div":
      return right === 0 ? undefined : Math.trunc(left / right) | 0;
    case "mod":
      return right === 0 ? undefined : (left % right) | 0;
    case "and":
      return left & right;
    case "or":
      return left | right;
    case "xor":
      return left ^ right;
    case "shl":
      return left << (right & 31);
    case "shr":
      return left >> (right & 31);
    case "ushr":
      return left >>> (right & 31);
    case "udiv":
      return right === 0
        ? undefined
        : Math.trunc((left >>> 0) / (right >>> 0)) | 0;
    case "umod":
      return right === 0 ? undefined : ((left >>> 0) % (right >>> 0)) | 0;
    case "eq":
      return left === right ? 1 : 0;
    case "ne":
      return left !== right ? 1 : 0;
    case "lt":
      return left < right ? 1 : 0;
    case "le":
      return left <= right ? 1 : 0;
    case "gt":
      return left > right ? 1 : 0;
    case "ge":
      return left >= right ? 1 : 0;
    case "ult":
      return left >>> 0 < right >>> 0 ? 1 : 0;
    case "ule":
      return left >>> 0 <= right >>> 0 ? 1 : 0;
    case "ugt":
      return left >>> 0 > right >>> 0 ? 1 : 0;
    case "uge":
      return left >>> 0 >= right >>> 0 ? 1 : 0;
    case "logical-and":
      return left !== 0 && right !== 0 ? 1 : 0;
    case "logical-or":
      return left !== 0 || right !== 0 ? 1 : 0;
  }
}

function powerOfTwoShiftAmount(value: number): number | undefined {
  if (value === -2_147_483_648) return 31;
  if (value < 2 || (value & (value - 1)) !== 0) return undefined;
  return 31 - Math.clz32(value);
}

function simplifyValues(
  function_: Cs486IrFunction,
  limits: Cs486IrLimits,
): Cs486IrFunctionPassResult {
  const constants = new Map<Cs486IrValueId, number>();
  let nextValueId = 0;
  let valueCount = function_.parameters.length;
  let instructionCount = 0;
  for (const parameter of function_.parameters)
    nextValueId = Math.max(nextValueId, parameter.id + 1);
  for (const block of function_.blocks) {
    valueCount += block.phis.length;
    for (const phi of block.phis)
      nextValueId = Math.max(nextValueId, phi.result + 1);
    for (const instruction of block.instructions) {
      instructionCount += 1;
      const result = instructionResult(instruction);
      if (result !== undefined) {
        valueCount += 1;
        nextValueId = Math.max(nextValueId, result.id + 1);
      }
      if (instruction.kind === "constant")
        constants.set(instruction.result, instruction.value);
    }
  }

  const allocateConstant = (
    value: number,
  ): Cs486IrConstantInstruction | undefined => {
    if (
      valueCount + 1 > limits.maxValuesPerFunction ||
      instructionCount + 1 > limits.maxInstructionsPerFunction
    )
      return undefined;
    valueCount += 1;
    instructionCount += 1;
    const constant: Cs486IrConstantInstruction = {
      kind: "constant",
      result: nextValueId,
      type: "i32",
      value,
    };
    nextValueId += 1;
    return constant;
  };

  let changed = false;
  const blocks = function_.blocks.map((block) => {
    let blockChanged = false;
    const instructions: Cs486IrInstruction[] = [];
    for (const instruction of block.instructions) {
      const replacement =
        instruction.kind === "binary"
          ? simplifyBinaryInstruction(instruction, constants, allocateConstant)
          : undefined;
      if (replacement === undefined) {
        instructions.push(instruction);
        continue;
      }
      blockChanged = true;
      instructions.push(...replacement);
    }
    if (!blockChanged) return block;
    changed = true;
    return { ...block, instructions };
  });
  return { changed, function: changed ? { ...function_, blocks } : function_ };
}

/**
 * Returns a cheaper equivalent instruction sequence or undefined. Signed
 * div/mod stay untouched: shifting mismatches truncating division rounding.
 */
function simplifyBinaryInstruction(
  instruction: Cs486IrBinaryInstruction,
  constants: ReadonlyMap<Cs486IrValueId, number>,
  allocateConstant: (value: number) => Cs486IrConstantInstruction | undefined,
): readonly Cs486IrInstruction[] | undefined {
  const { left, right } = instruction;
  const leftConstant = constants.get(left);
  const rightConstant = constants.get(right);
  // Fully constant operands stay owned by foldConstants.
  if (leftConstant !== undefined && rightConstant !== undefined)
    return undefined;
  const copyOf = (value: Cs486IrValueId): readonly Cs486IrInstruction[] => [
    {
      kind: "copy",
      result: instruction.result,
      span: instruction.span,
      type: instruction.type,
      value,
    },
  ];
  const constantOf = (value: number): readonly Cs486IrInstruction[] => [
    {
      kind: "constant",
      result: instruction.result,
      span: instruction.span,
      type: instruction.type,
      value,
    },
  ];
  const withConstant = (
    operator: Extract<Cs486IrBinaryOperator, "and" | "shl" | "ushr">,
    operand: Cs486IrValueId,
    value: number,
  ): readonly Cs486IrInstruction[] | undefined => {
    const constant = allocateConstant(value);
    if (constant === undefined) return undefined;
    return [
      constant,
      {
        kind: "binary",
        left: operand,
        operator,
        result: instruction.result,
        right: constant.result,
        span: instruction.span,
        type: instruction.type,
      },
    ];
  };
  switch (instruction.operator) {
    case "add":
      if (rightConstant === 0) return copyOf(left);
      if (leftConstant === 0) return copyOf(right);
      return undefined;
    case "sub":
      if (left === right) return constantOf(0);
      if (rightConstant === 0) return copyOf(left);
      return undefined;
    case "mul": {
      if (leftConstant === 0 || rightConstant === 0) return constantOf(0);
      if (rightConstant === 1) return copyOf(left);
      if (leftConstant === 1) return copyOf(right);
      const rightShift =
        rightConstant === undefined
          ? undefined
          : powerOfTwoShiftAmount(rightConstant);
      if (rightShift !== undefined)
        return withConstant("shl", left, rightShift);
      const leftShift =
        leftConstant === undefined
          ? undefined
          : powerOfTwoShiftAmount(leftConstant);
      if (leftShift !== undefined) return withConstant("shl", right, leftShift);
      return undefined;
    }
    case "and":
      if (left === right) return copyOf(left);
      if (leftConstant === 0 || rightConstant === 0) return constantOf(0);
      if (rightConstant === -1) return copyOf(left);
      if (leftConstant === -1) return copyOf(right);
      return undefined;
    case "or":
      if (left === right) return copyOf(left);
      if (rightConstant === 0) return copyOf(left);
      if (leftConstant === 0) return copyOf(right);
      if (leftConstant === -1 || rightConstant === -1) return constantOf(-1);
      return undefined;
    case "xor":
      if (left === right) return constantOf(0);
      if (rightConstant === 0) return copyOf(left);
      if (leftConstant === 0) return copyOf(right);
      return undefined;
    case "shl":
    case "shr":
    case "ushr":
      if (rightConstant === 0) return copyOf(left);
      return undefined;
    case "udiv": {
      if (rightConstant === 1) return copyOf(left);
      const shift =
        rightConstant === undefined
          ? undefined
          : powerOfTwoShiftAmount(rightConstant);
      if (shift !== undefined) return withConstant("ushr", left, shift);
      return undefined;
    }
    case "umod": {
      if (rightConstant === 1) return constantOf(0);
      const shift =
        rightConstant === undefined
          ? undefined
          : powerOfTwoShiftAmount(rightConstant);
      if (shift === undefined) return undefined;
      const mask =
        rightConstant === -2_147_483_648 ? 2_147_483_647 : rightConstant! - 1;
      return withConstant("and", left, mask);
    }
    case "div":
    case "mod":
      return undefined;
    case "eq":
    case "le":
    case "ge":
    case "ule":
    case "uge":
      return left === right ? constantOf(1) : undefined;
    case "ne":
    case "lt":
    case "gt":
    case "ult":
    case "ugt":
      return left === right ? constantOf(0) : undefined;
    case "logical-and":
      if (left === right) return copyOf(left);
      if (leftConstant === 0 || rightConstant === 0) return constantOf(0);
      if (leftConstant === 1) return copyOf(right);
      if (rightConstant === 1) return copyOf(left);
      return undefined;
    case "logical-or":
      if (left === right) return copyOf(left);
      if (leftConstant === 1 || rightConstant === 1) return constantOf(1);
      if (leftConstant === 0) return copyOf(right);
      if (rightConstant === 0) return copyOf(left);
      return undefined;
  }
}

function propagateCopies(
  function_: Cs486IrFunction,
): Cs486IrFunctionPassResult {
  const aliases = new Map<Cs486IrValueId, Cs486IrValueId>();
  for (const block of function_.blocks)
    for (const instruction of block.instructions)
      if (
        instruction.kind === "copy" &&
        !createsAliasCycle(instruction.result, instruction.value, aliases)
      )
        aliases.set(instruction.result, instruction.value);

  const phiCount = function_.blocks.reduce(
    (total, block) => total + block.phis.length,
    0,
  );
  for (let pass = 0; pass < phiCount + 1; pass += 1) {
    let changed = false;
    for (const block of function_.blocks)
      for (const phi of block.phis) {
        if (aliases.has(phi.result)) continue;
        const candidates = new Set<Cs486IrValueId>();
        for (const incoming of phi.incoming) {
          const value = resolveAlias(incoming.value, aliases);
          if (value !== phi.result) candidates.add(value);
        }
        if (candidates.size !== 1) continue;
        const candidate = candidates.values().next().value;
        if (
          candidate !== undefined &&
          !createsAliasCycle(phi.result, candidate, aliases)
        ) {
          aliases.set(phi.result, candidate);
          changed = true;
        }
      }
    if (!changed) break;
  }
  if (aliases.size === 0) return { changed: false, function: function_ };

  let changed = false;
  const rewrite = (id: Cs486IrValueId): Cs486IrValueId => {
    const result = resolveAlias(id, aliases);
    if (result !== id) changed = true;
    return result;
  };
  const blocks = function_.blocks.map((block) => {
    const phis = block.phis
      .filter((phi) => {
        if (!aliases.has(phi.result)) return true;
        changed = true;
        return false;
      })
      .map((phi) => ({
        ...phi,
        incoming: phi.incoming.map((incoming) => ({
          ...incoming,
          value: rewrite(incoming.value),
        })),
      }));
    const instructions = block.instructions
      .filter((instruction) => {
        const result = instructionResult(instruction);
        if (result === undefined || !aliases.has(result.id)) return true;
        changed = true;
        return false;
      })
      .map((instruction) => rewriteInstruction(instruction, rewrite));
    const terminator =
      block.terminator === undefined
        ? undefined
        : rewriteTerminator(block.terminator, rewrite);
    return { ...block, instructions, phis, terminator };
  });
  return { changed, function: changed ? { ...function_, blocks } : function_ };
}

function createsAliasCycle(
  result: Cs486IrValueId,
  value: Cs486IrValueId,
  aliases: ReadonlyMap<Cs486IrValueId, Cs486IrValueId>,
): boolean {
  let current = value;
  for (let step = 0; step <= aliases.size; step += 1) {
    if (current === result) return true;
    const next = aliases.get(current);
    if (next === undefined) return false;
    current = next;
  }
  return true;
}

function resolveAlias(
  id: Cs486IrValueId,
  aliases: ReadonlyMap<Cs486IrValueId, Cs486IrValueId>,
): Cs486IrValueId {
  let current = id;
  const seen = new Set<Cs486IrValueId>();
  for (let step = 0; step <= aliases.size; step += 1) {
    if (seen.has(current)) return id;
    seen.add(current);
    const next = aliases.get(current);
    if (next === undefined) return current;
    current = next;
  }
  return id;
}

function rewriteInstruction(
  instruction: Cs486IrInstruction,
  rewrite: (id: Cs486IrValueId) => Cs486IrValueId,
): Cs486IrInstruction {
  switch (instruction.kind) {
    case "constant":
    case "address-local":
    case "address-symbol":
    case "load-local":
      return instruction;
    case "copy":
      return { ...instruction, value: rewrite(instruction.value) };
    case "unary":
      return { ...instruction, operand: rewrite(instruction.operand) };
    case "binary":
      return {
        ...instruction,
        left: rewrite(instruction.left),
        right: rewrite(instruction.right),
      };
    case "store-local":
      return { ...instruction, value: rewrite(instruction.value) };
    case "load-memory":
      return { ...instruction, address: rewrite(instruction.address) };
    case "store-memory":
      return {
        ...instruction,
        address: rewrite(instruction.address),
        value: rewrite(instruction.value),
      };
    case "call":
      return {
        ...instruction,
        arguments: instruction.arguments.map(rewrite),
      };
    case "indirect-call":
      return {
        ...instruction,
        arguments: instruction.arguments.map(rewrite),
        target: rewrite(instruction.target),
      };
  }
}

function rewriteTerminator(
  terminator: Cs486IrTerminator,
  rewrite: (id: Cs486IrValueId) => Cs486IrValueId,
): Cs486IrTerminator {
  switch (terminator.kind) {
    case "jump":
      return terminator;
    case "branch":
      return { ...terminator, condition: rewrite(terminator.condition) };
    case "return":
      return terminator.value === undefined
        ? terminator
        : {
            ...terminator,
            value: rewrite(terminator.value),
            ...(terminator.valueHigh === undefined
              ? {}
              : { valueHigh: rewrite(terminator.valueHigh) }),
          };
  }
}

const commutativeBinaryOperators: ReadonlySet<Cs486IrBinaryOperator> = new Set([
  "add",
  "and",
  "eq",
  "logical-and",
  "logical-or",
  "mul",
  "ne",
  "or",
  "xor",
]);

/**
 * Block-local available-expression CSE. Duplicate pure computations and
 * repeated loads become copies of the first occurrence; conservative kill
 * rules invalidate cached loads across stores, calls, and volatile accesses.
 */
function eliminateCommonSubexpressions(
  function_: Cs486IrFunction,
): Cs486IrFunctionPassResult {
  const constants = new Map<Cs486IrValueId, number>();
  for (const block of function_.blocks)
    for (const instruction of block.instructions)
      if (instruction.kind === "constant")
        constants.set(instruction.result, instruction.value);

  let changed = false;
  const blocks = function_.blocks.map((block) => {
    const available = new Map<string, Cs486IrValueId>();
    const rename = new Map<Cs486IrValueId, Cs486IrValueId>();
    const resolve = (id: Cs486IrValueId): Cs486IrValueId =>
      rename.get(id) ?? id;
    const token = (id: Cs486IrValueId): string => {
      const resolved = resolve(id);
      const constant = constants.get(resolved);
      return constant === undefined
        ? `v${String(resolved)}`
        : `c${String(constant)}`;
    };
    const dropKeys = (prefix: string): void => {
      for (const key of [...available.keys()])
        if (key.startsWith(prefix)) available.delete(key);
    };

    let blockChanged = false;
    const instructions = block.instructions.map((original) => {
      let operandChanged = false;
      const rewritten = rewriteInstruction(original, (id) => {
        const resolved = resolve(id);
        if (resolved !== id) operandChanged = true;
        return resolved;
      });
      const instruction = operandChanged ? rewritten : original;
      if (operandChanged) blockChanged = true;

      let key: string | undefined;
      switch (instruction.kind) {
        case "constant":
        case "copy":
          return instruction;
        case "unary":
          key = `u|${instruction.operator}|${instruction.type}|${token(instruction.operand)}`;
          break;
        case "binary": {
          const leftToken = token(instruction.left);
          const rightToken = token(instruction.right);
          const ordered =
            commutativeBinaryOperators.has(instruction.operator) &&
            rightToken < leftToken
              ? `${rightToken}|${leftToken}`
              : `${leftToken}|${rightToken}`;
          key = `b|${instruction.operator}|${instruction.type}|${ordered}`;
          break;
        }
        case "address-local":
          key = `al|${instruction.local}`;
          break;
        case "address-symbol":
          key = `as|${instruction.symbol}`;
          break;
        case "load-local":
          if (instruction.volatile === true) {
            dropKeys("ll|");
            return instruction;
          }
          key = `ll|${instruction.local}|${instruction.type}`;
          break;
        case "load-memory":
          if (instruction.volatile === true) {
            dropKeys("lm|");
            return instruction;
          }
          key = `lm|${token(instruction.address)}|${String(instruction.width ?? 4)}|${instruction.signed === true ? "s" : "u"}`;
          break;
        case "store-local":
          dropKeys(`ll|${instruction.local}|`);
          dropKeys("lm|");
          return instruction;
        case "store-memory":
          dropKeys("ll|");
          dropKeys("lm|");
          return instruction;
        case "call":
        case "indirect-call":
          dropKeys("ll|");
          dropKeys("lm|");
          return instruction;
      }
      const result = instructionResult(instruction);
      if (result === undefined) return instruction;
      const existing = available.get(key);
      if (existing === undefined) {
        available.set(key, result.id);
        return instruction;
      }
      rename.set(result.id, existing);
      blockChanged = true;
      return {
        kind: "copy",
        result: result.id,
        span: instruction.span,
        type: result.type,
        value: existing,
      } satisfies Cs486IrCopyInstruction;
    });

    let terminator = block.terminator;
    if (terminator !== undefined && rename.size > 0) {
      let terminatorChanged = false;
      const rewrittenTerminator = rewriteTerminator(terminator, (id) => {
        const resolved = resolve(id);
        if (resolved !== id) terminatorChanged = true;
        return resolved;
      });
      if (terminatorChanged) {
        terminator = rewrittenTerminator;
        blockChanged = true;
      }
    }
    if (!blockChanged) return block;
    changed = true;
    return { ...block, instructions, terminator };
  });
  return { changed, function: changed ? { ...function_, blocks } : function_ };
}

interface Cs486IrDeadValueNode {
  readonly operands: readonly Cs486IrValueId[];
  readonly removable: boolean;
  readonly result: Cs486IrValueId;
}

function eliminateDeadPureValues(
  function_: Cs486IrFunction,
): Cs486IrFunctionPassResult {
  const nodes = new Map<Cs486IrValueId, Cs486IrDeadValueNode>();
  const useCounts = new Map<Cs486IrValueId, number>();
  const countUse = (id: Cs486IrValueId): void => {
    useCounts.set(id, (useCounts.get(id) ?? 0) + 1);
  };
  for (const block of function_.blocks) {
    for (const phi of block.phis) {
      const operands = phi.incoming.map((incoming) => incoming.value);
      nodes.set(phi.result, { operands, removable: true, result: phi.result });
      for (const operand of operands) countUse(operand);
    }
    for (const instruction of block.instructions) {
      const operands = instructionOperands(instruction);
      for (const operand of operands) countUse(operand);
      const result = instructionResult(instruction);
      if (result !== undefined)
        nodes.set(result.id, {
          operands,
          removable: isDeadCodeRemovable(instruction),
          result: result.id,
        });
    }
    if (block.terminator !== undefined)
      for (const operand of terminatorOperands(block.terminator))
        countUse(operand);
  }

  const queue = [...nodes.values()]
    .filter((node) => node.removable && (useCounts.get(node.result) ?? 0) === 0)
    .sort((left, right) => left.result - right.result);
  const removed = new Set<Cs486IrValueId>();
  for (let index = 0; index < queue.length; index += 1) {
    const node = queue[index]!;
    if (removed.has(node.result) || (useCounts.get(node.result) ?? 0) !== 0)
      continue;
    removed.add(node.result);
    for (const operand of node.operands) {
      const nextCount = Math.max(0, (useCounts.get(operand) ?? 0) - 1);
      useCounts.set(operand, nextCount);
      const operandNode = nodes.get(operand);
      if (nextCount === 0 && operandNode?.removable === true)
        queue.push(operandNode);
    }
  }
  if (removed.size === 0) return { changed: false, function: function_ };
  const blocks = function_.blocks.map((block) => ({
    ...block,
    instructions: block.instructions.filter((instruction) => {
      const result = instructionResult(instruction);
      return result === undefined || !removed.has(result.id);
    }),
    phis: block.phis.filter((phi) => !removed.has(phi.result)),
  }));
  return { changed: true, function: { ...function_, blocks } };
}

function isDeadCodeRemovable(instruction: Cs486IrInstruction): boolean {
  if (
    "volatile" in instruction &&
    (instruction as { readonly volatile?: true }).volatile === true
  )
    return false;
  if (
    instruction.kind === "call" ||
    instruction.kind === "indirect-call" ||
    instruction.kind === "store-local" ||
    instruction.kind === "store-memory"
  )
    return false;
  // All four division operators fault on zero divisors, so none may vanish.
  return !(
    instruction.kind === "binary" &&
    (instruction.operator === "div" ||
      instruction.operator === "mod" ||
      instruction.operator === "udiv" ||
      instruction.operator === "umod")
  );
}

export interface Cs486IrInliningResult {
  readonly inlinedCallSites: number;
  readonly program: Cs486IrProgram;
}

interface Cs486IrInlineCandidate {
  readonly function: Cs486IrFunction;
  readonly instructionCount: number;
  readonly resultCount: number;
  readonly returnCount: number;
}

/**
 * One-shot bounded inlining of small leaf functions. Runs before the iterated
 * optimization loop so convergence semantics stay unchanged. Return values
 * merge through synthetic locals because this backend rejects phi destruction.
 * Every overflow or namespace conflict skips the call site instead of failing.
 */
export function inlineLeafFunctionCalls(
  program: Cs486IrProgram,
  overrides: Partial<Cs486IrLimits> = {},
): Cs486IrInliningResult {
  return inlineLeafFunctionCallsWithLimits(program, resolveLimits(overrides));
}

function inlineLeafFunctionCallsWithLimits(
  program: Cs486IrProgram,
  limits: Cs486IrLimits,
): Cs486IrInliningResult {
  const candidates = new Map<string, Cs486IrInlineCandidate>();
  for (const function_ of program.functions) {
    const candidate = inlineCandidate(function_, limits);
    if (candidate !== undefined) candidates.set(function_.name, candidate);
  }
  if (candidates.size === 0) return { inlinedCallSites: 0, program };

  let inlinedCallSites = 0;
  const functions = program.functions.map((caller) => {
    const result = inlineIntoFunction(caller, candidates, limits);
    inlinedCallSites += result.inlinedCallSites;
    return result.function;
  });
  return {
    inlinedCallSites,
    program: inlinedCallSites === 0 ? program : { ...program, functions },
  };
}

function inlineCandidate(
  function_: Cs486IrFunction,
  limits: Cs486IrLimits,
): Cs486IrInlineCandidate | undefined {
  if (function_.variadic === true || function_.wideReturn === true)
    return undefined;
  if (function_.name.startsWith(".cs.inline.")) return undefined;
  if (function_.blocks.length > limits.maxInlineCalleeBlocks) return undefined;
  if (!function_.blocks.some((block) => block.id === function_.entry))
    return undefined;
  const defined = new Set<Cs486IrValueId>(
    function_.parameters.map((parameter) => parameter.id),
  );
  let instructionCount = 0;
  let resultCount = 0;
  let returnCount = 0;
  for (const block of function_.blocks) {
    if (block.phis.length > 0 || block.terminator === undefined)
      return undefined;
    for (const instruction of block.instructions) {
      if (instruction.kind === "call" || instruction.kind === "indirect-call")
        return undefined;
      instructionCount += 1;
      const result = instructionResult(instruction);
      if (result !== undefined) {
        resultCount += 1;
        defined.add(result.id);
      }
    }
    if (block.terminator.kind === "return") {
      if (block.terminator.valueHigh !== undefined) return undefined;
      if (
        function_.returnType !== "void" &&
        block.terminator.value === undefined
      )
        return undefined;
      returnCount += 1;
    }
  }
  if (instructionCount > limits.maxInlineCalleeInstructions) return undefined;
  if (returnCount === 0) return undefined;
  for (const block of function_.blocks) {
    for (const instruction of block.instructions)
      for (const operand of instructionOperands(instruction))
        if (!defined.has(operand)) return undefined;
    for (const operand of terminatorOperands(block.terminator!))
      if (!defined.has(operand)) return undefined;
  }
  return { function: function_, instructionCount, resultCount, returnCount };
}

function inlineIntoFunction(
  caller: Cs486IrFunction,
  candidates: ReadonlyMap<string, Cs486IrInlineCandidate>,
  limits: Cs486IrLimits,
): { readonly function: Cs486IrFunction; readonly inlinedCallSites: number } {
  // Hand-authored IR may already use the reserved namespace; skip the caller
  // deterministically instead of risking a block or local identifier clash.
  if (
    caller.blocks.some((block) => block.id.startsWith(".inline")) ||
    caller.locals.some((local) => local.name.startsWith(".inline"))
  )
    return { function: caller, inlinedCallSites: 0 };

  let nextValueId = 0;
  let valueCount = caller.parameters.length;
  let instructionCount = 0;
  for (const parameter of caller.parameters)
    nextValueId = Math.max(nextValueId, parameter.id + 1);
  for (const block of caller.blocks) {
    valueCount += block.phis.length;
    for (const phi of block.phis)
      nextValueId = Math.max(nextValueId, phi.result + 1);
    for (const instruction of block.instructions) {
      instructionCount += 1;
      const result = instructionResult(instruction);
      if (result !== undefined) {
        valueCount += 1;
        nextValueId = Math.max(nextValueId, result.id + 1);
      }
    }
  }

  const maxValues = Math.min(
    limits.maxValuesPerFunction,
    limits.maxRegisterAllocationValues,
  );
  const blocks = [...caller.blocks];
  const locals = [...caller.locals];
  let budget = limits.maxInlinedInstructionsPerFunction;
  let inlinedCallSites = 0;
  let blockIndex = 0;
  let instructionIndex = 0;
  while (blockIndex < blocks.length) {
    const block = blocks[blockIndex]!;
    if (
      instructionIndex >= block.instructions.length ||
      block.terminator === undefined
    ) {
      blockIndex += 1;
      instructionIndex = 0;
      continue;
    }
    const call = block.instructions[instructionIndex]!;
    if (call.kind !== "call" || call.wideResultLocal !== undefined) {
      instructionIndex += 1;
      continue;
    }
    const candidate = candidates.get(call.callee);
    if (
      candidate === undefined ||
      candidate.function.name === caller.name ||
      call.arguments.length !== candidate.function.parameters.length
    ) {
      instructionIndex += 1;
      continue;
    }
    const returnType = candidate.function.returnType;
    if (
      (returnType === "void") !== (call.result === undefined) ||
      (call.result !== undefined && call.type !== returnType)
    ) {
      instructionIndex += 1;
      continue;
    }

    const namespace = `.inline${String(inlinedCallSites)}`;
    const mergeNeeded = call.result !== undefined && candidate.returnCount > 1;
    const singleReturnCopy =
      call.result !== undefined && candidate.returnCount === 1;
    const addedInstructions =
      candidate.instructionCount +
      (mergeNeeded ? candidate.returnCount + 1 : 0) +
      (singleReturnCopy ? 1 : 0);
    const addedLocals =
      candidate.function.locals.length + (mergeNeeded ? 1 : 0);
    const identifierBudget =
      limits.maxIdentifierLength - namespace.length - ".local.".length;
    const identifiersFit =
      candidate.function.blocks.every(
        (calleeBlock) => calleeBlock.id.length <= identifierBudget,
      ) &&
      candidate.function.locals.every(
        (local) => local.name.length <= identifierBudget,
      );
    if (
      !identifiersFit ||
      addedInstructions > budget ||
      instructionCount - 1 + addedInstructions >
        limits.maxInstructionsPerFunction ||
      blocks.length + candidate.function.blocks.length + 1 >
        limits.maxBlocksPerFunction ||
      valueCount + candidate.resultCount > maxValues ||
      locals.length + addedLocals > limits.maxLocalsPerFunction
    ) {
      instructionIndex += 1;
      continue;
    }

    const joinId = `${namespace}.join`;
    const mergeLocalName = `${namespace}.ret`;
    const blockRename = new Map<Cs486IrBlockId, Cs486IrBlockId>(
      candidate.function.blocks.map((calleeBlock) => [
        calleeBlock.id,
        `${namespace}.body.${calleeBlock.id}`,
      ]),
    );
    const localRename = new Map<string, string>(
      candidate.function.locals.map((local) => [
        local.name,
        `${namespace}.local.${local.name}`,
      ]),
    );
    const valueMap = new Map<Cs486IrValueId, Cs486IrValueId>();
    candidate.function.parameters.forEach((parameter, index) => {
      valueMap.set(parameter.id, call.arguments[index]!);
    });
    for (const calleeBlock of candidate.function.blocks)
      for (const instruction of calleeBlock.instructions) {
        const result = instructionResult(instruction);
        if (result !== undefined) {
          valueMap.set(result.id, nextValueId);
          nextValueId += 1;
        }
      }

    let singleReturnValue: Cs486IrValueId | undefined;
    const clonedBlocks = candidate.function.blocks.map((calleeBlock) => {
      const instructions = calleeBlock.instructions.map((instruction) =>
        cloneInlinedInstruction(instruction, valueMap, localRename),
      );
      const terminator = calleeBlock.terminator!;
      let clonedTerminator: Cs486IrTerminator;
      if (terminator.kind === "jump") {
        clonedTerminator = {
          kind: "jump",
          span: terminator.span,
          target: blockRename.get(terminator.target) ?? terminator.target,
        };
      } else if (terminator.kind === "branch") {
        clonedTerminator = {
          condition: valueMap.get(terminator.condition)!,
          falseTarget:
            blockRename.get(terminator.falseTarget) ?? terminator.falseTarget,
          kind: "branch",
          span: terminator.span,
          trueTarget:
            blockRename.get(terminator.trueTarget) ?? terminator.trueTarget,
        };
      } else {
        if (call.result !== undefined && terminator.value !== undefined) {
          const mapped = valueMap.get(terminator.value)!;
          if (mergeNeeded)
            instructions.push({
              kind: "store-local",
              local: mergeLocalName,
              span: terminator.span,
              value: mapped,
            });
          else singleReturnValue = mapped;
        }
        clonedTerminator = {
          kind: "jump",
          span: terminator.span,
          target: joinId,
        };
      }
      return {
        id: blockRename.get(calleeBlock.id)!,
        instructions,
        phis: [],
        span: calleeBlock.span,
        terminator: clonedTerminator,
      } satisfies Cs486IrBasicBlock;
    });

    const joinPrefix: Cs486IrInstruction[] = [];
    if (call.result !== undefined && call.type !== undefined) {
      if (mergeNeeded)
        joinPrefix.push({
          kind: "load-local",
          local: mergeLocalName,
          result: call.result,
          span: call.span,
          type: call.type,
        });
      else if (singleReturnValue !== undefined)
        joinPrefix.push({
          kind: "copy",
          result: call.result,
          span: call.span,
          type: call.type,
          value: singleReturnValue,
        });
    }
    const headBlock: Cs486IrBasicBlock = {
      ...block,
      instructions: block.instructions.slice(0, instructionIndex),
      terminator: {
        kind: "jump",
        span: call.span,
        target: blockRename.get(candidate.function.entry)!,
      },
    };
    const joinBlock: Cs486IrBasicBlock = {
      id: joinId,
      instructions: [
        ...joinPrefix,
        ...block.instructions.slice(instructionIndex + 1),
      ],
      phis: [],
      span: block.span,
      terminator: block.terminator,
    };
    blocks.splice(blockIndex, 1, headBlock, ...clonedBlocks, joinBlock);
    // The split block's original successors now flow from the join block.
    for (let index = 0; index < blocks.length; index += 1) {
      const successor = blocks[index]!;
      if (successor.phis.length === 0) continue;
      let blockPhisChanged = false;
      const phis = successor.phis.map((phi) => {
        let phiChanged = false;
        const incoming = phi.incoming.map((entry) => {
          if (entry.block !== block.id) return entry;
          phiChanged = true;
          return { ...entry, block: joinId };
        });
        if (!phiChanged) return phi;
        blockPhisChanged = true;
        return { ...phi, incoming };
      });
      if (blockPhisChanged) blocks[index] = { ...successor, phis };
    }
    for (const local of candidate.function.locals)
      locals.push({ ...local, name: localRename.get(local.name)! });
    if (mergeNeeded)
      locals.push({
        name: mergeLocalName,
        type: returnType as Cs486IrValueType,
      });

    instructionCount += addedInstructions - 1;
    valueCount += candidate.resultCount;
    budget -= addedInstructions;
    inlinedCallSites += 1;
    blockIndex += 1 + clonedBlocks.length;
    instructionIndex = 0;
  }
  if (inlinedCallSites === 0) return { function: caller, inlinedCallSites: 0 };
  return {
    function: { ...caller, blocks, locals },
    inlinedCallSites,
  };
}

/** Clones a leaf-callee instruction; call kinds are excluded by candidacy. */
function cloneInlinedInstruction(
  instruction: Cs486IrInstruction,
  valueMap: ReadonlyMap<Cs486IrValueId, Cs486IrValueId>,
  localRename: ReadonlyMap<string, string>,
): Cs486IrInstruction {
  const map = (id: Cs486IrValueId): Cs486IrValueId => valueMap.get(id) ?? id;
  switch (instruction.kind) {
    case "constant":
      return { ...instruction, result: map(instruction.result) };
    case "copy":
      return {
        ...instruction,
        result: map(instruction.result),
        value: map(instruction.value),
      };
    case "unary":
      return {
        ...instruction,
        operand: map(instruction.operand),
        result: map(instruction.result),
      };
    case "binary":
      return {
        ...instruction,
        left: map(instruction.left),
        result: map(instruction.result),
        right: map(instruction.right),
      };
    case "load-local":
      return {
        ...instruction,
        local: localRename.get(instruction.local) ?? instruction.local,
        result: map(instruction.result),
      };
    case "store-local":
      return {
        ...instruction,
        local: localRename.get(instruction.local) ?? instruction.local,
        value: map(instruction.value),
      };
    case "address-local":
      return {
        ...instruction,
        local: localRename.get(instruction.local) ?? instruction.local,
        result: map(instruction.result),
      };
    case "address-symbol":
      return { ...instruction, result: map(instruction.result) };
    case "load-memory":
      return {
        ...instruction,
        address: map(instruction.address),
        result: map(instruction.result),
      };
    case "store-memory":
      return {
        ...instruction,
        address: map(instruction.address),
        value: map(instruction.value),
      };
    case "call":
    case "indirect-call":
      throw new Error("leaf inline candidates cannot contain calls");
  }
}

export type Cs486IrAllocatableRegister = Extract<
  Cs486Register,
  "eax" | "ebx" | "ecx" | "edi" | "edx" | "esi"
>;

export const CS486_IR_ALLOCATABLE_REGISTERS: readonly Cs486IrAllocatableRegister[] =
  Object.freeze(["eax", "ebx", "ecx", "edx", "esi", "edi"]);
export const CS486_IR_RESERVED_REGISTERS: readonly Extract<
  Cs486Register,
  "ebp" | "esp"
>[] = Object.freeze(["esp", "ebp"]);

export type Cs486IrValueLocation =
  | {
      readonly kind: "register";
      readonly precolored?: true;
      readonly register: Cs486IrAllocatableRegister;
    }
  | {
      /** Negative EBP-relative byte offset after the declared four-byte locals. */
      readonly byteOffset: number;
      readonly kind: "spill";
      readonly reason: "call-live" | "clobber-live" | "pressure";
      readonly slot: number;
    };

export interface Cs486IrLiveInterval {
  readonly end: number;
  readonly start: number;
  readonly type: Cs486IrValueType;
  readonly value: Cs486IrValueId;
}

export interface Cs486IrRegisterAllocation {
  readonly algorithm: "linear-scan";
  readonly intervals: readonly Cs486IrLiveInterval[];
  readonly locations: ReadonlyMap<Cs486IrValueId, Cs486IrValueLocation>;
  readonly registers: readonly Cs486IrAllocatableRegister[];
  readonly spillSlotCount: number;
}

export interface Cs486IrRegisterAllocationOptions {
  /** Registers destroyed by a call; all allocatable registers are the safe default. */
  readonly callClobbers?: readonly Cs486IrAllocatableRegister[];
  /** Extra opaque clobbers, such as an inline-assembly statement. */
  readonly clobbers?: readonly Cs486IrRegisterClobber[];
  readonly limits?: Partial<Cs486IrLimits>;
  readonly maxValues?: number;
  /** Values constrained to a physical register by lowering or ABI rules. */
  readonly precolored?: ReadonlyMap<Cs486IrValueId, Cs486IrAllocatableRegister>;
  readonly registers?: readonly Cs486IrAllocatableRegister[];
}

export interface Cs486IrRegisterClobber {
  readonly block: Cs486IrBlockId;
  /** Zero-based instruction index whose execution destroys these registers. */
  readonly instructionIndex: number;
  readonly registers: readonly Cs486IrAllocatableRegister[];
}

interface MutableInterval {
  end: number;
  start: number;
  readonly type: Cs486IrValueType;
  readonly value: Cs486IrValueId;
}

/**
 * Deterministic bounded greedy linear-scan allocation. Values live across a
 * CALL are explicitly spilled because the current CS486 ABI has no callee-saved
 * register contract. ESP and EBP can never enter the allocatable set.
 */
export function allocateCs486IrRegisters(
  function_: Cs486IrFunction,
  options: Cs486IrRegisterAllocationOptions = {},
): Cs486IrRegisterAllocation {
  return allocateCs486IrRegistersLinearScan(function_, options);
}

/** Explicit name for the guaranteed baseline allocator. */
export function allocateCs486IrRegistersLinearScan(
  function_: Cs486IrFunction,
  options: Cs486IrRegisterAllocationOptions = {},
): Cs486IrRegisterAllocation {
  const limits = resolveLimits(options.limits ?? {});
  const registers = options.registers ?? CS486_IR_ALLOCATABLE_REGISTERS;
  const callClobbers = options.callClobbers ?? CS486_IR_ALLOCATABLE_REGISTERS;
  const maxValues = options.maxValues ?? limits.maxRegisterAllocationValues;
  if (
    !Number.isSafeInteger(maxValues) ||
    maxValues <= 0 ||
    maxValues > limits.maxRegisterAllocationValues
  )
    throw new RangeError(
      "register allocation value limit must be positive and within the CSIR limit",
    );
  if (function_.blocks.length > limits.maxBlocksPerFunction)
    throw new RangeError("register allocation basic block limit exceeded");
  if (function_.parameters.length > limits.maxParametersPerFunction)
    throw new RangeError("register allocation parameter limit exceeded");
  if ((options.clobbers?.length ?? 0) > limits.maxInstructionsPerFunction)
    throw new RangeError("register allocation clobber limit exceeded");
  if (registers.length > CS486_IR_ALLOCATABLE_REGISTERS.length)
    throw new RangeError("register allocation register limit exceeded");
  if (callClobbers.length > CS486_IR_ALLOCATABLE_REGISTERS.length)
    throw new RangeError("call clobber register limit exceeded");
  let operationCount = 0;
  for (const block of function_.blocks) {
    operationCount += block.phis.length + block.instructions.length + 1;
    if (operationCount > limits.maxInstructionsPerFunction)
      throw new RangeError("register allocation instruction limit exceeded");
    for (const phi of block.phis)
      if (phi.incoming.length > limits.maxPhiInputs)
        throw new RangeError("register allocation phi input limit exceeded");
  }
  const orderedBlocks = registerAllocationBlockOrder(function_);
  const registerSet = new Set<Cs486IrAllocatableRegister>();
  for (const register of registers) {
    if (!CS486_IR_ALLOCATABLE_REGISTERS.includes(register))
      throw new RangeError(`register ${register} is reserved or unsupported`);
    if (registerSet.has(register))
      throw new RangeError(`register ${register} appears more than once`);
    registerSet.add(register);
  }
  const validateClobberRegisters = (
    clobbers: readonly Cs486IrAllocatableRegister[],
  ): void => {
    const seen = new Set<Cs486IrAllocatableRegister>();
    for (const register of clobbers) {
      if (!CS486_IR_ALLOCATABLE_REGISTERS.includes(register))
        throw new RangeError(
          `clobber register ${register} is reserved or unsupported`,
        );
      if (seen.has(register))
        throw new RangeError(
          `clobber register ${register} appears more than once`,
        );
      seen.add(register);
    }
  };
  validateClobberRegisters(callClobbers);
  for (const clobber of options.clobbers ?? [])
    validateClobberRegisters(clobber.registers);

  const positions = new Map<Cs486IrInstruction, number>();
  const terminatorPositions = new Map<Cs486IrBlockId, number>();
  const phiPositions = new Map<Cs486IrPhi, number>();
  const clobberPoints: {
    readonly position: number;
    readonly reason: "call-live" | "clobber-live";
    readonly registers: ReadonlySet<Cs486IrAllocatableRegister>;
  }[] = [];
  let position = 1;
  for (const block of orderedBlocks) {
    for (const phi of block.phis) phiPositions.set(phi, position++);
    for (const instruction of block.instructions) {
      positions.set(instruction, position);
      if (instruction.kind === "call" || instruction.kind === "indirect-call")
        clobberPoints.push({
          position,
          reason: "call-live",
          registers: new Set(callClobbers),
        });
      position += 1;
    }
    terminatorPositions.set(block.id, position++);
  }
  const blockMap = new Map(orderedBlocks.map((block) => [block.id, block]));
  for (const clobber of options.clobbers ?? []) {
    const block = blockMap.get(clobber.block);
    if (
      block === undefined ||
      !Number.isSafeInteger(clobber.instructionIndex) ||
      clobber.instructionIndex < 0 ||
      clobber.instructionIndex >= block.instructions.length
    )
      throw new RangeError(
        `invalid clobber point ${clobber.block}:${String(clobber.instructionIndex)}`,
      );
    clobberPoints.push({
      position: positions.get(block.instructions[clobber.instructionIndex]!)!,
      reason: "clobber-live",
      registers: new Set(clobber.registers),
    });
  }
  clobberPoints.sort(
    (left, right) =>
      left.position - right.position ||
      (left.reason < right.reason ? -1 : left.reason > right.reason ? 1 : 0),
  );

  const intervals = new Map<Cs486IrValueId, MutableInterval>();
  const define = (
    value: Cs486IrValueId,
    type: Cs486IrValueType,
    at: number,
  ): void => {
    if (intervals.has(value))
      throw new Cs486IrVerificationError([
        {
          code: "CSIR_DUPLICATE_VALUE",
          functionName: function_.name,
          message: `SSA value ${String(value)} is defined more than once`,
          value,
        },
      ]);
    if (intervals.size >= maxValues)
      throw new RangeError("register allocation value limit exceeded");
    intervals.set(value, { end: at, start: at, type, value });
  };
  for (const parameter of function_.parameters)
    define(parameter.id, parameter.type, 0);
  for (const block of orderedBlocks) {
    for (const phi of block.phis)
      define(phi.result, phi.type, phiPositions.get(phi)!);
    for (const instruction of block.instructions) {
      const result = instructionResult(instruction);
      if (result !== undefined)
        define(result.id, result.type, positions.get(instruction)!);
    }
  }
  const recordUse = (value: Cs486IrValueId, at: number): void => {
    const interval = intervals.get(value);
    if (interval === undefined)
      throw new Cs486IrVerificationError([
        {
          code: "CSIR_UNDEFINED_VALUE",
          functionName: function_.name,
          message: `SSA value ${String(value)} is not defined`,
          value,
        },
      ]);
    interval.start = Math.min(interval.start, at);
    interval.end = Math.max(interval.end, at);
  };
  for (const block of orderedBlocks) {
    for (const phi of block.phis)
      for (const incoming of phi.incoming)
        recordUse(
          incoming.value,
          terminatorPositions.get(incoming.block) ?? position,
        );
    for (const instruction of block.instructions) {
      const at = positions.get(instruction)!;
      for (const operand of instructionOperands(instruction))
        recordUse(operand, at);
    }
    if (block.terminator !== undefined)
      for (const operand of terminatorOperands(block.terminator))
        recordUse(operand, terminatorPositions.get(block.id)!);
  }

  // Linear min/max positions alone under-approximate loop liveness: a value
  // used in a loop header is live across the whole loop body via the backedge
  // even though the body's linear positions follow its last linear use. A
  // bounded backward block-liveness fixpoint extends every interval to the
  // terminator of each block it must survive.
  const blockDefs = new Map<Cs486IrBlockId, Set<Cs486IrValueId>>();
  const blockUses = new Map<Cs486IrBlockId, Set<Cs486IrValueId>>();
  for (const block of orderedBlocks) {
    const defs = new Set<Cs486IrValueId>();
    const uses = new Set<Cs486IrValueId>();
    const use = (value: Cs486IrValueId): void => {
      if (!defs.has(value)) uses.add(value);
    };
    for (const phi of block.phis) defs.add(phi.result);
    for (const instruction of block.instructions) {
      for (const operand of instructionOperands(instruction)) use(operand);
      const result = instructionResult(instruction);
      if (result !== undefined) defs.add(result.id);
    }
    if (block.terminator !== undefined)
      for (const operand of terminatorOperands(block.terminator)) use(operand);
    blockDefs.set(block.id, defs);
    blockUses.set(block.id, uses);
  }
  for (const block of orderedBlocks)
    for (const phi of block.phis)
      for (const incoming of phi.incoming) {
        const predecessorUses = blockUses.get(incoming.block);
        if (
          predecessorUses !== undefined &&
          !blockDefs.get(incoming.block)!.has(incoming.value)
        )
          predecessorUses.add(incoming.value);
      }
  const liveIn = new Map<Cs486IrBlockId, Set<Cs486IrValueId>>(
    orderedBlocks.map((block) => [block.id, new Set(blockUses.get(block.id))]),
  );
  const successors = new Map<Cs486IrBlockId, readonly Cs486IrBlockId[]>(
    orderedBlocks.map((block) => [
      block.id,
      block.terminator === undefined
        ? []
        : terminatorTargets(block.terminator).filter((target) =>
            blockMap.has(target),
          ),
    ]),
  );
  const maxLivenessRounds = orderedBlocks.length + 1;
  for (let round = 0; round < maxLivenessRounds; round += 1) {
    let livenessChanged = false;
    for (let index = orderedBlocks.length - 1; index >= 0; index -= 1) {
      const block = orderedBlocks[index]!;
      const defs = blockDefs.get(block.id)!;
      const into = liveIn.get(block.id)!;
      for (const successor of successors.get(block.id)!)
        for (const value of liveIn.get(successor)!)
          if (!defs.has(value) && !into.has(value)) {
            into.add(value);
            livenessChanged = true;
          }
    }
    if (!livenessChanged) break;
  }
  for (const block of orderedBlocks) {
    const terminatorPosition = terminatorPositions.get(block.id)!;
    for (const successor of successors.get(block.id)!)
      for (const value of liveIn.get(successor)!) {
        const interval = intervals.get(value);
        if (interval !== undefined && interval.end < terminatorPosition)
          interval.end = terminatorPosition;
      }
  }

  const ordered: Cs486IrLiveInterval[] = [...intervals.values()]
    .map((interval) => ({ ...interval }))
    .sort(
      (left, right) =>
        left.start - right.start ||
        left.end - right.end ||
        left.value - right.value,
    );
  const intervalMap = new Map<Cs486IrValueId, Cs486IrLiveInterval>(
    ordered.map((interval) => [interval.value, interval]),
  );
  const precolored: ReadonlyMap<Cs486IrValueId, Cs486IrAllocatableRegister> =
    options.precolored ?? new Map<Cs486IrValueId, Cs486IrAllocatableRegister>();
  if (precolored.size > maxValues)
    throw new RangeError("precolored SSA value limit exceeded");
  for (const [value, register] of precolored) {
    if (!intervalMap.has(value))
      throw new RangeError(
        `precolored SSA value ${String(value)} is not defined`,
      );
    if (!registerSet.has(register))
      throw new RangeError(
        `precolored register ${register} is not in the allocatable set`,
      );
  }
  const precoloredEntries = [...precolored.entries()].sort(
    ([left], [right]) => left - right,
  );
  for (
    let leftIndex = 0;
    leftIndex < precoloredEntries.length;
    leftIndex += 1
  ) {
    const [leftValue, leftRegister] = precoloredEntries[leftIndex]!;
    const leftInterval = intervalMap.get(leftValue)!;
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < precoloredEntries.length;
      rightIndex += 1
    ) {
      const [rightValue, rightRegister] = precoloredEntries[rightIndex]!;
      if (
        leftRegister === rightRegister &&
        intervalsOverlap(leftInterval, intervalMap.get(rightValue)!)
      )
        throw new RangeError(
          `overlapping precolored values ${String(leftValue)} and ${String(rightValue)} require ${leftRegister}`,
        );
    }
  }
  const locations = new Map<Cs486IrValueId, Cs486IrValueLocation>();
  const active: {
    readonly end: number;
    readonly register: Cs486IrAllocatableRegister;
    readonly value: Cs486IrValueId;
  }[] = [];
  let spillSlotCount = 0;
  for (const interval of ordered) {
    for (let index = active.length - 1; index >= 0; index -= 1)
      if (active[index]!.end < interval.start) active.splice(index, 1);
    const crossedClobbers = clobberPoints.filter(
      (point) =>
        interval.start < point.position && interval.end > point.position,
    );
    const forbidden = new Set<Cs486IrAllocatableRegister>();
    for (const point of crossedClobbers)
      for (const register of point.registers) forbidden.add(register);
    const used = new Set(active.map((entry) => entry.register));
    const reservedByOverlappingPrecolored =
      new Set<Cs486IrAllocatableRegister>();
    for (const [value, register] of precoloredEntries) {
      if (value === interval.value) continue;
      if (intervalsOverlap(interval, intervalMap.get(value)!))
        reservedByOverlappingPrecolored.add(register);
    }
    const requestedRegister = precolored.get(interval.value);
    if (requestedRegister !== undefined) {
      if (forbidden.has(requestedRegister))
        throw new RangeError(
          `precolored SSA value ${String(interval.value)} crosses a clobber of ${requestedRegister}`,
        );
      if (used.has(requestedRegister))
        throw new RangeError(
          `precolored SSA value ${String(interval.value)} conflicts on ${requestedRegister}`,
        );
      locations.set(interval.value, {
        kind: "register",
        precolored: true,
        register: requestedRegister,
      });
      active.push({
        end: interval.end,
        register: requestedRegister,
        value: interval.value,
      });
      active.sort(
        (left, right) => left.end - right.end || left.value - right.value,
      );
      continue;
    }
    const otherwiseAvailable = registers.filter(
      (candidate) =>
        !used.has(candidate) && !reservedByOverlappingPrecolored.has(candidate),
    );
    const register = otherwiseAvailable.find(
      (candidate) => !forbidden.has(candidate),
    );
    if (register === undefined) {
      const slot = spillSlotCount++;
      const clobberReason = crossedClobbers.some(
        (point) => point.reason === "call-live",
      )
        ? "call-live"
        : "clobber-live";
      locations.set(interval.value, {
        byteOffset: -(function_.locals.length + slot + 1) * 4,
        kind: "spill",
        reason:
          otherwiseAvailable.length > 0 && crossedClobbers.length > 0
            ? clobberReason
            : "pressure",
        slot,
      });
      continue;
    }
    locations.set(interval.value, { kind: "register", register });
    active.push({ end: interval.end, register, value: interval.value });
    active.sort(
      (left, right) => left.end - right.end || left.value - right.value,
    );
  }
  return {
    algorithm: "linear-scan",
    intervals: ordered,
    locations,
    registers: [...registers],
    spillSlotCount,
  };
}

function intervalsOverlap(
  left: Cs486IrLiveInterval,
  right: Cs486IrLiveInterval,
): boolean {
  return left.start <= right.end && right.start <= left.end;
}

function registerAllocationBlockOrder(
  function_: Cs486IrFunction,
): readonly Cs486IrBasicBlock[] {
  const blocks = new Map<Cs486IrBlockId, Cs486IrBasicBlock>();
  for (const block of function_.blocks) {
    if (blocks.has(block.id))
      throw new RangeError(`duplicate register allocation block ${block.id}`);
    blocks.set(block.id, block);
  }
  if (!blocks.has(function_.entry))
    throw new RangeError(
      `register allocation entry ${function_.entry} is missing`,
    );
  const visited = new Set<Cs486IrBlockId>();
  const postorder: Cs486IrBasicBlock[] = [];
  const stack: { readonly expanded: boolean; readonly id: Cs486IrBlockId }[] = [
    { expanded: false, id: function_.entry },
  ];
  while (stack.length > 0) {
    const frame = stack.pop()!;
    const block = blocks.get(frame.id);
    if (block === undefined) continue;
    if (frame.expanded) {
      postorder.push(block);
      continue;
    }
    if (visited.has(frame.id)) continue;
    visited.add(frame.id);
    stack.push({ expanded: true, id: frame.id });
    const targets =
      block.terminator === undefined ? [] : terminatorTargets(block.terminator);
    for (let index = targets.length - 1; index >= 0; index -= 1) {
      const target = targets[index]!;
      if (blocks.has(target) && !visited.has(target))
        stack.push({ expanded: false, id: target });
    }
  }
  postorder.reverse();
  for (const block of function_.blocks)
    if (!visited.has(block.id)) postorder.push(block);
  return postorder;
}

/**
 * Correct bounded scheduling fallback. It deliberately preserves source order
 * until the lowering layer supplies stable latency and alias information.
 */
export function scheduleCs486IrBlock(
  block: Cs486IrBasicBlock,
): Cs486IrBasicBlock {
  return {
    ...block,
    instructions: [...block.instructions],
    phis: [...block.phis],
  };
}

export const CS486_IR_SCHEDULER_MODE = "identity" as const;
