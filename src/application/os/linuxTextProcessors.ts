import { utf8ByteLength } from "../../domain/text/utf8.js";
import {
  BoundedPatternError,
  compileBoundedPattern,
  findBoundedPattern,
  type BoundedPattern,
} from "./boundedPattern.js";

export const linuxTextProcessorLimits = Object.freeze({
  maximumFields: 64,
  maximumInputBytes: 256_000,
  maximumProgramBytes: 4_096,
  maximumRecords: 4_096,
  maximumRules: 32,
  maximumStatementsPerAction: 64,
  maximumSubstitutionsPerRecord: 1_024,
  maximumVariables: 64,
});

export interface LinuxTextProcessorResult {
  readonly exitCode: number;
  readonly stderr: string;
  readonly stdout: string;
}

type TextFileReader = (path: string) => string;

interface SedAddress {
  readonly kind: "last" | "line" | "pattern";
  readonly line?: number;
  readonly pattern?: BoundedPattern;
}

type SedCommand =
  | { readonly address?: SedAddress; readonly kind: "delete" }
  | { readonly address?: SedAddress; readonly kind: "print" }
  | {
      readonly address?: SedAddress;
      readonly global: boolean;
      readonly kind: "substitute";
      readonly pattern: BoundedPattern;
      readonly replacement: string;
    };

export function executeLinuxSed(
  arguments_: readonly string[],
  stdin: string,
  readFile: TextFileReader,
): LinuxTextProcessorResult {
  try {
    let quiet = false;
    const scripts: string[] = [];
    const files: string[] = [];
    let cursor = 0;
    while (cursor < arguments_.length) {
      const argument = arguments_[cursor]!;
      if (argument === "-n") {
        quiet = true;
        cursor += 1;
      } else if (argument === "-e") {
        const script = arguments_[cursor + 1];
        if (script === undefined)
          return usageResult("sed [-n] [-e script] script [file ...]");
        scripts.push(script);
        cursor += 2;
      } else if (scripts.length === 0) {
        scripts.push(argument);
        cursor += 1;
      } else {
        files.push(argument);
        cursor += 1;
      }
    }
    if (scripts.length === 0)
      return usageResult("sed [-n] [-e script] script [file ...]");
    const source = scripts.join(";");
    requireProgramSize("sed", source);
    const commands = splitSedCommands(source).map(parseSedCommand);
    const input = readTextInputs(files, stdin, readFile);
    const records = splitRecords(input);
    const output: string[] = [];
    for (let index = 0; index < records.length; index += 1) {
      let record = records[index]!;
      let deleted = false;
      for (const command of commands) {
        if (!sedAddressMatches(command.address, record, index, records.length))
          continue;
        if (command.kind === "delete") {
          deleted = true;
          break;
        }
        if (command.kind === "print") {
          output.push(`${record}\n`);
          continue;
        }
        record = substituteRecord(record, command);
      }
      if (!quiet && !deleted) output.push(`${record}\n`);
    }
    return ok(output.join(""));
  } catch (error: unknown) {
    return processorFailure("sed", error);
  }
}

interface AwkRule {
  readonly action: AwkAction;
  readonly pattern: AwkPattern;
}

type AwkPattern =
  | { readonly kind: "begin" | "end" | "every" }
  | { readonly kind: "match"; readonly pattern: BoundedPattern }
  | {
      readonly kind: "compare";
      readonly left: string;
      readonly operator: "!=" | "!~" | "<" | "<=" | "==" | ">" | ">=" | "~";
      readonly right: string;
    };

type AwkStatement =
  | { readonly expressions: readonly string[]; readonly kind: "print" }
  | {
      readonly expressions: readonly string[];
      readonly format: string;
      readonly kind: "printf";
    }
  | {
      readonly expression: string;
      readonly kind: "assign";
      readonly name: string;
      readonly operator: "+=" | "-=" | "=";
    }
  | {
      readonly kind: "increment";
      readonly name: string;
      readonly operator: "++" | "--";
    };

interface AwkAction {
  readonly statements: readonly AwkStatement[];
}

type AwkVariables = Map<string, string>;

