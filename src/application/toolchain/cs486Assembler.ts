import {
  createCs486FunctionSignature,
  createCs486Flat32MemoryMetadata,
  cs486RegisterNames,
  parseCs486FunctionSignature,
  validateCs486Executable,
  type Cs486ExecutableV5,
  type Cs486FunctionEntry,
  type Cs486FunctionSignature,
  type Cs486Instruction,
  type Cs486Operand,
  type Cs486Register,
} from "../../domain/cpu/cs486.js";
import {
  cs486Word32DataModel,
  type Cs486DataModel,
} from "../../domain/cpu/cs486Compatibility.js";
import {
  cs486FormatLimits,
  currentCs486ExecutableFormatVersion,
  currentCs486ObjectFormatVersion,
} from "../../domain/cpu/cs486FormatLimits.js";
import {
  cs486RelocationAcceptsSection,
  isCs486StructuredObject,
  objectSection,
  validateCs486Object,
  type Cs486Object,
  type Cs486ObjectLanguage,
  type Cs486ObjectRelocation,
  type Cs486ObjectSection,
  type Cs486ObjectSectionName,
  type Cs486ObjectSymbol,
  type Cs486ObjectSymbolType,
  type Cs486RelocationField,
} from "../../domain/cpu/cs486Object.js";
import { encodeUtf8 } from "../../domain/text/utf8.js";
import {
  Cs486CompileError,
  compileErrorAt,
  type Cs486SourceSpan,
} from "./cs486AsmDiagnostics.js";
import {
  evaluateCs486AsmExpression,
  type Cs486AsmExpressionValue,
} from "./cs486AsmExpression.js";
import {
  parseCs486AssemblyTokens,
  type Cs486AsmOperationStatement,
  type Cs486AsmStatement,
} from "./cs486AsmParser.js";
import {
  preprocessCs486Assembly,
  type Cs486AsmIncludeSource,
  type Cs486AssemblerDialect,
} from "./cs486AsmPreprocessor.js";
import type { Cs486AsmToken } from "./cs486AsmTokenizer.js";

export { Cs486CompileError } from "./cs486AsmDiagnostics.js";
export type { Cs486AssemblerDialect } from "./cs486AsmPreprocessor.js";

export interface Cs486AssemblerOptions {
  readonly dataBytes?: number;
  readonly dataModel?: Cs486DataModel;
  readonly dialect?: Cs486AssemblerDialect;
  readonly include?: (
    request: string,
    fromSource: string,
  ) => Cs486AsmIncludeSource | undefined;
  readonly language?: Cs486ObjectLanguage;
  readonly sourceName?: string;
}

interface SectionCursor {
  alignment: 1 | 2 | 4 | 8 | 16;
  offset: number;
}

interface SymbolDefinition {
  readonly offset: number;
  readonly section: Cs486ObjectSectionName;
  readonly span: Cs486SourceSpan;
}

interface AssemblyAnalysis {
  readonly constants: ReadonlyMap<string, number>;
  readonly definitions: ReadonlyMap<string, SymbolDefinition>;
  readonly externals: ReadonlySet<string>;
  readonly globals: ReadonlySet<string>;
  readonly sections: Readonly<Record<Cs486ObjectSectionName, SectionCursor>>;
  readonly signatures: ReadonlyMap<string, Cs486FunctionSignature>;
  readonly types: ReadonlyMap<string, Cs486ObjectSymbolType>;
}

interface AssemblyBuild {
  readonly bssSize: number;
  readonly data: readonly number[];
  readonly instructions: readonly Cs486Instruction[];
  readonly relocations: readonly Cs486ObjectRelocation[];
  readonly rodata: readonly number[];
}

const objectLimits = cs486FormatLimits({
  format: "object",
  version: currentCs486ObjectFormatVersion,
});
const maximumDataBytes = objectLimits.dataBytes;
const maximumInitializedDataBytes = objectLimits.initializedDataBytes;
const maximumInstructions = objectLimits.instructions;

export function assembleCs486(
  source: string,
  options: Omit<Cs486AssemblerOptions, "dataBytes" | "language"> = {},
): Cs486ExecutableV5 {
  const object = assembleCs486Object(source, { ...options, language: "asm" });
  return materializeStandaloneObject(object);
}

export function assembleCs486Object(
  source: string,
  options: Cs486AssemblerOptions = {},
): Cs486Object {
  const dialect = options.dialect ?? "linux";
  const statements = parseCs486AssemblyTokens(
    preprocessCs486Assembly(source, {
      dialect,
      include: options.include,
      sourceName: options.sourceName,
    }),
  );
  const analysis = analyze(statements, dialect);
  const build = buildSections(statements, analysis, dialect);
  const sections = createSections(build, analysis, options.dataBytes ?? 0);
  const symbols = createSymbols(analysis);
  const transcript = renderStatements(statements);
  const assemblyTruncated = transcript.length > objectLimits.assemblyCharacters;
  const object: Cs486Object = {
    assembly: assemblyTruncated
      ? transcript.slice(0, objectLimits.assemblyCharacters)
      : transcript,
    ...(assemblyTruncated ? { assemblyTruncated: true } : {}),
    dataBytes: sectionDataBytes(sections),
    dataModel: options.dataModel ?? cs486Word32DataModel,
    format: "cs486-object",
    language: options.language ?? "asm",
    relocations: build.relocations,
    sections,
    symbols,
    version: currentCs486ObjectFormatVersion,
  };
  validateCs486Object(object);
  return object;
}

