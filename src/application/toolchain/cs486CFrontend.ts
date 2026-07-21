import { assembleCs486Object, Cs486CompileError } from "./cs486Assembler.js";
import {
  createCs486FunctionSignature,
  parseCs486FunctionSignature,
  type Cs486FunctionSignature,
} from "../../domain/cpu/cs486.js";
import {
  compileErrorAt,
  type Cs486SourcePosition,
  type Cs486SourceSpan,
} from "./cs486AsmDiagnostics.js";
import {
  allocateCs486IrRegistersLinearScan,
  assertValidCs486Ir,
  optimizeCs486IrWithReport,
  scheduleCs486IrBlock,
  type Cs486IrBinaryOperator,
  type Cs486IrCallInstruction,
  type Cs486IrIndirectCallInstruction,
  type Cs486IrExternalFunction,
  type Cs486IrFunction,
  type Cs486IrInstruction,
  type Cs486IrLocal,
  type Cs486IrParameter,
  type Cs486IrProgram,
  type Cs486IrRegisterAllocation,
  type Cs486IrReturnType,
  type Cs486IrTerminator,
  type Cs486IrValueId,
  type Cs486IrValueLocation,
  type Cs486IrValueType,
} from "./cs486Ir.js";
import {
  preprocessCs486C,
  type Cs486CPreprocessorDefinition,
  type Cs486CPreprocessorInclude,
  type Cs486CPreprocessorIncludeRequest,
} from "./cs486CPreprocessor.js";
import {
  cs486Byte8DataModel,
  cs486Word32DataModel,
  type Cs486DataModel,
} from "../../domain/cpu/cs486Compatibility.js";
import {
  csFloatAdd,
  csFloatCompare,
  csFloatConvert,
  csFloatDivide,
  csFloatFromSignedInteger,
  csFloatFromUnsignedInteger,
  csFloatMultiply,
  csFloatNegate,
  csFloatSubtract,
  csFloatToSignedInteger,
  csFloatToUnsignedInteger,
  parseCsFloatLiteral,
  type CsFloatFormat,
} from "../../domain/cpu/deterministicFloat.js";

export type Cs486CFamilyLanguage = "c" | "cpp";

export interface Cs486CFrontendOptions {
  readonly dataModel?: Cs486DataModel;
  readonly definitions?: readonly Cs486CPreprocessorDefinition[];
  readonly include?: (
    request: Cs486CPreprocessorIncludeRequest,
  ) => Cs486CPreprocessorInclude | undefined;
  readonly sourceName?: string;
  readonly optimizationLevel?: 0 | 1;
  readonly undefines?: readonly string[];
}

export interface Cs486CFrontendOutput {
  readonly assembly: string;
  readonly dataBytes: number;
  readonly dataModel: Cs486DataModel;
}

type CIntegerType =
  | "_Bool"
  | "char"
  | "int"
  | "long"
  | "long long"
  | "short"
  | "signed char"
  | "unsigned char"
  | "unsigned int"
  | "unsigned long"
  | "unsigned long long"
  | "unsigned short";
type CFloatingType = "double" | "float";
type CScalarType = CFloatingType | CIntegerType;
interface CPointerType {
  readonly kind: "pointer";
  readonly to: CType;
  readonly toQualifiers?: CQualifiers;
}
interface CQualifiers {
  readonly const?: true;
  readonly restrict?: true;
  readonly volatile?: true;
}
interface CDeclaredType {
  readonly qualifiers: CQualifiers;
  readonly type: CType;
}
interface CArrayType {
  readonly element: CObjectType;
  readonly flexible?: true;
  readonly kind: "array";
  readonly length: number;
}
interface CStructField {
  readonly bitOffset?: number;
  readonly bitWidth?: number;
  readonly name: string;
  readonly offsetBytes: number;
  readonly qualifiers?: CQualifiers;
  readonly span: Cs486SourceSpan;
  readonly type: CObjectType;
}
interface CStructType {
  alignmentBytes: number;
  complete: boolean;
  readonly fields: CStructField[];
  readonly kind: "struct";
  readonly name: string;
  sizeBytes: number;
  readonly span: Cs486SourceSpan;
}
interface CUnionType {
  alignmentBytes: number;
  complete: boolean;
  readonly fields: CStructField[];
  readonly kind: "union";
  readonly name: string;
  sizeBytes: number;
  readonly span: Cs486SourceSpan;
}
type CAggregateType = CStructType | CUnionType;
type CObjectType =
  CArrayType | CPointerType | CScalarType | CStructType | CUnionType;
interface CFunctionType {
  readonly kind: "function";
  readonly parameterTypes: readonly CObjectType[];
  readonly returnType: CObjectType | "void";
  readonly variadic: boolean;
}
type CType = CFunctionType | CObjectType | "void";
type ComparisonOperator = "<" | "<=" | ">" | ">=";

/** Full C binary-operator grammar. `&&`/`||` lower to explicit short-circuit branches. */
type CBinaryOperator =
  | "!="
  | "%"
  | "&"
  | "&&"
  | "*"
  | "+"
  | "-"
  | "/"
  | "<"
  | "<<"
  | "<="
  | "=="
  | ">"
  | ">="
  | ">>"
  | "^"
  | "|"
  | "||";
type CUnaryOperator = "!" | "&" | "*" | "+" | "-" | "~";

type CTokenKind = "eof" | "identifier" | "number" | "punctuation" | "string";

interface CToken {
  readonly kind: CTokenKind;
  readonly raw: string;
  readonly span: Cs486SourceSpan;
  readonly value: string;
}

interface CVariable {
  readonly name: string;
  readonly qualifiers?: CQualifiers;
  readonly slot: number;
  readonly span: Cs486SourceSpan;
  readonly storage: "global" | "local";
  readonly type: CObjectType;
  readonly words: number;
}

interface CGlobalVariable extends CVariable {
  readonly defined: boolean;
  readonly initializer?: readonly CInitializerValue[];
  readonly linkage: "external" | "internal";
  readonly storage: "global";
}

interface CWordString {
  readonly symbol: string;
  readonly value: string;
}

type CPrintfPart =
  | { readonly kind: "literal"; readonly value: string }
  | {
      readonly conversion: "c" | "d" | "s";
      readonly expression: CExpression;
      readonly kind: "conversion";
    };

type CPrintfFormatPart =
  | { readonly kind: "literal"; readonly value: string }
  | { readonly conversion: "c" | "d" | "s"; readonly kind: "conversion" };

interface CFunctionSymbol {
  definition?: CFunctionDefinition;
  readonly firstSpan: Cs486SourceSpan;
  readonly linkage: "external" | "internal";
  readonly name: string;
  readonly parameterTypes: readonly CObjectType[];
  readonly returnType: CObjectType | "void";
  readonly variadic: boolean;
}

interface CFunctionDefinition {
  readonly body: CBlockStatement;
  readonly localCount: number;
  readonly nameSpan: Cs486SourceSpan;
  readonly parameters: readonly CVariable[];
  readonly symbol: CFunctionSymbol;
}

interface CParameterDeclaration {
  readonly name?: CToken;
  readonly qualifiers?: CQualifiers;
  readonly span: Cs486SourceSpan;
  readonly type: CObjectType;
}

interface CParameterList {
  readonly declarations: readonly CParameterDeclaration[];
  readonly variadic: boolean;
}

interface CProgram {
  readonly dataModel: Cs486DataModel;
  readonly definitions: readonly CFunctionDefinition[];
  readonly functions: ReadonlyMap<string, CFunctionSymbol>;
  readonly globals: ReadonlyMap<string, CGlobalVariable>;
  readonly strings: readonly CWordString[];
}

type CExpression =
  | {
      readonly kind: "binary";
      readonly left: CExpression;
      readonly operator: CBinaryOperator;
      readonly right: CExpression;
      readonly span: Cs486SourceSpan;
      readonly type: CObjectType;
    }
  | {
      readonly base: CExpression;
      readonly field: CStructField;
      readonly kind: "member";
      readonly span: Cs486SourceSpan;
      readonly throughPointer: boolean;
      readonly type: CObjectType;
    }
  | {
      readonly arguments: readonly CExpression[];
      readonly kind: "call";
      readonly name: string;
      readonly returnType: CObjectType | "void";
      readonly span: Cs486SourceSpan;
    }
  | {
      readonly arguments: readonly CExpression[];
      readonly callee: CExpression;
      readonly functionType: CFunctionType;
      readonly kind: "indirect-call";
      readonly returnType: CObjectType | "void";
      readonly span: Cs486SourceSpan;
    }
  | {
      readonly kind: "function";
      readonly span: Cs486SourceSpan;
      readonly symbol: CFunctionSymbol;
      readonly type: CPointerType;
    }
  | {
      readonly initializer: readonly CInitializerValue[];
      readonly kind: "compound";
      readonly span: Cs486SourceSpan;
      readonly type: CArrayType | CAggregateType;
      readonly variable: CVariable;
    }
  | {
      readonly highValue?: number;
      readonly kind: "floating";
      readonly span: Cs486SourceSpan;
      readonly type: CFloatingType;
      readonly value: number;
    }
  | {
      readonly highValue?: number;
      readonly kind: "integer";
      readonly span: Cs486SourceSpan;
      readonly type: CIntegerType;
      readonly value: number;
    }
  | {
      readonly kind: "string";
      readonly span: Cs486SourceSpan;
      readonly symbol: string;
      readonly type: CPointerType;
      readonly value: string;
    }
  | {
      readonly condition: CExpression;
      readonly kind: "ternary";
      readonly span: Cs486SourceSpan;
      readonly type: CObjectType;
      readonly whenFalse: CExpression;
      readonly whenTrue: CExpression;
    }
  | {
      readonly kind: "unary";
      readonly operand: CExpression;
      readonly operator: CUnaryOperator;
      readonly span: Cs486SourceSpan;
      readonly type: CFunctionType | CObjectType;
    }
  | {
      readonly kind: "variable";
      readonly span: Cs486SourceSpan;
      readonly type: CObjectType;
      readonly variable: CVariable;
    }
  | {
      readonly base: CExpression;
      readonly index: CExpression;
      readonly kind: "index";
      readonly span: Cs486SourceSpan;
      readonly type: CObjectType;
    }
  | {
      readonly expression: CExpression;
      readonly kind: "cast";
      readonly span: Cs486SourceSpan;
      readonly type: CObjectType;
    };

interface CInitializerAtom {
  readonly kind: "initializer-atom";
  readonly type: CObjectType;
  readonly value:
    CExpression | number | string | readonly [low: number, high: number];
}

type CInitializerValue = CExpression | CInitializerAtom | number | string;

interface CBlockStatement {
  readonly kind: "block";
  readonly span: Cs486SourceSpan;
  readonly statements: readonly CStatement[];
}

type CStatement =
  | CBlockStatement
  | {
      readonly expression: CExpression;
      readonly kind: "assignment";
      readonly span: Cs486SourceSpan;
      readonly target: CExpression;
    }
  | {
      readonly expression: CExpression;
      readonly kind: "call";
      readonly span: Cs486SourceSpan;
    }
  | {
      readonly aggregateInitializer?: readonly CInitializerValue[];
      readonly initializer?: CExpression;
      readonly kind: "declaration";
      readonly span: Cs486SourceSpan;
      readonly variable: CVariable;
    }
  | {
      readonly body: CBlockStatement;
      readonly bound: CExpression;
      readonly comparison: ComparisonOperator;
      readonly increment: number;
      readonly initializer: Extract<
        CStatement,
        { readonly kind: "assignment" | "declaration" }
      >;
      readonly kind: "for";
      readonly span: Cs486SourceSpan;
      readonly variable: CVariable;
    }
  | {
      readonly instructions: readonly CInlineInstruction[];
      readonly kind: "inline-assembly";
      readonly span: Cs486SourceSpan;
    }
  | {
      readonly expression: CExpression;
      readonly kind: "print";
      readonly newline: boolean;
      readonly span: Cs486SourceSpan;
    }
  | {
      readonly kind: "formatted-print";
      readonly parts: readonly CPrintfPart[];
      readonly span: Cs486SourceSpan;
    }
  | {
      readonly expression?: CExpression;
      readonly kind: "return";
      readonly span: Cs486SourceSpan;
    }
  | {
      readonly condition: CExpression;
      readonly elseBranch?: CBlockStatement;
      readonly kind: "if";
      readonly span: Cs486SourceSpan;
      readonly thenBranch: CBlockStatement;
    }
  | {
      readonly body: CBlockStatement;
      readonly condition: CExpression;
      readonly kind: "while";
      readonly span: Cs486SourceSpan;
    }
  | {
      readonly body: CBlockStatement;
      readonly condition: CExpression;
      readonly kind: "do-while";
      readonly span: Cs486SourceSpan;
    }
  | {
      readonly body: CBlockStatement;
      readonly expression: CExpression;
      readonly kind: "switch";
      readonly span: Cs486SourceSpan;
    }
  | {
      readonly kind: "case";
      readonly span: Cs486SourceSpan;
      readonly value: number;
    }
  | {
      readonly kind: "default";
      readonly span: Cs486SourceSpan;
    }
  | {
      readonly kind: "break";
      readonly span: Cs486SourceSpan;
    }
  | {
      readonly kind: "continue";
      readonly span: Cs486SourceSpan;
    }
  | {
      readonly kind: "goto";
      readonly name: string;
      readonly span: Cs486SourceSpan;
    }
  | {
      readonly kind: "label";
      readonly name: string;
      readonly span: Cs486SourceSpan;
    };

interface CInlineInstruction {
  readonly source: string;
  readonly variable?: CVariable;
}

interface CSwitchFrame {
  hasDefault: boolean;
  readonly values: Set<number>;
}

interface CFunctionContext {
  readonly gotos: { readonly name: string; readonly span: Cs486SourceSpan }[];
  readonly labels: Map<string, Cs486SourceSpan>;
  localCount: number;
  loopDepth: number;
  readonly scopes: Map<string, CVariable>[];
  readonly switchFrames: CSwitchFrame[];
  readonly symbol: CFunctionSymbol;
}

interface CCallUse {
  readonly argumentCount: number;
  readonly name: string;
  readonly span: Cs486SourceSpan;
  readonly valueRequired: boolean;
}

const maximumExpressionTokens = 256;
const maximumExpressionDepth = 160;
const maximumBlockDepth = 48;
const maximumFunctions = 1_024;
const maximumFunctionParameters = 32;
const maximumLocalsPerFunction = 256;
const maximumSyntheticLocalsPerFunction = 512;
const maximumSwitchCases = 64;
const maximumFunctionLabels = 256;
const maximumFunctionGotos = 1_024;
const maximumInlineInstructions = 16;
const maximumInlineRegions = 64;
const maximumIrBlocksPerFunction = 256;
const maximumIrInstructionsPerFunction = 8_192;
const maximumIrValuesPerFunction = 16_384;
const maximumGlobals = 256;
const maximumGlobalWords = 4_194_304;
const maximumInitializedWords = 62_500;
const maximumStringWords = 4_096;
const maximumPrintfFormatCharacters = 1_024;
const maximumPrintfConversions = 32;
const maximumPrintfStringReadWords = 4_096;
const maximumPrintfOutputCharacters = 64_000;

const cIrLimits = Object.freeze({
  maxBlocksPerFunction: maximumIrBlocksPerFunction,
  maxExternals: maximumFunctions + maximumInlineRegions + 2,
  maxFunctions: maximumFunctions,
  maxInstructionsPerFunction: maximumIrInstructionsPerFunction,
  maxLocalsPerFunction:
    maximumLocalsPerFunction + maximumSyntheticLocalsPerFunction,
  maxValuesPerFunction: maximumIrValuesPerFunction,
});

const printI32Intrinsic = ".cs.print.i32";
const printCharacterIntrinsic = ".cs.print.character";
const printStringIntrinsic = ".cs.print.string";
const printNewlineIntrinsic = ".cs.print.newline";
const inlineAssemblyIntrinsicPrefix = ".cs.inline.";
const csSyscallIntrinsic = "__cs_syscall";
const csVaStartIntrinsic = "__cs_va_start";
const floatIntrinsicPrefix = ".cs.fp.";

const comparisonOperators = new Set<CBinaryOperator>([
  "!=",
  "<",
  "<=",
  "==",
  ">",
  ">=",
]);

const reservedIdentifiers = new Set([
  "_Alignof",
  "_Bool",
  "_Static_assert",
  "alignas",
  "alignof",
  "asm",
  "auto",
  "bool",
  "break",
  "case",
  "catch",
  "char",
  "class",
  "const",
  "constexpr",
  "continue",
  "default",
  "delete",
  "do",
  "double",
  "else",
  "enum",
  "explicit",
  "export",
  "extern",
  "false",
  "float",
  "for",
  "friend",
  "goto",
  "if",
  "inline",
  "int",
  "long",
  "namespace",
  "new",
  "nullptr",
  "operator",
  "private",
  "protected",
  "public",
  "register",
  "return",
  "short",
  "signed",
  "sizeof",
  "static",
  "static_assert",
  "struct",
  "switch",
  "template",
  "this",
  "throw",
  "true",
  "try",
  "typedef",
  "typename",
  "union",
  "unsigned",
  "using",
  "virtual",
  "void",
  "volatile",
  "while",
]);

export function compileCs486CFrontend(
  language: Cs486CFamilyLanguage,
  source: string,
  options: Cs486CFrontendOptions = {},
): Cs486CFrontendOutput {
  const sourceName =
    options.sourceName ?? (language === "cpp" ? "<c++>" : "<c>");
  const dataModel = options.dataModel ?? cs486Word32DataModel;
  const suppliedDefinitions = options.definitions ?? [];
  const suppliedNames = new Set(
    suppliedDefinitions.map((definition) => definition.name),
  );
  const modelDefinitions: Cs486CPreprocessorDefinition[] = [
    {
      name: "__CS_DATA_MODEL__",
      replacement: dataModel === cs486Byte8DataModel ? "2" : "1",
    },
    {
      name: "__CS_CHAR_BIT__",
      replacement: dataModel === cs486Byte8DataModel ? "8" : "32",
    },
    { name: "__CS_WORD_BITS__", replacement: "32" },
    ...(dataModel === cs486Byte8DataModel
      ? [{ name: "__CS_BYTE8__", replacement: "1" }]
      : []),
  ].filter((definition) => !suppliedNames.has(definition.name));
  const preprocessed = preprocessCs486C(source, {
    ...options,
    definitions: [...modelDefinitions, ...suppliedDefinitions],
    sourceName,
  });
  const end: Cs486SourcePosition = preprocessed.at(-1)?.span.end ?? {
    column: 1,
    line: 1,
    offset: 0,
    source: sourceName,
  };
  const tokens: CToken[] = [
    ...preprocessed,
    { kind: "eof", raw: "", span: { end, start: end }, value: "" },
  ];
  const parser = new CParser(tokens, language, dataModel);
  const program = parser.parse();
  const intermediate = new CIntermediateBuilder(
    program,
    options.optimizationLevel ?? 1,
  ).build();
  return {
    assembly: new CCodeGenerator(dataModel).generate(program, intermediate),
    dataBytes: 0,
    dataModel,
  };
}

class CParser {
  private readonly calls: CCallUse[] = [];
  private currentFunction: CFunctionContext | undefined;
  private readonly definitions: CFunctionDefinition[] = [];
  private readonly enumConstants = new Map<
    string,
    { readonly type: CIntegerType; readonly value: number }
  >();
  private readonly enumTags = new Map<string, CIntegerType>();
  private readonly functions = new Map<string, CFunctionSymbol>();
  private readonly globals = new Map<string, CGlobalVariable>();
  private index = 0;
  private nextCompoundLiteral = 0;
  private nextStaticLocal = 0;
  private stringWords = 0;
  private readonly strings: CWordString[] = [];
  private readonly structs = new Map<string, CStructType>();
  private readonly unions = new Map<string, CUnionType>();
  private readonly typedefs = new Map<
    string,
    { readonly qualifiers: CQualifiers; readonly type: CObjectType }
  >();

  constructor(
    private readonly tokens: readonly CToken[],
    private readonly language: Cs486CFamilyLanguage,
    private readonly dataModel: Cs486DataModel,
  ) {}

  parse(): CProgram {
    while (!this.at("")) {
      this.parseTopLevelDeclaration();
    }
    for (const call of this.calls) {
      const function_ = this.functions.get(call.name);
      if (function_ === undefined)
        throw cError(`undeclared function ${call.name}`, call.span);
      if (call.valueRequired && function_.returnType === "void")
        throw cError(
          `void function ${call.name} cannot be used as a value`,
          call.span,
        );
      if (
        function_.linkage === "internal" &&
        function_.definition === undefined
      )
        throw cError(
          `static function ${call.name} is declared but not defined`,
          call.span,
          [
            {
              message: `${call.name} was declared static here`,
              span: function_.firstSpan,
            },
          ],
        );
      if (
        call.argumentCount < function_.parameterTypes.length ||
        (!function_.variadic &&
          call.argumentCount !== function_.parameterTypes.length)
      )
        throw cError(
          `function ${call.name} expects ${function_.variadic ? "at least " : ""}${String(function_.parameterTypes.length)} arguments, received ${String(call.argumentCount)}`,
          call.span,
        );
    }
    const globalWords = [...this.globals.values()].reduce(
      (total, global) => total + (global.defined ? global.words : 0),
      0,
    );
    if (globalWords > maximumGlobalWords)
      throw cError("global data word limit exceeded", this.current().span);
    const initializedWords =
      this.stringWords +
      [...this.globals.values()].reduce(
        (total, global) => total + (global.initializer?.length ?? 0),
        0,
      );
    if (initializedWords > maximumInitializedWords)
      throw cError("initialized data word limit exceeded", this.current().span);
    return {
      dataModel: this.dataModel,
      definitions: this.definitions,
      functions: this.functions,
      globals: this.globals,
      strings: this.strings,
    };
  }

  private parseTopLevelDeclaration(): void {
    if (this.at("_Static_assert") || this.at("static_assert")) {
      this.parseStaticAssert();
      return;
    }
    if (this.at("typedef")) {
      this.parseTypedef();
      return;
    }
    const staticToken = this.take("static");
    let external =
      staticToken === undefined && this.take("extern") !== undefined;
    const linkage = staticToken === undefined ? "external" : "internal";
    if (staticToken !== undefined && this.at("extern"))
      throw cError(
        "a declaration cannot combine static and extern storage",
        this.current().span,
      );
    if (external && this.at("static"))
      throw cError(
        "a declaration cannot combine extern and static storage",
        this.current().span,
      );
    if (
      external &&
      this.language === "cpp" &&
      this.current().kind === "string"
    ) {
      const linkage = this.consume();
      if (linkage.value !== "C") {
        throw cError(
          `unsupported C++ language linkage ${linkage.raw}; only extern "C" is accepted`,
          linkage.span,
        );
      }
      if (this.at("{")) {
        throw cError(
          'extern "C" linkage blocks are not supported; annotate each declaration',
          this.current().span,
        );
      }
      // The CS object ABI exposes one unmangled C-style symbol contract.
      // Here `extern` selects language linkage rather than storage duration.
      external = false;
    }
    if (!this.isTypeStart()) {
      const token = this.current();
      const label = this.language === "cpp" ? "C++" : "C";
      throw cError(
        `unsupported ${label} top-level declaration ${token.raw || "at end of source"}`,
        token.span,
      );
    }
    const tagDeclaration =
      this.at("struct") || this.at("union") || this.at("enum");
    const returnDeclaration = this.parseDeclaredType();
    const returnType = returnDeclaration.type;
    if (this.take(";") !== undefined) {
      if (!tagDeclaration)
        throw cError("declaration requires a name", this.previous().span);
      return;
    }
    if (this.isFunctionPointerDeclaratorStart()) {
      const declarator = this.parseFunctionPointerDeclarator(
        returnDeclaration,
        "global function-pointer name",
        true,
        false,
      );
      if (declarator.name === undefined)
        throw new Error("required function-pointer name was not parsed");
      this.parseGlobalDeclaration(
        declarator.name,
        declarator.type,
        declarator.qualifiers,
        external,
        linkage,
      );
      return;
    }
    const name = this.expectName("function name");
    if (name.value === "main" && linkage === "internal")
      throw cError("main cannot have internal linkage", name.span);
    if (!this.at("(")) {
      if (returnType === "void")
        throw cError("global variables cannot have type void", name.span);
      this.parseGlobalDeclaration(
        name,
        this.parseArrayLayers(returnType, false),
        returnDeclaration.qualifiers,
        external,
        linkage,
      );
      return;
    }
    if (isFunctionType(returnType))
      throw cError("functions cannot return function types", name.span);
    if (isAggregateType(returnType) || isArrayType(returnType))
      throw cError("functions cannot return aggregates by value", name.span);
    this.consume();
    const parameterList = this.parseParameterDeclarations();
    const parameterDeclarations = parameterList.declarations;
    this.expect(")");

    const symbol = this.declareFunction(
      name,
      returnType,
      parameterDeclarations.map((parameter) => parameter.type),
      parameterList.variadic,
      linkage,
    );
    if (this.take(";") !== undefined) return;
    if (name.value === csSyscallIntrinsic || name.value === csVaStartIntrinsic)
      throw cError(
        `${name.value} is a compiler-owned intrinsic and cannot be defined`,
        name.span,
      );
    if (external)
      throw cError("extern function definitions are not supported", name.span);
    if (!this.at("{"))
      throw cError("expected ';' or function body", this.current().span);
    if (symbol.definition !== undefined)
      throw cError(
        `duplicate definition of function ${name.value}`,
        name.span,
        [
          {
            message: `${name.value} was first defined here`,
            span: symbol.definition.nameSpan,
          },
        ],
      );

    const context: CFunctionContext = {
      gotos: [],
      labels: new Map(),
      localCount: 0,
      loopDepth: 0,
      scopes: [],
      switchFrames: [],
      symbol,
    };
    this.currentFunction = context;
    this.enterScope();
    const parameters = parameterDeclarations.map((parameter) => {
      if (parameter.name === undefined)
        throw cError(
          "function definition parameters require names",
          parameter.span,
        );
      return this.declareVariable(
        parameter.name,
        parameter.type,
        parameter.qualifiers ?? {},
      );
    });
    const body = this.parseBlock(0, false);
    this.leaveScope();
    for (const goto of context.gotos)
      if (!context.labels.has(goto.name))
        throw cError(`undefined label ${goto.name}`, goto.span);
    this.currentFunction = undefined;
    const definition: CFunctionDefinition = {
      body,
      localCount: context.localCount,
      nameSpan: name.span,
      parameters,
      symbol,
    };
    if (
      returnType !== "void" &&
      name.value !== "main" &&
      !statementDefinitelyReturns(body)
    )
      throw cError(
        `non-void function ${name.value} does not return a value on every path`,
        name.span,
      );
    symbol.definition = definition;
    this.definitions.push(definition);
  }

  private declareFunction(
    name: CToken,
    returnType: CObjectType | "void",
    parameterTypes: readonly CObjectType[],
    variadic: boolean,
    linkage: "external" | "internal",
  ): CFunctionSymbol {
    if (
      name.value === csSyscallIntrinsic &&
      (returnType !== "int" ||
        variadic ||
        parameterTypes.length !== 4 ||
        parameterTypes.some((type) => type !== "int"))
    )
      throw cError(
        `${csSyscallIntrinsic} must be declared as int ${csSyscallIntrinsic}(int, int, int, int)`,
        name.span,
      );
    if (
      name.value === csVaStartIntrinsic &&
      (returnType !== "void" ||
        variadic ||
        parameterTypes.length !== 1 ||
        !isPointerType(parameterTypes[0]!) ||
        parameterTypes[0].to !== "void")
    )
      throw cError(
        `${csVaStartIntrinsic} must be declared as void ${csVaStartIntrinsic}(void *)`,
        name.span,
      );
    const object = this.globals.get(name.value);
    if (object !== undefined)
      throw cError(`identifier ${name.value} is already an object`, name.span, [
        {
          message: `${name.value} was declared as an object here`,
          span: object.span,
        },
      ]);
    const existing = this.functions.get(name.value);
    if (existing !== undefined) {
      if (existing.linkage !== linkage)
        throw cError(
          `conflicting linkage for function ${name.value}`,
          name.span,
          [
            {
              message: `${name.value} was first declared here`,
              span: existing.firstSpan,
            },
          ],
        );
      if (!sameCType(existing.returnType, returnType))
        throw cError(
          `conflicting return type for function ${name.value}`,
          name.span,
          [
            {
              message: `${name.value} was first declared here`,
              span: existing.firstSpan,
            },
          ],
        );
      if (!sameTypes(existing.parameterTypes, parameterTypes))
        throw cError(
          `conflicting parameter types for function ${name.value}`,
          name.span,
          [
            {
              message: `${name.value} was first declared here`,
              span: existing.firstSpan,
            },
          ],
        );
      if (existing.variadic !== variadic)
        throw cError(
          `conflicting variadic contract for function ${name.value}`,
          name.span,
          [
            {
              message: `${name.value} was first declared here`,
              span: existing.firstSpan,
            },
          ],
        );
      return existing;
    }
    if (this.functions.size >= maximumFunctions)
      throw cError("function limit exceeded", name.span);
    const symbol: CFunctionSymbol = {
      firstSpan: name.span,
      linkage,
      name: name.value,
      parameterTypes: [...parameterTypes],
      returnType,
      variadic,
    };
    this.functions.set(name.value, symbol);
    return symbol;
  }

  private parseGlobalDeclaration(
    name: CToken,
    type: CObjectType,
    qualifiers: CQualifiers,
    external: boolean,
    linkage: "external" | "internal",
  ): void {
    const words = cTypeStorageWords(type, name.span, this.dataModel);
    const function_ = this.functions.get(name.value);
    if (function_ !== undefined)
      throw cError(
        `identifier ${name.value} is already a function`,
        name.span,
        [
          {
            message: `${name.value} was declared as a function here`,
            span: function_.firstSpan,
          },
        ],
      );
    const existing = this.globals.get(name.value);
    if (existing !== undefined && existing.linkage !== linkage)
      throw cError(`conflicting linkage for global ${name.value}`, name.span, [
        {
          message: `${name.value} was first declared here`,
          span: existing.span,
        },
      ]);
    if (existing !== undefined && !sameCType(existing.type, type))
      throw cError(`conflicting type for global ${name.value}`, name.span, [
        {
          message: `${name.value} was first declared here`,
          span: existing.span,
        },
      ]);
    if (
      existing !== undefined &&
      !sameQualifiers(existing.qualifiers ?? {}, qualifiers)
    )
      throw cError(
        `conflicting qualifiers for global ${name.value}`,
        name.span,
      );
    if (existing === undefined && this.globals.size >= maximumGlobals)
      throw cError("global variable limit exceeded", name.span);

    const provisional: CGlobalVariable =
      existing ??
      ({
        defined: false,
        linkage,
        name: name.value,
        ...(hasQualifiers(qualifiers) ? { qualifiers } : {}),
        slot: 0,
        span: name.span,
        storage: "global",
        type,
        words,
      } satisfies CGlobalVariable);
    if (existing === undefined) this.globals.set(name.value, provisional);

    const hasInitializer = this.take("=") !== undefined;
    if (external && hasInitializer)
      throw cError(
        "extern global declarations cannot have an initializer",
        this.previous().span,
      );
    const initializer = hasInitializer
      ? this.parseConstantInitializer(type, name.span)
      : undefined;
    this.expect(";");
    const defined = !external;
    if (defined && existing?.defined === true)
      throw cError(`duplicate definition of global ${name.value}`, name.span, [
        {
          message: `${name.value} was first defined here`,
          span: existing.span,
        },
      ]);
    if (defined) {
      this.globals.set(name.value, {
        defined: true,
        ...(initializer === undefined ? {} : { initializer }),
        linkage,
        name: name.value,
        ...(hasQualifiers(qualifiers) ? { qualifiers } : {}),
        slot: 0,
        span: name.span,
        storage: "global",
        type,
        words,
      });
    }
  }

  private parseConstantInitializer(
    type: CObjectType,
    span: Cs486SourceSpan,
  ): readonly CInitializerValue[] {
    return this.parseInitializer(type, span, true);
  }

  private parseLocalAggregateInitializer(
    type: CArrayType | CAggregateType,
    span: Cs486SourceSpan,
  ): readonly CInitializerValue[] {
    return this.parseInitializer(type, span, false);
  }

  private parseInitializer(
    type: CObjectType,
    span: Cs486SourceSpan,
    constantOnly: boolean,
  ): readonly CInitializerValue[] {
    if (isArrayType(type) && type.element === "char" && this.atString()) {
      const value = this.consumeStringLiteral();
      const words = [...value.value].map((character) =>
        character.codePointAt(0)!,
      );
      words.push(0);
      if (words.length > type.length)
        throw cError(
          "string initializer is too long for char array",
          value.span,
        );
      return [...words, ...Array<number>(type.length - words.length).fill(0)];
    }
    if (isArrayType(type) || isAggregateType(type)) {
      if (isArrayType(type) && type.flexible === true)
        throw cError("flexible array members cannot be initialized", span);
      const open = this.expect("{");
      const totalWords = cTypeSizeUnits(type, open.span, this.dataModel);
      const values: CInitializerValue[] = Array<number>(totalWords).fill(0);
      const assignedMasks = new Map<number, number>();
      let nextIndex = 0;
      let entries = 0;
      let activeUnionField: number | undefined;
      while (!this.at("}")) {
        if (entries >= 16_384)
          throw cError("aggregate initializer limit exceeded", open.span);
        const destination =
          this.at(".") || this.at("[")
            ? this.parseInitializerDesignation(type)
            : this.sequentialInitializerDestination(type, nextIndex);
        nextIndex = destination.rootIndex + 1;
        if (isUnionType(type)) {
          if (activeUnionField === undefined)
            activeUnionField = destination.rootIndex;
          else if (activeUnionField !== destination.rootIndex)
            throw cError(
              "union initializer may select only one active member",
              destination.span,
            );
        }
        const initialized = this.parseInitializer(
          destination.type,
          destination.span,
          constantOnly,
        );
        if (destination.bitWidth !== undefined) {
          if (initialized.length !== 1)
            throw new Error("validated bit-field initializer is not scalar");
          const targetWord = destination.offsetUnits;
          const mask = bitFieldMask(
            destination.bitOffset ?? 0,
            destination.bitWidth,
          );
          this.claimInitializerBits(
            assignedMasks,
            targetWord,
            mask,
            destination.span,
          );
          const merged = mergeBitFieldInitializer(
            initializerAtomValue(values[targetWord]!, destination.span),
            initializerAtomValue(initialized[0]!, destination.span),
            destination.bitOffset ?? 0,
            destination.bitWidth,
            destination.span,
          );
          values[targetWord] =
            this.dataModel === cs486Word32DataModel
              ? merged
              : {
                  kind: "initializer-atom",
                  type: "unsigned int",
                  value: merged,
                };
          entries += 1;
          if (this.take(",") === undefined) break;
          if (this.at("}")) break;
          continue;
        }
        for (const [word, value] of initialized.entries()) {
          const targetWord = destination.offsetUnits + word;
          if (targetWord < 0 || targetWord >= totalWords)
            throw cError(
              "initializer exceeds aggregate storage",
              destination.span,
            );
          this.claimInitializerBits(
            assignedMasks,
            targetWord,
            0xffff_ffff,
            destination.span,
          );
          values[targetWord] = value;
        }
        entries += 1;
        if (this.take(",") === undefined) break;
        if (this.at("}")) break;
      }
      this.expect("}");
      return values;
    }
    if (this.take("{") !== undefined) {
      const values = this.parseInitializer(type, span, constantOnly);
      this.take(",");
      this.expect("}");
      return values;
    }
    if (isWideValueType(type)) {
      const value =
        type === "double"
          ? this.parseConstantFloatingScalar(type)
          : this.parseConstantWideScalar(type);
      return this.dataModel === cs486Word32DataModel
        ? value
        : [{ kind: "initializer-atom", type, value }];
    }
    if (constantOnly) {
      const value = this.parseConstantScalar(type, span);
      return this.dataModel === cs486Word32DataModel
        ? [value]
        : [{ kind: "initializer-atom", type, value }];
    }
    const expression = this.parseExpression();
    requireExpressionAssignable(type, expression);
    return this.dataModel === cs486Word32DataModel
      ? [expression]
      : [{ kind: "initializer-atom", type, value: expression }];
  }

