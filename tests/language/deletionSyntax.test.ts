import { describe, expect, it } from "vitest";

import { LanguageSyntaxError } from "../../src/domain/language/errors.js";
import { parse } from "../../src/domain/language/parser.js";
import { analyzeScopes } from "../../src/domain/language/scope.js";

describe("Computer System Python deletion syntax", (): void => {
  it("parses names, attributes, subscriptions, slices, and nested target lists", (): void => {
    const module = parse(`
del name
del item.value
del values[index]
del values[start:stop:step]
del (left, [middle, right])
`);

    expect(module.body.map(({ kind }) => kind)).toEqual([
      "DeleteStatement",
      "DeleteStatement",
      "DeleteStatement",
      "DeleteStatement",
      "DeleteStatement",
    ]);
    expect(module.body[0]).toMatchObject({
      kind: "DeleteStatement",
      target: { kind: "IdentifierExpression", name: "name" },
    });
    expect(module.body[4]).toMatchObject({
      kind: "DeleteStatement",
      target: {
        kind: "TupleExpression",
        elements: [
          { kind: "IdentifierExpression", name: "left" },
          {
            kind: "ListExpression",
            elements: [
              { kind: "IdentifierExpression", name: "middle" },
              { kind: "IdentifierExpression", name: "right" },
            ],
          },
        ],
      },
    });
  });

  it("classifies a deleted function name as local and collects target expressions", (): void => {
    const module = parse(`
def remove(container, index):
    del local
    del container[index]
`);
    const analysis = analyzeScopes(module);
    const functionScope = analysis.root.children[0]!;
    const symbols = new Map(
      functionScope.symbols.map((symbol) => [symbol.name, symbol]),
    );

    expect(symbols.get("local")).toMatchObject({
      assigned: true,
      binding: "local",
      referenced: false,
    });
    expect(symbols.get("container")).toMatchObject({
      parameter: true,
      referenced: true,
    });
    expect(symbols.get("index")).toMatchObject({
      parameter: true,
      referenced: true,
    });
  });

  it.each([
    ["literal", "del 1\n"],
    ["call", "del build()\n"],
    ["starred", "del *value\n"],
    ["nested starred", "del (left, *right)\n"],
    ["missing target", "del\n"],
  ])("rejects an invalid %s target", (_name, source): void => {
    expect(() => parse(source)).toThrow(LanguageSyntaxError);
  });
});