function analyze(
  statements: readonly Cs486AsmStatement[],
  dialect: Cs486AssemblerDialect,
): AssemblyAnalysis {
  const constants = new Map<string, number>();
  const definitions = new Map<string, SymbolDefinition>();
  const externals = new Set<string>();
  const globals = new Set<string>();
  const signatures = new Map<string, Cs486FunctionSignature>();
  const types = new Map<string, Cs486ObjectSymbolType>();
  const sections: Record<Cs486ObjectSectionName, SectionCursor> = {
    bss: { alignment: 1, offset: 0 },
    data: { alignment: 1, offset: 0 },
    rodata: { alignment: 1, offset: 0 },
    text: { alignment: 1, offset: 0 },
  };
  let current: Cs486ObjectSectionName = "text";

  for (const statement of statements) {
    if (statement.kind === "label") {
      requireSymbolName(statement.name, statement.span);
      if (
        definitions.has(statement.name) ||
        constants.has(statement.name) ||
        externals.has(statement.name)
      )
        throw duplicateSymbol(
          statement.name,
          statement.span,
          definitions.get(statement.name)?.span,
        );
      definitions.set(statement.name, {
        offset: sections[current].offset,
        section: current,
        span: statement.span,
      });
      continue;
    }
    const equ = equDefinition(statement);
    if (equ !== undefined) {
      requireSymbolName(equ.name.value, equ.name.span);
      if (
        definitions.has(equ.name.value) ||
        constants.has(equ.name.value) ||
        externals.has(equ.name.value)
      )
        throw duplicateSymbol(
          equ.name.value,
          equ.name.span,
          definitions.get(equ.name.value)?.span,
        );
      const value = evaluateCs486AsmExpression(equ.expression, constants);
      if (value.kind !== "absolute")
        throw compileErrorAt(
          "EQU requires an absolute expression",
          equ.name.span,
        );
      constants.set(equ.name.value, value.value);
      continue;
    }
    const section = sectionDirective(statement, dialect);
    if (section !== undefined) {
      current = section;
      continue;
    }
    const directive = directiveName(statement.name, dialect);
    if (directive === "global") {
      for (const name of identifierOperands(statement)) globals.add(name.value);
      continue;
    }
    if (directive === "extern") {
      for (const name of identifierOperands(statement)) {
        if (definitions.has(name.value) || constants.has(name.value))
          throw duplicateSymbol(
            name.value,
            name.span,
            definitions.get(name.value)?.span,
          );
        externals.add(name.value);
      }
      continue;
    }
    if (directive === "type") {
      const [nameTokens, typeTokens] = statement.operands;
      const name = singleIdentifier(nameTokens, statement.span);
      const type = singleIdentifier(
        typeTokens,
        statement.span,
      ).value.toLowerCase();
      if (type !== "function" && type !== "object" && type !== "notype")
        throw compileErrorAt(
          "symbol type must be function, object, or notype",
          typeTokens![0]!.span,
        );
      types.set(name.value, type);
      continue;
    }
    if (directive === "signature") {
      // Admit exactly one capacity-plus-one operand so the authored fixed
      // parameter overflow receives its precise diagnostic below.
      if (statement.operands.length < 2 || statement.operands.length > 36)
        throw compileErrorAt(
          "function signature requires a name, return type, at most 32 parameter types, and optional trailing varargs",
          statement.span,
        );
      const [nameTokens, returnTypeTokens, ...allParameterTypeOperands] =
        statement.operands;
      const name = singleIdentifier(nameTokens, statement.span);
      const returnType = singleIdentifier(
        returnTypeTokens,
        statement.span,
      ).value.toLowerCase();
      if (
        returnType !== "f32" &&
        returnType !== "f64" &&
        returnType !== "i32" &&
        returnType !== "i64" &&
        returnType !== "void"
      )
        throw compileErrorAt(
          "function signature return type must be f32, f64, i32, i64, or void",
          returnTypeTokens![0]!.span,
        );
      const finalParameter = allParameterTypeOperands.at(-1);
      const variadic =
        finalParameter !== undefined &&
        singleIdentifier(finalParameter, statement.span).value.toLowerCase() ===
          "varargs";
      const parameterTypeOperands = variadic
        ? allParameterTypeOperands.slice(0, -1)
        : allParameterTypeOperands;
      if (parameterTypeOperands.length > 32)
        throw compileErrorAt(
          "function signature has more than 32 fixed parameters",
          statement.span,
        );
      const parameterTypes = parameterTypeOperands.map((operand) => {
        const parameterType = singleIdentifier(operand, statement.span);
        const value = parameterType.value.toLowerCase();
        if (
          value !== "f32" &&
          value !== "f64" &&
          value !== "i32" &&
          value !== "i64"
        )
          throw compileErrorAt(
            "function signature parameter types must be f32, f64, i32, or i64",
            parameterType.span,
          );
        return value;
      });
      if (
        parameterTypes.reduce(
          (words, type) => words + (type === "i64" || type === "f64" ? 2 : 1),
          0,
        ) > 32
      )
        throw compileErrorAt(
          "function signature has more than 32 fixed argument words",
          statement.span,
        );
      const signature: Cs486FunctionSignature = createCs486FunctionSignature(
        parameterTypes,
        returnType,
        variadic,
      );
      const existing = signatures.get(name.value);
      if (existing !== undefined && existing !== signature)
        throw compileErrorAt(
          `conflicting function signature for ${name.value}`,
          name.span,
        );
      signatures.set(name.value, signature);
      continue;
    }
    if (directive === "align") {
      const alignment = parseAlignment(statement, constants);
      if (current === "text" && alignment !== 1)
        throw compileErrorAt(
          "text alignment other than 1 is unsupported",
          statement.span,
        );
      sections[current].alignment = maximumAlignment(
        sections[current].alignment,
        alignment,
      );
      sections[current].offset = align(sections[current].offset, alignment);
      continue;
    }
    const dataDirective = normalizeDataDirective(directive);
    if (dataDirective !== undefined) {
      requireDataSection(current, statement.span);
      sections[current].offset += initializedDirectiveSize(
        dataDirective,
        statement,
        constants,
      );
      requireDataLimit(sections);
      continue;
    }
    const reserveWidth = reserveDirectiveWidth(directive);
    if (reserveWidth !== undefined) {
      if (current !== "bss")
        throw compileErrorAt(
          `${statement.name} is only valid in bss`,
          statement.span,
        );
      const count = absoluteOperand(statement, constants);
      sections.bss.offset += checkedSize(count, reserveWidth, statement.span);
      requireDataLimit(sections);
      continue;
    }
    if (current !== "text")
      throw compileErrorAt(
        "instructions are only valid in the text section",
        statement.span,
      );
    if (misleadingDosOperation(directive))
      throw compileErrorAt(
        `${statement.name} would imply unsupported native DOS/x86 behavior`,
        statement.span,
      );
    sections.text.offset += 1;
    if (sections.text.offset > maximumInstructions)
      throw compileErrorAt("instruction limit exceeded", statement.span);
  }

  for (const name of globals) {
    if (!definitions.has(name))
      throw new Cs486CompileError(`global symbol ${name} is not defined`);
  }
  for (const name of externals) {
    if (globals.has(name))
      throw new Cs486CompileError(`conflicting symbol ${name}`);
  }
  for (const [name, type] of types) {
    const definition = definitions.get(name);
    if (definition === undefined && !externals.has(name))
      throw new Cs486CompileError(
        `typed symbol ${name} is not defined or extern`,
      );
    if (
      definition !== undefined &&
      ((type === "function" && definition.section !== "text") ||
        (type === "object" && definition.section === "text"))
    )
      throw compileErrorAt(
        `${name} type ${type} is incompatible with section ${definition.section}`,
        definition.span,
      );
  }
  for (const name of signatures.keys()) {
    if (!definitions.has(name) && !externals.has(name))
      throw new Cs486CompileError(
        `function signature ${name} is not defined or extern`,
      );
    if (types.get(name) !== "function")
      throw new Cs486CompileError(
        `function signature ${name} requires type function`,
      );
  }
  return {
    constants,
    definitions,
    externals,
    globals,
    sections,
    signatures,
    types,
  };
}

