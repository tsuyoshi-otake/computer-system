import { LanguageSyntaxError } from "./errors.js";
import { resolveLexerLimits, type LexerLimits } from "./limits.js";
import type { SourcePosition } from "./source.js";
import { keywords, type Token, type TokenKind } from "./token.js";

const threeCharacterOperators = new Set(["**=", "//=", "<<=", ">>="]);
const twoCharacterOperators = new Set([
  "**",
  "//",
  "==",
  "!=",
  "<=",
  ">=",
  "<<",
  ">>",
  "+=",
  "-=",
  "*=",
  "/=",
  "%=",
  "&=",
  "^=",
  "|=",
  ":=",
  "->",
]);
const oneCharacterOperators = new Set("+-*/%=<>()[]{}.,:~&^|@");

export function lex(
  source: string,
  limitOverrides: Partial<LexerLimits> = {},
): readonly Token[] {
  return new Lexer(source, resolveLexerLimits(limitOverrides)).scan();
}

class Lexer {
  private readonly tokens: Token[] = [];
  private readonly indentation = [0];
  private offset = 0;
  private line = 1;
  private column = 1;
  private atLineStart = true;
  private nesting = 0;

  constructor(
    private readonly source: string,
    private readonly limits: LexerLimits,
  ) {
    if (source.length > limits.maxSourceCodeUnits) {
      const position = positionAt(source, limits.maxSourceCodeUnits);
      throw new LanguageSyntaxError(
        `Source code unit limit exceeded (max ${limits.maxSourceCodeUnits})`,
        { start: position, end: position },
      );
    }
  }

  scan(): readonly Token[] {
    while (!this.isAtEnd()) {
      if (this.atLineStart && this.nesting === 0 && this.scanIndentation()) {
        continue;
      }

      const character = this.peek();
      if (character === " " || character === "\r" || character === "\t") {
        if (character === "\t") {
          throw this.error("Tabs are not allowed for indentation");
        }
        this.advance();
        continue;
      }
      if (character === "#") {
        this.skipComment();
        continue;
      }
      if (character === "\n") {
        this.scanNewline();
        continue;
      }
      if (isDigit(character) || (character === "." && isDigit(this.peek(1)))) {
        this.scanNumber();
        continue;
      }
      const stringPrefix = this.stringPrefix();
      if (stringPrefix !== undefined) {
        this.scanString(stringPrefix);
        continue;
      }
      if (character === '"' || character === "'") {
        this.scanString({ kind: "string", prefixLength: 0, raw: false });
        continue;
      }
      if (isIdentifierStart(this.peekCodePoint())) {
        this.scanIdentifier();
        continue;
      }
      if (this.scanOperator()) {
        continue;
      }
      throw this.error(`Unexpected character ${JSON.stringify(character)}`);
    }

    if (this.nesting !== 0) {
      throw this.error("Unclosed delimiter");
    }
    if (
      this.tokens.length > 0 &&
      this.tokens.at(-1)?.kind !== "newline" &&
      this.nesting === 0
    ) {
      const position = this.position();
      this.addToken("newline", "\n", position, position);
    }
    while (this.indentation.length > 1) {
      this.indentation.pop();
      const position = this.position();
      this.addToken("dedent", "", position, position);
    }
    const position = this.position();
    this.addToken("eof", "", position, position);
    return this.tokens;
  }

  private scanIndentation(): boolean {
    const start = this.position();
    let width = 0;
    while (this.peek() === " ") {
      this.advance();
      width += 1;
    }
    if (this.peek() === "\t") {
      throw this.error("Tabs are not allowed for indentation");
    }
    if (this.peek() === "#" || this.peek() === "\n") {
      this.atLineStart = false;
      return false;
    }

    this.atLineStart = false;
    const current = this.indentation.at(-1) ?? 0;
    if (width > current) {
      if (this.indentation.length - 1 >= this.limits.maxIndentationDepth) {
        throw new LanguageSyntaxError(
          `Indentation depth limit exceeded (max ${this.limits.maxIndentationDepth})`,
          { start, end: this.position() },
        );
      }
      this.indentation.push(width);
      this.addToken("indent", "", start, this.position());
    } else if (width < current) {
      while (width < (this.indentation.at(-1) ?? 0)) {
        this.indentation.pop();
        this.addToken("dedent", "", start, this.position());
      }
      if (width !== this.indentation.at(-1)) {
        throw this.error("Indentation does not match an outer block");
      }
    }
    return false;
  }

