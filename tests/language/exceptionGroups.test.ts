import { describe, expect, it } from "vitest";

import { LanguageSyntaxError } from "../../src/domain/language/errors.js";
import { parse } from "../../src/domain/language/parser.js";

describe("Computer System Python 3.14 exception-group syntax", (): void => {
  it("parses except-star handlers and optional-parentheses type lists", (): void => {
    const module = parse(`
try:
    work()
except* (ValueError, TypeError) as errors:
    handled(errors)
except* KeyError:
    pass
`);

    expect(module.body[0]).toMatchObject({
      kind: "TryStatement",
      handlers: [
        {
          starred: true,
          type: {
            elements: [{ name: "ValueError" }, { name: "TypeError" }],
            kind: "TupleExpression",
          },
          name: "errors",
        },
        { starred: true, type: { name: "KeyError" } },
      ],
    });
  });

  it("accepts an unparenthesized exception list when no as target follows", (): void => {
    const module = parse(`
try:
    work()
except* ValueError, TypeError:
    pass
`);
    expect(module.body[0]).toMatchObject({
      handlers: [
        {
          starred: true,
          type: { kind: "TupleExpression" },
        },
      ],
    });
  });

  it("keeps ordinary handlers explicitly non-starred", (): void => {
    const module = parse(`
try:
    work()
except ValueError:
    pass
`);
    expect(module.body[0]).toMatchObject({
      handlers: [{ starred: false }],
      kind: "TryStatement",
    });
  });

  it.each([
    [
      "mixed handlers",
      "try:\n    work()\nexcept ValueError:\n    pass\nexcept* TypeError:\n    pass\n",
      /Cannot mix except and except\*/u,
    ],
    [
      "bare except-star",
      "try:\n    work()\nexcept*:\n    pass\n",
      /except\* requires an exception type/u,
    ],
    [
      "unparenthesized list with as",
      "try:\n    work()\nexcept* ValueError, TypeError as errors:\n    pass\n",
      /require parentheses when followed by as/u,
    ],
    [
      "unparenthesized trailing comma",
      "try:\n    work()\nexcept* ValueError, TypeError,:\n    pass\n",
      /Trailing exception-type comma requires parentheses/u,
    ],
    [
      "return",
      "def run():\n    try:\n        work()\n    except* ValueError:\n        return 1\n",
      /return is not allowed in an except\* suite/u,
    ],
    [
      "nested break",
      "while True:\n    try:\n        work()\n    except* ValueError:\n        if ready:\n            break\n",
      /break is not allowed in an except\* suite/u,
    ],
    [
      "nested continue",
      "while True:\n    try:\n        work()\n    except* ValueError:\n        while ready:\n            continue\n",
      /continue is not allowed in an except\* suite/u,
    ],
  ])("rejects %s", (_name, source, expected): void => {
    expect(() => parse(source)).toThrow(LanguageSyntaxError);
    expect(() => parse(source)).toThrow(expected);
  });

  it("allows control flow inside a nested function scope", (): void => {
    expect(() =>
      parse(`
try:
    work()
except* ValueError:
    def nested():
        return 1
`),
    ).not.toThrow();
  });
});