  private claimInitializerBits(
    assignedMasks: Map<number, number>,
    word: number,
    mask: number,
    span: Cs486SourceSpan,
  ): void {
    const previous = assignedMasks.get(word) ?? 0;
    if ((previous & mask) !== 0)
      throw cError("duplicate designated initializer", span);
    assignedMasks.set(word, (previous | mask) >>> 0);
  }

  private parseConstantWideScalar(
    type: "long long" | "unsigned long long",
  ): readonly [number, number] {
    const expression = this.parseExpression();
    requireExpressionAssignable(type, expression);
    const constant = evaluateCConstantInteger(expression);
    if (constant === undefined)
      throw cError(
        "wide initializer must be a bounded constant",
        expression.span,
      );
    const converted = convertConstantInteger(constant, type);
    return [
      Number(converted.bits & 0xffff_ffffn) | 0,
      Number((converted.bits >> 32n) & 0xffff_ffffn) | 0,
    ];
  }

  private parseConstantFloatingScalar(
    type: CFloatingType,
  ): readonly [number, number] {
    const expression = this.parseExpression();
    requireExpressionAssignable(type, expression);
    const bits = evaluateCConstantFloating(expression, type);
    if (bits === undefined)
      throw cError(
        "floating initializer must be a bounded constant",
        expression.span,
      );
    return [
      Number(bits & 0xffff_ffffn) | 0,
      Number((bits >> 32n) & 0xffff_ffffn) | 0,
    ];
  }

  private sequentialInitializerDestination(
    type: CArrayType | CAggregateType,
    index: number,
  ): {
    readonly bitOffset?: number;
    readonly bitWidth?: number;
    readonly offsetUnits: number;
    readonly rootIndex: number;
    readonly span: Cs486SourceSpan;
    readonly type: CObjectType;
  } {
    if (isArrayType(type)) {
      if (index >= type.length)
        throw cError(
          "too many aggregate initializer elements",
          this.current().span,
        );
      return {
        offsetUnits:
          index *
          cTypeSizeUnits(type.element, this.current().span, this.dataModel),
        rootIndex: index,
        span: this.current().span,
        type: type.element,
      };
    }
    const fieldIndex = type.kind === "union" ? (index === 0 ? 0 : -1) : index;
    const field = fieldIndex < 0 ? undefined : type.fields[fieldIndex];
    if (field === undefined)
      throw cError(
        "too many aggregate initializer elements",
        this.current().span,
      );
    if (isArrayType(field.type) && field.type.flexible === true)
      throw cError("flexible array members cannot be initialized", field.span);
    return {
      ...(field.bitOffset === undefined
        ? {}
        : { bitOffset: field.bitOffset, bitWidth: field.bitWidth }),
      offsetUnits: field.offsetBytes / cAddressUnitBytes(this.dataModel),
      rootIndex: fieldIndex,
      span: field.span,
      type: field.type,
    };
  }

  private parseInitializerDesignation(root: CArrayType | CAggregateType): {
    readonly bitOffset?: number;
    readonly bitWidth?: number;
    readonly offsetUnits: number;
    readonly rootIndex: number;
    readonly span: Cs486SourceSpan;
    readonly type: CObjectType;
  } {
    const start = this.current();
    let current: CObjectType = root;
    let offsetUnits = 0;
    let rootIndex: number | undefined;
    let bitOffset: number | undefined;
    let bitWidth: number | undefined;
    while (this.at(".") || this.at("[")) {
      if (this.take(".") !== undefined) {
        const name = this.expectName("initializer field designator");
        if (!isAggregateType(current))
          throw cError("field designator requires an aggregate", name.span);
        const fields: readonly CStructField[] = current.fields;
        const fieldIndex = fields.findIndex(
          (field) => field.name === name.value,
        );
        const field: CStructField | undefined = fields[fieldIndex];
        if (field === undefined)
          throw cError(
            `${current.kind} ${current.name} has no field ${name.value}`,
            name.span,
          );
        rootIndex ??= fieldIndex;
        offsetUnits += field.offsetBytes / cAddressUnitBytes(this.dataModel);
        current = field.type;
        bitOffset = field.bitOffset;
        bitWidth = field.bitWidth;
        continue;
      }
      const open = this.expect("[");
      if (!isArrayType(current))
        throw cError("array designator requires an array", open.span);
      const expression = this.parseExpression();
      this.expect("]");
      const index = evaluateCConstantExpression(expression);
      if (
        index === undefined ||
        !Number.isInteger(index) ||
        index < 0 ||
        index >= current.length
      )
        throw cError(
          "array designator requires an in-range integer constant",
          expression.span,
        );
      rootIndex ??= index;
      offsetUnits +=
        index *
        cTypeSizeUnits(current.element, expression.span, this.dataModel);
      current = current.element;
      bitOffset = undefined;
      bitWidth = undefined;
    }
    this.expect("=");
    if (rootIndex === undefined)
      throw new Error("initializer designation consumed no designator");
    if (isArrayType(current) && current.flexible === true)
      throw cError("flexible array members cannot be initialized", start.span);
    return {
      ...(bitOffset === undefined ? {} : { bitOffset, bitWidth }),
      offsetUnits,
      rootIndex,
      span: { end: this.previous().span.end, start: start.span.start },
      type: current,
    };
  }

  private parseConstantScalar(
    type: CObjectType,
    span: Cs486SourceSpan,
  ): number | string {
    if (this.atString()) {
      if (!isPointerType(type) || type.to !== "char")
        throw cError(
          "string initializer requires char pointer type",
          this.current().span,
        );
      return this.internString(this.consumeStringLiteral()).symbol;
    }
    if (this.take("&") !== undefined) {
      const target = this.expectName("global address");
      const variable = this.globals.get(target.value);
      const function_ = this.functions.get(target.value);
      if (variable === undefined && function_ === undefined)
        throw cError(`undeclared global ${target.value}`, target.span);
      const addressType: CPointerType = {
        kind: "pointer",
        to:
          variable === undefined
            ? functionTypeOfSymbol(function_!)
            : variable.type,
      };
      requireAssignable(type, addressType, target.span);
      return variable?.name ?? function_!.name;
    }
    const token = this.current();
    if (token.kind === "identifier") {
      const variable = this.globals.get(token.value);
      if (variable !== undefined && isArrayType(variable.type)) {
        const addressType: CPointerType = {
          kind: "pointer",
          to: variable.type.element,
        };
        requireAssignable(type, addressType, token.span);
        this.consume();
        return variable.name;
      }
      const function_ = this.functions.get(token.value);
      if (function_ !== undefined && isPointerType(type)) {
        const addressType: CPointerType = {
          kind: "pointer",
          to: functionTypeOfSymbol(function_),
        };
        requireAssignable(type, addressType, token.span);
        this.consume();
        return function_.name;
      }
    }
    if (isFloatingType(type)) {
      const expression = this.parseExpression();
      requireExpressionAssignable(type, expression);
      const bits = evaluateCConstantFloating(expression, type);
      if (bits === undefined)
        throw cError(
          "global floating initializer must be a bounded constant",
          expression.span,
        );
      return Number(bits & 0xffff_ffffn) | 0;
    }
    if (!isPointerType(type) && !isIntegerType(type))
      throw cError("scalar initializer requires scalar type", span);
    const expression = this.parseExpression();
    const constant = evaluateCConstantInteger(expression);
    if (constant === undefined)
      throw cError(
        "global initializer must be a bounded integer constant",
        expression.span,
      );
    if (isPointerType(type)) {
      if (constant.bits === 0n) return 0;
      throw cError(
        "pointer initializer must be zero or an address",
        expression.span,
      );
    }
    const converted = convertConstantInteger(constant, type);
    return Number(converted.bits & 0xffff_ffffn) | 0;
  }

  private atString(): boolean {
    return this.current().kind === "string";
  }

  private consumeStringLiteral(): CToken {
    const first = this.expectKind("string", "string literal");
    let value = first.value;
    let end = first.span.end;
    while (this.current().kind === "string") {
      const next = this.consume();
      value += next.value;
      end = next.span.end;
    }
    return {
      ...first,
      raw: JSON.stringify(value),
      span: { end, start: first.span.start },
      value,
    };
  }

  private internString(token: CToken): CWordString {
    const existing = this.strings.find(
      (candidate) => candidate.value === token.value,
    );
    if (existing !== undefined) return existing;
    const words = [...token.value].length + 1;
    if (words > maximumStringWords)
      throw cError("string literal word limit exceeded", token.span);
    if (this.stringWords + words > maximumInitializedWords)
      throw cError("initialized data word limit exceeded", token.span);
    const string: CWordString = {
      symbol: `.L_c_string_${String(this.strings.length)}`,
      value: token.value,
    };
    this.strings.push(string);
    this.stringWords += words;
    return string;
  }

  private parseParameterDeclarations(): CParameterList {
    if (this.at(")")) return { declarations: [], variadic: false };
    if (this.at("void") && this.peek(1).value === ")") {
      const token = this.consume();
      if (!this.at(")"))
        throw cError("void must be the only parameter", token.span);
      return { declarations: [], variadic: false };
    }
    const parameters: CParameterDeclaration[] = [];
    let variadic = false;
    while (true) {
      if (this.take("...") !== undefined) {
        variadic = true;
        break;
      }
      if (parameters.length >= maximumFunctionParameters)
        throw cError("function parameter limit exceeded", this.current().span);
      const typeToken = this.current();
      const declaration = this.parseDeclaredType();
      const baseType = declaration.type;
      let name: CToken | undefined;
      let type: CObjectType;
      let qualifiers = declaration.qualifiers;
      if (this.isFunctionPointerDeclaratorStart()) {
        const declarator = this.parseFunctionPointerDeclarator(
          declaration,
          "function-pointer parameter name",
          false,
          true,
        );
        name = declarator.name;
        type = declarator.type;
        qualifiers = declarator.qualifiers;
      } else {
        if (baseType === "void" || isFunctionType(baseType))
          throw cError(
            "function parameters cannot have type void or function",
            typeToken.span,
          );
        name =
          this.current().kind === "identifier"
            ? this.expectName("parameter name")
            : undefined;
        type = this.parseArrayLayers(baseType, true);
      }
      if (isAggregateType(type))
        throw cError(
          "aggregate parameters must be passed by pointer",
          typeToken.span,
        );
      parameters.push({
        ...(name === undefined ? {} : { name }),
        ...(hasQualifiers(qualifiers) ? { qualifiers } : {}),
        span:
          name === undefined
            ? typeToken.span
            : { end: name.span.end, start: typeToken.span.start },
        type,
      });
      if (this.take(",") === undefined) break;
      if (this.at("...")) continue;
      if (this.at(")"))
        throw cError("expected parameter after ','", this.current().span);
    }
    const parameterWords = parameters.reduce(
      (words, parameter) =>
        words +
        cTypeStorageWords(parameter.type, parameter.span, this.dataModel),
      0,
    );
    if (parameterWords > maximumFunctionParameters)
      throw cError(
        "function parameter word limit exceeded",
        this.current().span,
      );
    return { declarations: parameters, variadic };
  }

  private parseStaticAssert(): CBlockStatement {
    const start = this.consume();
    this.expect("(");
    const expression = this.parseExpression();
    this.expect(",");
    const message = this.consumeStringLiteral();
    this.expect(")");
    const end = this.expect(";");
    const value = evaluateCConstantExpression(expression);
    if (value === undefined)
      throw cError(
        "static assertion requires a bounded integer constant expression",
        expression.span,
      );
    if (value === 0)
      throw cError(
        `static assertion failed: ${message.value}`,
        expression.span,
      );
    return {
      kind: "block",
      span: { end: end.span.end, start: start.span.start },
      statements: [],
    };
  }

  private parseBlock(depth: number, createScope = true): CBlockStatement {
    if (depth >= maximumBlockDepth)
      throw cError("block nesting limit exceeded", this.current().span);
    const open = this.expect("{");
    if (createScope) this.enterScope();
    const statements: CStatement[] = [];
    while (!this.at("}")) {
      if (this.at(""))
        throw cError("unterminated block", {
          end: this.current().span.end,
          start: open.span.start,
        });
      statements.push(this.parseStatement(depth + 1));
    }
    const close = this.consume();
    if (createScope) this.leaveScope();
    return {
      kind: "block",
      span: { end: close.span.end, start: open.span.start },
      statements,
    };
  }

  private parseStatement(depth: number): CStatement {
    const token = this.current();
    if (this.at("{")) return this.parseBlock(depth);
    if (this.take(";") !== undefined)
      return { kind: "block", span: token.span, statements: [] };
    if (this.at("_Static_assert") || this.at("static_assert"))
      return this.parseStaticAssert();
    if (this.at("static") || this.at("extern") || this.isTypeStart())
      return this.parseLocalDeclaration(true);
    if (this.at("for")) return this.parseFor(depth);
    if (this.at("if")) return this.parseIf(depth);
    if (this.at("while")) return this.parseWhile(depth);
    if (this.at("do")) return this.parseDoWhile(depth);
    if (this.at("switch")) return this.parseSwitch(depth);
    if (this.at("case")) return this.parseCaseLabel();
    if (this.at("default")) return this.parseDefaultLabel();
    if (this.at("break")) return this.parseBreak();
    if (this.at("continue")) return this.parseContinue();
    if (this.at("goto")) return this.parseGoto();
    if (token.kind === "identifier" && this.peek(1).value === ":")
      return this.parseLabel(depth);
    if (this.at("return")) return this.parseReturn();
    if (this.at("asm") || this.at("__asm__")) return this.parseInlineAssembly();
    // Preserve the provisional literal-only formatter for legacy sources that
    // do not include stdio.h. A declared printf is an ordinary guest-compiled
    // variadic function and follows the verified CS stack ABI.
    if (this.at("printf") && !this.functions.has("printf"))
      return this.parsePrintf();
    if (this.at("std")) return this.parseCout();
    if (
      token.kind === "identifier" ||
      token.value === "*" ||
      token.value === "&" ||
      token.value === "("
    )
      return this.parseExpressionStatement();
    const label = this.language === "cpp" ? "C++" : "C";
    throw cError(
      `unsupported ${label} statement ${token.raw || "at end of source"}`,
      token.span,
    );
  }

  private parseControlledBody(depth: number): CBlockStatement {
    if (this.at("{")) return this.parseBlock(depth);
    const statement = this.parseStatement(depth + 1);
    return {
      kind: "block",
      span: statement.span,
      statements: [statement],
    };
  }

  private parseLocalDeclaration(
    semicolon: boolean,
  ): Extract<CStatement, { kind: "declaration" }> {
    const start = this.current();
    const staticToken = this.take("static");
    const externToken =
      staticToken === undefined ? this.take("extern") : undefined;
    if (
      (staticToken !== undefined && this.at("extern")) ||
      (externToken !== undefined && this.at("static"))
    )
      throw cError(
        "a local declaration cannot combine static and extern storage",
        this.current().span,
      );
    const declaration = this.parseDeclaredType();
    const baseType = declaration.type;
    let name: CToken;
    let type: CObjectType;
    let qualifiers = declaration.qualifiers;
    if (this.isFunctionPointerDeclaratorStart()) {
      const declarator = this.parseFunctionPointerDeclarator(
        declaration,
        "function-pointer variable name",
        true,
        false,
      );
      if (declarator.name === undefined)
        throw new Error("required function-pointer name was not parsed");
      name = declarator.name;
      type = declarator.type;
      qualifiers = declarator.qualifiers;
    } else {
      if (baseType === "void" || isFunctionType(baseType))
        throw cError(
          "local variables cannot have type void or function",
          start.span,
        );
      name = this.expectName("variable name");
      type = this.parseArrayLayers(baseType, false);
    }
    if (externToken !== undefined) {
      if (this.take("=") !== undefined)
        throw cError(
          "block-scope extern declarations cannot have an initializer",
          this.previous().span,
        );
      const variable = this.declareExternVariable(name, type, qualifiers);
      const end = semicolon ? this.expect(";") : this.previous();
      return {
        kind: "declaration",
        span: { end: end.span.end, start: start.span.start },
        variable,
      };
    }
    if (staticToken !== undefined) {
      const initializer =
        this.take("=") === undefined
          ? undefined
          : this.parseConstantInitializer(type, name.span);
      const variable = this.declareStaticVariable(
        name,
        type,
        qualifiers,
        initializer,
      );
      const end = semicolon ? this.expect(";") : this.previous();
      return {
        kind: "declaration",
        span: { end: end.span.end, start: start.span.start },
        variable,
      };
    }
    const variable = this.declareVariable(name, type, qualifiers);
    const hasInitializer = this.take("=") !== undefined;
    const aggregateInitializer =
      hasInitializer && (isArrayType(type) || isAggregateType(type))
        ? this.parseLocalAggregateInitializer(type, name.span)
        : undefined;
    const initializer =
      hasInitializer && aggregateInitializer === undefined
        ? this.parseExpression()
        : undefined;
    if (initializer !== undefined) {
      requireExpressionAssignable(type, initializer);
    }
    const end = semicolon ? this.expect(";") : this.previous();
    return {
      ...(aggregateInitializer === undefined ? {} : { aggregateInitializer }),
      initializer,
      kind: "declaration",
      span: { end: end.span.end, start: start.span.start },
      variable,
    };
  }

  private parseExpressionStatement(): CStatement {
    const start = this.current();
    const targetOrCall = this.parseExpression();
    if (this.take("=") !== undefined) {
      if (!isLvalueExpression(targetOrCall))
        throw cError("assignment target is not an lvalue", targetOrCall.span);
      if (lvalueQualifiers(targetOrCall).const === true)
        throw cError("assignment target is const-qualified", targetOrCall.span);
      if (isArrayType(targetOrCall.type))
        throw cError("arrays are not assignable", targetOrCall.span);
      const expression = this.parseExpression();
      requireExpressionAssignable(targetOrCall.type, expression);
      const end = this.expect(";");
      return {
        expression,
        kind: "assignment",
        span: { end: end.span.end, start: start.span.start },
        target: targetOrCall,
      };
    }
    if (targetOrCall.kind === "call" || targetOrCall.kind === "indirect-call") {
      const expression = targetOrCall;
      if (expression.kind === "call") {
        const valueUse = this.calls.at(-1);
        if (
          valueUse?.name === expression.name &&
          valueUse.span.start.offset === expression.span.start.offset
        )
          this.calls.pop();
      }
      const end = this.expect(";");
      if (expression.kind === "call")
        this.calls.push({
          argumentCount: expression.arguments.length,
          name: expression.name,
          span: expression.span,
          valueRequired: false,
        });
      return {
        expression,
        kind: "call",
        span: { end: end.span.end, start: start.span.start },
      };
    }
    throw cError(
      "only an assignment or function call may be used as a statement",
      targetOrCall.span,
    );
  }

  private parseIf(depth: number): CStatement {
    const start = this.expect("if");
    this.expect("(");
    const condition = this.parseExpression();
    this.expect(")");
    const thenBranch = this.parseControlledBody(depth);
    let elseBranch: CBlockStatement | undefined;
    if (this.take("else") !== undefined) {
      if (this.at("if")) {
        const nested = this.parseIf(depth);
        elseBranch = { kind: "block", span: nested.span, statements: [nested] };
      } else {
        elseBranch = this.parseControlledBody(depth);
      }
    }
    const end = elseBranch ?? thenBranch;
    return {
      condition,
      kind: "if",
      span: { end: end.span.end, start: start.span.start },
      thenBranch,
      ...(elseBranch === undefined ? {} : { elseBranch }),
    };
  }

  private parseWhile(depth: number): CStatement {
    const start = this.expect("while");
    this.expect("(");
    const condition = this.parseExpression();
    this.expect(")");
    this.enterLoop();
    const body = this.parseControlledBody(depth);
    this.leaveLoop();
    return {
      body,
      condition,
      kind: "while",
      span: { end: body.span.end, start: start.span.start },
    };
  }

  private parseDoWhile(depth: number): CStatement {
    const start = this.expect("do");
    this.enterLoop();
    const body = this.parseControlledBody(depth);
    this.leaveLoop();
    this.expect("while");
    this.expect("(");
    const condition = this.parseExpression();
    this.expect(")");
    const end = this.expect(";");
    return {
      body,
      condition,
      kind: "do-while",
      span: { end: end.span.end, start: start.span.start },
    };
  }

  private parseSwitch(depth: number): CStatement {
    const start = this.expect("switch");
    this.expect("(");
    const expression = this.parseExpression();
    this.expect(")");
    if (!this.at("{"))
      throw cError("switch body must be a block", this.current().span);
    this.enterSwitch();
    const body = this.parseBlock(depth);
    this.leaveSwitch();
    return {
      body,
      expression,
      kind: "switch",
      span: { end: body.span.end, start: start.span.start },
    };
  }

  private parseCaseLabel(): CStatement {
    const start = this.expect("case");
    const frame = this.requireFunction().switchFrames.at(-1);
    if (frame === undefined)
      throw cError("case label not within a switch", start.span);
    const negative = this.take("-") !== undefined;
    const token = this.expectKind("number", "case constant");
    const magnitude = parseInteger(token);
    const value = negative ? -magnitude : magnitude;
    const colon = this.expect(":");
    if (frame.values.size >= maximumSwitchCases)
      throw cError("switch case limit exceeded", start.span);
    if (frame.values.has(value))
      throw cError(`duplicate case value ${String(value)}`, start.span);
    frame.values.add(value);
    return {
      kind: "case",
      span: { end: colon.span.end, start: start.span.start },
      value,
    };
  }

  private parseDefaultLabel(): CStatement {
    const start = this.expect("default");
    const frame = this.requireFunction().switchFrames.at(-1);
    if (frame === undefined)
      throw cError("default label not within a switch", start.span);
    if (frame.hasDefault) throw cError("duplicate default label", start.span);
    frame.hasDefault = true;
    const colon = this.expect(":");
    return {
      kind: "default",
      span: { end: colon.span.end, start: start.span.start },
    };
  }

  private parseBreak(): CStatement {
    const start = this.expect("break");
    const context = this.requireFunction();
    if (context.loopDepth === 0 && context.switchFrames.length === 0)
      throw cError("break statement not within a loop or switch", start.span);
    const end = this.expect(";");
    return {
      kind: "break",
      span: { end: end.span.end, start: start.span.start },
    };
  }

  private parseContinue(): CStatement {
    const start = this.expect("continue");
    if (this.requireFunction().loopDepth === 0)
      throw cError("continue statement not within a loop", start.span);
    const end = this.expect(";");
    return {
      kind: "continue",
      span: { end: end.span.end, start: start.span.start },
    };
  }

  private parseGoto(): CStatement {
    const start = this.expect("goto");
    const name = this.expectName("goto label");
    const context = this.requireFunction();
    if (context.gotos.length >= maximumFunctionGotos)
      throw cError("function goto limit exceeded", start.span);
    const end = this.expect(";");
    const span = { end: end.span.end, start: start.span.start };
    context.gotos.push({ name: name.value, span });
    return { kind: "goto", name: name.value, span };
  }

  private parseLabel(depth: number): CStatement {
    const name = this.expectName("label name");
    if (depth !== 1)
      throw cError(
        `label ${name.value} must be in the function's outer block`,
        name.span,
      );
    const context = this.requireFunction();
    const previous = context.labels.get(name.value);
    if (previous !== undefined)
      throw cError(`duplicate label ${name.value}`, name.span, [
        { message: `${name.value} was first declared here`, span: previous },
      ]);
    if (context.labels.size >= maximumFunctionLabels)
      throw cError("function label limit exceeded", name.span);
    const colon = this.expect(":");
    if (this.at("}"))
      throw cError("a label must be followed by a statement", name.span);
    const span = { end: colon.span.end, start: name.span.start };
    context.labels.set(name.value, span);
    return { kind: "label", name: name.value, span };
  }

  private parseFor(depth: number): CStatement {
    const start = this.expect("for");
    this.expect("(");
    this.enterScope();
    let initializer: Extract<
      CStatement,
      { kind: "assignment" | "declaration" }
    >;
    if (this.at("static") || this.at("extern") || this.isTypeStart())
      initializer = this.parseLocalDeclaration(true);
    else {
      const name = this.expectIdentifier("for initializer variable");
      const variable = this.lookupVariable(name);
      this.expect("=");
      const expression = this.parseExpression();
      const semicolon = this.expect(";");
      initializer = {
        expression,
        kind: "assignment",
        span: { end: semicolon.span.end, start: name.span.start },
        target: variableExpression(variable, name.span),
      };
    }
    const conditionName = this.expectIdentifier("for condition variable");
    const variable = this.lookupVariable(conditionName);
    requireIntegerType(variable.type, conditionName.span);
    if (variable !== initializerVariable(initializer))
      throw cError(
        "for initializer, condition, and increment must use the same variable",
        conditionName.span,
      );
    const comparison = this.current().value as ComparisonOperator;
    if (!["<", "<=", ">", ">="].includes(comparison))
      throw cError(
        "for condition must use <, <=, >, or >=",
        this.current().span,
      );
    this.consume();
    const bound = this.parseExpression();
    this.expect(";");
    const incrementName = this.expectIdentifier("for increment variable");
    if (this.lookupVariable(incrementName) !== variable)
      throw cError(
        "for initializer, condition, and increment must use the same variable",
        incrementName.span,
      );
    let increment: number;
    if (this.take("++") !== undefined) increment = 1;
    else if (this.take("--") !== undefined) increment = -1;
    else {
      const operation = this.current();
      if (operation.value !== "+=" && operation.value !== "-=")
        throw cError(
          "for increment must use ++, --, += constant, or -= constant",
          operation.span,
        );
      this.consume();
      const amountToken = this.expectKind("number", "for increment constant");
      const amount = parseInteger(amountToken);
      if (amount === 0)
        throw cError("for increment cannot be zero", amountToken.span);
      increment = operation.value === "+=" ? amount : -amount;
    }
    this.expect(")");
    this.enterLoop();
    const body = this.parseControlledBody(depth);
    this.leaveLoop();
    this.leaveScope();
    return {
      body,
      bound,
      comparison,
      increment,
      initializer,
      kind: "for",
      span: { end: body.span.end, start: start.span.start },
      variable,
    };
  }

  private parseReturn(): CStatement {
    const start = this.expect("return");
    const function_ = this.requireFunction();
    if (this.take(";") !== undefined) {
      if (function_.symbol.returnType !== "void")
        throw cError("non-void function must return a value", start.span);
      return { kind: "return", span: start.span };
    }
    if (function_.symbol.returnType === "void")
      throw cError("void function cannot return a value", start.span);
    const expression = this.parseExpression();
    requireExpressionAssignable(function_.symbol.returnType, expression);
    const end = this.expect(";");
    return {
      expression,
      kind: "return",
      span: { end: end.span.end, start: start.span.start },
    };
  }

  private parsePrintf(): CStatement {
    const start = this.expect("printf");
    this.expect("(");
    const format = this.expectKind("string", "printf format string");
    const descriptors = this.parsePrintfFormat(format);
    const parts: CPrintfPart[] = [];
    for (const descriptor of descriptors) {
      if (descriptor.kind === "literal") {
        parts.push(descriptor);
        continue;
      }
      this.expect(",");
      const expression = this.parseExpression();
      const type = decayCType(expressionType(expression));
      if (descriptor.conversion === "s") {
        if (!isPointerType(type) || type.to !== "char")
          throw cError("%s requires a char pointer argument", expression.span);
      } else requireIntegerType(type, expression.span);
      parts.push({
        conversion: descriptor.conversion,
        expression,
        kind: "conversion",
      });
    }
    if (this.at(","))
      throw cError(
        "printf has more arguments than conversions",
        this.current().span,
      );
    this.expect(")");
    const end = this.expect(";");
    return {
      kind: "formatted-print",
      parts,
      span: { end: end.span.end, start: start.span.start },
    };
  }

  private parsePrintfFormat(format: CToken): readonly CPrintfFormatPart[] {
    const characters = [...format.value];
    if (characters.length > maximumPrintfFormatCharacters)
      throw cError("printf format character limit exceeded", format.span);
    const parts: CPrintfFormatPart[] = [];
    let literal = "";
    let conversions = 0;
    let worstCaseOutput = 0;
    const flushLiteral = (): void => {
      if (literal.length === 0) return;
      parts.push({ kind: "literal", value: literal });
      worstCaseOutput += literal.length;
      literal = "";
    };
    for (let index = 0; index < characters.length; index += 1) {
      const character = characters[index]!;
      if (character !== "%") {
        literal += character;
        continue;
      }
      const conversion = characters[++index];
      if (conversion === undefined)
        throw cError("printf format ends with '%'", format.span);
      if (conversion === "%") {
        literal += "%";
        continue;
      }
      if (conversion !== "c" && conversion !== "d" && conversion !== "s")
        throw cError(
          `unsupported printf conversion %${conversion}`,
          format.span,
        );
      flushLiteral();
      conversions += 1;
      if (conversions > maximumPrintfConversions)
        throw cError("printf conversion limit exceeded", format.span);
      parts.push({ conversion, kind: "conversion" });
      worstCaseOutput +=
        conversion === "d"
          ? 11
          : conversion === "c"
            ? 2
            : maximumPrintfStringReadWords * 2;
    }
    flushLiteral();
    if (worstCaseOutput > maximumPrintfOutputCharacters)
      throw cError("printf worst-case output limit exceeded", format.span);
    return parts;
  }

  private parseCout(): CStatement {
    const start = this.expect("std");
    if (this.language !== "cpp")
      throw cError("std::cout is available only in the C++ subset", start.span);
    this.expect("::");
    this.expect("cout");
    this.expect("<<");
    // Bounded below shift precedence so a bare trailing `<<` always resumes
    // stream-insertion chaining (`std::cout << a << std::endl`) rather than
    // being consumed as a bitwise shift into the printed value; parenthesize
    // an explicit shift/comparison/logical value to opt back in.
    const expression = this.parseCoutOperand();
    let newline = false;
    if (this.take("<<") !== undefined) {
      this.expect("std");
      this.expect("::");
      this.expect("endl");
      newline = true;
    }
    const end = this.expect(";");
    return {
      expression,
      kind: "print",
      newline,
      span: { end: end.span.end, start: start.span.start },
    };
  }

  private parseInlineAssembly(): CStatement {
    const start = this.consume();
    this.expect("(");
    const encoded = this.expectKind("string", "inline assembly string");
    this.expect(")");
    const end = this.expect(";");
    const sourceLines = encoded.value.split("\n");
    if (sourceLines.length > maximumInlineInstructions)
      throw cError("inline assembly instruction limit exceeded", encoded.span);
    const instructions: CInlineInstruction[] = [];
    for (const raw of sourceLines) {
      const source = raw.trim();
      if (source.length === 0) continue;
      const op = /^(\w+)/u.exec(source)?.[1]?.toLowerCase();
      if (
        op === undefined ||
        [
          "call",
          "halt",
          "je",
          "jge",
          "jg",
          "jle",
          "jl",
          "jmp",
          "jne",
          "pop",
          "push",
          "ret",
          "syscall",
        ].includes(op) ||
        /\b(?:esp|ebp)\b/iu.test(source) ||
        source.includes(":")
      )
        throw cError(
          `unsafe inline assembly instruction: ${source}`,
          encoded.span,
        );
      const variables = new Map<string, CVariable>();
      for (const match of source.matchAll(/\[([A-Za-z_]\w*)\]/gu)) {
        const name = match[1]!;
        const token: CToken = {
          ...encoded,
          kind: "identifier",
          raw: name,
          value: name,
        };
        const variable = this.lookupVariable(token);
        variables.set(variable.name, variable);
      }
      if (variables.size > 1)
        throw cError(
          "inline assembly may reference only one local variable per instruction",
          encoded.span,
        );
      const variable = [...variables.values()][0];
      if (variable !== undefined) {
        const withoutPlaceholder = source.replace(/\[[A-Za-z_]\w*\]/gu, "");
        if (/\becx\b/iu.test(withoutPlaceholder))
          throw cError(
            "inline assembly local-variable addressing reserves ECX",
            encoded.span,
          );
      }
      const checked = source.replace(/\[([A-Za-z_]\w*)\]/gu, "[ecx]");
      try {
        const object = assembleCs486Object(checked);
        const text = object.sections?.find(
          (section) => section.name === "text",
        );
        if (text?.name !== "text" || text.instructions.length !== 1)
          throw new Error(
            "inline assembly must contain exactly one instruction",
          );
      } catch (error: unknown) {
        throw cError(
          error instanceof Cs486CompileError
            ? error.detail
            : error instanceof Error
              ? error.message
              : String(error),
          encoded.span,
        );
      }
      instructions.push({
        source,
        ...(variable === undefined ? {} : { variable }),
      });
    }
    return {
      instructions,
      kind: "inline-assembly",
      span: { end: end.span.end, start: start.span.start },
    };
  }