  private scanNewline(): void {
    const start = this.position();
    this.advance();
    if (this.nesting === 0) {
      this.addToken("newline", "\n", start, this.position());
      this.atLineStart = true;
    }
  }

  private scanNumber(): void {
    const start = this.position();
    const startOffset = this.offset;
    const basePrefix = this.peek() === "0" && "bBoOxX".includes(this.peek(1));
    if (basePrefix) {
      this.advanceBoundedLiteral(startOffset);
      this.advanceBoundedLiteral(startOffset);
      while (isAsciiAlphaNumeric(this.peek()) || this.peek() === "_") {
        this.advanceBoundedLiteral(startOffset);
      }
    } else {
      while (isDigit(this.peek()) || this.peek() === "_") {
        this.advanceBoundedLiteral(startOffset);
      }
      if (this.peek() === ".") {
        this.advanceBoundedLiteral(startOffset);
        while (isDigit(this.peek()) || this.peek() === "_") {
          this.advanceBoundedLiteral(startOffset);
        }
      }
      if (this.peek().toLowerCase() === "e") {
        this.advanceBoundedLiteral(startOffset);
        if (this.peek() === "+" || this.peek() === "-") {
          this.advanceBoundedLiteral(startOffset);
        }
        while (isDigit(this.peek()) || this.peek() === "_") {
          this.advanceBoundedLiteral(startOffset);
        }
      }
    }
    const lexeme = this.source.slice(startOffset, this.offset);
    const compact = lexeme.replaceAll("_", "");
    let literal: bigint | number;
    if (isIntegerLexeme(lexeme)) {
      literal = normalizeIntegerLiteral(BigInt(compact));
    } else if (isFloatLexeme(lexeme)) {
      literal = Number(compact);
    } else {
      throw new LanguageSyntaxError("Invalid numeric literal", {
        start,
        end: this.position(),
      });
    }
    if (typeof literal === "number" && !Number.isFinite(literal)) {
      throw new LanguageSyntaxError("Invalid numeric literal", {
        start,
        end: this.position(),
      });
    }
    this.addToken("number", lexeme, start, this.position(), literal);
  }

  private stringPrefix():
    | {
        readonly kind: "formatted_string" | "string" | "template_string";
        readonly prefixLength: 1 | 2;
        readonly raw: boolean;
      }
    | undefined {
    const first = this.peek().toLowerCase();
    const second = this.peek(1).toLowerCase();
    const directQuote = this.peek(1) === '"' || this.peek(1) === "'";
    if (directQuote && ["f", "r", "t"].includes(first)) {
      return {
        kind:
          first === "f"
            ? "formatted_string"
            : first === "t"
              ? "template_string"
              : "string",
        prefixLength: 1,
        raw: first === "r",
      };
    }
    const combined = `${first}${second}`;
    const combinedQuote = this.peek(2) === '"' || this.peek(2) === "'";
    if (combinedQuote && ["fr", "rf", "tr", "rt"].includes(combined)) {
      return {
        kind: combined.includes("f") ? "formatted_string" : "template_string",
        prefixLength: 2,
        raw: true,
      };
    }
    return undefined;
  }

