/**
 * Bounded lexer and parser for the CS-Linux `perl` profile.
 *
 * The parser accepts a deliberately fixed subset of Perl 5.40 and rejects
 * everything else at parse time with an explicit diagnostic, so an unsupported
 * construct can never be silently approximated at run time. The produced tree
 * is frozen and contains no host references.
 */

import { utf8ByteLength } from "../../domain/text/utf8.js";

export const perlParserLimits = Object.freeze({
  maximumBlockDepth: 32,
  maximumProgramBytes: 65_536,
  maximumStatements: 4_096,
  maximumStringCharacters: 8_192,
  maximumTokens: 32_768,
});

export class PerlSyntaxError extends Error {
  constructor(
    message: string,
    readonly line: number,
  ) {
    super(`${message} at line ${String(line)}`);
    this.name = "PerlSyntaxError";
  }
}

export type PerlSigil = "$" | "@" | "%";

export interface PerlBlock {
  readonly statements: readonly PerlStatement[];
}

export interface PerlProgram {
  readonly body: PerlBlock;
}

export interface PerlRegexLiteral {
  readonly flags: string;
  readonly pattern: PerlExpression;
}

export interface PerlDeclarationTarget {
  readonly name: string;
  readonly sigil: PerlSigil;
}

/** Statement nodes carry their source line so `die`/`warn` can report it. */
export type PerlStatement = PerlStatementNode & { readonly line?: number };

type PerlStatementNode =
  | { readonly expression: PerlExpression; readonly kind: "expression" }
  | {
      readonly branches: readonly {
        readonly body: PerlBlock;
        readonly condition: PerlExpression;
      }[];
      readonly kind: "if";
      readonly otherwise?: PerlBlock;
    }
  | {
      readonly body: PerlBlock;
      readonly condition: PerlExpression;
      readonly kind: "while";
      readonly label?: string;
    }
  | {
      readonly body: PerlBlock;
      readonly condition?: PerlExpression;
      readonly initializer?: PerlExpression;
      readonly kind: "cFor";
      readonly label?: string;
      readonly step?: PerlExpression;
    }
  | {
      readonly body: PerlBlock;
      readonly declared: boolean;
      readonly kind: "foreach";
      readonly label?: string;
      readonly list: PerlExpression;
      readonly variable?: string;
    }
  | { readonly body: PerlBlock; readonly kind: "block" }
  | { readonly body: PerlBlock; readonly kind: "sub"; readonly name: string }
  | { readonly kind: "return"; readonly value?: PerlExpression }
  | { readonly kind: "last" | "next"; readonly label?: string }
  | { readonly kind: "pragma"; readonly text: string };

export type PerlExpression =
  | { readonly kind: "number"; readonly value: number }
  | { readonly kind: "string"; readonly value: string }
  | { readonly kind: "concat"; readonly parts: readonly PerlExpression[] }
  | { readonly kind: "scalar"; readonly name: string }
  | { readonly kind: "array"; readonly name: string }
  | { readonly kind: "hash"; readonly name: string }
  | { readonly kind: "lastIndex"; readonly name: string }
  | { readonly kind: "undefined" }
  | { readonly kind: "undefine"; readonly target: PerlExpression }
  | {
      readonly container: "array" | "hash";
      readonly index: PerlExpression;
      readonly kind: "element";
      readonly name: string;
    }
  | {
      readonly container: "array" | "hash";
      readonly keys: PerlExpression;
      readonly kind: "slice";
      readonly name: string;
    }
  | { readonly items: readonly PerlExpression[]; readonly kind: "list" }
  | {
      readonly from: PerlExpression;
      readonly kind: "range";
      readonly to: PerlExpression;
    }
  | {
      readonly kind: "declaration";
      /** `my ($x) = ...` assigns a list; `my $x = ...` assigns a scalar. */
      readonly parenthesized: boolean;
      readonly targets: readonly PerlDeclarationTarget[];
    }
  | {
      readonly kind: "unary";
      readonly operand: PerlExpression;
      readonly operator: "!" | "-" | "+" | "~";
    }
  | {
      readonly kind: "binary";
      readonly left: PerlExpression;
      readonly operator: string;
      readonly right: PerlExpression;
    }
  | {
      readonly kind: "logical";
      readonly left: PerlExpression;
      readonly operator: "&&" | "||" | "//";
      readonly right: PerlExpression;
    }
  | {
      readonly kind: "assign";
      readonly operator: string;
      readonly target: PerlExpression;
      readonly value: PerlExpression;
    }
  | {
      readonly condition: PerlExpression;
      readonly kind: "ternary";
      readonly whenFalse: PerlExpression;
      readonly whenTrue: PerlExpression;
    }
  | {
      readonly by: 1 | -1;
      readonly kind: "step";
      readonly prefix: boolean;
      readonly target: PerlExpression;
    }
  | {
      readonly arguments: readonly PerlExpression[];
      readonly block?: PerlBlock;
      readonly kind: "call";
      readonly name: string;
    }
  | {
      readonly arguments: readonly PerlExpression[];
      readonly handle: PerlExpression | undefined;
      readonly kind: "output";
      readonly name: "print" | "printf" | "say";
    }
  | {
      readonly kind: "match";
      readonly negated: boolean;
      readonly regex: PerlRegexLiteral;
      readonly target: PerlExpression;
    }
  | {
      readonly kind: "substitute";
      readonly negated: boolean;
      readonly regex: PerlRegexLiteral;
      readonly replacement: PerlExpression;
      readonly returning: boolean;
      readonly target: PerlExpression;
    }
  | {
      readonly from: string;
      readonly kind: "transliterate";
      readonly modifiers: string;
      readonly target: PerlExpression;
      readonly to: string;
    }
  | {
      readonly handle: PerlExpression | undefined;
      readonly kind: "readline";
      readonly source: "argv" | "handle" | "stdin";
    }
  | {
      readonly kind: "fileTest";
      readonly operator: "d" | "e" | "f" | "s" | "z";
      readonly path: PerlExpression;
    }
  | { readonly body: PerlBlock; readonly kind: "evalBlock" };

type TokenKind =
  | "eof"
  | "identifier"
  | "number"
  | "operator"
  | "readline"
  | "regex"
  | "string"
  | "variable"
  | "words";

interface Token {
  readonly flags?: string;
  readonly interpolate?: boolean;
  readonly kind: TokenKind;
  readonly line: number;
  readonly modifiers?: string;
  readonly name?: string;
  readonly numberValue?: number;
  readonly operator?: string;
  readonly parts?: readonly string[];
  readonly sigil?: string;
  readonly text: string;
}

const wordOperators = new Set([
  "and",
  "cmp",
  "eq",
  "ge",
  "gt",
  "le",
  "lt",
  "ne",
  "or",
  "x",
  "xor",
]);

const statementModifiers = new Set([
  "for",
  "foreach",
  "if",
  "unless",
  "until",
  "while",
]);

const loopKeywords = new Set(["for", "foreach", "until", "while"]);

/** Loop labels are conventionally uppercase, and requiring it keeps
 * `LABEL:` unambiguous against every other statement that may start with a
 * bare word. */
const loopLabelPattern = /^[A-Z][A-Z0-9_]*$/u;

const blockFunctions = new Set(["grep", "map", "sort"]);

const namedUnaryFunctions = new Set([
  "abs",
  "chomp",
  "chop",
  "chr",
  "close",
  "defined",
  "delete",
  "each",
  "exists",
  "exit",
  "hex",
  "int",
  "keys",
  "lc",
  "lcfirst",
  "length",
  "log",
  "oct",
  "ord",
  "pop",
  "quotemeta",
  "ref",
  "scalar",
  "shift",
  "sqrt",
  "uc",
  "ucfirst",
  "values",
]);

const listFunctions = new Set([
  "die",
  "index",
  "join",
  "open",
  "push",
  "reverse",
  "rindex",
  "splice",
  "split",
  "sprintf",
  "substr",
  "unshift",
  "warn",
]);

export const perlKnownFunctions: ReadonlySet<string> = new Set([
  ...blockFunctions,
  ...namedUnaryFunctions,
  ...listFunctions,
  "print",
  "printf",
  "say",
]);