function buildSections(
  statements: readonly Cs486AsmStatement[],
  analysis: AssemblyAnalysis,
  dialect: Cs486AssemblerDialect,
): AssemblyBuild {
  const data: number[] = [];
  const rodata: number[] = [];
  const instructions: Cs486Instruction[] = [];
  const relocations: Cs486ObjectRelocation[] = [];
  let bssSize = 0;
  let current: Cs486ObjectSectionName = "text";

  for (const statement of statements) {
    if (statement.kind === "label" || equDefinition(statement) !== undefined)
      continue;
    const section = sectionDirective(statement, dialect);
    if (section !== undefined) {
      current = section;
      continue;
    }
    const directive = directiveName(statement.name, dialect);
    if (
      directive === "global" ||
      directive === "extern" ||
      directive === "signature" ||
      directive === "type"
    )
      continue;
    if (directive === "align") {
      const alignment = parseAlignment(statement, analysis.constants);
      if (current === "data" || current === "rodata") {
        const target = current === "data" ? data : rodata;
        while (target.length % alignment !== 0) target.push(0);
      } else if (current === "bss") bssSize = align(bssSize, alignment);
      continue;
    }
    const dataDirective = normalizeDataDirective(directive);
    if (dataDirective !== undefined) {
      const target = current === "data" ? data : rodata;
      emitInitializedData(
        dataDirective,
        statement,
        analysis,
        current as "data" | "rodata",
        target,
        relocations,
      );
      continue;
    }
    const reserveWidth = reserveDirectiveWidth(directive);
    if (reserveWidth !== undefined) {
      bssSize += checkedSize(
        absoluteOperand(statement, analysis.constants),
        reserveWidth,
        statement.span,
      );
      continue;
    }
    const instructionOffset = instructions.length;
    instructions.push(
      parseInstruction(statement, analysis, instructionOffset, relocations),
    );
  }
  if (data.length + rodata.length > maximumInitializedDataBytes)
    throw new Cs486CompileError("initialized data limit exceeded");
  return { bssSize, data, instructions, relocations, rodata };
}

function createSections(
  build: AssemblyBuild,
  analysis: AssemblyAnalysis,
  requestedDataBytes: number,
): readonly Cs486ObjectSection[] {
  if (
    !Number.isSafeInteger(requestedDataBytes) ||
    requestedDataBytes < 0 ||
    requestedDataBytes > maximumDataBytes
  )
    throw new Cs486CompileError("invalid requested data size");
  requestedDataBytes = Math.max(
    requestedDataBytes,
    inferredNumericDataBytes(build.instructions),
  );
  if (requestedDataBytes > maximumDataBytes)
    throw new Cs486CompileError(
      "requested data size exceeds the supported limit",
    );
  const sections: Cs486ObjectSection[] = [
    { alignment: 1, instructions: build.instructions, name: "text" },
    {
      alignment: analysis.sections.rodata.alignment,
      bytes: build.rodata,
      name: "rodata",
    },
    {
      alignment: analysis.sections.data.alignment,
      bytes: build.data,
      name: "data",
    },
    {
      alignment: analysis.sections.bss.alignment,
      name: "bss",
      size: build.bssSize,
    },
  ];
  const current = sectionDataBytes(sections);
  if (current < requestedDataBytes) {
    const bss = sections[3] as Extract<Cs486ObjectSection, { name: "bss" }>;
    sections[3] = { ...bss, size: bss.size + requestedDataBytes - current };
  }
  return sections;
}