interface AwkRecordContext {
  readonly fields: readonly string[];
  readonly nr: number;
  readonly record: string;
}

export function executeLinuxAwk(
  arguments_: readonly string[],
  stdin: string,
  readFile: TextFileReader,
): LinuxTextProcessorResult {
  try {
    let separator: string | undefined;
    let cursor = 0;
    if (arguments_[cursor] === "-F") {
      separator = arguments_[cursor + 1];
      if (separator === undefined || separator.length !== 1) {
        return usageResult("awk [-F char] program [file ...]");
      }
      cursor += 2;
    } else if (arguments_[cursor]?.startsWith("-F")) {
      separator = arguments_[cursor]!.slice(2);
      if (separator.length !== 1)
        return usageResult("awk [-F char] program [file ...]");
      cursor += 1;
    }
    const program = arguments_[cursor];
    if (program === undefined)
      return usageResult("awk [-F char] program [file ...]");
    requireProgramSize("awk", program);
    const rules = parseAwkProgram(program);
    const input = readTextInputs(arguments_.slice(cursor + 1), stdin, readFile);
    const records = splitRecords(input);
    const output: string[] = [];
    const variables: AwkVariables = new Map();
    const empty: AwkRecordContext = { fields: [], nr: 0, record: "" };
    runAwkRules(rules, "begin", empty, variables, output);
    for (let index = 0; index < records.length; index += 1) {
      const record = records[index]!;
      const fields =
        separator === undefined
          ? record.trim().length === 0
            ? []
            : record.trim().split(/[ \t]+/u)
          : record.split(separator);
      if (fields.length > linuxTextProcessorLimits.maximumFields) {
        throw new Error("field count limit exceeded");
      }
      runAwkRules(
        rules,
        "record",
        { fields, nr: index + 1, record },
        variables,
        output,
      );
    }
    runAwkRules(
      rules,
      "end",
      { fields: [], nr: records.length, record: "" },
      variables,
      output,
    );
    return ok(output.join(""));
  } catch (error: unknown) {
    return processorFailure("awk", error);
  }
}

function parseAwkProgram(source: string): readonly AwkRule[] {
  const rules: AwkRule[] = [];
  let cursor = 0;
  while (cursor < source.length) {
    while (/\s/u.test(source[cursor] ?? "")) cursor += 1;
    if (cursor >= source.length) break;
    const open = findAwkBrace(source, cursor);
    if (open < 0) {
      const pattern = parseAwkPattern(source.slice(cursor).trim());
      rules.push({
        action: { statements: [{ expressions: ["$0"], kind: "print" }] },
        pattern,
      });
      break;
    }
    const patternText = source.slice(cursor, open).trim();
    const close = findAwkClosingBrace(source, open + 1);
    if (close < 0) throw new Error("unterminated action block");
    rules.push({
      action: parseAwkAction(source.slice(open + 1, close).trim()),
      pattern: parseAwkPattern(patternText),
    });
    if (rules.length > linuxTextProcessorLimits.maximumRules) {
      throw new Error("rule count limit exceeded");
    }
    cursor = close + 1;
  }
  if (rules.length === 0) throw new Error("empty program");
  return rules;
}

function findAwkBrace(source: string, start: number): number {
  let quoted = false;
  let escaped = false;
  let pattern = false;
  for (let index = start; index < source.length; index += 1) {
    const character = source[index]!;
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      continue;
    }
    if (character === '"') quoted = !quoted;
    else if (!quoted && character === "/") pattern = !pattern;
    else if (!quoted && !pattern && character === "{") return index;
  }
  return -1;
}

function findAwkClosingBrace(source: string, start: number): number {
  let quoted = false;
  let escaped = false;
  for (let index = start; index < source.length; index += 1) {
    const character = source[index]!;
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      continue;
    }
    if (character === '"') quoted = !quoted;
    else if (!quoted && character === "}") return index;
  }
  return -1;
}

