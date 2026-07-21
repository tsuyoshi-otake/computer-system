import { describe, expect, it } from "vitest";

import { LanguageSyntaxError } from "../../src/domain/language/errors.js";
import { lex } from "../../src/domain/language/lexer.js";
import { parseExpression } from "../../src/domain/language/parser.js";

describe("Python 3.14 template string syntax", (): void => {
  it.each(["t", "T", "tr", "rt", "TR", "RT"])(
    "lexes the %s prefix as a template string",
    (prefix): void => {
      expect(lex(`${prefix}"hello {name}"`)[0]).toMatchObject({
        kind: "template_string",
        literal: "hello {name}",
      });
    },
  );

  it("retains strings, authored expressions, conversions, and nested format fields", (): void => {
    expect(
      parseExpression(
        't"left={value!s:.{precision}f}; debug={ value = }; {{ok}}"',
      ),
    ).toMatchObject({
      kind: "TemplateStringExpression",
      strings: ["left=", "; debug= value = ", "; {ok}"],
      interpolations: [
        {
          conversion: "s",
          expression: "value",
          formatSpec: [
            ".",
            {
              conversion: null,
              expression: "precision",
              value: { kind: "IdentifierExpression", name: "precision" },
            },
            "f",
          ],
          value: { kind: "IdentifierExpression", name: "value" },
        },
        {
          conversion: "r",
          expression: " value ",
          formatSpec: [],
          value: { kind: "IdentifierExpression", name: "value" },
        },
      ],
    });
  });

  it("uses the same replacement grammar for formatted strings", (): void => {
    expect(parseExpression('f"{value!r:>{width}} { value = }"')).toMatchObject({
      interpolations: [
        {
          conversion: "r",
          expression: "value",
          formatSpec: [
            ">",
            {
              conversion: null,
              expression: "width",
              value: { kind: "IdentifierExpression", name: "width" },
            },
          ],
        },
        {
          conversion: "r",
          expression: " value ",
        },
      ],
      kind: "FormattedStringExpression",
      strings: ["", "  value = ", ""],
    });
  });

  it("preserves raw literal backslashes and permits triple-quoted templates", (): void => {
    expect(parseExpression('tr"path={root}\\\\file"')).toMatchObject({
      strings: ["path=", "\\\\file"],
    });
    expect(parseExpression('t"""first\n{value}\nlast"""')).toMatchObject({
      strings: ["first\n", "\nlast"],
    });
    expect(parseExpression(`t"{ {'}': 1} }"`)).toMatchObject({
      interpolations: [{ value: { kind: "DictionaryExpression" } }],
      strings: ["", ""],
    });
  });

  it.each([
    ['t"{}"', /Empty template string interpolation/u],
    ['t"{value!q}"', /Invalid template string conversion/u],
    ['t"value }"', /Unmatched closing brace/u],
    ['t"{value"', /Unterminated string literal/u],
  ])("rejects malformed template %s", (source, expected): void => {
    expect(() => parseExpression(source)).toThrow(LanguageSyntaxError);
    expect(() => parseExpression(source)).toThrow(expected);
  });

  it("shares the bounded replacement budget with nested format fields", (): void => {
    expect(
      parseExpression('t"{value:.{precision}f}"', {
        parser: { maxFormattedStringExpressions: 2 },
      }),
    ).toMatchObject({ kind: "TemplateStringExpression" });
    expect(() =>
      parseExpression('t"{value:.{precision}f}"', {
        parser: { maxFormattedStringExpressions: 1 },
      }),
    ).toThrow(/Template string interpolation limit exceeded \(max 1\)/u);
  });
});
