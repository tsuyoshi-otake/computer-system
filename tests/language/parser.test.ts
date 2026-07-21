import { describe, expect, it } from "vitest";

import { LanguageSyntaxError } from "../../src/domain/language/errors.js";
import { parse, parseExpression } from "../../src/domain/language/parser.js";

describe("Computer System Python parser", (): void => {
  it("parses literals, collections, precedence, attributes, subscripts, and calls", (): void => {
    const module = parse(`
value = 1 + 2 * 3 ** 2
items = [True, None, "text"]
mapping = {"answer": value}
result = api.call(items[0], limit=2)
message = f"value={value} {{ok}}"
`);

    expect(module.body.map(({ kind }) => kind)).toEqual([
      "AssignmentStatement",
      "AssignmentStatement",
      "AssignmentStatement",
      "AssignmentStatement",
      "AssignmentStatement",
    ]);
    expect(module.body[0]).toMatchObject({
      kind: "AssignmentStatement",
      value: {
        kind: "BinaryExpression",
        operator: "+",
        right: {
          kind: "BinaryExpression",
          operator: "*",
          right: { kind: "BinaryExpression", operator: "**" },
        },
      },
    });
    expect(module.body[3]).toMatchObject({
      value: {
        kind: "CallExpression",
        callee: { kind: "AttributeExpression", attribute: "call" },
        arguments: [
          { value: { kind: "SubscriptExpression" } },
          { name: "limit", value: { kind: "LiteralExpression", value: 2 } },
        ],
      },
    });
    expect(module.body[4]).toMatchObject({
      value: {
        kind: "FormattedStringExpression",
        interpolations: [
          {
            conversion: null,
            value: { kind: "IdentifierExpression", name: "value" },
          },
        ],
        strings: ["value=", " {ok}"],
      },
    });
  });

  it("parses assignments, branches, loops, functions, imports, and control flow", (): void => {
    const module = parse(`
import os, fs as filesystem

def choose(value, fallback=None):
    if value is not None and value >= 0:
        return value
    elif fallback in [1, 2]:
        return fallback
    else:
        return None

total = 0
for item in [1, 2, 3]:
    if item == 2:
        continue
    total = total + item

while total < 10:
    total = total + 1
    if total == 9:
        break
`);

    expect(module.body.map(({ kind }) => kind)).toEqual([
      "ImportStatement",
      "FunctionDefinition",
      "AssignmentStatement",
      "ForStatement",
      "WhileStatement",
    ]);
    expect(module.body[1]).toMatchObject({
      kind: "FunctionDefinition",
      name: "choose",
      parameters: [
        { name: "value" },
        { name: "fallback", defaultValue: { value: null } },
      ],
      body: [{ kind: "IfStatement", branches: [{}, {}] }],
    });
  });

  it("parses absolute and explicit-relative from imports", (): void => {
    const module = parse(`
import package.tools as tools
from package import value as answer, helper
from . import local
from ..shared.tools import (build as make, run,)
from package import *
`);

    expect(module.body).toMatchObject([
      {
        imports: [{ alias: "tools", module: "package.tools" }],
        kind: "ImportStatement",
      },
      {
        imports: [{ alias: "answer", name: "value" }, { name: "helper" }],
        kind: "FromImportStatement",
        level: 0,
        module: "package",
        wildcard: false,
      },
      {
        imports: [{ name: "local" }],
        kind: "FromImportStatement",
        level: 1,
        wildcard: false,
      },
      {
        imports: [{ alias: "make", name: "build" }, { name: "run" }],
        kind: "FromImportStatement",
        level: 2,
        module: "shared.tools",
        wildcard: false,
      },
      {
        imports: [],
        kind: "FromImportStatement",
        level: 0,
        module: "package",
        wildcard: true,
      },
    ]);
    expect(() => parse("from package import value,\n")).toThrow(
      /Trailing import comma requires parentheses/u,
    );
    expect(() => parse("from import value\n")).toThrow(
      /Expected module name after from/u,
    );
  });

  it("parses try, except, else, finally, and raise", (): void => {
    const module = parse(`
try:
    risky()
except ValueError as error:
    raise error
except:
    raise
else:
    pass
finally:
    cleanup()
`);

    expect(module.body[0]).toMatchObject({
      kind: "TryStatement",
      handlers: [
        {
          type: { name: "ValueError" },
          name: "error",
          body: [{ kind: "RaiseStatement" }],
        },
        { body: [{ kind: "RaiseStatement" }] },
      ],
      elseBody: [{ kind: "PassStatement" }],
      finallyBody: [{ kind: "ExpressionStatement" }],
    });
  });

  it("parses tuple and boolean/comparison expressions deterministically", (): void => {
    expect(parseExpression("1, 2, 3")).toMatchObject({
      kind: "TupleExpression",
      elements: [{ value: 1 }, { value: 2 }, { value: 3 }],
    });
    expect(parseExpression("not a or b and c not in values")).toMatchObject({
      kind: "BooleanExpression",
      operator: "or",
      values: [
        { kind: "UnaryExpression", operator: "not" },
        {
          kind: "BooleanExpression",
          operator: "and",
          values: [{ name: "b" }, { kind: "ComparisonExpression" }],
        },
      ],
    });
  });

  it.each([
    ["invalid assignment", "1 = value\n", /Invalid assignment target/u],
    ["missing block", "if True:\nvalue = 1\n", /Expected indent/u],
    [
      "bad parameter order",
      "def f(a=1, b):\n    pass\n",
      /required parameter/u,
    ],
    [
      "try without handler",
      "try:\n    pass\nvalue = 1\n",
      /try requires except or finally/u,
    ],
    [
      "positional after keyword",
      "call(a=1, 2)\n",
      /Positional argument follows/u,
    ],
  ])("rejects %s", (_name, source, message): void => {
    expect(() => parse(source)).toThrow(LanguageSyntaxError);
    expect(() => parse(source)).toThrow(message);
  });
});
