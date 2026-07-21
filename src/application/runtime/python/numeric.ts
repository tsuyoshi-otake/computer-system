import type {
  BinaryExpression,
  UnaryExpression,
} from "../../../domain/language/ast.js";
import type { SourceSpan } from "../../../domain/language/source.js";
import {
  VmLimitError,
  VmRuntimeError,
} from "../../../domain/runtime/errors.js";
import type { RuntimeValue } from "../../../domain/runtime/value.js";

export type PythonNumber = bigint | number;

export function applyPythonBinaryNumeric(
  leftValue: RuntimeValue,
  rightValue: RuntimeValue,
  operator: BinaryExpression["operator"],
  maxIntegerBits: number,
  span?: SourceSpan,
): RuntimeValue {
  const left = requirePythonNumber(leftValue, span);
  const right = requirePythonNumber(rightValue, span);
  if (["&", "|", "^", "<<", ">>"].includes(operator)) {
    return applyIntegerOperator(
      requirePythonInteger(left, span),
      requirePythonInteger(right, span),
      operator,
      maxIntegerBits,
      span,
    );
  }
  if (operator === "/") {
    if (isZero(right)) throw zeroDivision(span);
    return finiteFloatDivision(left, right, span);
  }
  if (isIntegerNumber(left) && isIntegerNumber(right)) {
    return applyIntegerOperator(
      BigInt(left),
      BigInt(right),
      operator,
      maxIntegerBits,
      span,
    );
  }
  const leftFloat = finiteFloatOperand(left, span);
  const rightFloat = finiteFloatOperand(right, span);
  if (["//", "%"].includes(operator) && rightFloat === 0) {
    throw zeroDivision(span);
  }
  if (operator === "+") return leftFloat + rightFloat;
  if (operator === "-") return leftFloat - rightFloat;
  if (operator === "*") return leftFloat * rightFloat;
  if (operator === "//") return Math.floor(leftFloat / rightFloat);
  if (operator === "%") {
    return ((leftFloat % rightFloat) + rightFloat) % rightFloat;
  }
  if (operator === "**") {
    const result = leftFloat ** rightFloat;
    if (!Number.isFinite(result)) {
      throw new VmRuntimeError(
        "OverflowError",
        "numeric result is too large",
        span,
      );
    }
    return result;
  }
  throw new VmRuntimeError(
    "TypeError",
    `Operator ${operator} requires integer operands`,
    span,
  );
}

export function applyPythonUnaryNumeric(
  value: RuntimeValue,
  operator: Exclude<UnaryExpression["operator"], "not">,
  maxIntegerBits: number,
  span?: SourceSpan,
): RuntimeValue {
  const number = requirePythonNumber(value, span);
  if (operator === "~") {
    return normalizePythonInteger(
      ~requirePythonInteger(number, span),
      maxIntegerBits,
      span,
    );
  }
  if (operator === "+") return number;
  if (typeof number === "bigint") {
    return normalizePythonInteger(-number, maxIntegerBits, span);
  }
  return -number;
}

export function comparePythonNumbers(
  left: RuntimeValue,
  right: RuntimeValue,
): number | undefined {
  if (!isPythonNumber(left) || !isPythonNumber(right)) return undefined;
  const leftNumber = normalizeBoolean(left);
  const rightNumber = normalizeBoolean(right);
  if (leftNumber < rightNumber) return -1;
  if (leftNumber > rightNumber) return 1;
  return 0;
}

