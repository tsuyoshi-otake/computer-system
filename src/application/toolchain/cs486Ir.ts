import type { Cs486Register } from "../../domain/cpu/instructionSet.js";
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
  readonly name: string;
  readonly parameterTypes: readonly Cs486IrValueType[];
  readonly returnType: Cs486IrReturnType;
  readonly span?: Cs486SourceSpan;
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

export type Cs486IrUnaryOperator = "bit-not" | "logical-not" | "neg";

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
}

export interface Cs486IrStoreLocalInstruction {
  readonly kind: "store-local";
  readonly local: string;
  readonly span?: Cs486SourceSpan;
  readonly value: Cs486IrValueId;
}

export interface Cs486IrCallInstruction {
  readonly arguments: readonly Cs486IrValueId[];
  readonly callee: string;
  readonly kind: "call";
  readonly result?: Cs486IrValueId;
  readonly span?: Cs486SourceSpan;
  readonly type?: Cs486IrValueType;
}

export type Cs486IrInstruction =
  | Cs486IrBinaryInstruction
  | Cs486IrCallInstruction
  | Cs486IrConstantInstruction
  | Cs486IrCopyInstruction
  | Cs486IrLoadLocalInstruction
  | Cs486IrStoreLocalInstruction
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
  readonly blocks: readonly Cs486IrBasicBlock[];
  readonly entry: Cs486IrBlockId;
  readonly locals: readonly Cs486IrLocal[];
  readonly name: string;
  readonly parameters: readonly Cs486IrParameter[];
  readonly returnType: Cs486IrReturnType;
  readonly span?: Cs486SourceSpan;
}

export interface Cs486IrProgram {
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
  maxExternals: 128,
  maxFunctions: 64,
  maxIdentifierLength: 128,
  maxInstructionsPerFunction: 4_096,
  maxLocalsPerFunction: 1_024,
  maxOptimizationPasses: 8,
  maxParametersPerFunction: 32,
  maxPhiInputs: 256,
  maxRegisterAllocationValues: 4_096,
  maxValuesPerFunction: 8_192,
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
  readonly parameterTypes: readonly Cs486IrValueType[];
  readonly returnType: Cs486IrReturnType;
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
        parameterTypes: external.parameterTypes,
        returnType: external.returnType,
      });
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
        parameterTypes: function_.parameters
          .slice(0, limits.maxParametersPerFunction)
          .map((parameter) => parameter.type),
        returnType: function_.returnType,
      });
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
      const expected = instruction.operator === "logical-not" ? "i1" : "i32";
      if (instruction.type !== expected)
        add(
          "CSIR_TYPE",
          `unary ${instruction.operator} must produce ${expected}`,
          context,
        );
      use(instruction.operand, expected, block, position, instruction.span);
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
      else if (instruction.arguments.length !== signature.parameterTypes.length)
        add(
          "CSIR_CALL_SIGNATURE",
          `function ${instruction.callee} expects ${String(signature.parameterTypes.length)} arguments, received ${String(instruction.arguments.length)}`,
          context,
        );
      for (
        let index = 0;
        index < Math.min(instruction.arguments.length, limits.maxCallArguments);
        index += 1
      )
        use(
          instruction.arguments[index]!,
          signature?.parameterTypes[index],
          block,
          position,
          instruction.span,
        );
      if (signature?.returnType === "void") {
        if (instruction.result !== undefined || instruction.type !== undefined)
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
      } else if (
        (instruction.result === undefined) !==
        (instruction.type === undefined)
      )
        add(
          "CSIR_CALL_SIGNATURE",
          `call result and type must either both be present or both be absent`,
          context,
        );
      return;
    }
  }
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
  const comparison = ["eq", "ge", "gt", "le", "lt", "ne"].includes(
    instruction.operator,
  );
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
        if (terminator.value !== undefined)
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
      else use(terminator.value, returnType, block, position, terminator.span);
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
      return undefined;
    case "call":
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
    case "call":
      return instruction.arguments;
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
      return terminator.value === undefined ? [] : [terminator.value];
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

/** Runs constant folding, copy propagation, pure DCE, and CFG cleanup. */
export function optimizeCs486IrWithReport(
  program: Cs486IrProgram,
  overrides: Partial<Cs486IrLimits> = {},
): Cs486IrOptimizationResult {
  const limits = resolveLimits(overrides);
  assertValidCs486Ir(program, limits);
  let current: Cs486IrProgram = {
    ...program,
    functions: [...program.functions],
  };
  let converged = false;
  let passes = 0;
  for (let pass = 0; pass < limits.maxOptimizationPasses; pass += 1) {
    passes = pass + 1;
    let changed = false;
    const functions = current.functions.map((function_) => {
      let result = removeUnreachableBlocks(function_);
      changed ||= result.changed;
      result = foldConstants(result.function, limits);
      changed ||= result.changed;
      result = propagateCopies(result.function);
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
    case "logical-and":
      return left !== 0 && right !== 0 ? 1 : 0;
    case "logical-or":
      return left !== 0 || right !== 0 ? 1 : 0;
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
    case "call":
      return {
        ...instruction,
        arguments: instruction.arguments.map(rewrite),
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
        : { ...terminator, value: rewrite(terminator.value) };
  }
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
  if (instruction.kind === "call" || instruction.kind === "store-local")
    return false;
  return !(
    instruction.kind === "binary" &&
    (instruction.operator === "div" || instruction.operator === "mod")
  );
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
      if (instruction.kind === "call")
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