function inferredNumericDataBytes(
  instructions: readonly Cs486Instruction[],
): number {
  let bytes = 0;
  for (const instruction of instructions) {
    if (
      "address" in instruction &&
      instruction.address.kind === "immediate" &&
      instruction.address.value >= 0
    )
      bytes = Math.max(
        bytes,
        instruction.address.value + instructionMemoryWidth(instruction.op),
      );
  }
  return bytes;
}

function instructionMemoryWidth(op: Cs486Instruction["op"]): number {
  switch (op) {
    case "load8s":
    case "load8u":
    case "store8":
      return 1;
    case "load16s":
    case "load16u":
    case "store16":
      return 2;
    default:
      return 4;
  }
}

function createSymbols(
  analysis: AssemblyAnalysis,
): readonly Cs486ObjectSymbol[] {
  return [
    ...[...analysis.definitions].map(
      ([name, definition]): Cs486ObjectSymbol => ({
        binding: analysis.globals.has(name) ? "global" : "local",
        ...(analysis.signatures.has(name)
          ? { functionSignature: analysis.signatures.get(name)! }
          : {}),
        name,
        offset: definition.offset,
        section: definition.section,
        type:
          analysis.types.get(name) ??
          (definition.section === "text" ? "notype" : "object"),
      }),
    ),
    ...[...analysis.externals].map((name): Cs486ObjectSymbol => ({
      binding: "undefined",
      ...(analysis.signatures.has(name)
        ? { functionSignature: analysis.signatures.get(name)! }
        : {}),
      name,
      section: analysis.types.get(name) === "object" ? "data" : "text",
      type: analysis.types.get(name) ?? "notype",
    })),
  ];
}

function parseInstruction(
  statement: Cs486AsmOperationStatement,
  analysis: AssemblyAnalysis,
  instructionOffset: number,
  relocations: Cs486ObjectRelocation[],
): Cs486Instruction {
  const op = statement.name.toLowerCase();
  const arity = (count: number): void => {
    if (statement.operands.length !== count)
      throw compileErrorAt(
        `${op} expects ${String(count)} operand(s)`,
        statement.span,
      );
  };
  if (op === "halt" || op === "ret") {
    arity(0);
    return { op };
  }
  if (op === "syscall") {
    arity(1);
    const name = singleIdentifier(statement.operands[0], statement.span).value;
    if (!/^[a-z][a-z0-9_.]{0,63}$/u.test(name))
      throw compileErrorAt(
        `invalid syscall ${name}`,
        statement.operands[0]![0]!.span,
      );
    return { op, name };
  }
  if (["jmp", "je", "jne", "jl", "jle", "jg", "jge", "call"].includes(op)) {
    arity(1);
    const target = expression(statement.operands[0], analysis.constants);
    if (target.kind !== "symbol")
      throw compileErrorAt(
        "control-flow target must be a label",
        statement.operands[0]![0]!.span,
      );
    requireReference(
      target.symbol,
      analysis,
      statement.operands[0]![0]!.span,
      "text",
    );
    relocations.push({
      addend: target.addend,
      field: "target",
      offset: instructionOffset,
      section: "text",
      symbol: target.symbol,
      type: "text-target",
    });
    return { op: op as "jmp", target: 0 };
  }
  if (op === "calli") {
    arity(2);
    const signatureToken = statement.operands[1];
    if (
      signatureToken?.length !== 1 ||
      signatureToken[0]!.kind !== "string" ||
      parseCs486FunctionSignature(signatureToken[0]!.value) === undefined
    )
      throw compileErrorAt(
        "calli requires a canonical quoted function signature",
        signatureToken?.[0]?.span ?? statement.span,
      );
    return {
      op: "call_indirect",
      source: parseOperand(
        statement.operands[0]!,
        analysis,
        instructionOffset,
        "source",
        relocations,
      ),
      functionSignature: signatureToken[0]!.value,
    };
  }
  if (op === "push") {
    arity(1);
    return {
      op,
      source: parseOperand(
        statement.operands[0]!,
        analysis,
        instructionOffset,
        "source",
        relocations,
      ),
    };
  }
  if (op === "pop") {
    arity(1);
    return {
      op,
      destination: register(statement.operands[0]!, statement.span),
    };
  }
  if (op === "print") {
    arity(1);
    const tokens = statement.operands[0]!;
    return {
      op,
      source:
        tokens.length === 1 && tokens[0]!.kind === "string"
          ? tokens[0]!.value
          : parseOperand(
              tokens,
              analysis,
              instructionOffset,
              "source",
              relocations,
            ),
    };
  }
  if (
    op === "load" ||
    op === "load8s" ||
    op === "load8u" ||
    op === "load16s" ||
    op === "load16u"
  ) {
    arity(2);
    return {
      op,
      destination: register(statement.operands[0]!, statement.span),
      address: parseMemoryOperand(
        statement.operands[1]!,
        analysis,
        instructionOffset,
        relocations,
      ),
    };
  }
  if (op === "store" || op === "store8" || op === "store16") {
    arity(2);
    return {
      op,
      address: parseMemoryOperand(
        statement.operands[0]!,
        analysis,
        instructionOffset,
        relocations,
      ),
      source: register(statement.operands[1]!, statement.span),
    };
  }
  if (op === "cmp") {
    arity(2);
    return {
      op,
      left: register(statement.operands[0]!, statement.span),
      right: parseOperand(
        statement.operands[1]!,
        analysis,
        instructionOffset,
        "right",
        relocations,
      ),
    };
  }
  if (
    [
      "mov",
      "add",
      "sub",
      "mul",
      "div",
      "udiv",
      "mod",
      "umod",
      "and",
      "or",
      "xor",
      "shl",
      "shr",
      "ushr",
    ].includes(op)
  ) {
    arity(2);
    return {
      op: op as "mov",
      destination: register(statement.operands[0]!, statement.span),
      source: parseOperand(
        statement.operands[1]!,
        analysis,
        instructionOffset,
        "source",
        relocations,
      ),
    };
  }
  throw compileErrorAt(`unknown instruction ${op}`, statement.span);
}