function parseAwkPattern(source: string): AwkPattern {
  if (source === "") return { kind: "every" };
  if (source === "BEGIN") return { kind: "begin" };
  if (source === "END") return { kind: "end" };
  if (source.startsWith("/") && source.endsWith("/") && source.length > 2) {
    return {
      kind: "match",
      pattern: compileBoundedPattern(source.slice(1, -1)),
    };
  }
  const comparison = /^(.*?)\s*(==|!=|!~|~|<=|>=|<|>)\s*(.*?)$/u.exec(source);
  if (comparison !== null && comparison[1]!.trim() && comparison[3]!.trim()) {
    return {
      kind: "compare",
      left: comparison[1]!.trim(),
      operator: comparison[2] as Extract<
        AwkPattern,
        { readonly kind: "compare" }
      >["operator"],
      right: comparison[3]!.trim(),
    };
  }
  throw new Error(`unsupported pattern: ${source}`);
}

function parseAwkAction(source: string): AwkAction {
  const statements = splitAwkStatements(source).map(parseAwkStatement);
  if (statements.length > linuxTextProcessorLimits.maximumStatementsPerAction) {
    throw new Error("statement count limit exceeded");
  }
  return { statements };
}

function parseAwkStatement(source: string): AwkStatement {
  if (source === "print") return { expressions: ["$0"], kind: "print" };
  if (source.startsWith("print ")) {
    return { expressions: splitAwkExpressions(source.slice(6)), kind: "print" };
  }
  if (source.startsWith("printf ")) {
    const expressions = splitAwkExpressions(source.slice(7));
    const formatSource = expressions.shift();
    if (formatSource === undefined) throw new Error("printf requires a format");
    const format = parseAwkString(formatSource);
    return { expressions, format, kind: "printf" };
  }
  const increment = /^([A-Za-z_][A-Za-z0-9_]{0,31})(\+\+|--)$/u.exec(source);
  if (increment !== null) {
    return {
      kind: "increment",
      name: increment[1]!,
      operator: increment[2] as "++" | "--",
    };
  }
  const assignment =
    /^([A-Za-z_][A-Za-z0-9_]{0,31})\s*(\+=|-=|=)\s*(.+)$/u.exec(source);
  if (assignment !== null) {
    return {
      expression: assignment[3]!.trim(),
      kind: "assign",
      name: assignment[1]!,
      operator: assignment[2] as "=" | "+=" | "-=",
    };
  }
  throw new Error(`unsupported action: ${source}`);
}

function splitAwkStatements(source: string): readonly string[] {
  const values: string[] = [];
  let current = "";
  let quoted = false;
  let escaped = false;
  for (const character of source) {
    if (escaped) {
      current += character;
      escaped = false;
    } else if (character === "\\") {
      current += character;
      escaped = true;
    } else if (character === '"') {
      current += character;
      quoted = !quoted;
    } else if (character === ";" && !quoted) {
      const statement = current.trim();
      if (statement.length === 0) throw new Error("empty action statement");
      values.push(statement);
      current = "";
    } else {
      current += character;
    }
  }
  if (quoted) throw new Error("unterminated string literal");
  const statement = current.trim();
  if (statement.length === 0) throw new Error("empty action statement");
  values.push(statement);
  return values;
}

function splitAwkExpressions(source: string): string[] {
  const values: string[] = [];
  let current = "";
  let quoted = false;
  let escaped = false;
  for (const character of source) {
    if (escaped) {
      current += character;
      escaped = false;
    } else if (character === "\\") {
      current += character;
      escaped = true;
    } else if (character === '"') {
      current += character;
      quoted = !quoted;
    } else if (character === "," && !quoted) {
      values.push(current.trim());
      current = "";
    } else {
      current += character;
    }
  }
  if (quoted) throw new Error("unterminated string literal");
  if (current.trim().length > 0) values.push(current.trim());
  if (
    values.length === 0 ||
    values.length > linuxTextProcessorLimits.maximumFields
  ) {
    throw new Error("expression count limit exceeded");
  }
  return values;
}

