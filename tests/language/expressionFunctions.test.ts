import { describe, expect, it } from "vitest";

import { LanguageSyntaxError } from "../../src/domain/language/errors.js";
import { parse, parseExpression } from "../../src/domain/language/parser.js";
import { analyzeScopes } from "../../src/domain/language/scope.js";

describe("Computer System Python expression control flow", (): void => {
  it("parses right-associative conditional expressions", (): void => {
    expect(parseExpression("1 if first else 2 if second else 3")).toMatchObject(
      {
        kind: "ConditionalExpression",
        condition: { name: "first" },
        whenTrue: { value: 1 },
        whenFalse: {
          kind: "ConditionalExpression",
          condition: { name: "second" },
          whenTrue: { value: 2 },
          whenFalse: { value: 3 },
        },
      },
    );
  });

  it("reuses all five parameter kinds for lambda expressions", (): void => {
    expect(
      parseExpression(
        "lambda a, b=2, /, c=3, *values, required, optional=5, **named: a",
      ),
    ).toMatchObject({
      kind: "LambdaExpression",
      parameters: [
        { name: "a", parameterKind: "positional_only" },
        { name: "b", parameterKind: "positional_only" },
        { name: "c", parameterKind: "positional_or_keyword" },
        { name: "values", parameterKind: "variadic_positional" },
        { name: "required", parameterKind: "keyword_only" },
        { name: "optional", parameterKind: "keyword_only" },
        { name: "named", parameterKind: "variadic_keyword" },
      ],
      body: { name: "a" },
    });
  });

  it("creates bounded implicit function scopes for lambdas", (): void => {
    const exact = analyzeScopes(parse("value = lambda: lambda: captured\n"), {
      maxScopeNesting: 2,
      maxScopes: 3,
    });

    expect(exact.root.children).toHaveLength(1);
    expect(exact.root.children[0]).toMatchObject({ name: "<lambda>" });
    expect(exact.root.children[0]!.children[0]).toMatchObject({
      name: "<lambda>",
    });
    expect(() =>
      analyzeScopes(parse("value = lambda: lambda: lambda: 1\n"), {
        maxScopeNesting: 2,
      }),
    ).toThrow(/Scope nesting limit exceeded/u);
  });

  it("accepts the scope-count ceiling and rejects capacity plus one", (): void => {
    expect(() =>
      analyzeScopes(parse("first = lambda: 1\nsecond = lambda: 2\n"), {
        maxScopes: 3,
      }),
    ).not.toThrow();
    expect(() =>
      analyzeScopes(
        parse("first = lambda: 1\nsecond = lambda: 2\nthird = lambda: 3\n"),
        { maxScopes: 3 },
      ),
    ).toThrow(/Scope count limit exceeded/u);
  });

  it.each([
    ["missing conditional else", "value = 1 if condition\n"],
    ["missing lambda body", "value = lambda item:\n"],
    ["invalid lambda parameter", "value = lambda /: 1\n"],
  ])("rejects %s without producing a module", (_name, source): void => {
    expect(() => parse(source)).toThrow(LanguageSyntaxError);
  });
});