  private scanString(options: {
    readonly kind: "formatted_string" | "string" | "template_string";
    readonly prefixLength: 0 | 1 | 2;
    readonly raw: boolean;
  }): void {
    const start = this.position();
    const startOffset = this.offset;
    for (let index = 0; index < options.prefixLength; index += 1)
      this.advance();
    const quote = this.advance();
    const triple = this.peek() === quote && this.peek(1) === quote;
    if (triple) {
      this.advance();
      this.advance();
    }
    const contentOffset = this.offset;
    let value = "";
    let replacementDepth = 0;
    let replacementQuote: "'" | '"' | undefined;
    while (!this.isAtEnd()) {
      const closesLiteral = triple
        ? this.peek() === quote &&
          this.peek(1) === quote &&
          this.peek(2) === quote
        : this.peek() === quote;
      if (closesLiteral && replacementDepth === 0) break;
      if (this.peek() === "\n" && !triple) {
        throw new LanguageSyntaxError("Unterminated string literal", {
          start,
          end: this.position(),
        });
      }
      if (
        options.kind !== "string" &&
        replacementDepth === 0 &&
        (this.peek() === "{" || this.peek() === "}") &&
        this.peek(1) === this.peek()
      ) {
        value += this.advanceBoundedLiteral(contentOffset);
        value += this.advanceBoundedLiteral(contentOffset);
        continue;
      }
      if (this.peek() === "\\") {
        this.advanceBoundedLiteral(contentOffset);
        if (this.isAtEnd()) {
          throw new LanguageSyntaxError("Unterminated string literal", {
            start,
            end: this.position(),
          });
        }
        const escaped = this.advanceBoundedLiteral(contentOffset);
        value +=
          options.raw || replacementDepth > 0
            ? `\\${escaped}`
            : decodeEscape(escaped);
      } else {
        const character = this.advanceBoundedLiteral(contentOffset);
        value += character;
        if (options.kind !== "string") {
          if (replacementQuote !== undefined) {
            if (character === replacementQuote) replacementQuote = undefined;
          } else if (
            replacementDepth > 0 &&
            (character === "'" || character === '"')
          ) {
            replacementQuote = character;
          } else if (
            character === "{" &&
            this.peek() !== "{" &&
            replacementDepth === 0
          ) {
            replacementDepth = 1;
          } else if (character === "{" && replacementDepth > 0) {
            replacementDepth += 1;
          } else if (character === "}" && replacementDepth > 0) {
            replacementDepth -= 1;
          }
        }
      }
    }
    if (this.isAtEnd()) {
      throw new LanguageSyntaxError("Unterminated string literal", {
        start,
        end: this.position(),
      });
    }
    this.advance();
    if (triple) {
      this.advance();
      this.advance();
    }
    this.addToken(
      options.kind,
      this.source.slice(startOffset, this.offset),
      start,
      this.position(),
      value,
    );
  }

  private scanIdentifier(): void {
    const start = this.position();
    const startOffset = this.offset;
    while (isIdentifierPart(this.peekCodePoint())) {
      const codePoint = this.peekCodePoint();
      if (
        this.offset - startOffset + codePoint.length >
        this.limits.maxIdentifierCodeUnits
      ) {
        throw this.error(
          `Identifier code unit limit exceeded (max ${this.limits.maxIdentifierCodeUnits})`,
        );
      }
      for (let index = 0; index < codePoint.length; index += 1) this.advance();
    }
    const lexeme = this.source.slice(startOffset, this.offset);
    let literal: boolean | null | undefined;
    if (lexeme === "True") literal = true;
    if (lexeme === "False") literal = false;
    if (lexeme === "None") literal = null;
    const kind = keywords.has(lexeme) ? "keyword" : "identifier";
    this.addToken(
      kind,
      lexeme,
      start,
      this.position(),
      kind === "identifier" ? lexeme.normalize("NFKC") : literal,
    );
  }

  private scanOperator(): boolean {
    const start = this.position();
    const triple = `${this.peek()}${this.peek(1)}${this.peek(2)}`;
    const pair = `${this.peek()}${this.peek(1)}`;
    let operator: string | undefined;
    if (threeCharacterOperators.has(triple)) {
      operator = this.advance() + this.advance() + this.advance();
    } else if (twoCharacterOperators.has(pair)) {
      operator = this.advance() + this.advance();
    } else if (oneCharacterOperators.has(this.peek())) {
      operator = this.advance();
    }
    if (operator === undefined) return false;
    if ("([{ ".trim().includes(operator)) {
      if (this.nesting >= this.limits.maxDelimiterNesting) {
        throw new LanguageSyntaxError(
          `Delimiter nesting limit exceeded (max ${this.limits.maxDelimiterNesting})`,
          { start, end: this.position() },
        );
      }
      this.nesting += 1;
    }
    if (")]}".includes(operator)) {
      this.nesting -= 1;
      if (this.nesting < 0) {
        throw new LanguageSyntaxError("Unmatched closing delimiter", {
          start,
          end: this.position(),
        });
      }
    }
    this.addToken("operator", operator, start, this.position());
    return true;
  }

