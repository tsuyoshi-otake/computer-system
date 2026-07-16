import { Cs486CompileError } from "./cs486Assembler.js";

export interface QBasicCompilation {
  readonly assembly: string;
  readonly dataBytes: number;
}

type Block =
  | {
      readonly body: string;
      readonly end: string;
      readonly endAddress: number;
      readonly kind: "for";
      readonly start: string;
      readonly stepAddress: number;
      readonly variable: string;
    }
  | { readonly end: string; readonly kind: "while"; readonly start: string }
  | { readonly end: string; readonly kind: "do"; readonly start: string };

interface ExpressionToken {
  readonly kind: "identifier" | "number" | "operator" | "paren";
  readonly value: string;
}

const maximumSourceLines = 4_096;
const maximumStatements = 8_192;
const maximumVariables = 1_024;
const maximumExpressionTokens = 128;
const maximumInlineDepth = 8;

const unsafeStatements =
  /^(?:CALL\s+ABSOLUTE|INP\b|OUT\b|PEEK\b|POKE\b|SHELL\b|OPEN\s+(?:"?COM[12]|"?LPT))/iu;
const unsafeExpression = /\b(?:INP|PEEK)\s*\(/iu;

/** Compiles the bounded integer/console CS QBASIC frontend to the shared CS486 ABI. */
export function compileQBasicAssembly(source: string): QBasicCompilation {
  return new QBasicCompiler().compile(source);
}

class QBasicCompiler {
  private readonly assembly: string[] = [];
  private readonly blocks: Block[] = [];
  private readonly labels = new Set<string>();
  private readonly references = new Map<string, number>();
  private readonly variables = new Map<string, number>();
  private nextAddress = 0;
  private nextLabel = 0;
  private statements = 0;

  compile(source: string): QBasicCompilation {
    const sourceLines = source.replaceAll("\r\n", "\n").split("\n");
    if (sourceLines.length > maximumSourceLines)
      throw new Cs486CompileError("QBasic source line limit exceeded");
    this.emit("global basic_main", "basic_main:");
    for (const [offset, raw] of sourceLines.entries()) {
      this.compileLine(raw, offset + 1);
    }
    const block = this.blocks.at(-1);
    if (block !== undefined) {
      const expected =
        block.kind === "for"
          ? "NEXT"
          : block.kind === "while"
            ? "WEND"
            : "LOOP";
      throw new Cs486CompileError(
        `${block.kind.toUpperCase()} without ${expected}`,
      );
    }
    for (const [label, line] of this.references) {
      if (!this.labels.has(label))
        throw new Cs486CompileError(`undefined line or label: ${label}`, line);
    }
    this.emit("halt");
    return { assembly: this.assembly.join("\n"), dataBytes: this.nextAddress };
  }

  private compileLine(raw: string, line: number): void {
    let text = stripComment(raw).trim();
    if (text.length === 0) return;
    const numbered = /^(\d{1,10})(?:\s+|$)(.*)$/u.exec(text);
    if (numbered !== null) {
      this.defineTarget(numbered[1]!, line);
      text = numbered[2]!.trim();
    }
    const named = /^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/u.exec(text);
    if (named !== null) {
      this.defineTarget(named[1]!, line);
      text = named[2]!.trim();
    }
    for (const statement of splitOutsideStrings(text, ":")) {
      if (statement.trim().length > 0)
        this.compileStatement(statement, line, 0);
    }
  }

  private compileStatement(source: string, line: number, depth: number): void {
    this.statements += 1;
    if (this.statements > maximumStatements)
      throw new Cs486CompileError("QBasic statement limit exceeded", line);
    if (depth > maximumInlineDepth)
      throw new Cs486CompileError("inline IF nesting limit exceeded", line);
    const text = source.trim();
    if (text.length === 0 || /^REM(?:\s|$)/iu.test(text)) return;
    if (unsafeStatements.test(text) || unsafeExpression.test(text)) {
      throw new Cs486CompileError(
        "sandboxed CS QBASIC does not expose host shell, ports, raw memory, machine code, COM, or LPT devices",
        line,
      );
    }
    if (
      /^(?:ALIAS|BYVAL|CDECL|COMMAND\$|EVENT|LOCAL|SADD|SETMEM|SIGNAL|UEVENT)\b/iu.test(
        text,
      )
    ) {
      throw new Cs486CompileError(
        `QuickBASIC-only statement is not available in QBasic: ${text.split(/\s/u, 1)[0]}`,
        line,
      );
    }
    if (
      /^(?:AUTO|CONT|DELETE|EDIT|LIST|LLIST|LOAD|MERGE|MOTOR|NEW|RENUM|SAVE|USR)\b/iu.test(
        text,
      )
    ) {
      throw new Cs486CompileError(
        `GW-BASIC statement is not available in QBasic: ${text.split(/\s/u, 1)[0]}`,
        line,
      );
    }

    const print = /^(?:PRINT|\?)(?:\s+(.*))?$/isu.exec(text);
    if (print !== null) {
      this.compilePrint(print[1] ?? "", line);
      return;
    }
    const assignment =
      /^(?:LET\s+)?([A-Za-z_][A-Za-z0-9_]*[%&!#]?)\s*=\s*(.+)$/isu.exec(text);
    if (assignment !== null) {
      this.assign(assignment[1]!, assignment[2]!, line);
      return;
    }
    const dimension = /^DIM\s+(.+)$/isu.exec(text);
    if (dimension !== null) {
      for (const declaration of splitOutsideStrings(dimension[1]!, ",")) {
        const match =
          /^([A-Za-z_][A-Za-z0-9_]*[%&!#$]?)(?:\s+AS\s+(?:INTEGER|LONG|SINGLE|DOUBLE|STRING))?$/iu.exec(
            declaration.trim(),
          );
        if (match === null)
          throw new Cs486CompileError(
            "only scalar DIM declarations are currently supported",
            line,
          );
        if (match[1]!.endsWith("$") || /\s+AS\s+STRING$/iu.test(declaration)) {
          throw new Cs486CompileError(
            "string variables are not yet implemented; string literals are supported by PRINT",
            line,
          );
        }
        this.variable(match[1]!, line);
      }
      return;
    }
    if (/^(?:DEFINT|DEFLNG|DEFSNG|DEFDBL)\b/iu.test(text)) return;
    if (/^OPTION\s+BASE\s+[01]$/iu.test(text)) return;

    const forStatement =
      /^FOR\s+([A-Za-z_][A-Za-z0-9_]*[%&!#]?)\s*=\s*(.+?)\s+TO\s+(.+?)(?:\s+STEP\s+(.+))?$/isu.exec(
        text,
      );
    if (forStatement !== null) {
      this.beginFor(
        forStatement[1]!,
        forStatement[2]!,
        forStatement[3]!,
        forStatement[4] ?? "1",
        line,
      );
      return;
    }
    const next = /^NEXT(?:\s+([A-Za-z_][A-Za-z0-9_]*[%&!#]?))?$/iu.exec(text);
    if (next !== null) {
      this.endFor(next[1], line);
      return;
    }
    const whileStatement = /^WHILE\s+(.+)$/isu.exec(text);
    if (whileStatement !== null) {
      const start = this.label("while");
      const end = this.label("wend");
      this.emit(`${start}:`);
      this.expression(whileStatement[1]!, line);
      this.emit("cmp eax, 0", `je ${end}`);
      this.blocks.push({ end, kind: "while", start });
      return;
    }
    if (/^WEND$/iu.test(text)) {
      const block = this.takeBlock("while", "WEND", line);
      this.emit(`jmp ${block.start}`, `${block.end}:`);
      return;
    }
    const doStatement = /^DO(?:\s+(WHILE|UNTIL)\s+(.+))?$/isu.exec(text);
    if (doStatement !== null) {
      const start = this.label("do");
      const end = this.label("loop_end");
      this.emit(`${start}:`);
      if (doStatement[1] !== undefined) {
        this.expression(doStatement[2]!, line);
        this.emit(
          "cmp eax, 0",
          `${doStatement[1].toUpperCase() === "WHILE" ? "je" : "jne"} ${end}`,
        );
      }
      this.blocks.push({ end, kind: "do", start });
      return;
    }
    const loopStatement = /^LOOP(?:\s+(WHILE|UNTIL)\s+(.+))?$/isu.exec(text);
    if (loopStatement !== null) {
      const block = this.takeBlock("do", "LOOP", line);
      if (loopStatement[1] === undefined) this.emit(`jmp ${block.start}`);
      else {
        this.expression(loopStatement[2]!, line);
        this.emit(
          "cmp eax, 0",
          `${loopStatement[1].toUpperCase() === "WHILE" ? "jne" : "je"} ${block.start}`,
        );
      }
      this.emit(`${block.end}:`);
      return;
    }
    if (/^EXIT\s+FOR$/iu.test(text)) {
      const block = [...this.blocks]
        .reverse()
        .find((value) => value.kind === "for");
      if (block === undefined)
        throw new Cs486CompileError("EXIT FOR without FOR", line);
      this.emit(`jmp ${block.end}`);
      return;
    }
    if (/^EXIT\s+DO$/iu.test(text)) {
      const block = [...this.blocks]
        .reverse()
        .find((value) => value.kind === "do");
      if (block === undefined)
        throw new Cs486CompileError("EXIT DO without DO", line);
      this.emit(`jmp ${block.end}`);
      return;
    }

    const conditional =
      /^IF\s+(.+?)\s+THEN\s+(.+?)(?:\s+ELSE\s+(.+))?$/isu.exec(text);
    if (conditional !== null) {
      const alternative = this.label("if_else");
      const end = this.label("if_end");
      this.expression(conditional[1]!, line);
      this.emit("cmp eax, 0", `je ${alternative}`);
      this.compileBranchAction(conditional[2]!, line, depth + 1);
      if (conditional[3] !== undefined) this.emit(`jmp ${end}`);
      this.emit(`${alternative}:`);
      if (conditional[3] !== undefined) {
        this.compileBranchAction(conditional[3], line, depth + 1);
        this.emit(`${end}:`);
      }
      return;
    }
    const goto = /^GO\s*TO\s+([A-Za-z_][A-Za-z0-9_]*|\d+)$/iu.exec(text);
    if (goto !== null) {
      this.jumpTo(goto[1]!, line, false);
      return;
    }
    const gosub = /^GO\s*SUB\s+([A-Za-z_][A-Za-z0-9_]*|\d+)$/iu.exec(text);
    if (gosub !== null) {
      this.jumpTo(gosub[1]!, line, true);
      return;
    }
    if (/^RETURN$/iu.test(text)) {
      this.emit("ret");
      return;
    }
    if (/^(?:END|STOP|SYSTEM)$/iu.test(text)) {
      this.emit("halt");
      return;
    }
    throw new Cs486CompileError(`unsupported QBasic statement: ${text}`, line);
  }

  private compileBranchAction(
    source: string,
    line: number,
    depth: number,
  ): void {
    const action = source.trim();
    if (/^(?:[A-Za-z_][A-Za-z0-9_]*|\d+)$/u.test(action)) {
      this.jumpTo(action, line, false);
    } else {
      this.compileStatement(action, line, depth);
    }
  }

  private compilePrint(source: string, line: number): void {
    if (source.trim().length === 0) {
      this.emit('print "\\n"');
      return;
    }
    const { items, separators, trailingSeparator } = printItems(source, line);
    for (const [index, item] of items.entries()) {
      const literal = qbasicString(item.trim(), line);
      if (literal !== undefined) this.emit(`print ${JSON.stringify(literal)}`);
      else {
        this.expression(item, line);
        this.emit("print eax");
      }
      if (separators[index] === ",") this.emit('print " "');
    }
    if (!trailingSeparator) this.emit('print "\\n"');
  }

  private assign(name: string, source: string, line: number): void {
    if (name.endsWith("$"))
      throw new Cs486CompileError(
        "string variables are not yet implemented; string literals are supported by PRINT",
        line,
      );
    this.expression(source, line);
    this.emit(`store [${String(this.variable(name, line))}], eax`);
  }

  private beginFor(
    variable: string,
    initial: string,
    endExpression: string,
    stepExpression: string,
    line: number,
  ): void {
    if (/^[+-]?0+$/u.test(stepExpression.trim()))
      throw new Cs486CompileError("FOR STEP cannot be zero", line);
    this.assign(variable, initial, line);
    this.expression(endExpression, line);
    const id = this.nextLabel++;
    const endAddress = this.variable(`__for_end_${String(id)}`, line);
    this.emit(`store [${String(endAddress)}], eax`);
    this.expression(stepExpression, line);
    const stepAddress = this.variable(`__for_step_${String(id)}`, line);
    this.emit(`store [${String(stepAddress)}], eax`);
    const start = `for_check_${String(id)}`;
    const negative = `for_negative_${String(id)}`;
    const body = `for_body_${String(id)}`;
    const end = `for_end_${String(id)}`;
    this.emit(
      `${start}:`,
      `load eax, [${String(this.variable(variable, line))}]`,
      `load ebx, [${String(endAddress)}]`,
      `load ecx, [${String(stepAddress)}]`,
      "cmp ecx, 0",
      `jl ${negative}`,
      "cmp eax, ebx",
      `jg ${end}`,
      `jmp ${body}`,
      `${negative}:`,
      "cmp eax, ebx",
      `jl ${end}`,
      `${body}:`,
    );
    this.blocks.push({
      body,
      end,
      endAddress,
      kind: "for",
      start,
      stepAddress,
      variable: normalizeVariable(variable),
    });
  }

  private endFor(variable: string | undefined, line: number): void {
    const block = this.takeBlock("for", "NEXT", line);
    if (
      variable !== undefined &&
      normalizeVariable(variable) !== block.variable
    ) {
      throw new Cs486CompileError(
        `NEXT ${variable} does not match FOR ${block.variable}`,
        line,
      );
    }
    const address = this.variable(block.variable, line);
    this.emit(
      `load eax, [${String(address)}]`,
      `load ebx, [${String(block.stepAddress)}]`,
      "add eax, ebx",
      `store [${String(address)}], eax`,
      `jmp ${block.start}`,
      `${block.end}:`,
    );
  }

  private takeBlock<T extends Block["kind"]>(
    kind: T,
    closing: string,
    line: number,
  ): Extract<Block, { readonly kind: T }> {
    const block = this.blocks.pop();
    if (block?.kind !== kind) {
      if (block !== undefined) this.blocks.push(block);
      throw new Cs486CompileError(
        `${closing} without ${kind.toUpperCase()}`,
        line,
      );
    }
    return block as Extract<Block, { readonly kind: T }>;
  }

  private expression(source: string, line: number): void {
    const call = /^([A-Za-z_][A-Za-z0-9_]*)\s*\(\s*\)$/u.exec(source.trim());
    if (call !== null) {
      throw new Cs486CompileError(
        `function calls are not yet implemented: ${call[1]}()`,
        line,
      );
    }
    const tokens = expressionTokens(source, line);
    const output: ExpressionToken[] = [];
    const operators: ExpressionToken[] = [];
    let expectOperand = true;
    for (const token of tokens) {
      if (token.kind === "number" || token.kind === "identifier") {
        output.push(token);
        expectOperand = false;
        continue;
      }
      if (token.kind === "paren" && token.value === "(") {
        operators.push(token);
        expectOperand = true;
        continue;
      }
      if (token.kind === "paren" && token.value === ")") {
        while (operators.at(-1)?.value !== "(" && operators.length > 0)
          output.push(operators.pop()!);
        if (operators.pop()?.value !== "(")
          throw new Cs486CompileError("unbalanced expression", line);
        expectOperand = false;
        continue;
      }
      let operator = token.value.toUpperCase();
      if (expectOperand && (operator === "+" || operator === "-")) {
        operator = operator === "+" ? "U+" : "U-";
      } else if (expectOperand && operator !== "NOT") {
        throw new Cs486CompileError("operator is missing an operand", line);
      }
      const normalized = { kind: "operator", value: operator } as const;
      while (
        operators.at(-1)?.kind === "operator" &&
        (precedence(operators.at(-1)!.value) > precedence(operator) ||
          (precedence(operators.at(-1)!.value) === precedence(operator) &&
            !isRightAssociative(operator)))
      ) {
        output.push(operators.pop()!);
      }
      operators.push(normalized);
      expectOperand = true;
    }
    if (expectOperand)
      throw new Cs486CompileError("expression ends with an operator", line);
    while (operators.length > 0) {
      const token = operators.pop()!;
      if (token.kind === "paren")
        throw new Cs486CompileError("unbalanced expression", line);
      output.push(token);
    }
    let stack = 0;
    for (const token of output) {
      if (token.kind === "number") {
        this.emit(
          `mov eax, ${String(parseNumber(token.value, line))}`,
          "push eax",
        );
        stack += 1;
      } else if (token.kind === "identifier") {
        const upper = token.value.toUpperCase();
        if (upper === "TRUE") this.emit("mov eax, -1", "push eax");
        else if (upper === "FALSE") this.emit("mov eax, 0", "push eax");
        else {
          if (token.value.endsWith("$"))
            throw new Cs486CompileError(
              "string expressions are not yet implemented",
              line,
            );
          this.emit(
            `load eax, [${String(this.variable(token.value, line))}]`,
            "push eax",
          );
        }
        stack += 1;
      } else if (
        token.value === "U+" ||
        token.value === "U-" ||
        token.value === "NOT"
      ) {
        if (stack < 1)
          throw new Cs486CompileError("missing unary operand", line);
        this.emit("pop eax");
        if (token.value === "U-")
          this.emit("mov ebx, 0", "sub ebx, eax", "push ebx");
        else if (token.value === "NOT") this.emit("xor eax, -1", "push eax");
        else this.emit("push eax");
      } else {
        if (stack < 2)
          throw new Cs486CompileError("missing binary operand", line);
        stack -= 1;
        this.emitBinary(token.value, line);
      }
    }
    if (stack !== 1) throw new Cs486CompileError("invalid expression", line);
    this.emit("pop eax");
  }

  private emitBinary(operator: string, line: number): void {
    this.emit("pop ebx", "pop eax");
    const instruction = new Map([
      ["+", "add"],
      ["-", "sub"],
      ["*", "mul"],
      ["/", "div"],
      ["\\", "div"],
      ["MOD", "mod"],
      ["AND", "and"],
      ["OR", "or"],
      ["XOR", "xor"],
    ]).get(operator);
    if (instruction !== undefined) {
      this.emit(`${instruction} eax, ebx`, "push eax");
      return;
    }
    const jump = new Map([
      ["=", "je"],
      ["<>", "jne"],
      ["<", "jl"],
      ["<=", "jle"],
      [">", "jg"],
      [">=", "jge"],
    ]).get(operator);
    if (jump === undefined)
      throw new Cs486CompileError(
        `unsupported expression operator: ${operator}`,
        line,
      );
    const truthy = this.label("compare_true");
    const end = this.label("compare_end");
    this.emit(
      "cmp eax, ebx",
      `${jump} ${truthy}`,
      "mov eax, 0",
      `jmp ${end}`,
      `${truthy}:`,
      "mov eax, -1",
      `${end}:`,
      "push eax",
    );
  }

  private defineTarget(target: string, line: number): void {
    const label = targetLabel(target);
    if (this.labels.has(label))
      throw new Cs486CompileError(`duplicate line or label: ${target}`, line);
    this.labels.add(label);
    this.emit(`${label}:`);
  }

  private jumpTo(target: string, line: number, call: boolean): void {
    const label = targetLabel(target);
    this.references.set(label, line);
    this.emit(`${call ? "call" : "jmp"} ${label}`);
  }

  private variable(name: string, line: number): number {
    const normalized = normalizeVariable(name);
    if (normalized.length > 40)
      throw new Cs486CompileError(
        "QBasic variable names are limited to 40 characters",
        line,
      );
    let address = this.variables.get(normalized);
    if (address === undefined) {
      if (this.variables.size >= maximumVariables)
        throw new Cs486CompileError("QBasic variable limit exceeded", line);
      address = this.nextAddress;
      this.nextAddress += 4;
      this.variables.set(normalized, address);
    }
    return address;
  }

  private label(prefix: string): string {
    return `qb_${prefix}_${String(this.nextLabel++)}`;
  }

  private emit(...source: readonly string[]): void {
    this.assembly.push(...source);
  }
}

function stripComment(source: string): string {
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === '"') {
      if (quoted && source[index + 1] === '"') {
        index += 1;
        continue;
      }
      quoted = !quoted;
    } else if (source[index] === "'" && !quoted) return source.slice(0, index);
  }
  return source;
}

function splitOutsideStrings(source: string, separator: string): string[] {
  const result: string[] = [];
  let start = 0;
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === '"') {
      if (quoted && source[index + 1] === '"') index += 1;
      else quoted = !quoted;
    } else if (!quoted && source[index] === separator) {
      result.push(source.slice(start, index));
      start = index + 1;
    }
  }
  result.push(source.slice(start));
  return result;
}

function printItems(
  source: string,
  line: number,
): {
  readonly items: readonly string[];
  readonly separators: readonly string[];
  readonly trailingSeparator: boolean;
} {
  const items: string[] = [];
  const separators: string[] = [];
  let start = 0;
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === '"') {
      if (quoted && source[index + 1] === '"') index += 1;
      else quoted = !quoted;
    } else if (!quoted && (source[index] === ";" || source[index] === ",")) {
      const item = source.slice(start, index).trim();
      if (item.length > 0) items.push(item);
      separators.push(source[index]!);
      start = index + 1;
    }
  }
  if (quoted) throw new Cs486CompileError("unterminated string literal", line);
  const tail = source.slice(start).trim();
  if (tail.length > 0) items.push(tail);
  const trailingSeparator = /[;,]\s*$/u.test(source);
  if (items.length === 0 && !trailingSeparator)
    throw new Cs486CompileError("PRINT expression is empty", line);
  return { items, separators, trailingSeparator };
}

function qbasicString(source: string, line: number): string | undefined {
  if (!source.startsWith('"')) return undefined;
  let value = "";
  for (let index = 1; index < source.length; index += 1) {
    const character = source[index]!;
    if (character !== '"') {
      value += character;
      continue;
    }
    if (source[index + 1] === '"') {
      value += '"';
      index += 1;
      continue;
    }
    if (source.slice(index + 1).trim().length > 0) {
      throw new Cs486CompileError(
        "string expressions are not yet implemented",
        line,
      );
    }
    return value;
  }
  throw new Cs486CompileError("unterminated string literal", line);
}

function expressionTokens(source: string, line: number): ExpressionToken[] {
  const tokens: ExpressionToken[] = [];
  let index = 0;
  while (index < source.length) {
    const rest = source.slice(index);
    const whitespace = /^\s+/u.exec(rest);
    if (whitespace !== null) {
      index += whitespace[0].length;
      continue;
    }
    const number = /^(?:&H[0-9A-F]+|&O[0-7]+|\d+)/iu.exec(rest);
    if (number !== null) {
      tokens.push({ kind: "number", value: number[0] });
      index += number[0].length;
      continue;
    }
    const identifier = /^[A-Za-z_][A-Za-z0-9_]*[%&!#$]?/u.exec(rest);
    if (identifier !== null) {
      const value = identifier[0];
      tokens.push({
        kind: /^(?:AND|MOD|NOT|OR|XOR)$/iu.test(value)
          ? "operator"
          : "identifier",
        value,
      });
      index += value.length;
      continue;
    }
    const comparison = /^(?:<=|>=|<>)/u.exec(rest);
    if (comparison !== null) {
      tokens.push({ kind: "operator", value: comparison[0] });
      index += comparison[0].length;
      continue;
    }
    const character = rest[0]!;
    if (character === "(" || character === ")") {
      tokens.push({ kind: "paren", value: character });
      index += 1;
      continue;
    }
    if (["+", "-", "*", "/", "\\", "=", "<", ">"].includes(character)) {
      tokens.push({ kind: "operator", value: character });
      index += 1;
      continue;
    }
    throw new Cs486CompileError(
      `invalid expression token near: ${rest.slice(0, 12)}`,
      line,
    );
  }
  if (tokens.length === 0 || tokens.length > maximumExpressionTokens)
    throw new Cs486CompileError("invalid or oversized expression", line);
  return tokens;
}

function precedence(operator: string): number {
  if (operator === "U+" || operator === "U-" || operator === "NOT") return 7;
  if (["*", "/", "\\", "MOD"].includes(operator)) return 6;
  if (operator === "+" || operator === "-") return 5;
  if (["=", "<>", "<", "<=", ">", ">="].includes(operator)) return 4;
  if (operator === "AND") return 3;
  if (operator === "OR" || operator === "XOR") return 2;
  return 0;
}

function isRightAssociative(operator: string): boolean {
  return operator === "U+" || operator === "U-" || operator === "NOT";
}

function parseNumber(source: string, line: number): number {
  const value = /^&H/iu.test(source)
    ? Number.parseInt(source.slice(2), 16)
    : /^&O/iu.test(source)
      ? Number.parseInt(source.slice(2), 8)
      : Number(source);
  if (
    !Number.isSafeInteger(value) ||
    value < -2_147_483_648 ||
    value > 2_147_483_647
  )
    throw new Cs486CompileError(
      "integer literal is outside the LONG range",
      line,
    );
  return value;
}

function normalizeVariable(name: string): string {
  return name.toLowerCase().replace(/[%&!#]$/u, "");
}

function targetLabel(target: string): string {
  return /^\d+$/u.test(target)
    ? `basic_${target}`
    : `qb_user_${target.toLowerCase()}`;
}