function runAwkRules(
  rules: readonly AwkRule[],
  phase: "begin" | "end" | "record",
  context: AwkRecordContext,
  variables: AwkVariables,
  output: string[],
): void {
  for (const rule of rules) {
    const applicable =
      phase === "begin"
        ? rule.pattern.kind === "begin"
        : phase === "end"
          ? rule.pattern.kind === "end"
          : rule.pattern.kind !== "begin" &&
            rule.pattern.kind !== "end" &&
            awkPatternMatches(rule.pattern, context, variables);
    if (!applicable) continue;
    for (const statement of rule.action.statements) {
      if (statement.kind === "assign") {
        setAwkVariable(
          variables,
          statement.name,
          statement.operator,
          evaluateAwkExpression(statement.expression, context, variables),
        );
        continue;
      }
      if (statement.kind === "increment") {
        setAwkVariable(
          variables,
          statement.name,
          statement.operator === "++" ? "+=" : "-=",
          "1",
        );
        continue;
      }
      const values = statement.expressions.map((expression) =>
        evaluateAwkExpression(expression, context, variables),
      );
      if (statement.kind === "print") output.push(`${values.join(" ")}\n`);
      else output.push(formatAwkPrintf(statement.format, values));
    }
  }
}

function awkPatternMatches(
  pattern: AwkPattern,
  context: AwkRecordContext,
  variables: AwkVariables,
): boolean {
  if (pattern.kind === "every") return true;
  if (pattern.kind === "match")
    return findBoundedPattern(pattern.pattern, context.record) !== undefined;
  if (pattern.kind !== "compare") return false;
  const left = evaluateAwkExpression(pattern.left, context, variables);
  const right = evaluateAwkExpression(pattern.right, context, variables);
  if (pattern.operator === "~" || pattern.operator === "!~") {
    const source = isQuotedAwkString(pattern.right)
      ? parseAwkString(pattern.right)
      : right;
    const matched =
      findBoundedPattern(compileBoundedPattern(source), left) !== undefined;
    return pattern.operator === "~" ? matched : !matched;
  }
  const leftNumber = Number(left);
  const rightNumber = Number(right);
  const numeric =
    left.trim() !== "" &&
    right.trim() !== "" &&
    Number.isFinite(leftNumber) &&
    Number.isFinite(rightNumber);
  const comparison = numeric
    ? Math.sign(leftNumber - rightNumber)
    : left.localeCompare(right);
  switch (pattern.operator) {
    case "==":
      return comparison === 0;
    case "!=":
      return comparison !== 0;
    case "<":
      return comparison < 0;
    case "<=":
      return comparison <= 0;
    case ">":
      return comparison > 0;
    case ">=":
      return comparison >= 0;
  }
}

function evaluateAwkExpression(
  source: string,
  context: AwkRecordContext,
  variables: AwkVariables,
): string {
  const trimmed = source.trim();
  const value = evaluateAwkAtom(trimmed, context, variables);
  if (value !== undefined) return value;
  return formatAwkNumber(evaluateAwkArithmetic(trimmed, context, variables));
}

function evaluateAwkAtom(
  source: string,
  context: AwkRecordContext,
  variables: AwkVariables,
): string | undefined {
  if (isQuotedAwkString(source)) return parseAwkString(source);
  if (source === "NR") return String(context.nr);
  if (source === "NF") return String(context.fields.length);
  const field = /^\$(\d{1,2})$/u.exec(source);
  if (field !== null) {
    const index = Number(field[1]);
    if (index === 0) return context.record;
    if (index > linuxTextProcessorLimits.maximumFields)
      throw new Error("field index limit exceeded");
    return context.fields[index - 1] ?? "";
  }
  if (/^-?(?:\d+|\d+\.\d+|\.\d+)$/u.test(source)) return source;
  if (/^[A-Za-z_][A-Za-z0-9_]{0,31}$/u.test(source)) {
    return variables.get(source) ?? "";
  }
  return undefined;
}

function setAwkVariable(
  variables: AwkVariables,
  name: string,
  operator: "=" | "+=" | "-=",
  value: string,
): void {
  if (
    !variables.has(name) &&
    variables.size >= linuxTextProcessorLimits.maximumVariables
  ) {
    throw new Error("variable count limit exceeded");
  }
  if (operator === "=") {
    variables.set(name, value);
    return;
  }
  const left = numericAwkValue(variables.get(name) ?? "0");
  const right = numericAwkValue(value);
  variables.set(
    name,
    formatAwkNumber(operator === "+=" ? left + right : left - right),
  );
}

