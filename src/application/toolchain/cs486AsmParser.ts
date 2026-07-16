import { compileErrorAt, type Cs486SourceSpan } from "./cs486AsmDiagnostics.js";
import type { Cs486AsmToken } from "./cs486AsmTokenizer.js";

export interface Cs486AsmLabelStatement {
  readonly kind: "label";
  readonly name: string;
  readonly span: Cs486SourceSpan;
}

export interface Cs486AsmOperationStatement {
  readonly kind: "operation";
  readonly name: string;
  readonly operands: readonly (readonly Cs486AsmToken[])[];
  readonly span: Cs486SourceSpan;
}

export type Cs486AsmStatement =
  Cs486AsmLabelStatement | Cs486AsmOperationStatement;

export function parseCs486AssemblyTokens(
  tokens: readonly Cs486AsmToken[],
): readonly Cs486AsmStatement[] {
  const statements: Cs486AsmStatement[] = [];
  let line: Cs486AsmToken[] = [];
  for (const token of tokens) {
    if (token.kind === "newline" || token.kind === "eof") {
      if (line.length > 0) statements.push(...parseLine(line));
      line = [];
      continue;
    }
    line.push(token);
  }
  return statements;
}

function parseLine(tokens: readonly Cs486AsmToken[]): Cs486AsmStatement[] {
  const statements: Cs486AsmStatement[] = [];
  let cursor = 0;
  while (
    tokens[cursor]?.kind === "identifier" &&
    tokens[cursor + 1]?.value === ":"
  ) {
    const name = tokens[cursor]!;
    const colon = tokens[cursor + 1]!;
    statements.push({
      kind: "label",
      name: name.value,
      span: { end: colon.span.end, start: name.span.start },
    });
    cursor += 2;
  }
  if (cursor >= tokens.length) return statements;
  const operation = tokens[cursor]!;
  if (operation.kind !== "identifier")
    throw compileErrorAt("expected instruction or directive", operation.span);
  cursor += 1;
  const operands: Cs486AsmToken[][] = [];
  let operand: Cs486AsmToken[] = [];
  let squareDepth = 0;
  let parenthesisDepth = 0;
  for (; cursor < tokens.length; cursor += 1) {
    const token = tokens[cursor]!;
    if (token.value === "[") squareDepth += 1;
    else if (token.value === "]") squareDepth -= 1;
    else if (token.value === "(") parenthesisDepth += 1;
    else if (token.value === ")") parenthesisDepth -= 1;
    if (squareDepth < 0 || parenthesisDepth < 0)
      throw compileErrorAt("unbalanced delimiter", token.span);
    if (token.value === "," && squareDepth === 0 && parenthesisDepth === 0) {
      if (operand.length === 0)
        throw compileErrorAt("empty operand", token.span);
      operands.push(operand);
      operand = [];
    } else operand.push(token);
  }
  if (squareDepth !== 0 || parenthesisDepth !== 0)
    throw compileErrorAt(
      "unbalanced delimiter",
      tokens[tokens.length - 1]!.span,
    );
  if (operand.length > 0) operands.push(operand);
  else if (operands.length > 0)
    throw compileErrorAt("empty operand", tokens[tokens.length - 1]!.span);
  statements.push({
    kind: "operation",
    name: operation.value,
    operands,
    span: {
      end: tokens[tokens.length - 1]!.span.end,
      start: operation.span.start,
    },
  });
  return statements;
}
