import { describe, expect, it } from "vitest";

import { LanguageSyntaxError } from "../../src/domain/language/errors.js";
import { parse } from "../../src/domain/language/parser.js";
import { analyzeScopes } from "../../src/domain/language/scope.js";

describe("Computer System Python context-manager syntax", (): void => {
  it("parses single, multiple, parenthesized, and destructuring with items", (): void => {
    const module = parse(`
with manager as value:
    pass
with first as [left, right], second:
    pass
with (
    third as nested,
    fourth,
):
    pass
`);

    expect(module.body[0]).toMatchObject({
      items: [
        {
          context: { name: "manager" },
          target: { name: "value" },
        },
      ],
      kind: "WithStatement",
    });
    expect(module.body[1]).toMatchObject({
      items: [
        {
          context: { name: "first" },
          target: {
            elements: [{ name: "left" }, { name: "right" }],
            kind: "ListExpression",
          },
        },
        { context: { name: "second" }, target: undefined },
      ],
      kind: "WithStatement",
    });
    expect(module.body[2]).toMatchObject({
      items: [
        { context: { name: "third" }, target: { name: "nested" } },
        { context: { name: "fourth" } },
      ],
      kind: "WithStatement",
    });
  });

  it("collects contexts before assignment targets and the body", (): void => {
    const module = parse(`
def run(manager, other):
    with manager as value, other as [left, right]:
        result = value + left + right
    return result
`);
    const definition = module.body[0];
    expect(definition?.kind).toBe("FunctionDefinition");
    if (definition?.kind !== "FunctionDefinition") return;
    const scope = analyzeScopes(module).functionScopes.get(definition);
    expect(scope?.symbols).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ binding: "local", name: "manager" }),
        expect.objectContaining({ binding: "local", name: "other" }),
        expect.objectContaining({ assigned: true, name: "value" }),
        expect.objectContaining({ assigned: true, name: "left" }),
        expect.objectContaining({ assigned: true, name: "right" }),
        expect.objectContaining({ assigned: true, name: "result" }),
      ]),
    );
  });

  it.each([
    ["missing item", "with ():\n    pass\n"],
    ["invalid target", "with manager as 1:\n    pass\n"],
    ["missing colon", "with manager as value\n    pass\n"],
    ["unparenthesized trailing comma", "with manager, :\n    pass\n"],
  ])("rejects %s", (_name, source): void => {
    expect(() => parse(source)).toThrow(LanguageSyntaxError);
  });

  it("bounds with items at exact construct capacity", (): void => {
    const source = "with first, second:\n    pass\n";
    expect(() =>
      parse(source, { parser: { maxItemsPerConstruct: 2 } }),
    ).not.toThrow();
    expect(() =>
      parse(source, { parser: { maxItemsPerConstruct: 1 } }),
    ).toThrow(/Construct item limit exceeded \(max 1\)/u);
  });
});
