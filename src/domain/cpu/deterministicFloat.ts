/**
 * Deterministic IEEE-754 software floating point for the CS486 guest.
 *
 * Every finite calculation is performed as an exact BigInt rational and is
 * rounded once to the destination format. JavaScript Number and host Math
 * functions are deliberately absent from the authoritative result path.
 */

export type CsFloatFormat = "binary32" | "binary64";

export const csFloatStatus = Object.freeze({
  divideByZero: 1 << 1,
  inexact: 1 << 4,
  invalid: 1 << 0,
  overflow: 1 << 2,
  underflow: 1 << 3,
});

export interface CsFloatResult {
  readonly bits: bigint;
  readonly status: number;
}

export interface CsFloatIntegerResult {
  readonly status: number;
  readonly value: bigint;
}

export interface CsFloatFrexpResult extends CsFloatResult {
  readonly exponent: number;
}

export interface CsFloatModfResult {
  readonly fraction: CsFloatResult;
  readonly integer: CsFloatResult;
}

export type CsFloatComparison = "eq" | "ge" | "gt" | "le" | "lt" | "ne";

interface FloatSpecification {
  readonly bias: number;
  readonly exponentBits: number;
  readonly fractionBits: number;
  readonly totalBits: number;
}

interface FloatParts {
  readonly exponentField: bigint;
  readonly fraction: bigint;
  readonly kind: "finite" | "infinity" | "nan" | "zero";
  readonly negative: boolean;
  readonly significand: bigint;
  readonly valueExponent: number;
}

const specifications: Readonly<Record<CsFloatFormat, FloatSpecification>> =
  Object.freeze({
    binary32: Object.freeze({
      bias: 127,
      exponentBits: 8,
      fractionBits: 23,
      totalBits: 32,
    }),
    binary64: Object.freeze({
      bias: 1_023,
      exponentBits: 11,
      fractionBits: 52,
      totalBits: 64,
    }),
  });

const maximumLiteralCharacters = 128;
const maximumLiteralDigits = 96;
const maximumLiteralExponent = 4_096;
const maximumLdexpMagnitude = 4_096;
const maximumFixedPrecision = 18;

export function csFloatCanonicalNaN(format: CsFloatFormat): bigint {
  const specification = specifications[format];
  const exponent = (1n << BigInt(specification.exponentBits)) - 1n;
  const quiet = 1n << BigInt(specification.fractionBits - 1);
  return (exponent << BigInt(specification.fractionBits)) | quiet;
}

export function csFloatPositiveInfinity(format: CsFloatFormat): bigint {
  const specification = specifications[format];
  return (
    ((1n << BigInt(specification.exponentBits)) - 1n) <<
    BigInt(specification.fractionBits)
  );
}

export function csFloatNegativeZero(format: CsFloatFormat): bigint {
  return 1n << BigInt(specifications[format].totalBits - 1);
}

export function csFloatClassify(
  format: CsFloatFormat,
  bits: bigint,
): "infinite" | "nan" | "normal" | "subnormal" | "zero" {
  const parts = unpack(format, bits);
  if (parts.kind === "infinity") return "infinite";
  if (parts.kind === "nan") return "nan";
  if (parts.kind === "zero") return "zero";
  return parts.exponentField === 0n ? "subnormal" : "normal";
}

export function csFloatSignBit(format: CsFloatFormat, bits: bigint): boolean {
  return unpack(format, bits).negative;
}

export function csFloatAbs(format: CsFloatFormat, bits: bigint): CsFloatResult {
  const specification = specifications[format];
  const result =
    normalizeBits(format, bits) &
    ((1n << BigInt(specification.totalBits - 1)) - 1n);
  return {
    bits:
      csFloatClassify(format, result) === "nan"
        ? csFloatCanonicalNaN(format)
        : result,
    status: 0,
  };
}

