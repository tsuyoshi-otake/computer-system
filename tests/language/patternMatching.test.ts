import { describe, expect, it } from "vitest";

import { parse } from "../../src/domain/language/parser.js";
import {
  analyzeScopes,
  type ScopeInfo,
  type ScopeSymbol,
} from "../../src/domain/language/scope.js";

function symbol(scope: ScopeInfo, name: string): ScopeSymbol | undefined {
  return scope.symbols.find((candidate) => candidate.name === name);
}

describe("Computer System Python structural pattern syntax", (): void => {
  it("keeps match and case available as soft-keyword identifiers", (): void => {
    const module = parse("match = 1\ncase = match + 1\n");

    expect(module.body).toMatchObject([
      {
        kind: "AssignmentStatement",
        targets: [{ kind: "IdentifierExpression", name: "match" }],
      },
      {
        kind: "AssignmentStatement",
        targets: [{ kind: "IdentifierExpression", name: "case" }],
      },
    ]);
  });

  it("parses literal, OR, AS, sequence, mapping, class, value, and guarded patterns", (): void => {
    const statement = parse(`
match get_subject():
    case None:
        result = 0
    case 1 | 2 as number if number > threshold:
        result = number
    case [first, *middle, last]:
        result = middle
    case {"kind": kind, Keys.name: value, **rest}:
        result = rest
    case models.Point(x, y=y):
        result = x
    case _:
        result = -1
`).body[0];

    expect(statement).toMatchObject({
      cases: [
        { pattern: { kind: "LiteralPattern", value: null } },
        {
          guard: { kind: "ComparisonExpression" },
          pattern: {
            kind: "AsPattern",
            name: "number",
            pattern: {
              alternatives: [{ value: 1 }, { value: 2 }],
              kind: "OrPattern",
            },
          },
        },
        {
          pattern: {
            elements: [
              { kind: "CapturePattern", name: "first" },
              { kind: "StarPattern", name: "middle" },
              { kind: "CapturePattern", name: "last" },
            ],
            kind: "SequencePattern",
          },
        },
        {
          pattern: {
            entries: [
              { key: { value: "kind" }, pattern: { name: "kind" } },
              {
                key: { attribute: "name", kind: "AttributeExpression" },
                pattern: { name: "value" },
              },
            ],
            kind: "MappingPattern",
            rest: "rest",
          },
        },
        {
          pattern: {
            className: { attribute: "Point", kind: "AttributeExpression" },
            keywords: [{ attribute: "y", pattern: { name: "y" } }],
            kind: "ClassPattern",
            positional: [{ name: "x" }],
          },
        },
        { pattern: { kind: "WildcardPattern" } },
      ],
      kind: "MatchStatement",
      subject: { kind: "CallExpression" },
    });
  });

  it("rejects ambiguous, duplicate, and unreachable capture structures", (): void => {
    expect(() =>
      parse("match value:\n    case [item, item]:\n        pass\n"),
    ).toThrow(/Multiple assignments to name item/u);
    expect(() =>
      parse("match value:\n    case left | right:\n        pass\n"),
    ).toThrow(/Alternative patterns bind different names/u);
    expect(() =>
      parse("match value:\n    case [*left, *right]:\n        pass\n"),
    ).toThrow(/Multiple star patterns/u);
    expect(() =>
      parse('match value:\n    case {"x": one, "x": two}:\n        pass\n'),
    ).toThrow(/Duplicate mapping pattern key/u);
    expect(() =>
      parse(
        "match value:\n    case _:\n        pass\n    case 1:\n        pass\n",
      ),
    ).toThrow(/Irrefutable case must be last/u);
  });

  it("bounds case count and recursive pattern nesting", (): void => {
    const twoCases =
      "match value:\n    case 1:\n        pass\n    case _:\n        pass\n";
    expect(
      parse(twoCases, { parser: { maxItemsPerConstruct: 2 } }).body,
    ).toHaveLength(1);
    expect(() =>
      parse(twoCases, { parser: { maxItemsPerConstruct: 1 } }),
    ).toThrow(/Construct item limit exceeded/u);
    expect(() =>
      parse("match value:\n    case [[[item]]]:\n        pass\n", {
        parser: { maxExpressionNesting: 2 },
      }),
    ).toThrow(/Expression nesting limit exceeded/u);
  });

  it("assigns captures and references subjects, guards, value keys, and classes", (): void => {
    const analysis = analyzeScopes(
      parse(`
match subject:
    case {Keys.name: captured, **remaining} if predicate(captured):
        result = remaining
    case models.Point(x, y=y):
        result = x + y
`),
    );

    for (const name of ["captured", "remaining", "x", "y", "result"]) {
      expect(symbol(analysis.root, name)).toMatchObject({
        assigned: true,
        binding: "global",
      });
    }
    for (const name of ["subject", "Keys", "predicate", "models"]) {
      expect(symbol(analysis.root, name)).toMatchObject({
        binding: "global",
        referenced: true,
      });
    }
  });
});
