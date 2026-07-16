import {
  compileErrorAt,
  type Cs486SourcePosition,
  type Cs486SourceSpan,
} from "./cs486AsmDiagnostics.js";

export type Cs486AsmTokenKind =
  "eof" | "identifier" | "newline" | "number" | "punctuation" | "string";

export interface Cs486AsmToken {
  readonly kind: Cs486AsmTokenKind;
  readonly raw: string;
  readonly span: Cs486SourceSpan;
  readonly value: string;
}

export interface Cs486AsmTokenizeOptions {
  /** Bounds non-EOF tokens before they are appended to the token array. */
  readonly maximumTokens?: number;
  readonly sourceName?: string;
}

const punctuation = new Set([
  ":",
  ",",
  "[",
  "]",
  "(",
  ")",
  "+",
  "-",
  "*",
  "/",
  "%",
  "&",
  "|",
  "^",
  "~",
]);

export function tokenizeCs486Assembly(
  source: string,
  options: Cs486AsmTokenizeOptions = {},
): readonly Cs486AsmToken[] {
  const sourceName = options.sourceName ?? "<assembly>";
  const maximumTokens = options.maximumTokens;
  if (
    maximumTokens !== undefined &&
    (!Number.isSafeInteger(maximumTokens) || maximumTokens < 0)
  )
    throw new RangeError("assembly tokenizer limit must be non-negative");
  const normalized = source.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
  const tokens: Cs486AsmToken[] = [];
  let index = 0;
  let line = 1;
  let column = 1;

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
    } else column += 1;
    return character;
  };
  const push = (
    kind: Cs486AsmTokenKind,
    raw: string,
    value: string,
    start: Cs486SourcePosition,
  ): void => {
    const span = { end: position(), start };
    if (maximumTokens !== undefined && tokens.length >= maximumTokens)
      throw compileErrorAt("preprocessor lexical token limit exceeded", span);
    tokens.push({ kind, raw, span, value });
  };

  while (index < normalized.length) {
    const character = normalized[index]!;
    if (character === " " || character === "\t") {
      advance();
      continue;
    }
    if (character === ";") {
      while (index < normalized.length && normalized[index] !== "\n") advance();
      continue;
    }
    if (character === "\n") {
      const start = position();
      push("newline", advance(), "\n", start);
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
        throw compileErrorAt("unterminated string literal", {
          end: position(),
          start,
        });
      const raw = normalized.slice(start.offset, index);
      let value: string;
      try {
        value = JSON.parse(raw) as string;
      } catch {
        throw compileErrorAt("invalid string literal", {
          end: position(),
          start,
        });
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
      push("number", raw, raw.replaceAll("_", ""), start);
      continue;
    }
    if (isIdentifierStart(character)) {
      const start = position();
      advance();
      while (
        index < normalized.length &&
        isIdentifierContinue(normalized[index]!)
      )
        advance();
      const raw = normalized.slice(start.offset, index);
      push("identifier", raw, raw, start);
      continue;
    }
    const pair = normalized.slice(index, index + 2);
    if (pair === "<<" || pair === ">>") {
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
    throw compileErrorAt(`unexpected character ${JSON.stringify(character)}`, {
      end: position(),
      start,
    });
  }
  const end = position();
  tokens.push({ kind: "eof", raw: "", span: { end, start: end }, value: "" });
  return tokens;
}

function isIdentifierStart(character: string): boolean {
  return /[A-Za-z_.$@?%]/u.test(character);
}

function isIdentifierContinue(character: string): boolean {
  return /[A-Za-z0-9_.$@?%]/u.test(character);
}
