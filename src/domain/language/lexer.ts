import { LanguageSyntaxError } from "./errors.js";
import type { SourcePosition } from "./source.js";
import { keywords, type Token, type TokenKind } from "./token.js";

const twoCharacterOperators = new Set(["**", "//", "==", "!=", "<=", ">="]);
const oneCharacterOperators = new Set("+-*/%=<>()[]{}.,:");

export function lex(source: string): readonly Token[] {
  return new Lexer(source).scan();
}

class Lexer {
  private readonly tokens: Token[] = [];
  private readonly indentation = [0];
  private offset = 0;
  private line = 1;
  private column = 1;
  private atLineStart = true;
  private nesting = 0;

  constructor(private readonly source: string) {}

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
      if (isDigit(character)) {
        this.scanNumber();
        continue;
      }
      if (
        (character === "f" || character === "F") &&
        (this.peek(1) === '"' || this.peek(1) === "'")
      ) {
        this.scanString(true);
        continue;
      }
      if (character === '"' || character === "'") {
        this.scanString(false);
        continue;
      }
      if (isIdentifierStart(character)) {
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
    while (isDigit(this.peek()) || this.peek() === "_") {
      this.advance();
    }
    if (this.peek() === "." && isDigit(this.peek(1))) {
      this.advance();
      while (isDigit(this.peek()) || this.peek() === "_") {
        this.advance();
      }
    }
    if (this.peek().toLowerCase() === "e") {
      const exponentOffset = this.offset;
      const exponentColumn = this.column;
      this.advance();
      if (this.peek() === "+" || this.peek() === "-") {
        this.advance();
      }
      if (!isDigit(this.peek())) {
        this.offset = exponentOffset;
        this.column = exponentColumn;
      } else {
        while (isDigit(this.peek()) || this.peek() === "_") {
          this.advance();
        }
      }
    }
    const lexeme = this.source.slice(startOffset, this.offset);
    const literal = Number(lexeme.replaceAll("_", ""));
    if (!Number.isFinite(literal)) {
      throw new LanguageSyntaxError("Invalid numeric literal", {
        start,
        end: this.position(),
      });
    }
    this.addToken("number", lexeme, start, this.position(), literal);
  }

  private scanString(formatted: boolean): void {
    const start = this.position();
    const startOffset = this.offset;
    if (formatted) {
      this.advance();
    }
    const quote = this.advance();
    let value = "";
    while (!this.isAtEnd() && this.peek() !== quote) {
      if (this.peek() === "\n") {
        throw new LanguageSyntaxError("Unterminated string literal", {
          start,
          end: this.position(),
        });
      }
      if (this.peek() === "\\") {
        this.advance();
        const escaped = this.advance();
        value += decodeEscape(escaped);
      } else {
        value += this.advance();
      }
    }
    if (this.isAtEnd()) {
      throw new LanguageSyntaxError("Unterminated string literal", {
        start,
        end: this.position(),
      });
    }
    this.advance();
    this.addToken(
      formatted ? "formatted_string" : "string",
      this.source.slice(startOffset, this.offset),
      start,
      this.position(),
      value,
    );
  }

  private scanIdentifier(): void {
    const start = this.position();
    const startOffset = this.offset;
    while (isIdentifierPart(this.peek())) {
      this.advance();
    }
    const lexeme = this.source.slice(startOffset, this.offset);
    let literal: boolean | null | undefined;
    if (lexeme === "True") literal = true;
    if (lexeme === "False") literal = false;
    if (lexeme === "None") literal = null;
    this.addToken(
      keywords.has(lexeme) ? "keyword" : "identifier",
      lexeme,
      start,
      this.position(),
      literal,
    );
  }

  private scanOperator(): boolean {
    const start = this.position();
    const pair = `${this.peek()}${this.peek(1)}`;
    let operator: string | undefined;
    if (twoCharacterOperators.has(pair)) {
      operator = this.advance() + this.advance();
    } else if (oneCharacterOperators.has(this.peek())) {
      operator = this.advance();
    }
    if (operator === undefined) return false;
    if ("([{ ".trim().includes(operator)) this.nesting += 1;
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
    literal?: boolean | null | number | string,
  ): void {
    this.tokens.push({ kind, lexeme, literal, span: { start, end } });
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

function isDigit(character: string): boolean {
  return character >= "0" && character <= "9";
}

function isIdentifierStart(character: string): boolean {
  return /[A-Za-z_]/u.test(character);
}

function isIdentifierPart(character: string): boolean {
  return /[A-Za-z0-9_]/u.test(character);
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
