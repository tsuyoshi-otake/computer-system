import { describe, expect, it } from "vitest";

import { LanguageSyntaxError } from "../../src/domain/language/errors.js";
import { lex } from "../../src/domain/language/lexer.js";

describe("Computer System Python lexer", (): void => {
  it("tokenizes indentation, literals, operators, and source positions", (): void => {
    const tokens = lex(
      'if enabled and count >= 2:\n    value = f"n={count}"\n',
    );

    expect(tokens.map(({ kind, lexeme }) => [kind, lexeme])).toEqual([
      ["keyword", "if"],
      ["identifier", "enabled"],
      ["keyword", "and"],
      ["identifier", "count"],
      ["operator", ">="],
      ["number", "2"],
      ["operator", ":"],
      ["newline", "\n"],
      ["indent", ""],
      ["identifier", "value"],
      ["operator", "="],
      ["formatted_string", 'f"n={count}"'],
      ["newline", "\n"],
      ["dedent", ""],
      ["eof", ""],
    ]);
    expect(tokens[8]?.span.start).toEqual({ offset: 27, line: 2, column: 1 });
    expect(tokens[9]?.span.start).toEqual({ offset: 31, line: 2, column: 5 });
  });

  it("suppresses logical newlines inside collection delimiters", (): void => {
    const tokens = lex("values = [\n  1,\n  2,\n]\n");

    expect(tokens.filter(({ kind }) => kind === "newline")).toHaveLength(1);
    expect(tokens.filter(({ kind }) => kind === "indent")).toHaveLength(0);
  });

  it("decodes strings and numeric separators", (): void => {
    const tokens = lex('value = 1_000.5\ntext = "a\\nb"\n');

    expect(tokens.find(({ kind }) => kind === "number")?.literal).toBe(1000.5);
    expect(tokens.find(({ kind }) => kind === "string")?.literal).toBe("a\nb");
  });

  it.each([
    ["tabs", "if True:\n\tpass\n", /Tabs are not allowed/u],
    [
      "bad indentation",
      "if True:\n    pass\n  pass\n",
      /Indentation does not match/u,
    ],
    ["unterminated string", 'text = "oops\n', /Unterminated string/u],
    ["unclosed delimiter", "values = [1, 2\n", /Unclosed delimiter/u],
  ])(
    "rejects %s with a located syntax error",
    (_name, source, message): void => {
      expect(() => lex(source)).toThrow(LanguageSyntaxError);
      expect(() => lex(source)).toThrow(message);
    },
  );
});