export function csFloatCopySign(
  format: CsFloatFormat,
  magnitude: bigint,
  sign: bigint,
): CsFloatResult {
  const signMask = 1n << BigInt(specifications[format].totalBits - 1);
  const result =
    (normalizeBits(format, magnitude) & ~signMask) |
    (normalizeBits(format, sign) & signMask);
  const classified = unpack(format, result);
  return {
    bits:
      classified.kind === "nan"
        ? csFloatCanonicalNaN(format) | (result & signMask)
        : result,
    status: 0,
  };
}

export function csFloatNegate(
  format: CsFloatFormat,
  bits: bigint,
): CsFloatResult {
  const signMask = 1n << BigInt(specifications[format].totalBits - 1);
  const normalized = normalizeBits(format, bits);
  return {
    bits:
      unpack(format, normalized).kind === "nan"
        ? csFloatCanonicalNaN(format)
        : normalized ^ signMask,
    status: 0,
  };
}

export function csFloatAdd(
  format: CsFloatFormat,
  leftBits: bigint,
  rightBits: bigint,
): CsFloatResult {
  return addOrSubtract(format, leftBits, rightBits, false);
}

export function csFloatSubtract(
  format: CsFloatFormat,
  leftBits: bigint,
  rightBits: bigint,
): CsFloatResult {
  return addOrSubtract(format, leftBits, rightBits, true);
}

export function csFloatMultiply(
  format: CsFloatFormat,
  leftBits: bigint,
  rightBits: bigint,
): CsFloatResult {
  const left = unpack(format, leftBits);
  const right = unpack(format, rightBits);
  if (left.kind === "nan" || right.kind === "nan") return nanResult(format, 0);
  const negative = left.negative !== right.negative;
  if (
    (left.kind === "infinity" && right.kind === "zero") ||
    (left.kind === "zero" && right.kind === "infinity")
  )
    return nanResult(format, csFloatStatus.invalid);
  if (left.kind === "infinity" || right.kind === "infinity")
    return infinityResult(format, negative, 0);
  if (left.kind === "zero" || right.kind === "zero")
    return { bits: signedZero(format, negative), status: 0 };
  return packFinite(
    format,
    negative,
    left.significand * right.significand,
    1n,
    left.valueExponent + right.valueExponent,
  );
}

export function csFloatDivide(
  format: CsFloatFormat,
  numeratorBits: bigint,
  denominatorBits: bigint,
): CsFloatResult {
  const numerator = unpack(format, numeratorBits);
  const denominator = unpack(format, denominatorBits);
  if (numerator.kind === "nan" || denominator.kind === "nan")
    return nanResult(format, 0);
  const negative = numerator.negative !== denominator.negative;
  if (
    (numerator.kind === "zero" && denominator.kind === "zero") ||
    (numerator.kind === "infinity" && denominator.kind === "infinity")
  )
    return nanResult(format, csFloatStatus.invalid);
  if (numerator.kind === "infinity") return infinityResult(format, negative, 0);
  if (denominator.kind === "infinity")
    return { bits: signedZero(format, negative), status: 0 };
  if (denominator.kind === "zero")
    return infinityResult(format, negative, csFloatStatus.divideByZero);
  if (numerator.kind === "zero")
    return { bits: signedZero(format, negative), status: 0 };
  return packFinite(
    format,
    negative,
    numerator.significand,
    denominator.significand,
    numerator.valueExponent - denominator.valueExponent,
  );
}

export function csFloatRemainder(
  format: CsFloatFormat,
  leftBits: bigint,
  rightBits: bigint,
): CsFloatResult {
  const left = unpack(format, leftBits);
  const right = unpack(format, rightBits);
  if (
    left.kind === "nan" ||
    right.kind === "nan" ||
    left.kind === "infinity" ||
    right.kind === "zero"
  )
    return nanResult(format, csFloatStatus.invalid);
  if (left.kind === "zero" || right.kind === "infinity")
    return { bits: normalizeBits(format, leftBits), status: 0 };
  const commonExponent =
    left.valueExponent < right.valueExponent
      ? left.valueExponent
      : right.valueExponent;
  const leftInteger =
    left.significand << BigInt(left.valueExponent - commonExponent);
  const rightInteger =
    right.significand << BigInt(right.valueExponent - commonExponent);
  const remainder = leftInteger % rightInteger;
  if (remainder === 0n)
    return { bits: signedZero(format, left.negative), status: 0 };
  return packFinite(format, left.negative, remainder, 1n, commonExponent);
}

