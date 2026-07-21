import { describe, expect, it } from "vitest";

import { LanguageSyntaxError } from "../../src/domain/language/errors.js";
import { parse, parseExpression } from "../../src/domain/language/parser.js";

describe("Computer System Python call syntax", (): void => {
  it("classifies every supported Python parameter kind", (): void => {
    const module = parse(`
def sample(a, b=2, /, c=3, *values, required, optional=5, **named):
    pass
`);

    expect(module.body[0]).toMatchObject({
      kind: "FunctionDefinition",
      parameters: [
        { name: "a", parameterKind: "positional_only" },
        {
          defaultValue: { value: 2 },
          name: "b",
          parameterKind: "positional_only",
        },
        {
          defaultValue: { value: 3 },
          name: "c",
          parameterKind: "positional_or_keyword",
        },
        { name: "values", parameterKind: "variadic_positional" },
        { name: "required", parameterKind: "keyword_only" },
        {
          defaultValue: { value: 5 },
          name: "optional",
          parameterKind: "keyword_only",
        },
        { name: "named", parameterKind: "variadic_keyword" },
      ],
    });
  });

  it("retains call argument source order and unpacking kinds", (): void => {
    expect(
      parseExpression("target(first(), named=second(), *third(), **fourth())"),
    ).toMatchObject({
      kind: "CallExpression",
      arguments: [
        { argumentKind: "positional" },
        { argumentKind: "keyword", name: "named" },
        { argumentKind: "iterable_unpack" },
        { argumentKind: "mapping_unpack" },
      ],
    });
  });

  it.each([
    ["leading slash", "def invalid(/):\n    pass\n", /positional-only/u],
    [
      "duplicate name",
      "def invalid(value, /, value):\n    pass\n",
      /Duplicate parameter/u,
    ],
    ["bare star", "def invalid(*):\n    pass\n", /Bare \*/u],
    [
      "parameter after kwargs",
      "def invalid(**named, value):\n    pass\n",
      /follows variadic keyword/u,
    ],
    [
      "required after a positional default",
      "def invalid(value=1, /, required):\n    pass\n",
      /required parameter/u,
    ],
    [
      "duplicate explicit keyword",
      "target(value=1, value=2)\n",
      /Repeated keyword/u,
    ],
    [
      "ordinary positional after keyword",
      "target(value=1, 2)\n",
      /Positional argument follows/u,
    ],
    [
      "iterable unpack after mapping unpack",
      "target(**named, *values)\n",
      /Iterable unpacking follows/u,
    ],
  ])("rejects %s", (_name, source, message): void => {
    expect(() => parse(source)).toThrow(LanguageSyntaxError);
    expect(() => parse(source)).toThrow(message);
  });
});
