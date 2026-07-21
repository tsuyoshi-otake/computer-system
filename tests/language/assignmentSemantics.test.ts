import { describe, expect, it } from "vitest";

import { LanguageSyntaxError } from "../../src/domain/language/errors.js";
import { parse } from "../../src/domain/language/parser.js";
import { analyzeScopes } from "../../src/domain/language/scope.js";

describe("Computer System Python assignment syntax", (): void => {
  it("retains chained targets in left-to-right source order", (): void => {
    expect(
      parse("first = values[index] = source.value\n").body[0],
    ).toMatchObject({
      kind: "AssignmentStatement",
      targets: [
        { kind: "IdentifierExpression", name: "first" },
        { kind: "SubscriptExpression" },
      ],
      value: { kind: "AttributeExpression", attribute: "value" },
    });
  });

  it.each([
    ["+=", "+"],
    ["-=", "-"],
    ["*=", "*"],
    ["/=", "/"],
    ["//=", "//"],
    ["%=", "%"],
    ["**=", "**"],
    ["<<=", "<<"],
    [">>=", ">>"],
    ["&=", "&"],
    ["^=", "^"],
    ["|=", "|"],
  ])("parses %s as augmented %s", (sourceOperator, operator): void => {
    expect(parse(`value ${sourceOperator} 2\n`).body[0]).toMatchObject({
      kind: "AugmentedAssignmentStatement",
      target: { name: "value" },
      operator,
      value: { value: 2 },
    });
  });

  it("classifies an augmented identifier as both referenced and assigned", (): void => {
    const scope = analyzeScopes(parse("def update():\n    value += 1\n")).root
      .children[0]!;

    expect(scope.symbols).toContainEqual(
      expect.objectContaining({
        name: "value",
        binding: "local",
        referenced: true,
        assigned: true,
      }),
    );
  });

  it.each([
    ["call target", "target() += 1\n"],
    ["tuple target", "first, second += values\n"],
    ["truncated chain", "first = second =\n"],
    ["assignment after augmented RHS", "first += second = 3\n"],
  ])("rejects %s before executable construction", (_name, source): void => {
    expect(() => parse(source)).toThrow(LanguageSyntaxError);
  });
});
