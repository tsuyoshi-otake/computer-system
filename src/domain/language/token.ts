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
  | "string"
  | "template_string";

export interface Token {
  readonly kind: TokenKind;
  readonly lexeme: string;
  readonly literal?: bigint | boolean | null | number | string;
  readonly span: SourceSpan;
}

export const keywords = new Set([
  "and",
  "as",
  "async",
  "await",
  "break",
  "class",
  "continue",
  "def",
  "del",
  "elif",
  "else",
  "except",
  "False",
  "finally",
  "for",
  "from",
  "global",
  "if",
  "import",
  "in",
  "is",
  "lambda",
  "None",
  "nonlocal",
  "not",
  "or",
  "pass",
  "raise",
  "return",
  "True",
  "try",
  "while",
  "with",
  "yield",
]);