const acceptedPragmas = new Set([
  "strict",
  "warnings",
  "feature",
  "utf8",
  "integer",
  "constant",
  "lib",
  "vars",
]);

const unsupportedWords: ReadonlyMap<string, string> = new Map([
  ["bless", "object orientation"],
  ["package", "packages"],
  ["require", "module loading"],
  ["local", "dynamic scoping"],
  ["our", "package variables"],
  ["goto", "goto"],
  ["format", "formats"],
  ["tie", "tie"],
  ["untie", "tie"],
  ["wantarray", "wantarray"],
  ["prototype", "prototypes"],
  ["fork", "host processes"],
  ["exec", "host processes"],
  ["system", "host processes"],
  ["qx", "host command capture"],
  ["chdir", "host process state"],
  ["qr", "compiled regex objects"],
]);

/** Parses one bounded Perl program into a frozen statement tree. */
export function parsePerlProgram(source: string): PerlProgram {
  if (utf8ByteLength(source) > perlParserLimits.maximumProgramBytes) {
    throw new PerlSyntaxError("program byte limit exceeded", 1);
  }
  const tokens = tokenizePerl(source);
  const parser = new PerlParser(tokens);
  return Object.freeze({ body: parser.parseProgram() });
}

function tokenizePerl(source: string): readonly Token[] {
  const tokens: Token[] = [];
  let cursor = 0;
  let line = 1;
  let expectTerm = true;
  const push = (token: Token): void => {
    tokens.push(Object.freeze(token));
    if (tokens.length > perlParserLimits.maximumTokens) {
      throw new PerlSyntaxError("token limit exceeded", line);
    }
    expectTerm = !(
      token.kind === "number" ||
      token.kind === "string" ||
      token.kind === "variable" ||
      token.kind === "words" ||
      token.kind === "readline" ||
      token.kind === "regex" ||
      // `shift` and `pop` are complete terms on their own, so the `/` that
      // follows one opens `//` (defined-or) rather than a regex literal.
      (token.kind === "identifier" &&
        (token.text === "shift" || token.text === "pop")) ||
      (token.kind === "operator" &&
        (token.text === ")" || token.text === "]" || token.text === "}"))
    );
  };
  function fail(message: string): never {
    throw new PerlSyntaxError(message, line);
  }

  // Here-document bodies live after the line that opens them, so the scanner
  // records each body once and jumps over it when the cursor reaches it.
  const heredocBodies: {
    end: number;
    lines: number;
    start: number;
  }[] = [];

  while (cursor < source.length) {
    const character = source[cursor]!;
    if (character === "\n") {
      line += 1;
      cursor += 1;
      while (heredocBodies.length > 0 && heredocBodies[0]!.start === cursor) {
        const body = heredocBodies.shift()!;
        line += body.lines;
        cursor = body.end;
      }
      continue;
    }
    if (character === " " || character === "\t" || character === "\r") {
      cursor += 1;
      continue;
    }
    if (character === "#") {
      while (cursor < source.length && source[cursor] !== "\n") cursor += 1;
      continue;
    }
    if (
      character === "=" &&
      isLineStart(source, cursor) &&
      /[A-Za-z]/u.test(source[cursor + 1] ?? "")
    ) {
      fail("POD blocks are unavailable");
    }
    if (
      source.startsWith("__END__", cursor) ||
      source.startsWith("__DATA__", cursor)
    ) {
      break;
    }
    if (
      source.startsWith("<<", cursor) &&
      expectTerm &&
      /["'~A-Za-z_]/u.test(source[cursor + 2] ?? "")
    ) {
      const opened = readHeredoc(
        source,
        cursor,
        line,
        heredocBodies.at(-1)?.end,
      );
      heredocBodies.push(opened.body);
      push({
        interpolate: opened.interpolate,
        kind: "string",
        line,
        text: opened.text,
      });
      cursor = opened.cursor;
      continue;
    }

    // Variables: $name, @name, %name, $#name, $1, $_, @_, $@, %ENV.
    if (
      character === "$" ||
      character === "@" ||
      (character === "%" && expectTerm)
    ) {
      const parsed = readVariable(source, cursor, line);
      if (parsed !== undefined) {
        push({
          kind: "variable",
          line,
          name: parsed.name,
          sigil: parsed.sigil,
          text: `${parsed.sigil}${parsed.name}`,
        });
        cursor = parsed.cursor;
        continue;
      }
      if (character === "$" || (character === "@" && expectTerm)) {
        fail(
          `unsupported special variable ${character}${source[cursor + 1] ?? ""}`,
        );
      }
    }

    if (
      /[0-9]/u.test(character) ||
      (character === "." && /[0-9]/u.test(source[cursor + 1] ?? ""))
    ) {
      const parsed = readNumber(source, cursor, line);
      push({
        kind: "number",
        line,
        numberValue: parsed.value,
        text: parsed.text,
      });
      cursor = parsed.cursor;
      continue;
    }

    if (/[A-Za-z_]/u.test(character)) {
      let end = cursor;
      while (end < source.length && /[A-Za-z0-9_]/u.test(source[end]!))
        end += 1;
      const word = source.slice(cursor, end);
      if (word === "qw" || word === "q" || word === "qq") {
        const quoted = readQuoteLike(source, end, line, word);
        if (quoted !== undefined) {
          if (word === "qw") {
            push({ kind: "words", line, parts: quoted.parts, text: word });
          } else {
            push({
              interpolate: word === "qq",
              kind: "string",
              line,
              text: quoted.body,
            });
          }
          cursor = quoted.cursor;
          continue;
        }
      }
      if (
        (word === "m" || word === "s" || word === "tr" || word === "y") &&
        expectTerm
      ) {
        const literal = readRegexLiteral(source, end, line, word);
        if (literal !== undefined) {
          push(literal.token);
          cursor = literal.cursor;
          continue;
        }
      }
      const unsupported = unsupportedWords.get(word);
      if (unsupported !== undefined) {
        fail(`${unsupported} is unavailable in CS-Linux perl (${word})`);
      }
      push({ kind: "identifier", line, text: word });
      cursor = end;
      continue;
    }

    if (character === '"' || character === "'" || character === "`") {
      if (character === "`") fail("host command capture is unavailable");
      const quoted = readQuoted(source, cursor + 1, character, line);
      push({
        interpolate: character === '"',
        kind: "string",
        line,
        text: quoted.body,
      });
      line += quoted.lines;
      cursor = quoted.cursor;
      continue;
    }

    if (character === "/" && expectTerm) {
      const literal = readRegexLiteral(source, cursor, line, "m");
      if (literal === undefined) fail("unterminated regular expression");
      push(literal.token);
      cursor = literal.cursor;
      continue;
    }

    if (character === "<" && expectTerm) {
      const readline = readReadline(source, cursor);
      if (readline !== undefined) {
        push({
          kind: "readline",
          line,
          name: readline.name,
          text: readline.text,
        });
        cursor = readline.cursor;
        continue;
      }
    }

    const operator = readOperator(source, cursor);
    if (operator === undefined) fail(`unexpected character '${character}'`);
    push({ kind: "operator", line, text: operator });
    cursor += operator.length;
  }
  tokens.push(Object.freeze({ kind: "eof", line, text: "" }));
  return Object.freeze(tokens);
}

function isLineStart(source: string, cursor: number): boolean {
  return cursor === 0 || source[cursor - 1] === "\n";
}

function readVariable(
  source: string,
  cursor: number,
  line: number,
):
  | { readonly cursor: number; readonly name: string; readonly sigil: string }
  | undefined {
  const sigil = source[cursor]!;
  let index = cursor + 1;
  let prefix = "";
  if (sigil === "$" && source[index] === "#") {
    prefix = "#";
    index += 1;
  }
  if (source[index] === "{") {
    const close = source.indexOf("}", index);
    const inner = close < 0 ? "" : source.slice(index + 1, close);
    if (close > 0 && /^[A-Za-z_][A-Za-z0-9_]*$/u.test(inner)) {
      return { cursor: close + 1, name: `${prefix}${inner}`, sigil };
    }
    return undefined;
  }
  const character = source[index];
  if (character === undefined) return undefined;
  if (/[A-Za-z_]/u.test(character)) {
    let end = index;
    while (end < source.length && /[A-Za-z0-9_]/u.test(source[end]!)) end += 1;
    if (source[end] === ":" && source[end + 1] === ":") {
      throw new PerlSyntaxError("package variables are unavailable", line);
    }
    return { cursor: end, name: `${prefix}${source.slice(index, end)}`, sigil };
  }
  if (sigil === "$" && prefix === "" && /[0-9]/u.test(character)) {
    let end = index;
    while (end < source.length && /[0-9]/u.test(source[end]!)) end += 1;
    return { cursor: end, name: source.slice(index, end), sigil };
  }
  if (
    sigil === "$" &&
    prefix === "" &&
    (character === "_" ||
      character === "@" ||
      character === "!" ||
      character === "." ||
      character === "0" ||
      // `$&`, `` $` ``, and `$'` report the last match and the text
      // surrounding it.
      character === "&" ||
      character === "`" ||
      character === "'")
  ) {
    return { cursor: index + 1, name: character, sigil };
  }
  if (sigil === "@" && character === "_") {
    return { cursor: index + 1, name: "_", sigil };
  }
  return undefined;
}

function readNumber(
  source: string,
  cursor: number,
  line: number,
): { readonly cursor: number; readonly text: string; readonly value: number } {
  const hexadecimal = /^0[xX][0-9a-fA-F_]+/u.exec(source.slice(cursor));
  if (hexadecimal !== null) {
    const text = hexadecimal[0];
    return {
      cursor: cursor + text.length,
      text,
      value: Number.parseInt(text.replaceAll("_", "").slice(2), 16),
    };
  }
  const binary = /^0[bB][01_]+/u.exec(source.slice(cursor));
  if (binary !== null) {
    const text = binary[0];
    return {
      cursor: cursor + text.length,
      text,
      value: Number.parseInt(text.replaceAll("_", "").slice(2), 2),
    };
  }
  const decimal = /^[0-9_]*\.?[0-9_]+(?:[eE][+-]?[0-9]+)?/u.exec(
    source.slice(cursor),
  );
  if (decimal === null) throw new PerlSyntaxError("invalid number", line);
  const text = decimal[0];
  const value = Number(text.replaceAll("_", ""));
  if (!Number.isFinite(value))
    throw new PerlSyntaxError("invalid number", line);
  return { cursor: cursor + text.length, text, value };
}

const closingDelimiters: ReadonlyMap<string, string> = new Map([
  ["(", ")"],
  ["[", "]"],
  ["{", "}"],
  ["<", ">"],
]);

function readDelimitedSection(
  source: string,
  start: number,
  open: string,
  line: number,
): { readonly body: string; readonly cursor: number } {
  const close = closingDelimiters.get(open) ?? open;
  const nested = close !== open;
  let depth = 1;
  let body = "";
  let cursor = start;
  while (cursor < source.length) {
    const character = source[cursor]!;
    if (character === "\\" && cursor + 1 < source.length) {
      const next = source[cursor + 1]!;
      body += next === close || next === open ? next : `\\${next}`;
      cursor += 2;
      continue;
    }
    if (nested && character === open) depth += 1;
    if (character === close) {
      depth -= 1;
      if (depth === 0) return { body, cursor: cursor + 1 };
    }
    body += character;
    cursor += 1;
  }
  throw new PerlSyntaxError("unterminated quoted construct", line);
}

function readQuoteLike(
  source: string,
  cursor: number,
  line: number,
  word: string,
):
  | {
      readonly body: string;
      readonly cursor: number;
      readonly parts: readonly string[];
    }
  | undefined {
  let index = cursor;
  while (source[index] === " " || source[index] === "\t") index += 1;
  const open = source[index];
  if (open === undefined || /[A-Za-z0-9_=,;)\]}]/u.test(open)) return undefined;
  const section = readDelimitedSection(source, index + 1, open, line);
  const parts =
    word === "qw"
      ? section.body.split(/\s+/u).filter((entry) => entry.length > 0)
      : [];
  return {
    body: section.body,
    cursor: section.cursor,
    parts: Object.freeze(parts),
  };
}

