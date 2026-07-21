import { describe, expect, it } from "vitest";

import {
  csFloatAbs,
  csFloatAdd,
  csFloatCanonicalNaN,
  csFloatCeil,
  csFloatClassify,
  csFloatCompare,
  csFloatConvert,
  csFloatCopySign,
  csFloatDivide,
  csFloatFloor,
  csFloatFromSignedInteger,
  csFloatLdexp,
  csFloatModf,
  csFloatMultiply,
  csFloatNegativeZero,
  csFloatPositiveInfinity,
  csFloatRemainder,
  csFloatRound,
  csFloatSqrt,
  csFloatStatus,
  csFloatSubtract,
  csFloatToFixedDecimal,
  csFloatToSignedInteger,
  csFloatTrunc,
  parseCsFloatLiteral,
} from "../../src/domain/cpu/deterministicFloat.js";

describe("deterministic CS486 software floating point", () => {
  it("parses decimal and hexadecimal golden vectors with ties-to-even", () => {
    expect(parseCsFloatLiteral("1.0f").result.bits).toBe(0x3f80_0000n);
    expect(parseCsFloatLiteral("0x1.8p+1f").result.bits).toBe(0x4040_0000n);
    expect(parseCsFloatLiteral("3.141592653589793").result.bits).toBe(
      0x4009_21fb_5444_2d18n,
    );
    expect(parseCsFloatLiteral("1.000000059604644775390625f").result.bits).toBe(
      0x3f80_0000n,
    );
    expect(parseCsFloatLiteral("1.000000178813934326171875f").result.bits).toBe(
      0x3f80_0002n,
    );
  });

  it("covers normal, subnormal, infinity, canonical NaN, and signed zero", () => {
    expect(
      parseCsFloatLiteral("1.401298464324817070923729583289916131280e-45f")
        .result.bits,
    ).toBe(1n);
    expect(parseCsFloatLiteral("1e-1000f").result.status).toBe(
      csFloatStatus.underflow | csFloatStatus.inexact,
    );
    expect(parseCsFloatLiteral("1e1000f").result.bits).toBe(
      csFloatPositiveInfinity("binary32"),
    );
    expect(csFloatClassify("binary32", 1n)).toBe("subnormal");
    expect(csFloatClassify("binary64", csFloatCanonicalNaN("binary64"))).toBe(
      "nan",
    );
    expect(csFloatClassify("binary64", csFloatNegativeZero("binary64"))).toBe(
      "zero",
    );
  });

  it("performs bit-exact arithmetic and special-value operations", () => {
    const one = 0x3ff0_0000_0000_0000n;
    const two = 0x4000_0000_0000_0000n;
    const three = 0x4008_0000_0000_0000n;
    expect(csFloatAdd("binary64", one, two).bits).toBe(three);
    expect(csFloatSubtract("binary64", three, one).bits).toBe(two);
    expect(csFloatMultiply("binary64", 0x3ff8_0000_0000_0000n, two).bits).toBe(
      three,
    );
    expect(csFloatDivide("binary64", three, two).bits).toBe(
      0x3ff8_0000_0000_0000n,
    );
    expect(csFloatRemainder("binary64", 0x4016_0000_0000_0000n, two).bits).toBe(
      0x3ff8_0000_0000_0000n,
    );
    expect(
      csFloatDivide("binary64", one, 0n).status & csFloatStatus.divideByZero,
    ).not.toBe(0);
    expect(
      csFloatMultiply("binary64", csFloatPositiveInfinity("binary64"), 0n).bits,
    ).toBe(csFloatCanonicalNaN("binary64"));
  });

  it("preserves comparison and signed-zero rules", () => {
    const positiveZero = 0n;
    const negativeZero = csFloatNegativeZero("binary32");
    expect(
      csFloatCompare("binary32", positiveZero, negativeZero, "eq").value,
    ).toBe(true);
    expect(
      csFloatCompare(
        "binary32",
        csFloatCanonicalNaN("binary32"),
        positiveZero,
        "ne",
      ).value,
    ).toBe(true);
    expect(csFloatAdd("binary32", negativeZero, negativeZero).bits).toBe(
      negativeZero,
    );
    expect(csFloatSubtract("binary32", positiveZero, positiveZero).bits).toBe(
      0n,
    );
    expect(csFloatCopySign("binary32", 0x3f80_0000n, negativeZero).bits).toBe(
      0xbf80_0000n,
    );
    expect(csFloatAbs("binary32", 0xbf80_0000n).bits).toBe(0x3f80_0000n);
  });

  it("converts integers and formats without host floating arithmetic", () => {
    expect(csFloatFromSignedInteger("binary32", 16_777_217n).bits).toBe(
      0x4b80_0000n,
    );
    expect(
      csFloatToSignedInteger("binary64", 0xc00e_0000_0000_0000n, 32),
    ).toEqual({ status: csFloatStatus.inexact, value: -3n });
    expect(csFloatConvert("binary32", "binary64", 0x3fc0_0000n).bits).toBe(
      0x3ff8_0000_0000_0000n,
    );
    expect(csFloatToFixedDecimal("binary64", 0x4009_21fb_5444_2d18n, 6)).toBe(
      "3.141593",
    );
    expect(csFloatToFixedDecimal("binary32", 0x8000_0000n, 2)).toBe("-0.00");
  });

  it("implements bounded integral helpers, decomposition, scaling, and sqrt", () => {
    const negativeThreePointFive = 0xc00c_0000_0000_0000n;
    expect(csFloatTrunc("binary64", negativeThreePointFive).bits).toBe(
      0xc008_0000_0000_0000n,
    );
    expect(csFloatFloor("binary64", negativeThreePointFive).bits).toBe(
      0xc010_0000_0000_0000n,
    );
    expect(csFloatCeil("binary64", negativeThreePointFive).bits).toBe(
      0xc008_0000_0000_0000n,
    );
    expect(csFloatRound("binary64", negativeThreePointFive).bits).toBe(
      0xc010_0000_0000_0000n,
    );
    expect(csFloatLdexp("binary64", 0x3ff8_0000_0000_0000n, 3).bits).toBe(
      0x4028_0000_0000_0000n,
    );
    const split = csFloatModf("binary64", negativeThreePointFive);
    expect(split.integer.bits).toBe(0xc008_0000_0000_0000n);
    expect(split.fraction.bits).toBe(0xbfe0_0000_0000_0000n);
    expect(csFloatSqrt("binary64", 0x4010_0000_0000_0000n).bits).toBe(
      0x4000_0000_0000_0000n,
    );
    expect(csFloatSqrt("binary64", 0x4000_0000_0000_0000n).bits).toBe(
      0x3ff6_a09e_667f_3bcdn,
    );
  });

  it("rejects unbounded or malformed literal work", () => {
    expect(() => parseCsFloatLiteral(`1.${"0".repeat(97)}`)).toThrow(
      /digit limit/u,
    );
    expect(() => parseCsFloatLiteral("1e4097")).toThrow(/exponent limit/u);
    expect(() => parseCsFloatLiteral("0x1.0")).toThrow(/hexadecimal/u);
  });
});
