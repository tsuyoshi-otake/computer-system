import { utf8ByteLength } from "../../domain/text/utf8.js";

export const linuxJqLimits = Object.freeze({
  maximumArrayElements: 512,
  maximumDocuments: 4_096,
  maximumFilterCharacters: 512,
  maximumFilterStages: 32,
  maximumInputBytes: 256_000,
  maximumJsonDepth: 32,
  maximumObjectEntries: 512,
  maximumOutputBytes: 256_000,
  maximumResults: 4_096,
  maximumStringCharacters: 16_384,
  maximumSteps: 32_768,
});

export interface LinuxJqResult {
  readonly exitCode: number;
  readonly stderr: string;
  readonly stdout: string;
}

type TextFileReader = (path: string) => string;
type JsonArray = readonly JsonValue[];
type JsonObject = ReadonlyMap<string, JsonValue>;
type JsonValue = JsonArray | JsonObject | boolean | null | number | string;

type FilterStage =
  | { readonly kind: "collection"; readonly filter: Filter }
  | { readonly kind: "keys" | "length" }
  | { readonly kind: "path"; readonly steps: readonly PathStep[] }
  | { readonly kind: "select"; readonly predicate: SelectPredicate };

interface Filter {
  readonly stages: readonly FilterStage[];
}

type PathStep =
  | { readonly kind: "field"; readonly name: string }
  | { readonly index: number; readonly kind: "index" }
  | { readonly kind: "iterate" };

interface SelectPredicate {
  readonly expected: JsonValue;
  readonly equals: boolean;
  readonly steps: readonly PathStep[];
}

interface EvaluationBudget {
  results: number;
  steps: number;
}

class LinuxJqError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LinuxJqError";
  }
}

/**
 * Runs a deliberately bounded jq subset entirely over guest text and files.
 * No filter is evaluated by the host JavaScript runtime.
 */
export function executeLinuxJq(
  arguments_: readonly string[],
  stdin: string,
  readFile: TextFileReader,
): LinuxJqResult {
  try {
    const parsed = parseArguments(arguments_);
    const input =
      parsed.paths.length === 0
        ? [stdin]
        : parsed.paths.map((path) => readFile(path));
    const inputBytes = input.reduce(
      (total, source) => total + utf8ByteLength(source),
      0,
    );
    if (inputBytes > linuxJqLimits.maximumInputBytes) {
      throw new LinuxJqError("input byte limit exceeded");
    }
    const filter = parseFilter(parsed.filter);
    const output: string[] = [];
    let outputBytes = 0;
    const budget: EvaluationBudget = { results: 0, steps: 0 };
    for (const source of input) {
      for (const value of new BoundedJsonParser(source).parseDocuments()) {
        const values = applyFilter(filter, value, budget);
        for (const result of values) {
          const line = `${renderResult(result, parsed.raw)}\n`;
          outputBytes += utf8ByteLength(line);
          if (outputBytes > linuxJqLimits.maximumOutputBytes) {
            throw new LinuxJqError("output byte limit exceeded");
          }
          output.push(line);
        }
      }
    }
    return { exitCode: 0, stderr: "", stdout: output.join("") };
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : String(error);
    return { exitCode: 2, stderr: `jq: ${detail}\n`, stdout: "" };
  }
}

function parseArguments(arguments_: readonly string[]): {
  readonly filter: string;
  readonly paths: readonly string[];
  readonly raw: boolean;
} {
  let raw = false;
  let options = true;
  let filter: string | undefined;
  const paths: string[] = [];
  for (const argument of arguments_) {
    if (filter !== undefined) {
      paths.push(argument);
      continue;
    }
    if (options && argument === "--") {
      options = false;
      continue;
    }
    if (options && argument === "-r") {
      raw = true;
      continue;
    }
    if (options && argument.startsWith("-")) {
      throw new LinuxJqError("Usage: jq [-r] <filter> [file ...]");
    }
    filter = argument;
  }
  if (filter === undefined) {
    throw new LinuxJqError("Usage: jq [-r] <filter> [file ...]");
  }
  if (paths.length > 16) throw new LinuxJqError("file operand limit exceeded");
  return { filter, paths, raw };
}

