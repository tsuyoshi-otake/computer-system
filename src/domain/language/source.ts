export interface SourcePosition {
  readonly offset: number;
  readonly line: number;
  readonly column: number;
}

export interface SourceSpan {
  readonly start: SourcePosition;
  readonly end: SourcePosition;
}

export function mergeSpans(first: SourceSpan, last: SourceSpan): SourceSpan {
  return { start: first.start, end: last.end };
}