export function isPythonNumber(
  value: RuntimeValue,
): value is bigint | boolean | number {
  return (
    typeof value === "bigint" ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
}

export function pythonIntegerBitLength(value: bigint): number {
  const magnitude = value < 0n ? -value : value;
  return magnitude === 0n ? 0 : magnitude.toString(2).length;
}

export function pythonIntegerStorageBytes(value: bigint): number {
  return 16 + Math.ceil(pythonIntegerBitLength(value) / 8);
}

export function requireHostNumber(
  value: RuntimeValue,
  span?: SourceSpan,
): number {
  const number = requirePythonNumber(value, span);
  if (typeof number === "number") return number;
  const converted = Number(number);
  if (!Number.isSafeInteger(converted)) {
    throw new VmRuntimeError(
      "OverflowError",
      "integer is outside the guest native API range",
      span,
    );
  }
  return converted;
}

function applyIntegerOperator(
  left: bigint,
  right: bigint,
  operator: BinaryExpression["operator"],
  maxIntegerBits: number,
  span?: SourceSpan,
): RuntimeValue {
  if (["//", "%"].includes(operator) && right === 0n) {
    throw zeroDivision(span);
  }
  if ((operator === "<<" || operator === ">>") && right < 0n) {
    throw new VmRuntimeError("ValueError", "negative shift count", span);
  }
  let result: bigint;
  if (operator === "+") result = left + right;
  else if (operator === "-") result = left - right;
  else if (operator === "*") result = left * right;
  else if (operator === "//") result = floorDivide(left, right);
  else if (operator === "%") result = left - floorDivide(left, right) * right;
  else if (operator === "&") result = left & right;
  else if (operator === "|") result = left | right;
  else if (operator === "^") result = left ^ right;
  else if (operator === "<<") {
    ensureGrowthWithinLimit(
      pythonIntegerBitLength(left),
      right,
      maxIntegerBits,
      span,
    );
    result = left << right;
  } else if (operator === ">>") {
    if (right > BigInt(maxIntegerBits)) return left < 0n ? -1 : 0;
    result = left >> right;
  } else if (operator === "**") {
    if (right < 0n) {
      if (left === 0n) throw zeroDivision(span);
      return finiteFloatPower(left, right, span);
    }
    if (left === 0n) result = right === 0n ? 1n : 0n;
    else if (left === 1n) result = 1n;
    else if (left === -1n) result = right % 2n === 0n ? 1n : -1n;
    else {
      const magnitude = left < 0n ? -left : left;
      const bits = BigInt(pythonIntegerBitLength(magnitude));
      const powerOfTwo = (magnitude & (magnitude - 1n)) === 0n;
      const estimatedBits = powerOfTwo
        ? (bits - 1n) * right + 1n
        : bits * right;
      ensureGrowthWithinLimit(0, estimatedBits, maxIntegerBits, span);
      result = left ** right;
    }
  } else {
    throw new VmRuntimeError(
      "TypeError",
      `Operator ${operator} is not an integer operator`,
      span,
    );
  }
  return normalizePythonInteger(result, maxIntegerBits, span);
}

function normalizePythonInteger(
  value: bigint,
  maxIntegerBits: number,
  span?: SourceSpan,
): RuntimeValue {
  if (pythonIntegerBitLength(value) > maxIntegerBits) {
    throw new VmLimitError("integer bits", span);
  }
  if (
    value >= BigInt(Number.MIN_SAFE_INTEGER) &&
    value <= BigInt(Number.MAX_SAFE_INTEGER)
  ) {
    return Number(value);
  }
  return value;
}

function requirePythonNumber(
  value: RuntimeValue,
  span?: SourceSpan,
): PythonNumber {
  if (!isPythonNumber(value)) {
    throw new VmRuntimeError("TypeError", "Expected a number", span);
  }
  return normalizeBoolean(value);
}

function requirePythonInteger(value: PythonNumber, span?: SourceSpan): bigint {
  if (typeof value === "number" && !Number.isSafeInteger(value)) {
    throw new VmRuntimeError("TypeError", "Expected an integer", span);
  }
  return BigInt(value);
}

function normalizeBoolean(value: bigint | boolean | number): PythonNumber {
  return typeof value === "boolean" ? (value ? 1 : 0) : value;
}

function isIntegerNumber(value: PythonNumber): boolean {
  return typeof value === "bigint" || Number.isSafeInteger(value);
}

function isZero(value: PythonNumber): boolean {
  return value === 0 || value === 0n;
}

function floorDivide(left: bigint, right: bigint): bigint {
  let quotient = left / right;
  const remainder = left % right;
  if (remainder !== 0n && left < 0n !== right < 0n) quotient -= 1n;
  return quotient;
}

function finiteFloatOperand(value: PythonNumber, span?: SourceSpan): number {
  const converted = Number(value);
  if (!Number.isFinite(converted)) {
    throw new VmRuntimeError(
      "OverflowError",
      "integer is too large for float",
      span,
    );
  }
  return converted;
}

function finiteFloatDivision(
  left: PythonNumber,
  right: PythonNumber,
  span?: SourceSpan,
): number {
  const result =
    finiteFloatOperand(left, span) / finiteFloatOperand(right, span);
  if (!Number.isFinite(result)) {
    throw new VmRuntimeError(
      "OverflowError",
      "division result is too large",
      span,
    );
  }
  return result;
}

function finiteFloatPower(
  left: bigint,
  right: bigint,
  span?: SourceSpan,
): number {
  const result = Number(left) ** Number(right);
  if (!Number.isFinite(result)) {
    throw new VmRuntimeError(
      "OverflowError",
      "power result is too large",
      span,
    );
  }
  return result;
}

function ensureGrowthWithinLimit(
  currentBits: number,
  addedBits: bigint,
  maxIntegerBits: number,
  span?: SourceSpan,
): void {
  if (addedBits > BigInt(maxIntegerBits - currentBits)) {
    throw new VmLimitError("integer bits", span);
  }
}

function zeroDivision(span?: SourceSpan): VmRuntimeError {
  return new VmRuntimeError("ZeroDivisionError", "division by zero", span);
}
