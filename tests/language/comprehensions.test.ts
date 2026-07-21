import { describe, expect, it } from "vitest";

import { LanguageSyntaxError } from "../../src/domain/language/errors.js";
import { parse, parseExpression } from "../../src/domain/language/parser.js";
import { analyzeScopes } from "../../src/domain/language/scope.js";

describe("Computer System Python set and comprehension syntax", (): void => {
  it("distinguishes set displays from dictionaries and parses all eager comprehensions", (): void => {
    expect(parseExpression("{}")).toMatchObject({
      kind: "DictionaryExpression",
      entries: [],
    });
    expect(parseExpression("{1, 2, *items}")).toMatchObject({
      kind: "SetExpression",
      elements: [
        { kind: "LiteralExpression" },
        { kind: "LiteralExpression" },
        { kind: "StarredExpression" },
      ],
    });
    expect(parseExpression("[x * 2 for x in values if x > 0]")).toMatchObject({
      kind: "ComprehensionExpression",
      containerKind: "list",
      element: { kind: "BinaryExpression" },
      clauses: [
        { clauseKind: "for", target: { name: "x" } },
        { clauseKind: "if", condition: { kind: "ComparisonExpression" } },
      ],
    });
    expect(parseExpression("{x for x in values}")).toMatchObject({
      kind: "ComprehensionExpression",
      containerKind: "set",
    });
    expect(
      parseExpression("{key: value for key, value in pairs}"),
    ).toMatchObject({
      kind: "ComprehensionExpression",
      containerKind: "dictionary",
      key: { name: "key" },
      value: { name: "value" },
      clauses: [
        {
          clauseKind: "for",
          target: {
            kind: "TupleExpression",
            elements: [{ name: "key" }, { name: "value" }],
          },
        },
      ],
    });
  });

  it("parses nested synchronous clauses and bounded sequence targets", (): void => {
    expect(
      parseExpression(
        "[head + tail for head, *middle, tail in rows for item in middle if item]",
      ),
    ).toMatchObject({
      kind: "ComprehensionExpression",
      clauses: [
        {
          clauseKind: "for",
          target: {
            kind: "TupleExpression",
            elements: [
              { name: "head" },
              { kind: "StarredExpression", value: { name: "middle" } },
              { name: "tail" },
            ],
          },
        },
        { clauseKind: "for", target: { name: "item" } },
        { clauseKind: "if" },
      ],
    });
  });

  it.each([
    ["starred result", "[*x for x in values]"],
    ["attribute target", "[x for object.value in values]"],
    ["bare starred target", "[x for *x in values]"],
    ["missing dictionary comma", "{1: 2 3: 4}"],
  ])("rejects the excluded or invalid %s", (_name, source): void => {
    expect(() => parseExpression(source)).toThrow(LanguageSyntaxError);
  });

  it.each([
    ["leftmost iterable", "[x for x in (seen := values)]"],
    ["later iterable", "[x + y for x in values for y in (seen := values)]"],
    [
      "lambda nested in an iterable",
      "[x for x in (lambda: (seen := values))()]",
    ],
    ["same target", "[x := 1 for x in values]"],
    [
      "enclosing target",
      "[[(outer := inner) for inner in values] for outer in values]",
    ],
  ])(
    "rejects assignment-expression conflicts in the %s",
    (_name, source): void => {
      expect(() => analyzeScopes(parse(`result = ${source}\n`))).toThrow(
        LanguageSyntaxError,
      );
    },
  );

  it("creates an implicit scope and exposes walrus targets to the containing function", (): void => {
    const analysis = analyzeScopes(
      parse(`
def accumulate(values):
    total = 0
    results = [total := total + item for item in values if item]
    return total
`),
    );
    const functionScope = analysis.root.children[0]!;
    const comprehensionScope = functionScope.children[0]!;

    expect(
      functionScope.symbols.find(({ name }) => name === "total"),
    ).toMatchObject({ assigned: true, binding: "cell" });
    expect(
      comprehensionScope.symbols.find(({ name }) => name === "total"),
    ).toMatchObject({ binding: "free", referenced: true });
    expect(
      comprehensionScope.symbols.find(({ name }) => name === "item"),
    ).toMatchObject({ assigned: true, binding: "local" });
    expect(functionScope.symbols.some(({ name }) => name === "item")).toBe(
      false,
    );
  });

  it("bounds comprehension clauses and implicit scopes at the exact ceiling", (): void => {
    const source = "[x + y for x in left for y in right]";
    expect(
      parseExpression(source, { parser: { maxItemsPerConstruct: 2 } }),
    ).toMatchObject({ kind: "ComprehensionExpression" });
    expect(() =>
      parseExpression(source, { parser: { maxItemsPerConstruct: 1 } }),
    ).toThrow(/Construct item limit exceeded \(max 1\)/u);

    const module = parse("result = [x for x in values]\n");
    expect(() => analyzeScopes(module, { maxScopes: 2 })).not.toThrow();
    expect(() => analyzeScopes(module, { maxScopes: 1 })).toThrow(
      /Scope count limit exceeded \(max 1\)/u,
    );
  });
});