function parseFilter(source: string): Filter {
  if (source.length === 0) throw new LinuxJqError("empty filter");
  if (utf8ByteLength(source) > linuxJqLimits.maximumFilterCharacters) {
    throw new LinuxJqError("filter character limit exceeded");
  }
  const stages = splitTopLevel(source, "|").map((stage) =>
    parseFilterStage(stage),
  );
  if (stages.length > linuxJqLimits.maximumFilterStages) {
    throw new LinuxJqError("filter stage limit exceeded");
  }
  return { stages };
}

function parseFilterStage(source: string): FilterStage {
  const stage = source.trim();
  if (stage === "length") return { kind: "length" };
  if (stage === "keys") return { kind: "keys" };
  if (stage.startsWith("[") && stage.endsWith("]")) {
    const nested = stage.slice(1, -1).trim();
    if (nested.length === 0) throw new LinuxJqError("empty collection filter");
    return { filter: parseFilter(nested), kind: "collection" };
  }
  if (stage.startsWith("select(") && stage.endsWith(")")) {
    return { kind: "select", predicate: parseSelect(stage.slice(7, -1)) };
  }
  return { kind: "path", steps: parsePath(stage) };
}

function parseSelect(source: string): SelectPredicate {
  const operator = findTopLevelComparison(source);
  if (operator === undefined) {
    throw new LinuxJqError(
      "select supports only a == or != JSON literal predicate",
    );
  }
  const left = source.slice(0, operator.index).trim();
  const right = source.slice(operator.index + 2).trim();
  if (right.length === 0)
    throw new LinuxJqError("select predicate is incomplete");
  const values = new BoundedJsonParser(right).parseDocuments();
  if (values.length !== 1) {
    throw new LinuxJqError("select right side must be one JSON literal");
  }
  return {
    equals: operator.value === "==",
    expected: values[0]!,
    steps: parsePath(left),
  };
}

function parsePath(source: string): readonly PathStep[] {
  if (!source.startsWith(".")) {
    throw new LinuxJqError(`unsupported filter stage: ${source}`);
  }
  const steps: PathStep[] = [];
  let cursor = 1;
  while (cursor < source.length) {
    if (source[cursor] === "[") {
      const parsed = parseBracketPathStep(source, cursor);
      steps.push(parsed.step);
      cursor = parsed.cursor;
      continue;
    }
    if (source[cursor] === ".") cursor += 1;
    const match = /^[A-Za-z_][A-Za-z0-9_]*/u.exec(source.slice(cursor));
    if (match === null) {
      throw new LinuxJqError(`unsupported path syntax: ${source}`);
    }
    steps.push({ kind: "field", name: match[0] });
    cursor += match[0].length;
  }
  return steps;
}

function parseBracketPathStep(
  source: string,
  start: number,
): { readonly cursor: number; readonly step: PathStep } {
  let cursor = start + 1;
  if (source[cursor] === "]") {
    return { cursor: cursor + 1, step: { kind: "iterate" } };
  }
  if (source[cursor] === '"') {
    const string = readJsonStringAt(source, cursor);
    cursor = string.cursor;
    if (source[cursor] !== "]") {
      throw new LinuxJqError("missing closing ] in path");
    }
    return {
      cursor: cursor + 1,
      step: { kind: "field", name: string.value },
    };
  }
  const index = /^-?\d{1,4}/u.exec(source.slice(cursor));
  if (index === null || source[cursor + index[0].length] !== "]") {
    throw new LinuxJqError("array index must be an integer or []");
  }
  const value = Number(index[0]);
  if (!Number.isSafeInteger(value) || Math.abs(value) > 9_999) {
    throw new LinuxJqError("array index limit exceeded");
  }
  return {
    cursor: cursor + index[0].length + 1,
    step: { index: value, kind: "index" },
  };
}

function readJsonStringAt(
  source: string,
  start: number,
): { readonly cursor: number; readonly value: string } {
  let cursor = start + 1;
  let escaped = false;
  let closed = false;
  while (cursor < source.length) {
    const character = source[cursor++]!;
    if (escaped) escaped = false;
    else if (character === "\\") escaped = true;
    else if (character === '"') {
      closed = true;
      break;
    }
  }
  if (!closed) throw new LinuxJqError("unterminated JSON string");
  const values = new BoundedJsonParser(
    source.slice(start, cursor),
  ).parseDocuments();
  if (values.length !== 1 || typeof values[0] !== "string") {
    throw new LinuxJqError("invalid JSON string");
  }
  return { cursor, value: values[0] };
}

