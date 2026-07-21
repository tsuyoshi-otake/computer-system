import { describe, expect, it } from "vitest";

import { LanguageSyntaxError } from "../../src/domain/language/errors.js";
import { parse, parseExpression } from "../../src/domain/language/parser.js";

describe("Computer System Python slicing syntax", (): void => {
  it.each([
    ["values[:]", undefined, undefined, undefined],
    ["values[1:]", 1, undefined, undefined],
    ["values[:3]", undefined, 3, undefined],
    ["values[1:4:2]", 1, 4, 2],
    ["values[::-1]", undefined, undefined, -1],
  ])("parses %s", (source, start, stop, step): void => {
    expect(parseExpression(source)).toMatchObject({
      kind: "SliceExpression",
      ...(start === undefined ? {} : { start: { value: start } }),
      ...(stop === undefined ? {} : { stop: { value: stop } }),
      ...(step === undefined
        ? {}
        : step < 0
          ? {
              step: {
                kind: "UnaryExpression",
                operator: "-",
                operand: { value: -step },
              },
            }
          : { step: { value: step } }),
    });
  });

  it("accepts a slice as an ordinary assignment target", (): void => {
    expect(parse("values[1:3] = replacement\n").body[0]).toMatchObject({
      kind: "AssignmentStatement",
      targets: [{ kind: "SliceExpression" }],
    });
  });

  it.each([
    ["empty subscript", "values[]\n"],
    ["too many separators", "values[1:2:3:4]\n"],
    ["augmented slice", "values[1:2] += replacement\n"],
  ])("rejects %s", (_name, source): void => {
    expect(() => parse(source)).toThrow(LanguageSyntaxError);
  });
});
