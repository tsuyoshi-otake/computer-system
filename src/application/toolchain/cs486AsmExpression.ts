import { compileErrorAt } from "./cs486AsmDiagnostics.js";
import type { Cs486AsmToken } from "./cs486AsmTokenizer.js";

export type Cs486AsmExpressionValue =
  | { readonly kind: "absolute"; readonly value: number }
  | {
      readonly addend: number;
      readonly kind: "symbol";
      readonly symbol: string;
    };

export function evaluateCs486AsmExpression(
  tokens: readonly Cs486AsmToken[],
  constants: ReadonlyMap<string, number>,
): Cs486AsmExpressionValue {
  if (tokens.length === 0) throw new Error("empty assembly expression");
  let cursor = 0;

  const parse = (minimumPrecedence: number): Cs486AsmExpressionValue => {
    let left = parsePrefix();
    while (cursor < tokens.length) {
      const operator = tokens[cursor]!;
      const precedence = binaryPrecedence(operator.value);
      if (precedence < minimumPrecedence) break;
      cursor += 1;
      const right = parse(precedence + 1);
      left = applyBinary(operator, left, right);
    }
    return left;
  };

  const parsePrefix = (): Cs486AsmExpressionValue => {
    const token = tokens[cursor++];
    if (token === undefined)
      throw compileErrorAt("expected expression", tokens.at(-1)!.span);
    if (token.value === "(") {
      const value = parse(0);
      const closing = tokens[cursor++];
      if (closing?.value !== ")")
        throw compileErrorAt("expected closing parenthesis", token.span);
      return value;
    }
    if (["+", "-", "~"].includes(token.value)) {
      const value = parsePrefix();
      if (value.kind !== "absolute")
        throw compileErrorAt(
          `operator ${token.value} requires an absolute expression`,
          token.span,
        );
      if (token.value === "+") return value;
      if (token.value === "-") return absolute(-value.value, token);
      return absolute(~value.value, token);
    }
    if (token.kind === "number") return absolute(parseNumber(token), token);
    if (token.kind === "identifier") {
      const constant = constants.get(token.value);
      return constant === undefined
        ? { addend: 0, kind: "symbol", symbol: token.value }
        : { kind: "absolute", value: constant };
    }
    throw compileErrorAt("expected number, constant, or symbol", token.span);
  };

  const value = parse(0);
  if (cursor !== tokens.length)
    throw compileErrorAt(
      "unexpected token in expression",
      tokens[cursor]!.span,
    );
  return value;
}

function binaryPrecedence(operator: string): number {
  switch (operator) {
    case "|":
      return 1;
    case "^":
      return 2;
    case "&":
      return 3;
    case "<<":
    case ">>":
      return 4;
    case "+":
    case "-":
      return 5;
    case "*":
    case "/":
    case "%":
      return 6;
    default:
      return -1;
  }
}

function applyBinary(
  operator: Cs486AsmToken,
  left: Cs486AsmExpressionValue,
  right: Cs486AsmExpressionValue,
): Cs486AsmExpressionValue {
  if (operator.value === "+" || operator.value === "-") {
    if (left.kind === "symbol" && right.kind === "absolute")
      return {
        ...left,
        addend: checked(
          operator.value === "+"
            ? left.addend + right.value
            : left.addend - right.value,
          operator,
        ),
      };
    if (
      operator.value === "+" &&
      left.kind === "absolute" &&
      right.kind === "symbol"
    )
      return { ...right, addend: checked(right.addend + left.value, operator) };
  }
  if (left.kind !== "absolute" || right.kind !== "absolute")
    throw compileErrorAt(
      `operator ${operator.value} does not support two relocatable values`,
      operator.span,
    );
  let result: number;
  switch (operator.value) {
    case "+":
      result = left.value + right.value;
      break;
    case "-":
      result = left.value - right.value;
      break;
    case "*":
      result = Math.imul(left.value, right.value);
      break;
    case "/":
      if (right.value === 0)
        throw compileErrorAt(
          "division by zero in constant expression",
          operator.span,
        );
      result = Math.trunc(left.value / right.value);
      break;
    case "%":
      if (right.value === 0)
        throw compileErrorAt(
          "division by zero in constant expression",
          operator.span,
        );
      result = left.value % right.value;
      break;
    case "<<":
      result = left.value << (right.value & 31);
      break;
    case ">>":
      result = left.value >> (right.value & 31);
      break;
    case "&":
      result = left.value & right.value;
      break;
    case "^":
      result = left.value ^ right.value;
      break;
    case "|":
      result = left.value | right.value;
      break;
    default:
      throw compileErrorAt(
        `unsupported operator ${operator.value}`,
        operator.span,
      );
  }
  return absolute(result, operator);
}

function parseNumber(token: Cs486AsmToken): number {
  const raw = token.value;
  let value: number;
  if (/^0x[0-9a-f]+$/iu.test(raw)) value = Number.parseInt(raw.slice(2), 16);
  else if (/^0b[01]+$/iu.test(raw)) value = Number.parseInt(raw.slice(2), 2);
  else if (/^[0-9][0-9a-f]*h$/iu.test(raw))
    value = Number.parseInt(raw.slice(0, -1), 16);
  else if (/^\d+$/u.test(raw)) value = Number.parseInt(raw, 10);
  else throw compileErrorAt(`invalid integer ${token.raw}`, token.span);
  if (!Number.isSafeInteger(value) || value > 0xffffffff)
    throw compileErrorAt("integer is outside the 32-bit range", token.span);
  return value | 0;
}

function absolute(
  value: number,
  token: Cs486AsmToken,
): Cs486AsmExpressionValue {
  return { kind: "absolute", value: checked(value, token) | 0 };
}

function checked(value: number, token: Cs486AsmToken): number {
  if (
    !Number.isSafeInteger(value) ||
    value < -2_147_483_648 ||
    value > 0xffffffff
  )
    throw compileErrorAt("expression is outside the 32-bit range", token.span);
  return value;
}
