import type { SourceSpan } from "./source.js";

export type TokenKind =
  | "dedent"
  | "eof"
  | "formatted_string"
  | "identifier"
  | "indent"
  | "keyword"
  | "newline"
  | "number"
  | "operator"
  | "string";

export interface Token {
  readonly kind: TokenKind;
  readonly lexeme: string;
  readonly literal?: boolean | null | number | string;
  readonly span: SourceSpan;
}

export const keywords = new Set([
  "and",
  "as",
  "break",
  "continue",
  "def",
  "elif",
  "else",
  "except",
  "False",
  "finally",
  "for",
  "from",
  "if",
  "import",
  "in",
  "is",
  "None",
  "not",
  "or",
  "pass",
  "raise",
  "return",
  "True",
  "try",
  "while",
]);