function readQuoted(
  source: string,
  start: number,
  quote: string,
  line: number,
): { readonly body: string; readonly cursor: number; readonly lines: number } {
  let body = "";
  let cursor = start;
  let lines = 0;
  while (cursor < source.length) {
    const character = source[cursor]!;
    if (character === "\\" && cursor + 1 < source.length) {
      body += `\\${source[cursor + 1]!}`;
      cursor += 2;
      continue;
    }
    if (character === quote) return { body, cursor: cursor + 1, lines };
    if (character === "\n") lines += 1;
    body += character;
    cursor += 1;
  }
  throw new PerlSyntaxError("unterminated string literal", line);
}

function readRegexLiteral(
  source: string,
  cursor: number,
  line: number,
  word: string,
): { readonly cursor: number; readonly token: Token } | undefined {
  let index = cursor;
  if (word !== "m" || source[cursor] !== "/") {
    while (source[index] === " " || source[index] === "\t") index += 1;
  }
  const open = source[index];
  if (open === undefined || /[A-Za-z0-9_\s,;)\]}=]/u.test(open))
    return undefined;
  const pattern = readDelimitedSection(source, index + 1, open, line);
  let replacement = "";
  let after = pattern.cursor;
  if (word === "s" || word === "tr" || word === "y") {
    if (closingDelimiters.has(open)) {
      while (
        source[after] === " " ||
        source[after] === "\t" ||
        source[after] === "\n"
      ) {
        after += 1;
      }
      const second = source[after];
      if (second === undefined) {
        throw new PerlSyntaxError("unterminated replacement", line);
      }
      const parsed = readDelimitedSection(source, after + 1, second, line);
      replacement = parsed.body;
      after = parsed.cursor;
    } else {
      const parsed = readDelimitedSection(source, after, open, line);
      replacement = parsed.body;
      after = parsed.cursor;
    }
  }
  let flags = "";
  while (after < source.length && /[a-zA-Z]/u.test(source[after]!)) {
    flags += source[after]!;
    after += 1;
  }
  const operator = word === "y" ? "tr" : word;
  return {
    cursor: after,
    token: Object.freeze({
      flags,
      interpolate: open !== "'",
      kind: "regex",
      line,
      modifiers: replacement,
      name: operator,
      text: pattern.body,
    }),
  };
}

/**
 * Reads one `<<TAG` opener plus the body that follows the current line. The
 * caller keeps the returned region so the scanner can skip it later; a second
 * here-document on the same line starts after the first one's body.
 */
function readHeredoc(
  source: string,
  cursor: number,
  line: number,
  after: number | undefined,
): {
  readonly body: { end: number; lines: number; start: number };
  readonly cursor: number;
  readonly interpolate: boolean;
  readonly text: string;
} {
  let index = cursor + 2;
  const indented = source[index] === "~";
  if (indented) index += 1;
  const quote = source[index];
  let tag: string;
  let interpolate = true;
  if (quote === '"' || quote === "'") {
    const end = source.indexOf(quote, index + 1);
    if (end < 0)
      throw new PerlSyntaxError("unterminated here-document tag", line);
    tag = source.slice(index + 1, end);
    interpolate = quote === '"';
    index = end + 1;
  } else {
    const match = /^[A-Za-z_][A-Za-z0-9_]*/u.exec(source.slice(index));
    if (match === null) {
      throw new PerlSyntaxError("invalid here-document tag", line);
    }
    tag = match[0];
    index += tag.length;
  }
  if (tag.length === 0) {
    throw new PerlSyntaxError("empty here-document tag", line);
  }
  let start = after;
  if (start === undefined) {
    const newline = source.indexOf("\n", index);
    if (newline < 0) {
      throw new PerlSyntaxError(`missing here-document body ${tag}`, line);
    }
    start = newline + 1;
  }
  const lines: string[] = [];
  let scan = start;
  for (;;) {
    if (scan >= source.length) {
      throw new PerlSyntaxError(
        `here-document ${tag} was not terminated`,
        line,
      );
    }
    const newline = source.indexOf("\n", scan);
    const end = newline < 0 ? source.length : newline;
    const text = source.slice(scan, end);
    scan = newline < 0 ? source.length : newline + 1;
    if ((indented ? text.trim() : text) === tag) {
      const margin = indented ? /^[ \t]*/u.exec(text)![0].length : 0;
      const body = lines.map((entry) =>
        indented ? entry.slice(stripWidth(entry, margin)) : entry,
      );
      return {
        body: { end: scan, lines: lines.length + 1, start },
        cursor: index,
        interpolate,
        text: body.map((entry) => `${entry}\n`).join(""),
      };
    }
    lines.push(text);
    if (lines.length > perlParserLimits.maximumStatements) {
      throw new PerlSyntaxError("here-document line limit exceeded", line);
    }
  }
}

