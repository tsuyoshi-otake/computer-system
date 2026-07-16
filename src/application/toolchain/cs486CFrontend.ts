import { assembleCs486Object, Cs486CompileError } from "./cs486Assembler.js";
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
  type Cs486IrExternalFunction,
  type Cs486IrFunction,
  type Cs486IrInstruction,
  type Cs486IrLocal,
  type Cs486IrProgram,
  type Cs486IrRegisterAllocation,
  type Cs486IrReturnType,
  type Cs486IrTerminator,
  type Cs486IrValueId,
  type Cs486IrValueLocation,
  type Cs486IrValueType,
} from "./cs486Ir.js";

export type Cs486CFamilyLanguage = "c" | "cpp";

export interface Cs486CFrontendOptions {
  readonly sourceName?: string;
}

export interface Cs486CFrontendOutput {
  readonly assembly: string;
  readonly dataBytes: number;
}

type CType = "int" | "long" | "void";
type ComparisonOperator = "<" | "<=" | ">" | ">=";

type CTokenKind =
  "directive" | "eof" | "identifier" | "number" | "punctuation" | "string";

interface CToken {
  readonly kind: CTokenKind;
  readonly raw: string;
  readonly span: Cs486SourceSpan;
  readonly value: string;
}

interface CVariable {
  readonly name: string;
  readonly slot: number;
  readonly span: Cs486SourceSpan;
  readonly type: Exclude<CType, "void">;
}

interface CFunctionSymbol {
  definition?: CFunctionDefinition;
  readonly firstSpan: Cs486SourceSpan;
  readonly name: string;
  readonly returnType: CType;
}

interface CFunctionDefinition {
  readonly body: CBlockStatement;
  readonly localCount: number;
  readonly nameSpan: Cs486SourceSpan;
  readonly symbol: CFunctionSymbol;
}

interface CProgram {
  readonly definitions: readonly CFunctionDefinition[];
  readonly functions: ReadonlyMap<string, CFunctionSymbol>;
}

type CExpression =
  | {
      readonly kind: "binary";
      readonly left: CExpression;
      readonly operator: "+" | "-" | "*" | "/" | "%";
      readonly right: CExpression;
      readonly span: Cs486SourceSpan;
    }
  | {
      readonly kind: "call";
      readonly name: string;
      readonly span: Cs486SourceSpan;
    }
  | {
      readonly kind: "integer";
      readonly span: Cs486SourceSpan;
      readonly value: number;
    }
  | {
      readonly kind: "unary";
      readonly operand: CExpression;
      readonly operator: "+" | "-";
      readonly span: Cs486SourceSpan;
    }
  | {
      readonly kind: "variable";
      readonly span: Cs486SourceSpan;
      readonly variable: CVariable;
    };

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
      readonly variable: CVariable;
    }
  | {
      readonly expression: CExpression;
      readonly kind: "call";
      readonly span: Cs486SourceSpan;
    }
  | {
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
      readonly expression?: CExpression;
      readonly kind: "return";
      readonly span: Cs486SourceSpan;
    };

interface CInlineInstruction {
  readonly source: string;
  readonly variable?: CVariable;
}

interface CFunctionContext {
  localCount: number;
  readonly scopes: Map<string, CVariable>[];
  readonly symbol: CFunctionSymbol;
}

interface CCallUse {
  readonly name: string;
  readonly span: Cs486SourceSpan;
  readonly valueRequired: boolean;
}

const maximumSourceCharacters = 128_000;
const maximumTokens = 32_000;
const maximumExpressionTokens = 128;
const maximumExpressionDepth = 48;
const maximumBlockDepth = 48;
const maximumFunctions = 256;
const maximumLocalsPerFunction = 256;
const maximumIdentifierLength = 64;
const maximumInlineInstructions = 16;
const maximumInlineRegions = 64;
const maximumIrBlocksPerFunction = 256;
const maximumIrInstructionsPerFunction = 4_096;
const maximumIrValuesPerFunction = 8_192;

const cIrLimits = Object.freeze({
  maxBlocksPerFunction: maximumIrBlocksPerFunction,
  maxExternals: maximumFunctions + maximumInlineRegions + 2,
  maxFunctions: maximumFunctions,
  maxInstructionsPerFunction: maximumIrInstructionsPerFunction,
  maxLocalsPerFunction: maximumLocalsPerFunction,
  maxValuesPerFunction: maximumIrValuesPerFunction,
});