  private skipComment(): void {
    while (!this.isAtEnd() && this.peek() !== "\n") this.advance();
  }

  private addToken(
    kind: TokenKind,
    lexeme: string,
    start: SourcePosition,
    end: SourcePosition,
    literal?: bigint | boolean | null | number | string,
  ): void {
    if (this.tokens.length >= this.limits.maxTokens) {
      throw new LanguageSyntaxError(
        `Token limit exceeded (max ${this.limits.maxTokens})`,
        { start, end },
      );
    }
    this.tokens.push({ kind, lexeme, literal, span: { start, end } });
  }

  private advanceBoundedLiteral(startOffset: number): string {
    if (this.offset - startOffset >= this.limits.maxLiteralCodeUnits) {
      throw this.error(
        `Literal code unit limit exceeded (max ${this.limits.maxLiteralCodeUnits})`,
      );
    }
    return this.advance();
  }

  private error(message: string): LanguageSyntaxError {
    const position = this.position();
    return new LanguageSyntaxError(message, {
      start: position,
      end: position,
    });
  }

  private position(): SourcePosition {
    return { offset: this.offset, line: this.line, column: this.column };
  }

  private peek(distance = 0): string {
    return this.source[this.offset + distance] ?? "\0";
  }

  private peekCodePoint(): string {
    const codePoint = this.source.codePointAt(this.offset);
    return codePoint === undefined ? "\0" : String.fromCodePoint(codePoint);
  }

  private advance(): string {
    const character = this.source[this.offset] ?? "\0";
    this.offset += 1;
    if (character === "\n") {
      this.line += 1;
      this.column = 1;
    } else {
      this.column += 1;
    }
    return character;
  }

  private isAtEnd(): boolean {
    return this.offset >= this.source.length;
  }
}

function positionAt(source: string, offset: number): SourcePosition {
  let line = 1;
  let column = 1;
  for (let index = 0; index < offset; index += 1) {
    if (source[index] === "\n") {
      line += 1;
      column = 1;
    } else {
      column += 1;
    }
  }
  return { offset, line, column };
}

function isDigit(character: string): boolean {
  return character >= "0" && character <= "9";
}

function isAsciiAlphaNumeric(character: string): boolean {
  return (
    isDigit(character) ||
    (character >= "a" && character <= "z") ||
    (character >= "A" && character <= "Z")
  );
}

function isIntegerLexeme(value: string): boolean {
  return (
    /^(?:0(?:_?0)*|[1-9](?:_?[0-9])*)$/u.test(value) ||
    /^0[bB]_?[01](?:_?[01])*$/u.test(value) ||
    /^0[oO]_?[0-7](?:_?[0-7])*$/u.test(value) ||
    /^0[xX]_?[0-9a-fA-F](?:_?[0-9a-fA-F])*$/u.test(value)
  );
}

function isFloatLexeme(value: string): boolean {
  const digits = String.raw`[0-9](?:_?[0-9])*`;
  const exponent = String.raw`[eE][+-]?${digits}`;
  return (
    new RegExp(
      String.raw`^(?:${digits}\.(?:${digits})?|\.${digits})(?:${exponent})?$`,
      "u",
    ).test(value) ||
    new RegExp(String.raw`^${digits}${exponent}$`, "u").test(value)
  );
}

function normalizeIntegerLiteral(value: bigint): bigint | number {
  return value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : value;
}

function isIdentifierStart(character: string): boolean {
  return /^[_\p{XID_Start}]$/u.test(character);
}

function isIdentifierPart(character: string): boolean {
  return /^[_\p{XID_Continue}]$/u.test(character);
}

function decodeEscape(character: string): string {
  if (character === "n") return "\n";
  if (character === "r") return "\r";
  if (character === "t") return "\t";
  if (character === "\\") return "\\";
  if (character === '"') return '"';
  if (character === "'") return "'";
  return character;
}