function findTopLevelComparison(
  source: string,
): { readonly index: number; readonly value: "!=" | "==" } | undefined {
  let quoted = false;
  let escaped = false;
  let brackets = 0;
  let parentheses = 0;
  for (let index = 0; index < source.length - 1; index += 1) {
    const character = source[index]!;
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === "\\" && quoted) {
      escaped = true;
      continue;
    }
    if (character === '"') {
      quoted = !quoted;
      continue;
    }
    if (quoted) continue;
    if (character === "[") brackets += 1;
    else if (character === "]") brackets -= 1;
    else if (character === "(") parentheses += 1;
    else if (character === ")") parentheses -= 1;
    if (brackets === 0 && parentheses === 0) {
      const candidate = source.slice(index, index + 2);
      if (candidate === "==" || candidate === "!=") {
        return { index, value: candidate };
      }
    }
  }
  return undefined;
}

function splitTopLevel(source: string, separator: "|"): readonly string[] {
  const parts: string[] = [];
  let current = "";
  let quoted = false;
  let escaped = false;
  let brackets = 0;
  let parentheses = 0;
  for (const character of source) {
    if (escaped) {
      current += character;
      escaped = false;
      continue;
    }
    if (character === "\\" && quoted) {
      current += character;
      escaped = true;
      continue;
    }
    if (character === '"') {
      current += character;
      quoted = !quoted;
      continue;
    }
    if (!quoted && character === "[") brackets += 1;
    else if (!quoted && character === "]") brackets -= 1;
    else if (!quoted && character === "(") parentheses += 1;
    else if (!quoted && character === ")") parentheses -= 1;
    if (brackets < 0 || parentheses < 0) {
      throw new LinuxJqError("unbalanced filter delimiters");
    }
    if (
      !quoted &&
      brackets === 0 &&
      parentheses === 0 &&
      character === separator
    ) {
      if (current.trim().length === 0)
        throw new LinuxJqError("empty filter stage");
      parts.push(current.trim());
      current = "";
      continue;
    }
    current += character;
  }
  if (quoted || brackets !== 0 || parentheses !== 0) {
    throw new LinuxJqError("unbalanced filter delimiters");
  }
  if (current.trim().length === 0) throw new LinuxJqError("empty filter stage");
  parts.push(current.trim());
  return parts;
}

function applyFilter(
  filter: Filter,
  input: JsonValue,
  budget: EvaluationBudget,
): readonly JsonValue[] {
  let values: readonly JsonValue[] = [input];
  for (const stage of filter.stages) {
    const next: JsonValue[] = [];
    for (const value of values) {
      budget.steps += 1;
      if (budget.steps > linuxJqLimits.maximumSteps) {
        throw new LinuxJqError("filter evaluation step limit exceeded");
      }
      const produced = applyStage(stage, value, budget);
      for (const result of produced) {
        budget.results += 1;
        if (budget.results > linuxJqLimits.maximumResults) {
          throw new LinuxJqError("filter result limit exceeded");
        }
        next.push(result);
      }
    }
    values = next;
  }
  return values;
}

function applyStage(
  stage: FilterStage,
  value: JsonValue,
  budget: EvaluationBudget,
): readonly JsonValue[] {
  if (stage.kind === "path") return applyPath(stage.steps, value);
  if (stage.kind === "collection")
    return [applyFilter(stage.filter, value, budget)];
  if (stage.kind === "select") {
    const candidates = applyPath(stage.predicate.steps, value);
    const matched = candidates.some((candidate) =>
      jsonEquals(candidate, stage.predicate.expected),
    );
    return matched === stage.predicate.equals ? [value] : [];
  }
  return stage.kind === "length" ? [jsonLength(value)] : [jsonKeys(value)];
}

