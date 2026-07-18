export interface Cs486SourcePosition {
  readonly column: number;
  readonly line: number;
  readonly offset: number;
  readonly source: string;
}

export interface Cs486SourceSpan {
  readonly diagnosticNotes?: readonly Cs486DiagnosticNote[];
  readonly end: Cs486SourcePosition;
  readonly start: Cs486SourcePosition;
}

export interface Cs486DiagnosticNote {
  readonly message: string;
  readonly span?: Cs486SourceSpan;
}

export class Cs486CompileError extends Error {
  readonly code: string;
  readonly column?: number;
  readonly detail: string;
  readonly notes: readonly Cs486DiagnosticNote[];
  readonly source?: string;
  readonly span?: Cs486SourceSpan;

  constructor(
    message: string,
    readonly line?: number,
    options: {
      readonly code?: string;
      readonly column?: number;
      readonly notes?: readonly Cs486DiagnosticNote[];
      readonly source?: string;
      readonly span?: Cs486SourceSpan;
    } = {},
  ) {
    const span = options.span;
    const source = options.source ?? span?.start.source;
    const resolvedLine = line ?? span?.start.line;
    const column = options.column ?? span?.start.column;
    const location =
      source !== undefined && resolvedLine !== undefined
        ? `${source}:${String(resolvedLine)}:${String(column ?? 1)}: `
        : resolvedLine !== undefined
          ? `line ${String(resolvedLine)}${column === undefined ? "" : `:${String(column)}`}: `
          : "";
    super(`${location}${message}`);
    this.name = "CompileError";
    this.code = options.code ?? "CSASM001";
    this.column = column;
    this.detail = message;
    this.notes = options.notes ?? [];
    this.source = source;
    this.span = span;
  }
}

export function compileErrorAt(
  message: string,
  span: Cs486SourceSpan,
  options: {
    readonly code?: string;
    readonly notes?: readonly Cs486DiagnosticNote[];
  } = {},
): Cs486CompileError {
  return new Cs486CompileError(message, span.start.line, {
    ...options,
    span,
  });
}