  private parseExpression(): CExpression {
    const start = this.index;
    const expression = this.parseTernary(0);
    if (this.index - start > maximumExpressionTokens)
      throw cError("expression token limit exceeded", expression.span);
    return expression;
  }

  private parseCoutOperand(): CExpression {
    const start = this.index;
    const expression = this.parseAdditive(0);
    if (this.index - start > maximumExpressionTokens)
      throw cError("expression token limit exceeded", expression.span);
    return expression;
  }

  private parseTernary(depth: number): CExpression {
    const condition = this.parseLogicalOr(depth + 1);
    if (this.take("?") === undefined) return condition;
    const whenTrue = this.parseTernary(depth + 1);
    this.expect(":");
    const whenFalse = this.parseTernary(depth + 1);
    requireScalarType(decayCType(expressionType(condition)), condition.span);
    const type = conditionalExpressionType(whenTrue, whenFalse);
    return {
      condition,
      kind: "ternary",
      span: { end: whenFalse.span.end, start: condition.span.start },
      type,
      whenFalse,
      whenTrue,
    };
  }

  private parseLogicalOr(depth: number): CExpression {
    let expression = this.parseLogicalAnd(depth + 1);
    while (this.at("||")) {
      this.consume();
      const right = this.parseLogicalAnd(depth + 1);
      expression = combineBinary(expression, "||", right);
    }
    return expression;
  }

  private parseLogicalAnd(depth: number): CExpression {
    let expression = this.parseBitwiseOr(depth + 1);
    while (this.at("&&")) {
      this.consume();
      const right = this.parseBitwiseOr(depth + 1);
      expression = combineBinary(expression, "&&", right);
    }
    return expression;
  }

  private parseBitwiseOr(depth: number): CExpression {
    let expression = this.parseBitwiseXor(depth + 1);
    while (this.at("|")) {
      this.consume();
      const right = this.parseBitwiseXor(depth + 1);
      expression = combineBinary(expression, "|", right);
    }
    return expression;
  }

  private parseBitwiseXor(depth: number): CExpression {
    let expression = this.parseBitwiseAnd(depth + 1);
    while (this.at("^")) {
      this.consume();
      const right = this.parseBitwiseAnd(depth + 1);
      expression = combineBinary(expression, "^", right);
    }
    return expression;
  }

  private parseBitwiseAnd(depth: number): CExpression {
    let expression = this.parseEquality(depth + 1);
    while (this.at("&")) {
      this.consume();
      const right = this.parseEquality(depth + 1);
      expression = combineBinary(expression, "&", right);
    }
    return expression;
  }

  private parseEquality(depth: number): CExpression {
    let expression = this.parseRelational(depth + 1);
    while (this.at("==") || this.at("!=")) {
      const operator = this.consume().value as "!=" | "==";
      const right = this.parseRelational(depth + 1);
      expression = combineBinary(expression, operator, right);
    }
    return expression;
  }

  private parseRelational(depth: number): CExpression {
    let expression = this.parseShift(depth + 1);
    while (this.at("<") || this.at("<=") || this.at(">") || this.at(">=")) {
      const operator = this.consume().value as "<" | "<=" | ">" | ">=";
      const right = this.parseShift(depth + 1);
      expression = combineBinary(expression, operator, right);
    }
    return expression;
  }

  private parseShift(depth: number): CExpression {
    let expression = this.parseAdditive(depth + 1);
    while (this.at("<<") || this.at(">>")) {
      const operator = this.consume().value as "<<" | ">>";
      const right = this.parseAdditive(depth + 1);
      expression = combineBinary(expression, operator, right);
    }
    return expression;
  }

  private parseAdditive(depth: number): CExpression {
    let expression = this.parseMultiplicative(depth + 1);
    while (this.at("+") || this.at("-")) {
      const operator = this.consume().value as "+" | "-";
      const right = this.parseMultiplicative(depth + 1);
      expression = combineBinary(expression, operator, right);
    }
    return expression;
  }

  private parseMultiplicative(depth: number): CExpression {
    let expression = this.parseUnary(depth + 1);
    while (this.at("*") || this.at("/") || this.at("%")) {
      const operator = this.consume().value as "%" | "*" | "/";
      const right = this.parseUnary(depth + 1);
      expression = combineBinary(expression, operator, right);
    }
    return expression;
  }

  private parseUnary(depth: number): CExpression {
    if (depth > maximumExpressionDepth)
      throw cError("expression nesting limit exceeded", this.current().span);
    if (this.at("alignof") || this.at("_Alignof")) {
      const start = this.consume();
      this.expect("(");
      if (!this.isTypeStart())
        throw cError(
          "alignof requires a declared object type",
          this.current().span,
        );
      const type = this.parseDeclaredType().type;
      const close = this.expect(")");
      if (type === "void" || isFunctionType(type))
        throw cError("alignof requires an object type", start.span);
      cTypeSizeUnits(type, start.span, this.dataModel);
      return {
        kind: "integer",
        span: { end: close.span.end, start: start.span.start },
        type: "int",
        value:
          cTypeAlignmentBytes(type, start.span, this.dataModel) /
          cAddressUnitBytes(this.dataModel),
      };
    }
    if (this.at("sizeof")) {
      const start = this.consume();
      let type: CType;
      let end: Cs486SourceSpan;
      if (this.at("(") && this.isTypeStart(1)) {
        this.consume();
        type = this.parseDeclaredType().type;
        const close = this.expect(")");
        end = close.span;
      } else {
        const operand = this.parseUnary(depth + 1);
        type = expressionType(operand);
        end = operand.span;
      }
      if (type === "void" || isFunctionType(type))
        throw cError("sizeof requires an object type", start.span);
      return {
        kind: "integer",
        span: { end: end.end, start: start.span.start },
        type: "int",
        value: cTypeSizeUnits(type, start.span, this.dataModel),
      };
    }
    if (this.at("(") && this.isTypeStart(1)) {
      const open = this.consume();
      const declaration = this.parseDeclaredType();
      let type = declaration.type;
      if (this.at("[")) type = this.parseArrayLayers(type, false);
      if (type === "void" || isFunctionType(type))
        throw cError("casts require a scalar object type", open.span);
      this.expect(")");
      if (this.at("{")) {
        if (!isArrayType(type) && !isAggregateType(type))
          throw cError(
            "compound literals require an array, struct, or union type",
            open.span,
          );
        const initializer = this.parseLocalAggregateInitializer(
          type,
          open.span,
        );
        const variable = this.declareCompoundLiteral(
          type,
          declaration.qualifiers,
          open.span,
        );
        return this.parsePostfixExpression(
          {
            initializer,
            kind: "compound",
            span: { end: this.previous().span.end, start: open.span.start },
            type,
            variable,
          },
          depth,
        );
      }
      const expression = this.parseUnary(depth + 1);
      requireScalarType(type, open.span);
      requireScalarType(
        decayCType(expressionType(expression)),
        expression.span,
      );
      return {
        expression,
        kind: "cast",
        span: { end: expression.span.end, start: open.span.start },
        type,
      };
    }
    if (
      this.at("+") ||
      this.at("-") ||
      this.at("!") ||
      this.at("~") ||
      this.at("&") ||
      this.at("*")
    ) {
      const operator = this.consume();
      const operand = this.parseUnary(depth + 1);
      const operation = operator.value as CUnaryOperator;
      if (operation === "&" && operand.kind === "function")
        return {
          ...operand,
          span: { end: operand.span.end, start: operator.span.start },
        };
      if (
        operation === "&" &&
        operand.kind === "member" &&
        operand.field.bitWidth !== undefined
      )
        throw cError("bit-fields do not have an address", operand.span);
      let type: CFunctionType | CObjectType;
      if (operation === "&") {
        if (!isLvalueExpression(operand))
          throw cError("address operand is not an lvalue", operand.span);
        type = { kind: "pointer", to: operand.type };
      } else if (operation === "*") {
        const pointer = decayCType(expressionType(operand));
        if (!isPointerType(pointer) || pointer.to === "void")
          throw cError("dereference requires a non-void pointer", operand.span);
        type = pointer.to;
      } else {
        const operandType = decayCType(expressionType(operand));
        if (operation === "!") {
          requireScalarType(operandType, operand.span);
          type = "int";
        } else if (isFloatingType(operandType)) {
          if (operation === "~")
            throw cError("integer operand required", operand.span);
          type = operandType;
        } else {
          requireIntegerType(operandType, operand.span);
          type = integerPromotion(operandType);
        }
      }
      return {
        kind: "unary",
        operand,
        operator: operation,
        span: { end: operand.span.end, start: operator.span.start },
        type,
      };
    }
    return this.parsePrimary(depth + 1);
  }

  private parsePrimary(depth: number): CExpression {
    if (depth > maximumExpressionDepth)
      throw cError("expression nesting limit exceeded", this.current().span);
    const token = this.current();
    let expression: CExpression;
    if (token.kind === "number") {
      this.consume();
      if (isFloatingLiteralToken(token.value)) {
        let literal: ReturnType<typeof parseCsFloatLiteral>;
        try {
          literal = parseCsFloatLiteral(token.value);
        } catch (error: unknown) {
          throw cError(
            error instanceof Error ? error.message : "invalid floating literal",
            token.span,
          );
        }
        expression = {
          ...(literal.format === "binary64"
            ? {
                highValue:
                  Number((literal.result.bits >> 32n) & 0xffff_ffffn) | 0,
              }
            : {}),
          kind: "floating",
          span: token.span,
          type: literal.format === "binary32" ? "float" : "double",
          value: Number(literal.result.bits & 0xffff_ffffn) | 0,
        };
      } else {
        const literal = parseIntegerLiteral(token);
        expression = {
          ...(literal.highValue === undefined
            ? {}
            : { highValue: literal.highValue }),
          kind: "integer",
          span: token.span,
          type: literal.type,
          value: literal.value,
        };
      }
    } else if (token.kind === "string") {
      const literal = this.consumeStringLiteral();
      const string = this.internString(literal);
      expression = {
        kind: "string",
        span: literal.span,
        symbol: string.symbol,
        type: { kind: "pointer", to: "char" },
        value: string.value,
      };
    } else if (token.kind === "identifier" && token.value === "__func__") {
      const context = this.currentFunction;
      if (context === undefined)
        throw cError(
          "__func__ is only available inside a function",
          token.span,
        );
      this.consume();
      const literal = this.internString({
        ...token,
        kind: "string",
        raw: JSON.stringify(context.symbol.name),
        value: context.symbol.name,
      });
      expression = {
        kind: "string",
        span: token.span,
        symbol: literal.symbol,
        type: { kind: "pointer", to: "char" },
        value: literal.value,
      };
    } else if (token.kind === "identifier") {
      this.consume();
      const variable = this.findVariable(token.value);
      if (variable !== undefined)
        expression = {
          kind: "variable",
          span: token.span,
          type: variable.type,
          variable,
        };
      else {
        const constant = this.enumConstants.get(token.value);
        const function_ = this.functions.get(token.value);
        if (constant !== undefined)
          expression = {
            kind: "integer",
            span: token.span,
            type: constant.type,
            value: constant.value,
          };
        else if (function_ !== undefined)
          expression = {
            kind: "function",
            span: token.span,
            symbol: function_,
            type: { kind: "pointer", to: functionTypeOfSymbol(function_) },
          };
        else if (this.at("("))
          throw cError(
            `undeclared function ${token.value}; functions must be declared before use`,
            token.span,
          );
        else throw cError(`undeclared identifier ${token.value}`, token.span);
      }
    } else if (this.take("(") !== undefined) {
      const open = this.previous();
      const nested = this.parseTernary(depth + 1);
      if (!this.at(")"))
        throw cError(
          "unbalanced parenthesized expression: expected ')'",
          this.current().span,
        );
      const close = this.consume();
      expression = {
        ...nested,
        span: { end: close.span.end, start: open.span.start },
      };
    } else throw cError("expected expression operand", token.span);

    return this.parsePostfixExpression(expression, depth);
  }

  private parsePostfixExpression(
    initial: CExpression,
    depth: number,
  ): CExpression {
    let expression = initial;
    while (true) {
      if (this.take("(") !== undefined) {
        const arguments_: CExpression[] = [];
        while (!this.at(")")) {
          if (arguments_.length >= maximumFunctionParameters)
            throw cError(
              "function argument limit exceeded",
              this.current().span,
            );
          arguments_.push(this.parseTernary(depth + 1));
          if (this.take(",") === undefined) break;
          if (this.at(")"))
            throw cError("expected argument after ','", this.current().span);
        }
        const close = this.expect(")");
        expression = this.createCallExpression(expression, arguments_, {
          end: close.span.end,
          start: expression.span.start,
        });
        continue;
      }
      if (this.take("[") !== undefined) {
        const index = this.parseExpression();
        requireIntegerType(decayCType(expressionType(index)), index.span);
        const close = this.expect("]");
        const pointer = decayCType(expressionType(expression));
        if (
          !isPointerType(pointer) ||
          pointer.to === "void" ||
          isFunctionType(pointer.to)
        )
          throw cError(
            "subscript requires a non-void pointer or array",
            expression.span,
          );
        expression = {
          base: expression,
          index,
          kind: "index",
          span: { end: close.span.end, start: expression.span.start },
          type: pointer.to,
        };
        continue;
      }
      const throughPointer = this.at("->");
      if (!throughPointer && !this.at(".")) break;
      this.consume();
      const name = this.expectName("struct field name");
      const baseType = expressionType(expression);
      const decayedBaseType = decayCType(baseType);
      const structType = throughPointer
        ? isPointerType(decayedBaseType)
          ? decayedBaseType.to
          : undefined
        : baseType;
      if (!isAggregateType(structType))
        throw cError(
          `${throughPointer ? "->" : "."} requires an aggregate ${throughPointer ? "pointer" : "object"}`,
          name.span,
        );
      const field = structType.fields.find(
        (candidate) => candidate.name === name.value,
      );
      if (field === undefined)
        throw cError(
          `${structType.kind} ${structType.name} has no field ${name.value}`,
          name.span,
        );
      expression = {
        base: expression,
        field,
        kind: "member",
        span: { end: name.span.end, start: expression.span.start },
        throughPointer,
        type: field.type,
      };
    }
    return expression;
  }

  private parseType(): CType {
    const token = this.current();
    if (token.value === "void") {
      this.consume();
      return "void";
    }
    if (isScalarTypeSpecifier(token)) return this.parseScalarType();
    if (token.value === "struct") return this.parseStructType();
    if (token.value === "union") return this.parseUnionType();
    if (token.value === "enum") return this.parseEnumType();
    const alias = this.typedefs.get(token.value);
    if (token.kind === "identifier" && alias !== undefined) {
      this.consume();
      return alias.type;
    }
    throw cError("expected a declared C type", token.span);
  }

  private parseScalarType(): CScalarType {
    const start = this.current();
    let signed = false;
    let unsigned = false;
    let char = false;
    let short = false;
    let int = false;
    let floating: CFloatingType | undefined;
    let longCount = 0;
    let count = 0;
    while (isScalarTypeSpecifier(this.current())) {
      const token = this.consume();
      count += 1;
      if (count > 4)
        throw cError("too many integer type specifiers", token.span);
      switch (token.value) {
        case "_Bool":
          if (count !== 1 || isScalarTypeSpecifier(this.current()))
            throw cError(
              "_Bool cannot combine with other type specifiers",
              token.span,
            );
          return "_Bool";
        case "float":
        case "double":
          if (floating !== undefined)
            throw cError("duplicate floating type specifier", token.span);
          floating = token.value;
          break;
        case "signed":
          if (signed || unsigned)
            throw cError("conflicting integer signedness", token.span);
          signed = true;
          break;
        case "unsigned":
          if (unsigned || signed)
            throw cError("conflicting integer signedness", token.span);
          unsigned = true;
          break;
        case "char":
          if (char) throw cError("duplicate char type specifier", token.span);
          char = true;
          break;
        case "short":
          if (short) throw cError("duplicate short type specifier", token.span);
          short = true;
          break;
        case "int":
          if (int) throw cError("duplicate int type specifier", token.span);
          int = true;
          break;
        case "long":
          longCount += 1;
          if (longCount > 2)
            throw cError("too many long type specifiers", token.span);
          break;
      }
    }
    if (floating !== undefined) {
      if (signed || unsigned || char || short || int)
        throw cError(
          "floating type cannot combine with integer type specifiers",
          start.span,
        );
      if (floating === "float" && longCount > 0)
        throw cError("float cannot combine with long", start.span);
      if (longCount > 1)
        throw cError("long double accepts at most one long", start.span);
      // The CS numeric profile deliberately aliases long double to binary64.
      return floating;
    }
    if (char) {
      if (short || int || longCount > 0)
        throw cError(
          "char cannot combine with short, int, or long",
          start.span,
        );
      return unsigned ? "unsigned char" : signed ? "signed char" : "char";
    }
    if (short) {
      if (longCount > 0)
        throw cError("short cannot combine with long", start.span);
      return unsigned ? "unsigned short" : "short";
    }
    if (longCount === 2) return unsigned ? "unsigned long long" : "long long";
    if (longCount === 1) return unsigned ? "unsigned long" : "long";
    return unsigned ? "unsigned int" : "int";
  }

  private parseTypedef(): void {
    const start = this.expect("typedef");
    const declaration = this.parseDeclaredType();
    const baseType = declaration.type;
    let name: CToken;
    let type: CObjectType;
    let qualifiers = declaration.qualifiers;
    if (this.isFunctionPointerDeclaratorStart()) {
      const declarator = this.parseFunctionPointerDeclarator(
        declaration,
        "typedef function-pointer name",
        true,
        false,
      );
      if (declarator.name === undefined)
        throw new Error("required typedef name was not parsed");
      name = declarator.name;
      type = declarator.type;
      qualifiers = declarator.qualifiers;
    } else {
      if (baseType === "void" || isFunctionType(baseType))
        throw cError(
          "typedef target cannot be bare void or function",
          start.span,
        );
      name = this.expectName("typedef name");
      type = this.parseArrayLayers(baseType, false);
    }
    this.expect(";");
    if (
      this.typedefs.has(name.value) ||
      this.functions.has(name.value) ||
      this.globals.has(name.value) ||
      this.enumConstants.has(name.value)
    )
      throw cError(`duplicate typedef ${name.value}`, name.span);
    if (this.typedefs.size >= 256)
      throw cError("typedef limit exceeded", name.span);
    this.typedefs.set(name.value, { qualifiers, type });
  }

  private isFunctionPointerDeclaratorStart(): boolean {
    return this.at("(") && this.peek(1).value === "*";
  }

  private parseFunctionPointerDeclarator(
    returnDeclaration: CDeclaredType,
    nameDescription: string,
    requireName: boolean,
    parameter: boolean,
  ): {
    readonly name?: CToken;
    readonly qualifiers: CQualifiers;
    readonly type: CObjectType;
  } {
    const open = this.expect("(");
    this.expect("*");
    const qualifiers = this.parseQualifiers();
    const name =
      this.current().kind === "identifier"
        ? this.expectName(nameDescription)
        : undefined;
    if (requireName && name === undefined)
      throw cError(`expected ${nameDescription}`, this.current().span);
    this.expect(")");
    this.expect("(");
    const parameters = this.parseParameterDeclarations();
    this.expect(")");
    const returnType = returnDeclaration.type;
    if (isFunctionType(returnType) || isArrayType(returnType))
      throw cError("function pointer has an invalid return type", open.span);
    if (isAggregateType(returnType))
      throw cError(
        "function pointers cannot return aggregates by value",
        open.span,
      );
    const functionType: CFunctionType = {
      kind: "function",
      parameterTypes: parameters.declarations.map(({ type }) => type),
      returnType,
      variadic: parameters.variadic,
    };
    return {
      ...(name === undefined ? {} : { name }),
      qualifiers,
      type: this.parseArrayLayers(
        { kind: "pointer", to: functionType },
        parameter,
      ),
    };
  }

  private parseStructType(): CStructType {
    const start = this.expect("struct");
    const name = this.expectName("struct tag");
    let type = this.structs.get(name.value);
    if (type === undefined) {
      if (this.structs.size >= 128)
        throw cError("struct tag limit exceeded", name.span);
      type = {
        alignmentBytes: 1,
        complete: false,
        fields: [],
        kind: "struct",
        name: name.value,
        sizeBytes: 0,
        span: { end: name.span.end, start: start.span.start },
      };
      this.structs.set(name.value, type);
    }
    if (this.take("{") === undefined) return type;
    if (type.complete)
      throw cError(`duplicate definition of struct ${name.value}`, name.span);
    let offsetBytes = 0;
    let maximumAlignmentBytes = 1;
    let bitOffset = 0;
    let declarations = 0;
    const fieldNames = new Set<string>();
    while (!this.at("}")) {
      if (declarations >= 64)
        throw cError("struct field limit exceeded", this.current().span);
      declarations += 1;
      if (!this.isTypeStart())
        throw cError("expected struct field declaration", this.current().span);
      const fieldDeclaration = this.parseDeclaredType();
      let fieldType = fieldDeclaration.type;
      if (fieldType === "void" || isFunctionType(fieldType))
        throw cError(
          "struct fields cannot have void or function type",
          this.current().span,
        );
      const fieldName = this.at(":")
        ? undefined
        : this.expectName("struct field name");
      const colon = this.take(":");
      const bitWidth =
        colon === undefined
          ? undefined
          : this.parseBitFieldWidth(fieldType, fieldName, colon);
      if (colon === undefined) {
        if (fieldName === undefined)
          throw cError("struct field requires a name", this.current().span);
        fieldType = this.parseArrayLayers(fieldType, false, true);
      }
      this.expect(";");
      if (fieldName !== undefined && fieldNames.has(fieldName.value))
        throw cError(
          `duplicate struct field ${fieldName.value}`,
          fieldName.span,
        );
      if (isArrayType(fieldType) && fieldType.flexible === true) {
        if (type.fields.length === 0)
          throw cError(
            "flexible array member requires a preceding named field",
            fieldName!.span,
          );
        if (!this.at("}"))
          throw cError(
            "flexible array member must be the final struct field",
            fieldName!.span,
          );
      }
      if (bitWidth !== undefined) {
        maximumAlignmentBytes = Math.max(maximumAlignmentBytes, 4);
        if (bitWidth === 0) {
          if (bitOffset !== 0) {
            offsetBytes += 4;
            bitOffset = 0;
          }
          offsetBytes = alignInteger(offsetBytes, 4);
          continue;
        }
        if (bitOffset === 0) offsetBytes = alignInteger(offsetBytes, 4);
        if (bitOffset + bitWidth > 32) {
          offsetBytes += 4;
          offsetBytes = alignInteger(offsetBytes, 4);
          bitOffset = 0;
        }
        if (fieldName !== undefined) {
          fieldNames.add(fieldName.value);
          type.fields.push({
            bitOffset,
            bitWidth,
            name: fieldName.value,
            offsetBytes,
            ...(hasQualifiers(fieldDeclaration.qualifiers)
              ? { qualifiers: fieldDeclaration.qualifiers }
              : {}),
            span: fieldName.span,
            type: fieldType,
          });
        }
        bitOffset += bitWidth;
        if (bitOffset === 32) {
          offsetBytes += 4;
          bitOffset = 0;
        }
        continue;
      }
      if (bitOffset !== 0) {
        offsetBytes += 4;
        bitOffset = 0;
      }
      const fieldAlignment = cTypeAlignmentBytes(
        fieldType,
        fieldName!.span,
        this.dataModel,
      );
      maximumAlignmentBytes = Math.max(maximumAlignmentBytes, fieldAlignment);
      offsetBytes = alignInteger(offsetBytes, fieldAlignment);
      fieldNames.add(fieldName!.value);
      type.fields.push({
        name: fieldName!.value,
        offsetBytes,
        ...(hasQualifiers(fieldDeclaration.qualifiers)
          ? { qualifiers: fieldDeclaration.qualifiers }
          : {}),
        span: fieldName!.span,
        type: fieldType,
      });
      offsetBytes += cTypeSizeBytes(fieldType, fieldName!.span, this.dataModel);
      if (offsetBytes > 65_536)
        throw cError("aggregate byte limit exceeded", fieldName!.span);
    }
    this.expect("}");
    if (type.fields.length === 0)
      throw cError("struct must contain at least one field", name.span);
    if (bitOffset !== 0) offsetBytes += 4;
    type.alignmentBytes = maximumAlignmentBytes;
    type.sizeBytes = alignInteger(offsetBytes, maximumAlignmentBytes);
    if (type.sizeBytes <= 0 || type.sizeBytes > 65_536)
      throw cError("aggregate byte limit exceeded", name.span);
    type.complete = true;
    return type;
  }

  private parseUnionType(): CUnionType {
    const start = this.expect("union");
    const name = this.expectName("union tag");
    let type = this.unions.get(name.value);
    if (type === undefined) {
      if (this.unions.size >= 128)
        throw cError("union tag limit exceeded", name.span);
      type = {
        alignmentBytes: 1,
        complete: false,
        fields: [],
        kind: "union",
        name: name.value,
        sizeBytes: 0,
        span: { end: name.span.end, start: start.span.start },
      };
      this.unions.set(name.value, type);
    }
    if (this.take("{") === undefined) return type;
    if (type.complete)
      throw cError(`duplicate definition of union ${name.value}`, name.span);
    let maximumBytes = 0;
    let maximumAlignmentBytes = 1;
    let declarations = 0;
    const fieldNames = new Set<string>();
    while (!this.at("}")) {
      if (declarations >= 64)
        throw cError("union field limit exceeded", this.current().span);
      declarations += 1;
      if (!this.isTypeStart())
        throw cError("expected union field declaration", this.current().span);
      const fieldDeclaration = this.parseDeclaredType();
      let fieldType = fieldDeclaration.type;
      if (fieldType === "void" || isFunctionType(fieldType))
        throw cError(
          "union fields cannot have void or function type",
          this.current().span,
        );
      const fieldName = this.at(":")
        ? undefined
        : this.expectName("union field name");
      const colon = this.take(":");
      const bitWidth =
        colon === undefined
          ? undefined
          : this.parseBitFieldWidth(fieldType, fieldName, colon);
      if (colon === undefined) {
        if (fieldName === undefined)
          throw cError("union field requires a name", this.current().span);
        fieldType = this.parseArrayLayers(fieldType, false);
      }
      this.expect(";");
      if (fieldName !== undefined && fieldNames.has(fieldName.value))
        throw cError(
          `duplicate union field ${fieldName.value}`,
          fieldName.span,
        );
      if (fieldName !== undefined) {
        fieldNames.add(fieldName.value);
        type.fields.push({
          ...(bitWidth === undefined ? {} : { bitOffset: 0, bitWidth }),
          name: fieldName.value,
          offsetBytes: 0,
          ...(hasQualifiers(fieldDeclaration.qualifiers)
            ? { qualifiers: fieldDeclaration.qualifiers }
            : {}),
          span: fieldName.span,
          type: fieldType,
        });
      }
      const fieldAlignment =
        bitWidth === undefined
          ? cTypeAlignmentBytes(fieldType, fieldName!.span, this.dataModel)
          : 4;
      maximumAlignmentBytes = Math.max(maximumAlignmentBytes, fieldAlignment);
      maximumBytes = Math.max(
        maximumBytes,
        bitWidth === undefined
          ? cTypeSizeBytes(fieldType, fieldName!.span, this.dataModel)
          : bitWidth === 0
            ? 0
            : 4,
      );
      if (maximumBytes > 65_536)
        throw cError(
          "aggregate byte limit exceeded",
          fieldName?.span ?? colon!.span,
        );
    }
    this.expect("}");
    if (type.fields.length === 0)
      throw cError("union must contain at least one field", name.span);
    type.alignmentBytes = maximumAlignmentBytes;
    type.sizeBytes = alignInteger(maximumBytes, maximumAlignmentBytes);
    type.complete = true;
    return type;
  }

  private parseBitFieldWidth(
    type: CType,
    name: CToken | undefined,
    colon: CToken,
  ): number {
    if (!isIntegerType(type) || isWideIntegerType(type))
      throw cError("bit-field type must be a one-word integer", colon.span);
    const expression = this.parseExpression();
    const width = evaluateCConstantExpression(expression);
    if (
      width === undefined ||
      !Number.isInteger(width) ||
      width < 0 ||
      width > 32
    )
      throw cError(
        "bit-field width must be an integer from 0 through 32",
        expression.span,
      );
    if (width === 0 && name !== undefined)
      throw cError("zero-width bit-field must be unnamed", name.span);
    if (type === "_Bool" && width > 1)
      throw cError("_Bool bit-field width cannot exceed 1", expression.span);
    return width;
  }

  private parseEnumType(): CScalarType {
    const start = this.expect("enum");
    const tag = this.expectName("enum tag");
    if (this.take("{") === undefined) {
      const existing = this.enumTags.get(tag.value);
      if (existing === undefined)
        throw cError(`incomplete enum ${tag.value}`, tag.span);
      return existing;
    }
    if (this.enumTags.has(tag.value))
      throw cError(`duplicate definition of enum ${tag.value}`, tag.span);
    if (this.enumTags.size >= 128)
      throw cError("enum tag limit exceeded", start.span);
    let nextValue = 0n;
    let count = 0;
    const names: string[] = [];
    let requiresUnsigned = false;
    while (!this.at("}")) {
      if (count >= 256)
        throw cError("enum constant limit exceeded", this.current().span);
      const name = this.expectName("enumerator");
      if (this.enumConstants.has(name.value))
        throw cError(`duplicate enumerator ${name.value}`, name.span);
      if (this.take("=") !== undefined) {
        const expression = this.parseExpression();
        const constant = evaluateCConstantInteger(expression);
        if (constant === undefined)
          throw cError(
            "enumerator requires a bounded integer constant expression",
            expression.span,
          );
        nextValue = constantIntegerNumericValue(constant);
      }
      if (nextValue < -0x8000_0000n || nextValue > 0xffff_ffffn)
        throw cError(
          "enumerator is outside the CS 32-bit enum range",
          name.span,
        );
      if (nextValue > 0x7fff_ffffn) requiresUnsigned = true;
      this.enumConstants.set(name.value, {
        type: nextValue > 0x7fff_ffffn ? "unsigned int" : "int",
        value: Number(BigInt.asUintN(32, nextValue)) | 0,
      });
      names.push(name.value);
      nextValue += 1n;
      count += 1;
      if (this.take(",") === undefined) break;
      if (this.at("}")) break;
    }
    this.expect("}");
    if (count === 0) throw cError("enum must contain a constant", tag.span);
    const type: CScalarType = requiresUnsigned ? "unsigned int" : "int";
    this.enumTags.set(tag.value, type);
    for (const name of names) {
      const constant = this.enumConstants.get(name)!;
      this.enumConstants.set(name, { ...constant, type });
    }
    return type;
  }

  private isTypeStart(offset = 0): boolean {
    let index = offset;
    while (isQualifierToken(this.peek(index))) index += 1;
    const token = this.peek(index);
    return (
      token.value === "void" ||
      isScalarTypeSpecifier(token) ||
      token.value === "struct" ||
      token.value === "union" ||
      token.value === "enum" ||
      (token.kind === "identifier" && this.typedefs.has(token.value))
    );
  }

  private parseDeclaredType(): CDeclaredType {
    let qualifiers = this.parseQualifiers();
    const aliasQualifiers = this.typedefs.get(this.current().value)?.qualifiers;
    let type = this.parseType();
    qualifiers = mergeQualifiers(
      qualifiers,
      aliasQualifiers ?? {},
      this.parseQualifiers(),
    );
    while (this.take("*") !== undefined) {
      requireValidQualifiers(type, qualifiers, this.previous().span);
      type = {
        kind: "pointer",
        to: type,
        ...(hasQualifiers(qualifiers) ? { toQualifiers: qualifiers } : {}),
      };
      qualifiers = this.parseQualifiers();
    }
    requireValidQualifiers(type, qualifiers, this.current().span);
    return { qualifiers, type };
  }

  private parseQualifiers(): CQualifiers {
    let qualifiers: CQualifiers = {};
    while (isQualifierToken(this.current())) {
      const token = this.consume();
      const qualifier = token.value as "const" | "restrict" | "volatile";
      if (qualifiers[qualifier] === true)
        throw cError(`duplicate ${qualifier} qualifier`, token.span);
      qualifiers = { ...qualifiers, [qualifier]: true };
    }
    return qualifiers;
  }

  private parseArrayLayers(
    type: CType,
    parameter: boolean,
    allowFlexible = false,
  ): CObjectType {
    if (type === "void" || isFunctionType(type))
      throw cError(
        "arrays cannot have void or function element type",
        this.current().span,
      );
    const dimensions: (number | undefined)[] = [];
    while (this.take("[") !== undefined) {
      const dimension = this.at("]")
        ? undefined
        : parsePositiveArrayLength(this.expectKind("number", "array length"));
      this.expect("]");
      if (
        !parameter &&
        dimension === undefined &&
        !(allowFlexible && dimensions.length === 0)
      )
        throw cError(
          "local arrays require a fixed length",
          this.previous().span,
        );
      dimensions.push(dimension);
      if (dimensions.length > 8)
        throw cError("array dimension limit exceeded", this.previous().span);
    }
    if (dimensions.length === 0) return type;
    let result: CObjectType = type;
    const innerStart = parameter ? 1 : 0;
    for (let index = dimensions.length - 1; index >= innerStart; index -= 1) {
      const length = dimensions[index];
      if (length === undefined && allowFlexible && index === 0) {
        result = { element: result, flexible: true, kind: "array", length: 0 };
        continue;
      }
      if (length === undefined)
        throw cError(
          "only the outer parameter array dimension may be omitted",
          this.previous().span,
        );
      result = { element: result, kind: "array", length };
    }
    return parameter ? { kind: "pointer", to: result } : result;
  }

  private declareVariable(
    name: CToken,
    type: CObjectType,
    qualifiers: CQualifiers = {},
  ): CVariable {
    const context = this.requireFunction();
    const scope = context.scopes.at(-1);
    if (scope === undefined)
      throw new Error("C variable declaration has no scope");
    const previous = scope.get(name.value);
    if (previous !== undefined)
      throw cError(
        `duplicate declaration of variable ${name.value}`,
        name.span,
        [
          {
            message: `${name.value} was first declared here`,
            span: previous.span,
          },
        ],
      );
    const words = cTypeStorageWords(type, name.span, this.dataModel);
    if (context.localCount + words > maximumLocalsPerFunction)
      throw cError("local variable limit exceeded", name.span);
    const variable: CVariable = {
      name: name.value,
      ...(hasQualifiers(qualifiers) ? { qualifiers } : {}),
      slot: context.localCount + 1,
      span: name.span,
      storage: "local",
      type,
      words,
    };
    context.localCount += words;
    scope.set(name.value, variable);
    return variable;
  }