type AwkArithmeticToken =
  | {
      readonly kind: "operator";
      readonly value: ")" | "(" | "*" | "+" | "-" | "/";
    }
  | { readonly kind: "value"; readonly value: string };

function evaluateAwkArithmetic(
  source: string,
  context: AwkRecordContext,
  variables: AwkVariables,
): number {
  const tokens = tokenizeAwkArithmetic(source);
  let cursor = 0;
  const consume = (): AwkArithmeticToken | undefined => tokens[cursor++];
  const peek = (): AwkArithmeticToken | undefined => tokens[cursor];
  const primary = (): number => {
    const token = consume();
    if (token === undefined)
      throw new Error("incomplete arithmetic expression");
    if (token.kind === "operator" && token.value === "(") {
      const value = sum();
      const close = consume();
      if (close?.kind !== "operator" || close.value !== ")") {
        throw new Error("missing closing parenthesis");
      }
      return value;
    }
    if (token.kind === "operator" && token.value === "+") return primary();
    if (token.kind === "operator" && token.value === "-") return -primary();
    if (token.kind !== "value") throw new Error("expected arithmetic value");
    const value = evaluateAwkAtom(token.value, context, variables);
    if (value === undefined)
      throw new Error(`unsupported expression: ${token.value}`);
    return numericAwkValue(value);
  };
  const product = (): number => {
    let value = primary();
    for (;;) {
      const token = peek();
      if (
        token?.kind !== "operator" ||
        (token.value !== "*" && token.value !== "/")
      ) {
        return value;
      }
      consume();
      const right = primary();
      if (token.value === "/" && right === 0) {
        throw new Error("division by zero");
      }
      value = token.value === "*" ? value * right : value / right;
      requireFiniteAwkNumber(value);
    }
  };
  const sum = (): number => {
    let value = product();
    for (;;) {
      const token = peek();
      if (
        token?.kind !== "operator" ||
        (token.value !== "+" && token.value !== "-")
      ) {
        return value;
      }
      consume();
      const right = product();
      value = token.value === "+" ? value + right : value - right;
      requireFiniteAwkNumber(value);
    }
  };
  const value = sum();
  if (cursor !== tokens.length)
    throw new Error("unsupported arithmetic expression");
  return value;
}

function tokenizeAwkArithmetic(source: string): readonly AwkArithmeticToken[] {
  const tokens: AwkArithmeticToken[] = [];
  let cursor = 0;
  while (cursor < source.length) {
    const character = source[cursor]!;
    if (/\s/u.test(character)) {
      cursor += 1;
      continue;
    }
    if ("()+-*/".includes(character)) {
      tokens.push({
        kind: "operator",
        value: character as Extract<
          AwkArithmeticToken,
          { kind: "operator" }
        >["value"],
      });
      cursor += 1;
      continue;
    }
    if (character === '"') {
      const start = cursor;
      cursor += 1;
      let escaped = false;
      let closed = false;
      while (cursor < source.length) {
        const current = source[cursor++]!;
        if (escaped) escaped = false;
        else if (current === "\\") escaped = true;
        else if (current === '"') {
          closed = true;
          break;
        }
      }
      if (!closed) throw new Error("unterminated string literal");
      tokens.push({ kind: "value", value: source.slice(start, cursor) });
      continue;
    }
    const field = /^\$\d{1,2}/u.exec(source.slice(cursor));
    const number = /^(?:\d+(?:\.\d*)?|\.\d+)/u.exec(source.slice(cursor));
    const identifier = /^[A-Za-z_][A-Za-z0-9_]{0,31}/u.exec(
      source.slice(cursor),
    );
    const value = field?.[0] ?? number?.[0] ?? identifier?.[0];
    if (value === undefined)
      throw new Error(`unsupported expression: ${source}`);
    tokens.push({ kind: "value", value });
    if (tokens.length > linuxTextProcessorLimits.maximumFields * 4) {
      throw new Error("arithmetic token limit exceeded");
    }
    cursor += value.length;
  }
  if (tokens.length === 0) throw new Error("empty arithmetic expression");
  return tokens;
}