/** Returns how much leading whitespace an indented here-document line loses. */
function stripWidth(text: string, margin: number): number {
  let width = 0;
  while (width < margin && (text[width] === " " || text[width] === "\t")) {
    width += 1;
  }
  return width;
}

function readReadline(
  source: string,
  cursor: number,
):
  | { readonly cursor: number; readonly name: string; readonly text: string }
  | undefined {
  const match = /^<(\$?[A-Za-z_][A-Za-z0-9_]*|)>/u.exec(source.slice(cursor));
  if (match === null) return undefined;
  return {
    cursor: cursor + match[0].length,
    name: match[1]!,
    text: match[0],
  };
}

const operators = [
  "<=>",
  "**=",
  "||=",
  "&&=",
  "//=",
  "...",
  "<<=",
  ">>=",
  "->",
  "=>",
  "==",
  "!=",
  "<=",
  ">=",
  "=~",
  "!~",
  "**",
  "++",
  "--",
  "+=",
  "-=",
  "*=",
  "/=",
  ".=",
  "%=",
  "|=",
  "&=",
  "^=",
  "&&",
  "||",
  "//",
  "..",
  "<<",
  ">>",
  "+",
  "-",
  "*",
  "/",
  "%",
  ".",
  ",",
  ";",
  "(",
  ")",
  "{",
  "}",
  "[",
  "]",
  "<",
  ">",
  "=",
  "!",
  "?",
  ":",
  "&",
  "|",
  "^",
  "\\",
  "~",
] as const;

function readOperator(source: string, cursor: number): string | undefined {
  return operators.find((operator) => source.startsWith(operator, cursor));
}

class PerlParser {
  private cursor = 0;
  private depth = 0;
  private statements = 0;

  constructor(private readonly tokens: readonly Token[]) {}

  parseProgram(): PerlBlock {
    const body = this.parseStatements("eof");
    return Object.freeze({ statements: body });
  }

  private parseStatements(terminator: "eof" | "}"): readonly PerlStatement[] {
    const statements: PerlStatement[] = [];
    while (!this.atTerminator(terminator)) {
      const statement = this.parseStatement();
      if (statement !== undefined) statements.push(statement);
      this.statements += 1;
      if (this.statements > perlParserLimits.maximumStatements) {
        this.fail("statement limit exceeded");
      }
    }
    return Object.freeze(statements);
  }

  private atTerminator(terminator: "eof" | "}"): boolean {
    const token = this.peek();
    if (terminator === "eof") return token.kind === "eof";
    if (token.kind === "eof") this.fail("unexpected end of program");
    return token.kind === "operator" && token.text === "}";
  }

  private parseStatement(): PerlStatement | undefined {
    const line = this.peek().line;
    const statement = this.parseStatementNode();
    if (statement === undefined) return undefined;
    return Object.freeze({ ...statement, line });
  }

  private parseStatementNode(): PerlStatementNode | undefined {
    const token = this.peek();
    if (token.kind === "operator" && token.text === ";") {
      this.cursor += 1;
      return undefined;
    }
    if (token.kind === "operator" && token.text === "{") {
      return Object.freeze({ body: this.parseBlock(), kind: "block" });
    }
    const label = this.readLoopLabel();
    if (label !== undefined) {
      const keyword = this.peek().text;
      if (keyword === "while" || keyword === "until") {
        return this.parseWhile(keyword === "until", label);
      }
      return this.parseFor(label);
    }
    if (token.kind === "identifier") {
      switch (token.text) {
        case "if":
        case "unless":
          return this.parseIf(token.text === "unless");
        case "while":
        case "until":
          return this.parseWhile(token.text === "until");
        case "for":
        case "foreach":
          return this.parseFor();
        case "sub":
          return this.parseSubDefinition();
        case "use":
        case "no":
          return this.parsePragma();
        case "return": {
          this.cursor += 1;
          const value = this.atStatementEnd()
            ? undefined
            : this.parseExpression();
          const statement = this.applyModifiers(
            Object.freeze({
              kind: "return",
              ...(value === undefined ? {} : { value }),
            }),
          );
          this.expectStatementEnd();
          return statement;
        }
        case "last":
        case "next": {
          this.cursor += 1;
          const target = this.peek();
          let jumpLabel: string | undefined;
          if (
            target.kind === "identifier" &&
            !statementModifiers.has(target.text) &&
            loopLabelPattern.test(target.text)
          ) {
            jumpLabel = target.text;
            this.cursor += 1;
          }
          const statement = this.applyModifiers(
            Object.freeze({
              kind: token.text,
              ...(jumpLabel === undefined ? {} : { label: jumpLabel }),
            }),
          );
          this.expectStatementEnd();
          return statement;
        }
        default:
          break;
      }
    }
    const expression = this.parseExpression();
    const statement = this.applyModifiers(
      Object.freeze({ expression, kind: "expression" }),
    );
    this.expectStatementEnd();
    return statement;
  }

  private applyModifiers(statement: PerlStatement): PerlStatement {
    let current = statement;
    while (
      this.peek().kind === "identifier" &&
      statementModifiers.has(this.peek().text)
    ) {
      const modifier = this.next().text;
      const expression = this.parseExpression();
      const body = Object.freeze({ statements: Object.freeze([current]) });
      if (modifier === "if" || modifier === "unless") {
        current = Object.freeze({
          branches: Object.freeze([
            {
              body,
              condition: modifier === "if" ? expression : negate(expression),
            },
          ]),
          kind: "if",
        });
      } else if (modifier === "while" || modifier === "until") {
        current = Object.freeze({
          body,
          condition: modifier === "while" ? expression : negate(expression),
          kind: "while",
        });
      } else {
        current = Object.freeze({
          body,
          declared: false,
          kind: "foreach",
          list: expression,
        });
      }
    }
    return current;
  }

  private parseIf(negated: boolean): PerlStatement {
    this.cursor += 1;
    const condition = this.parseParenthesized();
    const body = this.parseBlock();
    const branches: {
      readonly body: PerlBlock;
      readonly condition: PerlExpression;
    }[] = [{ body, condition: negated ? negate(condition) : condition }];
    let otherwise: PerlBlock | undefined;
    while (this.peek().kind === "identifier") {
      const keyword = this.peek().text;
      if (keyword === "elsif") {
        this.cursor += 1;
        const branchCondition = this.parseParenthesized();
        branches.push({ body: this.parseBlock(), condition: branchCondition });
        continue;
      }
      if (keyword === "else") {
        this.cursor += 1;
        otherwise = this.parseBlock();
      }
      break;
    }
    return Object.freeze({
      branches: Object.freeze(branches),
      kind: "if",
      ...(otherwise === undefined ? {} : { otherwise }),
    });
  }

  /** Consumes `LABEL:` when it introduces a loop, leaving anything else. */
  private readLoopLabel(): string | undefined {
    const token = this.peek();
    if (token.kind !== "identifier" || !loopLabelPattern.test(token.text)) {
      return undefined;
    }
    const colon = this.tokens[this.cursor + 1];
    if (colon?.kind !== "operator" || colon.text !== ":") return undefined;
    const keyword = this.tokens[this.cursor + 2];
    if (keyword?.kind !== "identifier" || !loopKeywords.has(keyword.text)) {
      throw new PerlSyntaxError(
        "labels are supported only on while, until, for, and foreach",
        token.line,
      );
    }
    this.cursor += 2;
    return token.text;
  }