  private declareCompoundLiteral(
    type: CArrayType | CAggregateType,
    qualifiers: CQualifiers,
    span: Cs486SourceSpan,
  ): CVariable {
    const context = this.requireFunction();
    const words = cTypeStorageWords(type, span, this.dataModel);
    if (context.localCount + words > maximumLocalsPerFunction)
      throw cError("local variable limit exceeded", span);
    const variable: CVariable = {
      name: `$compound${String(this.nextCompoundLiteral++)}`,
      ...(hasQualifiers(qualifiers) ? { qualifiers } : {}),
      slot: context.localCount + 1,
      span,
      storage: "local",
      type,
      words,
    };
    context.localCount += words;
    return variable;
  }

  private declareStaticVariable(
    name: CToken,
    type: CObjectType,
    qualifiers: CQualifiers,
    initializer: readonly CInitializerValue[] | undefined,
  ): CGlobalVariable {
    const context = this.requireFunction();
    const scope = context.scopes.at(-1);
    if (scope === undefined)
      throw new Error("C static variable declaration has no scope");
    const previous = scope.get(name.value);
    if (previous !== undefined)
      throw cError(
        `duplicate declaration of variable ${name.value}`,
        name.span,
        [
          {
            message: `${name.value} was first declared here`,
            span: previous.span,
          },
        ],
      );
    if (this.globals.size >= maximumGlobals)
      throw cError("global variable limit exceeded", name.span);
    const words = cTypeStorageWords(type, name.span, this.dataModel);
    const symbolName = `.L_static_${context.symbol.name}_${String(this.nextStaticLocal++)}_${name.value}`;
    const variable: CGlobalVariable = {
      defined: true,
      ...(initializer === undefined ? {} : { initializer }),
      linkage: "internal",
      name: symbolName,
      ...(hasQualifiers(qualifiers) ? { qualifiers } : {}),
      slot: 0,
      span: name.span,
      storage: "global",
      type,
      words,
    };
    this.globals.set(symbolName, variable);
    scope.set(name.value, variable);
    return variable;
  }

  private declareExternVariable(
    name: CToken,
    type: CObjectType,
    qualifiers: CQualifiers,
  ): CGlobalVariable {
    const context = this.requireFunction();
    const scope = context.scopes.at(-1);
    if (scope === undefined)
      throw new Error("C extern variable declaration has no scope");
    const previous = scope.get(name.value);
    if (previous !== undefined)
      throw cError(
        `duplicate declaration of variable ${name.value}`,
        name.span,
        [
          {
            message: `${name.value} was first declared here`,
            span: previous.span,
          },
        ],
      );
    const function_ = this.functions.get(name.value);
    if (function_ !== undefined)
      throw cError(
        `identifier ${name.value} is already a function`,
        name.span,
        [
          {
            message: `${name.value} was declared as a function here`,
            span: function_.firstSpan,
          },
        ],
      );
    const existing = this.globals.get(name.value);
    if (existing !== undefined) {
      if (!sameCType(existing.type, type))
        throw cError(`conflicting type for global ${name.value}`, name.span, [
          {
            message: `${name.value} was first declared here`,
            span: existing.span,
          },
        ]);
      if (!sameQualifiers(existing.qualifiers ?? {}, qualifiers))
        throw cError(
          `conflicting qualifiers for global ${name.value}`,
          name.span,
        );
      scope.set(name.value, existing);
      return existing;
    }
    if (this.globals.size >= maximumGlobals)
      throw cError("global variable limit exceeded", name.span);
    const variable: CGlobalVariable = {
      defined: false,
      linkage: "external",
      name: name.value,
      ...(hasQualifiers(qualifiers) ? { qualifiers } : {}),
      slot: 0,
      span: name.span,
      storage: "global",
      type,
      words: cTypeStorageWords(type, name.span, this.dataModel),
    };
    this.globals.set(name.value, variable);
    scope.set(name.value, variable);
    return variable;
  }

  private lookupVariable(name: CToken): CVariable {
    const variable = this.findVariable(name.value);
    if (variable !== undefined) return variable;
    throw cError(`undeclared identifier ${name.value}`, name.span);
  }

  private findVariable(name: string): CVariable | undefined {
    const context = this.currentFunction;
    if (context !== undefined) {
      for (let index = context.scopes.length - 1; index >= 0; index -= 1) {
        const variable = context.scopes[index]!.get(name);
        if (variable !== undefined) return variable;
      }
    }
    return this.globals.get(name);
  }

  private createCallExpression(
    callee: CExpression,
    arguments_: readonly CExpression[],
    span: Cs486SourceSpan,
  ): Extract<CExpression, { kind: "call" | "indirect-call" }> {
    const pointer = decayCType(expressionType(callee));
    if (!isPointerType(pointer) || !isFunctionType(pointer.to)) {
      if (callee.kind === "variable")
        throw cError(
          `called object ${callee.variable.name} is not a function`,
          span,
          [
            {
              message: `${callee.variable.name} was declared as a local variable here`,
              span: callee.variable.span,
            },
          ],
        );
      throw cError("called expression is not a function pointer", span);
    }
    const functionType = pointer.to;
    if (
      arguments_.length < functionType.parameterTypes.length ||
      (!functionType.variadic &&
        functionType.parameterTypes.length !== arguments_.length)
    )
      throw cError(
        `function pointer expects ${functionType.variadic ? "at least " : ""}${String(functionType.parameterTypes.length)} arguments, received ${String(arguments_.length)}`,
        span,
      );
    for (const [index, argument] of arguments_.entries()) {
      const parameterType = functionType.parameterTypes[index];
      if (parameterType === undefined)
        requireScalarType(decayCType(expressionType(argument)), argument.span);
      else requireExpressionAssignable(parameterType, argument);
    }
    const argumentWords = arguments_.reduce(
      (words, argument) => {
        const type = decayCType(expressionType(argument));
        if (type === "void" || isFunctionType(type))
          throw cError(
            "function argument requires an object value",
            argument.span,
          );
        return words + cTypeStorageWords(type, argument.span, this.dataModel);
      },
      functionType.variadic ? 1 : 0,
    );
    if (argumentWords > maximumFunctionParameters)
      throw cError("function argument word limit exceeded", span);
    if (callee.kind !== "function")
      return {
        arguments: arguments_,
        callee,
        functionType,
        kind: "indirect-call",
        returnType: functionType.returnType,
        span,
      };
    const function_ = callee.symbol;
    if (
      function_.name === csVaStartIntrinsic &&
      this.currentFunction?.symbol.variadic !== true
    )
      throw cError(
        `${csVaStartIntrinsic} may only be called from a variadic function`,
        span,
      );
    this.calls.push({
      argumentCount: arguments_.length,
      name: function_.name,
      span,
      valueRequired: true,
    });
    return {
      arguments: arguments_,
      kind: "call",
      name: function_.name,
      returnType: function_.returnType,
      span,
    };
  }

  private enterScope(): void {
    this.requireFunction().scopes.push(new Map());
  }

  private leaveScope(): void {
    const context = this.requireFunction();
    if (context.scopes.pop() === undefined)
      throw new Error("C scope stack underflow");
  }

  private enterLoop(): void {
    this.requireFunction().loopDepth += 1;
  }

  private leaveLoop(): void {
    const context = this.requireFunction();
    if (context.loopDepth <= 0) throw new Error("C loop depth underflow");
    context.loopDepth -= 1;
  }

  private enterSwitch(): void {
    this.requireFunction().switchFrames.push({
      hasDefault: false,
      values: new Set(),
    });
  }

  private leaveSwitch(): void {
    if (this.requireFunction().switchFrames.pop() === undefined)
      throw new Error("C switch frame stack underflow");
  }

  private requireFunction(): CFunctionContext {
    if (this.currentFunction === undefined)
      throw new Error("C statement parsed outside a function");
    return this.currentFunction;
  }

  private expect(value: string): CToken {
    const token = this.current();
    if (token.value !== value)
      throw cError(`expected ${JSON.stringify(value)}`, token.span);
    this.index += 1;
    return token;
  }

  private expectIdentifier(description: string): CToken {
    return this.expectKind("identifier", description);
  }

  private expectName(description: string): CToken {
    const token = this.expectIdentifier(description);
    if (reservedIdentifiers.has(token.value))
      throw cError(
        `${token.value} cannot be used as a ${description}`,
        token.span,
      );
    return token;
  }

  private expectKind(kind: CTokenKind, description: string): CToken {
    const token = this.current();
    if (token.kind !== kind)
      throw cError(`expected ${description}`, token.span);
    this.index += 1;
    return token;
  }

  private take(value: string): CToken | undefined {
    if (!this.at(value)) return undefined;
    return this.consume();
  }

  private at(value: string): boolean {
    return this.current().value === value;
  }

  private current(): CToken {
    return this.tokens[this.index] ?? this.tokens.at(-1)!;
  }

  private peek(offset: number): CToken {
    return this.tokens[this.index + offset] ?? this.tokens.at(-1)!;
  }

  private previous(): CToken {
    return this.tokens[Math.max(0, this.index - 1)]!;
  }

  private consume(): CToken {
    const token = this.current();
    if (token.kind !== "eof") this.index += 1;
    return token;
  }
}

function combineBinary(
  left: CExpression,
  operator: CBinaryOperator,
  right: CExpression,
): CExpression {
  const type = binaryExpressionType(left, operator, right);
  return {
    kind: "binary",
    left,
    operator,
    right,
    span: { end: right.span.end, start: left.span.start },
    type,
  };
}

function bitFieldMask(bitOffset: number, bitWidth: number): number {
  const widthMask = (1n << BigInt(bitWidth)) - 1n;
  return Number(BigInt.asUintN(32, widthMask << BigInt(bitOffset)));
}

function initializerIntegerExpression(
  value: CInitializerValue,
  span: Cs486SourceSpan,
): CExpression {
  if (isInitializerAtom(value)) {
    if (Array.isArray(value.value))
      throw cError("bit-field initializer requires a narrow integer", span);
    return initializerIntegerExpression(
      value.value as CExpression | number | string,
      span,
    );
  }
  if (typeof value === "string" || Array.isArray(value))
    throw cError("bit-field initializer requires an integer value", span);
  if (typeof value === "object") return value;
  return {
    kind: "integer",
    span,
    type: "unsigned int",
    value: value | 0,
  };
}

function isInitializerAtom(value: unknown): value is CInitializerAtom {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    "kind" in value &&
    value.kind === "initializer-atom"
  );
}

function isWideInitializerValue(
  value: CInitializerAtom["value"],
): value is readonly [low: number, high: number] {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    value.every((word: unknown) => typeof word === "number")
  );
}

function initializerAtomValue(
  value: CInitializerValue,
  span: Cs486SourceSpan,
): CInitializerValue {
  if (!isInitializerAtom(value)) return value;
  if (Array.isArray(value.value) && value.value.length !== 2)
    throw cError("invalid wide initializer", span);
  return value.value as CExpression | number | string;
}

function mergeBitFieldInitializer(
  existing: CInitializerValue,
  initialized: CInitializerValue,
  bitOffset: number,
  bitWidth: number,
  span: Cs486SourceSpan,
): CExpression | number {
  const mask = bitFieldMask(bitOffset, bitWidth);
  if (typeof existing === "number" && typeof initialized === "number") {
    const existingBits = BigInt.asUintN(32, BigInt(existing));
    const initializedBits = BigInt.asUintN(32, BigInt(initialized));
    const maskBits = BigInt(mask);
    return Number(
      BigInt.asIntN(
        32,
        (existingBits & ~maskBits) |
          ((initializedBits << BigInt(bitOffset)) & maskBits),
      ),
    );
  }
  const maskExpression: CExpression = {
    kind: "integer",
    span,
    type: "unsigned int",
    value: bitWidth === 32 ? -1 : ((1 << bitWidth) - 1) | 0,
  };
  let fragment = combineBinary(
    initializerIntegerExpression(initialized, span),
    "&",
    maskExpression,
  );
  if (bitOffset !== 0)
    fragment = combineBinary(fragment, "<<", {
      kind: "integer",
      span,
      type: "int",
      value: bitOffset,
    });
  if (existing === 0) return fragment;
  return combineBinary(
    initializerIntegerExpression(existing, span),
    "|",
    fragment,
  );
}

function sameTypes(
  left: readonly CObjectType[],
  right: readonly CObjectType[],
): boolean {
  return (
    left.length === right.length &&
    left.every((type, index) => sameCType(type, right[index]!))
  );
}

interface CIntermediateProgram {
  readonly inlineAssembly: ReadonlyMap<string, readonly CInlineInstruction[]>;
  readonly ir: Cs486IrProgram;
}

interface CWideIrValue {
  readonly high: Cs486IrValueId;
  readonly low: Cs486IrValueId;
}

interface MutableIrBlock {
  readonly id: string;
  readonly instructions: Cs486IrInstruction[];
  readonly phis: [];
  readonly span?: Cs486SourceSpan;
  terminator?: Cs486IrTerminator;
}

interface LoopContext {
  readonly breakTarget: string;
  readonly continueTarget: string;
}

/** Builds bounded, value-SSA CSIR with explicit mutable local slots. */
class CIntermediateBuilder {
  private readonly externals = new Map<string, Cs486IrExternalFunction>();
  private readonly inlineAssembly = new Map<
    string,
    readonly CInlineInstruction[]
  >();
  private blocks: MutableIrBlock[] = [];
  private readonly breakTargets: string[] = [];
  private readonly loopContexts: LoopContext[] = [];
  private currentBlock!: MutableIrBlock;
  private currentDefinition!: CFunctionDefinition;
  private instructionCount = 0;
  private readonly labelBlocks = new Map<string, string>();
  private nextBlock = 0;
  private nextSyntheticLocal = 0;
  private nextValue = 0;
  private syntheticLocals: Cs486IrLocal[] = [];
  private readonly valueTypes = new Map<Cs486IrValueId, Cs486IrValueType>();

  constructor(
    private readonly program: CProgram,
    private readonly optimizationLevel: 0 | 1,
  ) {}

  build(): CIntermediateProgram {
    for (const symbol of this.program.functions.values()) {
      if (symbol.definition !== undefined) continue;
      this.addExternal(
        symbol.name,
        symbol.parameterTypes.flatMap(cTypeToPhysicalIr),
        cTypeToIr(symbol.returnType),
        symbol.firstSpan,
        symbol.variadic,
        cFunctionSignature(functionTypeOfSymbol(symbol)),
        isWideValueType(symbol.returnType),
      );
    }
    const functions = this.program.definitions.map((definition) =>
      this.buildFunction(definition),
    );
    const raw: Cs486IrProgram = {
      dataModel: this.program.dataModel,
      externals: [...this.externals.values()],
      functions,
    };
    assertValidCs486Ir(raw, cIrLimits);
    if (this.optimizationLevel === 0) {
      return {
        inlineAssembly: new Map(this.inlineAssembly),
        ir: raw,
      };
    }
    const optimized = optimizeCs486IrWithReport(raw, cIrLimits);
    if (!optimized.converged) {
      const span =
        this.program.definitions[0]?.nameSpan ??
        this.program.functions.values().next().value?.firstSpan;
      if (span === undefined)
        throw new Error("C-family IR optimization has no source span");
      throw cError("bounded CSIR optimization did not converge", span);
    }
    assertValidCs486Ir(optimized.program, cIrLimits);
    return {
      inlineAssembly: new Map(this.inlineAssembly),
      ir: optimized.program,
    };
  }

  private buildFunction(definition: CFunctionDefinition): Cs486IrFunction {
    this.currentDefinition = definition;
    this.blocks = [];
    this.instructionCount = 0;
    this.nextBlock = 0;
    this.labelBlocks.clear();
    for (const statement of definition.body.statements)
      if (statement.kind === "label")
        this.labelBlocks.set(
          statement.name,
          `goto.label.${String(this.nextBlock++)}`,
        );
    let nextParameterId = 0;
    const parameters: Cs486IrParameter[] = definition.parameters.flatMap(
      (parameter) =>
        Array.from({ length: parameter.words }, (_, word) => {
          const id = nextParameterId++;
          return {
            id,
            name: `arg${String(id)}.${parameter.name}${word === 0 ? "" : `.high`}`,
            span: parameter.span,
            type: "i32" as const,
          };
        }),
    );
    this.nextValue = parameters.length;
    this.nextSyntheticLocal = 0;
    this.syntheticLocals = [];
    this.loopContexts.length = 0;
    this.breakTargets.length = 0;
    this.valueTypes.clear();
    const variables = collectFunctionVariables(definition);
    const locals: Cs486IrLocal[] = variables.flatMap((variable) =>
      Array.from({ length: variable.words }, (_, physicalWord) => ({
        // The stack grows downward, while C pointer arithmetic grows upward.
        // Reverse each aggregate's physical slots so word zero has the lowest
        // address and successive array/field words are at +4-byte offsets.
        name: irLocalWordName(variable, variable.words - physicalWord - 1),
        span: variable.span,
        type: "i32" as const,
      })),
    );
    this.currentBlock = this.createBlock("entry", definition.nameSpan);
    let physicalParameter = 0;
    for (const declaredParameter of definition.parameters) {
      for (let word = 0; word < declaredParameter.words; word += 1) {
        const parameter = parameters[physicalParameter++]!;
        this.valueTypes.set(parameter.id, parameter.type);
        this.emitStoreLocalRaw(
          irLocalWordName(declaredParameter, word),
          word === 0 && !isWideValueType(declaredParameter.type)
            ? this.normalizeCValue(
                parameter.id,
                declaredParameter.type,
                parameter.span ?? definition.nameSpan,
              )
            : parameter.id,
          parameter.span ?? definition.nameSpan,
        );
      }
    }
    this.emitBlock(definition.body);
    if (this.currentBlock.terminator === undefined) {
      if (definition.symbol.returnType === "void")
        this.terminate({ kind: "return", span: definition.body.span });
      else {
        const zero = this.emitConstant(0, definition.body.span);
        this.terminate(
          isWideValueType(definition.symbol.returnType)
            ? {
                kind: "return",
                span: definition.body.span,
                value: zero,
                valueHigh: zero,
              }
            : { kind: "return", span: definition.body.span, value: zero },
        );
      }
    }
    return {
      abiSignature: cFunctionSignature(functionTypeOfSymbol(definition.symbol)),
      blocks: this.blocks,
      entry: "entry",
      locals: [...locals, ...this.syntheticLocals],
      name: definition.symbol.name,
      parameters,
      returnType: cTypeToIr(definition.symbol.returnType),
      span: definition.nameSpan,
      variadic: definition.symbol.variadic,
      ...(isWideValueType(definition.symbol.returnType)
        ? { wideReturn: true }
        : {}),
    };
  }

  private emitBlock(block: CBlockStatement): void {
    for (let index = 0; index < block.statements.length; index += 1) {
      const statement = block.statements[index]!;
      if (
        this.currentBlock.terminator !== undefined &&
        statement.kind !== "label"
      )
        continue;
      if (statement.kind !== "inline-assembly") {
        this.emitStatement(statement);
        continue;
      }
      const instructions: CInlineInstruction[] = [];
      const span = statement.span;
      while (index < block.statements.length) {
        const candidate = block.statements[index];
        if (candidate?.kind !== "inline-assembly") break;
        instructions.push(...candidate.instructions);
        index += 1;
      }
      index -= 1;
      this.emitInlineAssembly(instructions, span);
    }
  }

  private emitStatement(statement: CStatement): void {
    switch (statement.kind) {
      case "block":
        this.emitBlock(statement);
        return;
      case "declaration":
        if (statement.aggregateInitializer !== undefined) {
          this.emitAggregateInitializer(
            statement.variable,
            statement.aggregateInitializer,
            statement.span,
          );
        } else if (statement.initializer !== undefined)
          if (statement.variable.type === "double")
            this.emitStoreWide(
              statement.variable,
              this.emitFloatingValue(statement.initializer, "double"),
              statement.span,
            );
          else if (isWideIntegerType(statement.variable.type))
            this.emitStoreWide(
              statement.variable,
              this.emitWideExpression(statement.initializer),
              statement.span,
            );
          else if (statement.variable.type === "float")
            this.emitStore(
              statement.variable,
              this.emitFloatingValue(statement.initializer, "float").low,
              statement.span,
            );
          else
            this.emitStore(
              statement.variable,
              this.emitExpression(statement.initializer),
              statement.span,
            );
        return;
      case "assignment":
        if (expressionType(statement.target) === "double")
          this.emitStoreWideTarget(
            statement.target,
            this.emitFloatingValue(statement.expression, "double"),
            statement.span,
          );
        else if (isWideIntegerType(expressionType(statement.target)))
          this.emitStoreWideTarget(
            statement.target,
            this.emitWideExpression(statement.expression),
            statement.span,
          );
        else if (expressionType(statement.target) === "float")
          this.emitStoreTarget(
            statement.target,
            this.emitFloatingValue(statement.expression, "float").low,
            statement.span,
          );
        else
          this.emitStoreTarget(
            statement.target,
            this.emitExpression(statement.expression),
            statement.span,
          );
        return;
      case "call":
        this.emitCall(statement.expression, statement.span);
        return;
      case "formatted-print":
        this.emitFormattedPrint(statement);
        return;
      case "print": {
        const value = this.coerceToI32(
          this.emitExpression(statement.expression),
          statement.span,
        );
        this.addExternal(printI32Intrinsic, ["i32"], "void", statement.span);
        this.emit({
          arguments: [value],
          callee: printI32Intrinsic,
          kind: "call",
          span: statement.span,
        });
        if (statement.newline) {
          this.addExternal(printNewlineIntrinsic, [], "void", statement.span);
          this.emit({
            arguments: [],
            callee: printNewlineIntrinsic,
            kind: "call",
            span: statement.span,
          });
        }
        return;
      }
      case "return": {
        if (
          statement.expression !== undefined &&
          this.currentDefinition.symbol.returnType === "double"
        ) {
          const value = this.emitFloatingValue(statement.expression, "double");
          this.terminate({
            kind: "return",
            span: statement.span,
            value: value.low,
            valueHigh: value.high,
          });
          return;
        }
        if (
          statement.expression !== undefined &&
          isWideIntegerType(this.currentDefinition.symbol.returnType)
        ) {
          const value = this.emitWideExpression(statement.expression);
          this.terminate({
            kind: "return",
            span: statement.span,
            value: value.low,
            valueHigh: value.high,
          });
          return;
        }
        const value =
          statement.expression === undefined
            ? undefined
            : this.currentDefinition.symbol.returnType === "float"
              ? this.emitFloatingValue(statement.expression, "float").low
              : this.normalizeCValue(
                  this.emitExpression(statement.expression),
                  this.currentDefinition.symbol.returnType,
                  statement.span,
                );
        this.terminate({ kind: "return", span: statement.span, value });
        return;
      }
      case "for":
        this.emitFor(statement);
        return;
      case "if":
        this.emitIf(statement);
        return;
      case "while":
        this.emitWhile(statement);
        return;
      case "do-while":
        this.emitDoWhile(statement);
        return;
      case "switch":
        this.emitSwitch(statement);
        return;
      case "case":
      case "default":
        throw new Error(
          `C ${statement.kind} label emitted outside switch dispatch`,
        );
      case "break": {
        const target = this.breakTargets.at(-1);
        if (target === undefined)
          throw new Error("C break statement lowered outside a loop/switch");
        this.terminate({ kind: "jump", span: statement.span, target });
        return;
      }
      case "continue": {
        const target = this.loopContexts.at(-1)?.continueTarget;
        if (target === undefined)
          throw new Error("C continue statement lowered outside a loop");
        this.terminate({ kind: "jump", span: statement.span, target });
        return;
      }
      case "goto": {
        const target = this.labelBlocks.get(statement.name);
        if (target === undefined)
          throw new Error(`C goto target ${statement.name} was not reserved`);
        this.terminate({ kind: "jump", span: statement.span, target });
        return;
      }
      case "label": {
        const target = this.labelBlocks.get(statement.name);
        if (target === undefined)
          throw new Error(`C label target ${statement.name} was not reserved`);
        if (this.currentBlock.terminator === undefined)
          this.terminate({
            kind: "jump",
            span: statement.span,
            target,
          });
        this.currentBlock = this.createBlockWithId(target, statement.span);
        return;
      }
      case "inline-assembly":
        this.emitInlineAssembly(statement.instructions, statement.span);
    }
  }

  private emitWideExpression(expression: CExpression): CWideIrValue {
    const type = decayCType(expressionType(expression));
    if (type === "double") return this.emitDoubleExpression(expression);
    if (!isWideValueType(type))
      return this.emitWideFromNarrow(expression, expression.span);
    switch (expression.kind) {
      case "floating":
        return {
          high: this.emitConstant(expression.highValue ?? 0, expression.span),
          low: this.emitConstant(expression.value, expression.span),
        };
      case "integer":
        return {
          high:
            expression.highValue === undefined
              ? this.emitConstant(
                  isUnsignedIntegerType(expression.type) ||
                    expression.value >= 0
                    ? 0
                    : -1,
                  expression.span,
                )
              : this.emitConstant(expression.highValue, expression.span),
          low: this.emitConstant(expression.value, expression.span),
        };
      case "variable":
        return this.emitLoadWideVariable(expression.variable, expression.span);
      case "index":
      case "member":
        return this.emitLoadWideAddress(
          this.emitAddress(expression),
          expression.span,
          lvalueQualifiers(expression).volatile === true,
        );
      case "unary":
        if (expression.operator === "*")
          return this.emitLoadWideAddress(
            this.emitExpressionAsI32(expression.operand),
            expression.span,
            lvalueQualifiers(expression).volatile === true,
          );
        if (expression.operator === "+")
          return this.emitWideExpression(expression.operand);
        if (expression.operator === "-")
          return this.emitWideNegate(
            this.emitWideExpression(expression.operand),
            expression.span,
          );
        if (expression.operator === "~") {
          const operand = this.emitWideExpression(expression.operand);
          return {
            high: this.emitUnaryOp(
              operand.high,
              "bit-not",
              "i32",
              expression.span,
            ),
            low: this.emitUnaryOp(
              operand.low,
              "bit-not",
              "i32",
              expression.span,
            ),
          };
        }
        throw cError(
          "logical wide expression must produce int",
          expression.span,
        );
      case "cast":
        if (
          isFloatingType(decayCType(expressionType(expression.expression))) &&
          isWideIntegerType(expression.type)
        )
          return this.emitFloatingToWideInteger(
            expression.expression,
            expression.type,
          );
        return isWideIntegerType(
          decayCType(expressionType(expression.expression)),
        )
          ? this.emitWideExpression(expression.expression)
          : this.emitWideFromNarrow(expression.expression, expression.span);
      case "binary":
        return this.emitWideBinary(expression);
      case "ternary":
        return this.emitWideTernary(expression);
      case "call":
      case "indirect-call":
        return this.emitWideCall(expression, expression.span);
      case "compound":
      case "function":
      case "string":
        throw cError(
          "expression does not produce a wide integer",
          expression.span,
        );
    }
  }

  private emitDoubleExpression(expression: CExpression): CWideIrValue {
    switch (expression.kind) {
      case "floating":
        return {
          high: this.emitConstant(expression.highValue ?? 0, expression.span),
          low: this.emitConstant(expression.value, expression.span),
        };
      case "variable":
        return this.emitLoadWideVariable(expression.variable, expression.span);
      case "index":
      case "member":
        return this.emitLoadWideAddress(
          this.emitAddress(expression),
          expression.span,
          lvalueQualifiers(expression).volatile === true,
        );
      case "unary":
        if (expression.operator === "*")
          return this.emitLoadWideAddress(
            this.emitExpressionAsI32(expression.operand),
            expression.span,
            lvalueQualifiers(expression).volatile === true,
          );
        if (expression.operator === "+")
          return this.emitFloatingValue(expression.operand, "double");
        if (expression.operator === "-") {
          const operand = this.emitFloatingValue(expression.operand, "double");
          return this.emitFloatingIntrinsic(
            "binary64",
            "neg",
            [operand.low, operand.high],
            expression.span,
            true,
          );
        }
        throw cError(
          "logical floating expression must produce int",
          expression.span,
        );
      case "cast":
        return this.emitFloatingValue(expression.expression, "double");
      case "binary":
        return this.emitFloatingBinary(expression, true);
      case "ternary":
        return this.emitWideTernary(expression);
      case "call":
      case "indirect-call":
        return this.emitWideCall(expression, expression.span);
      case "integer":
        return this.emitFloatingValue(expression, "double");
      case "compound":
      case "function":
      case "string":
        throw cError("expression does not produce double", expression.span);
    }
  }

  private emitFloatingValue(
    expression: CExpression,
    target: CFloatingType,
  ): CWideIrValue {
    const constant = evaluateCConstantFloating(expression, target);
    if (constant !== undefined)
      return {
        high: this.emitConstant(
          Number((constant >> 32n) & 0xffff_ffffn) | 0,
          expression.span,
        ),
        low: this.emitConstant(
          Number(constant & 0xffff_ffffn) | 0,
          expression.span,
        ),
      };
    const source = decayCType(expressionType(expression));
    const targetFormat = floatingFormat(target);
    if (source === target)
      return target === "double"
        ? this.emitDoubleExpression(expression)
        : {
            high: this.emitConstant(0, expression.span),
            low: this.emitExpression(expression),
          };
    if (isFloatingType(source)) {
      if (target === "double") {
        const value = this.emitExpression(expression);
        return this.emitFloatingIntrinsic(
          "binary32",
          "to.f64",
          [value],
          expression.span,
          true,
        );
      }
      const value = this.emitDoubleExpression(expression);
      return this.emitFloatingIntrinsic(
        "binary64",
        "to.f32",
        [value.low, value.high],
        expression.span,
        false,
      );
    }
    if (!isIntegerType(source))
      throw cError(
        "floating conversion requires an arithmetic value",
        expression.span,
      );
    const unsigned = isUnsignedIntegerType(source);
    if (isWideIntegerType(source)) {
      const value = this.emitWideExpression(expression);
      return this.emitFloatingIntrinsic(
        targetFormat,
        `from.i64.${unsigned ? "u" : "s"}`,
        [value.low, value.high],
        expression.span,
        target === "double",
      );
    }
    return this.emitFloatingIntrinsic(
      targetFormat,
      `from.i32.${unsigned ? "u" : "s"}`,
      [this.emitExpression(expression)],
      expression.span,
      target === "double",
    );
  }

  private emitFloatingBinary(
    expression: Extract<CExpression, { kind: "binary" }>,
    wideResult: boolean,
  ): CWideIrValue {
    const leftType = decayCType(expressionType(expression.left));
    const rightType = decayCType(expressionType(expression.right));
    const target: CFloatingType =
      leftType === "double" || rightType === "double" ? "double" : "float";
    const left = this.emitFloatingValue(expression.left, target);
    const right = this.emitFloatingValue(expression.right, target);
    const comparison = comparisonOperators.has(expression.operator);
    if (comparison) {
      const leftConstant = evaluateCConstantFloating(expression.left, target);
      const rightConstant = evaluateCConstantFloating(expression.right, target);
      if (leftConstant !== undefined && rightConstant !== undefined) {
        const value = csFloatCompare(
          floatingFormat(target),
          leftConstant,
          rightConstant,
          comparisonOperation(expression.operator),
        ).value;
        return {
          high: this.emitConstant(0, expression.span),
          low: this.emitConstant(value ? 1 : 0, expression.span),
        };
      }
    }
    const operation = comparison
      ? `compare.${comparisonOperation(expression.operator)}`
      : ({ "+": "add", "-": "sub", "*": "mul", "/": "div" } as const)[
          expression.operator as "+" | "-" | "*" | "/"
        ];
    if (operation === undefined)
      throw cError("unsupported floating operation", expression.span);
    return this.emitFloatingIntrinsic(
      floatingFormat(target),
      operation,
      target === "double"
        ? [left.low, left.high, right.low, right.high]
        : [left.low, right.low],
      expression.span,
      !comparison && wideResult,
    );
  }

  private emitFloatingToWideInteger(
    expression: CExpression,
    target: "long long" | "unsigned long long",
  ): CWideIrValue {
    const source = decayCType(expressionType(expression));
    if (!isFloatingType(source))
      throw cError(
        "floating conversion requires a floating source",
        expression.span,
      );
    const value = this.emitFloatingValue(expression, source);
    return this.emitFloatingIntrinsic(
      floatingFormat(source),
      `to.i64.${isUnsignedIntegerType(target) ? "u" : "s"}`,
      source === "double" ? [value.low, value.high] : [value.low],
      expression.span,
      true,
    );
  }

  private emitFloatingToNarrowInteger(
    expression: CExpression,
    target: CIntegerType,
  ): Cs486IrValueId {
    const source = decayCType(expressionType(expression));
    if (!isFloatingType(source))
      throw cError(
        "integer conversion requires a floating source",
        expression.span,
      );
    const value = this.emitFloatingValue(expression, source);
    const converted = this.emitFloatingIntrinsic(
      floatingFormat(source),
      `to.i32.${isUnsignedIntegerType(target) ? "u" : "s"}`,
      source === "double" ? [value.low, value.high] : [value.low],
      expression.span,
      false,
    ).low;
    return this.normalizeCValue(converted, target, expression.span);
  }

  private emitFloatingIntrinsic(
    format: CsFloatFormat,
    operation: string,
    arguments_: readonly Cs486IrValueId[],
    span: Cs486SourceSpan,
    wideResult: boolean,
  ): CWideIrValue {
    const name = `${floatIntrinsicPrefix}${format === "binary32" ? "f32" : "f64"}.${operation}`;
    this.addExternal(
      name,
      arguments_.map(() => "i32"),
      "i32",
      span,
      false,
      undefined,
      wideResult,
    );
    const result = this.newValue(span);
    const highLocal = wideResult ? this.newSyntheticLocal(span) : undefined;
    this.emit({
      arguments: arguments_,
      callee: name,
      kind: "call",
      result,
      span,
      type: "i32",
      ...(highLocal === undefined ? {} : { wideResultLocal: highLocal }),
    });
    this.valueTypes.set(result, "i32");
    return {
      high:
        highLocal === undefined
          ? this.emitConstant(0, span)
          : this.emitLoadLocalRaw(highLocal, span),
      low: result,
    };
  }