function parseOperand(
  tokens: readonly Cs486AsmToken[],
  analysis: AssemblyAnalysis,
  instructionOffset: number,
  field: "right" | "source",
  relocations: Cs486ObjectRelocation[],
): Cs486Operand {
  const registerName = registerNameFrom(tokens);
  if (registerName !== undefined)
    return { kind: "register", register: registerName };
  const value = expression(tokens, analysis.constants);
  if (value.kind === "absolute")
    return { kind: "immediate", value: value.value };
  requireReference(value.symbol, analysis, tokens[0]!.span);
  relocations.push({
    addend: value.addend,
    field,
    offset: instructionOffset,
    section: "text",
    symbol: value.symbol,
    type: addressRelocationType(value.symbol, analysis),
  });
  return { kind: "immediate", value: 0 };
}

function parseMemoryOperand(
  tokens: readonly Cs486AsmToken[],
  analysis: AssemblyAnalysis,
  instructionOffset: number,
  relocations: Cs486ObjectRelocation[],
): Cs486Operand {
  if (tokens[0]?.value !== "[" || tokens.at(-1)?.value !== "]")
    throw compileErrorAt(
      "memory operand must use [address]",
      tokens[0]?.span ?? emptySpan(),
    );
  const inner = tokens.slice(1, -1);
  const registerName = registerNameFrom(inner);
  if (registerName !== undefined)
    return { kind: "register", register: registerName };
  const value = expression(inner, analysis.constants);
  if (value.kind === "absolute")
    return { kind: "immediate", value: value.value };
  requireReference(value.symbol, analysis, inner[0]!.span, "data-address");
  relocations.push({
    addend: value.addend,
    field: "address",
    offset: instructionOffset,
    section: "text",
    symbol: value.symbol,
    type: "data-address",
  });
  return { kind: "immediate", value: 0 };
}

function emitInitializedData(
  directive: "ascii" | "asciz" | "db" | "dd" | "dw",
  statement: Cs486AsmOperationStatement,
  analysis: AssemblyAnalysis,
  section: "data" | "rodata",
  target: number[],
  relocations: Cs486ObjectRelocation[],
): void {
  if (statement.operands.length === 0)
    throw compileErrorAt(
      `${statement.name} expects at least one operand`,
      statement.span,
    );
  for (const operand of statement.operands) {
    if (operand.length === 1 && operand[0]!.kind === "string") {
      if (directive !== "db" && directive !== "ascii" && directive !== "asciz")
        throw compileErrorAt(
          "string data requires DB, ASCII, or ASCIZ",
          operand[0]!.span,
        );
      target.push(...encodeUtf8(operand[0]!.value));
      if (directive === "asciz") target.push(0);
      continue;
    }
    if (directive === "ascii" || directive === "asciz")
      throw compileErrorAt(
        `${statement.name} requires quoted strings`,
        operand[0]!.span,
      );
    const value = expression(operand, analysis.constants);
    const width = directive === "db" ? 1 : directive === "dw" ? 2 : 4;
    if (value.kind === "symbol") {
      if (width !== 4)
        throw compileErrorAt(
          "relocatable data values require DD",
          operand[0]!.span,
        );
      requireReference(value.symbol, analysis, operand[0]!.span);
      relocations.push({
        addend: value.addend,
        field: "data",
        offset: target.length,
        section,
        symbol: value.symbol,
        type: addressRelocationType(value.symbol, analysis),
      });
      target.push(0, 0, 0, 0);
    } else appendInteger(target, value.value, width, operand[0]!.span);
  }
}

function materializeStandaloneObject(object: Cs486Object): Cs486ExecutableV5 {
  if (!isCs486StructuredObject(object))
    throw new Cs486CompileError("internal assembler produced a legacy object");
  const undefinedSymbol = object.symbols.find(
    (symbol) => symbol.binding === "undefined",
  );
  if (undefinedSymbol !== undefined)
    throw new Cs486CompileError(`unresolved symbol ${undefinedSymbol.name}`);
  const text = objectSection(object, "text");
  const instructions = text.instructions.map(cloneInstruction);
  const layout = objectDataLayout(object);
  const initialData = [...layout.initialData];
  const symbols = new Map(
    object.symbols.map((symbol) => [symbol.name, symbol]),
  );
  for (const relocation of object.relocations) {
    const symbol = symbols.get(relocation.symbol);
    if (symbol?.offset === undefined)
      throw new Cs486CompileError(`unresolved symbol ${relocation.symbol}`);
    if (!cs486RelocationAcceptsSection(relocation.type, symbol.section))
      throw new Cs486CompileError(
        `relocation ${relocation.type} cannot reference ${symbol.section} symbol ${symbol.name}`,
      );
    const value =
      symbol.section === "text"
        ? symbol.offset + (relocation.addend ?? 0)
        : layout.bases[symbol.section] +
          symbol.offset +
          (relocation.addend ?? 0);
    applyRelocation(instructions, initialData, layout.bases, relocation, value);
  }
  const functionEntries = collectStandaloneFunctionEntries(object.symbols);
  const executable: Cs486ExecutableV5 = {
    dataBytes: object.dataBytes,
    dataModel: object.dataModel ?? cs486Word32DataModel,
    format: "cs486-executable",
    ...(functionEntries.length === 0 ? {} : { functionEntries }),
    initialData:
      initialData.length === 0 ? [] : [{ bytes: initialData, offset: 0 }],
    instructions,
    memory: createCs486Flat32MemoryMetadata(),
    symbols: object.symbols
      .filter(
        (symbol) => symbol.binding === "global" && symbol.offset !== undefined,
      )
      .map((symbol) => ({
        address:
          symbol.section === "text"
            ? symbol.offset!
            : layout.bases[symbol.section] + symbol.offset!,
        ...(symbol.functionSignature === undefined
          ? {}
          : { functionSignature: symbol.functionSignature }),
        name: symbol.name,
        section: symbol.section,
        type: symbol.type,
      })),
    version: currentCs486ExecutableFormatVersion,
  };
  validateCs486Executable(executable);
  return executable;
}