  private parseWhile(negated: boolean, label?: string): PerlStatement {
    this.cursor += 1;
    const condition = this.parseParenthesized();
    return Object.freeze({
      body: this.parseBlock(),
      condition: negated ? negate(condition) : condition,
      kind: "while",
      ...(label === undefined ? {} : { label }),
    });
  }

  private parseFor(label?: string): PerlStatement {
    this.cursor += 1;
    let variable: string | undefined;
    let declared = false;
    if (this.peek().kind === "identifier" && this.peek().text === "my") {
      this.cursor += 1;
      declared = true;
      variable = this.expectScalarName();
    } else if (this.peek().kind === "variable" && this.peek().sigil === "$") {
      variable = this.next().name!;
    }
    this.expectOperator("(");
    if (variable === undefined && this.isCStyleFor()) {
      const initializer = this.peekOperator(";")
        ? undefined
        : this.parseExpression();
      this.expectOperator(";");
      const condition = this.peekOperator(";")
        ? undefined
        : this.parseExpression();
      this.expectOperator(";");
      const step = this.peekOperator(")") ? undefined : this.parseExpression();
      this.expectOperator(")");
      return Object.freeze({
        body: this.parseBlock(),
        kind: "cFor",
        ...(condition === undefined ? {} : { condition }),
        ...(initializer === undefined ? {} : { initializer }),
        ...(label === undefined ? {} : { label }),
        ...(step === undefined ? {} : { step }),
      });
    }
    const list = this.peekOperator(")")
      ? Object.freeze({ items: Object.freeze([]), kind: "list" as const })
      : this.parseExpression();
    this.expectOperator(")");
    return Object.freeze({
      body: this.parseBlock(),
      declared,
      kind: "foreach",
      list,
      ...(label === undefined ? {} : { label }),
      ...(variable === undefined ? {} : { variable }),
    });
  }

  /** Distinguishes `for (init; test; step)` from `for (LIST)`. */
  private isCStyleFor(): boolean {
    let depth = 0;
    for (let index = this.cursor; index < this.tokens.length; index += 1) {
      const token = this.tokens[index]!;
      if (token.kind === "eof") return false;
      if (token.kind !== "operator") continue;
      if (token.text === "(" || token.text === "[" || token.text === "{") {
        depth += 1;
      } else if (
        token.text === ")" ||
        token.text === "]" ||
        token.text === "}"
      ) {
        if (depth === 0) return false;
        depth -= 1;
      } else if (token.text === ";" && depth === 0) {
        return true;
      }
    }
    return false;
  }

  private parseSubDefinition(): PerlStatement {
    this.cursor += 1;
    const name = this.peek();
    if (name.kind !== "identifier") this.fail("named subroutines only");
    this.cursor += 1;
    if (this.peekOperator("("))
      this.fail("subroutine prototypes are unavailable");
    return Object.freeze({
      body: this.parseBlock(),
      kind: "sub",
      name: name.text,
    });
  }

  private parsePragma(): PerlStatement {
    const keyword = this.next().text;
    const token = this.peek();
    let text = keyword;
    if (token.kind === "number" && /^v?5/u.test(token.text)) {
      this.cursor += 1;
      text = `${keyword} ${token.text}`;
    } else if (token.kind === "identifier") {
      if (token.text.startsWith("v") && /^v5/u.test(token.text)) {
        this.cursor += 1;
        text = `${keyword} ${token.text}`;
      } else if (acceptedPragmas.has(token.text)) {
        this.cursor += 1;
        text = `${keyword} ${token.text}`;
      } else {
        this.fail(
          `module '${token.text}' is unavailable in CS-Linux perl; only bounded pragmas are accepted`,
        );
      }
    } else {
      this.fail("unsupported use statement");
    }
    while (!this.atStatementEnd()) this.cursor += 1;
    this.expectStatementEnd();
    return Object.freeze({ kind: "pragma", text });
  }

  private parseBlock(): PerlBlock {
    this.expectOperator("{");
    this.depth += 1;
    if (this.depth > perlParserLimits.maximumBlockDepth) {
      this.fail("block nesting limit exceeded");
    }
    const statements = this.parseStatements("}");
    this.expectOperator("}");
    this.depth -= 1;
    return Object.freeze({ statements });
  }

  private parseParenthesized(): PerlExpression {
    this.expectOperator("(");
    const expression = this.parseExpression();
    this.expectOperator(")");
    return expression;
  }

  // Expression grammar, loosest binding first.

  private parseExpression(): PerlExpression {
    return this.parseLowOr();
  }

  private parseLowOr(): PerlExpression {
    let left = this.parseLowAnd();
    while (this.peekWord("or") || this.peekWord("xor")) {
      const operator = this.next().text;
      const right = this.parseLowAnd();
      left =
        operator === "or"
          ? Object.freeze({ kind: "logical", left, operator: "||", right })
          : Object.freeze({ kind: "binary", left, operator: "xor", right });
    }
    return left;
  }

  private parseLowAnd(): PerlExpression {
    let left = this.parseLowNot();
    while (this.peekWord("and")) {
      this.cursor += 1;
      const right = this.parseLowNot();
      left = Object.freeze({ kind: "logical", left, operator: "&&", right });
    }
    return left;
  }

  private parseLowNot(): PerlExpression {
    if (this.peekWord("not")) {
      this.cursor += 1;
      return Object.freeze({
        kind: "unary",
        operand: this.parseLowNot(),
        operator: "!",
      });
    }
    return this.parseComma();
  }

  private parseComma(): PerlExpression {
    const first = this.parseAssignment();
    if (!this.peekOperator(",") && !this.peekOperator("=>")) return first;
    const items: PerlExpression[] = [first];
    while (this.peekOperator(",") || this.peekOperator("=>")) {
      this.cursor += 1;
      if (this.atListEnd()) break;
      items.push(this.parseAssignment());
    }
    return Object.freeze({ items: Object.freeze(items), kind: "list" });
  }

  private atListEnd(): boolean {
    const token = this.peek();
    if (token.kind === "eof") return true;
    if (token.kind === "identifier" && statementModifiers.has(token.text)) {
      return true;
    }
    return (
      token.kind === "operator" &&
      (token.text === ")" ||
        token.text === "}" ||
        token.text === "]" ||
        token.text === ";")
    );
  }

  private parseAssignment(): PerlExpression {
    const target = this.parseTernary();
    const token = this.peek();
    // `x=` is spelled with the repetition word, so it arrives as two tokens.
    if (
      token.kind === "identifier" &&
      token.text === "x" &&
      this.tokens[this.cursor + 1]?.text === "="
    ) {
      this.cursor += 2;
      return Object.freeze({
        kind: "assign",
        operator: "x=",
        target,
        value: this.parseAssignment(),
      });
    }
    if (
      token.kind === "operator" &&
      /^(?:=|\+=|-=|\*=|\/=|\.=|%=|\*\*=|\|\|=|&&=|\/\/=|\|=|&=|\^=|<<=|>>=)$/u.test(
        token.text,
      )
    ) {
      this.cursor += 1;
      const value = this.parseAssignment();
      return Object.freeze({
        kind: "assign",
        operator: token.text,
        target,
        value,
      });
    }
    return target;
  }

  private parseTernary(): PerlExpression {
    const condition = this.parseRange();
    if (!this.peekOperator("?")) return condition;
    this.cursor += 1;
    const whenTrue = this.parseAssignment();
    this.expectOperator(":");
    const whenFalse = this.parseAssignment();
    return Object.freeze({ condition, kind: "ternary", whenFalse, whenTrue });
  }

  private parseRange(): PerlExpression {
    const from = this.parseOr();
    if (!this.peekOperator("..")) return from;
    this.cursor += 1;
    return Object.freeze({ from, kind: "range", to: this.parseOr() });
  }

  private parseOr(): PerlExpression {
    let left = this.parseAnd();
    while (this.peekOperator("||") || this.peekOperator("//")) {
      const operator = this.next().text as "||" | "//";
      left = Object.freeze({
        kind: "logical",
        left,
        operator,
        right: this.parseAnd(),
      });
    }
    return left;
  }