  private emitWideFromNarrow(
    expression: CExpression,
    span: Cs486SourceSpan,
  ): CWideIrValue {
    const value = this.emitExpression(expression);
    const source = decayCType(expressionType(expression));
    const unsigned = isIntegerType(source) && isUnsignedIntegerType(source);
    return {
      high: unsigned
        ? this.emitConstant(0, span)
        : this.emitBinaryOp(
            value,
            "shr",
            this.emitConstant(31, span),
            "i32",
            span,
          ),
      low: this.coerceToI32(value, span),
    };
  }

  private emitWideBinary(
    expression: Extract<CExpression, { kind: "binary" }>,
  ): CWideIrValue {
    const left = this.emitWideExpression(expression.left);
    const right = this.emitWideExpression(expression.right);
    switch (expression.operator) {
      case "+": {
        const low = this.emitBinaryOp(
          left.low,
          "add",
          right.low,
          "i32",
          expression.span,
        );
        const carry = this.coerceToI32(
          this.emitBinaryOp(low, "ult", left.low, "i1", expression.span),
          expression.span,
        );
        return {
          high: this.emitBinaryOp(
            this.emitBinaryOp(
              left.high,
              "add",
              right.high,
              "i32",
              expression.span,
            ),
            "add",
            carry,
            "i32",
            expression.span,
          ),
          low,
        };
      }
      case "-": {
        const borrow = this.coerceToI32(
          this.emitBinaryOp(left.low, "ult", right.low, "i1", expression.span),
          expression.span,
        );
        return {
          high: this.emitBinaryOp(
            this.emitBinaryOp(
              left.high,
              "sub",
              right.high,
              "i32",
              expression.span,
            ),
            "sub",
            borrow,
            "i32",
            expression.span,
          ),
          low: this.emitBinaryOp(
            left.low,
            "sub",
            right.low,
            "i32",
            expression.span,
          ),
        };
      }
      case "&":
      case "|":
      case "^": {
        const operator = { "&": "and", "^": "xor", "|": "or" } as const;
        return {
          high: this.emitBinaryOp(
            left.high,
            operator[expression.operator],
            right.high,
            "i32",
            expression.span,
          ),
          low: this.emitBinaryOp(
            left.low,
            operator[expression.operator],
            right.low,
            "i32",
            expression.span,
          ),
        };
      }
      case "*":
        return this.emitWideMultiply(left, right, expression.span);
      case "<<":
      case ">>":
        return this.emitWideShift(
          left,
          right.low,
          expression.operator,
          expression.type === "unsigned long long",
          expression.span,
        );
      case "/":
      case "%":
        return this.emitWideDivision(
          left,
          right,
          expression.operator,
          expression.type === "unsigned long long",
          expression.span,
        );
      default:
        throw cError(
          "comparison does not produce a wide integer",
          expression.span,
        );
    }
  }

  private emitWideNegate(
    value: CWideIrValue,
    span: Cs486SourceSpan,
  ): CWideIrValue {
    const low = this.emitUnaryOp(value.low, "neg", "i32", span);
    const borrow = this.coerceToI32(
      this.emitBinaryOp(
        value.low,
        "ne",
        this.emitConstant(0, span),
        "i1",
        span,
      ),
      span,
    );
    return {
      high: this.emitBinaryOp(
        this.emitUnaryOp(value.high, "bit-not", "i32", span),
        "add",
        this.emitBinaryOp(
          this.emitConstant(1, span),
          "sub",
          borrow,
          "i32",
          span,
        ),
        "i32",
        span,
      ),
      low,
    };
  }

  private emitWideMultiply(
    left: CWideIrValue,
    right: CWideIrValue,
    span: Cs486SourceSpan,
  ): CWideIrValue {
    const mask = this.emitConstant(0xffff, span);
    const shift = this.emitConstant(16, span);
    const left0 = this.emitBinaryOp(left.low, "and", mask, "i32", span);
    const left1 = this.emitBinaryOp(left.low, "ushr", shift, "i32", span);
    const right0 = this.emitBinaryOp(right.low, "and", mask, "i32", span);
    const right1 = this.emitBinaryOp(right.low, "ushr", shift, "i32", span);
    const product0 = this.emitBinaryOp(left0, "mul", right0, "i32", span);
    const product1 = this.emitBinaryOp(left0, "mul", right1, "i32", span);
    const product2 = this.emitBinaryOp(left1, "mul", right0, "i32", span);
    const carry = this.emitBinaryOp(
      this.emitBinaryOp(
        this.emitBinaryOp(product0, "ushr", shift, "i32", span),
        "add",
        this.emitBinaryOp(product1, "and", mask, "i32", span),
        "i32",
        span,
      ),
      "add",
      this.emitBinaryOp(product2, "and", mask, "i32", span),
      "i32",
      span,
    );
    let high = this.emitBinaryOp(left1, "mul", right1, "i32", span);
    for (const term of [
      this.emitBinaryOp(product1, "ushr", shift, "i32", span),
      this.emitBinaryOp(product2, "ushr", shift, "i32", span),
      this.emitBinaryOp(carry, "ushr", shift, "i32", span),
      this.emitBinaryOp(left.low, "mul", right.high, "i32", span),
      this.emitBinaryOp(left.high, "mul", right.low, "i32", span),
    ])
      high = this.emitBinaryOp(high, "add", term, "i32", span);
    return {
      high,
      low: this.emitBinaryOp(left.low, "mul", right.low, "i32", span),
    };
  }

  private emitWideTernary(
    expression: Extract<CExpression, { kind: "ternary" }>,
  ): CWideIrValue {
    const condition = this.emitCondition(expression.condition);
    const lowLocal = this.newSyntheticLocal(expression.span);
    const highLocal = this.newSyntheticLocal(expression.span);
    const trueBlock = this.createBlock("wide.ternary.true", expression.span);
    const falseBlock = this.createBlock("wide.ternary.false", expression.span);
    const doneBlock = this.createBlock("wide.ternary.done", expression.span);
    this.terminate({
      condition,
      falseTarget: falseBlock.id,
      kind: "branch",
      span: expression.span,
      trueTarget: trueBlock.id,
    });
    this.currentBlock = trueBlock;
    const whenTrue = this.emitWideExpression(expression.whenTrue);
    this.emitStoreLocalRaw(lowLocal, whenTrue.low, expression.span);
    this.emitStoreLocalRaw(highLocal, whenTrue.high, expression.span);
    this.terminate({
      kind: "jump",
      span: expression.span,
      target: doneBlock.id,
    });
    this.currentBlock = falseBlock;
    const whenFalse = this.emitWideExpression(expression.whenFalse);
    this.emitStoreLocalRaw(lowLocal, whenFalse.low, expression.span);
    this.emitStoreLocalRaw(highLocal, whenFalse.high, expression.span);
    this.terminate({
      kind: "jump",
      span: expression.span,
      target: doneBlock.id,
    });
    this.currentBlock = doneBlock;
    return {
      high: this.emitLoadLocalRaw(highLocal, expression.span),
      low: this.emitLoadLocalRaw(lowLocal, expression.span),
    };
  }

  private emitWideComparison(
    expression: Extract<CExpression, { kind: "binary" }>,
  ): Cs486IrValueId {
    const left = this.emitWideExpression(expression.left);
    const right = this.emitWideExpression(expression.right);
    const highEqual = this.emitBinaryOp(
      left.high,
      "eq",
      right.high,
      "i1",
      expression.span,
    );
    const lowEqual = this.emitBinaryOp(
      left.low,
      "eq",
      right.low,
      "i1",
      expression.span,
    );
    if (expression.operator === "==")
      return this.emitBinaryOp(
        highEqual,
        "logical-and",
        lowEqual,
        "i1",
        expression.span,
      );
    if (expression.operator === "!=") {
      const highNotEqual = this.emitBinaryOp(
        left.high,
        "ne",
        right.high,
        "i1",
        expression.span,
      );
      const lowNotEqual = this.emitBinaryOp(
        left.low,
        "ne",
        right.low,
        "i1",
        expression.span,
      );
      return this.emitBinaryOp(
        highNotEqual,
        "logical-or",
        lowNotEqual,
        "i1",
        expression.span,
      );
    }
    const leftType = decayCType(expressionType(expression.left));
    const rightType = decayCType(expressionType(expression.right));
    if (!isIntegerType(leftType) || !isIntegerType(rightType))
      throw cError(
        "wide comparison requires integer operands",
        expression.span,
      );
    const unsigned = isUnsignedIntegerType(
      usualArithmeticType(leftType, rightType),
    );
    const highOperator = (
      unsigned
        ? { "<": "ult", "<=": "ult", ">": "ugt", ">=": "ugt" }
        : { "<": "lt", "<=": "lt", ">": "gt", ">=": "gt" }
    )[expression.operator as ComparisonOperator] as Cs486IrBinaryOperator;
    const lowOperator = (
      {
        "<": "ult",
        "<=": "ule",
        ">": "ugt",
        ">=": "uge",
      } as const
    )[expression.operator as ComparisonOperator];
    const highComparison = this.emitBinaryOp(
      left.high,
      highOperator,
      right.high,
      "i1",
      expression.span,
    );
    const lowComparison = this.emitBinaryOp(
      left.low,
      lowOperator,
      right.low,
      "i1",
      expression.span,
    );
    return this.emitBinaryOp(
      highComparison,
      "logical-or",
      this.emitBinaryOp(
        highEqual,
        "logical-and",
        lowComparison,
        "i1",
        expression.span,
      ),
      "i1",
      expression.span,
    );
  }

  private emitWideShift(
    value: CWideIrValue,
    countValue: Cs486IrValueId,
    operator: "<<" | ">>",
    unsigned: boolean,
    span: Cs486SourceSpan,
  ): CWideIrValue {
    const lowLocal = this.newSyntheticLocal(span);
    const highLocal = this.newSyntheticLocal(span);
    const countLocal = this.newSyntheticLocal(span);
    this.emitStoreLocalRaw(lowLocal, value.low, span);
    this.emitStoreLocalRaw(highLocal, value.high, span);
    this.emitStoreLocalRaw(
      countLocal,
      this.emitBinaryOp(
        countValue,
        "and",
        this.emitConstant(63, span),
        "i32",
        span,
      ),
      span,
    );
    const condition = this.createBlock("wide.shift.condition", span);
    const body = this.createBlock("wide.shift.body", span);
    const exit = this.createBlock("wide.shift.exit", span);
    this.terminate({ kind: "jump", span, target: condition.id });
    this.currentBlock = condition;
    const count = this.emitLoadLocalRaw(countLocal, span);
    this.terminate({
      condition: this.emitBinaryOp(
        count,
        "ne",
        this.emitConstant(0, span),
        "i1",
        span,
      ),
      falseTarget: exit.id,
      kind: "branch",
      span,
      trueTarget: body.id,
    });
    this.currentBlock = body;
    const low = this.emitLoadLocalRaw(lowLocal, span);
    const high = this.emitLoadLocalRaw(highLocal, span);
    const one = this.emitConstant(1, span);
    if (operator === "<<") {
      this.emitStoreLocalRaw(
        highLocal,
        this.emitBinaryOp(
          this.emitBinaryOp(high, "shl", one, "i32", span),
          "or",
          this.emitBinaryOp(
            low,
            "ushr",
            this.emitConstant(31, span),
            "i32",
            span,
          ),
          "i32",
          span,
        ),
        span,
      );
      this.emitStoreLocalRaw(
        lowLocal,
        this.emitBinaryOp(low, "shl", one, "i32", span),
        span,
      );
    } else {
      this.emitStoreLocalRaw(
        lowLocal,
        this.emitBinaryOp(
          this.emitBinaryOp(low, "ushr", one, "i32", span),
          "or",
          this.emitBinaryOp(
            high,
            "shl",
            this.emitConstant(31, span),
            "i32",
            span,
          ),
          "i32",
          span,
        ),
        span,
      );
      this.emitStoreLocalRaw(
        highLocal,
        this.emitBinaryOp(high, unsigned ? "ushr" : "shr", one, "i32", span),
        span,
      );
    }
    this.emitStoreLocalRaw(
      countLocal,
      this.emitBinaryOp(count, "sub", one, "i32", span),
      span,
    );
    this.terminate({ kind: "jump", span, target: condition.id });
    this.currentBlock = exit;
    return {
      high: this.emitLoadLocalRaw(highLocal, span),
      low: this.emitLoadLocalRaw(lowLocal, span),
    };
  }

  private emitWideDivision(
    left: CWideIrValue,
    right: CWideIrValue,
    operator: "/" | "%",
    unsigned: boolean,
    span: Cs486SourceSpan,
  ): CWideIrValue {
    const leftLowLocal = this.newSyntheticLocal(span);
    const leftHighLocal = this.newSyntheticLocal(span);
    const rightLowLocal = this.newSyntheticLocal(span);
    const rightHighLocal = this.newSyntheticLocal(span);
    this.emitStoreLocalRaw(leftLowLocal, left.low, span);
    this.emitStoreLocalRaw(leftHighLocal, left.high, span);
    this.emitStoreLocalRaw(rightLowLocal, right.low, span);
    this.emitStoreLocalRaw(rightHighLocal, right.high, span);
    if (unsigned) {
      const divided = this.emitWideUnsignedDivMod(
        {
          high: this.emitLoadLocalRaw(leftHighLocal, span),
          low: this.emitLoadLocalRaw(leftLowLocal, span),
        },
        {
          high: this.emitLoadLocalRaw(rightHighLocal, span),
          low: this.emitLoadLocalRaw(rightLowLocal, span),
        },
        span,
      );
      return operator === "/" ? divided.quotient : divided.remainder;
    }
    const leftMask = this.emitBinaryOp(
      this.emitLoadLocalRaw(leftHighLocal, span),
      "shr",
      this.emitConstant(31, span),
      "i32",
      span,
    );
    const rightMask = this.emitBinaryOp(
      this.emitLoadLocalRaw(rightHighLocal, span),
      "shr",
      this.emitConstant(31, span),
      "i32",
      span,
    );
    const quotientMaskLocal = this.newSyntheticLocal(span);
    const remainderMaskLocal = this.newSyntheticLocal(span);
    this.emitStoreLocalRaw(
      quotientMaskLocal,
      this.emitBinaryOp(leftMask, "xor", rightMask, "i32", span),
      span,
    );
    this.emitStoreLocalRaw(remainderMaskLocal, leftMask, span);
    const absoluteLeft = this.emitWideApplySignMask(
      {
        high: this.emitLoadLocalRaw(leftHighLocal, span),
        low: this.emitLoadLocalRaw(leftLowLocal, span),
      },
      leftMask,
      span,
    );
    const absoluteRight = this.emitWideApplySignMask(
      {
        high: this.emitLoadLocalRaw(rightHighLocal, span),
        low: this.emitLoadLocalRaw(rightLowLocal, span),
      },
      rightMask,
      span,
    );
    const divided = this.emitWideUnsignedDivMod(
      absoluteLeft,
      absoluteRight,
      span,
    );
    return operator === "/"
      ? this.emitWideApplySignMask(
          divided.quotient,
          this.emitLoadLocalRaw(quotientMaskLocal, span),
          span,
        )
      : this.emitWideApplySignMask(
          divided.remainder,
          this.emitLoadLocalRaw(remainderMaskLocal, span),
          span,
        );
  }

  private emitWideApplySignMask(
    value: CWideIrValue,
    mask: Cs486IrValueId,
    span: Cs486SourceSpan,
  ): CWideIrValue {
    const low = this.emitBinaryOp(value.low, "xor", mask, "i32", span);
    const high = this.emitBinaryOp(value.high, "xor", mask, "i32", span);
    const increment = this.emitBinaryOp(
      mask,
      "and",
      this.emitConstant(1, span),
      "i32",
      span,
    );
    const incrementedLow = this.emitBinaryOp(
      low,
      "add",
      increment,
      "i32",
      span,
    );
    const lowLocal = this.newSyntheticLocal(span);
    const highLocal = this.newSyntheticLocal(span);
    this.emitStoreLocalRaw(lowLocal, incrementedLow, span);
    this.emitStoreLocalRaw(highLocal, high, span);
    const carry = this.coerceToI32(
      this.emitBinaryOp(incrementedLow, "ult", low, "i1", span),
      span,
    );
    return {
      high: this.emitBinaryOp(
        this.emitLoadLocalRaw(highLocal, span),
        "add",
        carry,
        "i32",
        span,
      ),
      low: this.emitLoadLocalRaw(lowLocal, span),
    };
  }

  private emitWideUnsignedDivMod(
    dividend: CWideIrValue,
    divisor: CWideIrValue,
    span: Cs486SourceSpan,
  ): { readonly quotient: CWideIrValue; readonly remainder: CWideIrValue } {
    const zero = this.emitConstant(0, span);
    const divisorZero = this.emitBinaryOp(
      this.emitBinaryOp(divisor.low, "or", divisor.high, "i32", span),
      "eq",
      zero,
      "i1",
      span,
    );
    const fault = this.createBlock("wide.divide.zero", span);
    const initialize = this.createBlock("wide.divide.initialize", span);
    this.terminate({
      condition: divisorZero,
      falseTarget: initialize.id,
      kind: "branch",
      span,
      trueTarget: fault.id,
    });
    this.currentBlock = fault;
    const faultValue = this.emitBinaryOp(
      this.emitConstant(1, span),
      "div",
      this.emitConstant(0, span),
      "i32",
      span,
    );
    this.terminate({
      condition: this.emitBinaryOp(
        faultValue,
        "ne",
        this.emitConstant(0, span),
        "i1",
        span,
      ),
      falseTarget: initialize.id,
      kind: "branch",
      span,
      trueTarget: initialize.id,
    });
    this.currentBlock = initialize;

    const dividendLow = this.newSyntheticLocal(span);
    const dividendHigh = this.newSyntheticLocal(span);
    const divisorLow = this.newSyntheticLocal(span);
    const divisorHigh = this.newSyntheticLocal(span);
    const quotientLow = this.newSyntheticLocal(span);
    const quotientHigh = this.newSyntheticLocal(span);
    const remainderLow = this.newSyntheticLocal(span);
    const remainderHigh = this.newSyntheticLocal(span);
    const countLocal = this.newSyntheticLocal(span);
    this.emitStoreLocalRaw(dividendLow, dividend.low, span);
    this.emitStoreLocalRaw(dividendHigh, dividend.high, span);
    this.emitStoreLocalRaw(divisorLow, divisor.low, span);
    this.emitStoreLocalRaw(divisorHigh, divisor.high, span);
    for (const local of [
      quotientLow,
      quotientHigh,
      remainderLow,
      remainderHigh,
    ])
      this.emitStoreLocalRaw(local, zero, span);
    this.emitStoreLocalRaw(countLocal, this.emitConstant(64, span), span);

    const condition = this.createBlock("wide.divide.condition", span);
    const body = this.createBlock("wide.divide.body", span);
    const subtract = this.createBlock("wide.divide.subtract", span);
    const next = this.createBlock("wide.divide.next", span);
    const exit = this.createBlock("wide.divide.exit", span);
    this.terminate({ kind: "jump", span, target: condition.id });
    this.currentBlock = condition;
    const count = this.emitLoadLocalRaw(countLocal, span);
    this.terminate({
      condition: this.emitBinaryOp(count, "ne", zero, "i1", span),
      falseTarget: exit.id,
      kind: "branch",
      span,
      trueTarget: body.id,
    });
    this.currentBlock = body;
    const currentDividend: CWideIrValue = {
      high: this.emitLoadLocalRaw(dividendHigh, span),
      low: this.emitLoadLocalRaw(dividendLow, span),
    };
    const currentRemainder: CWideIrValue = {
      high: this.emitLoadLocalRaw(remainderHigh, span),
      low: this.emitLoadLocalRaw(remainderLow, span),
    };
    const currentQuotient: CWideIrValue = {
      high: this.emitLoadLocalRaw(quotientHigh, span),
      low: this.emitLoadLocalRaw(quotientLow, span),
    };
    const currentDivisor: CWideIrValue = {
      high: this.emitLoadLocalRaw(divisorHigh, span),
      low: this.emitLoadLocalRaw(divisorLow, span),
    };
    const dividendBit = this.emitBinaryOp(
      currentDividend.high,
      "ushr",
      this.emitConstant(31, span),
      "i32",
      span,
    );
    const shiftedDividend = this.emitWideShiftOneLeft(currentDividend, span);
    const shiftedRemainder = this.emitWideShiftOneLeft(currentRemainder, span);
    const admittedRemainder: CWideIrValue = {
      high: shiftedRemainder.high,
      low: this.emitBinaryOp(
        shiftedRemainder.low,
        "or",
        dividendBit,
        "i32",
        span,
      ),
    };
    const shiftedQuotient = this.emitWideShiftOneLeft(currentQuotient, span);
    this.emitStoreLocalRaw(dividendLow, shiftedDividend.low, span);
    this.emitStoreLocalRaw(dividendHigh, shiftedDividend.high, span);
    this.emitStoreLocalRaw(remainderLow, admittedRemainder.low, span);
    this.emitStoreLocalRaw(remainderHigh, admittedRemainder.high, span);
    this.emitStoreLocalRaw(quotientLow, shiftedQuotient.low, span);
    this.emitStoreLocalRaw(quotientHigh, shiftedQuotient.high, span);
    this.terminate({
      condition: this.emitWideUnsignedGreaterEqual(
        admittedRemainder,
        currentDivisor,
        span,
      ),
      falseTarget: next.id,
      kind: "branch",
      span,
      trueTarget: subtract.id,
    });
    this.currentBlock = subtract;
    const difference = this.emitWideSubtract(
      admittedRemainder,
      currentDivisor,
      span,
    );
    this.emitStoreLocalRaw(remainderLow, difference.low, span);
    this.emitStoreLocalRaw(remainderHigh, difference.high, span);
    this.emitStoreLocalRaw(
      quotientLow,
      this.emitBinaryOp(
        shiftedQuotient.low,
        "or",
        this.emitConstant(1, span),
        "i32",
        span,
      ),
      span,
    );
    this.terminate({ kind: "jump", span, target: next.id });
    this.currentBlock = next;
    this.emitStoreLocalRaw(
      countLocal,
      this.emitBinaryOp(count, "sub", this.emitConstant(1, span), "i32", span),
      span,
    );
    this.terminate({ kind: "jump", span, target: condition.id });
    this.currentBlock = exit;
    return {
      quotient: {
        high: this.emitLoadLocalRaw(quotientHigh, span),
        low: this.emitLoadLocalRaw(quotientLow, span),
      },
      remainder: {
        high: this.emitLoadLocalRaw(remainderHigh, span),
        low: this.emitLoadLocalRaw(remainderLow, span),
      },
    };
  }

  private emitWideShiftOneLeft(
    value: CWideIrValue,
    span: Cs486SourceSpan,
  ): CWideIrValue {
    return {
      high: this.emitBinaryOp(
        this.emitBinaryOp(
          value.high,
          "shl",
          this.emitConstant(1, span),
          "i32",
          span,
        ),
        "or",
        this.emitBinaryOp(
          value.low,
          "ushr",
          this.emitConstant(31, span),
          "i32",
          span,
        ),
        "i32",
        span,
      ),
      low: this.emitBinaryOp(
        value.low,
        "shl",
        this.emitConstant(1, span),
        "i32",
        span,
      ),
    };
  }

  private emitWideUnsignedGreaterEqual(
    left: CWideIrValue,
    right: CWideIrValue,
    span: Cs486SourceSpan,
  ): Cs486IrValueId {
    const highGreater = this.emitBinaryOp(
      left.high,
      "ugt",
      right.high,
      "i1",
      span,
    );
    const highEqual = this.emitBinaryOp(
      left.high,
      "eq",
      right.high,
      "i1",
      span,
    );
    const lowGreaterEqual = this.emitBinaryOp(
      left.low,
      "uge",
      right.low,
      "i1",
      span,
    );
    return this.emitBinaryOp(
      highGreater,
      "logical-or",
      this.emitBinaryOp(highEqual, "logical-and", lowGreaterEqual, "i1", span),
      "i1",
      span,
    );
  }

  private emitWideSubtract(
    left: CWideIrValue,
    right: CWideIrValue,
    span: Cs486SourceSpan,
  ): CWideIrValue {
    const borrow = this.coerceToI32(
      this.emitBinaryOp(left.low, "ult", right.low, "i1", span),
      span,
    );
    return {
      high: this.emitBinaryOp(
        this.emitBinaryOp(left.high, "sub", right.high, "i32", span),
        "sub",
        borrow,
        "i32",
        span,
      ),
      low: this.emitBinaryOp(left.low, "sub", right.low, "i32", span),
    };
  }

  private emitFormattedPrint(
    statement: Extract<CStatement, { readonly kind: "formatted-print" }>,
  ): void {
    for (const part of statement.parts) {
      if (part.kind === "literal") {
        for (const character of part.value) {
          const value = this.emitConstant(
            character.codePointAt(0)!,
            statement.span,
          );
          this.addExternal(
            printCharacterIntrinsic,
            ["i32"],
            "void",
            statement.span,
          );
          this.emit({
            arguments: [value],
            callee: printCharacterIntrinsic,
            kind: "call",
            span: statement.span,
          });
        }
        continue;
      }
      const value = this.coerceToI32(
        this.emitExpression(part.expression),
        part.expression.span,
      );
      const callee =
        part.conversion === "d"
          ? printI32Intrinsic
          : part.conversion === "c"
            ? printCharacterIntrinsic
            : printStringIntrinsic;
      this.addExternal(callee, ["i32"], "void", part.expression.span);
      this.emit({
        arguments: [value],
        callee,
        kind: "call",
        span: part.expression.span,
      });
    }
  }

  private emitIf(statement: Extract<CStatement, { kind: "if" }>): void {
    const condition = this.emitCondition(statement.condition);
    const thenBlock = this.createBlock("if.then", statement.thenBranch.span);
    const exitBlock = this.createBlock("if.exit", statement.span);
    const elseBlock =
      statement.elseBranch === undefined
        ? undefined
        : this.createBlock("if.else", statement.elseBranch.span);
    this.terminate({
      condition,
      falseTarget: (elseBlock ?? exitBlock).id,
      kind: "branch",
      span: statement.span,
      trueTarget: thenBlock.id,
    });

    this.currentBlock = thenBlock;
    this.emitBlock(statement.thenBranch);
    if (this.currentBlock.terminator === undefined)
      this.terminate({
        kind: "jump",
        span: statement.span,
        target: exitBlock.id,
      });

    if (elseBlock !== undefined) {
      this.currentBlock = elseBlock;
      this.emitBlock(statement.elseBranch!);
      if (this.currentBlock.terminator === undefined)
        this.terminate({
          kind: "jump",
          span: statement.span,
          target: exitBlock.id,
        });
    }
    this.currentBlock = exitBlock;
  }

  private emitWhile(statement: Extract<CStatement, { kind: "while" }>): void {
    const conditionBlock = this.createBlock("while.condition", statement.span);
    const bodyBlock = this.createBlock("while.body", statement.body.span);
    const exitBlock = this.createBlock("while.exit", statement.span);
    this.terminate({
      kind: "jump",
      span: statement.span,
      target: conditionBlock.id,
    });

    this.currentBlock = conditionBlock;
    const condition = this.emitCondition(statement.condition);
    this.terminate({
      condition,
      falseTarget: exitBlock.id,
      kind: "branch",
      span: statement.span,
      trueTarget: bodyBlock.id,
    });

    this.currentBlock = bodyBlock;
    this.pushLoop(exitBlock.id, conditionBlock.id);
    this.emitBlock(statement.body);
    this.popLoop();
    if (this.currentBlock.terminator === undefined)
      this.terminate({
        kind: "jump",
        span: statement.span,
        target: conditionBlock.id,
      });
    this.currentBlock = exitBlock;
  }

  private emitDoWhile(
    statement: Extract<CStatement, { kind: "do-while" }>,
  ): void {
    const bodyBlock = this.createBlock("do.body", statement.body.span);
    const conditionBlock = this.createBlock("do.condition", statement.span);
    const exitBlock = this.createBlock("do.exit", statement.span);
    this.terminate({
      kind: "jump",
      span: statement.span,
      target: bodyBlock.id,
    });

    this.currentBlock = bodyBlock;
    this.pushLoop(exitBlock.id, conditionBlock.id);
    this.emitBlock(statement.body);
    this.popLoop();
    if (this.currentBlock.terminator === undefined)
      this.terminate({
        kind: "jump",
        span: statement.span,
        target: conditionBlock.id,
      });

    this.currentBlock = conditionBlock;
    const condition = this.emitCondition(statement.condition);
    this.terminate({
      condition,
      falseTarget: exitBlock.id,
      kind: "branch",
      span: statement.span,
      trueTarget: bodyBlock.id,
    });
    this.currentBlock = exitBlock;
  }

  private emitSwitch(statement: Extract<CStatement, { kind: "switch" }>): void {
    const bodyStatements = statement.body.statements;
    const labelBlocks = new Map<CStatement, MutableIrBlock>();
    const caseLabels: {
      readonly block: MutableIrBlock;
      readonly value: number;
    }[] = [];
    let defaultBlock: MutableIrBlock | undefined;
    for (const child of bodyStatements) {
      if (child.kind === "case") {
        const block = this.createBlock("switch.case", child.span);
        labelBlocks.set(child, block);
        caseLabels.push({ block, value: child.value });
      } else if (child.kind === "default") {
        const block = this.createBlock("switch.default", child.span);
        labelBlocks.set(child, block);
        defaultBlock = block;
      }
    }
    const exitBlock = this.createBlock("switch.exit", statement.span);

    const discriminant = this.emitExpressionAsI32(statement.expression);
    const discriminantLocal = this.newSyntheticLocal(statement.span);
    this.emitStoreLocalRaw(discriminantLocal, discriminant, statement.span);

    for (const label of caseLabels) {
      const left = this.emitLoadLocalRaw(discriminantLocal, statement.span);
      const right = this.emitConstant(label.value, statement.span);
      const comparison = this.emitBinaryOp(
        left,
        "eq",
        right,
        "i1",
        statement.span,
      );
      const nextDispatch = this.createBlock("switch.dispatch", statement.span);
      this.terminate({
        condition: comparison,
        falseTarget: nextDispatch.id,
        kind: "branch",
        span: statement.span,
        trueTarget: label.block.id,
      });
      this.currentBlock = nextDispatch;
    }
    this.terminate({
      kind: "jump",
      span: statement.span,
      target: (defaultBlock ?? exitBlock).id,
    });

    this.pushBreak(exitBlock.id);
    let entered = false;
    for (const child of bodyStatements) {
      if (child.kind === "case" || child.kind === "default") {
        const block = labelBlocks.get(child)!;
        if (this.currentBlock.terminator === undefined)
          this.terminate({ kind: "jump", span: child.span, target: block.id });
        this.currentBlock = block;
        entered = true;
        continue;
      }
      if (!entered)
        throw cError(
          "a statement before the first case/default label is not supported",
          child.span,
        );
      if (this.currentBlock.terminator !== undefined) continue;
      this.emitStatement(child);
    }
    if (this.currentBlock.terminator === undefined)
      this.terminate({
        kind: "jump",
        span: statement.span,
        target: exitBlock.id,
      });
    this.popBreak();
    this.currentBlock = exitBlock;
  }

  private emitFor(
    statement: Extract<CStatement, { readonly kind: "for" }>,
  ): void {
    this.emitStatement(statement.initializer);
    const condition = this.createBlock("for.condition", statement.span);
    const body = this.createBlock("for.body", statement.body.span);
    const increment = this.createBlock("for.increment", statement.span);
    const exit = this.createBlock("for.exit", statement.span);
    this.terminate({
      kind: "jump",
      span: statement.span,
      target: condition.id,
    });

    this.currentBlock = condition;
    const variable = this.emitLoad(statement.variable, statement.span);
    const bound = this.emitExpressionAsI32(statement.bound);
    const comparison = this.emitBinaryOp(
      variable,
      comparisonToIr(statement.comparison),
      bound,
      "i1",
      statement.span,
    );
    this.terminate({
      condition: comparison,
      falseTarget: exit.id,
      kind: "branch",
      span: statement.span,
      trueTarget: body.id,
    });

    this.currentBlock = body;
    this.pushLoop(exit.id, increment.id);
    this.emitBlock(statement.body);
    this.popLoop();
    if (this.currentBlock.terminator === undefined)
      this.terminate({
        kind: "jump",
        span: statement.span,
        target: increment.id,
      });

    this.currentBlock = increment;
    const previous = this.emitLoad(statement.variable, statement.span);
    const incrementValue = this.emitConstant(
      statement.increment,
      statement.span,
    );
    const next = this.emitBinaryOp(
      previous,
      "add",
      incrementValue,
      "i32",
      statement.span,
    );
    this.emitStore(statement.variable, next, statement.span);
    this.terminate({
      kind: "jump",
      span: statement.span,
      target: condition.id,
    });
    this.currentBlock = exit;
  }

