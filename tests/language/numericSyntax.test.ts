import { describe, expect, it } from "vitest";

import { LanguageSyntaxError } from "../../src/domain/language/errors.js";
import { lex } from "../../src/domain/language/lexer.js";
import { parseExpression } from "../../src/domain/language/parser.js";

describe("Computer System Python numeric syntax", (): void => {
  it("lexes Python integer bases, grouping, floats, and arbitrary precision", (): void => {
    const tokens = lex(
      "0b_1010 0o_17 0x_FF 1_000 9007199254740993 .5 10. 1.25e+2\n",
    ).filter(({ kind }) => kind === "number");

    expect(tokens.map(({ literal }) => literal)).toEqual([
      10,
      15,
      255,
      1_000,
      9_007_199_254_740_993n,
      0.5,
      10,
      125,
    ]);
  });

  it("parses shift and bitwise precedence below arithmetic", (): void => {
    expect(parseExpression("1 | 2 ^ 3 & 4 << 1 + 1")).toMatchObject({
      kind: "BinaryExpression",
      operator: "|",
      right: {
        operator: "^",
        right: {
          operator: "&",
          right: {
            operator: "<<",
            right: { operator: "+" },
          },
        },
      },
    });
    expect(parseExpression("~value")).toMatchObject({
      kind: "UnaryExpression",
      operator: "~",
    });
  });

  it.each(["01", "1_", "1__0", "0b2", "0o8", "0x", "1e", ".1_"])(
    "rejects invalid numeric literal %s",
    (source): void => {
      expect(() => lex(`${source}\n`)).toThrow(LanguageSyntaxError);
      expect(() => lex(`${source}\n`)).toThrow(/Invalid numeric literal/u);
    },
  );
});