export function csFloatCompare(
  format: CsFloatFormat,
  leftBits: bigint,
  rightBits: bigint,
  operation: CsFloatComparison,
): { readonly status: number; readonly value: boolean } {
  const left = unpack(format, leftBits);
  const right = unpack(format, rightBits);
  if (left.kind === "nan" || right.kind === "nan")
    return { status: 0, value: operation === "ne" };
  const order = compareOrdered(left, right);
  const value = {
    eq: order === 0,
    ge: order >= 0,
    gt: order > 0,
    le: order <= 0,
    lt: order < 0,
    ne: order !== 0,
  }[operation];
  return { status: 0, value };
}

export function csFloatFromSignedInteger(
  format: CsFloatFormat,
  value: bigint,
): CsFloatResult {
  return packFinite(format, value < 0n, absolute(value), 1n, 0);
}

export function csFloatFromUnsignedInteger(
  format: CsFloatFormat,
  value: bigint,
): CsFloatResult {
  if (value < 0n) throw new RangeError("unsigned float conversion is negative");
  return packFinite(format, false, value, 1n, 0);
}

export function csFloatToSignedInteger(
  format: CsFloatFormat,
  bits: bigint,
  width: 32 | 64,
): CsFloatIntegerResult {
  return floatToInteger(format, bits, width, true);
}

export function csFloatToUnsignedInteger(
  format: CsFloatFormat,
  bits: bigint,
  width: 32 | 64,
): CsFloatIntegerResult {
  return floatToInteger(format, bits, width, false);
}

export function csFloatConvert(
  source: CsFloatFormat,
  destination: CsFloatFormat,
  bits: bigint,
): CsFloatResult {
  const parts = unpack(source, bits);
  if (parts.kind === "nan") return nanResult(destination, 0);
  if (parts.kind === "infinity")
    return infinityResult(destination, parts.negative, 0);
  if (parts.kind === "zero")
    return { bits: signedZero(destination, parts.negative), status: 0 };
  return packFinite(
    destination,
    parts.negative,
    parts.significand,
    1n,
    parts.valueExponent,
  );
}

export function csFloatTrunc(
  format: CsFloatFormat,
  bits: bigint,
): CsFloatResult {
  return integralRound(format, bits, "trunc");
}

export function csFloatFloor(
  format: CsFloatFormat,
  bits: bigint,
): CsFloatResult {
  return integralRound(format, bits, "floor");
}

export function csFloatCeil(
  format: CsFloatFormat,
  bits: bigint,
): CsFloatResult {
  return integralRound(format, bits, "ceil");
}

/** C round(): nearest integer, halfway cases away from zero. */
export function csFloatRound(
  format: CsFloatFormat,
  bits: bigint,
): CsFloatResult {
  return integralRound(format, bits, "round");
}

export function csFloatLdexp(
  format: CsFloatFormat,
  bits: bigint,
  exponent: number,
): CsFloatResult {
  if (
    !Number.isSafeInteger(exponent) ||
    exponent < -maximumLdexpMagnitude ||
    exponent > maximumLdexpMagnitude
  )
    return exponent < 0
      ? {
          bits: signedZero(format, csFloatSignBit(format, bits)),
          status: csFloatStatus.underflow | csFloatStatus.inexact,
        }
      : infinityResult(
          format,
          csFloatSignBit(format, bits),
          csFloatStatus.overflow | csFloatStatus.inexact,
        );
  const parts = unpack(format, bits);
  if (parts.kind !== "finite")
    return parts.kind === "nan"
      ? nanResult(format, 0)
      : { bits: normalizeBits(format, bits), status: 0 };
  return packFinite(
    format,
    parts.negative,
    parts.significand,
    1n,
    parts.valueExponent + exponent,
  );
}