  private emitExpression(expression: CExpression): Cs486IrValueId {
    if (isWideValueType(decayCType(expressionType(expression))))
      throw cError(
        "wide expression requires two-word lowering",
        expression.span,
      );
    switch (expression.kind) {
      case "floating":
        return this.emitConstant(expression.value, expression.span);
      case "integer":
        return this.emitConstant(expression.value, expression.span);
      case "string":
        return this.emitAddressSymbol(expression.symbol, expression.span);
      case "function":
        return this.emitAddressSymbol(expression.symbol.name, expression.span);
      case "compound":
        return this.emitAddress(expression);
      case "variable":
        return isArrayType(expression.type)
          ? this.emitAddress(expression)
          : this.emitLoad(expression.variable, expression.span);
      case "index":
        return isArrayType(expression.type)
          ? this.emitAddress(expression)
          : this.emitLoadMemory(
              this.emitAddress(expression),
              expression.span,
              lvalueQualifiers(expression).volatile === true,
              expression.type,
            );
      case "member": {
        if (isArrayType(expression.type)) return this.emitAddress(expression);
        const address = this.emitAddress(expression);
        const volatile = lvalueQualifiers(expression).volatile === true;
        const loaded = this.emitLoadMemory(
          address,
          expression.span,
          volatile,
          expression.field.bitWidth === undefined ? expression.type : "int",
        );
        return expression.field.bitWidth === undefined
          ? loaded
          : this.emitExtractBitField(loaded, expression.field, expression.span);
      }
      case "cast":
        if (expression.type === "float")
          return this.emitFloatingValue(expression.expression, "float").low;
        if (isFloatingType(decayCType(expressionType(expression.expression)))) {
          if (expression.type === "_Bool")
            return this.coerceToI32(
              this.emitCondition(expression.expression),
              expression.span,
            );
          if (isIntegerType(expression.type))
            return this.emitFloatingToNarrowInteger(
              expression.expression,
              expression.type,
            );
        }
        if (
          isWideIntegerType(decayCType(expressionType(expression.expression)))
        ) {
          if (expression.type === "_Bool")
            return this.coerceToI32(
              this.emitCondition(expression.expression),
              expression.span,
            );
          return this.emitWideExpression(expression.expression).low;
        }
        return expression.type === "_Bool"
          ? this.normalizeBooleanValue(
              this.emitExpression(expression.expression),
              expression.span,
            )
          : this.emitExpressionAsI32(expression.expression);
      case "call": {
        const result = this.emitCall(expression, expression.span);
        if (result === undefined)
          throw cError("void call cannot be used as a value", expression.span);
        return result;
      }
      case "indirect-call": {
        const result = this.emitCall(expression, expression.span);
        if (result === undefined)
          throw cError("void call cannot be used as a value", expression.span);
        return result;
      }
      case "unary":
        return this.emitUnary(expression);
      case "binary": {
        if (expression.operator === "&&" || expression.operator === "||")
          return this.emitShortCircuit(expression);
        const leftType = decayCType(expressionType(expression.left));
        const rightType = decayCType(expressionType(expression.right));
        if (isFloatingType(leftType) || isFloatingType(rightType))
          return this.emitFloatingBinary(expression, false).low;
        if (
          (isWideIntegerType(leftType) || isWideIntegerType(rightType)) &&
          comparisonOperators.has(expression.operator)
        )
          return this.emitWideComparison(expression);
        let left = this.emitExpressionAsI32(expression.left);
        let right = this.emitExpressionAsI32(expression.right);
        if (
          (expression.operator === "+" || expression.operator === "-") &&
          isPointerType(leftType) &&
          isIntegerType(rightType)
        )
          right = this.emitScaledPointerOffset(
            right,
            leftType,
            expression.span,
          );
        else if (
          expression.operator === "+" &&
          isIntegerType(leftType) &&
          isPointerType(rightType)
        )
          left = this.emitScaledPointerOffset(left, rightType, expression.span);
        const type: Cs486IrValueType = comparisonOperators.has(
          expression.operator,
        )
          ? "i1"
          : "i32";
        let result = this.emitBinaryOp(
          left,
          binaryOperatorToIr(expression.operator, leftType, rightType),
          right,
          type,
          expression.span,
        );
        if (
          expression.operator === "-" &&
          isPointerType(leftType) &&
          isPointerType(rightType)
        ) {
          const scale = cPointerStrideBytes(
            leftType,
            expression.span,
            this.program.dataModel,
          );
          if (scale !== 1)
            result = this.emitBinaryOp(
              result,
              "div",
              this.emitConstant(scale, expression.span),
              "i32",
              expression.span,
            );
        }
        return result;
      }
      case "ternary":
        return this.emitTernary(expression);
    }
  }

  private emitUnary(
    expression: Extract<CExpression, { kind: "unary" }>,
  ): Cs486IrValueId {
    if (expression.operator === "&")
      return this.emitAddress(expression.operand);
    if (expression.operator === "*") {
      const address = this.emitExpressionAsI32(expression.operand);
      return isArrayType(expression.type) || isFunctionType(expression.type)
        ? address
        : this.emitLoadMemory(
            address,
            expression.span,
            lvalueQualifiers(expression).volatile === true,
            expression.type,
          );
    }
    if (expression.operator === "+")
      return this.emitExpression(expression.operand);
    if (expression.operator === "!") {
      const condition = this.emitCondition(expression.operand);
      const result = this.newValue(expression.span);
      this.emit({
        kind: "unary",
        operand: condition,
        operator: "logical-not",
        result,
        span: expression.span,
        type: "i1",
      });
      this.valueTypes.set(result, "i1");
      return result;
    }
    const operandType = decayCType(expressionType(expression.operand));
    if (isFloatingType(operandType))
      return this.emitFloatingIntrinsic(
        floatingFormat(operandType),
        "neg",
        [this.emitFloatingValue(expression.operand, operandType).low],
        expression.span,
        false,
      ).low;
    const operand = this.emitExpressionAsI32(expression.operand);
    const result = this.newValue(expression.span);
    this.emit({
      kind: "unary",
      operand,
      operator: expression.operator === "-" ? "neg" : "bit-not",
      result,
      span: expression.span,
      type: "i32",
    });
    this.valueTypes.set(result, "i32");
    return result;
  }

  /** Evaluates `left OP right` with genuine short-circuit control flow (no phi nodes). */
  private emitShortCircuit(
    expression: Extract<CExpression, { kind: "binary" }>,
  ): Cs486IrValueId {
    const isAnd = expression.operator === "&&";
    const leftCondition = this.emitCondition(expression.left);
    const temp = this.newSyntheticLocal(expression.span);
    const rhsBlock = this.createBlock(
      isAnd ? "and.rhs" : "or.rhs",
      expression.span,
    );
    const shortBlock = this.createBlock(
      isAnd ? "and.short" : "or.short",
      expression.span,
    );
    const doneBlock = this.createBlock(
      isAnd ? "and.done" : "or.done",
      expression.span,
    );
    this.terminate({
      condition: leftCondition,
      falseTarget: (isAnd ? shortBlock : rhsBlock).id,
      kind: "branch",
      span: expression.span,
      trueTarget: (isAnd ? rhsBlock : shortBlock).id,
    });

    this.currentBlock = rhsBlock;
    this.storeBooleanResult(temp, expression.right, expression.span);
    this.terminate({
      kind: "jump",
      span: expression.span,
      target: doneBlock.id,
    });

    this.currentBlock = shortBlock;
    this.emitStoreLocalRaw(
      temp,
      this.emitConstant(isAnd ? 0 : 1, expression.span),
      expression.span,
    );
    this.terminate({
      kind: "jump",
      span: expression.span,
      target: doneBlock.id,
    });

    this.currentBlock = doneBlock;
    const result = this.emitLoadLocalRaw(temp, expression.span);
    this.valueTypes.set(result, "i32");
    return result;
  }

  private emitTernary(
    expression: Extract<CExpression, { kind: "ternary" }>,
  ): Cs486IrValueId {
    const condition = this.emitCondition(expression.condition);
    const temp = this.newSyntheticLocal(expression.span);
    const trueBlock = this.createBlock("ternary.true", expression.span);
    const falseBlock = this.createBlock("ternary.false", expression.span);
    const doneBlock = this.createBlock("ternary.done", expression.span);
    this.terminate({
      condition,
      falseTarget: falseBlock.id,
      kind: "branch",
      span: expression.span,
      trueTarget: trueBlock.id,
    });

    this.currentBlock = trueBlock;
    this.emitStoreLocalRaw(
      temp,
      this.emitExpressionAsI32(expression.whenTrue),
      expression.span,
    );
    this.terminate({
      kind: "jump",
      span: expression.span,
      target: doneBlock.id,
    });

    this.currentBlock = falseBlock;
    this.emitStoreLocalRaw(
      temp,
      this.emitExpressionAsI32(expression.whenFalse),
      expression.span,
    );
    this.terminate({
      kind: "jump",
      span: expression.span,
      target: doneBlock.id,
    });

    this.currentBlock = doneBlock;
    const result = this.emitLoadLocalRaw(temp, expression.span);
    this.valueTypes.set(result, "i32");
    return result;
  }

  /** Stores the 0/1 truthiness of `expression` into an already-i32 synthetic local. */
  private storeBooleanResult(
    temp: string,
    expression: CExpression,
    span: Cs486SourceSpan,
  ): void {
    const condition = this.emitCondition(expression);
    const trueBlock = this.createBlock("bool.true", span);
    const falseBlock = this.createBlock("bool.false", span);
    const doneBlock = this.createBlock("bool.done", span);
    this.terminate({
      condition,
      falseTarget: falseBlock.id,
      kind: "branch",
      span,
      trueTarget: trueBlock.id,
    });
    this.currentBlock = trueBlock;
    this.emitStoreLocalRaw(temp, this.emitConstant(1, span), span);
    this.terminate({ kind: "jump", span, target: doneBlock.id });
    this.currentBlock = falseBlock;
    this.emitStoreLocalRaw(temp, this.emitConstant(0, span), span);
    this.terminate({ kind: "jump", span, target: doneBlock.id });
    this.currentBlock = doneBlock;
  }

  /** Materializes the canonical 0/1 representation of i1 as one i32 word. */
  private coerceToI32(
    value: Cs486IrValueId,
    span: Cs486SourceSpan,
  ): Cs486IrValueId {
    if (this.valueType(value) === "i32") return value;
    return this.emitUnaryOp(value, "zero-extend", "i32", span);
  }

  private normalizeBooleanValue(
    value: Cs486IrValueId,
    span: Cs486SourceSpan,
  ): Cs486IrValueId {
    const i32 = this.coerceToI32(value, span);
    return this.coerceToI32(
      this.emitBinaryOp(i32, "ne", this.emitConstant(0, span), "i1", span),
      span,
    );
  }

  private normalizeCValue(
    value: Cs486IrValueId,
    type: CType,
    span: Cs486SourceSpan,
  ): Cs486IrValueId {
    if (type === "_Bool") return this.normalizeBooleanValue(value, span);
    const i32 = this.coerceToI32(value, span);
    if (this.program.dataModel !== cs486Byte8DataModel || !isIntegerType(type))
      return i32;
    const access = cMemoryAccess(type, this.program.dataModel);
    if (access.width === 4) return i32;
    const mask = access.width === 1 ? 0xff : 0xffff;
    const truncated = this.emitBinaryOp(
      i32,
      "and",
      this.emitConstant(mask, span),
      "i32",
      span,
    );
    if (access.signed !== true) return truncated;
    const shift = this.emitConstant(access.width === 1 ? 24 : 16, span);
    return this.emitBinaryOp(
      this.emitBinaryOp(truncated, "shl", shift, "i32", span),
      "shr",
      shift,
      "i32",
      span,
    );
  }

  private emitExpressionAsI32(expression: CExpression): Cs486IrValueId {
    return this.coerceToI32(this.emitExpression(expression), expression.span);
  }

  /** Evaluates `expression`'s truthiness as a genuine i1 branch condition. */
  private emitCondition(expression: CExpression): Cs486IrValueId {
    const expressionType_ = decayCType(expressionType(expression));
    if (isFloatingType(expressionType_)) {
      const value = this.emitFloatingValue(expression, expressionType_);
      const compared = this.emitFloatingIntrinsic(
        floatingFormat(expressionType_),
        "compare.ne",
        expressionType_ === "double"
          ? [
              value.low,
              value.high,
              this.emitConstant(0, expression.span),
              this.emitConstant(0, expression.span),
            ]
          : [value.low, this.emitConstant(0, expression.span)],
        expression.span,
        false,
      ).low;
      return this.emitBinaryOp(
        compared,
        "ne",
        this.emitConstant(0, expression.span),
        "i1",
        expression.span,
      );
    }
    if (isWideIntegerType(expressionType_)) {
      const value = this.emitWideExpression(expression);
      return this.emitBinaryOp(
        this.emitBinaryOp(value.low, "or", value.high, "i32", expression.span),
        "ne",
        this.emitConstant(0, expression.span),
        "i1",
        expression.span,
      );
    }
    const value = this.emitExpression(expression);
    if (this.valueType(value) === "i1") return value;
    const zero = this.emitConstant(0, expression.span);
    return this.emitBinaryOp(value, "ne", zero, "i1", expression.span);
  }

  /** Constructs one typed `binary` CSIR instruction and records its value type. */
  private emitBinaryOp(
    left: Cs486IrValueId,
    operator: Cs486IrBinaryOperator,
    right: Cs486IrValueId,
    type: Cs486IrValueType,
    span: Cs486SourceSpan,
  ): Cs486IrValueId {
    const result = this.newValue(span);
    this.emit({ kind: "binary", left, operator, result, right, span, type });
    this.valueTypes.set(result, type);
    return result;
  }

  private emitUnaryOp(
    operand: Cs486IrValueId,
    operator: "bit-not" | "logical-not" | "neg" | "zero-extend",
    type: Cs486IrValueType,
    span: Cs486SourceSpan,
  ): Cs486IrValueId {
    const result = this.newValue(span);
    this.emit({ kind: "unary", operand, operator, result, span, type });
    this.valueTypes.set(result, type);
    return result;
  }

  private emitCall(
    expression: CExpression,
    span: Cs486SourceSpan,
  ): Cs486IrValueId | undefined {
    if (expression.kind !== "call" && expression.kind !== "indirect-call")
      throw cError("internal call statement is not a call", span);
    const compilerFloatCall = this.emitCompilerFloatCall(expression);
    if (compilerFloatCall !== undefined) return compilerFloatCall.low;
    if (isWideValueType(expression.returnType))
      return this.emitWideCall(expression, span).low;
    if (expression.kind === "indirect-call") {
      const arguments_ = this.emitCallArguments(
        expression.arguments,
        expression.functionType.parameterTypes,
      );
      const target = this.emitExpressionAsI32(expression.callee);
      const functionSignature = cFunctionSignature(expression.functionType);
      if (expression.returnType === "void") {
        this.emit({
          arguments: arguments_,
          functionSignature,
          kind: "indirect-call",
          span,
          target,
        });
        return undefined;
      }
      const result = this.newValue(span);
      this.emit({
        arguments: arguments_,
        functionSignature,
        kind: "indirect-call",
        result,
        span,
        target,
        type: "i32",
      });
      this.valueTypes.set(result, "i32");
      return result;
    }
    const symbol = this.program.functions.get(expression.name);
    if (symbol === undefined)
      throw cError(`unknown function ${expression.name}`, expression.span);
    const arguments_ = this.emitCallArguments(
      expression.arguments,
      symbol.parameterTypes,
    );
    if (symbol.returnType === "void") {
      this.emit({
        arguments: arguments_,
        callee: symbol.name,
        kind: "call",
        span,
      });
      return undefined;
    }
    const result = this.newValue(span);
    this.emit({
      arguments: arguments_,
      callee: symbol.name,
      kind: "call",
      result,
      span,
      type: "i32",
    });
    this.valueTypes.set(result, "i32");
    return result;
  }

  private emitWideCall(
    expression: Extract<CExpression, { kind: "call" | "indirect-call" }>,
    span: Cs486SourceSpan,
  ): CWideIrValue {
    const compilerFloatCall = this.emitCompilerFloatCall(expression);
    if (compilerFloatCall !== undefined) return compilerFloatCall;
    if (!isWideValueType(expression.returnType))
      throw cError("wide call lowering requires a two-word return", span);
    const highLocal = this.newSyntheticLocal(span);
    const result = this.newValue(span);
    if (expression.kind === "indirect-call") {
      const arguments_ = this.emitCallArguments(
        expression.arguments,
        expression.functionType.parameterTypes,
      );
      this.emit({
        arguments: arguments_,
        functionSignature: cFunctionSignature(expression.functionType),
        kind: "indirect-call",
        result,
        span,
        target: this.emitExpressionAsI32(expression.callee),
        type: "i32",
        wideResultLocal: highLocal,
      });
    } else {
      const symbol = this.program.functions.get(expression.name);
      if (symbol === undefined)
        throw cError(`unknown function ${expression.name}`, expression.span);
      this.emit({
        arguments: this.emitCallArguments(
          expression.arguments,
          symbol.parameterTypes,
        ),
        callee: symbol.name,
        kind: "call",
        result,
        span,
        type: "i32",
        wideResultLocal: highLocal,
      });
    }
    this.valueTypes.set(result, "i32");
    return {
      high: this.emitLoadLocalRaw(highLocal, span),
      low: result,
    };
  }

  private emitCompilerFloatCall(
    expression: Extract<CExpression, { kind: "call" | "indirect-call" }>,
  ): CWideIrValue | undefined {
    if (expression.kind !== "call") return undefined;
    if (expression.name === "__cs_fp_status")
      return this.emitFloatingIntrinsic(
        "binary64",
        "status",
        [],
        expression.span,
        false,
      );
    const match = /^__cs_fp_(f32|f64)_([a-z0-9_]+)$/u.exec(expression.name);
    if (match === null) return undefined;
    const symbol = this.program.functions.get(expression.name);
    if (symbol === undefined)
      throw cError(
        `unknown floating intrinsic ${expression.name}`,
        expression.span,
      );
    const arguments_ = this.emitCallArguments(
      expression.arguments,
      symbol.parameterTypes,
    );
    return this.emitFloatingIntrinsic(
      match[1] === "f32" ? "binary32" : "binary64",
      match[2]!.replaceAll("_", "."),
      arguments_,
      expression.span,
      expression.returnType === "double" ||
        isWideIntegerType(expression.returnType),
    );
  }

  private emitCallArguments(
    arguments_: readonly CExpression[],
    parameterTypes: readonly CObjectType[],
  ): readonly Cs486IrValueId[] {
    return arguments_.flatMap((argument, index) => {
      const sourceType = decayCType(expressionType(argument));
      const targetType =
        parameterTypes[index] ??
        (sourceType === "float" ? "double" : sourceType);
      if (isFloatingType(targetType)) {
        const value = this.emitFloatingValue(argument, targetType);
        return targetType === "double" ? [value.low, value.high] : [value.low];
      }
      if (isFloatingType(sourceType) && isWideIntegerType(targetType)) {
        const value = this.emitFloatingToWideInteger(argument, targetType);
        return [value.low, value.high];
      }
      if (isFloatingType(sourceType) && isIntegerType(targetType))
        return [this.emitFloatingToNarrowInteger(argument, targetType)];
      if (isWideValueType(targetType)) {
        const value = isWideValueType(sourceType)
          ? this.emitWideExpression(argument)
          : this.emitWideFromNarrow(argument, argument.span);
        return [value.low, value.high];
      }
      if (isWideValueType(sourceType))
        return [this.emitWideExpression(argument).low];
      return [
        this.normalizeCValue(
          this.emitExpression(argument),
          targetType,
          argument.span,
        ),
      ];
    });
  }

  private emitInlineAssembly(
    instructions: readonly CInlineInstruction[],
    span: Cs486SourceSpan,
  ): void {
    if (this.inlineAssembly.size >= maximumInlineRegions)
      throw cError("inline assembly region limit exceeded", span);
    const callee = `${inlineAssemblyIntrinsicPrefix}${String(this.inlineAssembly.size)}`;
    this.inlineAssembly.set(callee, [...instructions]);
    this.addExternal(callee, [], "void", span);
    this.emit({ arguments: [], callee, kind: "call", span });
  }

  private emitConstant(value: number, span: Cs486SourceSpan): Cs486IrValueId {
    const result = this.newValue(span);
    this.emit({ kind: "constant", result, span, type: "i32", value });
    this.valueTypes.set(result, "i32");
    return result;
  }

  private emitLoad(variable: CVariable, span: Cs486SourceSpan): Cs486IrValueId {
    if (variable.storage === "global")
      return this.emitLoadMemory(
        this.emitAddressSymbol(variable.name, span),
        span,
        variable.qualifiers?.volatile === true,
        variable.type,
      );
    return this.emitLoadLocalRaw(
      irLocalName(variable),
      span,
      variable.qualifiers?.volatile === true,
    );
  }

  private emitLoadWideVariable(
    variable: CVariable,
    span: Cs486SourceSpan,
  ): CWideIrValue {
    if (variable.storage === "global")
      return this.emitLoadWideAddress(
        this.emitAddressSymbol(variable.name, span),
        span,
        variable.qualifiers?.volatile === true,
      );
    return {
      high: this.emitLoadLocalRaw(
        irLocalWordName(variable, 1),
        span,
        variable.qualifiers?.volatile === true,
      ),
      low: this.emitLoadLocalRaw(
        irLocalWordName(variable, 0),
        span,
        variable.qualifiers?.volatile === true,
      ),
    };
  }

  private emitLoadWideAddress(
    address: Cs486IrValueId,
    span: Cs486SourceSpan,
    volatile: boolean,
  ): CWideIrValue {
    const highAddress = this.emitBinaryOp(
      address,
      "add",
      this.emitConstant(4, span),
      "i32",
      span,
    );
    return {
      high: this.emitLoadMemory(highAddress, span, volatile),
      low: this.emitLoadMemory(address, span, volatile),
    };
  }

  private emitStore(
    variable: CVariable,
    value: Cs486IrValueId,
    span: Cs486SourceSpan,
  ): void {
    if (variable.storage === "global") {
      this.emit({
        address: this.emitAddressSymbol(variable.name, span),
        kind: "store-memory",
        span,
        value: this.normalizeCValue(value, variable.type, span),
        ...cMemoryAccess(variable.type, this.program.dataModel),
        ...(variable.qualifiers?.volatile === true ? { volatile: true } : {}),
      });
      return;
    }
    this.emitStoreLocalRaw(
      irLocalName(variable),
      this.normalizeCValue(value, variable.type, span),
      span,
      variable.qualifiers?.volatile === true,
    );
  }

  private emitStoreWide(
    variable: CVariable,
    value: CWideIrValue,
    span: Cs486SourceSpan,
  ): void {
    if (variable.storage === "global") {
      const address = this.emitAddressSymbol(variable.name, span);
      this.emitWideMemoryStores(
        address,
        value,
        span,
        variable.qualifiers?.volatile === true,
      );
      return;
    }
    this.emitStoreLocalRaw(
      irLocalWordName(variable, 0),
      value.low,
      span,
      variable.qualifiers?.volatile === true,
    );
    this.emitStoreLocalRaw(
      irLocalWordName(variable, 1),
      value.high,
      span,
      variable.qualifiers?.volatile === true,
    );
  }

  private emitStoreWideTarget(
    target: CExpression,
    value: CWideIrValue,
    span: Cs486SourceSpan,
  ): void {
    if (target.kind === "variable") {
      this.emitStoreWide(target.variable, value, span);
      return;
    }
    this.emitWideMemoryStores(
      this.emitAddress(target),
      value,
      span,
      lvalueQualifiers(target).volatile === true,
    );
  }

  private emitWideMemoryStores(
    address: Cs486IrValueId,
    value: CWideIrValue,
    span: Cs486SourceSpan,
    volatile: boolean,
  ): void {
    this.emit({
      address,
      kind: "store-memory",
      span,
      value: value.low,
      ...(volatile ? { volatile: true } : {}),
    });
    this.emit({
      address: this.emitBinaryOp(
        address,
        "add",
        this.emitConstant(4, span),
        "i32",
        span,
      ),
      kind: "store-memory",
      span,
      value: value.high,
      ...(volatile ? { volatile: true } : {}),
    });
  }

  private emitStoreTarget(
    target: CExpression,
    value: Cs486IrValueId,
    span: Cs486SourceSpan,
  ): void {
    if (target.kind === "variable") {
      this.emitStore(target.variable, value, span);
      return;
    }
    if (target.kind === "member" && target.field.bitWidth !== undefined) {
      this.emitStoreBitField(target, value, span);
      return;
    }
    this.emit({
      address: this.emitAddress(target),
      kind: "store-memory",
      span,
      value: this.normalizeCValue(value, expressionType(target), span),
      ...cMemoryAccess(
        expressionType(target) as CObjectType,
        this.program.dataModel,
      ),
      ...(lvalueQualifiers(target).volatile === true ? { volatile: true } : {}),
    });
  }

  private emitExtractBitField(
    loaded: Cs486IrValueId,
    field: CStructField,
    span: Cs486SourceSpan,
  ): Cs486IrValueId {
    const bitWidth = field.bitWidth;
    const bitOffset = field.bitOffset ?? 0;
    if (bitWidth === undefined || !isIntegerType(field.type))
      throw new Error("validated bit-field metadata is invalid");
    let value = loaded;
    if (bitOffset !== 0)
      value = this.emitBinaryOp(
        value,
        "ushr",
        this.emitConstant(bitOffset, span),
        "i32",
        span,
      );
    if (bitWidth < 32)
      value = this.emitBinaryOp(
        value,
        "and",
        this.emitConstant(Number((1n << BigInt(bitWidth)) - 1n), span),
        "i32",
        span,
      );
    if (!isUnsignedIntegerType(field.type) && bitWidth < 32) {
      const shift = this.emitConstant(32 - bitWidth, span);
      value = this.emitBinaryOp(value, "shl", shift, "i32", span);
      value = this.emitBinaryOp(value, "shr", shift, "i32", span);
    }
    return value;
  }

  private emitStoreBitField(
    target: Extract<CExpression, { readonly kind: "member" }>,
    value: Cs486IrValueId,
    span: Cs486SourceSpan,
  ): void {
    const field = target.field;
    const bitWidth = field.bitWidth;
    const bitOffset = field.bitOffset ?? 0;
    if (bitWidth === undefined || !isIntegerType(field.type))
      throw new Error("validated bit-field metadata is invalid");
    const volatile = lvalueQualifiers(target).volatile === true;
    const address = this.emitAddress(target);
    const loaded = this.emitLoadMemory(address, span, volatile);
    const storageMask = bitFieldMask(bitOffset, bitWidth);
    const valueMask =
      bitWidth === 32 ? 0xffff_ffff : Number((1n << BigInt(bitWidth)) - 1n);
    let inserted = this.emitBinaryOp(
      this.normalizeCValue(value, field.type, span),
      "and",
      this.emitConstant(valueMask | 0, span),
      "i32",
      span,
    );
    if (bitOffset !== 0)
      inserted = this.emitBinaryOp(
        inserted,
        "shl",
        this.emitConstant(bitOffset, span),
        "i32",
        span,
      );
    const preserved = this.emitBinaryOp(
      loaded,
      "and",
      this.emitConstant(~storageMask, span),
      "i32",
      span,
    );
    this.emit({
      address,
      kind: "store-memory",
      span,
      value: this.emitBinaryOp(preserved, "or", inserted, "i32", span),
      ...(volatile ? { volatile: true } : {}),
    });
  }

  private emitAddress(expression: CExpression): Cs486IrValueId {
    if (expression.kind === "compound") {
      this.emitAggregateInitializer(
        expression.variable,
        expression.initializer,
        expression.span,
      );
      return this.emitLocalAddress(expression.variable, expression.span);
    }
    if (expression.kind === "variable") {
      if (expression.variable.storage === "global")
        return this.emitAddressSymbol(
          expression.variable.name,
          expression.span,
        );
      return this.emitLocalAddress(expression.variable, expression.span);
    }
    if (expression.kind === "unary" && expression.operator === "*")
      return this.emitExpressionAsI32(expression.operand);
    if (expression.kind === "index") {
      const base = this.emitExpressionAsI32(expression.base);
      let index = this.emitExpressionAsI32(expression.index);
      const pointer = decayCType(expressionType(expression.base));
      if (!isPointerType(pointer))
        throw new Error("validated C subscript lost its pointer type");
      index = this.emitScaledPointerOffset(index, pointer, expression.span);
      return this.emitBinaryOp(base, "add", index, "i32", expression.span);
    }
    if (expression.kind === "member") {
      const base = expression.throughPointer
        ? this.emitExpressionAsI32(expression.base)
        : this.emitAddress(expression.base);
      if (expression.field.offsetBytes === 0) return base;
      return this.emitBinaryOp(
        base,
        "add",
        this.emitConstant(expression.field.offsetBytes, expression.field.span),
        "i32",
        expression.span,
      );
    }
    throw cError("expression has no address", expression.span);
  }

  private emitAggregateInitializer(
    variable: CVariable,
    initializer: readonly CInitializerValue[],
    span: Cs486SourceSpan,
  ): void {
    if (variable.storage !== "local")
      throw cError("invalid local aggregate initializer storage", span);
    if (this.program.dataModel !== cs486Word32DataModel) {
      const units = cTypeSizeUnits(variable.type, span, this.program.dataModel);
      if (initializer.length !== units)
        throw cError("invalid local aggregate initializer storage", span);
      const base = this.emitLocalAddress(variable, span);
      const occupied = new Set<number>();
      const addressAt = (offset: number): Cs486IrValueId =>
        offset === 0
          ? base
          : this.emitBinaryOp(
              base,
              "add",
              this.emitConstant(offset, span),
              "i32",
              span,
            );
      const store = (
        offset: number,
        value: Cs486IrValueId,
        type: CObjectType,
      ): void => {
        const access = cMemoryAccess(type, this.program.dataModel);
        this.emit({
          address: addressAt(offset),
          kind: "store-memory",
          span,
          value: this.normalizeCValue(value, type, span),
          width: access.width,
          ...(variable.qualifiers?.volatile === true ? { volatile: true } : {}),
        });
        for (let byte = 0; byte < access.width; byte += 1)
          occupied.add(offset + byte);
      };
      for (const [offset, initialized] of initializer.entries()) {
        if (occupied.has(offset)) continue;
        if (isInitializerAtom(initialized)) {
          if (isWideInitializerValue(initialized.value)) {
            store(
              offset,
              this.emitConstant(initialized.value[0], span),
              "unsigned int",
            );
            store(
              offset + 4,
              this.emitConstant(initialized.value[1], span),
              "unsigned int",
            );
            continue;
          }
          const value =
            typeof initialized.value === "string"
              ? this.emitAddressSymbol(initialized.value, span)
              : typeof initialized.value === "number"
                ? this.emitConstant(initialized.value, span)
                : this.emitExpression(initialized.value);
          store(offset, value, initialized.type);
          continue;
        }
        if (typeof initialized !== "number")
          throw cError("invalid byte-profile aggregate initializer", span);
        store(offset, this.emitConstant(initialized, span), "unsigned char");
      }
      return;
    }
    if (initializer.length !== variable.words)
      throw cError("invalid local aggregate initializer storage", span);
    for (const [word, initialized] of initializer.entries()) {
      if (isInitializerAtom(initialized))
        throw cError(
          "word initializer unexpectedly contains a byte atom",
          span,
        );
      const value =
        typeof initialized === "string"
          ? this.emitAddressSymbol(initialized, span)
          : typeof initialized === "number"
            ? this.emitConstant(initialized, span)
            : this.emitExpression(initialized);
      this.emitStoreLocalRaw(
        irLocalWordName(variable, word),
        value,
        span,
        variable.qualifiers?.volatile === true,
      );
    }
  }

  private emitLocalAddress(
    variable: CVariable,
    span: Cs486SourceSpan,
  ): Cs486IrValueId {
    const result = this.newValue(span);
    this.emit({
      kind: "address-local",
      local: irLocalName(variable),
      result,
      span,
      type: "i32",
    });
    this.valueTypes.set(result, "i32");
    return result;
  }

  private emitAddressSymbol(
    symbol: string,
    span: Cs486SourceSpan,
  ): Cs486IrValueId {
    const result = this.newValue(span);
    this.emit({ kind: "address-symbol", result, span, symbol, type: "i32" });
    this.valueTypes.set(result, "i32");
    return result;
  }

  private emitLoadMemory(
    address: Cs486IrValueId,
    span: Cs486SourceSpan,
    volatile = false,
    type?: CObjectType,
  ): Cs486IrValueId {
    const result = this.newValue(span);
    this.emit({
      address,
      kind: "load-memory",
      result,
      span,
      type: "i32",
      ...(type === undefined
        ? {}
        : cMemoryAccess(type, this.program.dataModel)),
      ...(volatile ? { volatile: true } : {}),
    });
    this.valueTypes.set(result, "i32");
    return result;
  }

  private emitScaledPointerOffset(
    value: Cs486IrValueId,
    pointer: CPointerType,
    span: Cs486SourceSpan,
  ): Cs486IrValueId {
    const scale = cPointerStrideBytes(pointer, span, this.program.dataModel);
    return scale === 1
      ? value
      : this.emitBinaryOp(
          value,
          "mul",
          this.emitConstant(scale, span),
          "i32",
          span,
        );
  }

  private emitLoadLocalRaw(
    name: string,
    span: Cs486SourceSpan,
    volatile = false,
  ): Cs486IrValueId {
    const result = this.newValue(span);
    this.emit({
      kind: "load-local",
      local: name,
      result,
      span,
      type: "i32",
      ...(volatile ? { volatile: true } : {}),
    });
    this.valueTypes.set(result, "i32");
    return result;
  }

  private emitStoreLocalRaw(
    name: string,
    value: Cs486IrValueId,
    span: Cs486SourceSpan,
    volatile = false,
  ): void {
    this.emit({
      kind: "store-local",
      local: name,
      span,
      value,
      ...(volatile ? { volatile: true } : {}),
    });
  }

  private valueType(value: Cs486IrValueId): Cs486IrValueType {
    const type = this.valueTypes.get(value);
    if (type === undefined)
      throw new Error(`CSIR value ${String(value)} has no recorded type`);
    return type;
  }

  private newSyntheticLocal(span: Cs486SourceSpan): string {
    if (this.syntheticLocals.length >= maximumSyntheticLocalsPerFunction)
      throw cError("compiler-generated temporary limit exceeded", span);
    const name = `$t${String(this.nextSyntheticLocal++)}`;
    this.syntheticLocals.push({ name, span, type: "i32" });
    return name;
  }

  private pushLoop(breakTarget: string, continueTarget: string): void {
    this.loopContexts.push({ breakTarget, continueTarget });
    this.breakTargets.push(breakTarget);
  }

  private popLoop(): void {
    if (
      this.loopContexts.pop() === undefined ||
      this.breakTargets.pop() === undefined
    )
      throw new Error("C loop context stack underflow");
  }

  private pushBreak(target: string): void {
    this.breakTargets.push(target);
  }

  private popBreak(): void {
    if (this.breakTargets.pop() === undefined)
      throw new Error("C break target stack underflow");
  }

  private createBlock(kind: string, span?: Cs486SourceSpan): MutableIrBlock {
    const id =
      this.blocks.length === 0
        ? "entry"
        : `${kind}.${String(this.nextBlock++)}`;
    return this.createBlockWithId(id, span);
  }

  private createBlockWithId(
    id: string,
    span?: Cs486SourceSpan,
  ): MutableIrBlock {
    if (this.blocks.length >= maximumIrBlocksPerFunction)
      throw cError(
        "CSIR basic block limit exceeded",
        span ?? this.currentDefinition.nameSpan,
      );
    const block: MutableIrBlock = {
      id,
      instructions: [],
      phis: [],
      ...(span === undefined ? {} : { span }),
    };
    this.blocks.push(block);
    return block;
  }

  private emit(instruction: Cs486IrInstruction): void {
    if (this.currentBlock.terminator !== undefined)
      throw cError(
        "instruction emitted after terminal control flow",
        instruction.span ?? this.currentDefinition.nameSpan,
      );
    if (this.instructionCount >= maximumIrInstructionsPerFunction)
      throw cError(
        "CSIR instruction limit exceeded",
        instruction.span ?? this.currentDefinition.nameSpan,
      );
    this.instructionCount += 1;
    this.currentBlock.instructions.push(instruction);
  }