function collectStandaloneFunctionEntries(
  symbols: readonly Cs486ObjectSymbol[],
): readonly Cs486FunctionEntry[] {
  const entries = new Map<number, Cs486FunctionSignature>();
  for (const symbol of symbols) {
    if (
      symbol.binding === "undefined" ||
      symbol.offset === undefined ||
      symbol.section !== "text" ||
      symbol.type !== "function" ||
      symbol.functionSignature === undefined
    )
      continue;
    const existing = entries.get(symbol.offset);
    if (existing !== undefined && existing !== symbol.functionSignature)
      throw new Cs486CompileError(
        `function entry signature mismatch at ${String(symbol.offset)}`,
      );
    entries.set(symbol.offset, symbol.functionSignature);
  }
  return [...entries]
    .map(([address, functionSignature]) => ({ address, functionSignature }))
    .sort((left, right) => left.address - right.address);
}

function applyRelocation(
  instructions: Cs486Instruction[],
  initialData: number[],
  bases: Readonly<Record<"bss" | "data" | "rodata", number>>,
  relocation: Cs486ObjectRelocation,
  value: number,
): void {
  if (relocation.section === "text") {
    const offset = relocation.offset!;
    const instruction = instructions[offset];
    if (instruction === undefined)
      throw new Cs486CompileError("relocation instruction is outside text");
    instructions[offset] = patchInstruction(
      instruction,
      relocation.field!,
      value,
    );
    return;
  }
  const base = bases[relocation.section!];
  writeInt32(initialData, base + relocation.offset!, value);
}

function patchInstruction(
  instruction: Cs486Instruction,
  field: Cs486RelocationField,
  value: number,
): Cs486Instruction {
  if (field === "target" && "target" in instruction)
    return { ...instruction, target: value };
  if (field === "address" && "address" in instruction)
    return { ...instruction, address: { kind: "immediate", value } };
  if (
    field === "source" &&
    "source" in instruction &&
    typeof instruction.source !== "string"
  )
    return {
      ...instruction,
      source: { kind: "immediate", value },
    };
  if (field === "right" && instruction.op === "cmp")
    return { ...instruction, right: { kind: "immediate", value } };
  throw new Cs486CompileError(`invalid relocation field ${field}`);
}

export function objectDataLayout(
  object: Cs486Object & {
    readonly version: 2 | 3 | 4;
    readonly sections: readonly Cs486ObjectSection[];
  },
): {
  readonly bases: Readonly<Record<"bss" | "data" | "rodata", number>>;
  readonly initialData: readonly number[];
} {
  const rodata = objectSection(object, "rodata");
  const data = objectSection(object, "data");
  const bss = objectSection(object, "bss");
  const bases = {
    rodata: 0,
    data: align(rodata.bytes.length, data.alignment),
    bss: 0,
  };
  bases.bss = align(bases.data + data.bytes.length, bss.alignment);
  const initialData = Array<number>(bases.bss).fill(0);
  initialData.splice(0, rodata.bytes.length, ...rodata.bytes);
  initialData.splice(bases.data, data.bytes.length, ...data.bytes);
  return { bases, initialData };
}

function sectionDataBytes(sections: readonly Cs486ObjectSection[]): number {
  let bytes = 0;
  for (const name of ["rodata", "data", "bss"] as const) {
    const section = sections.find((candidate) => candidate.name === name)! as
      | Extract<Cs486ObjectSection, { name: "bss" }>
      | Extract<Cs486ObjectSection, { name: "data" | "rodata" }>;
    bytes = align(bytes, section.alignment);
    bytes += section.name === "bss" ? section.size : section.bytes.length;
  }
  return bytes;
}

function initializedDirectiveSize(
  directive: "ascii" | "asciz" | "db" | "dd" | "dw",
  statement: Cs486AsmOperationStatement,
  constants: ReadonlyMap<string, number>,
): number {
  if (statement.operands.length === 0)
    throw compileErrorAt(
      `${statement.name} expects at least one operand`,
      statement.span,
    );
  let size = 0;
  for (const operand of statement.operands) {
    if (operand.length === 1 && operand[0]!.kind === "string") {
      if (directive !== "db" && directive !== "ascii" && directive !== "asciz")
        throw compileErrorAt(
          "string data requires DB, ASCII, or ASCIZ",
          operand[0]!.span,
        );
      size +=
        encodeUtf8(operand[0]!.value).length + (directive === "asciz" ? 1 : 0);
    } else {
      if (directive === "ascii" || directive === "asciz")
        throw compileErrorAt(
          `${statement.name} requires quoted strings`,
          operand[0]!.span,
        );
      expression(operand, constants);
      size += directive === "db" ? 1 : directive === "dw" ? 2 : 4;
    }
  }
  return size;
}

