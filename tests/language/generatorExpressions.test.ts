import { describe, expect, it } from "vitest";

import { LanguageSyntaxError } from "../../src/domain/language/errors.js";
import { parse, parseExpression } from "../../src/domain/language/parser.js";
import { analyzeScopes } from "../../src/domain/language/scope.js";

describe("Computer System Python generator-expression syntax", (): void => {
  it("parses parenthesized and sole-call-argument generator expressions", (): void => {
    expect(parseExpression("(x * 2 for x in values if x > 0)")).toMatchObject({
      clauses: [
        { clauseKind: "for", target: { name: "x" } },
        { clauseKind: "if" },
      ],
      containerKind: "generator",
      element: { kind: "BinaryExpression" },
      kind: "ComprehensionExpression",
    });
    expect(parseExpression("consume(x for x in values)")).toMatchObject({
      arguments: [
        {
          argumentKind: "positional",
          value: {
            containerKind: "generator",
            kind: "ComprehensionExpression",
          },
        },
      ],
      kind: "CallExpression",
    });
  });

  it("uses one implicit scope and binds walrus targets in the containing scope", (): void => {
    const module = parse(`
def accumulate(values):
    total = 0
    cursor = (total := total + item for item in values if item)
    return cursor
`);
    const functionScope = analyzeScopes(module).root.children[0]!;
    const generatorScope = functionScope.children[0]!;

    expect(
      functionScope.symbols.find(({ name }) => name === "total"),
    ).toMatchObject({ assigned: true, binding: "cell" });
    expect(
      generatorScope.symbols.find(({ name }) => name === "total"),
    ).toMatchObject({ binding: "free", referenced: true });
    expect(
      generatorScope.symbols.find(({ name }) => name === "item"),
    ).toMatchObject({ assigned: true, binding: "local" });
    expect(functionScope.symbols.some(({ name }) => name === "item")).toBe(
      false,
    );
  });

  it.each([
    ["starred result", "(*x for x in values)"],
    ["extra call argument", "consume(x for x in values, other)"],
    ["assignment in leftmost iterable", "(x for x in (seen := values))"],
    ["yield in implicit scope", "((yield x) for x in values)"],
    ["yield from in implicit scope", "((yield from x) for x in values)"],
  ])("rejects invalid %s", (_name, expression): void => {
    expect(() => analyzeScopes(parse(`result = ${expression}\n`))).toThrow(
      LanguageSyntaxError,
    );
  });

  it("bounds clauses and the implicit scope at exact capacity", (): void => {
    const source = "(x + y for x in left for y in right)";
    expect(
      parseExpression(source, { parser: { maxItemsPerConstruct: 2 } }),
    ).toMatchObject({ containerKind: "generator" });
    expect(() =>
      parseExpression(source, { parser: { maxItemsPerConstruct: 1 } }),
    ).toThrow(/Construct item limit exceeded \(max 1\)/u);

    const module = parse("result = (x for x in values)\n");
    expect(() => analyzeScopes(module, { maxScopes: 2 })).not.toThrow();
    expect(() => analyzeScopes(module, { maxScopes: 1 })).toThrow(
      /Scope count limit exceeded \(max 1\)/u,
    );
  });
});