  private parseAnd(): PerlExpression {
    let left = this.parseBitwiseOr();
    while (this.peekOperator("&&")) {
      this.cursor += 1;
      left = Object.freeze({
        kind: "logical",
        left,
        operator: "&&",
        right: this.parseBitwiseOr(),
      });
    }
    return left;
  }

  private parseBitwiseOr(): PerlExpression {
    let left = this.parseBitwiseAnd();
    while (this.peekOperator("|") || this.peekOperator("^")) {
      const operator = this.next().text;
      left = Object.freeze({
        kind: "binary",
        left,
        operator,
        right: this.parseBitwiseAnd(),
      });
    }
    return left;
  }

  private parseBitwiseAnd(): PerlExpression {
    let left = this.parseEquality();
    while (this.peekOperator("&")) {
      this.cursor += 1;
      left = Object.freeze({
        kind: "binary",
        left,
        operator: "&",
        right: this.parseEquality(),
      });
    }
    return left;
  }

  private parseEquality(): PerlExpression {
    let left = this.parseRelational();
    while (
      this.peekOperator("==") ||
      this.peekOperator("!=") ||
      this.peekOperator("<=>") ||
      this.peekWord("eq") ||
      this.peekWord("ne") ||
      this.peekWord("cmp")
    ) {
      const operator = this.next().text;
      left = Object.freeze({
        kind: "binary",
        left,
        operator,
        right: this.parseRelational(),
      });
    }
    return left;
  }

  private parseRelational(): PerlExpression {
    let left = this.parseShift();
    while (
      this.peekOperator("<") ||
      this.peekOperator(">") ||
      this.peekOperator("<=") ||
      this.peekOperator(">=") ||
      this.peekWord("lt") ||
      this.peekWord("gt") ||
      this.peekWord("le") ||
      this.peekWord("ge")
    ) {
      const operator = this.next().text;
      left = Object.freeze({
        kind: "binary",
        left,
        operator,
        right: this.parseShift(),
      });
    }
    return left;
  }

  private parseShift(): PerlExpression {
    let left = this.parseAdditive();
    while (this.peekOperator("<<") || this.peekOperator(">>")) {
      const operator = this.next().text;
      left = Object.freeze({
        kind: "binary",
        left,
        operator,
        right: this.parseAdditive(),
      });
    }
    return left;
  }

  private parseAdditive(): PerlExpression {
    let left = this.parseMultiplicative();
    while (
      this.peekOperator("+") ||
      this.peekOperator("-") ||
      this.peekOperator(".")
    ) {
      const operator = this.next().text;
      left = Object.freeze({
        kind: "binary",
        left,
        operator,
        right: this.parseMultiplicative(),
      });
    }
    return left;
  }

  private parseMultiplicative(): PerlExpression {
    let left = this.parseBind();
    while (
      this.peekOperator("*") ||
      this.peekOperator("/") ||
      this.peekOperator("%") ||
      // `$s x= 3` repeats in place, so leave that `x` for parseAssignment.
      (this.peekWord("x") && this.tokens[this.cursor + 1]?.text !== "=")
    ) {
      const operator = this.next().text;
      left = Object.freeze({
        kind: "binary",
        left,
        operator,
        right: this.parseBind(),
      });
    }
    return left;
  }

  private parseBind(): PerlExpression {
    let left = this.parseUnary();
    while (this.peekOperator("=~") || this.peekOperator("!~")) {
      const negated = this.next().text === "!~";
      left = this.bindRegex(left, negated);
    }
    return left;
  }

  private bindRegex(target: PerlExpression, negated: boolean): PerlExpression {
    const token = this.peek();
    if (token.kind !== "regex") this.fail("expected a regular expression");
    this.cursor += 1;
    return this.regexExpression(token, target, negated);
  }

  private regexExpression(
    token: Token,
    target: PerlExpression,
    negated: boolean,
  ): PerlExpression {
    if (token.name === "tr") {
      return Object.freeze({
        from: token.text,
        kind: "transliterate",
        modifiers: token.flags ?? "",
        target,
        to: token.modifiers ?? "",
      });
    }
    const flagText = token.flags ?? "";
    // `e` selects how the replacement is read and `r` selects where the result
    // goes, so neither reaches the matcher.
    const evaluated = token.name === "s" && flagText.includes("e");
    const returning = token.name === "s" && flagText.includes("r");
    const regex: PerlRegexLiteral = Object.freeze({
      flags: token.name === "s" ? flagText.replaceAll(/[er]/gu, "") : flagText,
      pattern:
        token.interpolate === true
          ? parseInterpolated(token.text, token.line, true)
          : Object.freeze({ kind: "string", value: token.text }),
    });
    if (token.name === "s") {
      const replacementText = token.modifiers ?? "";
      return Object.freeze({
        kind: "substitute",
        negated,
        regex,
        replacement: evaluated
          ? parseReplacementCode(replacementText, token.line)
          : parseInterpolated(replacementText, token.line, false),
        returning,
        target,
      });
    }
    return Object.freeze({ kind: "match", negated, regex, target });
  }

  private parseUnary(): PerlExpression {
    const token = this.peek();
    if (token.kind === "operator") {
      if (token.text === "!") {
        this.cursor += 1;
        return Object.freeze({
          kind: "unary",
          operand: this.parseUnary(),
          operator: "!",
        });
      }
      if (token.text === "-") {
        const following = this.tokens[this.cursor + 1];
        if (
          following?.kind === "identifier" &&
          /^[defsz]$/u.test(following.text) &&
          this.tokens[this.cursor + 2]?.kind !== "operator"
        ) {
          this.cursor += 2;
          return Object.freeze({
            kind: "fileTest",
            operator: following.text as "d" | "e" | "f" | "s" | "z",
            path: this.parseUnary(),
          });
        }
        this.cursor += 1;
        return Object.freeze({
          kind: "unary",
          operand: this.parseUnary(),
          operator: "-",
        });
      }
      if (token.text === "+") {
        this.cursor += 1;
        return this.parseUnary();
      }
      if (token.text === "~") {
        this.cursor += 1;
        return Object.freeze({
          kind: "unary",
          operand: this.parseUnary(),
          operator: "~",
        });
      }
      if (token.text === "\\") {
        this.fail("references are unavailable in CS-Linux perl");
      }
      if (token.text === "++" || token.text === "--") {
        this.cursor += 1;
        return Object.freeze({
          by: token.text === "++" ? 1 : -1,
          kind: "step",
          prefix: true,
          target: this.parseUnary(),
        });
      }
    }
    return this.parsePower();
  }

  private parsePower(): PerlExpression {
    const base = this.parsePostfix();
    if (!this.peekOperator("**")) return base;
    this.cursor += 1;
    return Object.freeze({
      kind: "binary",
      left: base,
      operator: "**",
      right: this.parseUnary(),
    });
  }

  private parsePostfix(): PerlExpression {
    let expression = this.parseTerm();
    for (;;) {
      const token = this.peek();
      if (
        token.kind === "operator" &&
        (token.text === "++" || token.text === "--")
      ) {
        this.cursor += 1;
        expression = Object.freeze({
          by: token.text === "++" ? 1 : -1,
          kind: "step",
          prefix: false,
          target: expression,
        });
        continue;
      }
      if (token.kind === "operator" && token.text === "->") {
        this.fail("references and method calls are unavailable");
      }
      break;
    }
    return expression;
  }

  private parseTerm(): PerlExpression {
    const token = this.next();
    switch (token.kind) {
      case "number":
        return Object.freeze({ kind: "number", value: token.numberValue! });
      case "string":
        return token.interpolate === true
          ? parseInterpolated(token.text, token.line, false)
          : Object.freeze({
              kind: "string",
              value: unescapeSingle(token.text),
            });
      case "words":
        return Object.freeze({
          items: Object.freeze(
            (token.parts ?? []).map((word) =>
              Object.freeze({ kind: "string" as const, value: word }),
            ),
          ),
          kind: "list",
        });
      case "regex":
        return this.regexExpression(
          token,
          Object.freeze({ kind: "scalar", name: "_" }),
          false,
        );
      case "readline":
        return this.readlineExpression(token);
      case "variable":
        return this.parseVariable(token);
      case "identifier":
        return this.parseIdentifier(token);
      case "operator":
        if (token.text === "(") {
          if (this.peekOperator(")")) {
            this.cursor += 1;
            return Object.freeze({ items: Object.freeze([]), kind: "list" });
          }
          // A parenthesis restarts the grammar at its loosest binding, so
          // `(0 or 5)` and `(1 and 2)` parse like they do in perl.
          const inner = this.parseExpression();
          this.expectOperator(")");
          return inner;
        }
        if (token.text === "[" || token.text === "{") {
          this.fail("anonymous references are unavailable");
        }
        break;
      default:
        break;
    }
    this.cursor -= 1;
    this.fail(`unexpected token '${token.text}'`);
  }