export function csFloatFrexp(
  format: CsFloatFormat,
  bits: bigint,
): CsFloatFrexpResult {
  const parts = unpack(format, bits);
  if (parts.kind !== "finite")
    return {
      bits:
        parts.kind === "nan"
          ? csFloatCanonicalNaN(format)
          : normalizeBits(format, bits),
      exponent: 0,
      status: 0,
    };
  const exponent =
    floorLog2Ratio(parts.significand, 1n) + parts.valueExponent + 1;
  const fraction = packFinite(
    format,
    parts.negative,
    parts.significand,
    1n,
    parts.valueExponent - exponent,
  );
  return { ...fraction, exponent };
}

export function csFloatModf(
  format: CsFloatFormat,
  bits: bigint,
): CsFloatModfResult {
  const parts = unpack(format, bits);
  if (parts.kind === "nan") {
    const result = nanResult(format, 0);
    return { fraction: result, integer: result };
  }
  if (parts.kind === "infinity")
    return {
      fraction: { bits: signedZero(format, parts.negative), status: 0 },
      integer: { bits: normalizeBits(format, bits), status: 0 },
    };
  const integer = csFloatTrunc(format, bits);
  const fraction = csFloatSubtract(format, bits, integer.bits);
  return {
    fraction:
      csFloatClassify(format, fraction.bits) === "zero"
        ? { bits: signedZero(format, parts.negative), status: fraction.status }
        : fraction,
    integer,
  };
}

export function csFloatSqrt(
  format: CsFloatFormat,
  bits: bigint,
): CsFloatResult {
  const parts = unpack(format, bits);
  if (parts.kind === "nan") return nanResult(format, 0);
  if (parts.kind === "infinity")
    return parts.negative
      ? nanResult(format, csFloatStatus.invalid)
      : { bits: normalizeBits(format, bits), status: 0 };
  if (parts.kind === "zero")
    return { bits: normalizeBits(format, bits), status: 0 };
  if (parts.negative) return nanResult(format, csFloatStatus.invalid);

  const specification = specifications[format];
  const valueExponent =
    floorLog2Ratio(parts.significand, 1n) + parts.valueExponent;
  let resultExponent = floorDivideByTwo(valueExponent);
  let unitExponent = resultExponent - specification.fractionBits;
  let ratioNumerator = parts.significand;
  let ratioDenominator = 1n;
  const scale = parts.valueExponent - 2 * unitExponent;
  if (scale >= 0) ratioNumerator <<= BigInt(scale);
  else ratioDenominator <<= BigInt(-scale);
  let significand = integerSquareRoot(ratioNumerator / ratioDenominator);
  const midpoint = 2n * significand + 1n;
  const midpointComparison =
    4n * ratioNumerator - ratioDenominator * midpoint * midpoint;
  if (
    midpointComparison > 0n ||
    (midpointComparison === 0n && (significand & 1n) !== 0n)
  )
    significand += 1n;
  const precisionCarry = 1n << BigInt(specification.fractionBits + 1);
  if (significand === precisionCarry) {
    significand >>= 1n;
    resultExponent += 1;
    unitExponent += 1;
  }
  const exponentField = BigInt(resultExponent + specification.bias);
  const fraction = significand - (1n << BigInt(specification.fractionBits));
  const exact = significand * significand * ratioDenominator === ratioNumerator;
  return {
    bits:
      (exponentField << BigInt(specification.fractionBits)) |
      (fraction & ((1n << BigInt(specification.fractionBits)) - 1n)),
    status: exact ? 0 : csFloatStatus.inexact,
  };
}