  private newValue(span: Cs486SourceSpan): Cs486IrValueId {
    if (this.nextValue >= maximumIrValuesPerFunction)
      throw cError("CSIR SSA value limit exceeded", span);
    return this.nextValue++;
  }

  private terminate(terminator: Cs486IrTerminator): void {
    if (this.currentBlock.terminator !== undefined)
      throw cError(
        "basic block already has a terminal state",
        terminator.span ?? this.currentDefinition.nameSpan,
      );
    this.currentBlock.terminator = terminator;
  }

  private addExternal(
    name: string,
    parameterTypes: readonly Cs486IrValueType[],
    returnType: Cs486IrReturnType,
    span: Cs486SourceSpan,
    variadic = false,
    abiSignature?: Cs486FunctionSignature,
    wideReturn = false,
  ): void {
    const existing = this.externals.get(name);
    if (existing !== undefined) return;
    if (this.externals.size >= cIrLimits.maxExternals)
      throw cError("CSIR external function limit exceeded", span);
    this.externals.set(name, {
      ...(abiSignature === undefined ? {} : { abiSignature }),
      name,
      parameterTypes,
      returnType,
      span,
      variadic,
      ...(wideReturn ? { wideReturn: true } : {}),
    });
  }
}

class CCodeGenerator {
  private readonly assembly: string[] = [];
  private allocation!: Cs486IrRegisterAllocation;
  private readonly blockLabels = new Map<string, string>();
  private currentFunction!: Cs486IrFunction;
  private readonly callSignatures = new Map<
    string,
    { readonly fixedParameters: number; readonly variadic: boolean }
  >();
  private nextLabel = 0;
  private epilogue = "";
  private inlineAssembly: ReadonlyMap<string, readonly CInlineInstruction[]> =
    new Map();

  constructor(private readonly dataModel: Cs486DataModel) {}

  generate(program: CProgram, intermediate: CIntermediateProgram): string {
    this.inlineAssembly = intermediate.inlineAssembly;
    this.callSignatures.clear();
    for (const function_ of [
      ...(intermediate.ir.externals ?? []),
      ...intermediate.ir.functions,
    ])
      this.callSignatures.set(function_.name, {
        fixedParameters:
          "parameterTypes" in function_
            ? function_.parameterTypes.length
            : function_.parameters.length,
        variadic: function_.variadic === true,
      });
    const referencedFunctions = new Set<string>();
    const referencedObjects = new Set<string>();
    for (const function_ of intermediate.ir.functions) {
      for (const block of function_.blocks) {
        for (const instruction of block.instructions) {
          if (instruction.kind === "call")
            referencedFunctions.add(instruction.callee);
          else if (instruction.kind === "address-symbol") {
            if (program.functions.has(instruction.symbol))
              referencedFunctions.add(instruction.symbol);
            else referencedObjects.add(instruction.symbol);
          }
        }
      }
    }
    for (const global of program.globals.values()) {
      for (const value of global.initializer ?? []) {
        if (typeof value !== "string") continue;
        if (program.functions.has(value)) referencedFunctions.add(value);
        else if (program.globals.has(value)) referencedObjects.add(value);
      }
    }
    for (const global of program.globals.values()) {
      if (!global.defined && !referencedObjects.has(global.name)) continue;
      if (!global.defined) this.emit(`extern ${global.name}`);
      else if (global.linkage === "external")
        this.emit(`global ${global.name}`);
      this.emit(`type ${global.name}, object`);
    }
    for (const function_ of program.functions.values()) {
      if (
        function_.name === csSyscallIntrinsic ||
        function_.name === csVaStartIntrinsic
      )
        continue;
      if (
        function_.definition === undefined &&
        !referencedFunctions.has(function_.name)
      )
        continue;
      if (function_.definition === undefined)
        this.emit(`extern ${function_.name}`);
      else if (function_.linkage === "external")
        this.emit(`global ${function_.name}`);
      this.emit(`type ${function_.name}, function`);
      this.emit(
        `signature ${function_.name}, ${function_.returnType === "void" ? "void" : cFunctionAbiType(function_.returnType)}${function_.parameterTypes.map((type) => `, ${cFunctionAbiType(type)}`).join("")}${function_.variadic ? ", varargs" : ""}`,
      );
    }
    if (program.strings.length > 0) {
      this.emit("section .rodata", "align 4");
      for (const string of program.strings) {
        this.emit(`${string.symbol}:`);
        const values = [
          ...[...string.value].map((character) => character.codePointAt(0)!),
          0,
        ];
        if (this.dataModel === cs486Word32DataModel)
          this.emit(`dd ${values.join(", ")}`);
        else
          for (const chunk of chunkNumbers(values, 64))
            this.emit(`db ${chunk.map((value) => value & 0xff).join(", ")}`);
      }
    }
    const initializedGlobals = [...program.globals.values()].filter(
      (global) => global.defined && global.initializer !== undefined,
    );
    if (initializedGlobals.length > 0) {
      this.emit("section .data", "align 4");
      for (const global of initializedGlobals) {
        this.emit(`${global.name}:`);
        if (this.dataModel === cs486Word32DataModel) {
          if (global.initializer!.some(isInitializerAtom))
            throw new Error("word global contains a byte initializer atom");
          const rendered = global.initializer!.map((value) => {
            if (typeof value === "number" || typeof value === "string")
              return String(value);
            throw new Error("word global contains a non-scalar initializer");
          });
          this.emit(`dd ${rendered.join(", ")}`);
        } else {
          this.emit(...renderByteGlobalInitializer(global));
        }
      }
    }
    const zeroInitializedGlobals = [...program.globals.values()].filter(
      (global) => global.defined && global.initializer === undefined,
    );
    // Keep the empty aligned BSS section as part of the frontend's stable
    // object contract even when this translation unit defines no globals.
    this.emit("section .bss", "align 4");
    for (const global of zeroInitializedGlobals)
      this.emit(
        `${global.name}:`,
        this.dataModel === cs486Word32DataModel
          ? `resd ${String(global.words)}`
          : `resb ${String(cTypeSizeBytes(global.type, global.span, this.dataModel))}`,
      );
    this.emit("section .text");
    for (const function_ of intermediate.ir.functions)
      this.generateFunction(function_);
    return this.assembly.join("\n");
  }

  private generateFunction(function_: Cs486IrFunction): void {
    this.currentFunction = function_;
    try {
      this.allocation = allocateCs486IrRegistersLinearScan(function_, {
        // EAX/EBX/ECX are fixed ABI/lowering scratch registers. All values
        // crossing a call or opaque inline-assembly region are spilled.
        registers: ["edx", "esi", "edi"],
      });
    } catch (error: unknown) {
      const normalized = error instanceof Error ? error.message : String(error);
      throw cError(
        `CSIR register allocation failed: ${normalized}`,
        function_.span ?? this.currentSourceSpan(),
      );
    }
    this.blockLabels.clear();
    for (const block of function_.blocks)
      this.blockLabels.set(block.id, this.label("block"));
    this.epilogue = this.label("epilogue");
    this.emit(
      `${function_.name}:`,
      "push ebp",
      "mov ebp, esp",
      "push esi",
      "push edi",
    );
    const frameSlots = function_.locals.length + this.allocation.spillSlotCount;
    if (frameSlots > 0) {
      this.emit("mov eax, 0");
      for (let index = 0; index < frameSlots; index += 1) this.emit("push eax");
    }
    for (const [index, parameter] of function_.parameters.entries()) {
      const byteOffset = 8 + index * 4;
      this.emit(
        "mov ecx, ebp",
        `add ecx, ${String(byteOffset)}`,
        "load eax, [ecx]",
      );
      this.storeResult(parameter.id, parameter.span);
    }
    this.emit(`jmp ${this.blockLabel(function_.entry)}`);
    for (const original of function_.blocks) {
      const block = scheduleCs486IrBlock(original);
      if (block.phis.length > 0)
        throw cError(
          "CSIR phi destruction is unavailable for this frontend path",
          block.span ?? this.currentSourceSpan(),
        );
      this.emit(`${this.blockLabel(block.id)}:`);
      for (const instruction of block.instructions)
        this.generateInstruction(instruction);
      if (block.terminator === undefined)
        throw cError(
          "CSIR block has no explicit terminal state",
          block.span ?? this.currentSourceSpan(),
        );
      this.generateTerminator(block.terminator);
    }
    this.emit(
      `${this.epilogue}:`,
      "mov esp, ebp",
      "sub esp, 8",
      "pop edi",
      "pop esi",
      "pop ebp",
      "ret",
    );
  }

  private generateInstruction(instruction: Cs486IrInstruction): void {
    switch (instruction.kind) {
      case "constant":
        this.emit(`mov eax, ${String(instruction.value)}`);
        this.storeResult(instruction.result, instruction.span);
        return;
      case "copy":
        this.loadValue(instruction.value, instruction.span);
        this.storeResult(instruction.result, instruction.span);
        return;
      case "unary":
        this.loadValue(instruction.operand, instruction.span);
        if (instruction.operator === "neg")
          this.emit("mov ebx, eax", "mov eax, 0", "sub eax, ebx");
        else if (instruction.operator === "bit-not") this.emit("xor eax, -1");
        else if (instruction.operator === "logical-not")
          this.emitBooleanFromZero("je");
        this.storeResult(instruction.result, instruction.span);
        return;
      case "binary":
        this.generateBinary(instruction);
        return;
      case "load-local":
        this.addressLocal(instruction.local, instruction.span);
        this.emit("load eax, [ecx]");
        this.storeResult(instruction.result, instruction.span);
        return;
      case "address-local":
        this.addressLocal(instruction.local, instruction.span);
        this.emit("mov eax, ecx");
        this.storeResult(instruction.result, instruction.span);
        return;
      case "address-symbol":
        this.emit(`mov eax, ${instruction.symbol}`);
        this.storeResult(instruction.result, instruction.span);
        return;
      case "load-memory":
        this.loadValue(instruction.address, instruction.span);
        this.emit(
          "mov ecx, eax",
          `${loadMnemonic(instruction.width ?? 4, instruction.signed === true)} eax, [ecx]`,
        );
        this.storeResult(instruction.result, instruction.span);
        return;
      case "store-local":
        this.loadValue(instruction.value, instruction.span);
        this.addressLocal(instruction.local, instruction.span);
        this.emit("store [ecx], eax");
        return;
      case "store-memory":
        this.loadValue(instruction.address, instruction.span);
        this.emit("push eax");
        this.loadValue(instruction.value, instruction.span);
        this.emit(
          "mov ebx, eax",
          "pop ecx",
          `${storeMnemonic(instruction.width ?? 4)} [ecx], ebx`,
        );
        return;
      case "call":
        this.generateCall(instruction);
        return;
      case "indirect-call":
        this.generateIndirectCall(instruction);
    }
  }

  private generateBinary(
    instruction: Extract<Cs486IrInstruction, { readonly kind: "binary" }>,
  ): void {
    this.loadValue(instruction.left, instruction.span);
    this.emit("push eax");
    this.loadValue(instruction.right, instruction.span);
    this.emit("mov ebx, eax", "pop eax");
    const arithmetic = new Map<Cs486IrBinaryOperator, string>([
      ["add", "add"],
      ["and", "and"],
      ["div", "div"],
      ["udiv", "udiv"],
      ["mod", "mod"],
      ["umod", "umod"],
      ["mul", "mul"],
      ["or", "or"],
      ["shl", "shl"],
      ["shr", "shr"],
      ["ushr", "ushr"],
      ["sub", "sub"],
      ["xor", "xor"],
    ]);
    const operation = arithmetic.get(instruction.operator);
    if (operation !== undefined) this.emit(`${operation} eax, ebx`);
    else if (instruction.operator === "logical-and")
      this.emitLogicalCombination(false);
    else if (instruction.operator === "logical-or")
      this.emitLogicalCombination(true);
    else {
      if (["uge", "ugt", "ule", "ult"].includes(instruction.operator))
        this.emit("xor eax, -2147483648", "xor ebx, -2147483648");
      this.emitComparison(comparisonJump(instruction.operator));
    }
    this.storeResult(instruction.result, instruction.span);
  }

  private generateCall(instruction: Cs486IrCallInstruction): void {
    if (instruction.callee.startsWith(floatIntrinsicPrefix)) {
      if (instruction.arguments.length > 4 || instruction.result === undefined)
        throw cError(
          "CS floating intrinsic requires one to four words and a result",
          this.spanOf(instruction),
        );
      for (const argument of instruction.arguments) {
        this.loadValue(argument, instruction.span);
        this.emit("push eax");
      }
      const registers =
        instruction.arguments.length === 0
          ? []
          : instruction.arguments.length === 1
            ? ["eax"]
            : instruction.arguments.length === 2
              ? ["edx", "eax"]
              : instruction.arguments.length === 3
                ? ["ebx", "edx", "eax"]
                : ["ecx", "ebx", "edx", "eax"];
      for (const register of registers) this.emit(`pop ${register}`);
      this.emit(`syscall ${instruction.callee.slice(1)}`);
      if (instruction.wideResultLocal !== undefined) {
        this.addressLocal(instruction.wideResultLocal, instruction.span);
        this.emit("store [ecx], edx");
      }
      this.storeResult(instruction.result, instruction.span);
      return;
    }
    if (instruction.callee === csSyscallIntrinsic) {
      if (
        instruction.arguments.length !== 4 ||
        instruction.result === undefined
      )
        throw cError(
          "CS ABI syscall intrinsic requires four arguments and an integer result",
          this.spanOf(instruction),
        );
      for (const argument of instruction.arguments) {
        this.loadValue(argument, instruction.span);
        this.emit("push eax");
      }
      this.emit("pop esi", "pop edx", "pop ecx", "pop ebx", "syscall cs");
      this.storeResult(instruction.result, instruction.span);
      return;
    }
    if (instruction.callee === csVaStartIntrinsic) {
      const list = instruction.arguments[0];
      if (
        list === undefined ||
        instruction.arguments.length !== 1 ||
        instruction.result !== undefined ||
        this.currentFunction.variadic !== true
      )
        throw cError(
          "CS variadic-start intrinsic requires one pointer argument in a variadic function",
          this.spanOf(instruction),
        );
      const metadataByteOffset = 8 + this.currentFunction.parameters.length * 4;
      this.loadValue(list, instruction.span);
      this.emit(
        "mov ecx, eax",
        "mov ebx, ebp",
        `add ebx, ${String(metadataByteOffset)}`,
        "load eax, [ebx]",
        "add ecx, 4",
        "store [ecx], eax",
        "add ebx, 4",
        "mov eax, ebx",
        "sub ecx, 4",
        "store [ecx], eax",
      );
      return;
    }
    if (instruction.callee === printI32Intrinsic) {
      const value = instruction.arguments[0];
      if (value === undefined)
        throw cError(
          "CSIR print intrinsic is missing its value",
          this.spanOf(instruction),
        );
      this.loadValue(value, instruction.span);
      this.emit("print eax");
      return;
    }
    if (instruction.callee === printCharacterIntrinsic) {
      const value = instruction.arguments[0];
      if (value === undefined)
        throw cError(
          "CSIR character-print intrinsic is missing its value",
          this.spanOf(instruction),
        );
      this.loadValue(value, instruction.span);
      this.emit("syscall cs.print.character");
      return;
    }
    if (instruction.callee === printStringIntrinsic) {
      const value = instruction.arguments[0];
      if (value === undefined)
        throw cError(
          "CSIR string-print intrinsic is missing its value",
          this.spanOf(instruction),
        );
      const loop = this.label("printf_string_loop");
      const done = this.label("printf_string_done");
      this.loadValue(value, instruction.span);
      this.emit(
        "mov ecx, eax",
        `mov ebx, ${String(maximumPrintfStringReadWords)}`,
        `${loop}:`,
        "cmp ebx, 0",
        `je ${done}`,
        "load eax, [ecx]",
        "cmp eax, 0",
        `je ${done}`,
        "syscall cs.print.character",
        "add ecx, 4",
        "sub ebx, 1",
        `jmp ${loop}`,
        `${done}:`,
      );
      return;
    }
    if (instruction.callee === printNewlineIntrinsic) {
      this.emit('print "\\n"');
      return;
    }
    const inline = this.inlineAssembly.get(instruction.callee);
    if (inline !== undefined) {
      for (const instruction_ of inline) {
        if (instruction_.variable === undefined) this.emit(instruction_.source);
        else if (instruction_.variable.storage === "global")
          this.emit(instruction_.source);
        else {
          this.addressLocal(
            irLocalName(instruction_.variable),
            instruction_.variable.span,
          );
          this.emit(
            instruction_.source.replace(
              /\[([A-Za-z_]\w*)\]/gu,
              (match, name: string) =>
                name === instruction_.variable!.name ? "[ecx]" : match,
            ),
          );
        }
      }
      return;
    }
    const signature = this.callSignatures.get(instruction.callee);
    const fixedParameters = signature?.fixedParameters ?? 0;
    if (signature?.variadic === true) {
      for (
        let index = instruction.arguments.length - 1;
        index >= fixedParameters;
        index -= 1
      ) {
        this.loadValue(instruction.arguments[index]!, instruction.span);
        this.emit("push eax");
      }
      this.emit(
        `push ${String(instruction.arguments.length - fixedParameters)}`,
      );
      for (let index = fixedParameters - 1; index >= 0; index -= 1) {
        this.loadValue(instruction.arguments[index]!, instruction.span);
        this.emit("push eax");
      }
    } else {
      for (
        let index = instruction.arguments.length - 1;
        index >= 0;
        index -= 1
      ) {
        this.loadValue(instruction.arguments[index]!, instruction.span);
        this.emit("push eax");
      }
    }
    this.emit(`call ${instruction.callee}`);
    const pushedWords =
      instruction.arguments.length + (signature?.variadic === true ? 1 : 0);
    if (pushedWords > 0) this.emit(`add esp, ${String(pushedWords * 4)}`);
    if (instruction.wideResultLocal !== undefined) {
      this.addressLocal(instruction.wideResultLocal, instruction.span);
      this.emit("store [ecx], edx");
    }
    if (instruction.result !== undefined)
      this.storeResult(instruction.result, instruction.span);
  }

  private generateIndirectCall(
    instruction: Cs486IrIndirectCallInstruction,
  ): void {
    const signature = parseCs486FunctionSignature(
      instruction.functionSignature,
    );
    if (signature === undefined)
      throw cError(
        "CSIR indirect call lost its validated function signature",
        this.spanOf(instruction),
      );
    const fixedParameters = signature.parameterTypes.reduce(
      (words, type) => words + (type === "i64" || type === "f64" ? 2 : 1),
      0,
    );
    if (signature.variadic) {
      for (
        let index = instruction.arguments.length - 1;
        index >= fixedParameters;
        index -= 1
      ) {
        this.loadValue(instruction.arguments[index]!, instruction.span);
        this.emit("push eax");
      }
      this.emit(
        `push ${String(instruction.arguments.length - fixedParameters)}`,
      );
      for (let index = fixedParameters - 1; index >= 0; index -= 1) {
        this.loadValue(instruction.arguments[index]!, instruction.span);
        this.emit("push eax");
      }
    } else {
      for (
        let index = instruction.arguments.length - 1;
        index >= 0;
        index -= 1
      ) {
        this.loadValue(instruction.arguments[index]!, instruction.span);
        this.emit("push eax");
      }
    }
    this.loadValue(instruction.target, instruction.span);
    this.emit(`calli eax, ${JSON.stringify(instruction.functionSignature)}`);
    const pushedWords =
      instruction.arguments.length + (signature.variadic ? 1 : 0);
    if (pushedWords > 0) this.emit(`add esp, ${String(pushedWords * 4)}`);
    if (instruction.wideResultLocal !== undefined) {
      this.addressLocal(instruction.wideResultLocal, instruction.span);
      this.emit("store [ecx], edx");
    }
    if (instruction.result !== undefined)
      this.storeResult(instruction.result, instruction.span);
  }

  private generateTerminator(terminator: Cs486IrTerminator): void {
    switch (terminator.kind) {
      case "jump":
        this.emit(`jmp ${this.blockLabel(terminator.target)}`);
        return;
      case "branch":
        this.loadValue(terminator.condition, terminator.span);
        this.emit(
          "cmp eax, 0",
          `jne ${this.blockLabel(terminator.trueTarget)}`,
          `jmp ${this.blockLabel(terminator.falseTarget)}`,
        );
        return;
      case "return":
        if (terminator.value === undefined) this.emit("mov eax, 0");
        else if (terminator.valueHigh === undefined)
          this.loadValue(terminator.value, terminator.span);
        else {
          this.loadValue(terminator.valueHigh, terminator.span);
          this.emit("push eax");
          this.loadValue(terminator.value, terminator.span);
          this.emit("pop edx");
        }
        this.emit(`jmp ${this.epilogue}`);
    }
  }

  private emitComparison(jump: string): void {
    const truthy = this.label("compare.true");
    const done = this.label("compare.done");
    this.emit(
      "cmp eax, ebx",
      "mov eax, 0",
      `${jump} ${truthy}`,
      `jmp ${done}`,
      `${truthy}:`,
      "mov eax, 1",
      `${done}:`,
    );
  }

  private emitBooleanFromZero(jump: string): void {
    const truthy = this.label("boolean.true");
    const done = this.label("boolean.done");
    this.emit(
      "cmp eax, 0",
      "mov eax, 0",
      `${jump} ${truthy}`,
      `jmp ${done}`,
      `${truthy}:`,
      "mov eax, 1",
      `${done}:`,
    );
  }

  private emitLogicalCombination(or: boolean): void {
    const truthy = this.label("logical.true");
    const falsy = this.label("logical.false");
    const done = this.label("logical.done");
    this.emit("cmp eax, 0");
    this.emit(`${or ? "jne" : "je"} ${or ? truthy : falsy}`);
    this.emit("cmp ebx, 0");
    this.emit(`${or ? "jne" : "je"} ${or ? truthy : falsy}`);
    this.emit(
      `jmp ${or ? falsy : truthy}`,
      `${truthy}:`,
      "mov eax, 1",
      `jmp ${done}`,
      `${falsy}:`,
      "mov eax, 0",
      `${done}:`,
    );
  }

  private loadValue(value: Cs486IrValueId, span?: Cs486SourceSpan): void {
    const location = this.location(value, span);
    if (location.kind === "register") {
      this.emit(`mov eax, ${location.register}`);
      return;
    }
    this.addressOffset(-location.byteOffset + 8, span);
    this.emit("load eax, [ecx]");
  }

  private storeResult(value: Cs486IrValueId, span?: Cs486SourceSpan): void {
    const location = this.location(value, span);
    if (location.kind === "register") {
      this.emit(`mov ${location.register}, eax`);
      return;
    }
    this.addressOffset(-location.byteOffset + 8, span);
    this.emit("store [ecx], eax");
  }

  private location(
    value: Cs486IrValueId,
    span?: Cs486SourceSpan,
  ): Cs486IrValueLocation {
    const location = this.allocation.locations.get(value);
    if (location === undefined)
      throw cError(
        `CSIR value ${String(value)} has no register allocation`,
        span ?? this.currentSourceSpan(),
      );
    return location;
  }

  private addressLocal(name: string, span?: Cs486SourceSpan): void {
    const index = this.currentFunction.locals.findIndex(
      (local) => local.name === name,
    );
    if (index < 0)
      throw cError(
        `CSIR local ${name} has no stack slot`,
        span ?? this.currentSourceSpan(),
      );
    this.addressOffset(8 + (index + 1) * 4, span);
  }

  private addressOffset(offset: number, span?: Cs486SourceSpan): void {
    if (!Number.isSafeInteger(offset) || offset <= 0)
      throw cError(
        "invalid CSIR stack slot offset",
        span ?? this.currentSourceSpan(),
      );
    this.emit("mov ecx, ebp", `sub ecx, ${String(offset)}`);
  }

  private blockLabel(id: string): string {
    const label = this.blockLabels.get(id);
    if (label === undefined)
      throw cError(
        `CSIR block ${id} has no assembly label`,
        this.currentSourceSpan(),
      );
    return label;
  }

  private spanOf(instruction: Cs486IrInstruction): Cs486SourceSpan {
    return instruction.span ?? this.currentSourceSpan();
  }

  private currentSourceSpan(): Cs486SourceSpan {
    const span = this.currentFunction.span;
    if (span === undefined) throw new Error("CSIR function has no source span");
    return span;
  }

  private label(kind: string): string {
    return `.L_c_${kind}_${String(this.nextLabel++)}`;
  }

  private emit(...lines: readonly string[]): void {
    this.assembly.push(...lines);
  }
}

function collectFunctionVariables(
  definition: CFunctionDefinition,
): readonly CVariable[] {
  const variables = new Set<CVariable>();
  const record = (variable: CVariable): void => {
    if (variable.storage === "global") return;
    if (
      variable.slot < 1 ||
      variable.words < 1 ||
      variable.slot + variable.words - 1 > definition.localCount
    )
      throw cError("invalid C-family local slot", variable.span);
    variables.add(variable);
  };
  const expression = (value: CExpression): void => {
    switch (value.kind) {
      case "variable":
        record(value.variable);
        return;
      case "binary":
        expression(value.left);
        expression(value.right);
        return;
      case "unary":
        expression(value.operand);
        return;
      case "cast":
        expression(value.expression);
        return;
      case "index":
        expression(value.base);
        expression(value.index);
        return;
      case "member":
        expression(value.base);
        return;
      case "ternary":
        expression(value.condition);
        expression(value.whenTrue);
        expression(value.whenFalse);
        return;
      case "call":
        for (const argument of value.arguments) expression(argument);
        return;
      case "indirect-call":
        expression(value.callee);
        for (const argument of value.arguments) expression(argument);
        return;
      case "function":
        return;
      case "compound":
        record(value.variable);
        for (const initialized of value.initializer) {
          if (isInitializerAtom(initialized)) {
            if (
              typeof initialized.value === "object" &&
              !Array.isArray(initialized.value)
            )
              expression(initialized.value as CExpression);
          } else if (typeof initialized === "object") expression(initialized);
        }
        return;
      case "integer":
      case "string":
        return;
    }
  };
  const statement = (value: CStatement): void => {
    switch (value.kind) {
      case "block":
        for (const child of value.statements) statement(child);
        return;
      case "declaration":
        record(value.variable);
        if (value.initializer !== undefined) expression(value.initializer);
        for (const initialized of value.aggregateInitializer ?? []) {
          if (isInitializerAtom(initialized)) {
            if (
              typeof initialized.value === "object" &&
              !Array.isArray(initialized.value)
            )
              expression(initialized.value as CExpression);
          } else if (typeof initialized === "object") expression(initialized);
        }
        return;
      case "assignment":
        expression(value.target);
        expression(value.expression);
        return;
      case "call":
      case "print":
        expression(value.expression);
        return;
      case "formatted-print":
        for (const part of value.parts)
          if (part.kind === "conversion") expression(part.expression);
        return;
      case "return":
        if (value.expression !== undefined) expression(value.expression);
        return;
      case "for":
        record(value.variable);
        statement(value.initializer);
        expression(value.bound);
        statement(value.body);
        return;
      case "if":
        expression(value.condition);
        statement(value.thenBranch);
        if (value.elseBranch !== undefined) statement(value.elseBranch);
        return;
      case "while":
      case "do-while":
        expression(value.condition);
        statement(value.body);
        return;
      case "switch":
        expression(value.expression);
        statement(value.body);
        return;
      case "case":
      case "default":
      case "break":
      case "continue":
        return;
      case "inline-assembly":
        for (const instruction of value.instructions)
          if (instruction.variable !== undefined) record(instruction.variable);
    }
  };
  for (const parameter of definition.parameters) record(parameter);
  statement(definition.body);
  const complete = [...variables].sort((left, right) => left.slot - right.slot);
  const occupied = new Set<number>();
  for (const variable of complete)
    for (let word = 0; word < variable.words; word += 1) {
      const slot = variable.slot + word;
      if (occupied.has(slot))
        throw cError("duplicate C-family local slot", variable.span);
      occupied.add(slot);
    }
  for (let slot = 1; slot <= definition.localCount; slot += 1)
    if (!occupied.has(slot))
      throw cError(
        `C-family local slot ${String(slot)} is missing`,
        definition.nameSpan,
      );
  return complete;
}

function irLocalName(variable: CVariable): string {
  return irLocalWordName(variable, 0);
}

function irLocalWordName(variable: CVariable, word: number): string {
  return `l${String(variable.slot + word)}.${variable.name}${word === 0 ? "" : `.${String(word)}`}`;
}

function isQualifierToken(token: CToken): boolean {
  return (
    token.value === "const" ||
    token.value === "restrict" ||
    token.value === "volatile"
  );
}

function hasQualifiers(qualifiers: CQualifiers): boolean {
  return (
    qualifiers.const === true ||
    qualifiers.restrict === true ||
    qualifiers.volatile === true
  );
}

function mergeQualifiers(...values: readonly CQualifiers[]): CQualifiers {
  return {
    ...(values.some((value) => value.const === true) ? { const: true } : {}),
    ...(values.some((value) => value.restrict === true)
      ? { restrict: true }
      : {}),
    ...(values.some((value) => value.volatile === true)
      ? { volatile: true }
      : {}),
  };
}

function sameQualifiers(left: CQualifiers, right: CQualifiers): boolean {
  return (
    left.const === right.const &&
    left.restrict === right.restrict &&
    left.volatile === right.volatile
  );
}

function requireValidQualifiers(
  type: CType,
  qualifiers: CQualifiers,
  span: Cs486SourceSpan,
): void {
  if (qualifiers.restrict === true && !isPointerType(type))
    throw cError("restrict qualifier requires a pointer type", span);
}

function isPointerType(type: CType): type is CPointerType {
  return typeof type === "object" && type.kind === "pointer";
}

function isArrayType(type: CType): type is CArrayType {
  return typeof type === "object" && type.kind === "array";
}

function isStructType(type: CType | undefined): type is CStructType {
  return typeof type === "object" && type.kind === "struct";
}

function isUnionType(type: CType | undefined): type is CUnionType {
  return typeof type === "object" && type.kind === "union";
}

function isAggregateType(type: CType | undefined): type is CAggregateType {
  return isStructType(type) || isUnionType(type);
}

function isFunctionType(type: CType | undefined): type is CFunctionType {
  return typeof type === "object" && type.kind === "function";
}

function functionTypeOfSymbol(symbol: CFunctionSymbol): CFunctionType {
  if (isFunctionType(symbol.returnType))
    throw new Error("validated function symbol has a function return type");
  return {
    kind: "function",
    parameterTypes: symbol.parameterTypes,
    returnType: symbol.returnType,
    variadic: symbol.variadic,
  };
}

function isIntegerType(type: CType): type is CIntegerType {
  return (
    typeof type === "string" &&
    type !== "void" &&
    type !== "float" &&
    type !== "double"
  );
}

function isFloatingType(type: CType): type is CFloatingType {
  return type === "float" || type === "double";
}

function floatingFormat(type: CFloatingType): CsFloatFormat {
  return type === "float" ? "binary32" : "binary64";
}

function isUnsignedIntegerType(type: CIntegerType): boolean {
  return type === "_Bool" || type.startsWith("unsigned ");
}

function isWideIntegerType(
  type: CType,
): type is "long long" | "unsigned long long" {
  return type === "long long" || type === "unsigned long long";
}

function isWideValueType(
  type: CType,
): type is "double" | "long long" | "unsigned long long" {
  return type === "double" || isWideIntegerType(type);
}

function cMemoryAccess(
  type: CObjectType,
  dataModel: Cs486DataModel,
): { readonly signed?: true; readonly width: 1 | 2 | 4 } {
  if (dataModel === cs486Word32DataModel || !isIntegerType(type))
    return { width: 4 };
  if (type === "char" || type === "signed char")
    return { signed: true, width: 1 };
  if (type === "_Bool" || type === "unsigned char") return { width: 1 };
  if (type === "short") return { signed: true, width: 2 };
  if (type === "unsigned short") return { width: 2 };
  return { width: 4 };
}

function loadMnemonic(width: 1 | 2 | 4, signed: boolean): string {
  if (width === 1) return signed ? "load8s" : "load8u";
  if (width === 2) return signed ? "load16s" : "load16u";
  return "load";
}

function storeMnemonic(width: 1 | 2 | 4): string {
  return width === 1 ? "store8" : width === 2 ? "store16" : "store";
}

function integerRank(type: CIntegerType): number {
  if (type === "_Bool") return 0;
  if (type.endsWith("char") || type === "char") return 1;
  if (type.endsWith("short") || type === "short") return 2;
  if (type.endsWith("long long") || type === "long long") return 5;
  if (type.endsWith("long") || type === "long") return 4;
  return 3;
}

function integerPromotion(type: CIntegerType): CIntegerType {
  if (integerRank(type) >= integerRank("int")) return type;
  return isUnsignedIntegerType(type) && type !== "_Bool"
    ? "unsigned int"
    : "int";
}

function unsignedIntegerType(type: CIntegerType): CIntegerType {
  switch (type) {
    case "long long":
    case "unsigned long long":
      return "unsigned long long";
    case "long":
    case "unsigned long":
      return "unsigned long";
    default:
      return "unsigned int";
  }
}

function usualArithmeticType(
  left: CIntegerType,
  right: CIntegerType,
): CIntegerType {
  const promotedLeft = integerPromotion(left);
  const promotedRight = integerPromotion(right);
  if (promotedLeft === promotedRight) return promotedLeft;
  const leftUnsigned = isUnsignedIntegerType(promotedLeft);
  const rightUnsigned = isUnsignedIntegerType(promotedRight);
  if (leftUnsigned === rightUnsigned)
    return integerRank(promotedLeft) >= integerRank(promotedRight)
      ? promotedLeft
      : promotedRight;
  const unsigned = leftUnsigned ? promotedLeft : promotedRight;
  const signed = leftUnsigned ? promotedRight : promotedLeft;
  if (integerRank(unsigned) >= integerRank(signed)) return unsigned;
  // All non-_Bool integer ranks in the CS word profile have the same 32-bit
  // value width until the explicit two-word long-long tier. A higher-ranked
  // signed one-word type therefore cannot represent every lower unsigned value.
  if (integerRank(signed) < integerRank("long long"))
    return unsignedIntegerType(signed);
  return signed;
}