  private readlineExpression(token: Token): PerlExpression {
    const name = token.name ?? "";
    if (name.length === 0) {
      return Object.freeze({
        handle: undefined,
        kind: "readline",
        source: "argv",
      });
    }
    if (name === "STDIN") {
      return Object.freeze({
        handle: undefined,
        kind: "readline",
        source: "stdin",
      });
    }
    if (!name.startsWith("$")) {
      this.fail(`unsupported filehandle <${name}>`);
    }
    return Object.freeze({
      handle: Object.freeze({ kind: "scalar", name: name.slice(1) }),
      kind: "readline",
      source: "handle",
    });
  }

  private parseVariable(token: Token): PerlExpression {
    const sigil = token.sigil!;
    const name = token.name!;
    if (sigil === "$" && name.startsWith("#")) {
      return Object.freeze({ kind: "lastIndex", name: name.slice(1) });
    }
    if (sigil === "$") {
      if (this.peekOperator("[")) {
        this.cursor += 1;
        const index = this.parseExpression();
        this.expectOperator("]");
        return Object.freeze({
          container: "array",
          index,
          kind: "element",
          name,
        });
      }
      if (this.peekOperator("{")) {
        this.cursor += 1;
        const index = this.parseHashKey();
        this.expectOperator("}");
        return Object.freeze({
          container: "hash",
          index,
          kind: "element",
          name,
        });
      }
      return Object.freeze({ kind: "scalar", name });
    }
    if (sigil === "@") {
      if (this.peekOperator("[")) {
        this.cursor += 1;
        const keys = this.parseExpression();
        this.expectOperator("]");
        return Object.freeze({ container: "array", keys, kind: "slice", name });
      }
      if (this.peekOperator("{")) {
        this.cursor += 1;
        const keys = this.parseExpression();
        this.expectOperator("}");
        return Object.freeze({ container: "hash", keys, kind: "slice", name });
      }
      return Object.freeze({ kind: "array", name });
    }
    return Object.freeze({ kind: "hash", name });
  }

  private parseHashKey(): PerlExpression {
    const token = this.peek();
    const following = this.tokens[this.cursor + 1];
    if (
      token.kind === "identifier" &&
      following?.kind === "operator" &&
      following.text === "}"
    ) {
      this.cursor += 1;
      return Object.freeze({ kind: "string", value: token.text });
    }
    return this.parseExpression();
  }

  private parseIdentifier(token: Token): PerlExpression {
    const word = token.text;
    // A bareword immediately before `=>` is quoted, as in `(name => 1)`.
    if (this.peekOperator("=>"))
      return Object.freeze({ kind: "string", value: word });
    if (word === "my") return this.parseDeclaration();
    if (word === "eval") {
      if (!this.peekOperator("{")) this.fail("eval STRING is unavailable");
      return Object.freeze({ body: this.parseBlock(), kind: "evalBlock" });
    }
    if (word === "undef") {
      // Bare `undef` is the undefined value; `undef $x` empties one variable.
      if (this.peek().kind !== "variable") {
        return Object.freeze({ kind: "undefined" });
      }
      return Object.freeze({
        kind: "undefine",
        target: this.parseUnary(),
      });
    }
    if (word === "print" || word === "printf" || word === "say") {
      return this.parseOutput(word);
    }
    if (blockFunctions.has(word)) return this.parseBlockFunction(word);
    if (word === "STDIN" || word === "STDOUT" || word === "STDERR") {
      return Object.freeze({ kind: "string", value: word });
    }
    const parenthesized = this.peekOperator("(");
    if (parenthesized) {
      this.cursor += 1;
      const items = this.peekOperator(")")
        ? []
        : flattenList(this.parseLowNot());
      this.expectOperator(")");
      return Object.freeze({
        arguments: Object.freeze(items),
        kind: "call",
        name: word,
      });
    }
    if (
      namedUnaryFunctions.has(word) &&
      !this.atListEnd() &&
      !this.atOperatorPosition()
    ) {
      return Object.freeze({
        arguments: Object.freeze([this.parseBind()]),
        kind: "call",
        name: word,
      });
    }
    if (listFunctions.has(word) && !this.atListEnd()) {
      return Object.freeze({
        arguments: Object.freeze(flattenList(this.parseComma())),
        kind: "call",
        name: word,
      });
    }
    if (this.atListEnd() || this.atOperatorPosition()) {
      return Object.freeze({
        arguments: Object.freeze([]),
        kind: "call",
        name: word,
      });
    }
    return Object.freeze({
      arguments: Object.freeze(flattenList(this.parseComma())),
      kind: "call",
      name: word,
    });
  }

  private atOperatorPosition(): boolean {
    const token = this.peek();
    if (token.kind === "identifier") {
      return (
        wordOperators.has(token.text) || statementModifiers.has(token.text)
      );
    }
    if (token.kind !== "operator") return false;
    return !(
      token.text === "(" ||
      token.text === "[" ||
      token.text === "{" ||
      token.text === "\\" ||
      token.text === "!"
    );
  }

  private parseDeclaration(): PerlExpression {
    const targets: PerlDeclarationTarget[] = [];
    const parenthesized = this.peekOperator("(");
    if (parenthesized) {
      this.cursor += 1;
      while (!this.peekOperator(")")) {
        targets.push(this.expectDeclarationTarget());
        if (this.peekOperator(",")) this.cursor += 1;
      }
      this.expectOperator(")");
    } else {
      targets.push(this.expectDeclarationTarget());
    }
    return Object.freeze({
      kind: "declaration",
      parenthesized,
      targets: Object.freeze(targets),
    });
  }

  private expectDeclarationTarget(): PerlDeclarationTarget {
    const token = this.peek();
    if (token.kind !== "variable") this.fail("expected a declared variable");
    this.cursor += 1;
    const sigil = token.sigil as PerlSigil;
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(token.name!)) {
      this.fail(`cannot declare '${token.text}'`);
    }
    return Object.freeze({ name: token.name!, sigil });
  }

  private expectScalarName(): string {
    const token = this.peek();
    if (token.kind !== "variable" || token.sigil !== "$") {
      this.fail("expected a scalar loop variable");
    }
    this.cursor += 1;
    return token.name!;
  }

  private parseOutput(name: "print" | "printf" | "say"): PerlExpression {
    let handle: PerlExpression | undefined;
    const token = this.peek();
    const following = this.tokens[this.cursor + 1];
    if (
      token.kind === "identifier" &&
      (token.text === "STDERR" || token.text === "STDOUT")
    ) {
      this.cursor += 1;
      handle = Object.freeze({ kind: "string", value: token.text });
    } else if (
      token.kind === "variable" &&
      token.sigil === "$" &&
      (following?.kind === "string" ||
        following?.kind === "variable" ||
        following?.kind === "number" ||
        (following?.kind === "identifier" &&
          !wordOperators.has(following.text) &&
          !statementModifiers.has(following.text)))
    ) {
      this.cursor += 1;
      handle = Object.freeze({ kind: "scalar", name: token.name! });
    }
    const parenthesized =
      handle === undefined && this.peekOperator("(") ? true : false;
    if (parenthesized) this.cursor += 1;
    const items = this.atListEnd() ? [] : flattenList(this.parseComma());
    if (parenthesized) this.expectOperator(")");
    return Object.freeze({
      arguments: Object.freeze(items),
      handle,
      kind: "output",
      name,
    });
  }

  private parseBlockFunction(name: string): PerlExpression {
    const parenthesized = this.peekOperator("(");
    if (parenthesized) this.cursor += 1;
    let block: PerlBlock | undefined;
    if (this.peekOperator("{")) block = this.parseBlock();
    if (block !== undefined && this.peekOperator(",")) this.cursor += 1;
    const items = this.atListEnd() ? [] : flattenList(this.parseComma());
    if (parenthesized) this.expectOperator(")");
    return Object.freeze({
      arguments: Object.freeze(items),
      ...(block === undefined ? {} : { block }),
      kind: "call",
      name,
    });
  }

  private peek(): Token {
    return this.tokens[Math.min(this.cursor, this.tokens.length - 1)]!;
  }

  private next(): Token {
    const token = this.peek();
    if (token.kind !== "eof") this.cursor += 1;
    return token;
  }

  private peekOperator(text: string): boolean {
    const token = this.peek();
    return token.kind === "operator" && token.text === text;
  }

  private peekWord(text: string): boolean {
    const token = this.peek();
    return token.kind === "identifier" && token.text === text;
  }

  private expectOperator(text: string): void {
    if (!this.peekOperator(text)) {
      this.fail(`expected '${text}' but found '${this.peek().text}'`);
    }
    this.cursor += 1;
  }

  private atStatementEnd(): boolean {
    const token = this.peek();
    if (token.kind === "eof") return true;
    return (
      token.kind === "operator" && (token.text === ";" || token.text === "}")
    );
  }

  private expectStatementEnd(): void {
    const token = this.peek();
    if (token.kind === "operator" && token.text === ";") {
      this.cursor += 1;
      return;
    }
    if (token.kind === "eof") return;
    if (token.kind === "operator" && token.text === "}") return;
    this.fail(`expected ';' but found '${token.text}'`);
  }

  private fail(message: string): never {
    throw new PerlSyntaxError(message, this.peek().line);
  }
}