/** Parses a bounded decimal or hexadecimal C floating literal exactly. */
export function parseCsFloatLiteral(raw: string): {
  readonly format: CsFloatFormat;
  readonly result: CsFloatResult;
} {
  if (raw.length < 1 || raw.length > maximumLiteralCharacters)
    throw new RangeError("floating literal length limit exceeded");
  const suffix = /[fFlL]$/u.test(raw) ? raw.slice(-1).toLowerCase() : "";
  const body = suffix === "" ? raw : raw.slice(0, -1);
  const format: CsFloatFormat = suffix === "f" ? "binary32" : "binary64";
  if (body.startsWith("0x") || body.startsWith("0X")) {
    const match =
      /^0[xX]([0-9A-Fa-f]*)(?:\.([0-9A-Fa-f]*))?[pP]([+-]?\d+)$/u.exec(body);
    if (match === null || `${match[1]}${match[2] ?? ""}`.length === 0)
      throw new RangeError("invalid hexadecimal floating literal");
    const whole = match[1]!;
    const fraction = match[2] ?? "";
    const digits = `${whole}${fraction}`;
    if (digits.length > maximumLiteralDigits)
      throw new RangeError("floating literal digit limit exceeded");
    const exponent = boundedExponent(match[3]!);
    const numerator = BigInt(`0x${digits}`);
    return {
      format,
      result: packFinite(
        format,
        false,
        numerator,
        1n,
        exponent - fraction.length * 4,
      ),
    };
  }
  const match = /^(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:[eE]([+-]?\d+))?$/u.exec(
    body,
  );
  if (match === null) throw new RangeError("invalid decimal floating literal");
  const whole = match[1] ?? "";
  const fraction = match[2] ?? match[3] ?? "";
  const digits = `${whole}${fraction}`;
  if (digits.length < 1 || digits.length > maximumLiteralDigits)
    throw new RangeError("floating literal digit limit exceeded");
  const exponent = boundedExponent(match[4] ?? "0") - fraction.length;
  const numerator = BigInt(digits);
  const decimalPower = powerOfTen(absoluteNumber(exponent));
  return {
    format,
    result:
      exponent >= 0
        ? packFinite(format, false, numerator * decimalPower, 1n, 0)
        : packFinite(format, false, numerator, decimalPower, 0),
  };
}

/** Exact, bounded fixed-decimal rendering used by guest printf wrappers. */
export function csFloatToFixedDecimal(
  format: CsFloatFormat,
  bits: bigint,
  precision: number,
): string {
  if (
    !Number.isSafeInteger(precision) ||
    precision < 0 ||
    precision > maximumFixedPrecision
  )
    throw new RangeError("floating fixed precision limit exceeded");
  const parts = unpack(format, bits);
  if (parts.kind === "nan") return "nan";
  if (parts.kind === "infinity") return parts.negative ? "-inf" : "inf";
  const scale = powerOfTen(precision);
  let numerator = parts.significand * scale;
  let denominator = 1n;
  if (parts.valueExponent >= 0) numerator <<= BigInt(parts.valueExponent);
  else denominator <<= BigInt(-parts.valueExponent);
  const rounded = roundQuotient(numerator, denominator).value;
  const whole = rounded / scale;
  const fraction = rounded % scale;
  const sign = parts.negative ? "-" : "";
  if (precision === 0) return `${sign}${whole.toString()}`;
  return `${sign}${whole.toString()}.${fraction.toString().padStart(precision, "0")}`;
}

function addOrSubtract(
  format: CsFloatFormat,
  leftBits: bigint,
  rightBits: bigint,
  subtract: boolean,
): CsFloatResult {
  const left = unpack(format, leftBits);
  const rawRight = unpack(format, rightBits);
  const right: FloatParts = subtract
    ? { ...rawRight, negative: !rawRight.negative }
    : rawRight;
  if (left.kind === "nan" || right.kind === "nan") return nanResult(format, 0);
  if (left.kind === "infinity" || right.kind === "infinity") {
    if (
      left.kind === "infinity" &&
      right.kind === "infinity" &&
      left.negative !== right.negative
    )
      return nanResult(format, csFloatStatus.invalid);
    const selected = left.kind === "infinity" ? left : right;
    return infinityResult(format, selected.negative, 0);
  }
  if (left.kind === "zero" && right.kind === "zero")
    return {
      bits: signedZero(format, left.negative && right.negative),
      status: 0,
    };
  if (left.kind === "zero")
    return {
      bits: applySign(format, normalizeBits(format, rightBits), right.negative),
      status: 0,
    };
  if (right.kind === "zero")
    return { bits: normalizeBits(format, leftBits), status: 0 };
  const exponent =
    left.valueExponent < right.valueExponent
      ? left.valueExponent
      : right.valueExponent;
  const leftInteger =
    (left.negative ? -left.significand : left.significand) <<
    BigInt(left.valueExponent - exponent);
  const rightInteger =
    (right.negative ? -right.significand : right.significand) <<
    BigInt(right.valueExponent - exponent);
  const sum = leftInteger + rightInteger;
  if (sum === 0n) return { bits: 0n, status: 0 };
  return packFinite(format, sum < 0n, absolute(sum), 1n, exponent);
}