function sameCType(left: CType, right: CType): boolean {
  if (typeof left === "string" || typeof right === "string")
    return left === right;
  if (left.kind !== right.kind) return false;
  if (left.kind === "pointer" && right.kind === "pointer")
    return (
      sameQualifiers(left.toQualifiers ?? {}, right.toQualifiers ?? {}) &&
      sameCType(left.to, right.to)
    );
  if (left.kind === "array" && right.kind === "array")
    return (
      left.length === right.length &&
      left.flexible === right.flexible &&
      sameCType(left.element, right.element)
    );
  if (left.kind === "struct" && right.kind === "struct") return left === right;
  if (left.kind === "union" && right.kind === "union") return left === right;
  if (left.kind === "function" && right.kind === "function")
    return (
      left.variadic === right.variadic &&
      sameCType(left.returnType, right.returnType) &&
      sameTypes(left.parameterTypes, right.parameterTypes)
    );
  return false;
}

function decayCType(type: CType): CType {
  if (isArrayType(type)) return { kind: "pointer", to: type.element };
  if (isFunctionType(type)) return { kind: "pointer", to: type };
  return type;
}

function cTypeSizeBytes(
  type: CObjectType,
  span: Cs486SourceSpan,
  dataModel: Cs486DataModel,
): number {
  if (type === "double") return 8;
  if (type === "float") return 4;
  if (isWideIntegerType(type)) return 8;
  if (isPointerType(type)) return 4;
  if (isIntegerType(type)) {
    if (dataModel === cs486Word32DataModel) return 4;
    if (type === "_Bool" || type === "char" || type.endsWith(" char")) return 1;
    if (type === "short" || type === "unsigned short") return 2;
    return 4;
  }
  if (isAggregateType(type)) {
    if (!type.complete)
      throw cError(`incomplete ${type.kind} ${type.name}`, span);
    if (type.sizeBytes <= 0 || type.sizeBytes > 65_536)
      throw cError("aggregate byte limit exceeded", span);
    return type.sizeBytes;
  }
  if (type.flexible === true) return 0;
  const bytes = cTypeSizeBytes(type.element, span, dataModel) * type.length;
  if (!Number.isSafeInteger(bytes) || bytes <= 0 || bytes > 65_536)
    throw cError("aggregate byte limit exceeded", span);
  return bytes;
}

function cTypeSizeUnits(
  type: CObjectType,
  span: Cs486SourceSpan,
  dataModel: Cs486DataModel,
): number {
  return cTypeSizeBytes(type, span, dataModel) / cAddressUnitBytes(dataModel);
}

function cTypeStorageWords(
  type: CObjectType,
  span: Cs486SourceSpan,
  dataModel: Cs486DataModel,
): number {
  return Math.ceil(cTypeSizeBytes(type, span, dataModel) / 4);
}

function cTypeAlignmentBytes(
  type: CObjectType,
  span: Cs486SourceSpan,
  dataModel: Cs486DataModel,
): number {
  if (isAggregateType(type)) {
    if (!type.complete)
      throw cError(`incomplete ${type.kind} ${type.name}`, span);
    return type.alignmentBytes;
  }
  if (isArrayType(type))
    return cTypeAlignmentBytes(type.element, span, dataModel);
  if (dataModel === cs486Word32DataModel) return 4;
  if (isIntegerType(type)) {
    if (type === "_Bool" || type === "char" || type.endsWith(" char")) return 1;
    if (type === "short" || type === "unsigned short") return 2;
  }
  return 4;
}

function cAddressUnitBytes(dataModel: Cs486DataModel): 1 | 4 {
  return dataModel === cs486Word32DataModel ? 4 : 1;
}

function alignInteger(value: number, alignment: number): number {
  return Math.ceil(value / alignment) * alignment;
}

function chunkNumbers(
  values: readonly number[],
  size: number,
): readonly (readonly number[])[] {
  const chunks: number[][] = [];
  for (let offset = 0; offset < values.length; offset += size)
    chunks.push(values.slice(offset, offset + size));
  return chunks;
}

function renderByteGlobalInitializer(global: CGlobalVariable): string[] {
  const size = cTypeSizeBytes(global.type, global.span, cs486Byte8DataModel);
  const bytes = Array<number>(size).fill(0);
  const relocations = new Map<number, string>();
  const occupied = new Set<number>();
  const writeNumber = (offset: number, width: number, value: number): void => {
    const bits = BigInt.asUintN(width * 8, BigInt(value));
    for (let byte = 0; byte < width; byte += 1) {
      if (offset + byte >= size)
        throw cError("initializer exceeds byte-profile storage", global.span);
      bytes[offset + byte] = Number((bits >> BigInt(byte * 8)) & 0xffn);
      occupied.add(offset + byte);
    }
  };
  for (const [offset, initialized] of global.initializer!.entries()) {
    if (occupied.has(offset)) continue;
    if (isInitializerAtom(initialized)) {
      const width = cTypeSizeBytes(
        initialized.type,
        global.span,
        cs486Byte8DataModel,
      );
      if (isWideInitializerValue(initialized.value)) {
        writeNumber(offset, 4, initialized.value[0]);
        writeNumber(offset + 4, 4, initialized.value[1]);
      } else if (typeof initialized.value === "string") {
        if (width !== 4 || offset + 4 > size)
          throw cError("invalid byte-profile address initializer", global.span);
        relocations.set(offset, initialized.value);
        for (let byte = 0; byte < 4; byte += 1) occupied.add(offset + byte);
      } else if (typeof initialized.value === "number") {
        writeNumber(offset, width, initialized.value);
      } else {
        throw cError("global initializer is not constant", global.span);
      }
      continue;
    }
    if (typeof initialized !== "number")
      throw cError("invalid byte-profile global initializer", global.span);
    writeNumber(offset, 1, initialized);
  }

  const lines: string[] = [];
  let offset = 0;
  while (offset < size) {
    const relocation = relocations.get(offset);
    if (relocation !== undefined) {
      lines.push(`dd ${relocation}`);
      offset += 4;
      continue;
    }
    const values: number[] = [];
    while (
      offset < size &&
      relocations.get(offset) === undefined &&
      values.length < 64
    )
      values.push(bytes[offset++]!);
    lines.push(`db ${values.join(", ")}`);
  }
  return lines;
}

function cPointerStrideBytes(
  pointer: CPointerType,
  span: Cs486SourceSpan,
  dataModel: Cs486DataModel,
): number {
  if (pointer.to === "void")
    throw cError("void pointer arithmetic is not supported", span);
  if (isFunctionType(pointer.to))
    throw cError("function pointer arithmetic is not supported", span);
  return cTypeSizeBytes(pointer.to, span, dataModel);
}

function expressionType(expression: CExpression): CType {
  return expression.kind === "call" || expression.kind === "indirect-call"
    ? expression.returnType
    : expression.type;
}

function isLvalueExpression(
  expression: CExpression,
): expression is Extract<
  CExpression,
  | { readonly kind: "compound" | "index" | "member" | "variable" }
  | { readonly kind: "unary" }
> {
  return (
    expression.kind === "variable" ||
    expression.kind === "compound" ||
    expression.kind === "index" ||
    expression.kind === "member" ||
    (expression.kind === "unary" && expression.operator === "*")
  );
}

function lvalueQualifiers(expression: CExpression): CQualifiers {
  if (expression.kind === "variable")
    return expression.variable.qualifiers ?? {};
  if (expression.kind === "compound")
    return expression.variable.qualifiers ?? {};
  if (expression.kind === "unary" && expression.operator === "*") {
    const pointer = decayCType(expressionType(expression.operand));
    return isPointerType(pointer) ? (pointer.toQualifiers ?? {}) : {};
  }
  if (expression.kind === "index") {
    const pointer = decayCType(expressionType(expression.base));
    return mergeQualifiers(
      isPointerType(pointer) ? (pointer.toQualifiers ?? {}) : {},
      expression.base.kind === "variable" && isArrayType(expression.base.type)
        ? (expression.base.variable.qualifiers ?? {})
        : {},
    );
  }
  if (expression.kind === "member") {
    const baseQualifiers = expression.throughPointer
      ? ((): CQualifiers => {
          const pointer = decayCType(expressionType(expression.base));
          return isPointerType(pointer) ? (pointer.toQualifiers ?? {}) : {};
        })()
      : lvalueQualifiers(expression.base);
    return mergeQualifiers(baseQualifiers, expression.field.qualifiers ?? {});
  }
  return {};
}

function requireIntegerType(
  type: CType,
  span: Cs486SourceSpan,
): asserts type is CIntegerType {
  if (!isIntegerType(type)) throw cError("integer operand required", span);
}

function requireScalarType(type: CType, span: Cs486SourceSpan): void {
  if (!isIntegerType(type) && !isFloatingType(type) && !isPointerType(type))
    throw cError("scalar operand required", span);
}

function requireAssignable(
  target: CType,
  value: CType,
  span: Cs486SourceSpan,
): void {
  const targetType = decayCType(target);
  const valueType = decayCType(value);
  if (
    ((isIntegerType(targetType) || isFloatingType(targetType)) &&
      (isIntegerType(valueType) || isFloatingType(valueType))) ||
    (isPointerType(targetType) &&
      isPointerType(valueType) &&
      pointerTargetAssignable(targetType, valueType))
  )
    return;
  throw cError("incompatible assignment types", span);
}

function pointerTargetAssignable(
  target: CPointerType,
  value: CPointerType,
): boolean {
  const targetQualifiers = target.toQualifiers ?? {};
  const valueQualifiers = value.toQualifiers ?? {};
  const preservesQualifiers =
    (valueQualifiers.const !== true || targetQualifiers.const === true) &&
    (valueQualifiers.volatile !== true || targetQualifiers.volatile === true);
  return (
    preservesQualifiers &&
    (target.to === "void" ||
      value.to === "void" ||
      sameCType(target.to, value.to))
  );
}

function requireExpressionAssignable(
  target: CType,
  expression: CExpression,
): void {
  const targetType = decayCType(target);
  if (isPointerType(targetType) && isNullPointerConstant(expression)) return;
  requireAssignable(
    targetType,
    decayCType(expressionType(expression)),
    expression.span,
  );
}

function isNullPointerConstant(expression: CExpression): boolean {
  return expression.kind === "integer" && expression.value === 0;
}

function binaryExpressionType(
  left: CExpression,
  operator: CBinaryOperator,
  right: CExpression,
): CObjectType {
  const leftType = decayCType(expressionType(left));
  const rightType = decayCType(expressionType(right));
  const comparison = comparisonOperators.has(operator);
  if (operator === "&&" || operator === "||") {
    requireScalarType(leftType, left.span);
    requireScalarType(rightType, right.span);
    return "int";
  }
  if (comparison) {
    if (
      ((isIntegerType(leftType) || isFloatingType(leftType)) &&
        (isIntegerType(rightType) || isFloatingType(rightType))) ||
      (isPointerType(leftType) && isNullPointerConstant(right)) ||
      (isPointerType(rightType) && isNullPointerConstant(left)) ||
      (isPointerType(leftType) &&
        isPointerType(rightType) &&
        (leftType.to === "void" ||
          rightType.to === "void" ||
          sameCType(leftType.to, rightType.to)))
    )
      return "int";
    throw cError("incompatible comparison operands", left.span);
  }
  if (operator === "+" || operator === "-") {
    if (isPointerType(leftType) && isIntegerType(rightType)) return leftType;
    if (operator === "+" && isIntegerType(leftType) && isPointerType(rightType))
      return rightType;
    if (
      operator === "-" &&
      isPointerType(leftType) &&
      isPointerType(rightType) &&
      sameCType(leftType.to, rightType.to)
    )
      return "long";
  }
  if (isFloatingType(leftType) || isFloatingType(rightType)) {
    if (
      !["+", "-", "*", "/"].includes(operator) ||
      (!isIntegerType(leftType) && !isFloatingType(leftType)) ||
      (!isIntegerType(rightType) && !isFloatingType(rightType))
    )
      throw cError("floating operands require +, -, *, or /", left.span);
    return leftType === "double" || rightType === "double" ? "double" : "float";
  }
  requireIntegerType(leftType, left.span);
  requireIntegerType(rightType, right.span);
  if (operator === "<<" || operator === ">>") {
    const constantShift = evaluateCConstantExpression(right);
    const promotedLeft = integerPromotion(leftType);
    if (
      constantShift !== undefined &&
      (constantShift < 0 || constantShift >= cIntegerWidth(promotedLeft))
    )
      throw cError(
        `shift count must be between 0 and ${String(cIntegerWidth(promotedLeft) - 1)}`,
        right.span,
      );
    return promotedLeft;
  }
  return usualArithmeticType(leftType, rightType);
}

function conditionalExpressionType(
  whenTrue: CExpression,
  whenFalse: CExpression,
): CObjectType {
  const trueType = decayCType(expressionType(whenTrue));
  const falseType = decayCType(expressionType(whenFalse));
  if (isIntegerType(trueType) && isIntegerType(falseType))
    return usualArithmeticType(trueType, falseType);
  if (
    (isIntegerType(trueType) || isFloatingType(trueType)) &&
    (isIntegerType(falseType) || isFloatingType(falseType)) &&
    (isFloatingType(trueType) || isFloatingType(falseType))
  )
    return trueType === "double" || falseType === "double" ? "double" : "float";
  if (isPointerType(trueType) && isNullPointerConstant(whenFalse))
    return trueType;
  if (isPointerType(falseType) && isNullPointerConstant(whenTrue))
    return falseType;
  if (
    isPointerType(trueType) &&
    isPointerType(falseType) &&
    (trueType.to === "void" ||
      falseType.to === "void" ||
      sameCType(trueType.to, falseType.to))
  )
    return trueType.to === "void" ? trueType : falseType;
  throw cError("incompatible conditional expression types", whenFalse.span);
}

function variableExpression(
  variable: CVariable,
  span: Cs486SourceSpan,
): Extract<CExpression, { readonly kind: "variable" }> {
  return { kind: "variable", span, type: variable.type, variable };
}

function initializerVariable(
  initializer: Extract<
    CStatement,
    { readonly kind: "assignment" | "declaration" }
  >,
): CVariable | undefined {
  return initializer.kind === "declaration"
    ? initializer.variable
    : initializer.target.kind === "variable"
      ? initializer.target.variable
      : undefined;
}

function cTypeToIr(type: CType): Cs486IrReturnType {
  return type === "void" ? "void" : "i32";
}

function cTypeToPhysicalIr(type: CObjectType): readonly "i32"[] {
  return isWideValueType(type) ? ["i32", "i32"] : ["i32"];
}

function cFunctionSignature(type: CFunctionType): Cs486FunctionSignature {
  return createCs486FunctionSignature(
    type.parameterTypes.map(cFunctionAbiType),
    type.returnType === "void" ? "void" : cFunctionAbiType(type.returnType),
    type.variadic,
  );
}

function cFunctionAbiType(type: CObjectType): "f32" | "f64" | "i32" | "i64" {
  if (type === "float") return "f32";
  if (type === "double") return "f64";
  return isWideIntegerType(type) ? "i64" : "i32";
}

function binaryOperatorToIr(
  operator: Exclude<CBinaryOperator, "&&" | "||">,
  leftType: CType,
  rightType: CType,
): Cs486IrBinaryOperator {
  const unsigned =
    isIntegerType(leftType) &&
    isIntegerType(rightType) &&
    isUnsignedIntegerType(
      operator === "<<" || operator === ">>"
        ? integerPromotion(leftType)
        : usualArithmeticType(leftType, rightType),
    );
  if (unsigned) {
    const unsignedOperation = {
      "%": "umod",
      "/": "udiv",
      "<": "ult",
      "<=": "ule",
      ">": "ugt",
      ">=": "uge",
      ">>": "ushr",
    } as const;
    const selected = unsignedOperation[
      operator as keyof typeof unsignedOperation
    ] as Cs486IrBinaryOperator | undefined;
    if (selected !== undefined) return selected;
  }
  return (
    {
      "!=": "ne",
      "%": "mod",
      "&": "and",
      "*": "mul",
      "+": "add",
      "-": "sub",
      "/": "div",
      "<": "lt",
      "<<": "shl",
      "<=": "le",
      "==": "eq",
      ">": "gt",
      ">=": "ge",
      ">>": "shr",
      "^": "xor",
      "|": "or",
    } as const
  )[operator];
}

function comparisonToIr(operator: ComparisonOperator): Cs486IrBinaryOperator {
  return ({ "<": "lt", "<=": "le", ">": "gt", ">=": "ge" } as const)[operator];
}

function comparisonOperation(
  operator: CBinaryOperator,
): "eq" | "ge" | "gt" | "le" | "lt" | "ne" {
  if (
    operator === "==" ||
    operator === "!=" ||
    operator === "<" ||
    operator === "<=" ||
    operator === ">" ||
    operator === ">="
  )
    return (
      {
        "!=": "ne",
        "<": "lt",
        "<=": "le",
        "==": "eq",
        ">": "gt",
        ">=": "ge",
      } as const
    )[operator];
  throw new Error(`not a comparison operator: ${operator}`);
}

function comparisonJump(operator: Cs486IrBinaryOperator): string {
  switch (operator) {
    case "eq":
      return "je";
    case "ge":
    case "uge":
      return "jge";
    case "gt":
    case "ugt":
      return "jg";
    case "le":
    case "ule":
      return "jle";
    case "lt":
    case "ult":
      return "jl";
    case "ne":
      return "jne";
    default:
      throw new Error(`CSIR operator ${operator} is not a comparison`);
  }
}

function isScalarTypeSpecifier(token: CToken): boolean {
  return (
    token.kind === "identifier" &&
    [
      "_Bool",
      "char",
      "double",
      "float",
      "int",
      "long",
      "short",
      "signed",
      "unsigned",
    ].includes(token.value)
  );
}

function isFloatingLiteralToken(value: string): boolean {
  if (/^0[xX]/u.test(value)) return /[.pP]/u.test(value);
  return /[.eE]/u.test(value) || /[fF]$/u.test(value);
}

function parsePositiveArrayLength(token: CToken): number {
  const value = parseInteger(token);
  if (value <= 0) throw cError("array length must be positive", token.span);
  return value;
}

function parseInteger(token: CToken): number {
  const magnitude = parseIntegerLiteral(token).magnitude;
  if (magnitude > BigInt(Number.MAX_SAFE_INTEGER))
    throw cError(
      "integer constant is too large for this bounded context",
      token.span,
    );
  return Number(magnitude);
}

function parseIntegerLiteral(token: CToken): {
  readonly highValue?: number;
  readonly magnitude: bigint;
  readonly type: CIntegerType;
  readonly value: number;
} {
  const match =
    /^(0[xX][0-9a-fA-F]+|0[bB][01]+|0[0-7]*|[1-9][0-9]*)([uUlL]*)$/u.exec(
      token.value,
    );
  if (match === null)
    throw cError("invalid bounded integer literal", token.span);
  const digits = match[1]!;
  const suffix = match[2]!.toLowerCase();
  if (!["", "l", "ll", "llu", "lu", "u", "ul", "ull"].includes(suffix))
    throw cError("invalid integer literal suffix", token.span);
  let magnitude: bigint;
  try {
    magnitude = BigInt(
      /^0[0-7]+$/u.test(digits) ? `0o${digits.slice(1)}` : digits,
    );
  } catch {
    throw cError("invalid bounded integer literal", token.span);
  }
  if (magnitude > 0xffff_ffff_ffff_ffffn)
    throw cError(
      "integer literal is outside the bounded 64-bit tier",
      token.span,
    );
  const unsigned = suffix.includes("u");
  const longCount = suffix.includes("ll") ? 2 : suffix.includes("l") ? 1 : 0;
  const decimal = /^[1-9]/u.test(digits);
  let type: CIntegerType;
  if (longCount === 2) type = unsigned ? "unsigned long long" : "long long";
  else if (longCount === 1)
    type = unsigned
      ? magnitude <= 0xffff_ffffn
        ? "unsigned long"
        : "unsigned long long"
      : magnitude <= 0x7fff_ffffn
        ? "long"
        : "long long";
  else if (unsigned)
    type = magnitude <= 0xffff_ffffn ? "unsigned int" : "unsigned long long";
  else if (magnitude > 0x7fff_ffffn && !decimal)
    type =
      magnitude <= 0xffff_ffffn
        ? "unsigned int"
        : magnitude <= 0x7fff_ffff_ffff_ffffn
          ? "long long"
          : "unsigned long long";
  else if (magnitude <= 0x7fff_ffffn) type = "int";
  else if (magnitude <= 0x7fff_ffff_ffff_ffffn) type = "long long";
  else type = "unsigned long long";
  const maximum = isWideIntegerType(type)
    ? isUnsignedIntegerType(type)
      ? 0xffff_ffff_ffff_ffffn
      : 0x7fff_ffff_ffff_ffffn
    : isUnsignedIntegerType(type)
      ? 0xffff_ffffn
      : 0x7fff_ffffn;
  if (magnitude > maximum)
    throw cError(`integer literal is outside its ${type} range`, token.span);
  return {
    ...(isWideIntegerType(type)
      ? { highValue: Number((magnitude >> 32n) & 0xffff_ffffn) | 0 }
      : {}),
    magnitude,
    type,
    value: Number(magnitude & 0xffff_ffffn) | 0,
  };
}

function evaluateCConstantExpression(
  expression: CExpression,
): number | undefined {
  const value = evaluateCConstantInteger(expression);
  if (value === undefined) return undefined;
  const numeric = constantIntegerNumericValue(value);
  return numeric < BigInt(Number.MIN_SAFE_INTEGER) ||
    numeric > BigInt(Number.MAX_SAFE_INTEGER)
    ? undefined
    : Number(numeric);
}

interface CConstantInteger {
  readonly bits: bigint;
  readonly type: CIntegerType;
}

function evaluateCConstantFloating(
  expression: CExpression,
  target: CFloatingType,
  depth = 0,
): bigint | undefined {
  const value = evaluateCFloatBits(expression, depth);
  if (value === undefined) return undefined;
  const destination = floatingFormat(target);
  return value.format === destination
    ? value.bits
    : csFloatConvert(value.format, destination, value.bits).bits;
}

function evaluateCFloatBits(
  expression: CExpression,
  depth: number,
): { readonly bits: bigint; readonly format: CsFloatFormat } | undefined {
  if (depth > maximumExpressionDepth) return undefined;
  switch (expression.kind) {
    case "floating":
      return {
        bits:
          BigInt(expression.value >>> 0) |
          (BigInt(
            expression.highValue === undefined ? 0 : expression.highValue >>> 0,
          ) <<
            32n),
        format: floatingFormat(expression.type),
      };
    case "integer": {
      const integer = evaluateCConstantInteger(expression, depth + 1);
      if (integer === undefined) return undefined;
      const numeric = constantIntegerNumericValue(integer);
      return {
        bits: (isUnsignedIntegerType(integer.type)
          ? csFloatFromUnsignedInteger("binary64", numeric)
          : csFloatFromSignedInteger("binary64", numeric)
        ).bits,
        format: "binary64",
      };
    }
    case "cast": {
      if (!isFloatingType(expression.type)) return undefined;
      const bits = evaluateCConstantFloating(
        expression.expression,
        expression.type,
        depth + 1,
      );
      return bits === undefined
        ? undefined
        : { bits, format: floatingFormat(expression.type) };
    }
    case "unary": {
      if (!isFloatingType(expression.type)) return undefined;
      const bits = evaluateCConstantFloating(
        expression.operand,
        expression.type,
        depth + 1,
      );
      if (
        bits === undefined ||
        (expression.operator !== "+" && expression.operator !== "-")
      )
        return undefined;
      return {
        bits:
          expression.operator === "-"
            ? csFloatNegate(floatingFormat(expression.type), bits).bits
            : bits,
        format: floatingFormat(expression.type),
      };
    }
    case "binary": {
      if (!isFloatingType(expression.type)) return undefined;
      const format = floatingFormat(expression.type);
      const left = evaluateCConstantFloating(
        expression.left,
        expression.type,
        depth + 1,
      );
      const right = evaluateCConstantFloating(
        expression.right,
        expression.type,
        depth + 1,
      );
      if (left === undefined || right === undefined) return undefined;
      const result =
        expression.operator === "+"
          ? csFloatAdd(format, left, right)
          : expression.operator === "-"
            ? csFloatSubtract(format, left, right)
            : expression.operator === "*"
              ? csFloatMultiply(format, left, right)
              : expression.operator === "/"
                ? csFloatDivide(format, left, right)
                : undefined;
      return result === undefined ? undefined : { bits: result.bits, format };
    }
    case "ternary": {
      const condition = evaluateCConstantTruth(expression.condition, depth + 1);
      if (condition === undefined || !isFloatingType(expression.type))
        return undefined;
      const selected = condition ? expression.whenTrue : expression.whenFalse;
      const bits = evaluateCConstantFloating(
        selected,
        expression.type,
        depth + 1,
      );
      return bits === undefined
        ? undefined
        : { bits, format: floatingFormat(expression.type) };
    }
    case "call":
    case "compound":
    case "function":
    case "index":
    case "indirect-call":
    case "member":
    case "string":
    case "variable":
      return undefined;
  }
}

function evaluateCConstantTruth(
  expression: CExpression,
  depth: number,
): boolean | undefined {
  const integer = evaluateCConstantInteger(expression, depth + 1);
  if (integer !== undefined) return integer.bits !== 0n;
  const type = decayCType(expressionType(expression));
  if (!isFloatingType(type)) return undefined;
  const bits = evaluateCConstantFloating(expression, type, depth + 1);
  if (bits === undefined) return undefined;
  return csFloatCompare(floatingFormat(type), bits, 0n, "ne").value;
}

function evaluateCConstantInteger(
  expression: CExpression,
  depth = 0,
): CConstantInteger | undefined {
  if (depth > maximumExpressionDepth) return undefined;
  switch (expression.kind) {
    case "integer": {
      const bits =
        BigInt(expression.value >>> 0) |
        (BigInt(
          expression.highValue === undefined ? 0 : expression.highValue >>> 0,
        ) <<
          32n);
      return normalizeConstantInteger(bits, expression.type);
    }
    case "cast": {
      if (!isIntegerType(expression.type)) return undefined;
      const sourceType = decayCType(expressionType(expression.expression));
      if (isFloatingType(sourceType)) {
        const bits = evaluateCConstantFloating(
          expression.expression,
          sourceType,
          depth + 1,
        );
        if (bits === undefined) return undefined;
        const width = cIntegerWidth(expression.type);
        const converted = isUnsignedIntegerType(expression.type)
          ? csFloatToUnsignedInteger(floatingFormat(sourceType), bits, width)
          : csFloatToSignedInteger(floatingFormat(sourceType), bits, width);
        if ((converted.status & 1) !== 0) return undefined;
        return normalizeConstantInteger(converted.value, expression.type);
      }
      const value = evaluateCConstantInteger(expression.expression, depth + 1);
      if (value === undefined) return undefined;
      return convertConstantInteger(value, expression.type);
    }
    case "unary": {
      if (!isIntegerType(expression.type)) return undefined;
      const value = evaluateCConstantInteger(expression.operand, depth + 1);
      if (value === undefined) return undefined;
      const converted = convertConstantInteger(value, expression.type);
      if (expression.operator === "+") return converted;
      if (expression.operator === "-")
        return normalizeConstantInteger(-converted.bits, expression.type);
      if (expression.operator === "!")
        return normalizeConstantInteger(value.bits === 0n ? 1n : 0n, "int");
      if (expression.operator === "~")
        return normalizeConstantInteger(~converted.bits, expression.type);
      return undefined;
    }
    case "binary": {
      const authoredLeftType = decayCType(expressionType(expression.left));
      const authoredRightType = decayCType(expressionType(expression.right));
      if (
        isFloatingType(authoredLeftType) ||
        isFloatingType(authoredRightType)
      ) {
        if (expression.operator === "&&" || expression.operator === "||") {
          const leftTruth = evaluateCConstantTruth(expression.left, depth + 1);
          if (leftTruth === undefined) return undefined;
          if (expression.operator === "&&" && !leftTruth)
            return normalizeConstantInteger(0n, "int");
          if (expression.operator === "||" && leftTruth)
            return normalizeConstantInteger(1n, "int");
          const rightTruth = evaluateCConstantTruth(
            expression.right,
            depth + 1,
          );
          return rightTruth === undefined
            ? undefined
            : normalizeConstantInteger(rightTruth ? 1n : 0n, "int");
        }
        if (!comparisonOperators.has(expression.operator)) return undefined;
        const target: CFloatingType =
          authoredLeftType === "double" || authoredRightType === "double"
            ? "double"
            : "float";
        const leftFloat = evaluateCConstantFloating(
          expression.left,
          target,
          depth + 1,
        );
        const rightFloat = evaluateCConstantFloating(
          expression.right,
          target,
          depth + 1,
        );
        if (leftFloat === undefined || rightFloat === undefined)
          return undefined;
        return normalizeConstantInteger(
          csFloatCompare(
            floatingFormat(target),
            leftFloat,
            rightFloat,
            comparisonOperation(expression.operator),
          ).value
            ? 1n
            : 0n,
          "int",
        );
      }
      const left = evaluateCConstantInteger(expression.left, depth + 1);
      if (left === undefined) return undefined;
      if (expression.operator === "&&" && left.bits === 0n)
        return normalizeConstantInteger(0n, "int");
      if (expression.operator === "||" && left.bits !== 0n)
        return normalizeConstantInteger(1n, "int");
      const right = evaluateCConstantInteger(expression.right, depth + 1);
      if (right === undefined) return undefined;
      const leftType = decayCType(expressionType(expression.left));
      const rightType = decayCType(expressionType(expression.right));
      if (!isIntegerType(leftType) || !isIntegerType(rightType))
        return undefined;
      const commonType =
        expression.operator === "<<" || expression.operator === ">>"
          ? integerPromotion(leftType)
          : usualArithmeticType(leftType, rightType);
      const convertedLeft = convertConstantInteger(left, commonType);
      const convertedRight = convertConstantInteger(right, commonType);
      const numericLeft = constantIntegerNumericValue(convertedLeft);
      const numericRight = constantIntegerNumericValue(convertedRight);
      const resultType = isIntegerType(expression.type)
        ? expression.type
        : commonType;
      switch (expression.operator) {
        case "+":
          return normalizeConstantInteger(
            numericLeft + numericRight,
            resultType,
          );
        case "-":
          return normalizeConstantInteger(
            numericLeft - numericRight,
            resultType,
          );
        case "*":
          return normalizeConstantInteger(
            numericLeft * numericRight,
            resultType,
          );
        case "/":
          return numericRight === 0n
            ? undefined
            : normalizeConstantInteger(numericLeft / numericRight, resultType);
        case "%":
          return numericRight === 0n
            ? undefined
            : normalizeConstantInteger(numericLeft % numericRight, resultType);
        case "&":
          return normalizeConstantInteger(
            convertedLeft.bits & convertedRight.bits,
            resultType,
          );
        case "|":
          return normalizeConstantInteger(
            convertedLeft.bits | convertedRight.bits,
            resultType,
          );
        case "^":
          return normalizeConstantInteger(
            convertedLeft.bits ^ convertedRight.bits,
            resultType,
          );
        case "<<": {
          if (
            numericRight < 0n ||
            numericRight >= BigInt(cIntegerWidth(commonType))
          )
            return undefined;
          return normalizeConstantInteger(
            convertedLeft.bits << numericRight,
            resultType,
          );
        }
        case ">>": {
          if (
            numericRight < 0n ||
            numericRight >= BigInt(cIntegerWidth(commonType))
          )
            return undefined;
          return normalizeConstantInteger(
            numericLeft >> numericRight,
            resultType,
          );
        }
        case "==":
          return normalizeConstantInteger(
            convertedLeft.bits === convertedRight.bits ? 1n : 0n,
            "int",
          );
        case "!=":
          return normalizeConstantInteger(
            convertedLeft.bits !== convertedRight.bits ? 1n : 0n,
            "int",
          );
        case "<":
          return normalizeConstantInteger(
            numericLeft < numericRight ? 1n : 0n,
            "int",
          );
        case "<=":
          return normalizeConstantInteger(
            numericLeft <= numericRight ? 1n : 0n,
            "int",
          );
        case ">":
          return normalizeConstantInteger(
            numericLeft > numericRight ? 1n : 0n,
            "int",
          );
        case ">=":
          return normalizeConstantInteger(
            numericLeft >= numericRight ? 1n : 0n,
            "int",
          );
        case "&&":
          return normalizeConstantInteger(right.bits === 0n ? 0n : 1n, "int");
        case "||":
          return normalizeConstantInteger(right.bits === 0n ? 0n : 1n, "int");
      }
      return undefined;
    }
    case "ternary": {
      const condition = evaluateCConstantInteger(
        expression.condition,
        depth + 1,
      );
      return condition === undefined
        ? undefined
        : evaluateCConstantInteger(
            condition.bits === 0n ? expression.whenFalse : expression.whenTrue,
            depth + 1,
          );
    }
    case "call":
    case "compound":
    case "function":
    case "index":
    case "indirect-call":
    case "member":
    case "string":
    case "variable":
      return undefined;
  }
}

function cIntegerWidth(type: CIntegerType): 32 | 64 {
  return isWideIntegerType(type) ? 64 : 32;
}

function normalizeConstantInteger(
  value: bigint,
  type: CIntegerType,
): CConstantInteger {
  if (type === "_Bool") return { bits: value === 0n ? 0n : 1n, type };
  return { bits: BigInt.asUintN(cIntegerWidth(type), value), type };
}

function convertConstantInteger(
  value: CConstantInteger,
  type: CIntegerType,
): CConstantInteger {
  return normalizeConstantInteger(constantIntegerNumericValue(value), type);
}

function constantIntegerNumericValue(value: CConstantInteger): bigint {
  return isUnsignedIntegerType(value.type)
    ? value.bits
    : BigInt.asIntN(cIntegerWidth(value.type), value.bits);
}

function statementDefinitelyReturns(statement: CStatement): boolean {
  if (statement.kind === "return") return true;
  if (statement.kind === "block")
    return statement.statements.some((child) =>
      statementDefinitelyReturns(child),
    );
  if (statement.kind === "if")
    return (
      statement.elseBranch !== undefined &&
      statementDefinitelyReturns(statement.thenBranch) &&
      statementDefinitelyReturns(statement.elseBranch)
    );
  return false;
}

function cError(
  message: string,
  span: Cs486SourceSpan,
  notes: readonly {
    readonly message: string;
    readonly span?: Cs486SourceSpan;
  }[] = [],
): Cs486CompileError {
  return compileErrorAt(message, span, {
    code: "CSC001",
    notes: [...notes, ...(span.diagnosticNotes ?? [])].slice(0, 8),
  });
}