function applyPath(
  steps: readonly PathStep[],
  input: JsonValue,
): readonly JsonValue[] {
  let values: readonly JsonValue[] = [input];
  for (const step of steps) {
    const next: JsonValue[] = [];
    for (const value of values) {
      if (step.kind === "field") {
        if (!isJsonObject(value)) {
          throw new LinuxJqError(
            "cannot select an object key from this JSON value",
          );
        }
        next.push(value.get(step.name) ?? null);
      } else if (step.kind === "index") {
        if (!isJsonArray(value)) {
          throw new LinuxJqError("cannot index this JSON value");
        }
        const index = step.index < 0 ? value.length + step.index : step.index;
        next.push(value[index] ?? null);
      } else if (isJsonArray(value)) {
        next.push(...value);
      } else if (isJsonObject(value)) {
        next.push(...value.values());
      } else {
        throw new LinuxJqError("cannot iterate this JSON value");
      }
    }
    values = next;
  }
  return values;
}

function jsonLength(value: JsonValue): number {
  if (isJsonArray(value) || typeof value === "string") return value.length;
  if (isJsonObject(value)) return value.size;
  if (value === null) return 0;
  if (typeof value === "number") return Math.abs(value);
  throw new LinuxJqError("length is unsupported for this JSON value");
}

function jsonKeys(value: JsonValue): JsonArray {
  if (isJsonObject(value)) return [...value.keys()].sort();
  if (isJsonArray(value)) return value.map((_entry, index) => index);
  throw new LinuxJqError("keys is supported for JSON objects and arrays");
}

function jsonEquals(left: JsonValue, right: JsonValue): boolean {
  if (left === right) return true;
  if (isJsonArray(left) && isJsonArray(right)) {
    return (
      left.length === right.length &&
      left.every((value, index) => jsonEquals(value, right[index]!))
    );
  }
  if (isJsonObject(left) && isJsonObject(right)) {
    return (
      left.size === right.size &&
      [...left].every(
        ([key, value]) => right.has(key) && jsonEquals(value, right.get(key)!),
      )
    );
  }
  return false;
}

function renderResult(value: JsonValue, raw: boolean): string {
  return raw && typeof value === "string" ? value : serializeJson(value);
}

function serializeJson(value: JsonValue): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return `"${escapeJsonString(value)}"`;
  if (isJsonArray(value)) return `[${value.map(serializeJson).join(",")}]`;
  if (!isJsonObject(value)) {
    throw new LinuxJqError("unsupported JSON value during serialization");
  }
  return `{${[...value.entries()]
    .map(([key, item]) => `"${escapeJsonString(key)}":${serializeJson(item)}`)
    .join(",")}}`;
}

function isJsonArray(value: JsonValue): value is JsonArray {
  return Array.isArray(value);
}

function isJsonObject(value: JsonValue): value is JsonObject {
  return value instanceof Map;
}

function escapeJsonString(value: string): string {
  let output = "";
  for (const character of value) {
    const code = character.codePointAt(0)!;
    if (character === '"') output += '\\"';
    else if (character === "\\") output += "\\\\";
    else if (character === "\b") output += "\\b";
    else if (character === "\f") output += "\\f";
    else if (character === "\n") output += "\\n";
    else if (character === "\r") output += "\\r";
    else if (character === "\t") output += "\\t";
    else if (code < 0x20) output += `\\u${code.toString(16).padStart(4, "0")}`;
    else output += character;
  }
  return output;
}

class BoundedJsonParser {
  private cursor = 0;
  private values = 0;

  constructor(private readonly source: string) {}

  parseDocuments(): readonly JsonValue[] {
    const documents: JsonValue[] = [];
    this.skipWhitespace();
    while (this.cursor < this.source.length) {
      documents.push(this.parseValue(0));
      if (documents.length > linuxJqLimits.maximumDocuments) {
        throw new LinuxJqError("JSON document limit exceeded");
      }
      this.skipWhitespace();
    }
    if (documents.length === 0) throw new LinuxJqError("expected JSON input");
    return documents;
  }