function floatToInteger(
  format: CsFloatFormat,
  bits: bigint,
  width: 32 | 64,
  signed: boolean,
): CsFloatIntegerResult {
  const parts = unpack(format, bits);
  const minimum = signed ? -(1n << BigInt(width - 1)) : 0n;
  const maximum = signed
    ? (1n << BigInt(width - 1)) - 1n
    : (1n << BigInt(width)) - 1n;
  if (parts.kind === "nan" || parts.kind === "infinity")
    return {
      status: csFloatStatus.invalid,
      value: parts.negative ? minimum : maximum,
    };
  let magnitude = parts.significand;
  let discarded = false;
  if (parts.valueExponent >= 0) magnitude <<= BigInt(parts.valueExponent);
  else {
    const shift = -parts.valueExponent;
    const mask = (1n << BigInt(shift)) - 1n;
    discarded = (magnitude & mask) !== 0n;
    magnitude >>= BigInt(shift);
  }
  const value = parts.negative ? -magnitude : magnitude;
  if (value < minimum || value > maximum)
    return {
      status: csFloatStatus.invalid,
      value: value < minimum ? minimum : maximum,
    };
  return {
    status: discarded ? csFloatStatus.inexact : 0,
    value,
  };
}

function integralRound(
  format: CsFloatFormat,
  bits: bigint,
  mode: "ceil" | "floor" | "round" | "trunc",
): CsFloatResult {
  const parts = unpack(format, bits);
  if (parts.kind === "nan") return nanResult(format, 0);
  if (parts.kind !== "finite")
    return { bits: normalizeBits(format, bits), status: 0 };
  if (parts.valueExponent >= 0)
    return { bits: normalizeBits(format, bits), status: 0 };
  const shift = -parts.valueExponent;
  const denominator = 1n << BigInt(shift);
  let integer = parts.significand / denominator;
  const remainder = parts.significand % denominator;
  if (remainder !== 0n) {
    if (mode === "floor" && parts.negative) integer += 1n;
    else if (mode === "ceil" && !parts.negative) integer += 1n;
    else if (mode === "round" && remainder * 2n >= denominator) integer += 1n;
  }
  if (integer === 0n)
    return {
      bits: signedZero(format, parts.negative),
      status: remainder === 0n ? 0 : csFloatStatus.inexact,
    };
  const result = packFinite(format, parts.negative, integer, 1n, 0);
  return {
    bits: result.bits,
    status: result.status | (remainder === 0n ? 0 : csFloatStatus.inexact),
  };
}

function compareOrdered(left: FloatParts, right: FloatParts): -1 | 0 | 1 {
  if (left.kind === "zero" && right.kind === "zero") return 0;
  if (left.negative !== right.negative) return left.negative ? -1 : 1;
  if (left.kind === "infinity" || right.kind === "infinity") {
    if (left.kind === right.kind) return 0;
    const order = left.kind === "infinity" ? 1 : -1;
    return left.negative ? (order === 1 ? -1 : 1) : order;
  }
  const exponent =
    left.valueExponent < right.valueExponent
      ? left.valueExponent
      : right.valueExponent;
  const leftInteger = left.significand << BigInt(left.valueExponent - exponent);
  const rightInteger =
    right.significand << BigInt(right.valueExponent - exponent);
  const magnitudeOrder =
    leftInteger === rightInteger ? 0 : leftInteger < rightInteger ? -1 : 1;
  return left.negative
    ? magnitudeOrder === 0
      ? 0
      : magnitudeOrder === 1
        ? -1
        : 1
    : magnitudeOrder;
}