function equDefinition(statement: Cs486AsmStatement):
  | {
      readonly expression: readonly Cs486AsmToken[];
      readonly name: Cs486AsmToken;
    }
  | undefined {
  if (statement.kind !== "operation") return undefined;
  const directive = statement.name.toLowerCase();
  if (directive === "equ" || directive === ".equ") {
    if (statement.operands.length !== 2)
      throw compileErrorAt("EQU expects a name and expression", statement.span);
    return {
      expression: statement.operands[1]!,
      name: singleIdentifier(statement.operands[0], statement.span),
    };
  }
  if (statement.operands.length !== 1) return undefined;
  const tokens = statement.operands[0]!;
  if (
    tokens[0]?.kind !== "identifier" ||
    tokens[0].value.toLowerCase() !== "equ"
  )
    return undefined;
  if (tokens.length < 2)
    throw compileErrorAt("EQU expects an expression", tokens[0].span);
  return {
    expression: tokens.slice(1),
    name: {
      kind: "identifier",
      raw: statement.name,
      span: statement.span,
      value: statement.name,
    },
  };
}

function sectionDirective(
  statement: Cs486AsmOperationStatement,
  dialect: Cs486AssemblerDialect,
): Cs486ObjectSectionName | undefined {
  const name = statement.name.toLowerCase();
  const aliases: Readonly<Record<string, Cs486ObjectSectionName>> = {
    ".bss": "bss",
    ".code": "text",
    ".const": "rodata",
    ".data": "data",
    ".rodata": "rodata",
    ".text": "text",
  };
  const direct = aliases[name];
  if (direct !== undefined) {
    if (statement.operands.length !== 0)
      throw compileErrorAt(
        `${statement.name} takes no operands`,
        statement.span,
      );
    if (dialect !== "dos" && (name === ".code" || name === ".const"))
      throw compileErrorAt(
        `${statement.name} is a DOS assembly alias`,
        statement.span,
      );
    return direct;
  }
  if (name !== "section" && name !== ".section") return undefined;
  if (statement.operands.length !== 1)
    throw compileErrorAt("SECTION expects one section name", statement.span);
  const token = singleIdentifier(statement.operands[0], statement.span);
  const normalized = token.value.toLowerCase().replace(/^\./u, "");
  if (
    normalized !== "text" &&
    normalized !== "rodata" &&
    normalized !== "data" &&
    normalized !== "bss"
  )
    throw compileErrorAt(`unsupported section ${token.value}`, token.span);
  return normalized;
}

function directiveName(name: string, dialect: Cs486AssemblerDialect): string {
  const normalized = name.toLowerCase().replace(/^\./u, "");
  if (dialect === "dos") {
    if (normalized === "public") return "global";
    if (normalized === "extrn" || normalized === "external") return "extern";
  }
  return normalized;
}

function normalizeDataDirective(
  name: string,
): "ascii" | "asciz" | "db" | "dd" | "dw" | undefined {
  if (name === "byte") return "db";
  if (name === "word") return "dw";
  if (name === "long") return "dd";
  return name === "ascii" ||
    name === "asciz" ||
    name === "db" ||
    name === "dw" ||
    name === "dd"
    ? name
    : undefined;
}

function reserveDirectiveWidth(name: string): 1 | 2 | 4 | undefined {
  if (name === "resb" || name === "zero" || name === "space") return 1;
  if (name === "resw") return 2;
  if (name === "resd") return 4;
  return undefined;
}

function expression(
  tokens: readonly Cs486AsmToken[] | undefined,
  constants: ReadonlyMap<string, number>,
): Cs486AsmExpressionValue {
  if (tokens === undefined || tokens.length === 0)
    throw new Cs486CompileError("expected expression");
  return evaluateCs486AsmExpression(tokens, constants);
}

function absoluteOperand(
  statement: Cs486AsmOperationStatement,
  constants: ReadonlyMap<string, number>,
): number {
  if (statement.operands.length !== 1)
    throw compileErrorAt(
      `${statement.name} expects one operand`,
      statement.span,
    );
  const value = expression(statement.operands[0], constants);
  if (value.kind !== "absolute")
    throw compileErrorAt(
      `${statement.name} requires an absolute expression`,
      statement.span,
    );
  return value.value;
}

function parseAlignment(
  statement: Cs486AsmOperationStatement,
  constants: ReadonlyMap<string, number>,
): 1 | 2 | 4 | 8 | 16 {
  const value = absoluteOperand(statement, constants);
  if (value !== 1 && value !== 2 && value !== 4 && value !== 8 && value !== 16)
    throw compileErrorAt("alignment must be 1, 2, 4, 8, or 16", statement.span);
  return value;
}

function identifierOperands(
  statement: Cs486AsmOperationStatement,
): readonly Cs486AsmToken[] {
  if (statement.operands.length === 0)
    throw compileErrorAt(
      `${statement.name} expects at least one symbol`,
      statement.span,
    );
  return statement.operands.map((operand) =>
    singleIdentifier(operand, statement.span),
  );
}

function singleIdentifier(
  tokens: readonly Cs486AsmToken[] | undefined,
  span: Cs486SourceSpan,
): Cs486AsmToken {
  if (tokens?.length !== 1 || tokens[0]!.kind !== "identifier")
    throw compileErrorAt("expected one identifier", tokens?.[0]?.span ?? span);
  return tokens[0]!;
}

function register(
  tokens: readonly Cs486AsmToken[],
  span: Cs486SourceSpan,
): Cs486Register {
  const value = registerNameFrom(tokens);
  if (value === undefined)
    throw compileErrorAt(
      `unknown register ${renderTokens(tokens)}`,
      tokens[0]?.span ?? span,
    );
  return value;
}