function numericAwkValue(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatAwkNumber(value: number): string {
  requireFiniteAwkNumber(value);
  return String(Object.is(value, -0) ? 0 : value);
}

function requireFiniteAwkNumber(value: number): void {
  if (!Number.isFinite(value)) throw new Error("non-finite arithmetic result");
}

function isQuotedAwkString(source: string): boolean {
  return source.length >= 2 && source.startsWith('"') && source.endsWith('"');
}

function parseAwkString(source: string): string {
  if (!isQuotedAwkString(source)) throw new Error("expected string literal");
  let output = "";
  for (let index = 1; index < source.length - 1; index += 1) {
    const character = source[index]!;
    if (character !== "\\") {
      output += character;
      continue;
    }
    const escaped = source[++index];
    if (escaped === undefined || index >= source.length)
      throw new Error("invalid string escape");
    output += escaped === "n" ? "\n" : escaped === "t" ? "\t" : escaped;
  }
  return output;
}

function formatAwkPrintf(format: string, values: readonly string[]): string {
  let cursor = 0;
  let output = "";
  let valueIndex = 0;
  while (cursor < format.length) {
    if (format[cursor] !== "%") {
      output += format[cursor]!;
      cursor += 1;
      continue;
    }
    const specifier = format[cursor + 1];
    if (specifier === "%") {
      output += "%";
      cursor += 2;
      continue;
    }
    if (specifier !== "s" && specifier !== "d")
      throw new Error("printf supports only %s, %d, and %%");
    const value = values[valueIndex++];
    if (value === undefined) throw new Error("printf argument is missing");
    output +=
      specifier === "d" ? String(Math.trunc(Number(value) || 0)) : value;
    cursor += 2;
  }
  if (valueIndex !== values.length)
    throw new Error("printf has unused arguments");
  return output;
}

function splitSedCommands(source: string): readonly string[] {
  const commands: string[] = [];
  let current = "";
  let escaped = false;
  let delimiter: string | undefined;
  for (const character of source) {
    if (escaped) {
      current += character;
      escaped = false;
      continue;
    }
    if (character === "\\") {
      current += character;
      escaped = true;
      continue;
    }
    if (delimiter !== undefined) {
      current += character;
      if (character === delimiter) delimiter = undefined;
      continue;
    }
    if (
      character === "/" &&
      (/^\s*(?:\d+|\$)?\s*s$/u.test(current) || /^\s*$/u.test(current))
    ) {
      delimiter = character;
      current += character;
      continue;
    }
    if (character === ";") {
      if (current.trim().length > 0) commands.push(current.trim());
      current = "";
    } else {
      current += character;
    }
  }
  if (current.trim().length > 0) commands.push(current.trim());
  if (
    commands.length === 0 ||
    commands.length > linuxTextProcessorLimits.maximumRules
  ) {
    throw new Error("command count limit exceeded");
  }
  return commands;
}

function parseSedCommand(source: string): SedCommand {
  let cursor = 0;
  let address: SedAddress | undefined;
  if (/\d/u.test(source[cursor] ?? "")) {
    const match = /^\d+/u.exec(source)!;
    const line = Number(match[0]);
    if (!Number.isSafeInteger(line) || line < 1)
      throw new Error("invalid line address");
    address = { kind: "line", line };
    cursor = match[0].length;
  } else if (source[cursor] === "$") {
    address = { kind: "last" };
    cursor += 1;
  } else if (source[cursor] === "/") {
    const parsed = readDelimited(source, cursor);
    address = { kind: "pattern", pattern: compileBoundedPattern(parsed.value) };
    cursor = parsed.cursor;
  }
  while (source[cursor] === " " || source[cursor] === "\t") cursor += 1;
  const command = source[cursor];
  if ((command === "p" || command === "d") && cursor + 1 === source.length) {
    return {
      ...(address === undefined ? {} : { address }),
      kind: command === "p" ? "print" : "delete",
    };
  }
  if (command !== "s") throw new Error(`unsupported command: ${source}`);
  cursor += 1;
  const pattern = readDelimited(source, cursor);
  const replacement = readDelimited(source, pattern.cursor - 1);
  const flags = source.slice(replacement.cursor).trim();
  if (flags !== "" && flags !== "g")
    throw new Error(`unsupported substitution flags: ${flags}`);
  return {
    ...(address === undefined ? {} : { address }),
    global: flags === "g",
    kind: "substitute",
    pattern: compileBoundedPattern(pattern.value),
    replacement: replacement.value,
  };
}

function readDelimited(
  source: string,
  delimiterIndex: number,
): { readonly cursor: number; readonly value: string } {
  const delimiter = source[delimiterIndex];
  if (delimiter === undefined || /[A-Za-z0-9\\\s]/u.test(delimiter)) {
    throw new Error("invalid or missing delimiter");
  }
  let value = "";
  let cursor = delimiterIndex + 1;
  while (cursor < source.length) {
    const character = source[cursor]!;
    if (character === "\\" && source[cursor + 1] === delimiter) {
      value += delimiter;
      cursor += 2;
      continue;
    }
    if (character === delimiter) return { cursor: cursor + 1, value };
    value += character;
    cursor += 1;
  }
  throw new Error("unterminated delimited expression");
}

function sedAddressMatches(
  address: SedAddress | undefined,
  record: string,
  index: number,
  count: number,
): boolean {
  if (address === undefined) return true;
  if (address.kind === "line") return index + 1 === address.line;
  if (address.kind === "last") return index + 1 === count;
  return findBoundedPattern(address.pattern!, record) !== undefined;
}

function substituteRecord(
  record: string,
  command: Extract<SedCommand, { readonly kind: "substitute" }>,
): string {
  let output = "";
  let cursor = 0;
  let substitutions = 0;
  while (cursor <= record.length) {
    const match = findBoundedPattern(command.pattern, record, cursor);
    if (match === undefined) break;
    output += record.slice(cursor, match.start);
    const matched = record.slice(match.start, match.end);
    output += command.replacement.replaceAll("&", matched);
    substitutions += 1;
    if (
      substitutions > linuxTextProcessorLimits.maximumSubstitutionsPerRecord
    ) {
      throw new Error("substitution limit exceeded");
    }
    cursor = match.end;
    if (!command.global) break;
    if (match.end === match.start) cursor += 1;
  }
  return substitutions === 0 ? record : `${output}${record.slice(cursor)}`;
}

function readTextInputs(
  files: readonly string[],
  stdin: string,
  readFile: TextFileReader,
): string {
  const input =
    files.length === 0
      ? stdin
      : files.map((path) => (path === "-" ? stdin : readFile(path))).join("");
  if (utf8ByteLength(input) > linuxTextProcessorLimits.maximumInputBytes) {
    throw new Error("input byte limit exceeded");
  }
  return input;
}

function splitRecords(input: string): readonly string[] {
  const records =
    input.length === 0 ? [] : input.replace(/\n$/u, "").split("\n");
  if (records.length > linuxTextProcessorLimits.maximumRecords) {
    throw new Error("record count limit exceeded");
  }
  return records;
}

function requireProgramSize(command: string, source: string): void {
  if (utf8ByteLength(source) > linuxTextProcessorLimits.maximumProgramBytes) {
    throw new Error(`${command} program byte limit exceeded`);
  }
}

function ok(stdout = ""): LinuxTextProcessorResult {
  return { exitCode: 0, stderr: "", stdout };
}

function usageResult(syntax: string): LinuxTextProcessorResult {
  return { exitCode: 2, stderr: `usage: ${syntax}\n`, stdout: "" };
}

function processorFailure(
  command: string,
  error: unknown,
): LinuxTextProcessorResult {
  const detail =
    error instanceof BoundedPatternError || error instanceof Error
      ? error.message
      : String(error);
  return { exitCode: 2, stderr: `${command}: ${detail}\n`, stdout: "" };
}
