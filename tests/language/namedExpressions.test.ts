import { describe, expect, it } from "vitest";

import { LanguageSyntaxError } from "../../src/domain/language/errors.js";
import { parse, parseExpression } from "../../src/domain/language/parser.js";
import { analyzeScopes } from "../../src/domain/language/scope.js";

describe("Computer System Python assignment-expression syntax", (): void => {
  it("parses direct if/while conditions and parenthesized expressions", (): void => {
    const module = parse(`
if selected := source:
    pass
while current := next_value:
    break
result = (saved := 3)
`);

    expect(module.body[0]).toMatchObject({
      kind: "IfStatement",
      branches: [
        {
          test: {
            kind: "NamedExpression",
            target: { name: "selected" },
          },
        },
      ],
    });
    expect(module.body[1]).toMatchObject({
      kind: "WhileStatement",
      test: { kind: "NamedExpression", target: { name: "current" } },
    });
    expect(module.body[2]).toMatchObject({
      kind: "AssignmentStatement",
      value: { kind: "NamedExpression", target: { name: "saved" } },
    });
  });

  it("keeps assignment expressions below conditional expressions", (): void => {
    expect(
      parseExpression("(saved := left if condition else right)"),
    ).toMatchObject({
      kind: "NamedExpression",
      target: { name: "saved" },
      value: { kind: "ConditionalExpression" },
    });
  });

  it("accepts flexible display and positional-call placements", (): void => {
    expect(parseExpression("[saved := 1]")).toMatchObject({
      kind: "ListExpression",
      elements: [{ kind: "NamedExpression" }],
    });
    expect(parseExpression("consume(saved := 1)")).toMatchObject({
      kind: "CallExpression",
      arguments: [{ value: { kind: "NamedExpression" } }],
    });
  });

  it.each([
    ["expression statement", "saved := 1\n"],
    ["ordinary assignment RHS", "result = saved := 1\n"],
    ["attribute target", "result = (object.saved := 1)\n"],
    ["subscript target", "result = (items[0] := 1)\n"],
    ["slice component", "result = items[saved := 1:]\n"],
    ["conditional test", "result = 1 if saved := source else 2\n"],
    ["lambda body", "function = lambda: saved := 1\n"],
    ["keyword value", "consume(value=saved := 1)\n"],
    ["dictionary key", "result = {saved := 1: 2}\n"],
    ["return value", "def function():\n    return saved := 1\n"],
  ])("rejects an unparenthesized or invalid %s", (_name, source): void => {
    expect(() => parse(source)).toThrow(LanguageSyntaxError);
  });

  it("charges the named RHS against the expression nesting ceiling", (): void => {
    const source = "(saved := 1)";

    expect(
      parseExpression(source, { parser: { maxExpressionNesting: 3 } }),
    ).toMatchObject({ kind: "NamedExpression" });
    expect(() =>
      parseExpression(source, {
        parser: { maxExpressionNesting: 2 },
      }),
    ).toThrow(/Expression nesting limit exceeded \(max 2\)/u);
  });

  it("classifies a named target as a whole-function local", (): void => {
    const analysis = analyzeScopes(
      parse(`
def choose(flag):
    if selected := flag:
        return selected
    return selected
`),
    );
    const selected = analysis.root.children[0]!.symbols.find(
      ({ name }) => name === "selected",
    );

    expect(selected).toMatchObject({
      assigned: true,
      binding: "local",
      referenced: true,
    });
  });
});