function packFinite(
  format: CsFloatFormat,
  negative: boolean,
  numerator: bigint,
  denominator: bigint,
  exponent: number,
): CsFloatResult {
  if (numerator < 0n || denominator <= 0n)
    throw new RangeError("invalid finite floating rational");
  if (numerator === 0n)
    return { bits: signedZero(format, negative), status: 0 };
  const specification = specifications[format];
  const minimumNormalExponent = 1 - specification.bias;
  const maximumNormalExponent = specification.bias;
  let valueExponent = floorLog2Ratio(numerator, denominator) + exponent;
  if (valueExponent > maximumNormalExponent)
    return infinityResult(
      format,
      negative,
      csFloatStatus.overflow | csFloatStatus.inexact,
    );
  const sign = negative ? 1n << BigInt(specification.totalBits - 1) : 0n;
  const hidden = 1n << BigInt(specification.fractionBits);
  if (valueExponent >= minimumNormalExponent) {
    const rounded = roundScaledQuotient(
      numerator,
      denominator,
      exponent + specification.fractionBits - valueExponent,
    );
    let significand = rounded.value;
    if (significand === hidden << 1n) {
      significand >>= 1n;
      valueExponent += 1;
    }
    if (valueExponent > maximumNormalExponent)
      return infinityResult(
        format,
        negative,
        csFloatStatus.overflow | csFloatStatus.inexact,
      );
    const exponentField = BigInt(valueExponent + specification.bias);
    return {
      bits:
        sign |
        (exponentField << BigInt(specification.fractionBits)) |
        (significand - hidden),
      status: rounded.inexact ? csFloatStatus.inexact : 0,
    };
  }
  const subnormalExponent = minimumNormalExponent - specification.fractionBits;
  const rounded = roundScaledQuotient(
    numerator,
    denominator,
    exponent - subnormalExponent,
  );
  if (rounded.value === 0n)
    return {
      bits: sign,
      status:
        csFloatStatus.underflow | (rounded.inexact ? csFloatStatus.inexact : 0),
    };
  if (rounded.value >= hidden)
    return {
      bits: sign | (1n << BigInt(specification.fractionBits)),
      status: rounded.inexact
        ? csFloatStatus.underflow | csFloatStatus.inexact
        : 0,
    };
  return {
    bits: sign | rounded.value,
    status: rounded.inexact
      ? csFloatStatus.underflow | csFloatStatus.inexact
      : 0,
  };
}

function unpack(format: CsFloatFormat, rawBits: bigint): FloatParts {
  const specification = specifications[format];
  const bits = normalizeBits(format, rawBits);
  const fractionMask = (1n << BigInt(specification.fractionBits)) - 1n;
  const exponentMask = (1n << BigInt(specification.exponentBits)) - 1n;
  const fraction = bits & fractionMask;
  const exponentField =
    (bits >> BigInt(specification.fractionBits)) & exponentMask;
  const negative = (bits & (1n << BigInt(specification.totalBits - 1))) !== 0n;
  if (exponentField === exponentMask)
    return {
      exponentField,
      fraction,
      kind: fraction === 0n ? "infinity" : "nan",
      negative,
      significand: 0n,
      valueExponent: 0,
    };
  if (exponentField === 0n && fraction === 0n)
    return {
      exponentField,
      fraction,
      kind: "zero",
      negative,
      significand: 0n,
      valueExponent: 0,
    };
  if (exponentField === 0n)
    return {
      exponentField,
      fraction,
      kind: "finite",
      negative,
      significand: fraction,
      valueExponent: 1 - specification.bias - specification.fractionBits,
    };
  return {
    exponentField,
    fraction,
    kind: "finite",
    negative,
    significand: (1n << BigInt(specification.fractionBits)) | fraction,
    valueExponent:
      Number(exponentField) - specification.bias - specification.fractionBits,
  };
}