function negate(expression: PerlExpression): PerlExpression {
  return Object.freeze({ kind: "unary", operand: expression, operator: "!" });
}

function flattenList(expression: PerlExpression): PerlExpression[] {
  return expression.kind === "list" ? [...expression.items] : [expression];
}

const stringEscapes: ReadonlyMap<string, string> = new Map([
  ["n", "\n"],
  ["t", "\t"],
  ["r", "\r"],
  ["f", "\f"],
  ["0", "\0"],
  ["a", String.fromCharCode(7)],
  ["e", String.fromCharCode(27)],
  ["\\", "\\"],
  ['"', '"'],
  ["'", "'"],
  ["$", "$"],
  ["@", "@"],
]);

function unescapeSingle(text: string): string {
  let output = "";
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]!;
    if (character !== "\\") {
      output += character;
      continue;
    }
    const next = text[index + 1];
    if (next === "\\" || next === "'") {
      output += next;
      index += 1;
      continue;
    }
    output += character;
  }
  return output;
}

/**
 * Expands one double-quoted body into a concatenation expression. Regex bodies
 * keep their backslash escapes so the regex engine still sees `\d` and friends.
 */
export function parseInterpolated(
  text: string,
  line: number,
  isRegex: boolean,
): PerlExpression {
  if (text.length > perlParserLimits.maximumStringCharacters) {
    throw new PerlSyntaxError("string literal length limit exceeded", line);
  }
  const parts: PerlExpression[] = [];
  let literal = "";
  let cursor = 0;
  const flushLiteral = (): void => {
    if (literal.length === 0) return;
    parts.push(Object.freeze({ kind: "string", value: literal }));
    literal = "";
  };
  while (cursor < text.length) {
    const character = text[cursor]!;
    if (character === "\\") {
      const next = text[cursor + 1];
      if (next === undefined) {
        literal += character;
        cursor += 1;
        continue;
      }
      if (isRegex) {
        literal += `\\${next}`;
      } else {
        literal += stringEscapes.get(next) ?? next;
      }
      cursor += 2;
      continue;
    }
    if ((character === "$" || character === "@") && cursor + 1 < text.length) {
      const parsed = readInterpolatedVariable(text, cursor, line, isRegex);
      if (parsed !== undefined) {
        flushLiteral();
        parts.push(parsed.expression);
        cursor = parsed.cursor;
        continue;
      }
    }
    literal += character;
    cursor += 1;
  }
  flushLiteral();
  if (parts.length === 0) return Object.freeze({ kind: "string", value: "" });
  if (parts.length === 1 && parts[0]!.kind === "string") return parts[0];
  return Object.freeze({ kind: "concat", parts: Object.freeze(parts) });
}

function readInterpolatedVariable(
  text: string,
  cursor: number,
  line: number,
  isRegex: boolean,
):
  { readonly cursor: number; readonly expression: PerlExpression } | undefined {
  const variable = readVariable(text, cursor, line);
  if (variable === undefined) return undefined;
  const sigil = variable.sigil;
  const name = variable.name;
  let index = variable.cursor;
  if (sigil === "$" && name.startsWith("#")) {
    return {
      cursor: index,
      expression: Object.freeze({ kind: "lastIndex", name: name.slice(1) }),
    };
  }
  if (sigil === "$" && text[index] === "[" && !isRegex) {
    const section = readBalanced(text, index, "[", "]", line);
    return {
      cursor: section.cursor,
      expression: Object.freeze({
        container: "array",
        index: parseEmbeddedExpression(section.body, line),
        kind: "element",
        name,
      }),
    };
  }
  if (sigil === "$" && text[index] === "{") {
    const section = readBalanced(text, index, "{", "}", line);
    return {
      cursor: section.cursor,
      expression: Object.freeze({
        container: "hash",
        index: /^[A-Za-z_][A-Za-z0-9_]*$/u.test(section.body.trim())
          ? Object.freeze({ kind: "string", value: section.body.trim() })
          : parseEmbeddedExpression(section.body, line),
        kind: "element",
        name,
      }),
    };
  }
  if (sigil === "@") {
    if (text[index] === "[" && !isRegex) {
      const section = readBalanced(text, index, "[", "]", line);
      index = section.cursor;
      return {
        cursor: index,
        expression: Object.freeze({
          arguments: Object.freeze([
            Object.freeze({ kind: "string" as const, value: " " }),
            Object.freeze({
              container: "array" as const,
              keys: parseEmbeddedExpression(section.body, line),
              kind: "slice" as const,
              name,
            }),
          ]),
          kind: "call",
          name: "join",
        }),
      };
    }
    return {
      cursor: index,
      expression: Object.freeze({
        arguments: Object.freeze([
          Object.freeze({ kind: "string" as const, value: " " }),
          Object.freeze({ kind: "array" as const, name }),
        ]),
        kind: "call",
        name: "join",
      }),
    };
  }
  return { cursor: index, expression: Object.freeze({ kind: "scalar", name }) };
}

function readBalanced(
  text: string,
  cursor: number,
  open: string,
  close: string,
  line: number,
): { readonly body: string; readonly cursor: number } {
  let depth = 0;
  for (let index = cursor; index < text.length; index += 1) {
    const character = text[index]!;
    if (character === open) depth += 1;
    else if (character === close) {
      depth -= 1;
      if (depth === 0) {
        return { body: text.slice(cursor + 1, index), cursor: index + 1 };
      }
    }
  }
  throw new PerlSyntaxError("unterminated interpolation subscript", line);
}

/** Parses an `s///e` replacement, which is perl code rather than a template. */
function parseReplacementCode(text: string, line: number): PerlExpression {
  const block = new PerlParser(tokenizePerl(text)).parseProgram();
  const statement = block.statements[0];
  if (block.statements.length !== 1 || statement?.kind !== "expression") {
    throw new PerlSyntaxError(
      "s///e takes exactly one replacement expression",
      line,
    );
  }
  return statement.expression;
}

function parseEmbeddedExpression(text: string, line: number): PerlExpression {
  const tokens = tokenizePerl(text);
  const parser = new PerlParser(tokens);
  const block = parser.parseProgram();
  const statement = block.statements[0];
  if (block.statements.length !== 1 || statement?.kind !== "expression") {
    throw new PerlSyntaxError("invalid interpolation subscript", line);
  }
  return statement.expression;
}
