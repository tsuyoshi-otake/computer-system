import type { SourceSpan } from "./source.js";

export class LanguageSyntaxError extends Error {
  constructor(
    message: string,
    readonly span: SourceSpan,
  ) {
    super(`${message} at ${span.start.line}:${span.start.column}`);
    this.name = "LanguageSyntaxError";
  }
}
