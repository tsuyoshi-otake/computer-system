import { describe, expect, it } from "vitest";

import { LanguageSyntaxError } from "../../src/domain/language/errors.js";
import { parse } from "../../src/domain/language/parser.js";
import { analyzeScopes } from "../../src/domain/language/scope.js";

describe("Computer System Python assert syntax", (): void => {
  it("parses simple and message-bearing assertions", (): void => {
    const module = parse("assert ready\nassert value > 0, message\n");

    expect(module.body).toMatchObject([
      {
        kind: "AssertStatement",
        test: { kind: "IdentifierExpression", name: "ready" },
      },
      {
        kind: "AssertStatement",
        test: { kind: "ComparisonExpression" },
        message: { kind: "IdentifierExpression", name: "message" },
      },
    ]);
  });

  it("accepts a parenthesized assignment expression as the test", (): void => {
    expect(parse("assert (saved := source)\n").body[0]).toMatchObject({
      kind: "AssertStatement",
      test: { kind: "NamedExpression", target: { name: "saved" } },
    });
  });

  it.each([
    ["missing test", "assert\n"],
    ["missing message", "assert value,\n"],
    ["extra message", "assert value, first, second\n"],
    ["unparenthesized named test", "assert saved := source\n"],
  ])("rejects %s", (_name, source): void => {
    expect(() => parse(source)).toThrow(LanguageSyntaxError);
  });

  it.each([
    ["ordinary assignment", "__debug__ = False\n"],
    ["named assignment", "if (__debug__ := True):\n    pass\n"],
    ["parameter binding", "def check(__debug__):\n    pass\n"],
  ])("rejects __debug__ %s during scope analysis", (_name, source): void => {
    expect(() => analyzeScopes(parse(source))).toThrow(
      "cannot assign to __debug__",
    );
  });
});