const printI32Intrinsic = ".cs.print.i32";
const printNewlineIntrinsic = ".cs.print.newline";
const inlineAssemblyIntrinsicPrefix = ".cs.inline.";

const twoCharacterPunctuation = new Set([
  "++",
  "--",
  "+=",
  "-=",
  "<=",
  ">=",
  "<<",
  ">>",
  "::",
]);

const punctuation = new Set([
  "{",
  "}",
  "(",
  ")",
  ";",
  ",",
  ":",
  "=",
  "+",
  "-",
  "*",
  "/",
  "%",
  "<",
  ">",
]);

const reservedIdentifiers = new Set([
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
  if (source.length > maximumSourceCharacters) {
    const position: Cs486SourcePosition = {
      column: 1,
      line: 1,
      offset: 0,
      source: sourceName,
    };
    throw cError("source limit exceeded", { end: position, start: position });
  }
  const parser = new CParser(tokenizeC(source, sourceName), language);
  const program = parser.parse();
  const intermediate = new CIntermediateBuilder(program).build();
  return {
    assembly: new CCodeGenerator().generate(program, intermediate),
    dataBytes: 0,
  };
}

function tokenizeC(source: string, sourceName: string): readonly CToken[] {
  const normalized = source.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
  const tokens: CToken[] = [];
  let index = 0;
  let line = 1;
  let column = 1;
  let atLineStart = true;

  const position = (): Cs486SourcePosition => ({
    column,
    line,
    offset: index,
    source: sourceName,
  });
  const advance = (): string => {
    const character = normalized[index++]!;
    if (character === "\n") {
      line += 1;
      column = 1;
      atLineStart = true;
    } else column += 1;
    return character;
  };
  const push = (
    kind: CTokenKind,
    raw: string,
    value: string,
    start: Cs486SourcePosition,
  ): void => {
    const span = { end: position(), start };
    if (tokens.length >= maximumTokens)
      throw cError("C-family lexical token limit exceeded", span);
    if (kind === "identifier" && value.length > maximumIdentifierLength)
      throw cError("identifier length limit exceeded", span);
    tokens.push({ kind, raw, span, value });
    atLineStart = false;
  };

  while (index < normalized.length) {
    const character = normalized[index]!;
    if (character === " " || character === "\t" || character === "\n") {
      advance();
      continue;
    }
    if (character === "#" && atLineStart) {
      const start = position();
      while (index < normalized.length && normalized[index] !== "\n") advance();
      const raw = normalized.slice(start.offset, index);
      push("directive", raw, raw.trim(), start);
      continue;
    }
    if (normalized.slice(index, index + 2) === "//") {
      while (index < normalized.length && normalized[index] !== "\n") advance();
      continue;
    }
    if (normalized.slice(index, index + 2) === "/*") {
      const start = position();
      advance();
      advance();
      let closed = false;
      while (index < normalized.length) {
        if (normalized.slice(index, index + 2) === "*/") {
          advance();
          advance();
          closed = true;
          break;
        }
        advance();
      }
      if (!closed)
        throw cError("unterminated block comment", {
          end: position(),
          start,
        });
      continue;
    }
    if (character === '"') {
      const start = position();
      advance();
      let escaped = false;
      let closed = false;
      while (index < normalized.length) {
        const next = normalized[index]!;
        if (next === "\n") break;
        advance();
        if (escaped) {
          escaped = false;
          continue;
        }
        if (next === "\\") {
          escaped = true;
          continue;
        }
        if (next === '"') {
          closed = true;
          break;
        }
      }
      if (!closed)
        throw cError("unterminated string literal", {
          end: position(),
          start,
        });
      const raw = normalized.slice(start.offset, index);
      let value: string;
      try {
        value = JSON.parse(raw) as string;
      } catch {
        throw cError("invalid string literal", { end: position(), start });
      }
      push("string", raw, value, start);
      continue;
    }
    if (/[0-9]/u.test(character)) {
      const start = position();
      while (
        index < normalized.length &&
        /[A-Za-z0-9_]/u.test(normalized[index]!)
      )
        advance();
      const raw = normalized.slice(start.offset, index);
      if (!/^\d+$/u.test(raw))
        throw cError(`unsupported numeric literal ${raw}`, {
          end: position(),
          start,
        });
      push("number", raw, raw, start);
      continue;
    }
    if (/[A-Za-z_]/u.test(character)) {
      const start = position();
      advance();
      while (
        index < normalized.length &&
        /[A-Za-z0-9_]/u.test(normalized[index]!)
      )
        advance();
      const raw = normalized.slice(start.offset, index);
      push("identifier", raw, raw, start);
      continue;
    }
    const pair = normalized.slice(index, index + 2);
    if (twoCharacterPunctuation.has(pair)) {
      const start = position();
      advance();
      advance();
      push("punctuation", pair, pair, start);
      continue;
    }
    if (punctuation.has(character)) {
      const start = position();
      push("punctuation", advance(), character, start);
      continue;
    }
    const start = position();
    advance();
    throw cError(`unexpected character ${JSON.stringify(character)}`, {
      end: position(),
      start,
    });
  }
  const end = position();
  tokens.push({ kind: "eof", raw: "", span: { end, start: end }, value: "" });
  return tokens;
}

class CParser {
  private readonly calls: CCallUse[] = [];
  private currentFunction: CFunctionContext | undefined;
  private readonly definitions: CFunctionDefinition[] = [];
  private readonly functions = new Map<string, CFunctionSymbol>();
  private index = 0;

  constructor(
    private readonly tokens: readonly CToken[],
    private readonly language: Cs486CFamilyLanguage,
  ) {}

  parse(): CProgram {
    while (!this.at("")) {
      if (this.current().kind === "directive") {
        this.parseDirective();
        continue;
      }
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
    }
    return { definitions: this.definitions, functions: this.functions };
  }

  private parseDirective(): void {
    const token = this.consume();
    const include = /^#\s*include\s*<\s*([^>\s]+)\s*>\s*$/u.exec(token.value);
    if (include === null)
      throw cError(
        `unsupported preprocessor directive ${token.value}`,
        token.span,
      );
    const header = include[1]!;
    const allowed =
      header === "stdio.h" ||
      (this.language === "cpp" &&
        (header === "iostream" || header === "cstdio"));
    if (!allowed)
      throw cError(`unsupported C-family header ${header}`, token.span);
  }

  private parseTopLevelDeclaration(): void {
    const external = this.take("extern") !== undefined;
    if (!isTypeToken(this.current())) {
      const token = this.current();
      const label = this.language === "cpp" ? "C++" : "C";
      throw cError(
        `unsupported ${label} top-level declaration ${token.raw || "at end of source"}`,
        token.span,
      );
    }
    const returnType = this.parseType();
    const name = this.expectName("function name");
    if (!this.at("("))
      throw cError(
        `global variables are not supported; ${name.value} must be declared inside a function`,
        name.span,
      );
    this.consume();
    if (!this.at(")"))
      throw cError(
        "function parameters are not supported",
        this.current().span,
      );
    this.consume();

    const symbol = this.declareFunction(name, returnType);
    if (this.take(";") !== undefined) return;
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
      localCount: 0,
      scopes: [],
      symbol,
    };
    this.currentFunction = context;
    const body = this.parseBlock(0);
    this.currentFunction = undefined;
    const definition: CFunctionDefinition = {
      body,
      localCount: context.localCount,
      nameSpan: name.span,
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

  private declareFunction(name: CToken, returnType: CType): CFunctionSymbol {
    const existing = this.functions.get(name.value);
    if (existing !== undefined) {
      if (existing.returnType !== returnType)
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
      return existing;
    }
    if (this.functions.size >= maximumFunctions)
      throw cError("function limit exceeded", name.span);
    const symbol: CFunctionSymbol = {
      firstSpan: name.span,
      name: name.value,
      returnType,
    };
    this.functions.set(name.value, symbol);
    return symbol;
  }

  private parseBlock(depth: number): CBlockStatement {
    if (depth >= maximumBlockDepth)
      throw cError("block nesting limit exceeded", this.current().span);
    const open = this.expect("{");
    this.enterScope();
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
    this.leaveScope();
    return {
      kind: "block",
      span: { end: close.span.end, start: open.span.start },
      statements,
    };
  }

  private parseStatement(depth: number): CStatement {
    const token = this.current();
    if (token.kind === "directive")
      throw cError(
        "preprocessor directives are only supported at top level",
        token.span,
      );
    if (this.at("{")) return this.parseBlock(depth);
    if (this.take(";") !== undefined)
      return { kind: "block", span: token.span, statements: [] };
    if (isTypeToken(token)) return this.parseLocalDeclaration(true);
    if (this.at("for")) return this.parseFor(depth);
    if (this.at("return")) return this.parseReturn();
    if (this.at("asm") || this.at("__asm__")) return this.parseInlineAssembly();
    if (this.at("printf")) return this.parsePrintf();
    if (this.at("std")) return this.parseCout();
    if (token.kind === "identifier") return this.parseIdentifierStatement();
    const label = this.language === "cpp" ? "C++" : "C";
    throw cError(
      `unsupported ${label} statement ${token.raw || "at end of source"}`,
      token.span,
    );
  }

  private parseLocalDeclaration(
    semicolon: boolean,
  ): Extract<CStatement, { kind: "declaration" }> {
    const start = this.current();
    const type = this.parseType();
    if (type === "void")
      throw cError("local variables cannot have type void", start.span);
    const name = this.expectName("variable name");
    const variable = this.declareVariable(name, type);
    const initializer =
      this.take("=") === undefined ? undefined : this.parseExpression();
    const end = semicolon ? this.expect(";") : this.previous();
    return {
      initializer,
      kind: "declaration",
      span: { end: end.span.end, start: start.span.start },
      variable,
    };
  }

  private parseIdentifierStatement(): CStatement {
    const name = this.consume();
    if (this.take("=") !== undefined) {
      const variable = this.lookupVariable(name);
      const expression = this.parseExpression();
      const end = this.expect(";");
      return {
        expression,
        kind: "assignment",
        span: { end: end.span.end, start: name.span.start },
        variable,
      };
    }
    if (this.at("(")) {
      this.index -= 1;
      const expression = this.parseExpression();
      if (expression.kind !== "call")
        throw cError(
          "only a function call may be used as an expression statement",
          expression.span,
        );
      const valueUse = this.calls.at(-1);
      if (
        valueUse?.name === expression.name &&
        valueUse.span.start.offset === expression.span.start.offset
      )
        this.calls.pop();
      const end = this.expect(";");
      this.calls.push({
        name: expression.name,
        span: expression.span,
        valueRequired: false,
      });
      return {
        expression,
        kind: "call",
        span: { end: end.span.end, start: name.span.start },
      };
    }
    throw cError(
      `expected assignment or function call after ${name.value}`,
      this.current().span,
    );
  }

  private parseFor(depth: number): CStatement {
    const start = this.expect("for");
    this.expect("(");
    this.enterScope();
    let initializer: Extract<
      CStatement,
      { kind: "assignment" | "declaration" }
    >;
    if (isTypeToken(this.current()))
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
        variable,
      };
    }
    const conditionName = this.expectIdentifier("for condition variable");
    const variable = this.lookupVariable(conditionName);
    if (variable !== initializer.variable)
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
    if (!this.at("{"))
      throw cError("for body must be a block", this.current().span);
    const body = this.parseBlock(depth);
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
    if (format.value !== "%d" && format.value !== "%d\n")
      throw cError('printf supports only "%d" and "%d\\n"', format.span);
    this.expect(",");
    const expression = this.parseExpression();
    this.expect(")");
    const end = this.expect(";");
    return {
      expression,
      kind: "print",
      newline: format.value.endsWith("\n"),
      span: { end: end.span.end, start: start.span.start },
    };
  }

  private parseCout(): CStatement {
    const start = this.expect("std");
    if (this.language !== "cpp")
      throw cError("std::cout is available only in the C++ subset", start.span);
    this.expect("::");
    this.expect("cout");
    this.expect("<<");
    const expression = this.parseExpression();
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
    const expression = this.parseAdditive(0);
    if (this.index - start > maximumExpressionTokens)
      throw cError("expression token limit exceeded", expression.span);
    return expression;
  }

  private parseAdditive(depth: number): CExpression {
    let expression = this.parseMultiplicative(depth + 1);
    while (this.at("+") || this.at("-")) {
      const operator = this.consume();
      const right = this.parseMultiplicative(depth + 1);
      expression = {
        kind: "binary",
        left: expression,
        operator: operator.value as "+" | "-",
        right,
        span: { end: right.span.end, start: expression.span.start },
      };
    }
    return expression;
  }

  private parseMultiplicative(depth: number): CExpression {
    let expression = this.parseUnary(depth + 1);
    while (this.at("*") || this.at("/") || this.at("%")) {
      const operator = this.consume();
      const right = this.parseUnary(depth + 1);
      expression = {
        kind: "binary",
        left: expression,
        operator: operator.value as "*" | "/" | "%",
        right,
        span: { end: right.span.end, start: expression.span.start },
      };
    }
    return expression;
  }

  private parseUnary(depth: number): CExpression {
    if (depth > maximumExpressionDepth)
      throw cError("expression nesting limit exceeded", this.current().span);
    if (this.at("+") || this.at("-")) {
      const operator = this.consume();
      const operand = this.parseUnary(depth + 1);
      return {
        kind: "unary",
        operand,
        operator: operator.value as "+" | "-",
        span: { end: operand.span.end, start: operator.span.start },
      };
    }
    return this.parsePrimary(depth + 1);
  }

  private parsePrimary(depth: number): CExpression {
    if (depth > maximumExpressionDepth)
      throw cError("expression nesting limit exceeded", this.current().span);
    const token = this.current();
    if (token.kind === "number") {
      this.consume();
      return { kind: "integer", span: token.span, value: parseInteger(token) };
    }
    if (token.kind === "identifier") {
      this.consume();
      if (this.take("(") !== undefined) {
        if (!this.at(")"))
          throw cError(
            "function arguments are not supported",
            this.current().span,
          );
        const close = this.consume();
        const span = { end: close.span.end, start: token.span.start };
        this.assertCallableFunction(token, span);
        this.calls.push({ name: token.value, span, valueRequired: true });
        return { kind: "call", name: token.value, span };
      }
      return {
        kind: "variable",
        span: token.span,
        variable: this.lookupVariable(token),
      };
    }
    if (this.take("(") !== undefined) {
      const open = this.previous();
      const expression = this.parseAdditive(depth + 1);
      if (!this.at(")"))
        throw cError(
          "unbalanced parenthesized expression: expected ')'",
          this.current().span,
        );
      const close = this.consume();
      return {
        ...expression,
        span: { end: close.span.end, start: open.span.start },
      };
    }
    throw cError("expected expression operand", token.span);
  }

  private parseType(): CType {
    const token = this.consume();
    if (!isTypeToken(token))
      throw cError("expected int, long, or void", token.span);
    return token.value;
  }

  private declareVariable(
    name: CToken,
    type: Exclude<CType, "void">,
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
    if (context.localCount >= maximumLocalsPerFunction)
      throw cError("local variable limit exceeded", name.span);
    const variable: CVariable = {
      name: name.value,
      slot: ++context.localCount,
      span: name.span,
      type,
    };
    scope.set(name.value, variable);
    return variable;
  }

  private lookupVariable(name: CToken): CVariable {
    const variable = this.findVariable(name.value);
    if (variable !== undefined) return variable;
    throw cError(`undeclared identifier ${name.value}`, name.span);
  }

  private findVariable(name: string): CVariable | undefined {
    const context = this.requireFunction();
    for (let index = context.scopes.length - 1; index >= 0; index -= 1) {
      const variable = context.scopes[index]!.get(name);
      if (variable !== undefined) return variable;
    }
    return undefined;
  }

  private assertCallableFunction(name: CToken, span: Cs486SourceSpan): void {
    const variable = this.findVariable(name.value);
    if (variable !== undefined)
      throw cError(`called object ${name.value} is not a function`, span, [
        {
          message: `${name.value} was declared as a local variable here`,
          span: variable.span,
        },
      ]);
    if (!this.functions.has(name.value))
      throw cError(
        `undeclared function ${name.value}; functions must be declared before use`,
        span,
      );
  }

  private enterScope(): void {
    this.requireFunction().scopes.push(new Map());
  }

  private leaveScope(): void {
    const context = this.requireFunction();
    if (context.scopes.pop() === undefined)
      throw new Error("C scope stack underflow");
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

  private previous(): CToken {
    return this.tokens[Math.max(0, this.index - 1)]!;
  }

  private consume(): CToken {
    const token = this.current();
    if (token.kind !== "eof") this.index += 1;
    return token;
  }
}

interface CIntermediateProgram {
  readonly inlineAssembly: ReadonlyMap<string, readonly CInlineInstruction[]>;
  readonly ir: Cs486IrProgram;
}

interface MutableIrBlock {
  readonly id: string;
  readonly instructions: Cs486IrInstruction[];
  readonly phis: [];
  readonly span?: Cs486SourceSpan;
  terminator?: Cs486IrTerminator;
}

/** Builds bounded, value-SSA CSIR with explicit mutable local slots. */
class CIntermediateBuilder {
  private readonly externals = new Map<string, Cs486IrExternalFunction>();
  private readonly inlineAssembly = new Map<
    string,
    readonly CInlineInstruction[]
  >();
  private blocks: MutableIrBlock[] = [];
  private currentBlock!: MutableIrBlock;
  private currentDefinition!: CFunctionDefinition;
  private instructionCount = 0;
  private nextBlock = 0;
  private nextValue = 0;

  constructor(private readonly program: CProgram) {}

  build(): CIntermediateProgram {
    for (const symbol of this.program.functions.values()) {
      if (symbol.definition !== undefined) continue;
      this.addExternal(
        symbol.name,
        [],
        cTypeToIr(symbol.returnType),
        symbol.firstSpan,
      );
    }
    const functions = this.program.definitions.map((definition) =>
      this.buildFunction(definition),
    );
    const raw: Cs486IrProgram = {
      externals: [...this.externals.values()],
      functions,
    };
    assertValidCs486Ir(raw, cIrLimits);
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
    this.nextValue = 0;
    const variables = collectFunctionVariables(definition);
    const locals: Cs486IrLocal[] = variables.map((variable) => ({
      name: irLocalName(variable),
      span: variable.span,
      type: "i32",
    }));
    this.currentBlock = this.createBlock("entry", definition.nameSpan);
    this.emitBlock(definition.body);
    if (this.currentBlock.terminator === undefined) {
      if (definition.symbol.returnType === "void")
        this.terminate({ kind: "return", span: definition.body.span });
      else {
        const zero = this.emitConstant(0, definition.body.span);
        this.terminate({
          kind: "return",
          span: definition.body.span,
          value: zero,
        });
      }
    }
    return {
      blocks: this.blocks,
      entry: "entry",
      locals,
      name: definition.symbol.name,
      parameters: [],
      returnType: cTypeToIr(definition.symbol.returnType),
      span: definition.nameSpan,
    };
  }

  private emitBlock(block: CBlockStatement): void {
    for (let index = 0; index < block.statements.length; index += 1) {
      if (this.currentBlock.terminator !== undefined) return;
      const statement = block.statements[index]!;
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
        if (statement.initializer !== undefined)
          this.emitStore(
            statement.variable,
            this.emitExpression(statement.initializer),
            statement.span,
          );
        return;
      case "assignment":
        this.emitStore(
          statement.variable,
          this.emitExpression(statement.expression),
          statement.span,
        );
        return;
      case "call":
        this.emitCall(statement.expression, statement.span);
        return;
      case "print": {
        const value = this.emitExpression(statement.expression);
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
        const value =
          statement.expression === undefined
            ? undefined
            : this.emitExpression(statement.expression);
        this.terminate({ kind: "return", span: statement.span, value });
        return;
      }
      case "for":
        this.emitFor(statement);
        return;
      case "inline-assembly":
        this.emitInlineAssembly(statement.instructions, statement.span);
    }
  }

  private emitFor(
    statement: Extract<CStatement, { readonly kind: "for" }>,
  ): void {
    this.emitStatement(statement.initializer);
    const condition = this.createBlock("for.condition", statement.span);
    const body = this.createBlock("for.body", statement.body.span);
    const exit = this.createBlock("for.exit", statement.span);
    this.terminate({
      kind: "jump",
      span: statement.span,
      target: condition.id,
    });

    this.currentBlock = condition;
    const variable = this.emitLoad(statement.variable, statement.span);
    const bound = this.emitExpression(statement.bound);
    const comparison = this.newValue(statement.span);
    this.emit({
      kind: "binary",
      left: variable,
      operator: comparisonToIr(statement.comparison),
      result: comparison,
      right: bound,
      span: statement.span,
      type: "i1",
    });
    this.terminate({
      condition: comparison,
      falseTarget: exit.id,
      kind: "branch",
      span: statement.span,
      trueTarget: body.id,
    });

    this.currentBlock = body;
    this.emitBlock(statement.body);
    if (this.currentBlock.terminator === undefined) {
      const previous = this.emitLoad(statement.variable, statement.span);
      const increment = this.emitConstant(statement.increment, statement.span);
      const next = this.newValue(statement.span);
      this.emit({
        kind: "binary",
        left: previous,
        operator: "add",
        result: next,
        right: increment,
        span: statement.span,
        type: "i32",
      });
      this.emitStore(statement.variable, next, statement.span);
      this.terminate({
        kind: "jump",
        span: statement.span,
        target: condition.id,
      });
    }
    this.currentBlock = exit;
  }

  private emitExpression(expression: CExpression): Cs486IrValueId {
    switch (expression.kind) {
      case "integer":
        return this.emitConstant(expression.value, expression.span);
      case "variable":
        return this.emitLoad(expression.variable, expression.span);
      case "call": {
        const result = this.emitCall(expression, expression.span);
        if (result === undefined)
          throw cError("void call cannot be used as a value", expression.span);
        return result;
      }
      case "unary": {
        const operand = this.emitExpression(expression.operand);
        if (expression.operator === "+") return operand;
        const result = this.newValue(expression.span);
        this.emit({
          kind: "unary",
          operand,
          operator: "neg",
          result,
          span: expression.span,
          type: "i32",
        });
        return result;
      }
      case "binary": {
        const left = this.emitExpression(expression.left);
        const right = this.emitExpression(expression.right);
        const result = this.newValue(expression.span);
        this.emit({
          kind: "binary",
          left,
          operator: arithmeticToIr(expression.operator),
          result,
          right,
          span: expression.span,
          type: "i32",
        });
        return result;
      }
    }
  }

  private emitCall(
    expression: CExpression,
    span: Cs486SourceSpan,
  ): Cs486IrValueId | undefined {
    if (expression.kind !== "call")
      throw cError("internal call statement is not a call", span);
    const symbol = this.program.functions.get(expression.name);
    if (symbol === undefined)
      throw cError(`unknown function ${expression.name}`, expression.span);
    if (symbol.returnType === "void") {
      this.emit({
        arguments: [],
        callee: symbol.name,
        kind: "call",
        span,
      });
      return undefined;
    }
    const result = this.newValue(span);
    this.emit({
      arguments: [],
      callee: symbol.name,
      kind: "call",
      result,
      span,
      type: "i32",
    });
    return result;
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
    return result;
  }

  private emitLoad(variable: CVariable, span: Cs486SourceSpan): Cs486IrValueId {
    const result = this.newValue(span);
    this.emit({
      kind: "load-local",
      local: irLocalName(variable),
      result,
      span,
      type: "i32",
    });
    return result;
  }

  private emitStore(
    variable: CVariable,
    value: Cs486IrValueId,
    span: Cs486SourceSpan,
  ): void {
    this.emit({
      kind: "store-local",
      local: irLocalName(variable),
      span,
      value,
    });
  }

  private createBlock(kind: string, span?: Cs486SourceSpan): MutableIrBlock {
    if (this.blocks.length >= maximumIrBlocksPerFunction)
      throw cError(
        "CSIR basic block limit exceeded",
        span ?? this.currentDefinition.nameSpan,
      );
    const id =
      this.blocks.length === 0
        ? "entry"
        : `${kind}.${String(this.nextBlock++)}`;
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
  ): void {
    const existing = this.externals.get(name);
    if (existing !== undefined) return;
    if (this.externals.size >= cIrLimits.maxExternals)
      throw cError("CSIR external function limit exceeded", span);
    this.externals.set(name, { name, parameterTypes, returnType, span });
  }
}

class CCodeGenerator {
  private readonly assembly: string[] = [];
  private allocation!: Cs486IrRegisterAllocation;
  private readonly blockLabels = new Map<string, string>();
  private currentFunction!: Cs486IrFunction;
  private nextLabel = 0;
  private epilogue = "";
  private inlineAssembly: ReadonlyMap<string, readonly CInlineInstruction[]> =
    new Map();

  generate(program: CProgram, intermediate: CIntermediateProgram): string {
    this.inlineAssembly = intermediate.inlineAssembly;
    this.emit("section .bss", "align 4", "section .text");
    for (const function_ of program.functions.values()) {
      if (function_.definition === undefined)
        this.emit(`extern ${function_.name}`);
      else this.emit(`global ${function_.name}`);
      this.emit(`type ${function_.name}, function`);
      this.emit(
        `signature ${function_.name}, ${function_.returnType === "void" ? "void" : "i32"}`,
      );
    }
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
    this.emit(`${function_.name}:`, "push ebp", "mov ebp, esp");
    const frameSlots = function_.locals.length + this.allocation.spillSlotCount;
    if (frameSlots > 0) {
      this.emit("mov eax, 0");
      for (let index = 0; index < frameSlots; index += 1) this.emit("push eax");
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
    this.emit(`${this.epilogue}:`, "mov esp, ebp", "pop ebp", "ret");
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
        else this.emitBooleanFromZero("je");
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
      case "store-local":
        this.loadValue(instruction.value, instruction.span);
        this.addressLocal(instruction.local, instruction.span);
        this.emit("store [ecx], eax");
        return;
      case "call":
        this.generateCall(instruction);
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
      ["mod", "mod"],
      ["mul", "mul"],
      ["or", "or"],
      ["shl", "shl"],
      ["shr", "shr"],
      ["sub", "sub"],
      ["xor", "xor"],
    ]);
    const operation = arithmetic.get(instruction.operator);
    if (operation !== undefined) this.emit(`${operation} eax, ebx`);
    else if (instruction.operator === "logical-and")
      this.emitLogicalCombination(false);
    else if (instruction.operator === "logical-or")
      this.emitLogicalCombination(true);
    else this.emitComparison(comparisonJump(instruction.operator));
    this.storeResult(instruction.result, instruction.span);
  }

  private generateCall(instruction: Cs486IrCallInstruction): void {
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
    if (instruction.callee === printNewlineIntrinsic) {
      this.emit('print "\\n"');
      return;
    }
    const inline = this.inlineAssembly.get(instruction.callee);
    if (inline !== undefined) {
      for (const instruction_ of inline) {
        if (instruction_.variable === undefined) this.emit(instruction_.source);
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
    if (instruction.arguments.length !== 0)
      throw cError(
        "the current CS486 ABI supports only zero-argument calls",
        this.spanOf(instruction),
      );
    this.emit(`call ${instruction.callee}`);
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
        else this.loadValue(terminator.value, terminator.span);
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
    this.addressOffset(-location.byteOffset, span);
    this.emit("load eax, [ecx]");
  }

  private storeResult(value: Cs486IrValueId, span?: Cs486SourceSpan): void {
    const location = this.location(value, span);
    if (location.kind === "register") {
      this.emit(`mov ${location.register}, eax`);
      return;
    }
    this.addressOffset(-location.byteOffset, span);
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
    this.addressOffset((index + 1) * 4, span);
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
  const variables: (CVariable | undefined)[] = Array.from({
    length: definition.localCount,
  });
  const record = (variable: CVariable): void => {
    const index = variable.slot - 1;
    if (index < 0 || index >= variables.length)
      throw cError("invalid C-family local slot", variable.span);
    const existing = variables[index];
    if (existing !== undefined && existing !== variable)
      throw cError("duplicate C-family local slot", variable.span);
    variables[index] = variable;
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
      case "call":
      case "integer":
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
        return;
      case "assignment":
        record(value.variable);
        expression(value.expression);
        return;
      case "call":
      case "print":
        expression(value.expression);
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
      case "inline-assembly":
        for (const instruction of value.instructions)
          if (instruction.variable !== undefined) record(instruction.variable);
    }
  };
  statement(definition.body);
  const complete: CVariable[] = [];
  for (let index = 0; index < variables.length; index += 1) {
    const variable = variables[index];
    if (variable === undefined)
      throw cError(
        `C-family local slot ${String(index + 1)} is missing`,
        definition.nameSpan,
      );
    complete.push(variable);
  }
  return complete;
}

function irLocalName(variable: CVariable): string {
  return `l${String(variable.slot)}.${variable.name}`;
}

function cTypeToIr(type: CType): Cs486IrReturnType {
  return type === "void" ? "void" : "i32";
}

function arithmeticToIr(
  operator: Extract<CExpression, { readonly kind: "binary" }>["operator"],
): Cs486IrBinaryOperator {
  return (
    { "+": "add", "-": "sub", "*": "mul", "/": "div", "%": "mod" } as const
  )[operator];
}

function comparisonToIr(operator: ComparisonOperator): Cs486IrBinaryOperator {
  return ({ "<": "lt", "<=": "le", ">": "gt", ">=": "ge" } as const)[operator];
}

function comparisonJump(operator: Cs486IrBinaryOperator): string {
  switch (operator) {
    case "eq":
      return "je";
    case "ge":
      return "jge";
    case "gt":
      return "jg";
    case "le":
      return "jle";
    case "lt":
      return "jl";
    case "ne":
      return "jne";
    default:
      throw new Error(`CSIR operator ${operator} is not a comparison`);
  }
}

function isTypeToken(
  token: CToken,
): token is CToken & { readonly value: CType } {
  return (
    token.kind === "identifier" && ["int", "long", "void"].includes(token.value)
  );
}

function parseInteger(token: CToken): number {
  const value = Number(token.value);
  if (!Number.isSafeInteger(value) || value > 2_147_483_647)
    throw cError(
      "integer literal is outside the signed 32-bit subset",
      token.span,
    );
  return value;
}

function statementDefinitelyReturns(statement: CStatement): boolean {
  if (statement.kind === "return") return true;
  if (statement.kind === "block")
    return statement.statements.some((child) =>
      statementDefinitelyReturns(child),
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
  return compileErrorAt(message, span, { code: "CSC001", notes });
}