  private parseValue(depth: number): JsonValue {
    if (depth > linuxJqLimits.maximumJsonDepth) {
      throw new LinuxJqError("JSON nesting limit exceeded");
    }
    this.values += 1;
    if (this.values > linuxJqLimits.maximumResults) {
      throw new LinuxJqError("JSON value limit exceeded");
    }
    const character = this.source[this.cursor];
    if (character === '"') return this.parseString();
    if (character === "[") return this.parseArray(depth + 1);
    if (character === "{") return this.parseObject(depth + 1);
    if (this.source.startsWith("true", this.cursor)) {
      this.cursor += 4;
      return true;
    }
    if (this.source.startsWith("false", this.cursor)) {
      this.cursor += 5;
      return false;
    }
    if (this.source.startsWith("null", this.cursor)) {
      this.cursor += 4;
      return null;
    }
    const number = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/u.exec(
      this.source.slice(this.cursor),
    );
    if (number === null) throw this.syntaxError("expected a JSON value");
    const value = Number(number[0]);
    if (!Number.isFinite(value)) throw this.syntaxError("invalid JSON number");
    this.cursor += number[0].length;
    return value;
  }

  private parseArray(depth: number): JsonArray {
    this.cursor += 1;
    this.skipWhitespace();
    const values: JsonValue[] = [];
    if (this.source[this.cursor] === "]") {
      this.cursor += 1;
      return values;
    }
    for (;;) {
      values.push(this.parseValue(depth));
      if (values.length > linuxJqLimits.maximumArrayElements) {
        throw new LinuxJqError("array element limit exceeded");
      }
      this.skipWhitespace();
      const separator = this.source[this.cursor++];
      if (separator === "]") return values;
      if (separator !== ",") throw this.syntaxError("expected ',' or ']'");
      this.skipWhitespace();
    }
  }

  private parseObject(depth: number): JsonObject {
    this.cursor += 1;
    this.skipWhitespace();
    const values = new Map<string, JsonValue>();
    if (this.source[this.cursor] === "}") {
      this.cursor += 1;
      return values;
    }
    for (;;) {
      if (this.source[this.cursor] !== '"') {
        throw this.syntaxError("expected an object key");
      }
      const key = this.parseString();
      this.skipWhitespace();
      if (this.source[this.cursor++] !== ":") {
        throw this.syntaxError("expected ':' after object key");
      }
      this.skipWhitespace();
      values.set(key, this.parseValue(depth));
      if (values.size > linuxJqLimits.maximumObjectEntries) {
        throw new LinuxJqError("object entry limit exceeded");
      }
      this.skipWhitespace();
      const separator = this.source[this.cursor++];
      if (separator === "}") return values;
      if (separator !== ",") throw this.syntaxError("expected ',' or '}'");
      this.skipWhitespace();
    }
  }

  private parseString(): string {
    this.cursor += 1;
    let output = "";
    while (this.cursor < this.source.length) {
      const character = this.source[this.cursor++]!;
      if (character === '"') {
        if (output.length > linuxJqLimits.maximumStringCharacters) {
          throw new LinuxJqError("string character limit exceeded");
        }
        return output;
      }
      if (character < " ")
        throw this.syntaxError("control character in string");
      if (character !== "\\") {
        output += character;
        continue;
      }
      const escape = this.source[this.cursor++];
      switch (escape) {
        case '"':
        case "\\":
        case "/":
          output += escape;
          break;
        case "b":
          output += "\b";
          break;
        case "f":
          output += "\f";
          break;
        case "n":
          output += "\n";
          break;
        case "r":
          output += "\r";
          break;
        case "t":
          output += "\t";
          break;
        case "u": {
          const hex = this.source.slice(this.cursor, this.cursor + 4);
          if (!/^[0-9a-f]{4}$/iu.test(hex)) {
            throw this.syntaxError("invalid Unicode escape");
          }
          output += String.fromCharCode(Number.parseInt(hex, 16));
          this.cursor += 4;
          break;
        }
        default:
          throw this.syntaxError("invalid string escape");
      }
    }
    throw this.syntaxError("unterminated string");
  }

  private skipWhitespace(): void {
    while ([" ", "\n", "\r", "\t"].includes(this.source[this.cursor] ?? "")) {
      this.cursor += 1;
    }
  }

  private syntaxError(detail: string): LinuxJqError {
    return new LinuxJqError(`${detail} at byte ${String(this.cursor)}`);
  }
}
