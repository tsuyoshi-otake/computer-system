import { describe, expect, it } from "vitest";

import { lex } from "../../src/domain/language/lexer.js";
import { parse, parseExpression } from "../../src/domain/language/parser.js";

describe("Computer System Python frontend limits", (): void => {
  it("accepts the exact source and token limits and rejects capacity plus one", (): void => {
    expect(
      lex("a=1\n", {
        maxSourceCodeUnits: 4,
      }).at(-1)?.kind,
    ).toBe("eof");
    expect(() =>
      lex("a=1\na", {
        maxSourceCodeUnits: 4,
      }),
    ).toThrow(/Source code unit limit exceeded \(max 4\)/u);

    expect(lex("a\n", { maxTokens: 3 })).toHaveLength(3);
    expect(() => lex("a\n", { maxTokens: 2 })).toThrow(
      /Token limit exceeded \(max 2\)/u,
    );
  });

  it("bounds identifiers, literals, delimiters, and indentation independently", (): void => {
    expect(lex("name\n", { maxIdentifierCodeUnits: 4 })[0]?.lexeme).toBe(
      "name",
    );
    expect(() => lex("names\n", { maxIdentifierCodeUnits: 4 })).toThrow(
      /Identifier code unit limit exceeded \(max 4\)/u,
    );

    expect(lex('"abcd"\n', { maxLiteralCodeUnits: 4 })[0]?.literal).toBe(
      "abcd",
    );
    expect(() => lex('"abcde"\n', { maxLiteralCodeUnits: 4 })).toThrow(
      /Literal code unit limit exceeded \(max 4\)/u,
    );

    expect(lex("[[]]\n", { maxDelimiterNesting: 2 }).at(-1)?.kind).toBe("eof");
    expect(() => lex("[[[]]]\n", { maxDelimiterNesting: 2 })).toThrow(
      /Delimiter nesting limit exceeded \(max 2\)/u,
    );

    expect(lex("a:\n b:\n  c\n", { maxIndentationDepth: 2 }).at(-1)?.kind).toBe(
      "eof",
    );
    expect(() =>
      lex("a:\n b:\n  c:\n   d\n", { maxIndentationDepth: 2 }),
    ).toThrow(/Indentation depth limit exceeded \(max 2\)/u);
  });

  it("bounds total statements and nested suites before returning an AST", (): void => {
    expect(
      parse("a = 1\nb = 2\n", { parser: { maxStatements: 2 } }).body,
    ).toHaveLength(2);
    expect(() =>
      parse("a = 1\nb = 2\nc = 3\n", {
        parser: { maxStatements: 2 },
      }),
    ).toThrow(/Statement limit exceeded \(max 2\)/u);

    expect(
      parse("if True:\n if True:\n  pass\n", {
        parser: { maxBlockNesting: 2 },
      }).body,
    ).toHaveLength(1);
    expect(() =>
      parse("if True:\n if True:\n  if True:\n   pass\n", {
        parser: { maxBlockNesting: 2 },
      }),
    ).toThrow(/Block nesting limit exceeded \(max 2\)/u);
  });

  it("bounds recursive expressions, parameters, arguments, and collection items", (): void => {
    expect(
      parseExpression("((1))", { parser: { maxExpressionNesting: 3 } }),
    ).toMatchObject({ kind: "LiteralExpression", value: 1 });
    expect(() =>
      parseExpression("(((1)))", {
        parser: { maxExpressionNesting: 3 },
      }),
    ).toThrow(/Expression nesting limit exceeded \(max 3\)/u);

    expect(
      parse("def f(a, b):\n pass\n", {
        parser: { maxParameters: 2 },
      }).body[0],
    ).toMatchObject({ kind: "FunctionDefinition" });
    expect(() =>
      parse("def f(a, b, c):\n pass\n", {
        parser: { maxParameters: 2 },
      }),
    ).toThrow(/Parameter limit exceeded \(max 2\)/u);
    expect(
      parseExpression("f(1, 2)", { parser: { maxArguments: 2 } }),
    ).toMatchObject({ kind: "CallExpression" });
    expect(() =>
      parseExpression("f(1, 2, 3)", { parser: { maxArguments: 2 } }),
    ).toThrow(/Argument limit exceeded \(max 2\)/u);
    expect(
      parseExpression("[1, 2]", {
        parser: { maxItemsPerConstruct: 2 },
      }),
    ).toMatchObject({ kind: "ListExpression" });
    expect(() =>
      parseExpression("[1, 2, 3]", {
        parser: { maxItemsPerConstruct: 2 },
      }),
    ).toThrow(/Construct item limit exceeded \(max 2\)/u);
  });

  it("shares the formatted-string expression budget across embedded parsers", (): void => {
    expect(
      parseExpression('f"{a}{b}"', {
        parser: { maxFormattedStringExpressions: 2 },
      }),
    ).toMatchObject({ kind: "FormattedStringExpression" });
    expect(() =>
      parseExpression('f"{a}{b}"', {
        parser: { maxFormattedStringExpressions: 1 },
      }),
    ).toThrow(/Formatted string expression limit exceeded \(max 1\)/u);
  });

  it("terminates deeply recursive authored input with a language error", (): void => {
    expect(() => parseExpression(`${"not ".repeat(128)}True`)).toThrow(
      /Expression nesting limit exceeded \(max 64\)/u,
    );
    expect(() =>
      parseExpression(`${"(".repeat(65)}1${")".repeat(65)}`),
    ).toThrow(/Delimiter nesting limit exceeded \(max 64\)/u);
  });

  it("rejects invalid instance-scoped limit configuration", (): void => {
    expect(() => lex("a\n", { maxTokens: 0 })).toThrow(RangeError);
    expect(() =>
      parse("pass\n", { parser: { maxStatements: Number.NaN } }),
    ).toThrow(RangeError);
  });
});