function registerNameFrom(
  tokens: readonly Cs486AsmToken[],
): Cs486Register | undefined {
  if (tokens.length !== 1 || tokens[0]!.kind !== "identifier") return undefined;
  const value = tokens[0]!.value.toLowerCase() as Cs486Register;
  return cs486RegisterNames.includes(value) ? value : undefined;
}

function requireReference(
  name: string,
  analysis: AssemblyAnalysis,
  span: Cs486SourceSpan,
  expectedSection?: Cs486ObjectSectionName | "data-address",
): void {
  const definition = analysis.definitions.get(name);
  if (definition === undefined && !analysis.externals.has(name))
    throw compileErrorAt(
      `symbol ${name} must be defined or declared extern`,
      span,
    );
  if (
    expectedSection !== undefined &&
    definition !== undefined &&
    (expectedSection === "data-address"
      ? definition.section === "text"
      : definition.section !== expectedSection)
  )
    throw compileErrorAt(
      `${name} is not a ${expectedSection === "data-address" ? "data" : expectedSection} symbol`,
      span,
    );
  const declaredType = analysis.types.get(name);
  if (
    definition === undefined &&
    ((expectedSection === "text" && declaredType === "object") ||
      (expectedSection === "data-address" && declaredType === "function"))
  )
    throw compileErrorAt(`${name} has incompatible type ${declaredType}`, span);
}

function addressRelocationType(
  name: string,
  analysis: AssemblyAnalysis,
): "absolute32" | "data-address" | "function-address" {
  const type = analysis.types.get(name);
  const section = analysis.definitions.get(name)?.section;
  if (type === "function" || section === "text") return "function-address";
  if (type === "object" || section !== undefined) return "data-address";
  return "absolute32";
}

function requireSymbolName(name: string, span: Cs486SourceSpan): void {
  if (!/^[A-Za-z_.$@?][A-Za-z0-9_.$@?]*$/u.test(name))
    throw compileErrorAt(`invalid symbol ${name}`, span);
}

function duplicateSymbol(
  name: string,
  span: Cs486SourceSpan,
  previous?: Cs486SourceSpan,
): Cs486CompileError {
  return compileErrorAt(`duplicate symbol ${name}`, span, {
    notes:
      previous === undefined
        ? []
        : [{ message: `${name} was first defined here`, span: previous }],
  });
}

function requireDataSection(
  section: Cs486ObjectSectionName,
  span: Cs486SourceSpan,
): asserts section is "data" | "rodata" {
  if (section !== "data" && section !== "rodata")
    throw compileErrorAt(
      "initialized data is only valid in data or rodata",
      span,
    );
}

function misleadingDosOperation(name: string): boolean {
  return [
    "org",
    "model",
    "segment",
    "proc",
    "endp",
    "assume",
    "int",
    "end",
  ].includes(name);
}

function checkedSize(
  count: number,
  width: 1 | 2 | 4,
  span: Cs486SourceSpan,
): number {
  if (
    count < 0 ||
    !Number.isSafeInteger(count) ||
    count > Math.floor(maximumDataBytes / width)
  )
    throw compileErrorAt(
      "reserved data size is outside the supported range",
      span,
    );
  return count * width;
}

function appendInteger(
  target: number[],
  value: number,
  width: 1 | 2 | 4,
  span: Cs486SourceSpan,
): void {
  const minimum = width === 1 ? -128 : width === 2 ? -32_768 : -2_147_483_648;
  const maximum = width === 1 ? 255 : width === 2 ? 65_535 : 0xffffffff;
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum)
    throw compileErrorAt(
      `value does not fit in ${String(width * 8)} bits`,
      span,
    );
  const unsigned = value >>> 0;
  for (let index = 0; index < width; index += 1)
    target.push((unsigned >>> (index * 8)) & 0xff);
}

function writeInt32(target: number[], offset: number, value: number): void {
  if (offset < 0 || offset + 4 > target.length)
    throw new Cs486CompileError("data relocation is outside initialized data");
  const unsigned = value >>> 0;
  for (let index = 0; index < 4; index += 1)
    target[offset + index] = (unsigned >>> (index * 8)) & 0xff;
}

function requireDataLimit(
  sections: Readonly<Record<Cs486ObjectSectionName, SectionCursor>>,
): void {
  if (
    sections.rodata.offset + sections.data.offset + sections.bss.offset >
    maximumDataBytes
  )
    throw new Cs486CompileError("data size limit exceeded");
}

function maximumAlignment(
  left: 1 | 2 | 4 | 8 | 16,
  right: 1 | 2 | 4 | 8 | 16,
): 1 | 2 | 4 | 8 | 16 {
  return Math.max(left, right) as 1 | 2 | 4 | 8 | 16;
}

function align(value: number, alignment: number): number {
  return Math.ceil(value / alignment) * alignment;
}

function cloneInstruction(instruction: Cs486Instruction): Cs486Instruction {
  return { ...instruction };
}

function renderStatements(statements: readonly Cs486AsmStatement[]): string {
  return statements
    .map((statement) =>
      statement.kind === "label"
        ? `${statement.name}:`
        : `${statement.name}${
            statement.operands.length === 0
              ? ""
              : ` ${statement.operands.map(renderTokens).join(", ")}`
          }`,
    )
    .join("\n");
}

function renderTokens(tokens: readonly Cs486AsmToken[]): string {
  let result = "";
  for (const token of tokens) {
    const noLeadingSpace = ["]", ")", ","].includes(token.value);
    const noTrailingSpace = ["[", "("].includes(result.at(-1) ?? "");
    if (result.length > 0 && !noLeadingSpace && !noTrailingSpace) result += " ";
    result += token.raw;
  }
  return result;
}

function emptySpan(): Cs486SourceSpan {
  const position = { column: 1, line: 1, offset: 0, source: "<assembly>" };
  return { end: position, start: position };
}