function normalizeBits(format: CsFloatFormat, bits: bigint): bigint {
  return bits & ((1n << BigInt(specifications[format].totalBits)) - 1n);
}

function signedZero(format: CsFloatFormat, negative: boolean): bigint {
  return negative ? csFloatNegativeZero(format) : 0n;
}

function applySign(
  format: CsFloatFormat,
  bits: bigint,
  negative: boolean,
): bigint {
  const sign = 1n << BigInt(specifications[format].totalBits - 1);
  return negative ? bits | sign : bits & ~sign;
}

function infinityResult(
  format: CsFloatFormat,
  negative: boolean,
  status: number,
): CsFloatResult {
  return {
    bits: applySign(format, csFloatPositiveInfinity(format), negative),
    status,
  };
}

function nanResult(format: CsFloatFormat, status: number): CsFloatResult {
  return { bits: csFloatCanonicalNaN(format), status };
}

function roundScaledQuotient(
  numerator: bigint,
  denominator: bigint,
  binaryShift: number,
): { readonly inexact: boolean; readonly value: bigint } {
  return binaryShift >= 0
    ? roundQuotient(numerator << BigInt(binaryShift), denominator)
    : roundQuotient(numerator, denominator << BigInt(-binaryShift));
}

function roundQuotient(
  numerator: bigint,
  denominator: bigint,
): { readonly inexact: boolean; readonly value: bigint } {
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  const comparison = remainder * 2n - denominator;
  return {
    inexact: remainder !== 0n,
    value:
      comparison > 0n || (comparison === 0n && (quotient & 1n) !== 0n)
        ? quotient + 1n
        : quotient,
  };
}

function floorLog2Ratio(numerator: bigint, denominator: bigint): number {
  let exponent = bitLength(numerator) - bitLength(denominator);
  const smaller =
    exponent >= 0
      ? numerator < denominator << BigInt(exponent)
      : numerator << BigInt(-exponent) < denominator;
  if (smaller) exponent -= 1;
  return exponent;
}

function bitLength(value: bigint): number {
  if (value <= 0n) throw new RangeError("bit length requires a positive value");
  return value.toString(2).length;
}

function integerSquareRoot(value: bigint): bigint {
  if (value < 0n)
    throw new RangeError("square root requires a nonnegative value");
  if (value < 2n) return value;
  let current = 1n << BigInt((bitLength(value) + 1) >> 1);
  for (let iteration = 0; iteration < 128; iteration += 1) {
    const next = (current + value / current) >> 1n;
    if (next >= current) return current;
    current = next;
  }
  throw new RangeError("bounded integer square root did not converge");
}

function boundedExponent(raw: string): number {
  if (!/^[+-]?\d{1,5}$/u.test(raw))
    throw new RangeError("floating literal exponent is invalid or too long");
  let value = 0;
  const negative = raw.startsWith("-");
  const start = raw.startsWith("-") || raw.startsWith("+") ? 1 : 0;
  for (let index = start; index < raw.length; index += 1) {
    value = value * 10 + raw.charCodeAt(index) - 48;
    if (value > maximumLiteralExponent)
      throw new RangeError("floating literal exponent limit exceeded");
  }
  return negative ? -value : value;
}

function powerOfTen(exponent: number): bigint {
  let result = 1n;
  let base = 10n;
  let remaining = exponent;
  while (remaining > 0) {
    if ((remaining & 1) !== 0) result *= base;
    remaining >>= 1;
    if (remaining > 0) base *= base;
  }
  return result;
}

function absolute(value: bigint): bigint {
  return value < 0n ? -value : value;
}

function absoluteNumber(value: number): number {
  return value < 0 ? -value : value;
}

function floorDivideByTwo(value: number): number {
  return value >= 0 ? value >> 1 : -((-value + 1) >> 1);
}
